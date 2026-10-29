// main.js - game state machine, Socket.io client, 60fps render + local flight prediction,
// remote interpolation, HUD and lobby wiring.
import * as THREE from 'three';
import { Graphics, PRESETS } from './graphics.js';
import { World, islandCollision, WATER_LEVEL, WORLD_RADIUS, CEILING } from './world.js';
import { Jet, Crown, Ribbon, Balloon, Rocket, Pickup, Mine, powerupPalette, FIREWORK_PALETTES, SPLASH_COLORS, GOLD_COLORS, SHIELD_COLORS } from './entities.js';
import { Controls } from './controls.js';
import { SoundEngine } from './audio.js';
import { PILOTS, PERKS, POWERUPS, pilotById, perkMultipliers, hexCss } from './pilots-data.js';
import { portraitCanvas, portraitElement } from './portraits.js';

// ---------------------------------------------------------------------------
// Constants shared with the server flight model
// ---------------------------------------------------------------------------
const SPEED_BASE = 48;
const SPEED_BOOST = 85;
const SPEED_SUPER = 100;
const ROCKET_SPEED = 130;
const ROCKET_COOLDOWN = 1.2;
const ROCKET_COOLDOWN_SUPER = 0.6;
const ROCKET_COOLDOWN_RAPID = 0.4;
const TURBO_SPEED = 95;
const BARREL_ROLL_TIME = 0.45;
const STATE_SEND_MS = 50;
const LERP = 0.25;

const MODE_LABEL = { crown: 'CROWN TAG', blitz: 'ARCH & BALLOON BLITZ', race: 'CHECKPOINT RACE' };
const MODE_NAME = { crown: 'Crown Tag', blitz: 'Blitz', race: 'Checkpoint Race' };
const RACE_GATE_COLOR = 0x4ff1ff;
const RACE_GATE_ACTIVE = 0xffd54a;

// Stable per-browser client id: lets the server restore our seat (pilot, name,
// score) if we drop and rejoin while a round is in progress.
function getClientId() {
  let id = null;
  try { id = localStorage.getItem('sq_client_id'); } catch (err) { /* storage blocked */ }
  if (!id) {
    id = (window.crypto && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    try { localStorage.setItem('sq_client_id', id); } catch (err) { /* storage blocked */ }
  }
  return id;
}
const CLIENT_ID = getClientId();

const $ = (id) => document.getElementById(id);
const nowS = () => performance.now() / 1000;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
const _euler = new THREE.Euler();
function quatFromYPR(target, yaw, pitch, roll) {
  _euler.set(pitch, yaw, roll, 'YXZ');
  return target.setFromEuler(_euler);
}
function forwardFromYP(target, yaw, pitch) {
  const cp = Math.cos(pitch);
  return target.set(-cp * Math.sin(yaw), Math.sin(pitch), -cp * Math.cos(yaw));
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const ui = {
  lobby: $('lobby'), hud: $('hud'), touch: $('touch-layer'), results: $('results'), rotateHint: $('rotate-hint'),
  qrImg: $('qr-img'), joinUrl: $('join-url'),
  pilotSetup: $('pilot-setup'), rosterPanel: $('roster-panel'), roster: $('roster'), rosterCount: $('roster-count'),
  pilotGrid: $('pilot-grid'), rosterPicker: $('roster-pilot-picker'), playerName: $('player-name'),
  pdPortrait: $('pd-portrait'), pdCallsign: $('pd-callsign'), pdName: $('pd-name'), pdBio: $('pd-bio'), pdPerk: $('pd-perk'), pdPerkDesc: $('pd-perk-desc'), pdSwatches: $('pd-swatches'),
  lbTabs: $('lb-tabs'), lbBody: $('lb-body'), lbHint: $('lb-hint'),
  btnLaunch: $('btn-launch'), btnStart: $('btn-start'), joinError: $('join-error'), hostWait: $('host-wait'),
  modeToggle: $('mode-toggle'), presetToggle: $('preset-toggle'), botsToggle: $('bots-toggle'),
  hudMode: $('hud-mode'), hudTimer: $('hud-timer'), hudCrown: $('hud-crown'), hudName: $('hud-name'), hudCallsign: $('hud-callsign'), hudPortrait: $('hud-portrait'), hudScore: $('hud-score'),
  hudStamina: $('hud-stamina'), hudCooldown: $('hud-cooldown'), hudSpeed: $('hud-speed'), hudBoard: $('hud-board'), hudPowerups: $('hud-powerups'),
  hudWeather: $('hud-weather'),
  hudFeed: $('hud-feed'), hudBanner: $('hud-banner'), crownArrow: $('crown-arrow'),
  resultsTitle: $('results-title'), resultsList: $('results-list'), resultsBests: $('results-bests'),
  joyBase: $('joy-base'), joyKnob: $('joy-knob'), btnBoost: $('btn-boost'), btnFire: $('btn-fire'),
};

// ---------------------------------------------------------------------------
// Core objects
// ---------------------------------------------------------------------------
const gfx = new Graphics($('game-canvas'));
const sound = new SoundEngine();
const controls = new Controls(ui.touch, ui.joyBase, ui.joyKnob, ui.btnBoost, ui.btnFire);
let world = null;
let socket = null;

const game = {
  phase: 'lobby',          // lobby | playing | ended
  myId: null,
  joined: false,
  pilotId: PILOTS[0].id,
  playerName: '',
  perk: perkMultipliers(PILOTS[0].id),
  lobby: null,
  leaderboard: null,
  lbMode: 'crown',
  rosterEditing: false,
  mode: 'crown',
  preset: 'sunset',
  weather: null,
  windVec: new THREE.Vector3(),
  seed: 1,
  endsAt: 0,
  serverOffset: 0,
  timeRemaining: 180,
  lastSnap: null,
  lastSnapAt: 0,
  crownHolderId: null,
  course: null,            // race mode: { gates: [...], total }
  names: new Map(),        // id -> { name, pilot, isBot }
  attractAngle: 0,
};

// Local pilot state (predicted at 60fps)
const me = {
  pos: new THREE.Vector3(0, 80, 0),
  yaw: 0, pitch: 0, roll: 0,
  speed: SPEED_BASE,
  stamina: 1,
  boost: false,
  rollingUntil: 0,
  tumble: 0,
  superUntil: 0,
  invuln: false,
  lastFire: -10,
  score: 0,
  gi: 0,                   // race: index of the next gate to pass
  gp: 0,                   // race: gates passed so far
  fin: 0,                  // race: finish rank once finished (0 = still racing)
  fx: {},                  // active power-ups: type -> seconds remaining (from the server)
  fxAt: 0,
  quat: new THREE.Quaternion(),
  lastSplash: 0,
  lastBump: 0,
  wasBoosting: false,
  jet: null,
};

const remote = new Map();   // id -> { jet, pos, quat, spd, info, lastAt, forward }
const rockets = new Map();  // id -> { mesh: Rocket, pos, dir, lastAt }
const balloons = new Map(); // id -> { mesh: Balloon, alive }
const pickups = new Map();  // id -> { mesh: Pickup, alive, type }
const mines = new Map();    // id -> { mesh: Mine, pos: Vector3 }
const decoys = new Map();   // id -> { jet: Jet, pos: Vector3, quat: Quaternion, lastAt: number }
let crown = null;
let ribbon = null;
let raceGates = [];        // race mode: [{ group, mat, haloMat, pos }] per course gate
let raceHiIndex = -1;      // gate index currently highlighted gold
let lastStateSent = 0;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const FWD = new THREE.Vector3(0, 0, -1);

// ---------------------------------------------------------------------------
// Lobby UI
// ---------------------------------------------------------------------------
function pilotFor(id) {
  const n = game.names.get(id);
  return pilotById(n ? n.pilot : game.pilotId);
}
function trailCss(pilot) { return hexCss(pilot.colors.trail); }

function makePilotCard(pilot, compact) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'pilot-card';
  card.dataset.pilot = pilot.id;
  card.setAttribute('role', 'option');
  card.style.setProperty('--card-color', trailCss(pilot));
  card.style.setProperty('--card-glow', trailCss(pilot) + '88');
  card.appendChild(portraitElement(pilot, compact ? 56 : 96));
  const cs = document.createElement('span');
  cs.className = 'pc-callsign';
  cs.textContent = pilot.callsign;
  card.appendChild(cs);
  if (!compact) {
    const pk = document.createElement('span');
    pk.className = 'pc-perk';
    pk.textContent = PERKS[pilot.perk].label;
    card.appendChild(pk);
  }
  const check = document.createElement('span');
  check.className = 'pc-check';
  check.textContent = '✓';
  card.appendChild(check);
  return card;
}

function renderPilotDetail(pilot) {
  ui.pdPortrait.innerHTML = '';
  ui.pdPortrait.appendChild(portraitElement(pilot, 110));
  ui.pdCallsign.textContent = pilot.callsign;
  ui.pdCallsign.style.color = trailCss(pilot);
  ui.pdName.textContent = pilot.name;
  ui.pdBio.textContent = pilot.bio;
  ui.pdPerk.textContent = PERKS[pilot.perk].label;
  ui.pdPerkDesc.textContent = PERKS[pilot.perk].desc;
  ui.pdSwatches.innerHTML = '';
  for (const [key, label] of [['body', 'BODY'], ['wing', 'WING'], ['trail', 'TRAIL']]) {
    const sw = document.createElement('span');
    sw.style.background = hexCss(pilot.colors[key]);
    sw.style.color = hexCss(pilot.colors[key]);
    sw.title = label;
    ui.pdSwatches.appendChild(sw);
  }
  const lbl = document.createElement('small');
  lbl.textContent = 'BODY · WING · TRAIL';
  ui.pdSwatches.appendChild(lbl);
}

function selectPilot(id, fromRoster) {
  const pilot = pilotById(id);
  game.pilotId = pilot.id;
  game.perk = perkMultipliers(pilot.id);
  localStorage.setItem('ss_pilot', pilot.id);
  for (const grid of [ui.pilotGrid, ui.rosterPicker]) {
    for (const c of grid.children) c.classList.toggle('active', c.dataset.pilot === pilot.id);
  }
  renderPilotDetail(pilot);
  sound.blip(520 + PILOTS.indexOf(pilot) * 40, 0.4);
  if (fromRoster && socket && game.joined) socket.emit('setPilot', { pilot: pilot.id });
}

function buildPickers() {
  const savedPilot = localStorage.getItem('ss_pilot');
  if (savedPilot && PILOTS.some((p) => p.id === savedPilot)) game.pilotId = savedPilot;
  const savedName = localStorage.getItem('ss_player_name');
  if (savedName) { game.playerName = savedName.slice(0, 14); ui.playerName.value = game.playerName; }
  ui.pilotGrid.innerHTML = '';
  ui.rosterPicker.innerHTML = '';
  for (const pilot of PILOTS) {
    const card = makePilotCard(pilot, false);
    card.addEventListener('click', () => selectPilot(pilot.id, false));
    ui.pilotGrid.appendChild(card);
    const small = makePilotCard(pilot, true);
    small.addEventListener('click', () => { selectPilot(pilot.id, true); });
    ui.rosterPicker.appendChild(small);
  }
  selectPilot(game.pilotId, false);
  ui.playerName.addEventListener('input', () => {
    game.playerName = ui.playerName.value.replace(/[^\w\- ]/g, '').slice(0, 14);
    localStorage.setItem('ss_player_name', game.playerName);
  });
  ui.playerName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { ui.playerName.blur(); launch(); } });
  for (const b of ui.lbTabs.children) b.addEventListener('click', () => { game.lbMode = b.dataset.lbmode; renderLeaderboard(); });
}

