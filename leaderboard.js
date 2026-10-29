'use strict';
/*
 * Persistent all-time leaderboard, stored as JSON at data/leaderboard.json
 * (override with LEADERBOARD_FILE). Written atomically: temp file + rename,
 * so a crash mid-write can never leave a half-written file behind.
 *
 * Entries are keyed per (player name, pilot) and per game mode.
 */
const fs = require('fs');
const path = require('path');

const MODES = ['crown', 'blitz'];

function emptyBoard() {
  return { version: 1, updatedAt: null, modes: { crown: {}, blitz: {} } };
}

function emptyEntry(name, pilot) {
  return { name, pilot, wins: 0, rounds: 0, bestScore: 0, totalPoints: 0, balloons: 0, hits: 0, lastPlayed: null };
}

class Leaderboard {
  constructor(file) {
    this.file = file || process.env.LEADERBOARD_FILE || path.join(__dirname, 'data', 'leaderboard.json');
    this.board = emptyBoard();
    this.writeQueue = Promise.resolve();
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) {
        this.board = emptyBoard();
        this.saveSync();
        console.log(`[leaderboard] created ${this.file}`);
        return;
      }
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.modes) throw new Error('unexpected shape');
      this.board = emptyBoard();
      for (const mode of MODES) {
        const src = parsed.modes[mode];
        if (src && typeof src === 'object') this.board.modes[mode] = src;
      }
      this.board.updatedAt = parsed.updatedAt || null;
      const n = MODES.reduce((s, m) => s + Object.keys(this.board.modes[m]).length, 0);
      console.log(`[leaderboard] loaded ${n} entries from ${this.file}`);
    } catch (err) {
      // A corrupt file is moved aside rather than overwritten so nothing is lost.
      console.warn(`[leaderboard] could not read ${this.file}: ${err.message} - starting fresh`);
      try {
        if (fs.existsSync(this.file)) fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      } catch (e2) {
        console.warn(`[leaderboard] could not move corrupt file aside: ${e2.message}`);
      }
      this.board = emptyBoard();
      this.saveSync();
    }
  }

  saveSync() {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.board, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /** Serialised async save; concurrent round ends never interleave writes. */
  save() {
    const snapshot = JSON.stringify(this.board, null, 2);
    this.writeQueue = this.writeQueue
      .then(async () => {
        const dir = path.dirname(this.file);
        await fs.promises.mkdir(dir, { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        await fs.promises.writeFile(tmp, snapshot);
        await fs.promises.rename(tmp, this.file);
      })
      .catch((err) => console.error(`[leaderboard] save failed: ${err.message}`));
    return this.writeQueue;
  }

  static key(name, pilot) { return `${name}::${pilot}`; }

  /**
   * Record one finished round for a list of human players.
   * results: [{ name, pilot, score, points, balloons, hits, won }]
   * Returns a map name::pilot -> array of personal-best labels achieved this round.
   */
  recordRound(mode, results) {
    if (!MODES.includes(mode)) return {};
    const table = this.board.modes[mode];
    const bests = {};
    const stamp = new Date().toISOString();
    for (const r of results) {
      const key = Leaderboard.key(r.name, r.pilot);
      const prev = table[key] || emptyEntry(r.name, r.pilot);
      const achieved = [];
      const score = Math.max(0, Math.round(r.score || 0));
      if (prev.rounds === 0) achieved.push('First round on the board');
      if (score > prev.bestScore && prev.rounds > 0) achieved.push(`New best score (${score}, was ${prev.bestScore})`);
      if (r.won && prev.wins === 0) achieved.push('First win!');
      const entry = {
        ...prev,
        name: r.name,
        pilot: r.pilot,
        wins: prev.wins + (r.won ? 1 : 0),
        rounds: prev.rounds + 1,
        bestScore: Math.max(prev.bestScore, score),
        totalPoints: Math.round((prev.totalPoints + (r.points || 0)) * 10) / 10,
        balloons: prev.balloons + (r.balloons || 0),
        hits: prev.hits + (r.hits || 0),
        lastPlayed: stamp,
      };
      table[key] = entry;
      bests[key] = achieved;
    }
    this.board.updatedAt = stamp;
    this.save();
    return bests;
  }

  /** Top N entries for a mode, sorted by wins, then best score, then total points. */
  top(mode, n = 10) {
    const table = this.board.modes[mode] || {};
    return Object.values(table)
      .sort((a, b) => b.wins - a.wins || b.bestScore - a.bestScore || b.totalPoints - a.totalPoints || a.name.localeCompare(b.name))
      .slice(0, n)
      .map((e, i) => ({ rank: i + 1, ...e }));
  }

  summary(n = 10) {
    return {
      updatedAt: this.board.updatedAt,
      file: path.basename(this.file),
      modes: { crown: this.top('crown', n), blitz: this.top('blitz', n) },
      totals: { crown: Object.keys(this.board.modes.crown).length, blitz: Object.keys(this.board.modes.blitz).length },
    };
  }
}

module.exports = { Leaderboard };
