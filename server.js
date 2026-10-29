'use strict';
/*
 * Sunset Squadron: Crown Chase - authoritative game server.
 *
 * - Express serves the static frontend from ./public
 * - /api/host-info returns the join URL, a QR code data URL and the current world seed
 * - Socket.io runs the lobby and a 20Hz authoritative game loop:
 *     rockets, homing, hits, crown transfers, ribbon-contrail steals,
 *     balloons, ring gates, super-charge, scores, round timer and AI wingman bots.
 * - Human players fly their own jets client-side (60fps prediction) and report their
 *   transform 20 times per second; the server sanity-clamps it and runs all game rules.
 */

const os = require('os');
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const PILOT_DATA = require('./shared/pilots');
const { Leaderboard } = require('./leaderboard');
const { PILOTS, POWERUPS, POWERUP_TYPES, PILOT_IDS, pilotById, perkMultipliers } = PILOT_DATA;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT, 10) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
const TICK_MS = 50;                  // 20Hz
const ROUND_SECONDS = parseInt(process.env.ROUND_SECONDS, 10) || 180;  // 3-minute rounds (override only for testing)
const ROUND_END_SHOW_MS = 9000;      // scoreboard duration before returning to lobby
const MAX_PLAYERS = 8;
const DISCONNECT_GRACE_S = 60;      // how long a disconnected pilot keeps their seat mid-round
const WORLD_RADIUS = 950;
const CEILING = 260;
const WATER_LEVEL = 0;

const SPEED_BASE = 48;
const SPEED_BOOST = 85;
const SPEED_SUPER = 100;
const ROCKET_SPEED = 130;
const ROCKET_LIFE = 3.2;
const ROCKET_COOLDOWN = 1.2;
const ROCKET_COOLDOWN_SUPER = 0.6;
const HOMING_CONE = (28 * Math.PI) / 180;
const HOMING_RANGE = 220;
const HOMING_TURN = 2.4;
const BARREL_ROLL_TIME = 0.45;
const TUMBLE_TIME = 0.6;
const CROWN_BURST_TIME = 3.0;
const SUPER_TIME = 8.0;
const RIBBON_POINTS = 44;            // ~2.2 seconds of ribbon at 20Hz
const RIBBON_MIN_AGE = 0.5;          // seconds before a ribbon segment can be stolen through
const BALLOON_RESPAWN_S = 18;
const PICKUP_COUNT = 12;             // floating power-up orbs in the world at once
const PICKUP_RESPAWN_S = 20;
const PICKUP_RADIUS = 11;            // base collection radius
const TURBO_SPEED = 95;
const ROCKET_COOLDOWN_RAPID = 0.4;
const MAGNET_MULT = 2.2;             // Magnet power-up range multiplier

const RACE_GATES = 10;               // Checkpoint Race: gates per course
const RACE_FINISH_BASE = 100;        // 1st place points
const RACE_FINISH_STEP = 15;         // points lost per rank
const RACE_FINISH_MIN = 25;          // floor for finish points
const RACE_GATE_R = 11;              // course gate ring radius (slightly bigger than blitz gates)

const BOT_NAMES = ['Wingman Ace', 'Wingman Duke', 'Wingman Pip', 'Wingman Zed'];
const leaderboard = new Leaderboard();
const PRESETS = ['sunset', 'noon', 'twilight'];
const MODES = ['crown', 'blitz', 'race'];

// ---------------------------------------------------------------------------
// Shared deterministic world layout (identical code lives in public/js/world.js)
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

function randomBalloonPos(rand, islands) {
  for (let tries = 0; tries < 20; tries++) {
    const ang = rand() * Math.PI * 2;
    const dist = 60 + rand() * 560;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    const y = 30 + rand() * 110;
    let ok = true;
    for (const isl of islands) {
      if (Math.hypot(x - isl.x, z - isl.z) < isl.rx + 12 && y < isl.cy + isl.ry + 20 && y > isl.cy - isl.ry - 10) {
        ok = false;
        break;
      }
    }
    if (ok) return { x, y, z };
  }
  return { x: 0, y: 160, z: 0 };
}

function generateLayout(seed) {
  const rand = mulberry32(seed);
  const islands = [];
  // Central caldera island: collision ellipsoid centred at sea level.
  islands.push({ kind: 'central', x: 0, y: 0, z: 0, r: 110, cx: 0, cy: 2, cz: 0, rx: 108, ry: 46 });
  const outer = 6;
  for (let i = 0; i < outer; i++) {
    const ang = (i / outer) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const dist = 300 + rand() * 140;
    const r = 42 + rand() * 34;
    const y = 40 + rand() * 70;
    islands.push({
      kind: 'floating',
      x: Math.cos(ang) * dist,
      y,
      z: Math.sin(ang) * dist,
      r,
      cx: Math.cos(ang) * dist,
      cy: y - r * 0.3,
      cz: Math.sin(ang) * dist,
      rx: r * 1.02,
      ry: r * 0.75,
    });
  }
  const arches = [];
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + (rand() - 0.5) * 0.3;
    const dist = 170 + rand() * 330;
    let x = Math.cos(ang) * dist;
    let z = Math.sin(ang) * dist;
    for (const isl of islands) {
      const dx = x - isl.x;
      const dz = z - isl.z;
      const d = Math.hypot(dx, dz);
      if (d < isl.rx + 34) {
        const k = (isl.rx + 34) / Math.max(d, 1);
        x = isl.x + dx * k;
        z = isl.z + dz * k;
      }
    }
    const y = 35 + rand() * 90;
    const yaw = rand() * Math.PI * 2;
    arches.push({ id: i, x, y, z, yaw, r: 14, gateR: 10, hue: i % 2 });
  }
  const balloons = [];
  for (let i = 0; i < 40; i++) {
    const p = randomBalloonPos(rand, islands);
    balloons.push({ id: i, x: p.x, y: p.y, z: p.z, tint: Math.floor(rand() * 6) });
  }
  const clouds = [];
  for (let i = 0; i < 36; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = 100 + rand() * 900;
    clouds.push({ x: Math.cos(ang) * dist, y: 150 + rand() * 120, z: Math.sin(ang) * dist, s: 10 + rand() * 18, puffs: 3 + Math.floor(rand() * 4) });
  }
  return { seed, islands, arches, balloons, clouds };
}

/**
 * Checkpoint Race course: RACE_GATES ring gates forming an open loop inside
 * WORLD_RADIUS, spaced 120-250m apart, at varied altitudes, each ring facing
 * along the direction of travel so pilots cross the gate plane flying the loop.
 * Uses its own stream of the shared seeded PRNG (same seed = same course).
 */