// ---------------------------------------------------------------------------
// Leaderboard panel
// ---------------------------------------------------------------------------
function renderLeaderboard() {
  for (const b of ui.lbTabs.children) b.classList.toggle('active', b.dataset.lbmode === game.lbMode);
  const lb = game.leaderboard;
  const rows = lb && lb.modes && lb.modes[game.lbMode] ? lb.modes[game.lbMode] : [];
  ui.lbBody.innerHTML = '';
  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty';
    tr.innerHTML = '<td colspan="5">No rounds recorded yet - be the first!</td>';
    ui.lbBody.appendChild(tr);
  }
  const myName = game.joined ? (game.names.get(game.myId) || {}).name : null;
  for (const e of rows) {
    const pilot = pilotById(e.pilot);
    const tr = document.createElement('tr');
    if (myName && e.name === myName && e.pilot === game.pilotId) tr.classList.add('mine');
    const unit = game.lbMode === 'crown' ? `${Math.round(e.totalPoints)}s crown` : game.lbMode === 'race' ? `${Math.round(e.totalPoints)} pts` : `${e.balloons} balloons`;
    tr.innerHTML = `<td class="num">${e.rank}</td><td></td><td class="num">${e.wins}</td><td class="num">${e.bestScore}</td><td class="num">${e.rounds}</td>`;
    const cell = tr.children[1];
    const wrap = document.createElement('div');
    wrap.className = 'lb-pilot';
    wrap.appendChild(portraitElement(pilot, 22));
    const txt = document.createElement('span');
    txt.className = 'lb-name';
    txt.textContent = e.name;
    txt.title = `${e.name} as ${pilot.callsign} · ${e.wins} wins · ${e.rounds} rounds · best ${e.bestScore} · ${unit} · ${e.hits} hits`;
    const cs = document.createElement('span');
    cs.className = 'lb-cs';
    cs.textContent = `${pilot.callsign} · ${unit} · ${e.hits} hits`;
    txt.appendChild(cs);
    wrap.appendChild(txt);
    cell.appendChild(wrap);
    ui.lbBody.appendChild(tr);
  }
  if (lb && lb.totals) {
    const n = lb.totals[game.lbMode] || 0;
    ui.lbHint.textContent = n ? `${n} pilot${n === 1 ? '' : 's'} on the ${MODE_NAME[game.lbMode] || game.lbMode} board · humans only · wins, then best score` : 'Humans only · sorted by wins, then best score';
  }
}

async function loadLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard', { cache: 'no-store' });
    game.leaderboard = await res.json();
    renderLeaderboard();
  } catch (err) {
    console.warn('leaderboard fetch failed', err);
  }
}

function isPrivateHost(host) {
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/.test(host);
}

async function loadHostInfo() {
  try {
    const res = await fetch('/api/host-info');
    let info = await res.json();
    game.seed = info.seed;
    const serverHost = new URL(info.url).hostname;
    const pageHost = window.location.hostname;
    // If the page was loaded from a public host but the server only knows a private LAN IP,
    // the QR should point at the public origin the players can actually reach.
    if (!info.isPublicUrl && isPrivateHost(serverHost) && !isPrivateHost(pageHost)) {
      const res2 = await fetch(`/api/host-info?url=${encodeURIComponent(window.location.origin)}`);
      info = await res2.json();
    }
    ui.qrImg.src = info.qrDataUrl;
    ui.joinUrl.textContent = info.url;
    return info;
  } catch (err) {
    ui.joinUrl.textContent = window.location.origin;
    console.warn('host-info failed', err);
    return null;
  }
}

function renderRoster(lobby) {
  game.lobby = lobby;
  const isHost = lobby.hostId === game.myId;
  ui.roster.innerHTML = '';
  for (const p of lobby.players) {
    game.names.set(p.id, { name: p.name, pilot: p.pilot, isBot: p.isBot });
    const pilot = pilotById(p.pilot);
    const li = document.createElement('li');
    if (p.isBot) li.classList.add('bot');
    li.style.borderColor = p.id === game.myId ? '' : trailCss(pilot) + '66';
    li.appendChild(portraitElement(pilot, 34));
    const txt = document.createElement('span');
    txt.className = 'r-text';
    const nm = document.createElement('span');
    nm.textContent = p.name;
    nm.style.color = trailCss(pilot);
    const cs = document.createElement('span');
    cs.className = 'r-callsign';
    cs.textContent = `${pilot.callsign} · ${PERKS[pilot.perk].label}`;
    txt.appendChild(nm);
    txt.appendChild(cs);
    li.appendChild(txt);
    if (p.id === lobby.hostId) {
      const tag = document.createElement('span');
      tag.className = 'tag host-tag';
      tag.textContent = '👑 HOST';
      li.appendChild(tag);
    }
    if (p.gone) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'RECONNECTING…';
      li.appendChild(tag);
    }
    if (p.id === game.myId) {
      li.classList.add('me');
      li.classList.toggle('editing', game.rosterEditing);
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'YOU';
      li.appendChild(tag);
      li.title = 'Tap to change pilot';
      li.addEventListener('click', () => {
        if (lobby.phase !== 'lobby') return;
        game.rosterEditing = !game.rosterEditing;
        li.classList.toggle('editing', game.rosterEditing);
        ui.rosterPicker.classList.toggle('hidden', !game.rosterEditing);
      });
      if (p.pilot !== game.pilotId) {
        // Server confirmed a different pilot than the one shown locally - follow the server
        game.pilotId = p.pilot;
        game.perk = perkMultipliers(p.pilot);
        for (const c of ui.rosterPicker.children) c.classList.toggle('active', c.dataset.pilot === p.pilot);
      }
    }
    ui.roster.appendChild(li);
  }
  if (lobby.phase !== 'lobby') { game.rosterEditing = false; ui.rosterPicker.classList.add('hidden'); }
  const humans = lobby.players.filter((p) => !p.isBot).length;
  ui.rosterCount.textContent = `${humans}/8 pilots · ${lobby.settings.bots} AI wingmen`;
  for (const b of ui.modeToggle.children) b.classList.toggle('active', b.dataset.mode === lobby.settings.mode);
  for (const b of ui.presetToggle.children) b.classList.toggle('active', b.dataset.preset === lobby.settings.preset);
  for (const b of ui.botsToggle.children) b.classList.toggle('active', Number(b.dataset.bots) === lobby.settings.bots);
  ui.rosterPanel.querySelector('.settings').classList.toggle('locked', !isHost);
  ui.btnStart.classList.toggle('hidden', !isHost);
  ui.btnStart.disabled = lobby.phase !== 'lobby';
  ui.btnStart.textContent = lobby.phase === 'lobby' ? 'START ROUND — YOU ARE THE HOST' : 'ROUND IN PROGRESS';
  const hostName = (lobby.players.find((p) => p.id === lobby.hostId) || {}).name || 'the host';
  ui.hostWait.classList.toggle('hidden', isHost);
  ui.hostWait.textContent = lobby.phase === 'playing'
    ? `A round is in progress — ${hostName} will start the next one; you can drop in now.`
    : `⏳ Waiting for HOST ${hostName} to start the round…`;
  if (lobby.settings.preset !== game.preset) {
    game.preset = lobby.settings.preset;
    gfx.applyPreset(game.preset);
  }
  game.mode = lobby.settings.mode;
  if (lobby.leaderboard) { game.leaderboard = lobby.leaderboard; renderLeaderboard(); }
}

