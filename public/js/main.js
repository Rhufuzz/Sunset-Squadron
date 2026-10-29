// main.js - game state machine, Socket.io client, 60fps render + local flight prediction,
// remote interpolation, HUD and lobby wiring.
import * as THREE from 'three';
import { Graphics, PRESETS } from './graphics.js';
import { World, islandCollision, WATER_LEVEL, WORLD_RADIUS, CEILING } from './world.js';
import { Jet, Crown, Ribbon, Balloon, Rocket, PAINT_COLORS, paintCss, FIREWORK_PALETTES, SPLASH_COLORS, GOLD_COLORS } from './entities.js';
import { Controls } from './controls.js';
import { SoundEngine } from './audio.js';

// ---------------------------------------------------------------------------
// Constants shared with the server flight model
// ---------------------------------------------------------------------------
const SPEED_BASE = 48;
const SPEED_BOOST = 85;
const SPEED_SUPER = 100;
const ROCKET_SPEED = 130;
const ROCKET_COOLDOWN = 1.2;
const ROCKET_COOLDOWN_SUPER = 0.6;
const BARREL_ROLL_TIME = 0.45;
const STATE_SEND_MS = 50;
const LERP = 0.25;

const CALLSIGNS = ['Renji', 'Resa', 'Kaya', 'Viper', 'Falcon', 'Nova', 'Blaze', 'Maverick', 'Comet', 'Echo', 'Bolt'];
const STORY = new Set(['Renji', 'Resa', 'Kaya']);
const MODE_LABEL = { crown: 'CROWN TAG', blitz: 'ARCH & BALLOON BLITZ' };

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
  callsignPicker: $('callsign-picker'), colorPicker: $('color-picker'),
  btnLaunch: $('btn-launch'), btnStart: $('btn-start'), joinError: $('join-error'), hostWait: $('host-wait'),
  modeToggle: $('mode-toggle'), presetToggle: $('preset-toggle'), botsToggle: $('bots-toggle'),
  hudMode: $('hud-mode'), hudTimer: $('hud-timer'), hudCrown: $('hud-crown'), hudName: $('hud-name'), hudScore: $('hud-score'),
  hudStamina: $('hud-stamina'), hudCooldown: $('hud-cooldown'), hudSpeed: $('hud-speed'), hudBoard: $('hud-board'),
  hudFeed: $('hud-feed'), hudBanner: $('hud-banner'), crownArrow: $('crown-arrow'),
  resultsTitle: $('results-title'), resultsList: $('results-list'),
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
  pilotName: CALLSIGNS[0],
  pilotColor: 0,
  lobby: null,
  mode: 'crown',
  preset: 'sunset',
  seed: 1,
  endsAt: 0,
  serverOffset: 0,
  timeRemaining: 180,
  lastSnap: null,
  lastSnapAt: 0,
  crownHolderId: null,
  names: new Map(),        // id -> { name, color, isBot }
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
  quat: new THREE.Quaternion(),
  lastSplash: 0,
  lastBump: 0,
  wasBoosting: false,
  jet: null,
};

const remote = new Map();   // id -> { jet, pos, quat, spd, info, lastAt, forward }
const rockets = new Map();  // id -> { mesh: Rocket, pos, dir, lastAt }
const balloons = new Map(); // id -> { mesh: Balloon, alive }
let crown = null;
let ribbon = null;
let lastStateSent = 0;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const FWD = new THREE.Vector3(0, 0, -1);