function generateCourse(seed, layout) {
  const rand = mulberry32((seed ^ 0x1f2e3d4c) >>> 0);
  const gates = [];
  const maxR = WORLD_RADIUS - 110;
  const startAng = rand() * Math.PI * 2;
  const startDist = 200 + rand() * 200;
  let x = Math.cos(startAng) * startDist;
  let z = Math.sin(startAng) * startDist;
  let y = 55 + rand() * 45;
  let dir = startAng + Math.PI / 2;          // start heading: tangential, so the loop circles the archipelago
  for (let i = 0; i < RACE_GATES; i++) {
    // Nudge the gate out of any island ellipsoid (same trick as arch placement)
    for (const isl of layout.islands) {
      const dx = x - isl.x, dz = z - isl.z;
      const d = Math.hypot(dx, dz);
      if (d < isl.rx + 30) {
        const k = (isl.rx + 30) / Math.max(d, 1);
        x = isl.x + dx * k;
        z = isl.z + dz * k;
      }
    }
    // Ring normal (sin yaw, cos yaw) aligned with the travel direction so the loop flies through it
    const yaw = Math.atan2(Math.cos(dir), Math.sin(dir));
    gates.push({ id: i, x, y, z, yaw, r: 16, gateR: RACE_GATE_R, hue: 0 });
    // Advance along the loop: gentle mostly-one-way curves keep it an open circuit
    const step = 130 + rand() * 110;         // 130-240m spacing (within the 120-250m brief)
    dir += (0.15 + rand() * 0.5) * (rand() < 0.82 ? 1 : -1);
    let nx = x + Math.cos(dir) * step;
    let nz = z + Math.sin(dir) * step;
    if (Math.hypot(nx, nz) > maxR) {
      // Steer back toward the centre before leaving the world
      dir = Math.atan2(-nz, -nx) + (rand() - 0.5) * 0.9;
      nx = x + Math.cos(dir) * step;
      nz = z + Math.sin(dir) * step;
    }
    // Keep the true gate-to-gate distance inside 125-245m even after island push-out
    for (let tries = 0; tries < 3; tries++) {
      for (const isl of layout.islands) {
        const dx = nx - isl.x, dz = nz - isl.z;
        const d = Math.hypot(dx, dz);
        if (d < isl.rx + 30) {
          const k = (isl.rx + 30) / Math.max(d, 1);
          nx = isl.x + dx * k;
          nz = isl.z + dz * k;
        }
      }
      const dx = nx - x, dz = nz - z;
      const d = Math.hypot(dx, dz);
      if (d < 125 || d > 245) {
        const target = d < 125 ? 125 + rand() * 25 : 220 + rand() * 25;
        nx = x + (dx / d) * target;
        nz = z + (dz / d) * target;
      } else break;
    }
    x = nx; z = nz;
    y = clamp(y + (rand() - 0.5) * 80, 40, 175);
  }
  return gates;
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
const state = {
  phase: 'lobby',               // lobby | playing | ended
  seed: (Math.random() * 0x7fffffff) >>> 0,
  layout: null,
  settings: { mode: 'crown', preset: 'sunset', bots: 2 },
  hostId: null,
  players: new Map(),           // id -> player (humans and bots)
  joinOrder: [],
  rockets: [],
  rocketSeq: 1,
  mines: [],
  mineSeq: 1,
  decoys: [],
  decoySeq: 1,
  crown: { holderId: null, pos: { x: 0, y: 95, z: 0 }, ribbon: [] },
  balloons: [],
  pickups: [],
  race: null,                   // race mode: { course: [...gates], finishCount }
  roundEndsAt: 0,
  endedAt: 0,
  lastResults: null,
};
state.layout = generateLayout(state.seed);

function now() { return Date.now() / 1000; }

function makePlayer(id, name, pilot, isBot) {
  return {
    id, name, pilot, isBot,
    perk: perkMultipliers(pilot),
    fx: {},                       // active power-ups: type -> expiry time (seconds)
    stats: { balloons: 0, hits: 0, crownTime: 0, pickups: 0 },
    pos: { x: 0, y: 80, z: 0 },
    quat: { x: 0, y: 0, z: 0, w: 1 },
    yaw: 0, pitch: 0, roll: 0,
    speed: SPEED_BASE,
    boost: false,
    stamina: 1,
    score: 0,
    rollingUntil: 0,
    tumbleUntil: 0,
    invulnUntil: 0,
    burstUntil: 0,
    superUntil: 0,
    lastFire: 0,
    lastSeen: now(),
    clientId: null,               // stable per-browser id (localStorage 'sq_client_id') for mid-round reconnect
    gone: false,                  // disconnected mid-round; seat held for DISCONNECT_GRACE_S
    goneAt: 0,
    gateSide: {},
    gateCooldown: {},
    race: { gateIndex: 0, gatesPassed: 0, finished: false, finishRank: 0, finishTime: 0 },
    joy: { x: 0, y: 0 },
    bot: null,
  };
}

function humans() { return [...state.players.values()].filter((p) => !p.isBot && !p.gone); }
function bots() { return [...state.players.values()].filter((p) => p.isBot); }

function spawnPlayer(p, index, total) {
  const ang = (index / Math.max(total, 1)) * Math.PI * 2;
  const radius = 230;
  p.pos = { x: Math.cos(ang) * radius, y: 70 + (index % 3) * 12, z: Math.sin(ang) * radius };
  // Face the centre of the archipelago
  const toCenter = vnorm({ x: -p.pos.x, y: 0, z: -p.pos.z });
  p.yaw = Math.atan2(-toCenter.x, -toCenter.z);
  p.pitch = 0;
  p.roll = 0;
  p.speed = SPEED_BASE;
  p.quat = quatFromYPR(p.yaw, 0, 0);
  p.score = 0;
  p.rollingUntil = 0; p.tumbleUntil = 0; p.invulnUntil = 0; p.burstUntil = 0; p.superUntil = 0;
  p.lastFire = 0;
  p.gateSide = {};
  p.gateCooldown = {};
  p.race = { gateIndex: 0, gatesPassed: 0, finished: false, finishRank: 0, finishTime: 0 };
  p.stamina = 1;
  p.fx = {};
  p.stats = { balloons: 0, hits: 0, crownTime: 0, pickups: 0 };
}

/** Safe mid-round respawn for a reconnecting pilot: new position, same score/stats. */
function respawnPlayer(p, index, total) {
  const keepScore = p.score;
  const keepStats = p.stats;
  const keepRace = p.race;
  spawnPlayer(p, index, total);
  p.score = keepScore;
  p.stats = keepStats;
  p.race = keepRace;            // reconnecting mid-race resumes at their next gate
  p.invulnUntil = now() + 3;    // brief spawn protection so they aren't instantly shot
}

/** Is a power-up currently active on this player? */
function hasFx(p, type, t) { return p.fx[type] !== undefined && p.fx[type] > t; }
function grantFx(p, type, t) {
  const base = POWERUPS[type].duration * p.perk.fxDuration;
  p.fx[type] = Math.max(p.fx[type] || 0, t) + base;
  return base;
}
/** Score helper so Score x2 applies everywhere points are earned. */
function addScore(p, amount, t) {
  p.score += hasFx(p, 'x2', t) ? amount * 2 : amount;
}
function publicPlayer(p) {
  return { id: p.id, name: p.name, pilot: p.pilot, isBot: p.isBot, gone: Boolean(p.gone), score: Math.round(p.score) };
}

// ---------------------------------------------------------------------------
// Power-up pickups
// ---------------------------------------------------------------------------
function randomPickupPos(rand) {
  const p = randomBalloonPos(rand, state.layout.islands);
  // Keep them away from other pickups so they spread across the map
  for (let tries = 0; tries < 8; tries++) {
    let ok = true;
    for (const o of state.pickups) if (o.alive && Math.hypot(o.x - p.x, o.z - p.z) < 90) { ok = false; break; }
    if (ok) break;
    const q = randomBalloonPos(rand, state.layout.islands);
    p.x = q.x; p.y = q.y; p.z = q.z;
  }
  p.y = clamp(p.y, 35, 150);
  return p;
}
function spawnPickups() {
  state.pickups = [];
  for (let i = 0; i < PICKUP_COUNT; i++) {
    const type = POWERUP_TYPES[i % POWERUP_TYPES.length];
    const pos = randomPickupPos(Math.random);
    state.pickups.push({ id: i, type, x: pos.x, y: pos.y, z: pos.z, alive: true, respawnAt: 0 });
  }
}
function pickupPublic(k) { return { id: k.id, type: k.type, x: r2(k.x), y: r2(k.y), z: r2(k.z), alive: k.alive }; }

function collectPickup(k, p, t) {
  k.alive = false;
  k.respawnAt = t + PICKUP_RESPAWN_S;
  const dur = grantFx(p, k.type, t);
  p.stats.pickups++;
  if (k.type === 'ghost') {
    // Rockets already homing in lose their lock
    for (const r of state.rockets) if (r.target === p.id && r.targetKind === 'player') r.target = null;
  } else if (k.type === 'mine') {
    // Drop an armed proximity mine behind your jet
    const dir = forwardFromYP(p.yaw, p.pitch);
    const dropPos = vsub(p.pos, vscale(dir, 10));
    const mine = { id: state.mineSeq++, owner: p.id, p: dropPos, born: t, armAt: t + 1.0, alive: true };
    state.mines.push(mine);
    io.emit('mineDrop', { id: mine.id, owner: mine.owner, p: [r2(mine.p.x), r2(mine.p.y), r2(mine.p.z)] });
  } else if (k.type === 'decoy') {
    // Spawn a mirror jet that flies a straight line for 6s
    const dir = forwardFromYP(p.yaw, p.pitch);
    const spawnPos = vadd(p.pos, vscale(dir, 5));
    const decoy = {
      id: state.decoySeq++,
      owner: p.id,
      pilot: p.pilot,
      p: spawnPos,
      dir,
      quat: { ...p.quat },
      speed: Math.max(p.speed, SPEED_BASE),
      born: t,
      expiresAt: t + dur,
      alive: true,
    };
    state.decoys.push(decoy);
    io.emit('decoySpawn', {
      id: decoy.id,
      owner: decoy.owner,
      pilot: decoy.pilot,
      p: [r2(decoy.p.x), r2(decoy.p.y), r2(decoy.p.z)],
      q: [r3(decoy.quat.x), r3(decoy.quat.y), r3(decoy.quat.z), r3(decoy.quat.w)],
      spd: r2(decoy.speed),
    });
  }
  io.emit('pickup', { id: k.id, type: k.type, by: p.id, p: [r2(k.x), r2(k.y), r2(k.z)], dur: r2(dur) });
}

function stepPickups(t) {
  for (const k of state.pickups) {
    if (k.alive) continue;
    if (t >= k.respawnAt) {
      const pos = randomPickupPos(Math.random);
      // Cycle the type so every orb type keeps appearing
      k.type = POWERUP_TYPES[(POWERUP_TYPES.indexOf(k.type) + 1 + Math.floor(Math.random() * 2)) % POWERUP_TYPES.length];
      k.x = pos.x; k.y = pos.y; k.z = pos.z;
      k.alive = true;
      io.emit('pickupSpawn', pickupPublic(k));
    }
  }
  // Expire finished effects
  for (const p of state.players.values()) {
    for (const type of Object.keys(p.fx)) {
      if (p.fx[type] <= t) {
        delete p.fx[type];
        io.emit('fxEnd', { id: p.id, type });
      }
    }
  }
}

/** Effective collection radius for pickups/balloons/crown (perk + Magnet power-up). */
function reach(p, base, t) {
  return base * p.perk.magnet * (hasFx(p, 'magnet', t) ? MAGNET_MULT : 1);
}
function fxSnapshot(p, t) {
  const out = {};
  for (const type of Object.keys(p.fx)) if (p.fx[type] > t) out[type] = r2(p.fx[type] - t);
  return out;
}

// ---------------------------------------------------------------------------
// Express + Socket.io
// ---------------------------------------------------------------------------
const app = express();

// Self-hosted Three.js (exact version from package.json) — no CDN dependency.
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three'), { etag: true, maxAge: '1d' }));

// Client error logging — /api/client-log
// Front-end traps (window.onerror / unhandledrejection) POST here so device
// failures (e.g. an iPad that silently dies) leave a trace on the server.
const clientLogBuffer = [];
app.post('/api/client-log', express.json({ limit: '16kb' }), (req, res) => {
  try {
    const e = req.body || {};
    const entry = {
      at: new Date().toISOString(),
      ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(),
      msg: String(e.msg || e.message || '').slice(0, 500),
      src: String(e.src || e.source || '').slice(0, 300),
      line: Number(e.line || e.lineno) || 0,
      col: Number(e.col || e.colno) || 0,
      stack: String(e.stack || '').slice(0, 1500),
      ua: String(req.headers['user-agent'] || '').slice(0, 200),
      url: String(e.url || req.headers.referer || '').slice(0, 300),
    };
    if (entry.msg) {
      clientLogBuffer.push(entry);
      if (clientLogBuffer.length > 200) clientLogBuffer.shift();
      console.log('[client-log]', entry.msg, '@', entry.src + ':' + entry.line);
    }
  } catch (err) { /* logging must never break the API */ }
  res.json({ ok: true });
});
app.get('/api/client-log', (req, res) => res.json({ entries: clientLogBuffer.slice(-100) }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  pingInterval: 10000,
  pingTimeout: 20000,
});

app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: 0 }));