function wireLobby() {
  ui.btnLaunch.addEventListener('click', () => launch());
  ui.btnLaunch.addEventListener('touchend', (e) => { e.preventDefault(); launch(); }, { passive: false });
  ui.btnStart.addEventListener('click', () => { sound.resume(); if (socket) socket.emit('startRound'); });
  const setting = (key, value) => { if (socket) socket.emit('setSettings', { [key]: value }); };
  for (const b of ui.modeToggle.children) b.addEventListener('click', () => setting('mode', b.dataset.mode));
  for (const b of ui.presetToggle.children) b.addEventListener('click', () => setting('preset', b.dataset.preset));
  for (const b of ui.botsToggle.children) b.addEventListener('click', () => setting('bots', Number(b.dataset.bots)));
}

let launching = false;
function launch() {
  if (launching || game.joined) return;
  launching = true;
  game.playerName = ui.playerName.value.replace(/[^\w\- ]/g, '').slice(0, 14).trim();
  localStorage.setItem('ss_player_name', game.playerName);
  sound.initAndUnlock();
  sound.blip(660);
  ui.joinError.textContent = '';
  connectSocket();
}

// ---------------------------------------------------------------------------
// Socket.io
// ---------------------------------------------------------------------------
function connectSocket() {
  if (socket) { doJoin(); return; }
  socket = window.io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 500 });
  socket.on('connect', () => { doJoin(); });
  socket.on('connect_error', (err) => { ui.joinError.textContent = `Connection failed: ${err.message}`; launching = false; });
  socket.on('disconnect', () => {
    game.joined = false;
    if (game.phase !== 'lobby') enterLobby();
    ui.joinError.textContent = 'Disconnected - reconnecting…';
  });
  socket.on('lobby', (lobby) => {
    renderRoster(lobby);
    if (lobby.phase === 'lobby' && game.phase !== 'lobby') enterLobby();
  });
  socket.on('preset', ({ preset }) => { game.preset = preset; gfx.applyPreset(preset); });
  socket.on('hostChange', ({ hostId }) => {
    // Host migration: re-render the roster so START ROUND / settings move to the new host
    if (game.lobby) { game.lobby.hostId = hostId; renderRoster(game.lobby); }
    if (hostId === game.myId) addFeed('You are the host now!');
  });
  socket.on('roundStart', (data) => startRound(data));
  socket.on('snap', (snap) => onSnapshot(snap));
  socket.on('roundEnd', (results) => endRound(results));
  socket.on('shot', (e) => {
    const d = distToMe(e.p);
    if (e.id !== game.myId) sound.fireworkLaunch(volumeForDistance(d));
  });
  socket.on('hit', (e) => onHit(e));
  socket.on('pop', (e) => onPop(e));
  socket.on('gate', (e) => onGate(e));
  socket.on('finish', (e) => onFinish(e));
  socket.on('crown', (e) => onCrownEvent(e));
  socket.on('roll', (e) => { if (e.id !== game.myId) { const r = remote.get(e.id); if (r) r.rollingUntil = nowS() + BARREL_ROLL_TIME; } });
  socket.on('deflect', (e) => {
    gfx.particles.burst(arrToV(e.p), 14, 18, { colors: SPLASH_COLORS, life: 0.6, size: 1.2 });
    if (e.id === game.myId) { addFeed('Barrel roll! Rocket deflected'); sound.rollSwoosh(); }
  });
  socket.on('boom', (e) => {
    const p = arrToV(e.p);
    gfx.particles.burst(p, e.water ? 16 : 22, e.water ? 14 : 20, { colors: e.water ? SPLASH_COLORS : FIREWORK_PALETTES[3], life: 0.9, size: 1.8 });
    sound.fireworkPop(volumeForDistance(p.distanceTo(me.pos)) * 0.6);
  });
  socket.on('balloon', (e) => {
    const b = balloons.get(e.id);
    if (!b) return;
    b.mesh.setPosition(e.x, e.y, e.z);
    b.mesh.group.visible = true;
    b.alive = true;
  });
  socket.on('pickup', (e) => onPickup(e));
  socket.on('pickupSpawn', (e) => spawnPickupMesh(e));
  socket.on('fxEnd', (e) => onFxEnd(e));
  socket.on('shieldBreak', (e) => onShieldBreak(e));
  socket.on('mineDrop', (e) => {
    const d = distToMe(e.p);
    sound.mineDeploy(volumeForDistance(d) * (e.owner === game.myId ? 1 : 0.6));
    if (e.owner === game.myId) addFeed('Sky mine armed and deployed!');
  });
  socket.on('decoySpawn', (e) => {
    const d = distToMe(e.p);
    sound.decoyDeploy(volumeForDistance(d) * (e.owner === game.myId ? 1 : 0.6));
    if (e.owner === game.myId) addFeed('Decoy flare launched!');
  });
  socket.on('decoyHit', (e) => {
    const p = arrToV(e.p);
    gfx.particles.burst(p, 30, 22, { colors: FIREWORK_PALETTES[1], life: 1.0, size: 2.0 });
    sound.fireworkPop(volumeForDistance(p.distanceTo(me.pos)) * 0.7);
    if (e.by === game.myId) addFeed('Rocket destroyed an enemy decoy!');
  });
}