// ---------------------------------------------------------------------------
// Lobby UI
// ---------------------------------------------------------------------------
function buildPickers() {
  const savedName = localStorage.getItem('ss_name');
  const savedColor = parseInt(localStorage.getItem('ss_color'), 10);
  if (savedName && CALLSIGNS.includes(savedName)) game.pilotName = savedName;
  if (!Number.isNaN(savedColor)) game.pilotColor = clamp(savedColor, 0, 7);
  ui.callsignPicker.innerHTML = '';
  for (const name of CALLSIGNS) {
    const b = document.createElement('button');
    b.textContent = name;
    b.type = 'button';
    if (STORY.has(name)) b.classList.add('story-char');
    if (name === game.pilotName) b.classList.add('active');
    b.addEventListener('click', () => {
      game.pilotName = name;
      localStorage.setItem('ss_name', name);
      for (const c of ui.callsignPicker.children) c.classList.toggle('active', c.textContent === name);
    });
    ui.callsignPicker.appendChild(b);
  }
  ui.colorPicker.innerHTML = '';
  PAINT_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = c.name;
    b.style.background = paintCss(i);
    b.style.color = paintCss(i);
    if (i === game.pilotColor) b.classList.add('active');
    b.addEventListener('click', () => {
      game.pilotColor = i;
      localStorage.setItem('ss_color', String(i));
      Array.from(ui.colorPicker.children).forEach((el, j) => el.classList.toggle('active', j === i));
    });
    ui.colorPicker.appendChild(b);
  });
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
    game.names.set(p.id, { name: p.name, color: p.color, isBot: p.isBot });
    const li = document.createElement('li');
    if (p.isBot) li.classList.add('bot');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = paintCss(p.color);
    dot.style.color = paintCss(p.color);
    li.appendChild(dot);
    const nm = document.createElement('span');
    nm.textContent = p.name;
    li.appendChild(nm);
    if (p.id === lobby.hostId) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'HOST';
      li.appendChild(tag);
    }
    if (p.id === game.myId) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'YOU';
      li.appendChild(tag);
    }
    ui.roster.appendChild(li);
  }
  const humans = lobby.players.filter((p) => !p.isBot).length;
  ui.rosterCount.textContent = `${humans}/8 pilots · ${lobby.settings.bots} AI wingmen`;
  for (const b of ui.modeToggle.children) b.classList.toggle('active', b.dataset.mode === lobby.settings.mode);
  for (const b of ui.presetToggle.children) b.classList.toggle('active', b.dataset.preset === lobby.settings.preset);
  for (const b of ui.botsToggle.children) b.classList.toggle('active', Number(b.dataset.bots) === lobby.settings.bots);
  ui.rosterPanel.querySelector('.settings').classList.toggle('locked', !isHost);
  ui.btnStart.classList.toggle('hidden', !isHost);
  ui.btnStart.disabled = lobby.phase !== 'lobby';
  ui.btnStart.textContent = lobby.phase === 'lobby' ? 'START ROUND' : 'ROUND IN PROGRESS';
  ui.hostWait.classList.toggle('hidden', isHost);
  ui.hostWait.textContent = lobby.phase === 'playing' ? 'A round is in progress - you will drop in when the host starts the next one or you join now…' : 'Waiting for the host to start the round…';
  if (lobby.settings.preset !== game.preset) {
    game.preset = lobby.settings.preset;
    gfx.applyPreset(game.preset);
  }
  game.mode = lobby.settings.mode;
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
}