// ---------------------------------------------------------------------------
// Procedural app icon (no asset files): a 180x180 sunset gradient with a gold crown disc,
// encoded as PNG with zlib so iOS "Add to Home Screen" and browser tabs get an icon.
// ---------------------------------------------------------------------------
const zlib = require('zlib');
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function buildIconPng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const top = [43, 30, 74], mid = [232, 111, 82], bot = [255, 190, 118];
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    const k = y / (size - 1);
    const a = k < 0.55 ? top : mid, b = k < 0.55 ? mid : bot, kk = k < 0.55 ? k / 0.55 : (k - 0.55) / 0.45;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      let r = a[0] + (b[0] - a[0]) * kk, g = a[1] + (b[1] - a[1]) * kk, bl = a[2] + (b[2] - a[2]) * kk;
      const dx = x - size / 2, dy = y - size * 0.6;
      const d = Math.hypot(dx, dy);
      if (d < size * 0.22) { r = 255; g = 213; bl = 74; }
      else if (d < size * 0.26) { r = r * 0.5 + 128; g = g * 0.5 + 100; bl = bl * 0.5 + 30; }
      // crown spikes
      const spike = Math.abs(((x / size) * 5) % 1 - 0.5) * 2;
      if (y > size * 0.2 && y < size * 0.4 && dx * dx < (size * 0.3) ** 2 && (size * 0.4 - y) / (size * 0.2) < 1 - spike) { r = 255; g = 213; bl = 74; }
      raw[o] = r | 0; raw[o + 1] = g | 0; raw[o + 2] = bl | 0; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const ICON_PNG = buildIconPng(180);
for (const route of ['/favicon.ico', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/icon.png']) {
  app.get(route, (req, res) => { res.type('png').set('Cache-Control', 'public, max-age=86400').send(ICON_PNG); });
}
app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json').json({
    name: 'Sunset Squadron: Crown Chase', short_name: 'Sunset Squadron', start_url: '/', display: 'fullscreen',
    orientation: 'landscape', background_color: '#2b1e4a', theme_color: '#2b1e4a',
    icons: [{ src: '/icon.png', sizes: '180x180', type: 'image/png' }],
  });
});

function detectLanIPv4() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      const isV4 = iface.family === 'IPv4' || iface.family === 4;
      if (!isV4 || iface.internal) continue;
      const a = iface.address;
      let score = 0;
      if (a.startsWith('192.168.')) score = 3;
      else if (a.startsWith('10.')) score = 2;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) score = 2;
      else score = 1;
      if (/^(docker|br-|veth|virbr|vmnet|tun|tap)/i.test(name)) score -= 2;
      candidates.push({ a, score });
    }
  }
  candidates.sort((x, y) => y.score - x.score);
  return candidates.length ? candidates[0].a : '127.0.0.1';
}

function hostUrl() {
  if (PUBLIC_URL) return PUBLIC_URL;
  return `http://${detectLanIPv4()}:${PORT}`;
}

app.get('/api/host-info', async (req, res) => {
  try {
    let url = hostUrl();
    // The lobby page may ask for a QR of the origin it was actually loaded from
    // (e.g. a public VPS hostname while the server only auto-detected a private LAN IP).
    const requested = typeof req.query.url === 'string' ? req.query.url.trim().replace(/\/+$/, '') : '';
    if (requested && /^https?:\/\/[\w.\-:[\]]+$/.test(requested) && requested.length < 200) url = requested;
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: '#1a1030', light: '#fff6e8' } });
    res.json({ url, qrDataUrl, seed: state.seed, isPublicUrl: Boolean(PUBLIC_URL) });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

app.get('/js/pilots-data.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache').send(PILOT_DATA.toEsModuleSource());
});

app.get('/api/leaderboard', (req, res) => {
  const n = clamp(parseInt(req.query.limit, 10) || 10, 1, 100);
  res.set('Cache-Control', 'no-store').json(leaderboard.summary(n));
});

app.get('/api/pilots', (req, res) => {
  res.json({ pilots: PILOTS, perks: PILOT_DATA.PERKS, powerups: POWERUPS });
});

app.get('/api/status', (req, res) => {
  res.json({
    phase: state.phase,
    players: humans().length,
    bots: bots().length,
    settings: state.settings,
    seed: state.seed,
    timeRemaining: state.phase === 'playing' ? Math.max(0, (state.roundEndsAt - Date.now()) / 1000) : 0,
  });
});

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------
function lobbyPayload() {
  return {
    phase: state.phase,
    hostId: state.hostId,
    settings: state.settings,
    seed: state.seed,
    players: [...state.players.values()].map(publicPlayer),
    timeRemaining: state.phase === 'playing' ? Math.max(0, (state.roundEndsAt - Date.now()) / 1000) : 0,
    lastResults: state.lastResults,
    leaderboard: leaderboard.summary(10),
  };
}
function broadcastLobby() { io.emit('lobby', lobbyPayload()); }

function pickHost() {
  const connected = (p) => p && !p.isBot && !p.gone;
  if (state.hostId && connected(state.players.get(state.hostId))) return;
  // Host = the earliest-joined connected human
  state.hostId = null;
  for (const id of state.joinOrder) {
    if (connected(state.players.get(id))) { state.hostId = id; break; }
  }
  if (!state.hostId) {
    const list = humans();
    if (list.length) state.hostId = list[0].id;
  }
}

/** Re-evaluate the host and tell every client when it changed. */
function updateHost() {
  const prev = state.hostId;
  pickHost();
  if (state.hostId !== prev) io.emit('hostChange', { hostId: state.hostId });
}

/** Drop pilots whose reconnect grace has expired (called while a round is playing). */
function purgeExpiredGone(t) {
  for (const p of [...state.players.values()]) {
    if (p.gone && t - p.goneAt > DISCONNECT_GRACE_S) {
      state.players.delete(p.id);
      state.joinOrder = state.joinOrder.filter((id) => id !== p.id);
      console.log(`[gone] ${p.name} did not return - seat freed`);
    }
  }
}

/** Remove every still-disconnected pilot (lobby / new round = clean slate). */
function removeAllGone() {
  for (const p of [...state.players.values()]) {
    if (p.gone) state.players.delete(p.id);
  }
  state.joinOrder = state.joinOrder.filter((id) => state.players.has(id));
}

/**
 * Socket teardown, shared by 'disconnect' and an explicit 'leave' event.
 * Mid-round a human's seat is held (gone) for DISCONNECT_GRACE_S so they can
 * rejoin with their clientId; anywhere else they are removed immediately.
 */
