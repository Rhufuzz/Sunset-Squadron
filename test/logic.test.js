'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const logic = require('../server/logic');

test('mulberry32 is deterministic per seed', () => {
  const a = logic.mulberry32(12345);
  const b = logic.mulberry32(12345);
  const seqA = [a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b()];
  assert.deepStrictEqual(seqA, seqB);
  for (const v of seqA) {
    assert.ok(v >= 0 && v < 1, `value in [0,1): ${v}`);
  }
  const c = logic.mulberry32(999);
  assert.notDeepStrictEqual([c(), c()], seqA.slice(0, 2));
});

test('generateWeather: same seed -> identical output, valid shape', () => {
  for (const seed of [0, 1, 42, 123456789, 0x7fffffff]) {
    const w1 = logic.generateWeather(seed);
    const w2 = logic.generateWeather(seed);
    assert.deepStrictEqual(w1, w2);
    assert.ok(logic.WEATHER_TYPES.includes(w1.type), `type ${w1.type} is known`);
    assert.strictEqual(w1.label, logic.WEATHER_LABELS[w1.type]);
    assert.strictEqual(w1.wind.y, 0);
    if (w1.type === 'clear') {
      assert.strictEqual(w1.speed, 0);
      assert.deepStrictEqual(w1.wind, { x: 0, y: 0, z: 0 });
    } else {
      assert.strictEqual(w1.speed, w1.type === 'breeze' ? 1.8 : 3.6);
      assert.ok(Math.abs(w1.wind.x) <= w1.speed && Math.abs(w1.wind.z) <= w1.speed);
    }
  }
});

test('generateWeather: different seeds produce varied weather over a sweep', () => {
  const types = new Set();
  for (let seed = 0; seed < 200; seed++) types.add(logic.generateWeather(seed).type);
  assert.deepStrictEqual([...types].sort(), [...logic.WEATHER_TYPES].sort());
});

test('generateEvent: same seed -> identical type, timing and data over 100 seeds', () => {
  for (let seed = 0; seed < 100; seed++) {
    const a = logic.generateEvent(seed, 180);
    const b = logic.generateEvent(seed, 180);
    assert.deepStrictEqual(a, b, `seed ${seed} must be deterministic`);
  }
});

test('generateEvent: valid types only, timing inside the round, sane data shape', () => {
  for (let seed = 0; seed < 100; seed++) {
    const e = logic.generateEvent(seed * 7919, 180);
    assert.ok(logic.EVENT_TYPES.includes(e.type), `type ${e.type} is known`);
    assert.ok(e.atS > 0 && e.atS < 180, `start ${e.atS} within the round`);
    assert.ok(e.durS > 0 && e.atS + e.durS <= 180, `dur ${e.durS} fits after start`);
    if (e.type === 'balloonRush') {
      assert.strictEqual(e.data.hp, logic.EVENT_BALLOON_HP);
      assert.ok(e.data.pos.y >= 95 && e.data.pos.y <= 150);
      assert.ok(Math.hypot(e.data.pos.x, e.data.pos.z) < 120, 'balloon hovers over the central island');
    } else if (e.type === 'meteorShower') {
      assert.strictEqual(e.data.count, 18);
      assert.ok(e.data.interval >= 0.5);
      assert.strictEqual(e.data.meteors.length, 18);
      for (const m of e.data.meteors) {
        assert.ok(m.y > 300 && m.y < 420, `meteor starts above CEILING (y=${m.y})`);
        const vlen = Math.hypot(m.vx, m.vy, m.vz);
        assert.ok(Math.abs(vlen - 25) < 0.01, `velocity ~25 u/s (got ${vlen})`);
        assert.ok(m.vy < 0, 'meteors fall toward the ground');
      }
    } else if (e.type === 'blimp') {
      assert.strictEqual(e.data.hp, logic.EVENT_BLIMP_HP);
      assert.strictEqual(e.data.maxHp, logic.EVENT_BLIMP_HP);
      assert.strictEqual(e.data.radius, logic.EVENT_BLIMP_RADIUS);
      assert.strictEqual(e.data.speed, logic.EVENT_BLIMP_SPEED);
      assert.strictEqual(e.data.y, logic.EVENT_BLIMP_Y);
      assert.ok(e.data.startAng >= 0 && e.data.startAng <= Math.PI * 2);
      assert.ok(e.data.orbitDir === 1 || e.data.orbitDir === -1);
      assert.ok(Array.isArray(e.data.drops) && e.data.drops.length > 0);
    } else {
      assert.strictEqual(e.data.mult, 2);
    }
  }
});

test('generateEvent: short (test) rounds clamp start and duration inside the round', () => {
  for (const rl of [25, 30, 45]) {
    for (let seed = 0; seed < 20; seed++) {
      const e = logic.generateEvent(seed, rl);
      assert.ok(e.atS > 0 && e.atS < rl);
      assert.ok(e.atS + e.durS <= rl);
    }
  }
});

test('generateEvent: all four event types occur over a seed sweep', () => {
  const types = new Set();
  for (let seed = 0; seed < 400; seed++) types.add(logic.generateEvent(seed, 180).type);
  assert.deepStrictEqual([...types].sort(), [...logic.EVENT_TYPES].sort());
});