function doJoin() {
  if (!socket) return;
  socket.emit('join', { name: game.pilotName, color: game.pilotColor }, (ack) => {
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
  if (crown) { gfx.scene.remove(crown.group); crown = null; }
  if (ribbon) { gfx.scene.remove(ribbon.mesh); ribbon = null; }
  ui.hudFeed.innerHTML = '';
}

function buildWorld(seed) {
  if (world && world.seed === seed) return;
  if (world) world.dispose();
  world = new World(gfx.scene, seed);
  gfx.attachWorld(world);
  game.seed = seed;
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

  for (const p of data.players) game.names.set(p.id, { name: p.name, color: p.color, isBot: p.isBot });

  // Local jet
  const self = data.players.find((p) => p.id === game.myId);
  if (me.jet) { gfx.scene.remove(me.jet.group); me.jet.dispose(); }
  me.jet = new Jet(game.pilotColor, game.pilotName);
  gfx.scene.add(me.jet.group);
  if (self) { me.pos.set(self.pos.x, self.pos.y, self.pos.z); me.yaw = self.yaw; }
  else { me.pos.set(0, 90, 260); me.yaw = 0; }
  me.pitch = 0; me.roll = 0; me.speed = SPEED_BASE; me.stamina = 1; me.rollingUntil = 0; me.tumble = 0;
  me.superUntil = 0; me.invuln = false; me.lastFire = -10; me.score = 0;
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

  // UI
  ui.lobby.classList.add('hidden');
  ui.results.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  ui.touch.classList.remove('hidden');
  ui.hudMode.textContent = MODE_LABEL[data.mode] || data.mode.toUpperCase();
  ui.hudName.textContent = game.pilotName;
  ui.hudScore.textContent = '0';
  controls.setEnabled(true);
  checkOrientation();
  showBanner(data.mode === 'crown' ? 'CHASE THE CROWN!' : 'POP & DIVE!');
  sound.fanfare(0.7);
  addFeed(data.mode === 'crown' ? 'Grab the Golden Crown: +1 pt every second you hold it' : 'Balloons +10 · Ring gates +25 and SUPER-CHARGE');
}

function endRound(results) {
  game.phase = 'ended';
  controls.setEnabled(false);
  ui.touch.classList.add('hidden');
  ui.results.classList.remove('hidden');
  ui.resultsTitle.textContent = results.results.length && results.results[0].id === game.myId ? 'YOU WIN!' : 'ROUND OVER';
  ui.resultsList.innerHTML = '';
  results.results.forEach((r, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="rank">${i + 1}.</span><span class="dot" style="background:${paintCss(r.color)};color:${paintCss(r.color)}"></span><span class="nm">${escapeHtml(r.name)}${r.id === game.myId ? ' (you)' : ''}</span><span class="sc">${r.score}</span>`;
    ui.resultsList.appendChild(li);
  });
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
  const seen = new Set();
  for (const p of snap.players) {
    seen.add(p.id);
    if (p.id === game.myId) {
      me.score = p.sc;
      me.superUntil = p.su > 0 ? t + p.su : 0;
      me.invuln = Boolean(p.iv);
      if (p.tu > 0) me.tumble = Math.max(me.tumble, p.tu);
      continue;
    }
    let r = remote.get(p.id);
    if (!r) {
      const info = game.names.get(p.id) || { name: 'Pilot', color: 0 };
      const jet = new Jet(info.color, info.name);
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
    r.info = { boost: Boolean(p.b), super: p.su > 0, invuln: Boolean(p.iv), tumble: p.tu, score: p.sc };
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
      const info = game.names.get(rk.o) || { color: 0 };
      const mesh = new Rocket(info.color);
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
  // Crown + ribbon
  if (crown) {
    if (!snap.crownHolderId) crown.group.position.lerp(arrToV(snap.crownPos), 0.5);
  }
  if (ribbon) ribbon.setPoints(snap.ribbon || [], t);
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
    addFeed(e.crownStolen ? `${nameOf(e.shooter)} stole your crown!` : `${nameOf(e.shooter)} tagged you with a firework!`);
  } else if (e.shooter === game.myId) {
    addFeed(e.crownStolen ? `You stole the crown from ${nameOf(e.victim)}!` : `Direct hit on ${nameOf(e.victim)}!`);
    if (game.mode === 'blitz') showBanner('+5');
  } else if (e.crownStolen) {
    addFeed(`${nameOf(e.shooter)} ${e.ribbon ? 'flew through the ribbon and' : ''} stole the crown from ${nameOf(e.victim)}`);
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
  gfx.particles.burst(p, 40, 26, { colors: SPLASH_COLORS, life: 1.1, size: 1.8 });
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
  const rows = snap.players
    .map((p) => ({ id: p.id, sc: p.sc, ...(game.names.get(p.id) || { name: 'Pilot', color: 0 }) }))
    .sort((a, b) => b.sc - a.sc)
    .slice(0, 8);
  const html = rows.map((r) => `<div class="row${r.id === game.myId ? ' me' : ''}${r.id === snap.crownHolderId ? ' crown' : ''}"><span class="dot" style="background:${paintCss(r.color)};color:${paintCss(r.color)}"></span><span class="nm">${escapeHtml(r.name)}</span><span class="sc">${r.sc}</span></div>`).join('');
  if (html !== boardHtml) { boardHtml = html; ui.hudBoard.innerHTML = html; }
  const holder = snap.crownHolderId ? nameOf(snap.crownHolderId) : (game.mode === 'crown' ? 'loose!' : '');
  ui.hudCrown.textContent = game.mode === 'crown' ? `👑 ${holder}` : `🎈 ${snap.balloons.filter(Boolean).length} left`;
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

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
  if (controls.takeRollTap() && t >= me.rollingUntil) {
    me.rollingUntil = t + BARREL_ROLL_TIME;
    sound.rollSwoosh();
    if (socket) socket.emit('barrelRoll');
  }
  const sup = t < me.superUntil;
  if (boost && me.stamina > 0.02) me.stamina = Math.max(0, me.stamina - dt * 0.45);
  else { boost = false; me.stamina = Math.min(1, me.stamina + dt * 0.28); }
  if (boost && !me.wasBoosting) sound.boostWhoosh(0.8);
  me.wasBoosting = boost;
  me.boost = boost;
  const target = sup ? SPEED_SUPER : (boost || me.invuln) ? SPEED_BOOST : SPEED_BASE;
  me.speed = lerp(me.speed, target, Math.min(1, dt * 3));
  me.yaw = wrapAngle(me.yaw + -joyX * 2.1 * dt);
  me.pitch = lerp(me.pitch, -joyY * 0.75, Math.min(1, dt * 6));
  me.roll = lerp(me.roll, -joyX * 1.05, Math.min(1, dt * 8));
  forwardFromYP(tmpV, me.yaw, me.pitch);
  me.pos.addScaledVector(tmpV, me.speed * dt);

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
  if (t < me.rollingUntil) visualRoll += ((me.rollingUntil - t) / BARREL_ROLL_TIME) * Math.PI * 2;
  quatFromYPR(me.quat, me.yaw, me.pitch, visualRoll);
  me.jet.group.position.copy(me.pos);
  me.jet.group.quaternion.copy(me.quat);
  if (me.tumble > 0) me.tumble = Math.max(0, me.tumble - dt);
  me.jet.updateVisual(dt, { boost, super: sup, invuln: me.invuln, tumble: me.tumble }, gfx.particles, t);

  // Fire
  const cd = sup ? ROCKET_COOLDOWN_SUPER : ROCKET_COOLDOWN;
  if (controls.fire && t - me.lastFire >= cd) {
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
}

function updateCrownArrow() {
  if (game.mode !== 'crown' || !crown) { ui.crownArrow.classList.add('hidden'); return; }
  if (game.crownHolderId === game.myId) { ui.crownArrow.classList.add('hidden'); return; }
  const target = crown.group.position;
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
    r.jet.updateVisual(dt, { boost: r.info.boost, super: r.info.super, invuln: r.info.invuln, tumble: r.tumble }, gfx.particles, t);
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
  buildWorld(info ? info.seed : 1337);
  gfx.applyPreset('sunset');
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sound.resume(); });
  window.addEventListener('pointerdown', () => sound.resume(), { passive: true });
  requestAnimationFrame(frame);
  window.__sunset = { game, me, remote, rockets, balloons, gfx, controls, get world() { return world; }, get socket() { return socket; } };
}

boot();