function detachPlayer(player) {
  if (!player) return;
  const wasHolder = state.crown.holderId === player.id;
  if (state.phase === 'playing' && !player.isBot) {
    player.gone = true;
    player.goneAt = now();
    player.fx = {};
    player.rollingUntil = 0;
    player.tumbleUntil = 0;
    player.boost = false;
    player.joy = { x: 0, y: 0 };
    console.log(`[leave] ${player.name} (seat held ${DISCONNECT_GRACE_S}s for reconnect)`);
  } else {
    state.players.delete(player.id);
    state.joinOrder = state.joinOrder.filter((id) => id !== player.id);
    console.log(`[leave] ${player.name}`);
  }
  if (wasHolder) dropCrown(player.pos);
  updateHost();
  if (humans().length === 0 && state.phase !== 'lobby') {
    // Nobody left: reset so the next visitor gets a clean lobby
    state.phase = 'lobby';
    for (const b of bots()) state.players.delete(b.id);
    removeAllGone();
    state.rockets = [];
  }
  broadcastLobby();
}

function roundStartPayload() {
  return {
    seed: state.seed,
    mode: state.settings.mode,
    preset: state.settings.preset,
    endsAt: state.roundEndsAt,
    serverNow: Date.now(),
    balloons: state.balloons.map((b) => ({ id: b.id, x: r2(b.x), y: r2(b.y), z: r2(b.z), alive: b.alive, tint: b.tint })),
    crown: { holderId: state.crown.holderId, pos: state.crown.pos },
    pickups: state.pickups.map(pickupPublic),
    course: state.race ? { gates: state.race.course.map((g) => ({ id: g.id, x: r2(g.x), y: r2(g.y), z: r2(g.z), yaw: r3(g.yaw), gateR: g.gateR })), total: state.race.course.length } : null,
    players: [...state.players.values()].map((p) => ({ id: p.id, name: p.name, pilot: p.pilot, isBot: p.isBot, pos: p.pos, yaw: p.yaw })),
  };
}

function startRound() {
  if (state.phase === 'playing') return;
  // New round = clean slate: pilots who never rejoined lose their seat
  removeAllGone();
  // New world every round so the archipelago stays fresh
  state.seed = (Math.random() * 0x7fffffff) >>> 0;
  state.layout = generateLayout(state.seed);
  // Remove previous bots, add new ones
  for (const b of bots()) state.players.delete(b.id);
  // Bots get random pilots, preferring ones no human picked so the sky stays colourful
  const takenPilots = new Set(humans().map((h) => h.pilot));
  let pool = PILOT_IDS.filter((id) => !takenPilots.has(id));
  for (let i = 0; i < state.settings.bots; i++) {
    if (!pool.length) pool = [...PILOT_IDS];
    const pilot = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const id = `bot-${i + 1}`;
    const b = makePlayer(id, BOT_NAMES[i % BOT_NAMES.length], pilot, true);
    b.bot = { targetId: null, fleeUntil: 0, retarget: 0, wander: 0, boostUntil: 0, pickupId: null };
    state.players.set(id, b);
  }
  const all = [...state.players.values()];
  all.forEach((p, i) => spawnPlayer(p, i, all.length));
  state.rockets = [];
  state.mines = [];
  state.decoys = [];
  state.crown = { holderId: null, pos: { x: 0, y: 95, z: 0 }, ribbon: [] };
  state.race = state.settings.mode === 'race' ? { course: generateCourse(state.seed, state.layout), finishCount: 0 } : null;
  state.balloons = state.layout.balloons.map((b) => ({ id: b.id, x: b.x, y: b.y, z: b.z, tint: b.tint, alive: true, respawnAt: 0 }));
  spawnPickups();
  state.phase = 'playing';
  state.roundEndsAt = Date.now() + ROUND_SECONDS * 1000;
  state.lastResults = null;
  io.emit('roundStart', roundStartPayload());
  broadcastLobby();
  console.log(`[round] started mode=${state.settings.mode} preset=${state.settings.preset} bots=${state.settings.bots} seed=${state.seed} players=${all.length}`);
}

function endRound() {
  if (state.phase !== 'playing') return;
  state.phase = 'ended';
  state.endedAt = Date.now();
  const mode = state.settings.mode;
  const isRace = mode === 'race';
  const results = [...state.players.values()]
    .map((p) => ({
      id: p.id, name: p.name, pilot: p.pilot, isBot: p.isBot, score: Math.round(p.score),
      stats: { balloons: p.stats.balloons, hits: p.stats.hits, crownTime: Math.round(p.stats.crownTime), pickups: p.stats.pickups },
      race: {
        finished: p.race.finished, finishRank: p.race.finishRank, finishTime: p.race.finishTime,
        gatesPassed: p.race.gatesPassed, total: state.race ? state.race.course.length : RACE_GATES,
      },
      newBests: [],
    }));
  if (isRace) {
    // Finish order first, then gates passed, then fewest seconds for tied finishers
    results.sort((a, b) => {
      const fa = a.race.finished ? 0 : 1, fb = b.race.finished ? 0 : 1;
      if (fa !== fb) return fa - fb;
      if (a.race.finished && b.race.finished) {
        if (a.race.finishRank !== b.race.finishRank) return a.race.finishRank - b.race.finishRank;
        return a.race.finishTime - b.race.finishTime;
      }
      if (b.race.gatesPassed !== a.race.gatesPassed) return b.race.gatesPassed - a.race.gatesPassed;
      return b.score - a.score;
    });
  } else {
    results.sort((a, b) => b.score - a.score);
  }
  const winnerId = results.length ? results[0].id : null;
  // Humans only on the persistent leaderboard
  const humanRows = results.filter((r) => !r.isBot).map((r) => ({
    name: r.name, pilot: r.pilot, score: r.score, won: r.id === winnerId,
    points: mode === 'crown' ? r.stats.crownTime : r.score,
    balloons: r.stats.balloons, hits: r.stats.hits,
  }));
  const bests = leaderboard.recordRound(mode, humanRows);
  for (const r of results) {
    if (r.isBot) continue;
    r.newBests = bests[Leaderboard.key(r.name, r.pilot)] || [];
  }
  state.lastResults = { mode, results, endedAt: state.endedAt, winnerId, leaderboard: leaderboard.summary(10) };
  io.emit('roundEnd', state.lastResults);
  console.log('[round] ended:', results.map((r) => `${r.name}=${r.score}`).join(', '));
}

function returnToLobby() {
  state.phase = 'lobby';
  for (const b of bots()) state.players.delete(b.id);
  removeAllGone();
  state.rockets = [];
  state.mines = [];
  state.decoys = [];
  state.pickups = [];
  state.race = null;
  state.crown = { holderId: null, pos: { x: 0, y: 95, z: 0 }, ribbon: [] };
  broadcastLobby();
}

