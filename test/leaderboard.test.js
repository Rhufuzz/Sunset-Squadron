'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Leaderboard } = require('../leaderboard');

function tmpBoard() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-board-'));
  return { dir, file: path.join(dir, 'leaderboard.json') };
}

function row(name, over = {}) {
  return { name, pilot: 'renji', score: 10, points: 10, balloons: 0, hits: 0, won: false, ...over };
}

test('constructor creates the file and an empty board shape', () => {
  const { file } = tmpBoard();
  const lb = new Leaderboard(file);
  assert.ok(fs.existsSync(file));
  assert.deepStrictEqual(lb.board.modes, { crown: {}, blitz: {}, race: {}, teams: {} });
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(onDisk.version, 1);
  assert.ok(onDisk.modes);
});

test('recordRound updates wins/rounds/bestScore/totalPoints/balloons/hits', async () => {
  const { file } = tmpBoard();
  const lb = new Leaderboard(file);
  let bests = lb.recordRound('crown', [row('Ace', { score: 50, points: 7, balloons: 3, hits: 2, won: true })]);
  assert.deepStrictEqual(bests['Ace::renji'], ['First round on the board', 'First win!']);
  bests = lb.recordRound('crown', [row('Ace', { score: 30, points: 4, balloons: 1, hits: 5 })]);
  assert.deepStrictEqual(bests['Ace::renji'], []);
  bests = lb.recordRound('crown', [row('Ace', { score: 80, points: 2, balloons: 0, hits: 1 })]);
  assert.deepStrictEqual(bests['Ace::renji'], ['New best score (80, was 50)']);
  await lb.save();
  const e = lb.board.modes.crown['Ace::renji'];
  assert.strictEqual(e.wins, 1);
  assert.strictEqual(e.rounds, 3);
  assert.strictEqual(e.bestScore, 80);
  assert.strictEqual(e.totalPoints, 13);   // 7 + 4 + 2
  assert.strictEqual(e.balloons, 4);
  assert.strictEqual(e.hits, 8);
  assert.ok(e.lastPlayed);
  // Second win does not re-award the first-win badge.
  bests = lb.recordRound('crown', [row('Ace', { score: 90, won: true })]);
  assert.deepStrictEqual(bests['Ace::renji'], ['New best score (90, was 80)']);
  await lb.save();
  assert.strictEqual(lb.board.modes.crown['Ace::renji'].wins, 2);
  assert.strictEqual(lb.board.modes.crown['Ace::renji'].rounds, 4);
});

test('recordRound: scores are clamped to >= 0 and rounded', async () => {
  const { file } = tmpBoard();
  const lb = new Leaderboard(file);
  lb.recordRound('blitz', [row('Bex', { score: -7.6 })]);
  await lb.save();
  assert.strictEqual(lb.board.modes.blitz['Bex::renji'].bestScore, 0);
  lb.recordRound('blitz', [row('Bex', { score: 12.4 })]);
  await lb.save();
  assert.strictEqual(lb.board.modes.blitz['Bex::renji'].bestScore, 12);
});

test('recordRound: unknown mode is a no-op returning no bests', () => {
  const { file } = tmpBoard();
  const lb = new Leaderboard(file);
  const bests = lb.recordRound('nonsense', [row('Cid')]);
  assert.deepStrictEqual(bests, {});
  assert.deepStrictEqual(lb.board.modes.crown, {});
});

test('per-(player, pilot) keying and mode isolation', async () => {
  const { file } = tmpBoard();
  const lb = new Leaderboard(file);
  lb.recordRound('crown', [row('Dee', { pilot: 'renji', score: 10 }), row('Dee', { pilot: 'resa', score: 20 })]);
  lb.recordRound('race', [row('Dee', { pilot: 'renji', score: 30 })]);
  await lb.save();
  assert.strictEqual(lb.board.modes.crown['Dee::renji'].bestScore, 10);
  assert.strictEqual(lb.board.modes.crown['Dee::resa'].bestScore, 20);
  assert.strictEqual(lb.board.modes.race['Dee::renji'].bestScore, 30);
  assert.strictEqual(Object.keys(lb.board.modes.blitz).length, 0);
});

test('persistence: a new instance over the same file reloads recorded entries', async () => {
  const { file } = tmpBoard();
  const first = new Leaderboard(file);
  first.recordRound('crown', [row('Eve', { score: 42, won: true, balloons: 2, hits: 3 })]);
  await first.save();
  const second = new Leaderboard(file);
  const e = second.board.modes.crown['Eve::renji'];
  assert.ok(e, 'entry reloaded from disk');
  assert.strictEqual(e.wins, 1);
  assert.strictEqual(e.bestScore, 42);
  assert.strictEqual(e.balloons, 2);
  assert.strictEqual(e.hits, 3);
  // Leaderboard file survives with no stray temp files left behind (atomic write).
  const leftovers = fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'));
  assert.deepStrictEqual(leftovers, []);
});

test('top() ranks by wins, then best score, then total points', async () => {
  const { file } = tmpBoard();
  const lb = new Leaderboard(file);
  lb.recordRound('crown', [
    row('Fay', { score: 10, won: true }),
    row('Gus', { score: 99 }),
    row('Hal', { score: 50, points: 100 }),
  ]);
  lb.recordRound('crown', [row('Fay', { score: 5 })]);
  await lb.save();
  const top = lb.top('crown');
  assert.deepStrictEqual(top.map((e) => e.name), ['Fay', 'Gus', 'Hal']);
  assert.strictEqual(top[0].rank, 1);
  const summary = lb.summary();
  assert.strictEqual(summary.totals.crown, 3);
  assert.strictEqual(summary.modes.crown.length, 3);
  assert.strictEqual(summary.file, path.basename(file));
});

test('corrupt file is moved aside and replaced with a fresh board', () => {
  const { file } = tmpBoard();
  fs.writeFileSync(file, '{ this is not json');
  const lb = new Leaderboard(file);
  assert.deepStrictEqual(lb.board.modes, { crown: {}, blitz: {}, race: {}, teams: {} });
  assert.ok(fs.existsSync(file), 'fresh board written');
  const aside = fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.corrupt-'));
  assert.strictEqual(aside.length, 1);
});

test('concurrent recordRound calls serialise their writes without losing data', async () => {
  const { file } = tmpBoard();
  const lb = new Leaderboard(file);
  for (let i = 0; i < 10; i++) {
    lb.recordRound('race', [row(`Pilot${i}`, { score: i * 10 })]);
  }
  await lb.save();
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(Object.keys(onDisk.modes.race).length, 10);
});
