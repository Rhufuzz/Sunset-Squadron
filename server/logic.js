'use strict';
/*
 * Pure game-logic helpers extracted from server.js (behaviour-preserving move).
 *
 * Everything in here is deterministic and free of socket/game-state access so it
 * can be unit-tested directly (test/logic.test.js). server.js requires these back
 * by name; signatures and semantics are identical to the originals.
 */

// ---------------------------------------------------------------------------
// Shared deterministic PRNG (identical code lives in public/js/world.js)
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Small vector / orientation helpers (match THREE Euler order 'YXZ')
// ---------------------------------------------------------------------------
function quatFromYPR(yaw, pitch, roll) {
  const c1 = Math.cos(pitch / 2), c2 = Math.cos(yaw / 2), c3 = Math.cos(roll / 2);
  const s1 = Math.sin(pitch / 2), s2 = Math.sin(yaw / 2), s3 = Math.sin(roll / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 - s1 * s2 * c3,
    w: c1 * c2 * c3 + s1 * s2 * s3,
  };
}
function forwardFromYP(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -cp * Math.sin(yaw), y: Math.sin(pitch), z: -cp * Math.cos(yaw) };
}
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function vlen(v) { return Math.hypot(v.x, v.y, v.z); }
function vsub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function vdot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function vnorm(v) { const l = vlen(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }
function vscale(v, s) { return { x: v.x * s, y: v.y * s, z: v.z * s }; }
function vadd(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function r2(n) { return Math.round(n * 100) / 100; }
function r3(n) { return Math.round(n * 1000) / 1000; }

/** Returns an outward push normal if pos is inside an island ellipsoid, else null. */
function islandCollision(pos, islands) {
  for (const isl of islands) {
    const dx = (pos.x - isl.cx) / isl.rx;
    const dy = (pos.y - isl.cy) / isl.ry;
    const dz = (pos.z - isl.cz) / isl.rx;
    const q = dx * dx + dy * dy + dz * dz;
    if (q < 1) {
      const n = vnorm({ x: dx / isl.rx, y: dy / isl.ry, z: dz / isl.rx });
      const push = (1 - Math.sqrt(q)) * Math.min(isl.rx, isl.ry) + 2;
      return { n, push, island: isl };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-round seeded weather
// ---------------------------------------------------------------------------
const WEATHER_TYPES = ['clear', 'breeze', 'gusty'];
const WEATHER_LABELS = { clear: '☀️ CLEAR', breeze: '💨 BREEZE', gusty: '🌧️ GUSTY' };
function generateWeather(seed) {
  const rand = mulberry32((seed ^ 0x5a5a5a5a) >>> 0);
  const type = WEATHER_TYPES[Math.floor(rand() * WEATHER_TYPES.length)];
  let speed = 0;
  let wind = { x: 0, y: 0, z: 0 };
  if (type === 'breeze') {
    speed = 1.8;
    const ang = rand() * Math.PI * 2;
    wind = { x: r2(Math.cos(ang) * speed), y: 0, z: r2(Math.sin(ang) * speed) };
  } else if (type === 'gusty') {
    speed = 3.6; // ~7.5% of SPEED_BASE (48), capped under 8%
    const ang = rand() * Math.PI * 2;
    wind = { x: r2(Math.cos(ang) * speed), y: 0, z: r2(Math.sin(ang) * speed) };
  }
  return { type, speed, wind, label: WEATHER_LABELS[type] };
}

// ---------------------------------------------------------------------------
// Mid-round events (seeded per round, all modes)
// ---------------------------------------------------------------------------
const EVENT_TYPES = ['balloonRush', 'meteorShower', 'frenzy'];
const EVENT_DURATIONS = { balloonRush: 60, meteorShower: 45, frenzy: 60 };
const EVENT_AT_S = 60;                // fires ~60s into a full-length round
const EVENT_BALLOON_HP = 6;           // rocket hits needed to burst the golden balloon
const EVENT_METEOR_COUNT = 18;        // meteors spawned over the meteorShower window
const EVENT_METEOR_SPEED = 25;        // u/s, matches the server integration step
// Mirror the server world constants (logic.js stays dependency-free).
const EVENT_CEILING = 260;
const EVENT_WORLD_RADIUS = 920;       // keep ground targets inside the playfield

/**
 * Pure per-round event planner: same seed -> same type, timing and spawn data.
 * Returns { type, atS, durS, data }:
 *   balloonRush  data: { pos:{x,y,z}, hp }         giant gold balloon spawn
 *   meteorShower data: { count, interval, meteors } start pos + velocity per meteor
 *   frenzy       data: { mult }                    global score multiplier
 * Short (test) rounds scale the start time and duration so the event still fits.
 */
function generateEvent(seed, roundLength = 180) {
  const rand = mulberry32((seed ^ 0x3ee7dada) >>> 0);
  const rl = Math.max(10, roundLength || 180);
  const type = EVENT_TYPES[Math.floor(rand() * EVENT_TYPES.length)];
  const atS = Math.round(Math.min(EVENT_AT_S, rl / 3) * 10) / 10;
  const durS = Math.round(Math.min(EVENT_DURATIONS[type], Math.max(5, rl - atS)) * 10) / 10;
  let data = {};
  if (type === 'balloonRush') {
    // Hover above the central island so it is reachable from anywhere
    const ang = rand() * Math.PI * 2;
    const d = 25 + rand() * 85;
    data = {
      pos: { x: r2(Math.cos(ang) * d), y: r2(95 + rand() * 55), z: r2(Math.sin(ang) * d) },
      hp: EVENT_BALLOON_HP,
    };
  } else if (type === 'meteorShower') {
    const meteors = [];
    for (let i = 0; i < EVENT_METEOR_COUNT; i++) {
      // Seeded ground target inside the world, start high above the ceiling
      const ang = rand() * Math.PI * 2;
      const d = 80 + rand() * (EVENT_WORLD_RADIUS - 160);
      const tx = Math.cos(ang) * d;
      const tz = Math.sin(ang) * d;
      const sx = tx + (rand() - 0.5) * 300;
      const sz = tz + (rand() - 0.5) * 300;
      const sy = 320 + rand() * 90;   // above CEILING (260)
      const v = vscale(vnorm({ x: tx - sx, y: -sy, z: tz - sz }), EVENT_METEOR_SPEED);
      meteors.push({ x: r2(sx), y: r2(sy), z: r2(sz), vx: r2(v.x), vy: r2(v.y), vz: r2(v.z) });
    }
    data = { count: EVENT_METEOR_COUNT, interval: r2(Math.max(0.5, (durS - 4) / EVENT_METEOR_COUNT)), meteors };
  } else {
    data = { mult: 2 };
  }
  return { type, atS, durS, data };
}

// ---------------------------------------------------------------------------
// Homing cone math
// ---------------------------------------------------------------------------

/** Angle (radians, 0..pi) between a rocket's direction and the vector to a point. */
function homingAngle(dir, from, to) {
  return Math.acos(clamp(vdot(dir, vnorm(vsub(to, from))), -1, 1));
}

// ---------------------------------------------------------------------------
// Checkpoint Race
// ---------------------------------------------------------------------------
const RACE_FINISH_BASE = 100;        // 1st place points
const RACE_FINISH_STEP = 15;         // points lost per rank
const RACE_FINISH_MIN = 25;          // floor for finish points

/** Points awarded for finishing a race at the given 1-based rank. */
function raceFinishPoints(rank) {
  return Math.max(RACE_FINISH_MIN, RACE_FINISH_BASE - RACE_FINISH_STEP * (rank - 1));
}

/**
 * Pure half of stepRaceGate: plane-crossing math for one race gate.
 * gate: { x, y, z, yaw, gateR }; pos: player position; prevSide: previous
 * frame's side (+1/-1) or undefined on first sight.
 * crossed is true only when the gate plane was crossed between frames,
 * close to the plane (|along| < 30) and inside the ring (lateral < gateR + 1.5).
 */
function gateCrossing(gate, pos, prevSide) {
  const rel = { x: pos.x - gate.x, y: pos.y - gate.y, z: pos.z - gate.z };
  const nx = Math.sin(gate.yaw), nz = Math.cos(gate.yaw);
  const along = rel.x * nx + rel.z * nz;
  const lateral = Math.hypot(rel.x * nz - rel.z * nx, rel.y);
  const side = along >= 0 ? 1 : -1;
  const crossed =
    prevSide !== undefined && prevSide !== side &&
    Math.abs(along) < 30 && lateral < gate.gateR + 1.5;
  return { side, along, lateral, crossed };
}

/**
 * Sort comparator for race round results (from endRound):
 * finish order first, then gates passed, then fewest seconds for tied finishers.
 */
function compareRaceResults(a, b) {
  const fa = a.race.finished ? 0 : 1, fb = b.race.finished ? 0 : 1;
  if (fa !== fb) return fa - fb;
  if (a.race.finished && b.race.finished) {
    if (a.race.finishRank !== b.race.finishRank) return a.race.finishRank - b.race.finishRank;
    return a.race.finishTime - b.race.finishTime;
  }
  if (b.race.gatesPassed !== a.race.gatesPassed) return b.race.gatesPassed - a.race.gatesPassed;
  return b.score - a.score;
}

module.exports = {
  mulberry32,
  quatFromYPR, forwardFromYP, wrapAngle,
  clamp, lerp, vlen, vsub, vdot, vnorm, vscale, vadd, dist, r2, r3,
  islandCollision,
  WEATHER_TYPES, WEATHER_LABELS, generateWeather,
  EVENT_TYPES, EVENT_DURATIONS, EVENT_AT_S, EVENT_BALLOON_HP, generateEvent,
  homingAngle,
  RACE_FINISH_BASE, RACE_FINISH_STEP, RACE_FINISH_MIN, raceFinishPoints,
  gateCrossing, compareRaceResults,
};
