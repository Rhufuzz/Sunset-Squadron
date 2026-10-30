# Sunset Squadron: Crown Chase

A zero-asset (100 % procedural geometry and audio) multiplayer 3D arcade jet game for up to 8 iPads
on a shared network. Players join by scanning a QR code in the lobby, pick one of **12 pilot
characters** (each with a signature jet livery, a procedural portrait and a small perk), then fly
**4 game modes** — Crown Tag, Arch & Balloon Blitz, Checkpoint Race and Red vs Blue — in
3-minute rounds with seeded **mid-round events** (Golden Balloon Rush, Meteor Shower, Frenzy,
Boss Blimp), glowing **power-up orbs**, per-round **weather**, **style scoring** and **emotes**.
2–4 server-flown AI wingmen keep the sky busy even with only two iPads, dropped pilots can
reconnect mid-round, the host role migrates automatically, and a persistent **all-time
leaderboard** remembers every human pilot.

[![CI](https://github.com/Rhufuzz/Sunset-Squadron/actions/workflows/ci.yml/badge.svg)](https://github.com/Rhufuzz/Sunset-Squadron/actions/workflows/ci.yml)

- **Server:** Node.js, Express, Socket.io (20 Hz authoritative loop), `qrcode`
- **Client:** plain ES modules served statically, Three.js 0.164.1 self-hosted at `/vendor/three` (no CDN needed), Web Audio synthesizer
- **No bundler, no build step, no asset files**

```
sunset-squadron/
├── package.json
├── server.js             # lobby, 20Hz game loop, bots, rockets, crown, balloons, gates, power-ups, QR/host-info
├── leaderboard.js        # persistent JSON leaderboard (atomic writes)
├── shared/
│   └── pilots.js         # the 12 pilots, perks and power-up definitions (served to the client as /js/pilots-data.js)
├── data/
│   └── leaderboard.json  # created automatically on first start (not part of the zip / git)
└── public/
    ├── index.html        # iOS PWA meta, lobby, character select, leaderboard, HUD, touch controls, importmap
    ├── style.css
    └── js/
        ├── main.js       # state machine, Socket.io client, 60fps prediction + interpolation, HUD
        ├── world.js      # seeded PRNG, islands, arches/ring gates, ocean, sky dome, clouds
        ├── graphics.js   # renderer, ACES, lighting rig, time-of-day presets, bloom, particles
        ├── entities.js   # jets (per-pilot liveries + power-up FX), crown, ribbon, balloons, rockets, pickups
        ├── portraits.js  # procedural canvas pilot portraits (helmet, visor, face, emblem)
        ├── controls.js   # multi-touch identifier tracking + keyboard fallback
        └── audio.js      # procedural Web Audio sounds (incl. pickup / expire / shield / personal-best)
```

## Game modes (host picks in the lobby)

| Mode | Rules |
| --- | --- |
| **Crown Tag** (default) | One pilot holds the Golden Crown and earns +1 pt / second. Hit the holder with a firework rocket **or fly through their golden ribbon contrail** to steal it. Stealing grants a 3-second invulnerable speed burst. |
| **Arch & Balloon Blitz** | 40 glowing hot-air balloons (+10 each, pop by rocket or by flying into them) and 12 stone arches with neon ring gates (+25 and an 8-second 2× **Super-Charge** speed / fire-rate buff). |
| **Checkpoint Race** | A seeded 10-gate course. Your next gate glows gold (the one after, cyan) and an arrow guides you; fly the gates in order — first to finish scores 100 pts, −15 per rank after that (min 25). Rockets are disabled; barrel rolls still dodge nothing but gravity. |
| **Red vs Blue** | Team Crown Relay: one crown per team, only the enemy team can steal it (rocket, mine, or slicing the holder's ribbon). Friendly fire is off, hitting an enemy is +10, crown seconds tick for the holder. Team scoreboard, team-tinted jets and contrails. |

Controls on iPad: left half of the screen is a floating virtual stick (it appears wherever your thumb lands),
right half has **BOOST** (hold = afterburner, tap = barrel roll that deflects rockets) and **FIREWORK**
(hold = auto-fire). Desktop fallback: `WASD` / arrows steer, `Shift` boost (tap = roll, or `Q`), `Space` fires.
Hitting water or rock never kills you — the jet just bounces.

## Pilots (character select)

Every player picks a pilot in the lobby grid (tap a card; the choice is remembered in the browser's
`localStorage`, and you can still swap by tapping your own roster card before the round starts).
The pilot's colours are painted on the jet body, wings and contrail, the portrait shows up in the
roster, on in-game name tags, in the HUD and on the round-end screen. Each pilot has **one small
perk** — all perks are multipliers of ±15–50 % on a single stat, so no pilot is strictly better.

| Callsign | Name | Perk | Effect |
| --- | --- | --- | --- |
| **RENJI** | Renji Takahara | Turbo Heart | Boost stamina recharges 30 % faster |
| **RESA** | Resa Okonkwo | Long Fuse | Power-ups last 30 % longer |
| **KAYA** | Kaya Lindqvist | Knife Edge | 15 % tighter turning |
| **VIPER** | Dmitri Volkov | Quick Load | Rockets reload 15 % faster |
| **NOVA** | Priya Raman | Magnet Core | Pickup magnet radius +50 % |
| **BLAZE** | Marco Ferreira | Hot Shot | Rockets lock on from 25 % further away |
| **COMET** | Yuki Sato | Iron Wings | Recovers from hits twice as fast |
| **ECHO** | Zara Haddad | Phantom Roll | Barrel rolls last 35 % longer (bigger deflect window) |
| **ORION** | Orion Cross | Deep Tanks | Boost stamina drains 25 % slower |
| **VORTEX** | Maya Lin | Gyro Lock | Rockets steer 30 % sharper |
| **SOLAR** | Tariq Mansour | Arc Surge | Arch Super-Charge lasts 35 % longer |
| **STRIDE** | Astrid Lind | Afterburner | Boost speed is 15 % faster |

**Duplicates are allowed:** two players may fly the same pilot. Players are told apart by the name
they type (or the callsign if they leave it blank), so a family of four can all be KAYA if they insist.
AI wingmen are given random pilots, preferring ones no human has picked. Perks are applied on the
server (the client only predicts them), so they cannot be spoofed.

## Power-ups

Twelve glowing orbs float around the map at any time (`PICKUP_COUNT` in `server.js`); a collected
orb respawns somewhere else after 20 seconds. Collection and all effects are **server-authoritative**
and included in every snapshot, so every iPad sees the same shield bubble or turbo flames on the same
jet. Active effects appear as HUD icons with a countdown bar; a sound plays on pickup and when an
effect runs out. Bots will detour to grab orbs within ~220 m. Power-ups work in both modes.

| Orb | Duration | Effect |
| --- | --- | --- |
| **Turbo Booster** (orange) | 6 s | Infinite boost stamina and a higher top speed |
| **Shield Bubble** (cyan) | 25 s | Absorbs one rocket hit (the shield pops instead of you) |
| **Rapid Fire** (red) | 8 s | Rockets reload three times faster |
| **Magnet** (violet) | 10 s | Much larger pickup, balloon, crown and ribbon-steal range |
| **Ghost** (lilac) | 8 s | Homing rockets cannot lock on to you |
| **Score x2** (gold) | 10 s | Every point (crown seconds, balloons, gates) counts double |
| **Sky Mine** (red) | 25 s | Drops a spiked mine behind your jet; it arms after 1 s and explodes on the first enemy within 14 m (same effect as a rocket hit, you get the credit) |
| **Decoy Flare** (light blue) | 6 s | Launches a mirror jet on a straight flight path — homing rockets retarget to it; one hit destroys it |

## Weather

Every round is seeded with weather as well as terrain: **☀️ Clear** (no wind), **💨 Breeze**
(~4 % of base speed as a steady crosswind) or **🌧️ Gusty** (~8 %, plus light rain streaks).
The wind drift applies to every jet server-side, so all players fight the same air; the
HUD shows the current conditions in a small pill next to the clock.

## Mid-round events

Every round carries one seeded surprise at the ⅓ mark (deterministic per seed, works in
all modes): **🎈 Golden Balloon Rush** (a 3× gold balloon with 6 HP — burst it for +50 and
10 s of Score×2), **☄️ Meteor Shower** (18 falling rocks; +5 per near-miss, dodging scores),
**⚡ Frenzy** (all points ×2, pickups respawn twice as fast, unlimited boost), or
**☁️ Boss Blimp** (see below). The HUD pill shows the event name and countdown.

## Style scoring

Fly with flair, earn on top of any mode: **CLOSE CALL** +10 (an enemy rocket slips within
8 m), **LOW RIDER** +15 (3 s below 15 m over the waves), **GATE WEAVE** +25 (barrel roll
through any gate). Frenzy doubles these too; the HUD stunt ticker calls them out.

## Emotes

A quick-pick emoji bar (keys 1–4 on desktop) floats an emoji over your jet with a
procedural Animal-Crossing-style chirp — every pilot has their own voice pitch. Bots
emote when they steal a crown or get hit.

## Boss Blimp

One seeded event pits everyone against a 100 HP procedural airship circling the island.
Rockets deal 4, mines 6, ramming 3; every 25 HP lost rains 3 power-up orbs; the blimp
drops slow bombs back. Final blow: +100 and a firework celebration.

## Leaderboard

The server keeps an **all-time leaderboard for human players only** (bots are never recorded), per
*player name + pilot* and per game mode: wins, rounds played, best score, total points (crown seconds
in Crown Tag, points in Blitz), balloons popped and rocket hits. It is updated at the end of every
round with at least one human in it.

- **Lobby:** top-10 panel with a *Crown Tag* / *Balloon Blitz* tab, your own row highlighted.
- **In game:** live mini scoreboard in the top-right corner of the HUD.
- **Round end:** new personal bests (first win, best score, …) are highlighted with a **NEW PB** badge.
- **API:** `GET /api/leaderboard?limit=10` → `{ updatedAt, file, modes: { crown: [...], blitz: [...] }, totals }`.

### Leaderboard data file

The data lives in `data/leaderboard.json` (override with the `LEADERBOARD_FILE` environment
variable). The file and the `data/` folder are created automatically on first start. Writes are
atomic (temp file + rename) so a crash or power cut mid-write can never leave a half-written file;
if the file is ever unreadable it is moved aside as `leaderboard.json.corrupt-<timestamp>` and a fresh
board is started, so the game never refuses to boot because of it.

- **Backup:** it is a single small JSON file — `cp data/leaderboard.json ~/leaderboard-$(date +%F).json`
  (or add it to your existing backup job). Restore by copying it back while the server is stopped.
- **Reset:** stop the server, delete `data/leaderboard.json`, start again.
- **Upgrading:** the file is excluded from `sunset-squadron.zip` and from git, so unzipping a new
  version over `/opt/sunset-squadron` keeps your scores. Back it up first anyway.
- **Permissions:** the user that runs Node must be able to *create and write* inside `data/`.
  With the systemd unit below (`User=www-data`) run `sudo chown -R www-data:www-data /opt/sunset-squadron`
  (already in the instructions) or at least `sudo chown -R www-data:www-data /opt/sunset-squadron/data`.
  With pm2 the file is owned by whichever user ran `pm2 start`; if you later switch users, `chown` the
  `data/` directory to the new user. A permission problem is logged as `[leaderboard] save failed …`
  and the game keeps running with the board in memory only.

## Requirements

- Node.js **18 or newer** (`node -v`)
- Players' devices need internet access to load Three.js from `cdn.jsdelivr.net` (the game server itself can be on a LAN).

## Quick start (any machine)

```bash
npm install
node server.js
```

The console prints the LAN URL (e.g. `http://192.168.1.20:3000`). Open it on the host computer or
any iPad, scan the QR code with the other iPads, pick a pilot and tap **LAUNCH JET**. The first player
to join is the host and gets the **START ROUND** button plus the mode / time-of-day / bot settings.

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | TCP port to listen on (binds `0.0.0.0`) |
| `PUBLIC_URL` | *(auto LAN IPv4)* | Full URL players should use, e.g. `https://squadron.example.com`. Used for the QR code. If unset the lobby also falls back to the page's own origin when the server only knows a private IP. |
| `LEADERBOARD_FILE` | `data/leaderboard.json` | Where the persistent leaderboard is stored (see *Leaderboard data file*). |
| `ROUND_SECONDS` | `180` | Round length in seconds — only change this for testing. |

## Installing on a VPS (Ubuntu / Debian)

### 1. Install Node 18+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

### 2. Upload and install

Upload `sunset-squadron.zip`, then:

```bash
sudo mkdir -p /opt/sunset-squadron && sudo chown $USER /opt/sunset-squadron
unzip sunset-squadron.zip -d /opt
cd /opt/sunset-squadron
npm install --omit=dev
PORT=3000 PUBLIC_URL=http://YOUR.VPS.IP:3000 node server.js
```

Open `http://YOUR.VPS.IP:3000` in a browser to confirm the lobby loads. Stop it with `Ctrl+C` and
pick one of the process managers below.

### 3a. Keep it running with pm2

```bash
sudo npm install -g pm2
cd /opt/sunset-squadron
PORT=3000 PUBLIC_URL=https://squadron.example.com pm2 start server.js --name sunset-squadron
pm2 save
pm2 startup            # prints a command to run once so pm2 starts on boot
pm2 logs sunset-squadron
```

### 3b. …or with systemd

`/etc/systemd/system/sunset-squadron.service`:

```ini
[Unit]
Description=Sunset Squadron: Crown Chase
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/sunset-squadron
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=PUBLIC_URL=https://squadron.example.com
ExecStart=/usr/bin/node /opt/sunset-squadron/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data:www-data /opt/sunset-squadron
sudo systemctl daemon-reload
sudo systemctl enable --now sunset-squadron
sudo systemctl status sunset-squadron
journalctl -u sunset-squadron -f
```

### 4. nginx reverse proxy (with WebSocket upgrade)

Socket.io needs the `Upgrade` / `Connection` headers forwarded, otherwise clients fall back to
long-polling or fail to connect.

`/etc/nginx/sites-available/sunset-squadron`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name squadron.example.com;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering    off;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/sunset-squadron /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Set `PUBLIC_URL=http://squadron.example.com` (or the `https://` URL after the next step) so the
QR code points at the proxy instead of the bare port.

### 5. Optional HTTPS with certbot

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d squadron.example.com
```

Certbot rewrites the nginx server block for TLS and sets up auto-renewal. iOS only allows
"Add to Home Screen" fullscreen web apps and device motion APIs over HTTPS or on `localhost`;
the game works over plain HTTP too, but HTTPS gives the nicest fullscreen experience.

### 6. Firewall

Open the port you expose (80/443 when using nginx, or 3000 for direct access):

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# or, without a reverse proxy:
sudo ufw allow 3000/tcp
sudo ufw status
```

Cloud providers (Hetzner, DigitalOcean, AWS, …) usually also have a separate firewall / security
group in their control panel where the same port must be opened.

## iPad tips

- Scan the lobby QR code with the Camera app and open the link in Safari.
- Tap the **Share** icon → **Add to Home Screen**, then launch the game from the home-screen icon:
  it runs fullscreen without the Safari toolbar and the viewport is locked against pinch-zoom and
  rubber-band scrolling.
- Turn on **Guided Access** (Settings → Accessibility) for younger kids so the Home gesture does not
  interrupt a dogfight.
- Audio is unlocked when you tap **LAUNCH JET**; make sure the iPad is not on silent / mute.
- Landscape orientation is recommended; a hint appears if the iPad is held in portrait.

## Health check

`GET /api/status` returns `{ phase, players, bots, settings, seed, timeRemaining }` and
`GET /api/host-info` returns `{ url, qrDataUrl, seed }` — handy for uptime monitors.
`GET /api/leaderboard` returns the all-time board, `GET /api/pilots` lists the pilots, perks and
power-up definitions (the same data the client loads as the ES module `/js/pilots-data.js`).
