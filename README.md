# Sunset Squadron: Crown Chase

A zero-asset (100 % procedural geometry and audio) multiplayer 3D arcade jet game for up to 8 iPads
on a shared network. Players join by scanning a QR code in the lobby, pick a pilot
(Renji, Resa, Kaya or a squadron callsign) and a paint colour, then chase the Golden Crown or
pop balloons and dive through neon ring gates in 3-minute rounds. 2–4 server-flown AI wingmen
keep the sky busy even with only two iPads.

- **Server:** Node.js, Express, Socket.io (20 Hz authoritative loop), `qrcode`
- **Client:** plain ES modules served statically, Three.js 0.164.1 from the jsDelivr CDN via an importmap, Web Audio synthesizer
- **No bundler, no build step, no asset files**

```
sunset-squadron/
├── package.json
├── server.js             # lobby, 20Hz game loop, bots, rockets, crown, balloons, gates, QR/host-info
└── public/
    ├── index.html        # iOS PWA meta, lobby, HUD, touch controls, importmap
    ├── style.css
    └── js/
        ├── main.js       # state machine, Socket.io client, 60fps prediction + interpolation
        ├── world.js      # seeded PRNG, islands, arches/ring gates, ocean, sky dome, clouds
        ├── graphics.js   # renderer, ACES, lighting rig, time-of-day presets, bloom, particles
        ├── entities.js   # jets, crown, ribbon contrail, balloons, rockets
        ├── controls.js   # multi-touch identifier tracking + keyboard fallback
        └── audio.js      # procedural Web Audio sounds
```

## Game modes (host picks in the lobby)

| Mode | Rules |
| --- | --- |
| **Crown Tag** (default) | One pilot holds the Golden Crown and earns +1 pt / second. Hit the holder with a firework rocket **or fly through their golden ribbon contrail** to steal it. Stealing grants a 3-second invulnerable speed burst. |
| **Arch & Balloon Blitz** | 40 glowing hot-air balloons (+10 each, pop by rocket or by flying into them) and 12 stone arches with neon ring gates (+25 and an 8-second 2× **Super-Charge** speed / fire-rate buff). |

Controls on iPad: left half of the screen is a floating virtual stick (it appears wherever your thumb lands),
right half has **BOOST** (hold = afterburner, tap = barrel roll that deflects rockets) and **FIREWORK**
(hold = auto-fire). Desktop fallback: `WASD` / arrows steer, `Shift` boost (tap = roll, or `Q`), `Space` fires.
Hitting water or rock never kills you — the jet just bounces.

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