function doJoin() {
  if (!socket) return;
  socket.emit('join', { name: game.playerName, pilot: game.pilotId, clientId: CLIENT_ID }, (ack) => {
    launching = false;
    if (!ack || !ack.ok) {
      ui.joinError.textContent = ack && ack.error ? ack.error : 'Could not join.';
      return;
    }
    game.myId = ack.id;
    game.joined = true;
    ui.joinError.textContent = '';
    ui.pilotSetup.classList.add('hidden');
    ui.rosterPanel.classList.remove('hidden');
    renderRoster(ack.lobby);
  });
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------
function enterLobby() {
  game.phase = 'lobby';
  controls.setEnabled(false);
  ui.hud.classList.add('hidden');
  ui.touch.classList.add('hidden');
  ui.results.classList.add('hidden');
  ui.lobby.classList.remove('hidden');
  ui.rotateHint.classList.add('hidden');
  gfx.targetFov = 60;
  clearRoundEntities();
  if (me.jet) { gfx.scene.remove(me.jet.group); me.jet.dispose(); me.jet = null; }
  sound.updateEngine(0, false);
}

function clearRoundEntities() {
  for (const r of remote.values()) { gfx.scene.remove(r.jet.group); r.jet.dispose(); }
  remote.clear();
  for (const r of rockets.values()) gfx.scene.remove(r.mesh.group);
  rockets.clear();
  for (const b of balloons.values()) gfx.scene.remove(b.mesh.group);
  balloons.clear();
  for (const k of pickups.values()) { gfx.scene.remove(k.mesh.group); k.mesh.dispose(); }
  pickups.clear();
  for (const m of mines.values()) { gfx.scene.remove(m.mesh.group); m.mesh.dispose(); }
  mines.clear();
  for (const d of decoys.values()) { gfx.scene.remove(d.jet.group); d.jet.dispose(); }
  decoys.clear();
  if (crown) { gfx.scene.remove(crown.group); crown = null; }
  if (ribbon) { gfx.scene.remove(ribbon.mesh); ribbon = null; }
  for (const g of raceGates) { gfx.scene.remove(g.group); g.mat.dispose(); g.haloMat.dispose(); }
  raceGates = [];
  raceHiIndex = -1;
  game.course = null;
  ui.hudFeed.innerHTML = '';
  ui.hudPowerups.innerHTML = '';
  me.fx = {};
  puHtml = '';
}

function spawnPickupMesh(k) {
  let entry = pickups.get(k.id);
  if (entry) { gfx.scene.remove(entry.mesh.group); entry.mesh.dispose(); }
  const mesh = new Pickup(k.type);
  mesh.setPosition(k.x, k.y, k.z);
  mesh.group.visible = k.alive !== false;
  gfx.scene.add(mesh.group);
  entry = { mesh, alive: k.alive !== false, type: k.type };
  pickups.set(k.id, entry);
  return entry;
}

function buildWorld(seed) {
  if (world && world.seed === seed) return;
  if (world) world.dispose();
  world = new World(gfx.scene, seed);
  gfx.attachWorld(world);
  game.seed = seed;
}

// ---------------------------------------------------------------------------
// Checkpoint Race: course gate meshes + active-gate highlight
// ---------------------------------------------------------------------------
function buildRaceGates(course) {
  for (const g of course.gates) {
    const group = new THREE.Group();
    group.position.set(g.x, g.y, g.z);
    group.rotation.y = g.yaw;
    const mat = new THREE.MeshStandardMaterial({ color: RACE_GATE_COLOR, emissive: RACE_GATE_COLOR, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0.2, flatShading: true });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(g.gateR, 0.9, 8, 40), mat);
    const haloMat = new THREE.MeshBasicMaterial({ color: RACE_GATE_COLOR, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const halo = new THREE.Mesh(new THREE.CircleGeometry(g.gateR - 0.6, 32), haloMat);
    group.add(ring, halo);
    gfx.scene.add(group);
    raceGates.push({ group, mat, haloMat, pos: new THREE.Vector3(g.x, g.y, g.z) });
  }
  raceHiIndex = -1;
}

/** Gold highlight on your next gate; brighter cyan on the one after. */
function updateRaceGateHighlight() {
  if (!game.course || !raceGates.length) return;
  const gi = game.phase === 'playing' ? clamp(me.gi, 0, raceGates.length - 1) : -1;
  if (gi === raceHiIndex) return;
  raceHiIndex = gi;
  raceGates.forEach((g, i) => {
    if (i === gi) {
      g.mat.color.setHex(RACE_GATE_ACTIVE); g.mat.emissive.setHex(RACE_GATE_ACTIVE); g.mat.emissiveIntensity = 4.2;
      g.haloMat.color.setHex(RACE_GATE_ACTIVE); g.haloMat.opacity = 0.22;
    } else if (i === gi + 1) {
      g.mat.color.setHex(RACE_GATE_COLOR); g.mat.emissive.setHex(RACE_GATE_COLOR); g.mat.emissiveIntensity = 3.4;
      g.haloMat.color.setHex(RACE_GATE_COLOR); g.haloMat.opacity = 0.16;
    } else {
      g.mat.color.setHex(RACE_GATE_COLOR); g.mat.emissive.setHex(RACE_GATE_COLOR); g.mat.emissiveIntensity = 1.4;
      g.haloMat.color.setHex(RACE_GATE_COLOR); g.haloMat.opacity = 0.07;
    }
  });
}

function startRound(data) {
  sound.resume();
  game.phase = 'playing';
  game.mode = data.mode;
  game.preset = data.preset;
  game.endsAt = data.endsAt;
  game.serverOffset = data.serverNow - Date.now();
  game.timeRemaining = Math.max(0, (data.endsAt - data.serverNow) / 1000);
  clearRoundEntities();
  buildWorld(data.seed);
  gfx.applyPreset(data.preset);

  game.weather = data.weather || { type: 'clear', speed: 0, wind: { x: 0, y: 0, z: 0 }, label: '☀️ CLEAR' };
  game.windVec.set(game.weather.wind.x || 0, 0, game.weather.wind.z || 0);
  if (ui.hudWeather) ui.hudWeather.textContent = game.weather.label;

  for (const p of data.players) game.names.set(p.id, { name: p.name, pilot: p.pilot, isBot: p.isBot });

  // Local jet
  const self = data.players.find((p) => p.id === game.myId);
  if (self) { game.pilotId = self.pilot; game.perk = perkMultipliers(self.pilot); }
  const myPilot = pilotById(game.pilotId);
  const myName = self ? self.name : (game.playerName || myPilot.callsign);
  if (me.jet) { gfx.scene.remove(me.jet.group); me.jet.dispose(); }
  me.jet = new Jet(myPilot, myName, portraitCanvas(myPilot, 64));
  gfx.scene.add(me.jet.group);
  if (self) { me.pos.set(self.pos.x, self.pos.y, self.pos.z); me.yaw = self.yaw; }
  else { me.pos.set(0, 90, 260); me.yaw = 0; }
  me.pitch = 0; me.roll = 0; me.speed = SPEED_BASE; me.stamina = 1; me.rollingUntil = 0; me.tumble = 0;
  me.superUntil = 0; me.invuln = false; me.lastFire = -10; me.score = 0; me.fx = {}; me.fxAt = nowS();
  me.gi = 0; me.gp = 0; me.fin = 0;
  quatFromYPR(me.quat, me.yaw, 0, 0);
  me.jet.group.position.copy(me.pos);
  me.jet.group.quaternion.copy(me.quat);
  // Snap the camera behind the jet
  forwardFromYP(tmpV, me.yaw, 0);
  gfx.camera.position.copy(me.pos).addScaledVector(tmpV, -16).add(new THREE.Vector3(0, 5, 0));

  // Crown + ribbon
  crown = new Crown();
  crown.group.position.set(data.crown.pos.x, data.crown.pos.y, data.crown.pos.z);
  gfx.scene.add(crown.group);
  crown.group.visible = data.mode === 'crown';
  ribbon = new Ribbon(48);
  gfx.scene.add(ribbon.mesh);
  game.crownHolderId = data.crown.holderId;

  // Balloons (blitz only)
  if (data.mode === 'blitz') {
    for (const b of data.balloons) {
      const mesh = new Balloon(b.tint);
      mesh.setPosition(b.x, b.y, b.z);
      mesh.group.visible = b.alive;
      gfx.scene.add(mesh.group);
      balloons.set(b.id, { mesh, alive: b.alive });
    }
  }
  // Checkpoint Race course gates
  if (data.mode === 'race' && data.course && data.course.gates) {
    game.course = data.course;
    buildRaceGates(data.course);
  }
  // Power-up orbs (both modes)
  for (const k of data.pickups || []) spawnPickupMesh(k);

  // UI
  ui.lobby.classList.add('hidden');
  ui.results.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  ui.touch.classList.remove('hidden');
  ui.hudMode.textContent = MODE_LABEL[data.mode] || data.mode.toUpperCase();
  ui.hudName.textContent = myName;
  ui.hudName.style.color = trailCss(myPilot);
  ui.hudCallsign.textContent = `${myPilot.callsign} · ${PERKS[myPilot.perk].label}`;
  const hp = ui.hudPortrait.getContext('2d');
  hp.clearRect(0, 0, ui.hudPortrait.width, ui.hudPortrait.height);
  hp.drawImage(portraitCanvas(myPilot, 128), 0, 0, ui.hudPortrait.width, ui.hudPortrait.height);
  ui.hudScore.textContent = '0';
  ui.btnFire.classList.toggle('hidden', data.mode === 'race');   // no fireworks on the race course
  controls.setEnabled(true);
  checkOrientation();
  showBanner(data.mode === 'crown' ? 'CHASE THE CROWN!' : data.mode === 'race' ? 'RACE THE COURSE!' : 'POP & DIVE!');
  sound.fanfare(0.7);
  addFeed(data.mode === 'crown' ? 'Grab the Golden Crown: +1 pt every second you hold it'
    : data.mode === 'race' ? `Fly through all ${game.course ? game.course.total : 10} gates in order · 1st finish = 100 pts`
    : 'Balloons +10 · Ring gates +25 and SUPER-CHARGE');
}

function endRound(results) {
  game.phase = 'ended';
  controls.setEnabled(false);
  ui.touch.classList.add('hidden');
  ui.results.classList.remove('hidden');
  ui.hudPowerups.innerHTML = '';
  ui.resultsTitle.textContent = results.results.length && results.results[0].id === game.myId ? 'YOU WIN!' : 'ROUND OVER';
  ui.resultsList.innerHTML = '';
  let myBests = [];
  results.results.forEach((r, i) => {
    const pilot = pilotById(r.pilot);
    const li = document.createElement('li');
    const st = r.stats || {};
    const statTxt = results.mode === 'race'
      ? (r.race && r.race.finished
        ? `🏁 ${ordinal(r.race.finishRank)} · ${r.race.finishTime}s · ${r.score} pts`
        : `${r.race ? `${r.race.gatesPassed}/${r.race.total}` : '0'} gates · ${r.score} pts`)
      : results.mode === 'crown' ? `${st.crownTime || 0}s crown · ${st.hits || 0} hits` : `${st.balloons || 0} balloons · ${st.hits || 0} hits`;
    li.innerHTML = `<span class="rank">${i + 1}.</span><span class="portrait-slot"></span><span class="nm">${escapeHtml(r.name)}${r.id === game.myId ? ' (you)' : ''}<small>${escapeHtml(pilot.callsign)}${r.isBot ? ' · AI' : ''}</small></span><span class="st">${statTxt}</span><span class="sc">${r.score}</span>`;
    li.querySelector('.portrait-slot').replaceWith(portraitElement(pilot, 30));
    li.querySelector('.nm').style.color = trailCss(pilot);
    if (r.newBests && r.newBests.length) {
      const pb = document.createElement('span');
      pb.className = 'pb';
      pb.textContent = r.id === game.myId ? 'NEW PB' : 'PB';
      pb.title = r.newBests.join(' · ');
      li.appendChild(pb);
    }
    if (r.id === game.myId) myBests = r.newBests || [];
    ui.resultsList.appendChild(li);
  });
  if (myBests.length) {
    ui.resultsBests.classList.remove('hidden');
    ui.resultsBests.innerHTML = `<div class="pb-title">PERSONAL BEST</div>${myBests.map((b) => `<div>★ ${escapeHtml(b)}</div>`).join('')}`;
    sound.personalBest();
  } else {
    ui.resultsBests.classList.add('hidden');
    ui.resultsBests.innerHTML = '';
  }
  if (results.leaderboard) { game.leaderboard = results.leaderboard; renderLeaderboard(); }
  sound.roundOver();
  sound.updateEngine(0, false);
  gfx.targetFov = 60;
}

// ---------------------------------------------------------------------------
// Snapshot handling
// ---------------------------------------------------------------------------
function onSnapshot(snap) {
  if (game.phase === 'lobby') return;
  const t = nowS();
  game.lastSnap = snap;
  game.lastSnapAt = t;
  game.timeRemaining = snap.timeRemaining;
  game.crownHolderId = snap.crownHolderId;
  // Host migration via snapshot (hostChange event covers it too)
  if (snap.hostId !== undefined && game.lobby && game.lobby.hostId !== snap.hostId) {
    game.lobby.hostId = snap.hostId;
    renderRoster(game.lobby);
  }
  const seen = new Set();
  for (const p of snap.players) {
    seen.add(p.id);
    if (p.id === game.myId) {
      me.score = p.sc;
      me.superUntil = p.su > 0 ? t + p.su : 0;
      me.invuln = Boolean(p.iv);
      if (p.tu > 0) me.tumble = Math.max(me.tumble, p.tu);
      me.fx = p.fx || {};
      me.fxAt = t;
      if (p.gi !== undefined) { me.gi = p.gi; me.gp = p.gp; me.fin = p.fin; }
      continue;
    }
    let r = remote.get(p.id);
    if (!r) {
      const info = game.names.get(p.id) || { name: 'Pilot', pilot: PILOTS[0].id };
      const pilot = pilotById(info.pilot);
      const jet = new Jet(pilot, info.name, portraitCanvas(pilot, 64));
      jet.group.position.set(p.p[0], p.p[1], p.p[2]);
      jet.group.quaternion.set(p.q[0], p.q[1], p.q[2], p.q[3]);
      gfx.scene.add(jet.group);
      r = { jet, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), spd: SPEED_BASE, info: {}, lastAt: t, forward: new THREE.Vector3(), rollingUntil: 0, tumble: 0 };
      remote.set(p.id, r);
    }
    r.pos.set(p.p[0], p.p[1], p.p[2]);
    r.quat.set(p.q[0], p.q[1], p.q[2], p.q[3]);
    r.spd = p.spd;
    r.forward.copy(FWD).applyQuaternion(r.quat);
    r.info = { boost: Boolean(p.b), super: p.su > 0, invuln: Boolean(p.iv), tumble: p.tu, score: p.sc, fx: p.fx || {} };
    r.tumble = p.tu;
    r.lastAt = t;
  }
  for (const [id, r] of remote) {
    if (!seen.has(id)) { gfx.scene.remove(r.jet.group); r.jet.dispose(); remote.delete(id); }
  }
  // Rockets
  const seenR = new Set();
  for (const rk of snap.rockets) {
    seenR.add(rk.id);
    let r = rockets.get(rk.id);
    if (!r) {
      const mesh = new Rocket(pilotFor(rk.o).colors.trail);
      mesh.group.position.set(rk.p[0], rk.p[1], rk.p[2]);
      gfx.scene.add(mesh.group);
      r = { mesh, pos: new THREE.Vector3(), dir: new THREE.Vector3(), lastAt: t, fresh: true };
      rockets.set(rk.id, r);
    }
    r.pos.set(rk.p[0], rk.p[1], rk.p[2]);
    r.dir.set(rk.d[0], rk.d[1], rk.d[2]);
    r.lastAt = t;
  }
  for (const [id, r] of rockets) {
    if (!seenR.has(id)) { gfx.scene.remove(r.mesh.group); rockets.delete(id); }
  }
  // Balloons alive flags
  if (snap.balloons && snap.balloons.length) {
    snap.balloons.forEach((alive, i) => {
      const b = balloons.get(i);
      if (b && b.alive !== Boolean(alive)) { b.alive = Boolean(alive); b.mesh.group.visible = b.alive; }
    });
  }
  // Power-up orbs alive flags
  if (snap.pickups && snap.pickups.length) {
    snap.pickups.forEach((alive, i) => {
      const k = pickups.get(i);
      if (k && k.alive !== Boolean(alive)) { k.alive = Boolean(alive); k.mesh.group.visible = k.alive; }
    });
  }
  // Sky Mines
  const seenM = new Set();
  for (const mk of (snap.mines || [])) {
    seenM.add(mk.id);
    let m = mines.get(mk.id);
    if (!m) {
      const mesh = new Mine();
      mesh.setPosition(mk.p[0], mk.p[1], mk.p[2]);
      gfx.scene.add(mesh.group);
      m = { mesh, pos: new THREE.Vector3(mk.p[0], mk.p[1], mk.p[2]) };
      mines.set(mk.id, m);
    }
    m.pos.set(mk.p[0], mk.p[1], mk.p[2]);
    m.mesh.setPosition(mk.p[0], mk.p[1], mk.p[2]);
    m.mesh.update(0.05, t, mk.arm === 1);
  }
  for (const [id, m] of mines) {
    if (!seenM.has(id)) { gfx.scene.remove(m.mesh.group); m.mesh.dispose(); mines.delete(id); }
  }
  // Decoys
  const seenD = new Set();
  for (const dk of (snap.decoys || [])) {
    seenD.add(dk.id);
    let d = decoys.get(dk.id);
    if (!d) {
      const pInfo = pilotById(dk.pilot);
      const jet = new Jet(pInfo, 'DECOY', portraitCanvas(pInfo, 64));
      jet.group.position.set(dk.p[0], dk.p[1], dk.p[2]);
      jet.group.quaternion.set(dk.q[0], dk.q[1], dk.q[2], dk.q[3]);
      gfx.scene.add(jet.group);
      d = { jet, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), lastAt: t };
      decoys.set(dk.id, d);
    }
    d.pos.set(dk.p[0], dk.p[1], dk.p[2]);
    d.quat.set(dk.q[0], dk.q[1], dk.q[2], dk.q[3]);
    d.jet.group.position.lerp(d.pos, 0.45);
    d.jet.group.quaternion.slerp(d.quat, 0.45);
    d.jet.updateVisual(0.05, { boost: true, super: false, invuln: false, tumble: 0, fx: {} }, gfx.particles, t);
  }
  for (const [id, d] of decoys) {
    if (!seenD.has(id)) { gfx.scene.remove(d.jet.group); d.jet.dispose(); decoys.delete(id); }
  }
  // Crown + ribbon
  if (crown) {
    if (!snap.crownHolderId) crown.group.position.lerp(arrToV(snap.crownPos), 0.5);
  }
  if (ribbon) ribbon.setPoints(snap.ribbon || [], t);
  updateRaceGateHighlight();
  updateBoard(snap);
}