io.on('connection', (socket) => {
  let player = null;


  socket.on('join', (data, ack) => {
    if (player) { if (typeof ack === 'function') ack({ ok: true, id: player.id, lobby: lobbyPayload() }); return; }
    const safe = data && typeof data === 'object' ? data : {};
    const clientId = typeof safe.clientId === 'string' ? safe.clientId.slice(0, 64) : null;
    // Mid-round reconnect: same browser, still inside the grace window?
    let restored = null;
    if (clientId && state.phase === 'playing') {
      for (const p of state.players.values()) {
        if (!p.isBot && p.gone && p.clientId && p.clientId === clientId) { restored = p; break; }
      }
    }
    if (restored) {
      const oldId = restored.id;
      state.players.delete(oldId);
      restored.id = socket.id;
      restored.clientId = clientId;
      restored.gone = false;
      restored.goneAt = 0;
      restored.lastSeen = now();
      state.players.set(socket.id, restored);
      state.joinOrder = state.joinOrder.map((id) => (id === oldId ? socket.id : id));
      if (state.crown.holderId === oldId) state.crown.holderId = socket.id;
      player = restored;
      respawnPlayer(restored, state.players.size - 1, state.players.size);
      // Ack before roundStart so the client knows its new id when the round payload lands
      if (typeof ack === 'function') ack({ ok: true, id: socket.id, restored: true, lobby: lobbyPayload() });
      socket.emit('roundStart', roundStartPayload());
      broadcastLobby();
      console.log(`[rejoin] ${restored.name} restored mid-round (score ${Math.round(restored.score)}) as ${socket.id}`);
      return;
    }
    // Capacity: connected humans + seats still held for reconnecting pilots.
    // A gone pilot's seat frees up for others after DISCONNECT_GRACE_S or when the lobby returns.
    const seatsUsed = [...state.players.values()].filter((p) => !p.isBot).length;
    if (seatsUsed >= MAX_PLAYERS) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Squadron is full (8 pilots max).' });
      return;
    }
    // Pilot characters: duplicates are allowed (two friends can both fly as KAYA);
    // the player name keeps everyone distinguishable.
    const pilot = PILOT_IDS.includes(safe.pilot) ? safe.pilot : PILOT_IDS[Math.floor(Math.random() * PILOT_IDS.length)];
    let name = String(safe.name || '').slice(0, 14).replace(/[^\w\- ]/g, '').trim();
    if (!name) name = pilotById(pilot).callsign;
    // Keep player names unique within the squadron
    const taken = new Set([...state.players.values()].map((p) => p.name));
    let unique = name; let n = 2;
    while (taken.has(unique)) unique = `${name} ${n++}`;
    player = makePlayer(socket.id, unique, pilot, false);
    player.clientId = clientId;
    state.players.set(socket.id, player);
    state.joinOrder.push(socket.id);
    updateHost();
    const midRound = state.phase === 'playing';
    if (midRound) {
      // Drop-in mid-round
      spawnPlayer(player, state.players.size - 1, state.players.size);
    }
    if (typeof ack === 'function') ack({ ok: true, id: socket.id, lobby: lobbyPayload() });
    if (midRound) socket.emit('roundStart', roundStartPayload());
    broadcastLobby();
    console.log(`[join] ${unique} as ${pilot} (${socket.id}) host=${state.hostId === socket.id}`);
  });

  socket.on('setPilot', (data) => {
    // Pilot can be changed from the lobby roster between rounds
    if (!player || state.phase === 'playing' || !data || !PILOT_IDS.includes(data.pilot)) return;
    player.pilot = data.pilot;
    player.perk = perkMultipliers(data.pilot);
    broadcastLobby();
  });

  socket.on('setSettings', (data) => {
    if (!player || socket.id !== state.hostId || !data || typeof data !== 'object') return;
    let changedPreset = false;
    if (MODES.includes(data.mode)) state.settings.mode = data.mode;
    if (PRESETS.includes(data.preset) && data.preset !== state.settings.preset) { state.settings.preset = data.preset; changedPreset = true; }
    if ([0, 2, 3, 4].includes(Number(data.bots))) state.settings.bots = Number(data.bots);
    if (changedPreset) io.emit('preset', { preset: state.settings.preset });
    broadcastLobby();
  });

  socket.on('startRound', () => {
    if (!player || socket.id !== state.hostId) return;
    if (state.phase === 'lobby') startRound();
  });

  socket.on('state', (s) => {
    if (!player || state.phase !== 'playing' || !s || typeof s !== 'object') return;
    const p = Array.isArray(s.p) ? s.p : null;
    const q = Array.isArray(s.q) ? s.q : null;
    if (!p || p.length < 3 || !q || q.length < 4) return;
    const np = { x: +p[0] || 0, y: +p[1] || 0, z: +p[2] || 0 };
    // Sanity clamp: never allow more than ~2x super speed of travel per report, keep inside the world
    const maxStep = SPEED_SUPER * 2 * 0.25;
    const d = dist(np, player.pos);
    if (d > maxStep) {
      const k = maxStep / d;
      np.x = player.pos.x + (np.x - player.pos.x) * k;
      np.y = player.pos.y + (np.y - player.pos.y) * k;
      np.z = player.pos.z + (np.z - player.pos.z) * k;
    }
    np.y = clamp(np.y, WATER_LEVEL + 1, CEILING + 20);
    const hr = Math.hypot(np.x, np.z);
    if (hr > WORLD_RADIUS + 60) { const k = (WORLD_RADIUS + 60) / hr; np.x *= k; np.z *= k; }
    player.pos = np;
    player.quat = { x: +q[0] || 0, y: +q[1] || 0, z: +q[2] || 0, w: +q[3] || 1 };
    player.yaw = +s.yaw || 0;
    player.pitch = +s.pitch || 0;
    player.roll = +s.roll || 0;
    player.speed = clamp(+s.spd || SPEED_BASE, 0, SPEED_SUPER + 10);
    player.boost = Boolean(s.boost);
    player.stamina = clamp(+s.st || 0, 0, 1);
    player.lastSeen = now();
  });

  socket.on('fire', () => {
    if (!player || state.phase !== 'playing') return;
    if (state.settings.mode === 'race') return;   // no fireworks on the race course
    tryFire(player);
  });

  socket.on('barrelRoll', () => {
    if (!player || state.phase !== 'playing') return;
    const t = now();
    if (t < player.rollingUntil) return;
    player.rollingUntil = t + BARREL_ROLL_TIME * player.perk.rollTime;
    io.emit('roll', { id: player.id });
  });

  socket.on('disconnect', () => detachPlayer(player));

  socket.on('leave', () => detachPlayer(player));
});

// ---------------------------------------------------------------------------
// Rockets, crown, balloons, gates
// ---------------------------------------------------------------------------
function tryFire(p) {
  if (state.settings.mode === 'race') return false;   // fireworks are off during Checkpoint Race
  const t = now();
  let cd = t < p.superUntil ? ROCKET_COOLDOWN_SUPER : ROCKET_COOLDOWN;
  if (hasFx(p, 'rapid', t)) cd = Math.min(cd, ROCKET_COOLDOWN_RAPID);
  cd *= p.perk.reload;
  if (t - p.lastFire < cd - 0.05) return false;
  p.lastFire = t;
  const dir = forwardFromYP(p.yaw, p.pitch);
  const start = vadd(p.pos, vscale(dir, 5));
  state.rockets.push({ id: state.rocketSeq++, owner: p.id, p: start, d: dir, born: t, target: null, targetKind: null });
  io.emit('shot', { id: p.id, p: [r2(start.x), r2(start.y), r2(start.z)] });
  return true;
}

function dropCrown(pos) {
  state.crown.holderId = null;
  state.crown.pos = { x: pos.x, y: Math.max(pos.y, 40), z: pos.z };
  state.crown.ribbon = [];
  io.emit('crown', { holderId: null, by: null, how: 'dropped', pos: state.crown.pos });
}

function giveCrown(toId, how, fromId) {
  const t = now();
  state.crown.holderId = toId;
  state.crown.ribbon = [];
  const p = state.players.get(toId);
  if (p) {
    p.burstUntil = t + CROWN_BURST_TIME;
    p.invulnUntil = t + CROWN_BURST_TIME;
  }
  io.emit('crown', { holderId: toId, by: toId, from: fromId || null, how });
}

function findHomingTarget(r, t) {
  let best = null;
  let bestAng = HOMING_CONE;
  const owner = state.players.get(r.owner);
  const range = HOMING_RANGE * (owner ? owner.perk.homingRange : 1);
  const consider = (pos, id, kind) => {
    const to = vsub(pos, r.p);
    const d = vlen(to);
    if (d > range || d < 0.01) return;
    const ang = Math.acos(clamp(vdot(r.d, vscale(to, 1 / d)), -1, 1));
    if (ang < bestAng) { bestAng = ang; best = { id, kind }; }
  };
  for (const p of state.players.values()) {
    if (p.id === r.owner) continue;
    if (hasFx(p, 'ghost', t)) continue;   // Ghost: invisible to homing
    consider(p.pos, p.id, 'player');
  }
  for (const dec of state.decoys) {
    if (dec.owner === r.owner) continue;
    consider(dec.p, dec.id, 'decoy');
  }
  if (state.settings.mode === 'blitz') {
    for (const b of state.balloons) if (b.alive) consider(b, b.id, 'balloon');
  }
  return best;
}

