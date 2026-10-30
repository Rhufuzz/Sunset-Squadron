# Changelog

All notable changes to **Sunset Squadron: Crown Chase**.
Versions follow [semver](https://semver.org/): MAJOR.MINOR.PATCH.

## [1.8.0] — 2026-10-30

### Added
- **Red vs Blue team mode** (fourth mode in the lobby picker): pilots are auto-assigned
  to balanced teams at round start and spawn clustered on their team's side; name tags,
  jets and contrails tint red (#ff5e5b) / blue (#6ba8ff).
- **Team Crown Relay:** two crowns in play, one per team, granted to each team's first
  pilot (3 s burst + invulnerability). Only the ENEMY team can steal a held crown — via
  rocket, mine, or slicing the holder's ribbon; a loose crown drifts home and can be
  recovered (or stolen) by anyone. Crown seconds tick +1/s for whoever holds it.
  Friendly fire is OFF in team mode (rockets/mines/style credit skip teammates), and
  hitting an enemy awards +10.
- **Team scoreboard:** mini-board shows live 🔴/🔵 totals on top; round-end payload
  carries `teams: {red, blue}` + `winnerTeam`; leaderboard tracks the new `teams` mode
  (wins by team membership). Bots hunt the enemy crown holder 50 % of the time.
- Wire additions: roundStart/snapshot `crowns: {red:{h,pos}, blue:{h,pos}}`, player
  `team`/`tm` fields, `crown` events with `team`, round-end `teamTotals`.
- 4 new unit tests (30 total).

## [1.7.0] — 2026-10-30

### Added
- **Style scoring** (all modes, Frenzy doubles it via `awardPoints()`):
  **CLOSE CALL** +10 (enemy rocket slips within 8 m without connecting — once per
  rocket, 2 s per-jet throttle), **LOW RIDER** +15 (≥ 3 s sustained flight under
  15 m over water, re-awardable every 10 s), **GATE WEAVE** +25 (barrel roll while
  crossing a race gate or blitz arch). Broadcast as `style {kind, points, id}`;
  HUD stunt ticker (last 4, fading) + procedural stings (whoosh / surf glide / crowd chant).
- **Emotes with pilot chatter:** 5-button emoji bar above the touch controls
  (keys 1–4 on desktop), whitelisted server-side (12 emoji), rate-limited to
  1 per 5 s per pilot (silent drop). Floating emoji sprite over the jet for 3 s +
  Animal-Crossing-style procedural gibberish voiced per pilot (pitch base shifts
  by pilot). Bots emote on crown steals and hits (10 %, rate-limited).

## [1.6.0] — 2026-10-30

### Added
- **Mid-round events engine** — every round now has one seeded surprise at the ⅓ mark
  (deterministic per seed via new pure `generateEvent()` in `server/logic.js`; all modes;
  one per round). Broadcast as an `event` payload, carried compactly in snapshots as
  `ev:{t,e}`, HUD pill shows name + countdown, distinct procedural jingle per event.
  - **🎈 Golden Balloon Rush** (60 s): a 3× gold balloon (6 rocket hits / high-speed ram)
    drops +50 and a 10 s Score×2 on the popper; live HP micro-bar via `eventProgress`.
  - **☄️ Meteor Shower** (45 s): 18 seeded meteors fall (tumble on hit, shields absorb);
    +5 for every near-miss within 25 m (throttled 1/s per jet) — dodging scores.
  - **⚡ Frenzy** (60 s): all points ×2 through the new server-wide `awardPoints()`
    wrapper, pickup respawns halved, boost stamina unlimited.
- 4 new unit tests for the event planner (26 total): determinism over 100 seeds, type
  validity, timing clamps on short rounds, type sweep.

## [1.5.0] — 2026-10-29

### Added
- **Unit test suite** (`node:test`, zero new dependencies): 22 tests over
  `test/logic.test.js` (weather determinism over 200 seeds, PRNG, vector/quat math,
  island collision, homing angles, gate plane-crossing edge cases, race finish
  scoring, race result ordering, all 12 pilot perk multipliers, ESM export rendering)
  and `test/leaderboard.test.js` (stat updates, persistence reload, atomic writes,
  corrupt-file quarantine, concurrent write serialization). Pure logic extracted
  verbatim to `server/logic.js`; behavior-preserving (verified by live smoke round).
- **CI:** GitHub Actions workflow (`.github/workflows/ci.yml`) running `npm ci`,
  `npm run check` and `npm test` on Node 20 + 22 for every push/PR.
- **Bandwidth measurement:** snapshots at full 8-player occupancy average ~2 KB
  (~40 KB/s per client, ~0.32 MB/s server-side at 20 Hz) — within budget, no
  protocol changes needed.

### Changed
- `npm run check` now also syntax-checks `server/logic.js` and `leaderboard.js`.
- README updated for v1.3–v1.5 content (race mode, 12 pilots, 8 power-ups, weather,
  reconnect/host migration) with a CI badge.

## [1.4.0] — 2026-10-29

### Added
- **4 new pilots (roster 8 → 12):** ORION (Deep Tanks — boost drains 25 % slower),
  VORTEX (Gyro Lock — rockets steer 30 % sharper), SOLAR (Arc Surge — Super-Charge
  lasts 35 % longer), STRIDE (Afterburner — boost speed +15 %). All single-stat
  perks ±15–35 %, wired server- and client-side; compact 2×6 lobby grid.
- **Sky Mine power-up:** dropped 10 m behind your jet, arms after 1 s, explodes on
  enemy proximity (< 14 m) with the rocket hit effect (tumble / shield break / crown
  steal credit), despawns after 25 s. Spiked 3D orb with red arming pulse. Bots
  avoid armed mines within ~60 m. Events: `mineDrop`, snapshot `mines[]`.
- **Decoy Flare power-up:** mirror jet flying straight for 6 s that attracts homing
  rockets (existing homing retargets to a closer decoy); one hit destroys it.
  Events: `decoySpawn` / `decoyHit`, snapshot `decoys[]`.
- **Per-round weather:** seeded generator picks clear / breeze / gusty each round;
  wind drift applies server-side to all jets (≤ 8 % of base speed) and client-side
  (rain streak particles in gusty); `#hud-weather` pill shows `☀️/💨/🌧️` + label.
  Included in `roundStart` as `{ type, speed, wind{x,y,z}, label }`.
- **Bot AI:** lead-target aiming (intercept solution on relative velocity), crown
  holders evade (lateral weaving + boost away from threats < 200 m), and pursuers
  sometimes slice the holder's ribbon contrail directly (35 % chance, fire inhibited).

## [1.3.0] — 2026-10-29

### Added
- **Third game mode — Checkpoint Race:** a seeded 10-gate course (open loop, 125–245 m
  spacing, altitude 40–175 m, gates aligned to travel direction). Your next gate glows
  gold, the following one cyan; a guide arrow points at it; HUD shows `🏁 GATE n/10`.
  Scoring is finish-order based: 1st = 100 pts, −15 per rank, min 25. Mid-round
  finish banner + particles. Rockets are disabled in race mode (barrel rolls still work).
  Bots fly the full course. Snapshot carries per-player `gi/gp/fin`; the course ships
  once in `roundStart` (low bandwidth). Leaderboard gains a `race` mode.
- **Mid-round reconnect:** each client keeps a stable `clientId` in `localStorage`;
  a dropped player who rejoins within 60 s (`DISCONNECT_GRACE_S`) restores their pilot,
  name, score/stats and race progress at a safe spawn (short spawn invulnerability).
  Stale gone-players are cleaned up on round start / lobby return.
- **Host migration:** the host is the earliest-joined connected human; when they leave,
  the next-oldest player is promoted (broadcast `hostChange` + `hostId` in lobby/snap
  payloads), and host controls (START ROUND, mode/preset/bots) move with them.
- **Host visibility in the lobby:** the host's roster card carries a bordered
  `👑 HOST` badge, the host's button reads `START ROUND — YOU ARE THE HOST`, and every
  other player sees `⏳ Waiting for HOST <name> to start the round…` (who the host is
  was previously invisible to guests — the top support complaint).

## [1.2.0] — 2026-10-29

### Added
- **Self-hosted Three.js** served at `/vendor/three` from the pinned `three@0.164.1`
  dependency — the importmap no longer points at jsDelivr, so the game now truly runs
  with zero internet on players' devices (verified with the CDN blocked). Removes the
  README's "clients need internet" caveat.
- **Client error logging:** an early `window.onerror` / `unhandledrejection` trap in
  `index.html` reports failures to the new `POST /api/client-log` (sendBeacon with
  fetch fallback). Last 200 entries kept in memory, `GET /api/client-log` to read them;
  each entry records message, source, line/col, stack, user-agent and IP. Device-side
  failures (e.g. an iPad that dies silently) now leave a server-side trace.
- **systemd deployment unit** (`deploy/sunset-squadron.service`) — enabled with
  `Restart=always`, the server survives crashes and reboots (verified with kill -9).

### Fixed
- Server no longer dies when the starting shell session ends (systemd owns the process).

## [1.1.0] — 2026-10-29

### Added
- **8 pilot characters** (RENJI, RESA, KAYA, VIPER, NOVA, BLAZE, COMET, ECHO), each with a
  signature jet livery, procedural canvas portrait (new `public/js/portraits.js`), and one
  small perk (±15–50 % multiplier on a single stat: boost regen, turn rate, reload, magnet,
  homing range, tumble recovery, roll time, power-up duration). Duplicates allowed; perks are
  applied server-side and cannot be spoofed. Pilot choice is remembered in `localStorage`.
- **Power-up orbs** — 12 glowing pickups in the world (`PICKUP_COUNT` in `server.js`, respawn
  after 20 s): Turbo Booster, Shield Bubble, Rapid Fire, Magnet, Ghost, Score x2. Collection
  and all effects are server-authoritative and in every snapshot; HUD icons with countdown
  bars; bots detour to grab orbs within ~220 m. Work in both game modes.
- **Persistent all-time leaderboard** (`leaderboard.js`) stored at
  `data/leaderboard.json` (override with `LEADERBOARD_FILE` env var). Per (player name, pilot)
  and per mode: wins, rounds, best score, total points, balloons, hits. Atomic writes
  (temp file + rename); corrupt files are quarantined as `*.corrupt-*`. Runtime data —
  not committed to git.
- `shared/pilots.js` — single source of truth for pilots/perks/power-ups, CommonJS for the
  server and served to the client as an ES module at `GET /js/pilots-data.js`.
- Procedural audio for pickup / expire / shield / personal-best.
- Character-select grid and leaderboard screen in the lobby UI.

### Changed
- `entities.js` renders per-pilot liveries and power-up FX on jets; added pickup entities.
- `main.js` HUD extended for power-up icons; `index.html`/`style.css` for new screens.
- `.gitignore` now excludes `data/leaderboard.json`, `data/*.tmp`, `data/*.corrupt-*`.

## [1.0.0] — initial release

- Multiplayer 3D arcade jet game for up to 8 players (iPads or desktop) on a shared network.
- Zero assets: 100 % procedural geometry (Three.js 0.164.1 via importmap/jsDelivr) and
  procedural Web Audio. No bundler, no build step.
- Node.js server: Express + Socket.io, 20 Hz authoritative loop, 2–4 AI wingmen bots,
  firework rockets, Golden Crown, balloons, ring gates, QR-code lobby / host info.
- Game modes: **Crown Tag** (hold the crown, steal via rocket or ribbon contrail, 3 s
  invulnerable burst on steal) and **Arch & Balloon Blitz** (40 balloons, 12 arches with
  neon gates, Super-Charge buff).
- Touch controls (floating virtual stick, BOOST/FIREWORK) + desktop keyboard fallback
  (WASD/arrows, Shift boost/roll, Space fire). Water/rock hits bounce, never kill.
- Time-of-day presets, seeded world (islands, arches, clouds), iOS PWA support.
- Health endpoints: `GET /api/status`, `GET /api/host-info`.