// ---------------------------------------------------------------------------
// Event handlers (hits, pops, gates, crown)
// ---------------------------------------------------------------------------
function nameOf(id) { const n = game.names.get(id); return n ? n.name : 'Pilot'; }
function arrToV(a) { return new THREE.Vector3(a[0], a[1], a[2]); }
function distToMe(a) { return Math.hypot(a[0] - me.pos.x, a[1] - me.pos.y, a[2] - me.pos.z); }
function volumeForDistance(d) { return clamp(1 - d / 500, 0.15, 1); }

function onHit(e) {
  const p = arrToV(e.p);
  const palette = FIREWORK_PALETTES[Math.floor(Math.random() * FIREWORK_PALETTES.length)];
  gfx.particles.burst(p, 46, 34, { colors: palette, life: 1.3, size: 1.8, gravity: 12, drag: 1.2 });
  gfx.particles.burst(p, 18, 10, { colors: GOLD_COLORS, life: 0.8, size: 1.6 });
  sound.fireworkPop(volumeForDistance(p.distanceTo(me.pos)));
  if (e.victim === game.myId) {
    me.tumble = 0.6;
    gfx.addShake(0.9);
    if (e.mine) addFeed(`${nameOf(e.shooter)}'s sky mine hit you!`);
    else addFeed(e.crownStolen ? `${nameOf(e.shooter)} stole your crown!` : `${nameOf(e.shooter)} tagged you with a firework!`);
  } else if (e.shooter === game.myId) {
    if (e.mine) addFeed(`Your sky mine struck ${nameOf(e.victim)}!`);
    else addFeed(e.crownStolen ? `You stole the crown from ${nameOf(e.victim)}!` : `Direct hit on ${nameOf(e.victim)}!`);
    if (game.mode === 'blitz') showBanner('+5');
  } else if (e.crownStolen) {
    addFeed(`${nameOf(e.shooter)} ${e.ribbon ? 'flew through the ribbon and' : e.mine ? 'used a mine to' : ''} stole the crown from ${nameOf(e.victim)}`);
  } else if (e.mine) {
    addFeed(`${nameOf(e.victim)} hit ${nameOf(e.shooter)}'s sky mine`);
  }
}