function stepRockets(dt, t) {
  const alive = [];
  for (const r of state.rockets) {
    if (t - r.born > ROCKET_LIFE) continue;
    if (!r.target) {
      const tg = findHomingTarget(r, t);
      if (tg) { r.target = tg.id; r.targetKind = tg.kind; }
    } else if (r.targetKind !== 'decoy') {
      // Retarget to decoy if an enemy decoy is closer and within homing cone
      let curD = HOMING_RANGE * 2;
      if (r.targetKind === 'player') { const tp = state.players.get(r.target); if (tp) curD = dist(tp.pos, r.p); }
      else if (r.targetKind === 'balloon') { const b = state.balloons[r.target]; if (b) curD = dist(b, r.p); }
      for (const dec of state.decoys) {
        if (dec.owner === r.owner) continue;
        const dd = dist(dec.p, r.p);
        if (dd < curD) {
          const toD = vnorm(vsub(dec.p, r.p));
          const cosAD = clamp(vdot(r.d, toD), -1, 1);
          if (Math.acos(cosAD) < HOMING_CONE) {
            r.target = dec.id;
            r.targetKind = 'decoy';
            curD = dd;
          }
        }
      }
    }
    if (r.target) {
      let tpos = null;
      if (r.targetKind === 'player') { const tp = state.players.get(r.target); tpos = tp ? tp.pos : null; }
      else if (r.targetKind === 'decoy') { const dec = state.decoys.find((d) => d.id === r.target); tpos = dec ? dec.p : null; }
      else { const b = state.balloons[r.target]; tpos = b && b.alive ? b : null; }
      if (!tpos) { r.target = null; }
      else {
        const to = vnorm(vsub(tpos, r.p));
        const cosA = clamp(vdot(r.d, to), -1, 1);
        const ang = Math.acos(cosA);
        if (ang > Math.PI / 2 + 0.3) { r.target = null; }
        else if (ang > 0.0005) {
          const owner = state.players.get(r.owner);
          const turnMult = owner && owner.perk && owner.perk.homingTurn ? owner.perk.homingTurn : 1;
          const step = Math.min(ang, HOMING_TURN * turnMult * dt);
          const perp = vnorm(vsub(to, vscale(r.d, cosA)));
          r.d = vnorm(vadd(vscale(r.d, Math.cos(step)), vscale(perp, Math.sin(step))));
        }
      }
    }
    r.p = vadd(r.p, vscale(r.d, ROCKET_SPEED * dt));
    let dead = false;
    // Player hits / deflections
    for (const p of state.players.values()) {
      if (p.id === r.owner) continue;
      const d = dist(p.pos, r.p);
      if (d < 16 && t < p.rollingUntil && !r.deflected) {
        // Barrel roll deflects the rocket away from the dodging jet
        const away = vnorm(vsub(r.p, p.pos));
        r.d = vnorm(vadd(vscale(away, 0.8), vscale(r.d, 0.3)));
        r.target = null;
        r.deflected = true;
        r.born = Math.min(r.born, t - ROCKET_LIFE + 1.2);
        io.emit('deflect', { id: p.id, by: r.owner, p: [r2(r.p.x), r2(r.p.y), r2(r.p.z)] });
        continue;
      }
      if (d < 8 && t >= p.invulnUntil && !(t < p.rollingUntil)) {
        dead = true;
        const shooter = state.players.get(r.owner);
        if (hasFx(p, 'shield', t)) {
          // Shield Bubble absorbs the hit and pops
          delete p.fx.shield;
          io.emit('shieldBreak', { id: p.id, by: r.owner, p: [r2(r.p.x), r2(r.p.y), r2(r.p.z)] });
          break;
        }
        p.tumbleUntil = t + TUMBLE_TIME * p.perk.tumble;
        let crownStolen = false;
        if (shooter) shooter.stats.hits++;
        if (state.settings.mode === 'crown' && state.crown.holderId === p.id && shooter) {
          crownStolen = true;
          giveCrown(shooter.id, 'rocket', p.id);
        } else if (state.settings.mode === 'blitz' && shooter) {
          addScore(shooter, 5, t);
        }
        io.emit('hit', { shooter: r.owner, victim: p.id, p: [r2(r.p.x), r2(r.p.y), r2(r.p.z)], crownStolen });
        break;
      }
    }
    // Decoy collision: any rocket hit destroys the decoy
    if (!dead) {
      for (const dec of state.decoys) {
        if (dec.owner === r.owner) continue;
        if (dist(dec.p, r.p) < 12) {
          dead = true;
          dec.expiresAt = 0; // expires immediately
          io.emit('boom', { p: [r2(dec.p.x), r2(dec.p.y), r2(dec.p.z)] });
          io.emit('decoyHit', { id: dec.id, by: r.owner, p: [r2(dec.p.x), r2(dec.p.y), r2(dec.p.z)] });
          break;
        }
      }
    }
    if (!dead && state.settings.mode === 'blitz') {
      for (const b of state.balloons) {
        if (!b.alive) continue;
        if (dist(b, r.p) < 9) { popBalloon(b, r.owner, t); dead = true; break; }
      }
    }
    if (!dead && islandCollision(r.p, state.layout.islands)) {
      dead = true;
      io.emit('boom', { p: [r2(r.p.x), r2(r.p.y), r2(r.p.z)] });
    }
    if (!dead && r.p.y < WATER_LEVEL) {
      dead = true;
      io.emit('boom', { p: [r2(r.p.x), r2(r.p.y), r2(r.p.z)], water: true });
    }
    if (!dead) alive.push(r);
  }
  state.rockets = alive;
}

function stepMines(dt, t) {
  const alive = [];
  for (const m of state.mines) {
    if (t - m.born > 25) continue;
    let dead = false;
    if (t >= m.armAt) {
      for (const p of state.players.values()) {
        if (p.id === m.owner || p.gone) continue;
        const d = dist(m.p, p.pos);
        if (d < 14 && t >= p.invulnUntil && !(t < p.rollingUntil)) {
          dead = true;
          const miner = state.players.get(m.owner);
          if (hasFx(p, 'shield', t)) {
            delete p.fx.shield;
            io.emit('shieldBreak', { id: p.id, by: m.owner, p: [r2(m.p.x), r2(m.p.y), r2(m.p.z)] });
          } else {
            p.tumbleUntil = t + TUMBLE_TIME * p.perk.tumble;
            let crownStolen = false;
            if (miner) miner.stats.hits++;
            if (state.settings.mode === 'crown' && state.crown.holderId === p.id && miner) {
              crownStolen = true;
              giveCrown(miner.id, 'mine', p.id);
            } else if (state.settings.mode === 'blitz' && miner) {
              addScore(miner, 5, t);
            }
            io.emit('hit', { shooter: m.owner, victim: p.id, p: [r2(m.p.x), r2(m.p.y), r2(m.p.z)], crownStolen, mine: true });
          }
          io.emit('boom', { p: [r2(m.p.x), r2(m.p.y), r2(m.p.z)] });
          break;
        }
      }
    }
    if (!dead) alive.push(m);
  }
  state.mines = alive;
}

function stepDecoys(dt, t) {
  const alive = [];
  for (const d of state.decoys) {
    if (t >= d.expiresAt) continue;
    d.p = vadd(d.p, vscale(d.dir, d.speed * dt));
    alive.push(d);
  }
  state.decoys = alive;
}

function popBalloon(b, byId, t) {
  b.alive = false;
  b.respawnAt = t + BALLOON_RESPAWN_S;
  const p = state.players.get(byId);
  if (p) { addScore(p, 10, t); p.stats.balloons++; }
  io.emit('pop', { id: b.id, by: byId, p: [r2(b.x), r2(b.y), r2(b.z)], tint: b.tint });
}

function stepBalloons(t) {
  for (const b of state.balloons) {
    if (b.alive) continue;
    if (t >= b.respawnAt) {
      const np = randomBalloonPos(Math.random, state.layout.islands);
      b.x = np.x; b.y = np.y; b.z = np.z;
      b.alive = true;
      io.emit('balloon', { id: b.id, x: r2(b.x), y: r2(b.y), z: r2(b.z), tint: b.tint });
    }
  }
}

function raceGateFor(p) {
  if (!state.race || p.race.finished) return null;
  return state.race.course[p.race.gateIndex] || null;
}

/** Checkpoint Race: detect crossing the current gate's plane inside the ring. */
function stepRaceGate(p, t) {
  const a = raceGateFor(p);
  if (!a) return;
  const rel = { x: p.pos.x - a.x, y: p.pos.y - a.y, z: p.pos.z - a.z };
  const nx = Math.sin(a.yaw), nz = Math.cos(a.yaw);
  const along = rel.x * nx + rel.z * nz;
  const lateral = Math.hypot(rel.x * nz - rel.z * nx, rel.y);
  const side = along >= 0 ? 1 : -1;
  const prev = p.gateSide[a.id];
  p.gateSide[a.id] = side;
  if (prev === undefined || prev === side || Math.abs(along) >= 30 || lateral >= a.gateR + 1.5) return;
  if (p.gateCooldown[a.id] > t) return;
  p.gateCooldown[a.id] = t + 3;
  p.race.gatesPassed++;
  const total = state.race.course.length;
  const isFinal = p.race.gateIndex >= total - 1;
  if (!isFinal) {
    p.race.gateIndex++;
    io.emit('gate', { id: a.id, by: p.id, p: [r2(a.x), r2(a.y), r2(a.z)], race: true, gi: p.race.gateIndex, total });
  } else {
    p.race.finished = true;
    p.race.finishRank = ++state.race.finishCount;
    p.race.finishTime = r2(Math.max(0, ROUND_SECONDS - Math.max(0, (state.roundEndsAt - Date.now()) / 1000)));
    const pts = Math.max(RACE_FINISH_MIN, RACE_FINISH_BASE - RACE_FINISH_STEP * (p.race.finishRank - 1));
    addScore(p, pts, t);
    io.emit('gate', { id: a.id, by: p.id, p: [r2(a.x), r2(a.y), r2(a.z)], race: true, gi: total, total });
    io.emit('finish', { id: p.id, rank: p.race.finishRank, points: pts, time: p.race.finishTime, p: [r2(a.x), r2(a.y), r2(a.z)] });
    console.log(`[race] ${p.name} finished ${p.race.finishRank}${p.race.finishRank === 1 ? 'st' : p.race.finishRank === 2 ? 'nd' : p.race.finishRank === 3 ? 'rd' : 'th'} (+${pts})`);
  }
}