test('vector helpers: clamp, lerp, wrapAngle, rounding', () => {
  assert.strictEqual(logic.clamp(5, 0, 3), 3);
  assert.strictEqual(logic.clamp(-5, 0, 3), 0);
  assert.strictEqual(logic.clamp(2, 0, 3), 2);
  assert.strictEqual(logic.lerp(10, 20, 0.25), 12.5);
  assert.strictEqual(logic.wrapAngle(Math.PI * 3), Math.PI);
  assert.strictEqual(logic.wrapAngle(-Math.PI * 3), -Math.PI);
  assert.ok(Math.abs(logic.wrapAngle(-Math.PI * 3 - 0.1) - (Math.PI - 0.1)) < 1e-12);
  assert.ok(Math.abs(logic.wrapAngle(0.1)) === 0.1);
  assert.strictEqual(logic.r2(1.005), 1);   // binary float: 1.005 -> 1.00499...
  assert.strictEqual(logic.r2(1.236), 1.24);
  assert.strictEqual(logic.r3(2.34567), 2.346);
});

test('vnorm of zero vector does not produce NaN', () => {
  const n = logic.vnorm({ x: 0, y: 0, z: 0 });
  assert.deepStrictEqual(n, { x: 0, y: 0, z: 0 });
  const u = logic.vnorm({ x: 3, y: 4, z: 0 });
  assert.strictEqual(logic.vlen(u), 1);
  assert.strictEqual(logic.dist({ x: 1, y: 2, z: 3 }, { x: 4, y: 6, z: 3 }), 5);
});

test('quatFromYPR: identity and 90-degree yaw', () => {
  assert.deepStrictEqual(logic.quatFromYPR(0, 0, 0), { x: 0, y: 0, z: 0, w: 1 });
  const q = logic.quatFromYPR(Math.PI / 2, 0, 0);
  const s = Math.SQRT1_2;
  assert.ok(Math.abs(q.y - s) < 1e-12 && Math.abs(q.w - s) < 1e-12);
  assert.strictEqual(q.x, 0);
  assert.strictEqual(q.z, 0);
});

test('islandCollision: inside returns push outward, outside returns null', () => {
  const isl = { cx: 0, cy: 0, cz: 0, rx: 100, ry: 50 };
  // At the exact centre the normal is degenerate but push must be positive.
  const centre = logic.islandCollision({ x: 0, y: 0, z: 0 }, [isl]);
  assert.ok(centre);
  assert.ok(centre.push > 0);
  assert.strictEqual(centre.island, isl);
  // Along +x, just inside the surface: normal points outward (+x).
  const inside = logic.islandCollision({ x: 50, y: 0, z: 0 }, [isl]);
  assert.ok(inside);
  assert.ok(inside.n.x > 0.99);
  assert.strictEqual(logic.islandCollision({ x: 150, y: 0, z: 0 }, [isl]), null);
  assert.strictEqual(logic.islandCollision({ x: 0, y: 200, z: 0 }, [isl]), null);
  assert.strictEqual(logic.islandCollision({ x: 50, y: 0, z: 0 }, []), null);
});