function onPop(e) {
  const p = arrToV(e.p);
  const palette = FIREWORK_PALETTES[e.tint % FIREWORK_PALETTES.length];
  gfx.particles.burst(p, 28, 22, { colors: palette, life: 1.0, size: 2.0, gravity: 8 });
  const b = balloons.get(e.id);
  if (b) { b.alive = false; b.mesh.group.visible = false; }
  sound.balloonPop(volumeForDistance(p.distanceTo(me.pos)));
  if (e.by === game.myId) showBanner('+10');
}

function onGate(e) {
  const p = arrToV(e.p);
  gfx.particles.burst(p, 40, 26, { colors: e.race ? GOLD_COLORS : SPLASH_COLORS, life: 1.1, size: 1.8 });
  if (e.race) {
    if (e.by === game.myId) {
      sound.fanfare();
      showBanner(e.gi >= e.total ? 'FINAL GATE!' : `GATE ${e.gi + 1}/${e.total}`);
      gfx.addShake(0.2);
    } else {
      sound.fanfare(volumeForDistance(p.distanceTo(me.pos)) * 0.4);
      addFeed(`${nameOf(e.by)} passed a checkpoint`);
    }
    return;
  }
  if (e.by === game.myId) {
    sound.fanfare();
    showBanner('SUPER-CHARGE! +25');
    addFeed('2x speed and fire rate for 8 seconds');
    gfx.addShake(0.3);
  } else {
    sound.fanfare(volumeForDistance(p.distanceTo(me.pos)) * 0.5);
    addFeed(`${nameOf(e.by)} blasted through a ring gate`);
  }
}

function ordinal(n) { return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`; }

function onFinish(e) {
  const p = arrToV(e.p);
  gfx.particles.burst(p, 60, 34, { colors: GOLD_COLORS, life: 1.6, size: 2.2, gravity: 8 });
  gfx.particles.burst(p, 30, 18, { colors: FIREWORK_PALETTES[1], life: 1.2, size: 1.8 });
  if (e.id === game.myId) {
    sound.personalBest();
    showBanner(`FINISHED ${ordinal(e.rank).toUpperCase()}! +${e.points}`);
    addFeed(`Course complete in ${e.time}s · ${e.points} pts`);
    gfx.addShake(0.5);
    me.fin = e.rank;
  } else {
    sound.fanfare(volumeForDistance(p.distanceTo(me.pos)) * 0.5);
    addFeed(`${nameOf(e.id)} finished ${ordinal(e.rank)} (+${e.points})`);
  }
}

function onCrownEvent(e) {
  game.crownHolderId = e.holderId;
  if (e.how === 'dropped') { addFeed('The crown is loose!'); return; }
  if (e.holderId === game.myId) {
    sound.fanfare();
    showBanner('YOU HAVE THE CROWN!');
    gfx.addShake(0.25);
  } else if (e.how === 'pickup') {
    addFeed(`${nameOf(e.holderId)} grabbed the Golden Crown`);
    sound.blip(880, 0.5);
  }
}

function onPickup(e) {
  const p = arrToV(e.p);
  const def = POWERUPS[e.type] || { label: e.type, short: e.type };
  gfx.particles.burst(p, 34, 24, { colors: powerupPalette(e.type), life: 0.9, size: 1.5, glow: 2.2 });
  const k = pickups.get(e.id);
  if (k) { k.alive = false; k.mesh.group.visible = false; }
  if (e.by === game.myId) {
    sound.pickup(e.type);
    showBanner(def.short === 'x2' ? 'SCORE x2!' : `${def.short}!`);
    addFeed(`${def.label}: ${def.desc} (${Math.round(e.dur)}s)`);
    gfx.addShake(0.15);
    // Predict locally until the next snapshot confirms it
    me.fx = { ...me.fx, [e.type]: Math.max(me.fx[e.type] || 0, e.dur) };
    me.fxAt = nowS();
  } else {
    sound.pickup(e.type, volumeForDistance(p.distanceTo(me.pos)) * 0.4);
    addFeed(`${nameOf(e.by)} grabbed ${def.label}`);
  }
}

function onFxEnd(e) {
  if (e.id === game.myId) {
    const def = POWERUPS[e.type];
    if (me.fx[e.type] !== undefined) { const fx = { ...me.fx }; delete fx[e.type]; me.fx = fx; }
    sound.powerDown();
    if (def) addFeed(`${def.label} wore off`);
  }
}

function onShieldBreak(e) {
  const p = arrToV(e.p);
  gfx.particles.burst(p, 40, 28, { colors: SHIELD_COLORS, life: 0.9, size: 1.6, glow: 2.2 });
  if (e.id === game.myId) {
    sound.shieldBreak();
    showBanner('SHIELD BLOCKED IT!');
    gfx.addShake(0.4);
    if (me.fx.shield !== undefined) { const fx = { ...me.fx }; delete fx.shield; me.fx = fx; }
  } else {
    sound.shieldBreak(volumeForDistance(p.distanceTo(me.pos)) * 0.6);
    if (e.by === game.myId) addFeed(`${nameOf(e.id)}'s shield absorbed your firework`);
  }
}

// ---------------------------------------------------------------------------
// HUD helpers
// ---------------------------------------------------------------------------
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function addFeed(text) {
  const el = document.createElement('div');
  el.className = 'msg';
  el.textContent = text;
  ui.hudFeed.appendChild(el);
  while (ui.hudFeed.children.length > 4) ui.hudFeed.removeChild(ui.hudFeed.firstChild);
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3800);
}

function showBanner(text) {
  ui.hudBanner.textContent = text;
  ui.hudBanner.classList.remove('hidden');
  ui.hudBanner.style.animation = 'none';
  void ui.hudBanner.offsetWidth;
  ui.hudBanner.style.animation = '';
  clearTimeout(showBanner.timer);
  showBanner.timer = setTimeout(() => ui.hudBanner.classList.add('hidden'), 1700);
}