function stepGatesAndPickups(t) {
  const mode = state.settings.mode;
  for (const p of state.players.values()) {
    // Power-up orbs (all modes)
    const pickR = reach(p, PICKUP_RADIUS, t);
    for (const k of state.pickups) {
      if (k.alive && dist(k, p.pos) < pickR) collectPickup(k, p, t);
    }
    if (mode === 'race') {
      stepRaceGate(p, t);
    } else if (mode === 'blitz') {
      // Balloons popped by flying straight into them
      const balloonR = reach(p, 9, t);
      for (const b of state.balloons) {
        if (b.alive && dist(b, p.pos) < balloonR) popBalloon(b, p.id, t);
      }
      // Ring gates: detect crossing the gate plane inside the ring radius
      for (const a of state.layout.arches) {
        const rel = { x: p.pos.x - a.x, y: p.pos.y - a.y, z: p.pos.z - a.z };
        // Gate normal in XZ plane (arch rotated by yaw around Y; torus lies in the plane perpendicular to normal)
        const nx = Math.sin(a.yaw), nz = Math.cos(a.yaw);
        const along = rel.x * nx + rel.z * nz;
        const lateral = Math.hypot(rel.x * nz - rel.z * nx, rel.y);
        const side = along >= 0 ? 1 : -1;
        const prev = p.gateSide[a.id];
        if (prev !== undefined && prev !== side && Math.abs(along) < 30 && lateral < a.gateR + 1.5) {
          if (!(p.gateCooldown[a.id] > t)) {
            p.gateCooldown[a.id] = t + 3;
            addScore(p, 25, t);
            p.superUntil = t + SUPER_TIME * (p.perk && p.perk.superTime ? p.perk.superTime : 1);
            io.emit('gate', { id: a.id, by: p.id, p: [r2(a.x), r2(a.y), r2(a.z)] });
          }
        }
        p.gateSide[a.id] = side;
      }
    } else {
      // Crown mode: pick up a loose crown, or steal through the holder's ribbon contrail
      const c = state.crown;
      if (!c.holderId) {
        if (dist(c.pos, p.pos) < reach(p, 12, t)) giveCrown(p.id, 'pickup', null);
      } else if (c.holderId !== p.id && t >= (state.players.get(c.holderId) || {}).invulnUntil) {
        const ribbonR = reach(p, 7, t);
        for (const seg of c.ribbon) {
          if (t - seg.t < RIBBON_MIN_AGE) continue;
          if (Math.hypot(seg.x - p.pos.x, seg.y - p.pos.y, seg.z - p.pos.z) < ribbonR) {
            const prevHolder = c.holderId;
            const victim = state.players.get(prevHolder);
            if (victim) victim.tumbleUntil = t + TUMBLE_TIME * 0.5;
            giveCrown(p.id, 'ribbon', prevHolder);
            io.emit('hit', { shooter: p.id, victim: prevHolder, p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)], crownStolen: true, ribbon: true });
            break;
          }
        }
      }
    }
  }
}

function stepCrown(dt, t) {
  const c = state.crown;
  if (c.holderId) {
    const h = state.players.get(c.holderId);
    if (!h) { dropCrown(c.pos); return; }
    c.pos = { x: h.pos.x, y: h.pos.y + 5, z: h.pos.z };
    addScore(h, dt, t);
    h.stats.crownTime += dt;
    // Ribbon contrail trails behind the holder
    const back = forwardFromYP(h.yaw, h.pitch);
    c.ribbon.push({ x: h.pos.x - back.x * 4, y: h.pos.y - back.y * 4 + 0.5, z: h.pos.z - back.z * 4, t });
    if (c.ribbon.length > RIBBON_POINTS) c.ribbon.shift();
  } else {
    // Loose crown bobs gently and drifts toward the centre so it is always reachable
    c.pos.y = clamp(c.pos.y + Math.sin(t * 1.5) * 0.08, 30, 200);
    c.pos.x = lerp(c.pos.x, 0, dt * 0.05);
    c.pos.z = lerp(c.pos.z, 0, dt * 0.05);
  }
}

// ---------------------------------------------------------------------------
// AI wingman bots
// ---------------------------------------------------------------------------
function stepBot(p, dt, t) {
  const bs = p.bot;
  const mode = state.settings.mode;
  let goal = null;
  let wantFire = false;
  let wantBoost = false;

  if (t > bs.retarget) {
    bs.retarget = t + 0.6 + Math.random() * 0.8;
    bs.targetId = null;
    bs.pickupId = null;
    // Grab a nearby power-up first if there is one worth having
    let bestK = null, bestKD = 220;
    for (const k of state.pickups) {
      if (!k.alive || hasFx(p, k.type, t)) continue;
      const d = dist(k, p.pos);
      if (d < bestKD) { bestKD = d; bestK = k; }
    }
    if (bestK && Math.random() < 0.7) bs.pickupId = bestK.id;
    if (mode === 'crown') {
      const c = state.crown;
      if (c.holderId === p.id) {
        bs.targetId = 'flee';
      } else if (c.holderId) {
        bs.targetId = c.holderId;
      } else {
        bs.targetId = 'crown';
      }
    } else if (mode === 'race') {
      // Course is computed per-frame below; retargeting is only used for pickups (skipped while racing)
      bs.target = null;
      bs.targetId = 'race';
    } else {
      // Blitz: nearest balloon, or occasionally an arch for the super-charge
      let best = null, bestD = Infinity;
      const preferArch = Math.random() < 0.3;
      if (preferArch) {
        for (const a of state.layout.arches) {
          if (p.gateCooldown[a.id] > t) continue;
          const d = dist(a, p.pos);
          if (d < bestD) { bestD = d; best = { kind: 'arch', id: a.id }; }
        }
      }
      if (!best) {
        for (const b of state.balloons) {
          if (!b.alive) continue;
          const d = dist(b, p.pos);
          if (d < bestD) { bestD = d; best = { kind: 'balloon', id: b.id }; }
        }
      }
      bs.target = best;
      bs.targetId = best ? `${best.kind}:${best.id}` : null;
    }
  }

  if (mode === 'race' && !p.race.finished) {
    // Fly straight at the next course gate's ring centre (free-floating ring, no
    // stone arch to clip, so a direct seek beats the blitz line-up-then-dive orbit).
    const g = raceGateFor(p);
    if (g) {
      goal = { x: g.x, y: g.y, z: g.z };
      const gd = dist(g, p.pos);
      wantBoost = gd > 140 && p.stamina > 0.4;
    }
  } else if (mode === 'race') {
    // Finished: cruise until the round ends
    bs.wander += dt * 0.3;
    goal = { x: Math.cos(bs.wander) * 380, y: 100, z: Math.sin(bs.wander) * 380 };
  }
  const wantedPickup = bs.pickupId !== null ? state.pickups[bs.pickupId] : null;
  if (!goal && wantedPickup && wantedPickup.alive) {
    goal = { x: wantedPickup.x, y: wantedPickup.y, z: wantedPickup.z };
    wantBoost = hasFx(p, 'turbo', t);
  } else if (mode === 'crown') {
    if (bs.targetId === 'flee') {
      // Run away from the nearest pursuer, weaving around the archipelago
      let nearest = null, nd = Infinity;
      for (const o of state.players.values()) {
        if (o.id === p.id) continue;
        const d = dist(o.pos, p.pos);
        if (d < nd) { nd = d; nearest = o; }
      }
      if (nearest && nd < 260) {
        const away = vnorm(vsub(p.pos, nearest.pos));
        goal = vadd(p.pos, vscale(away, 120));
        goal.y = clamp(goal.y + Math.sin(t * 0.7) * 30, 40, 200);
        wantBoost = nd < 120 && p.stamina > 0.3;
      } else {
        bs.wander += dt * 0.35;
        goal = { x: Math.cos(bs.wander) * 420, y: 90 + Math.sin(bs.wander * 1.7) * 40, z: Math.sin(bs.wander) * 420 };
      }
    } else if (bs.targetId === 'crown') {
      goal = { ...state.crown.pos };
    } else if (bs.targetId && state.players.has(bs.targetId)) {
      const tp = state.players.get(bs.targetId);
      const lead = forwardFromYP(tp.yaw, tp.pitch);
      goal = vadd(tp.pos, vscale(lead, 18));
      const d = dist(tp.pos, p.pos);
      wantBoost = d > 160 && p.stamina > 0.4;
      const toT = vnorm(vsub(tp.pos, p.pos));
      const fwd = forwardFromYP(p.yaw, p.pitch);
      if (d < 200 && vdot(toT, fwd) > Math.cos(HOMING_CONE * 0.8)) wantFire = true;
    }
  } else if (bs.target) {
    if (bs.target.kind === 'arch') {
      const a = state.layout.arches[bs.target.id];
      const nx = Math.sin(a.yaw), nz = Math.cos(a.yaw);
      const rel = { x: p.pos.x - a.x, z: p.pos.z - a.z };
      const along = rel.x * nx + rel.z * nz;
      const side = along >= 0 ? 1 : -1;
      const d = Math.hypot(rel.x, rel.z);
      // Line up with the gate from ~90 units out before diving through it
      if (d > 50) goal = { x: a.x + nx * side * 80, y: a.y, z: a.z + nz * side * 80 };
      else goal = { x: a.x - nx * side * 60, y: a.y, z: a.z - nz * side * 60 };
    } else {
      const b = state.balloons[bs.target.id];
      if (b && b.alive) {
        goal = { x: b.x, y: b.y, z: b.z };
        const toT = vnorm(vsub(b, p.pos));
        const fwd = forwardFromYP(p.yaw, p.pitch);
        if (dist(b, p.pos) < 180 && vdot(toT, fwd) > Math.cos(HOMING_CONE * 0.7)) wantFire = true;
      } else {
        bs.retarget = 0;
      }
    }
  }
  if (!goal) {
    bs.wander += dt * 0.3;
    goal = { x: Math.cos(bs.wander) * 380, y: 100, z: Math.sin(bs.wander) * 380 };
  }

  // Obstacle avoidance: look ahead for islands and climb over them
  const fwd = forwardFromYP(p.yaw, p.pitch);
  const ahead = vadd(p.pos, vscale(fwd, 70));
  const hitAhead = islandCollision(ahead, state.layout.islands);
  if (hitAhead) {
    goal = { x: ahead.x + hitAhead.n.x * 80, y: Math.max(ahead.y + 60, hitAhead.island.cy + hitAhead.island.ry + 25), z: ahead.z + hitAhead.n.z * 80 };
  }
  if (p.pos.y < 22) goal.y = Math.max(goal.y, p.pos.y + 50);
  if (Math.hypot(p.pos.x, p.pos.z) > WORLD_RADIUS - 100 && !hitAhead) goal = { x: 0, y: 100, z: 0 };

  // Mine avoidance: steer away from any armed mine within ~60m
  for (const m of state.mines) {
    if (t < m.armAt) continue;
    const md = dist(m.p, p.pos);
    if (md < 60) {
      const away = vnorm(vsub(p.pos, m.p));
      goal = vadd(p.pos, vscale(away, 80));
      if (md < 35 && p.stamina > 0.2) wantBoost = true;
      break;
    }
  }

  const to = vnorm(vsub(goal, p.pos));
  const targetYaw = Math.atan2(-to.x, -to.z);
  const targetPitch = clamp(Math.asin(clamp(to.y, -1, 1)), -0.6, 0.6);
  const yawErr = wrapAngle(targetYaw - p.yaw);
  const joyX = clamp(-yawErr / 0.5, -1, 1);
  const joyY = clamp(-targetPitch / 0.75, -1, 1);
  p.joy = { x: joyX, y: joyY };
  p.boost = wantBoost;

  stepFlight(p, joyX, joyY, wantBoost, dt, t);

  if (wantFire) tryFire(p);
  // Occasionally barrel roll when a rocket is homing in
  if (t >= p.rollingUntil) {
    for (const r of state.rockets) {
      if (r.target === p.id && r.targetKind === 'player' && dist(r.p, p.pos) < 45 && Math.random() < 0.08) {
        p.rollingUntil = t + BARREL_ROLL_TIME * p.perk.rollTime;
        io.emit('roll', { id: p.id });
        break;
      }
    }
  }
}

