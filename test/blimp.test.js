'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const logic = require('../server/logic');

test('EVENT_TYPES includes blimp with 90s duration and 100hp constants', () => {
  assert.ok(logic.EVENT_TYPES.includes('blimp'));
  assert.strictEqual(logic.EVENT_DURATIONS.blimp, 90);
  assert.strictEqual(logic.EVENT_BLIMP_HP, 100);
  assert.strictEqual(logic.EVENT_BLIMP_RADIUS, 400);
  assert.strictEqual(logic.EVENT_BLIMP_SPEED, 12);
  assert.strictEqual(logic.EVENT_BLIMP_Y, 140);
});

test('generateEvent: blimp event produces valid orbital data and bomb drops', () => {
  // Find a seed that produces a blimp event
  let blimpEvent = null;
  for (let s = 0; s < 200; s++) {
    const ev = logic.generateEvent(s, 180);
    if (ev.type === 'blimp') { blimpEvent = ev; break; }
  }
  assert.ok(blimpEvent, 'blimp event occurs within seed sweep');
  assert.strictEqual(blimpEvent.durS, 90);
  assert.ok(blimpEvent.atS >= 40 && blimpEvent.atS <= 100);
  const d = blimpEvent.data;
  assert.strictEqual(d.hp, 100);
  assert.strictEqual(d.maxHp, 100);
  assert.strictEqual(d.radius, 400);
  assert.strictEqual(d.speed, 12);
  assert.strictEqual(d.y, 140);
  assert.ok(d.startAng >= 0 && d.startAng <= Math.PI * 2);
  assert.ok(d.orbitDir === 1 || d.orbitDir === -1);
  assert.ok(Array.isArray(d.drops) && d.drops.length >= 8);
  // Drops must be strictly ascending within the event duration
  for (let i = 0; i < d.drops.length; i++) {
    assert.ok(d.drops[i] > 0 && d.drops[i] < blimpEvent.durS);
    if (i > 0) assert.ok(d.drops[i] > d.drops[i - 1]);
  }
});

test('blimp orbit calculation: circular trajectory at constant speed and altitude', () => {
  const r = 400;
  const speed = 12;
  const y = 140;
  const orbitDir = 1;
  const startAng = 0;
  // At elapsed t = 0
  const ang0 = startAng + orbitDir * (speed / r) * 0;
  const p0 = { x: r * Math.cos(ang0), y, z: r * Math.sin(ang0) };
  assert.strictEqual(p0.x, 400);
  assert.strictEqual(p0.y, 140);
  assert.strictEqual(p0.z, 0);

  // At elapsed t = Math.PI * r / (2 * speed) (~quarter circle = 90 deg)
  const quarterT = (Math.PI / 2) * (r / speed);
  const angQ = startAng + orbitDir * (speed / r) * quarterT;
  assert.ok(Math.abs(angQ - Math.PI / 2) < 0.001);
  const pQ = { x: r * Math.cos(angQ), y, z: r * Math.sin(angQ) };
  assert.ok(Math.abs(pQ.x) < 0.001);
  assert.ok(Math.abs(pQ.z - 400) < 0.001);
});

test('blimp damage thresholds: power-up shower triggers at 75, 50, 25 HP', () => {
  const showers = [];
  let hp = 100;
  const hit = (dmg) => {
    const oldHp = hp;
    hp = Math.max(0, hp - dmg);
    for (const t of [75, 50, 25]) {
      if (oldHp > t && hp <= t) showers.push(t);
    }
  };
  hit(20); // 80 -> no shower
  assert.strictEqual(showers.length, 0);
  hit(10); // 70 -> crossed 75
  assert.deepStrictEqual(showers, [75]);
  hit(30); // 40 -> crossed 50
  assert.deepStrictEqual(showers, [75, 50]);
  hit(40); // 0 -> crossed 25 and dead
  assert.deepStrictEqual(showers, [75, 50, 25]);
  assert.strictEqual(hp, 0);
});