let boardHtml = '';
function updateBoard(snap) {
  const race = snap.mode === 'race';
  const rows = snap.players
    .map((p) => ({ id: p.id, sc: p.sc, gi: p.gi, gp: p.gp, fin: p.fin, ...(game.names.get(p.id) || { name: 'Pilot', pilot: PILOTS[0].id }) }))
    .sort((a, b) => race
      ? (b.fin - a.fin || b.gp - a.gp || b.sc - a.sc)
      : b.sc - a.sc)
    .slice(0, 8);
  const total = game.course ? game.course.total : 10;
  const html = rows.map((r, i) => {
    const css = trailCss(pilotById(r.pilot));
    const right = race ? (r.fin ? `🏁 ${r.fin}` : `${Math.min(r.gi !== undefined ? r.gi : total, total)}/${total}`) : r.sc;
    return `<div class="row${r.id === game.myId ? ' me' : ''}${r.id === snap.crownHolderId ? ' crown' : ''}"><span class="rank">${i + 1}</span><span class="dot" style="background:${css};color:${css}"></span><span class="nm">${escapeHtml(r.name)}</span><span class="sc">${right}</span></div>`;
  }).join('');
  if (html !== boardHtml) { boardHtml = html; ui.hudBoard.innerHTML = html; }
  if (race) {
    ui.hudCrown.textContent = me.fin ? `🏁 FINISHED ${me.fin}` : `🏁 GATE ${Math.min(me.gi + 1, total)}/${total}`;
  } else {
    const holder = snap.crownHolderId ? nameOf(snap.crownHolderId) : (game.mode === 'crown' ? 'loose!' : '');
    ui.hudCrown.textContent = game.mode === 'crown' ? `👑 ${holder}` : `🎈 ${snap.balloons.filter(Boolean).length} left`;
  }
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

// Inline SVG glyphs for the power-up HUD (procedural, no image files)
const PU_SVG = {
  turbo: '<svg viewBox="0 0 32 32"><path d="M4 18 L18 18 L18 10 L28 16 L18 22 L18 14 Z" fill="currentColor" transform="translate(0,-1)"/><path d="M4 12 L12 12 M4 24 L14 24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
  shield: '<svg viewBox="0 0 32 32"><path d="M16 3 L27 7 V15 C27 22 22 27 16 29 C10 27 5 22 5 15 V7 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M11 15 L15 19 L22 11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  rapid: '<svg viewBox="0 0 32 32"><g fill="currentColor"><path d="M7 4 L10 10 V22 L7 26 L4 22 V10 Z"/><path d="M16 2 L19 8 V24 L16 29 L13 24 V8 Z"/><path d="M25 4 L28 10 V22 L25 26 L22 22 V10 Z"/></g></svg>',
  magnet: '<svg viewBox="0 0 32 32"><path d="M8 4 V16 A8 8 0 0 0 24 16 V4" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="butt"/><rect x="5" y="3" width="6" height="7" fill="#ff5e5b"/><rect x="21" y="3" width="6" height="7" fill="#ff5e5b"/></svg>',
  ghost: '<svg viewBox="0 0 32 32"><path d="M6 29 V15 A10 10 0 0 1 26 15 V29 L22 25 L18 29 L14 25 L10 29 Z" fill="currentColor" opacity="0.85"/><circle cx="12" cy="15" r="2" fill="#1a1030"/><circle cx="20" cy="15" r="2" fill="#1a1030"/></svg>',
  x2: '<svg viewBox="0 0 32 32"><text x="16" y="23" text-anchor="middle" font-size="20" font-weight="900" font-family="system-ui, sans-serif" fill="currentColor">x2</text></svg>',
  mine: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="6" fill="currentColor"/><path d="M16 4 V9 M16 23 V28 M4 16 H9 M23 16 H28 M7 7 L11 11 M21 21 L25 25 M7 25 L11 21 M21 11 L25 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
  decoy: '<svg viewBox="0 0 32 32"><path d="M16 4 L27 24 L16 20 L5 24 Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M16 10 L22 21 L16 19 L10 21 Z" fill="currentColor" opacity="0.6"/></svg>',
};
let puHtml = '';
function updatePowerupHud() {
  const t = nowS();
  const age = t - me.fxAt;
  const parts = [];
  for (const type of Object.keys(me.fx)) {
    const remain = me.fx[type] - age;
    if (remain <= 0) continue;
    const def = POWERUPS[type];
    if (!def) continue;
    const total = def.duration * game.perk.fxDuration;
    const frac = clamp(remain / total, 0, 1);
    const css = hexCss(def.color);
    parts.push(`<div class="pu-icon${remain < 2 ? ' ending' : ''}" style="--pu-color:${css};color:${css}" data-type="${type}">${PU_SVG[type] || ''}<span class="pu-label">${def.short}</span><span class="pu-time">${remain.toFixed(remain < 10 ? 1 : 0)}</span><span class="pu-bar" style="width:${Math.round(frac * 100)}%"></span></div>`);
  }
  const html = parts.join('');
  if (html !== puHtml) { puHtml = html; ui.hudPowerups.innerHTML = html; }
}
function hasFx(type) { return me.fx[type] !== undefined && me.fx[type] - (nowS() - me.fxAt) > 0; }

function checkOrientation() {
  const touch = 'ontouchstart' in window && navigator.maxTouchPoints > 0;
  const portrait = window.innerHeight > window.innerWidth;
  ui.rotateHint.classList.toggle('hidden', !(touch && portrait && game.phase === 'playing'));
}
window.addEventListener('resize', checkOrientation);

// ---------------------------------------------------------------------------
// Local flight model (mirrors server stepFlight)
// ---------------------------------------------------------------------------
function stepLocalFlight(dt) {
  const t = nowS();
  controls.poll();
  const joyX = controls.joyX;
  const joyY = controls.joyY;
  let boost = controls.boost;
  const rollTime = BARREL_ROLL_TIME * game.perk.rollTime;
  if (controls.takeRollTap() && t >= me.rollingUntil) {
    me.rollingUntil = t + rollTime;
    sound.rollSwoosh();
    if (socket) socket.emit('barrelRoll');
  }
  const sup = t < me.superUntil;
  const turbo = hasFx('turbo');
  const regen = 0.28 * game.perk.stamRegen;
  if (turbo) { boost = true; me.stamina = Math.min(1, me.stamina + dt * regen); }
  else if (boost && me.stamina > 0.02) me.stamina = Math.max(0, me.stamina - dt * 0.45 * (game.perk.stamDrain || 1));
  else { boost = false; me.stamina = Math.min(1, me.stamina + dt * regen); }
  if (boost && !me.wasBoosting) sound.boostWhoosh(0.8);
  me.wasBoosting = boost;
  me.boost = boost;
  const boostSpd = SPEED_BOOST * (game.perk.boostSpeed || 1);
  const target = sup ? SPEED_SUPER : turbo ? TURBO_SPEED : (boost || me.invuln) ? boostSpd : SPEED_BASE;
  me.speed = lerp(me.speed, target, Math.min(1, dt * 3));
  me.yaw = wrapAngle(me.yaw + -joyX * 2.1 * game.perk.turn * dt);
  me.pitch = lerp(me.pitch, -joyY * 0.75, Math.min(1, dt * 6));
  me.roll = lerp(me.roll, -joyX * 1.05, Math.min(1, dt * 8));
  forwardFromYP(tmpV, me.yaw, me.pitch);
  me.pos.addScaledVector(tmpV, me.speed * dt);
  if (game.windVec) me.pos.addScaledVector(game.windVec, dt);

  // Soft ocean bounce
  if (me.pos.y < WATER_LEVEL + 3) {
    me.pitch = 0.35;
    me.pos.y = Math.max(me.pos.y, WATER_LEVEL + 1.5);
    if (t - me.lastSplash > 0.6) {
      me.lastSplash = t;
      gfx.particles.burst(tmpV2.copy(me.pos).setY(WATER_LEVEL + 1), 24, 16, { colors: SPLASH_COLORS, life: 0.9, size: 1.8, gravity: 20 });
      sound.splash();
      gfx.addShake(0.25);
    }
  }
  if (me.pos.y > CEILING) { me.pos.y = CEILING; me.pitch = Math.min(me.pitch, -0.1); }

  // Island bump
  const hit = world ? islandCollision(me.pos, world.layout.islands) : null;
  if (hit) {
    me.pos.addScaledVector(hit.n, hit.push);
    tmpV3.copy(hit.n).multiplyScalar(0.9).addScaledVector(tmpV, 0.35).normalize();
    me.yaw = Math.atan2(-tmpV3.x, -tmpV3.z);
    me.pitch = clamp(Math.asin(clamp(tmpV3.y, -1, 1)), -0.5, 0.6);
    if (t - me.lastBump > 0.5) {
      me.lastBump = t;
      gfx.particles.burst(me.pos, 18, 14, { colors: GOLD_COLORS, life: 0.6, size: 1.4 });
      sound.bump();
      gfx.addShake(0.8);
    }
  }
  // Soft world boundary
  const hr = Math.hypot(me.pos.x, me.pos.z);
  if (hr > WORLD_RADIUS) {
    const inward = Math.atan2(me.pos.x, me.pos.z);
    me.yaw = lerp(me.yaw, wrapAngle(inward), Math.min(1, dt * 2));
  }

  // Visual roll (+ barrel roll)
  let visualRoll = me.roll;
  if (t < me.rollingUntil) visualRoll += ((me.rollingUntil - t) / rollTime) * Math.PI * 2;
  quatFromYPR(me.quat, me.yaw, me.pitch, visualRoll);
  me.jet.group.position.copy(me.pos);
  me.jet.group.quaternion.copy(me.quat);
  if (me.tumble > 0) me.tumble = Math.max(0, me.tumble - dt);
  me.jet.updateVisual(dt, { boost, super: sup, invuln: me.invuln, tumble: me.tumble, fx: activeFx() }, gfx.particles, t);

  // Fire
  let cd = sup ? ROCKET_COOLDOWN_SUPER : ROCKET_COOLDOWN;
  if (hasFx('rapid')) cd = Math.min(cd, ROCKET_COOLDOWN_RAPID);
  cd *= game.perk.reload;
  if (controls.fire && game.mode !== 'race' && t - me.lastFire >= cd) {
    me.lastFire = t;
    if (socket) socket.emit('fire');
    sound.fireworkLaunch();
    gfx.addShake(0.12);
  }

  // Camera: chase behind, ignoring roll so the horizon stays readable
  quatFromYPR(tmpQ, me.yaw, me.pitch * 0.55, 0);
  tmpV2.set(0, 5, 17 + (me.speed - SPEED_BASE) * 0.06).applyQuaternion(tmpQ).add(me.pos);
  if (tmpV2.y < WATER_LEVEL + 2.5) tmpV2.y = WATER_LEVEL + 2.5;
  gfx.camera.position.lerp(tmpV2, 1 - Math.exp(-dt * 7));
  tmpV3.copy(me.pos).addScaledVector(tmpV, 26).add(tmpV2.set(0, 2.5, 0));
  gfx.camera.lookAt(tmpV3);
  gfx.targetFov = sup ? 76 : boost ? 74 : 60;
  gfx.followShadow(me.pos);

  // Engine audio
  sound.updateEngine((me.speed - 30) / (SPEED_SUPER - 30), true);

  // Send state at 20Hz
  const nowMs = performance.now();
  if (socket && game.joined && nowMs - lastStateSent >= STATE_SEND_MS) {
    lastStateSent = nowMs;
    socket.emit('state', {
      p: [me.pos.x, me.pos.y, me.pos.z],
      q: [me.quat.x, me.quat.y, me.quat.z, me.quat.w],
      yaw: me.yaw, pitch: me.pitch, roll: visualRoll, spd: me.speed, boost, st: me.stamina,
    });
  }

  // HUD
  ui.hudStamina.style.width = `${Math.round(me.stamina * 100)}%`;
  ui.hudCooldown.style.width = `${Math.round(clamp((t - me.lastFire) / cd, 0, 1) * 100)}%`;
  ui.btnFire.classList.toggle('cooling', t - me.lastFire < cd);
  ui.hudSpeed.textContent = Math.round(me.speed).toString();
  ui.hudScore.textContent = String(me.score);
  updateCrownArrow();
  updatePowerupHud();
}

/** Active power-ups as a plain { type: true } map for the jet visuals. */
function activeFx() {
  const age = nowS() - me.fxAt;
  const out = {};
  for (const type of Object.keys(me.fx)) if (me.fx[type] - age > 0) out[type] = true;
  return out;
}

function updateCrownArrow() {
  let target = null;
  if (game.mode === 'crown') {
    if (!crown) { ui.crownArrow.classList.add('hidden'); return; }
    if (game.crownHolderId === game.myId) { ui.crownArrow.classList.add('hidden'); return; }
    target = crown.group.position;
  } else if (game.mode === 'race') {
    // Point the arrow at your next course gate
    if (!game.course || me.fin) { ui.crownArrow.classList.add('hidden'); return; }
    const gates = game.course.gates;
    const g = gates[clamp(me.gi, 0, gates.length - 1)];
    target = tmpV.set(g.x, g.y, g.z);
  } else {
    ui.crownArrow.classList.add('hidden');
    return;
  }
  tmpV2.copy(target).sub(me.pos);
  const d = tmpV2.length();
  // Project direction into camera space to get a 2D angle on screen
  tmpV3.copy(tmpV2).applyQuaternion(tmpQ.copy(gfx.camera.quaternion).invert());
  const ang = Math.atan2(tmpV3.x, -tmpV3.z);
  const onScreen = tmpV3.z < 0 && Math.abs(tmpV3.x / tmpV3.z) < 0.9 && Math.abs(tmpV3.y / tmpV3.z) < 0.6;
  ui.crownArrow.classList.toggle('hidden', onScreen && d < 400);
  ui.crownArrow.style.transform = `rotate(${ang}rad) translateY(-130px)`;
}

// ---------------------------------------------------------------------------
// Remote interpolation
// ---------------------------------------------------------------------------
function stepRemote(dt) {
  const t = nowS();
  for (const r of remote.values()) {
    const age = Math.min(0.15, t - r.lastAt);
    tmpV.copy(r.pos).addScaledVector(r.forward, r.spd * age);
    r.jet.group.position.lerp(tmpV, LERP);
    r.jet.group.quaternion.slerp(r.quat, LERP);
    if (r.tumble > 0) r.tumble = Math.max(0, r.tumble - dt);
    r.jet.updateVisual(dt, { boost: r.info.boost, super: r.info.super, invuln: r.info.invuln, tumble: r.tumble, fx: r.info.fx }, gfx.particles, t);
  }
  for (const r of rockets.values()) {
    const age = Math.min(0.2, t - r.lastAt);
    tmpV.copy(r.pos).addScaledVector(r.dir, ROCKET_SPEED * age);
    if (r.fresh) { r.mesh.group.position.copy(tmpV); r.fresh = false; }
    else r.mesh.group.position.lerp(tmpV, 0.45);
    tmpQ.setFromUnitVectors(FWD, r.dir);
    r.mesh.group.quaternion.slerp(tmpQ, 0.4);
    r.mesh.update(dt, gfx.particles);
  }
  for (const b of balloons.values()) if (b.alive) b.mesh.update(dt, t);
  for (const k of pickups.values()) if (k.alive) k.mesh.update(dt, t, k.mesh.group.position.distanceTo(gfx.camera.position) < 350 ? gfx.particles : null);
  if (crown) {
    const holderId = game.crownHolderId;
    if (holderId) {
      const holder = holderId === game.myId ? me.jet : (remote.get(holderId) || {}).jet;
      if (holder) crown.group.position.lerp(tmpV.copy(holder.group.position).add(tmpV2.set(0, 5, 0)), 0.5);
    }
    crown.update(dt, t, !holderId, gfx.particles);
  }
}

// ---------------------------------------------------------------------------
// Attract-mode camera for the lobby
// ---------------------------------------------------------------------------
function stepAttract(dt) {
  game.attractAngle += dt * 0.06;
  const a = game.attractAngle;
  gfx.camera.position.set(Math.cos(a) * 420, 120 + Math.sin(a * 0.7) * 30, Math.sin(a) * 420);
  gfx.camera.lookAt(0, 40, 0);
  gfx.followShadow(new THREE.Vector3(0, 0, 0));
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastFrame = performance.now();
let timerText = '';
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;
  if (!world) return;
  if (game.phase === 'playing') {
    stepLocalFlight(dt);
    stepRemote(dt);
    if (game.weather && game.weather.type === 'gusty') {
      const wx = game.weather.wind.x || 0, wz = game.weather.wind.z || 0;
      for (let i = 0; i < 3; i++) {
        const rx = (Math.random() - 0.5) * 60;
        const ry = 15 + Math.random() * 25;
        const rz = (Math.random() - 0.5) * 60;
        tmpV2.set(rx, ry, rz).applyQuaternion(gfx.camera.quaternion).add(gfx.camera.position);
        gfx.particles.spawn({
          pos: tmpV2,
          vel: { x: wx * 2 - 5, y: -80, z: wz * 2 - 5 },
          life: 0.35,
          size: 0.5,
          drag: 0.05,
          gravity: 8,
          colors: [new THREE.Color(0xa5d8ff), new THREE.Color(0x74c0fc), new THREE.Color(0x4dabf7)],
          glow: 1.0,
        });
      }
    }
    if (game.lastSnapAt) game.timeRemaining = Math.max(0, game.timeRemaining - dt);
    const txt = formatTime(game.timeRemaining);
    if (txt !== timerText) {
      timerText = txt;
      ui.hudTimer.textContent = txt;
      ui.hudTimer.classList.toggle('urgent', game.timeRemaining <= 10);
      if (game.timeRemaining <= 10 && game.timeRemaining > 0) sound.blip(game.timeRemaining <= 3 ? 1320 : 990, 0.5);
    }
  } else if (game.phase === 'ended') {
    stepRemote(dt);
    if (me.jet) { me.jet.group.position.copy(me.pos); me.jet.updateVisual(dt, { boost: false, super: false, invuln: false, tumble: 0 }, gfx.particles, nowS()); }
    gfx.camera.position.lerp(tmpV.copy(me.pos).add(tmpV2.set(0, 30, 50)), 0.02);
    gfx.camera.lookAt(me.pos);
  } else {
    stepAttract(dt);
  }
  world.update(dt, gfx.camera.position);
  gfx.render(dt);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  buildPickers();
  wireLobby();
  const info = await loadHostInfo();
  loadLeaderboard();
  buildWorld(info ? info.seed : 1337);
  gfx.applyPreset('sunset');
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sound.resume(); });
  window.addEventListener('pointerdown', () => sound.resume(), { passive: true });
  requestAnimationFrame(frame);
  window.__sunset = { game, me, remote, rockets, balloons, pickups, mines, decoys, gfx, controls, PILOTS, POWERUPS, get world() { return world; }, get socket() { return socket; } };
}

boot();
