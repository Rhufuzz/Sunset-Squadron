# Changelog

All notable changes to **Sunset Squadron: Crown Chase**.
Versions follow [semver](https://semver.org/): MAJOR.MINOR.PATCH.

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