/** Shared arcade flight model (the client runs the same maths for its own jet). */
function stepFlight(p, joyX, joyY, boost, dt, t) {
  const sup = t < p.superUntil;
  const burst = t < p.burstUntil;
  const turbo = hasFx(p, 'turbo', t);
  if (turbo) { boost = true; p.stamina = Math.min(1, p.stamina + dt * 0.28 * p.perk.stamRegen); }
  else if (boost && p.stamina > 0.02) p.stamina = Math.max(0, p.stamina - dt * 0.45 * (p.perk.stamDrain || 1));
  else { boost = false; p.stamina = Math.min(1, p.stamina + dt * 0.28 * p.perk.stamRegen); }
  p.boost = boost;
  const boostSpd = SPEED_BOOST * (p.perk.boostSpeed || 1);
  const target = sup ? SPEED_SUPER : turbo ? TURBO_SPEED : (boost || burst) ? boostSpd : SPEED_BASE;
  p.speed = lerp(p.speed, target, Math.min(1, dt * 3));
  p.yaw += -joyX * 2.1 * p.perk.turn * dt;
  p.yaw = wrapAngle(p.yaw);
  p.pitch = lerp(p.pitch, -joyY * 0.75, Math.min(1, dt * 6));
  p.roll = lerp(p.roll, -joyX * 1.05, Math.min(1, dt * 8));
  const fwd = forwardFromYP(p.yaw, p.pitch);
  p.pos = vadd(p.pos, vscale(fwd, p.speed * dt));
  if (p.pos.y < WATER_LEVEL + 3) { p.pitch = 0.35; p.pos.y = Math.max(p.pos.y, WATER_LEVEL + 1.5); }
  if (p.pos.y > CEILING) { p.pos.y = CEILING; p.pitch = Math.min(p.pitch, -0.1); }
  const hit = islandCollision(p.pos, state.layout.islands);
  if (hit) {
    p.pos = vadd(p.pos, vscale(hit.n, hit.push));
    const newDir = vnorm(vadd(vscale(hit.n, 0.9), vscale(fwd, 0.35)));
    p.yaw = Math.atan2(-newDir.x, -newDir.z);
    p.pitch = clamp(Math.asin(clamp(newDir.y, -1, 1)), -0.5, 0.6);
  }
  const hr = Math.hypot(p.pos.x, p.pos.z);
  if (hr > WORLD_RADIUS) {
    const inward = Math.atan2(p.pos.x, p.pos.z);
    p.yaw = lerp(p.yaw, wrapAngle(inward), Math.min(1, dt * 2));
  }
  let visualRoll = p.roll;
  if (t < p.rollingUntil) visualRoll += ((p.rollingUntil - t) / BARREL_ROLL_TIME) * Math.PI * 2;
  p.quat = quatFromYPR(p.yaw, p.pitch, visualRoll);
}

// ---------------------------------------------------------------------------
// 20Hz tick
// ---------------------------------------------------------------------------
let lastTick = now();
function snapshot(t) {
  const c = state.crown;
  return {
    t: Date.now(),
    phase: state.phase,
    mode: state.settings.mode,
    timeRemaining: r2(Math.max(0, (state.roundEndsAt - Date.now()) / 1000)),
    crownHolderId: c.holderId,
    hostId: state.hostId,
    crownPos: [r2(c.pos.x), r2(c.pos.y), r2(c.pos.z)],
    ribbon: c.ribbon.map((s) => [r2(s.x), r2(s.y), r2(s.z)]),
    players: [...state.players.values()].map((p) => ({
      id: p.id,
      p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)],
      q: [r3(p.quat.x), r3(p.quat.y), r3(p.quat.z), r3(p.quat.w)],
      spd: r2(p.speed),
      sc: Math.round(p.score),
      b: p.boost ? 1 : 0,
      su: t < p.superUntil ? r2(p.superUntil - t) : 0,
      iv: t < p.invulnUntil ? 1 : 0,
      tu: t < p.tumbleUntil ? r2(p.tumbleUntil - t) : 0,
      rl: t < p.rollingUntil ? r2(p.rollingUntil - t) : 0,
      st: r2(p.stamina),
      fx: fxSnapshot(p, t),
      ...(state.settings.mode === 'race' ? { gi: p.race.gateIndex, gp: p.race.gatesPassed, fin: p.race.finished ? p.race.finishRank : 0 } : {}),
    })),
    pickups: state.pickups.map((k) => (k.alive ? 1 : 0)),
    rockets: state.rockets.map((r) => ({ id: r.id, o: r.owner, p: [r2(r.p.x), r2(r.p.y), r2(r.p.z)], d: [r3(r.d.x), r3(r.d.y), r3(r.d.z)] })),
    mines: state.mines.map((m) => ({ id: m.id, o: m.owner, p: [r2(m.p.x), r2(m.p.y), r2(m.p.z)], arm: t >= m.armAt ? 1 : 0 })),
    decoys: state.decoys.map((d) => ({ id: d.id, o: d.owner, pilot: d.pilot, p: [r2(d.p.x), r2(d.p.y), r2(d.p.z)], q: [r3(d.quat.x), r3(d.quat.y), r3(d.quat.z), r3(d.quat.w)], spd: r2(d.speed) })),
    balloons: state.settings.mode === 'blitz' ? state.balloons.map((b) => (b.alive ? 1 : 0)) : [],
  };
}

function tick() {
  const t = now();
  const dt = Math.min(0.1, t - lastTick);
  lastTick = t;
  if (state.phase === 'playing') {
    for (const b of bots()) stepBot(b, dt, t);
    stepRockets(dt, t);
    stepMines(dt, t);
    stepDecoys(dt, t);
    stepCrown(dt, t);
    stepGatesAndPickups(t);
    stepBalloons(t);
    stepPickups(t);
    const before = state.players.size;
    purgeExpiredGone(t);
    if (state.players.size !== before) broadcastLobby();
    io.emit('snap', snapshot(t));
    if (Date.now() >= state.roundEndsAt) endRound();
  } else if (state.phase === 'ended') {
    if (Date.now() - state.endedAt > ROUND_END_SHOW_MS) returnToLobby();
  }
}
setInterval(tick, TICK_MS);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
server.listen(PORT, '0.0.0.0', () => {
  const lan = detectLanIPv4();
  console.log('========================================================');
  console.log('  SUNSET SQUADRON: CROWN CHASE');
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  LAN:     http://${lan}:${PORT}`);
  if (PUBLIC_URL) console.log(`  Public:  ${PUBLIC_URL}`);
  console.log(`  Seed:    ${state.seed}`);
  console.log(`  Board:   ${leaderboard.file}`);
  console.log('  Scan the QR code in the lobby to join from an iPad.');
  console.log('========================================================');
});

process.on('SIGINT', () => { console.log('\n[server] shutting down'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 500); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 500); });