test('homingAngle: dead ahead / perpendicular / behind', () => {
  const fwd = logic.forwardFromYP(0, 0); // -z
  const from = { x: 0, y: 0, z: 0 };
  assert.ok(Math.abs(logic.homingAngle(fwd, from, { x: 0, y: 0, z: -10 })) < 1e-12);
  assert.ok(Math.abs(logic.homingAngle(fwd, from, { x: 10, y: 0, z: 0 }) - Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(logic.homingAngle(fwd, from, { x: 0, y: 0, z: 10 }) - Math.PI) < 1e-12);
});

test('raceFinishPoints: 100 / -15 per rank / floor 25', () => {
  assert.strictEqual(logic.raceFinishPoints(1), 100);
  assert.strictEqual(logic.raceFinishPoints(2), 85);
  assert.strictEqual(logic.raceFinishPoints(5), 40);
  assert.strictEqual(logic.raceFinishPoints(6), 25);  // 100 - 15*5 = 25, exactly the floor
  assert.strictEqual(logic.raceFinishPoints(7), 25);  // 10 -> clamped to 25
  assert.strictEqual(logic.raceFinishPoints(50), logic.RACE_FINISH_MIN);
});

function gate(yaw, gateR = 10) {
  return { id: 0, x: 0, y: 100, z: 0, yaw, gateR };
}

test('gateCrossing: true only for opposite-side crossing near the plane inside the ring', () => {
  const g = gate(0); // normal (sin 0, cos 0) = (0, 0, 1) in xz
  // First frame on -z side (side -1), then +z side (side 1): crossing.
  const first = logic.gateCrossing(g, { x: 0, y: 100, z: -5 }, undefined);
  assert.strictEqual(first.side, -1);
  assert.strictEqual(first.crossed, false);
  const second = logic.gateCrossing(g, { x: 0, y: 100, z: 5 }, first.side);
  assert.strictEqual(second.side, 1);
  assert.strictEqual(second.crossed, true);
  // Same side twice: no crossing.
  assert.strictEqual(logic.gateCrossing(g, { x: 0, y: 100, z: 8 }, 1).crossed, false);
  // Opposite side but first sighting (prev undefined): no crossing.
  assert.strictEqual(logic.gateCrossing(g, { x: 0, y: 100, z: 5 }, undefined).crossed, false);
  // Opposite side but far from the plane (|along| >= 30): no crossing.
  assert.strictEqual(logic.gateCrossing(g, { x: 0, y: 100, z: 40 }, -1).crossed, false);
  // Opposite side, near plane, but outside the ring (lateral >= gateR + 1.5): no crossing.
  assert.strictEqual(logic.gateCrossing(g, { x: 0, y: 112, z: 5 }, -1).crossed, false);
  // Lateral offset inside ring width (gateR + 1.5 = 11.5): crossing.
  assert.strictEqual(logic.gateCrossing(g, { x: 11, y: 100, z: 5 }, -1).crossed, true);
  // Rotated gate (yaw = pi/2 -> normal (1, 0, 0)): crossing along +x.
  const g2 = gate(Math.PI / 2);
  const c2 = logic.gateCrossing(g2, { x: 5, y: 100, z: 0 }, -1);
  assert.strictEqual(c2.side, 1);
  assert.strictEqual(c2.crossed, true);
});

function res(over = {}) {
  return {
    score: 0,
    race: { finished: false, finishRank: 0, finishTime: 0, gatesPassed: 0, ...over.race },
    ...over,
  };
}

test('compareRaceResults: finishers by rank, then time; rest by gates then score', () => {
  const finished1 = res({ race: { finished: true, finishRank: 1, finishTime: 90.5, gatesPassed: 10 } });
  const finished2 = res({ race: { finished: true, finishRank: 2, finishTime: 95.0, gatesPassed: 10 } });
  const finished2b = res({ race: { finished: true, finishRank: 2, finishTime: 94.0, gatesPassed: 10 } });
  const dnf9gates = res({ score: 30, race: { gatesPassed: 9 } });
  const dnf3gates = res({ score: 200, race: { gatesPassed: 3 } });
  const dnf3gatesLow = res({ score: 10, race: { gatesPassed: 3 } });
  const sorted = [dnf3gates, finished2, dnf9gates, finished1, dnf3gatesLow, finished2b]
    .sort(logic.compareRaceResults);
  assert.deepStrictEqual(sorted, [finished1, finished2b, finished2, dnf9gates, dnf3gates, dnf3gatesLow]);
});

test('perkMultipliers: every pilot maps to a defined perk with correct multipliers', () => {
  const PILOT_DATA = require('../shared/pilots');
  assert.strictEqual(PILOT_DATA.PILOTS.length, 12);
  assert.strictEqual(PILOT_DATA.PILOT_IDS.length, 12);
  for (const pilot of PILOT_DATA.PILOTS) {
    assert.ok(PILOT_DATA.PERKS[pilot.perk], `pilot ${pilot.id} perk ${pilot.perk} exists`);
    const m = PILOT_DATA.perkMultipliers(pilot.id);
    const expected = { ...PILOT_DATA.PERK_DEFAULTS };
    for (const [k, v] of Object.entries(PILOT_DATA.PERKS[pilot.perk])) {
      if (typeof v === 'number') expected[k] = v;   // label/desc are not multipliers
    }
    assert.deepStrictEqual(m, expected);
  }
  // Spot-check specific pilots against their perk descriptions.
  assert.strictEqual(PILOT_DATA.perkMultipliers('renji').stamRegen, 1.3);
  assert.strictEqual(PILOT_DATA.perkMultipliers('kaya').turn, 1.15);
  assert.strictEqual(PILOT_DATA.perkMultipliers('viper').reload, 0.85);
  assert.strictEqual(PILOT_DATA.perkMultipliers('comet').tumble, 0.5);
  assert.strictEqual(PILOT_DATA.perkMultipliers('vortex').homingTurn, 1.3);
  assert.strictEqual(PILOT_DATA.perkMultipliers('stride').boostSpeed, 1.15);
  // Unknown pilot falls back to the first pilot's perk.
  assert.deepStrictEqual(PILOT_DATA.perkMultipliers('nobody'), PILOT_DATA.perkMultipliers(PILOT_DATA.PILOTS[0].id));
  assert.strictEqual(PILOT_DATA.pilotById('nobody'), PILOT_DATA.PILOTS[0]);
});

test('shared/pilots toEsModuleSource renders importable browser module', () => {
  const PILOT_DATA = require('../shared/pilots');
  const src = PILOT_DATA.toEsModuleSource();
  assert.ok(src.startsWith('// Generated by the server'));
  assert.ok(src.includes('export const PILOTS'));
  const tmp = path.join(require('node:os').tmpdir(), `pilots-esm-${process.pid}.mjs`);
  require('node:fs').writeFileSync(tmp, src);
  return import(tmp).then((mod) => {
    assert.strictEqual(mod.PILOTS.length, 12);
    assert.strictEqual(typeof mod.perkMultipliers, 'function');
  });
});
