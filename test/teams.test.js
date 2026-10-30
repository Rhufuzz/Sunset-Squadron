'use strict';
// Red vs Blue team mode: leaderboard wiring + pure team-math the server shares
// with the round loop (balance rule, team totals). The socket-level behaviour
// (team assignment on join, friendly-fire-off rockets) is covered by the
// controller's scripted integration check, not here.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Leaderboard } = require('../leaderboard');

function tmpBoard() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-teams-'));
  return { dir, file: path.join(dir, 'leaderboard.json') };
}

function row(name, over = {}) {
  return { name, pilot: 'kaya', score: 10, points: 10, balloons: 0, hits: 0, won: false, ...over };
}

test('teams is a first-class leaderboard mode (record, wins by team, summary)', async () => {
  const { file } = tmpBoard();
  const lb = new Leaderboard(file);
  // Red wins the team battle: everyone on red gets the win badge, not the top scorer
  let bests = lb.recordRound('teams', [
    row('Red1', { score: 30, points: 30, hits: 3, won: true }),
    row('Red2', { score: 12, points: 12, hits: 1, won: true }),
    row('Blu1', { score: 45, points: 45, hits: 4, won: false }),   // top individual, losing team
  ]);
  assert.deepStrictEqual(bests['Red1::kaya'], ['First round on the board', 'First win!']);
  assert.deepStrictEqual(bests['Blu1::kaya'], ['First round on the board']);
  await lb.save();
  assert.strictEqual(lb.board.modes.teams['Red1::kaya'].wins, 1);
  assert.strictEqual(lb.board.modes.teams['Blu1::kaya'].wins, 0);
  assert.strictEqual(lb.board.modes.teams['Blu1::kaya'].bestScore, 45);
  const summary = lb.summary(10);
  assert.ok(Array.isArray(summary.modes.teams));
  assert.strictEqual(summary.totals.teams, 3);
  assert.strictEqual(summary.modes.teams[0].name, 'Red1');   // win sorts above best score
});

test('teams rows count toward team totals without touching other modes', async () => {
  const { file } = tmpBoard();
  const lb = new Leaderboard(file);
  lb.recordRound('teams', [row('Solo', { score: 20, points: 20, won: true })]);
  lb.recordRound('crown', [row('Solo', { score: 5, points: 3 })]);
  await lb.save();
  assert.strictEqual(Object.keys(lb.board.modes.teams).length, 1);
  assert.strictEqual(Object.keys(lb.board.modes.crown).length, 1);
  assert.strictEqual(lb.board.modes.teams['Solo::kaya'].rounds, 1);
  assert.strictEqual(lb.board.modes.crown['Solo::kaya'].rounds, 1);
  // Reload round-trips the teams table
  const lb2 = new Leaderboard(file);
  assert.strictEqual(lb2.board.modes.teams['Solo::kaya'].bestScore, 20);
});

test('team balance rule: smaller team wins the tie, red alternates first', () => {
  // Mirrors the server's assignTeam() greedy rule (red <= blue -> red).
  const teams = [];
  const assign = () => {
    const red = teams.filter((t) => t === 'red').length;
    const blue = teams.filter((t) => t === 'blue').length;
    teams.push(red <= blue ? 'red' : 'blue');
  };
  for (let i = 0; i < 8; i++) assign();
  assert.deepStrictEqual(teams, ['red', 'blue', 'red', 'blue', 'red', 'blue', 'red', 'blue']);
  assert.strictEqual(teams.filter((t) => t === 'red').length, 4);
  assert.strictEqual(teams.filter((t) => t === 'blue').length, 4);
});

test('team totals: summed per-side score decides the winner (draw on equality)', () => {
  // Mirrors the server's endRound winnerTeam rule.
  const winnerTeam = ({ red, blue }) => (red > blue ? 'red' : blue > red ? 'blue' : null);
  assert.strictEqual(winnerTeam({ red: 30, blue: 21 }), 'red');
  assert.strictEqual(winnerTeam({ red: 10, blue: 11 }), 'blue');
  assert.strictEqual(winnerTeam({ red: 15, blue: 15 }), null);
});
