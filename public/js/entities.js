// entities.js - procedural low-poly jets, the Golden Crown, hot-air balloons,
// firework rockets and the golden ribbon contrail. Zero asset files.
import * as THREE from 'three';
import { POWERUPS } from './pilots-data.js';

export const PAINT_COLORS = [
  { name: 'Coral', hex: 0xff5e5b },
  { name: 'Mango', hex: 0xffa63c },
  { name: 'Lemon', hex: 0xffe84a },
  { name: 'Mint', hex: 0x4ff0b0 },
  { name: 'Sky', hex: 0x47c8ff },
  { name: 'Violet', hex: 0x9b6bff },
  { name: 'Bubblegum', hex: 0xff6bd6 },
  { name: 'Pearl', hex: 0xf4f1ea },
];

export const BALLOON_TINTS = [0xff5e5b, 0xffa63c, 0xffe84a, 0x4ff0b0, 0x47c8ff, 0xff6bd6];

export function paintHex(index) {
  return PAINT_COLORS[((index % PAINT_COLORS.length) + PAINT_COLORS.length) % PAINT_COLORS.length].hex;
}
export function paintCss(index) {
  return '#' + paintHex(index).toString(16).padStart(6, '0');
}

// Shared geometries (built once)
const G = {};
function geo(key, build) {
  if (!G[key]) G[key] = build();
  return G[key];
}

// ---------------------------------------------------------------------------
// Jet
// ---------------------------------------------------------------------------
export class Jet {
  /**
   * @param {object} pilot  pilot definition from pilots-data.js (colors.body/wing/trail/accent)
   * @param {string} name   player name shown on the floating tag
   * @param {HTMLCanvasElement|null} portrait  optional portrait drawn next to the name
   */
  constructor(pilot, name, portrait = null) {
    this.group = new THREE.Group();
    this.name = name;
    this.pilot = pilot;
    this.portrait = portrait;
    const paint = pilot.colors.body;
    const wingPaint = pilot.colors.wing;
    const trail = pilot.colors.trail;
    this.trailCss = '#' + trail.toString(16).padStart(6, '0');
    this.bodyMat = new THREE.MeshStandardMaterial({ color: paint, flatShading: true, roughness: 0.55, metalness: 0.15 });
    this.wingMat = new THREE.MeshStandardMaterial({ color: wingPaint, flatShading: true, roughness: 0.55, metalness: 0.15 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2438, flatShading: true, roughness: 0.6, metalness: 0.2 });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x7fe9ff, emissive: 0x2a9ab8, emissiveIntensity: 0.35, flatShading: true, roughness: 0.2, metalness: 0.4 });
    this.burnerMat = new THREE.MeshStandardMaterial({ color: 0xffb060, emissive: 0xff9a2a, emissiveIntensity: 2.8, roughness: 0.4, flatShading: true });

    // Fuselage (nose points toward -Z)
    const fuselage = new THREE.Mesh(geo('fuselage', () => {
      const g = new THREE.CylinderGeometry(0.55, 1.35, 7.5, 6);
      g.rotateX(-Math.PI / 2);
      return g;
    }), this.bodyMat);
    fuselage.position.z = -0.4;
    const nose = new THREE.Mesh(geo('nose', () => {
      const g = new THREE.ConeGeometry(0.55, 2.4, 6);
      g.rotateX(-Math.PI / 2);
      return g;
    }), darkMat);
    nose.position.z = -5.3;
    const tailCone = new THREE.Mesh(geo('tailcone', () => {
      const g = new THREE.CylinderGeometry(1.35, 0.95, 1.6, 6);
      g.rotateX(-Math.PI / 2);
      return g;
    }), darkMat);
    tailCone.position.z = 4.1;

    // Swept wings
    const wing = new THREE.Mesh(geo('wing', () => {
      const shape = new THREE.Shape();
      shape.moveTo(0, -1.2);
      shape.lineTo(6.2, 2.4);
      shape.lineTo(6.2, 3.4);
      shape.lineTo(0, 2.0);
      shape.lineTo(-6.2, 3.4);
      shape.lineTo(-6.2, 2.4);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false });
      g.rotateX(Math.PI / 2);
      g.translate(0, -0.2, 0);
      return g;
    }), this.wingMat);
    // Tail fins
    const vfin = new THREE.Mesh(geo('vfin', () => {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(2.6, 0);
      shape.lineTo(2.2, 2.6);
      shape.lineTo(1.2, 2.6);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false });
      g.rotateY(-Math.PI / 2);
      g.translate(0.15, 0.6, 1.4);
      return g;
    }), this.bodyMat);
    const hfin = new THREE.Mesh(geo('hfin', () => {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(2.6, 1.3);
      shape.lineTo(2.6, 2.0);
      shape.lineTo(0, 1.4);
      shape.lineTo(-2.6, 2.0);
      shape.lineTo(-2.6, 1.3);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: false });
      g.rotateX(Math.PI / 2);
      g.translate(0, 0.3, 2.2);
      return g;
    }), darkMat);
    // Canopy
    const canopy = new THREE.Mesh(geo('canopy', () => {
      const g = new THREE.SphereGeometry(0.9, 8, 6);
      g.scale(0.8, 0.8, 1.8);
      return g;
    }), canopyMat);
    canopy.position.set(0, 0.85, -1.4);
    // Afterburner core (bloomed)
    this.burner = new THREE.Mesh(geo('burner', () => {
      const g = new THREE.ConeGeometry(0.8, 3.0, 6);
      g.rotateX(Math.PI / 2);
      return g;
    }), this.burnerMat);
    this.burner.position.z = 5.6;
    // Wing-tip lights glow in the pilot's trail colour
    const tipMat = new THREE.MeshStandardMaterial({ color: trail, emissive: trail, emissiveIntensity: 1.8 });
    const tipL = new THREE.Mesh(geo('tip', () => new THREE.SphereGeometry(0.28, 6, 4)), tipMat);
    const tipR = tipL.clone();
    tipL.position.set(-6.1, 0, 2.9);
    tipR.position.set(6.1, 0, 2.9);

    const parts = [fuselage, nose, tailCone, wing, vfin, hfin, canopy, this.burner, tipL, tipR];
    for (const m of parts) { m.castShadow = true; m.receiveShadow = false; }
    this.body = new THREE.Group();
    this.body.add(...parts);
    this.group.add(this.body);
    this.opaqueMats = [this.bodyMat, this.wingMat, darkMat, canopyMat, this.burnerMat, tipMat];
    this.ghosted = false;

    // ----- power-up visuals -----
    // Shield Bubble: cyan translucent sphere with a wireframe cage
    this.bubble = new THREE.Group();
    this.bubbleMat = new THREE.MeshStandardMaterial({ color: 0x4ff1ff, emissive: 0x4ff1ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    this.bubble.add(new THREE.Mesh(geo('bubble', () => new THREE.SphereGeometry(8.5, 14, 10)), this.bubbleMat));
    this.bubble.add(new THREE.Mesh(geo('bubbleCage', () => new THREE.IcosahedronGeometry(8.7, 1)), new THREE.MeshBasicMaterial({ color: 0x9ffbff, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false })));
    this.bubble.visible = false;
    this.group.add(this.bubble);
    // Turbo Booster: twin flame cones behind the wings
    this.turboMat = new THREE.MeshStandardMaterial({ color: 0xffc070, emissive: 0xff7a1a, emissiveIntensity: 3.2, transparent: true, opacity: 0.9, flatShading: true });
    this.turboFlames = new THREE.Group();
    for (const sx of [-3.2, 3.2]) {
      const f = new THREE.Mesh(geo('turboFlame', () => { const g = new THREE.ConeGeometry(0.55, 4.5, 5); g.rotateX(Math.PI / 2); return g; }), this.turboMat);
      f.position.set(sx, 0, 5.4);
      this.turboFlames.add(f);
    }
    this.turboFlames.visible = false;
    this.group.add(this.turboFlames);
    // Rapid Fire: red twin barrel glow under the nose
    this.rapidMat = new THREE.MeshStandardMaterial({ color: 0xff5e5b, emissive: 0xff5e5b, emissiveIntensity: 3.0 });
    this.rapidPods = new THREE.Group();
    for (const sx of [-1.1, 1.1]) {
      const pod = new THREE.Mesh(geo('rapidPod', () => { const g = new THREE.CylinderGeometry(0.22, 0.22, 2.2, 6); g.rotateX(Math.PI / 2); return g; }), this.rapidMat);
      pod.position.set(sx, -0.6, -3.2);
      this.rapidPods.add(pod);
    }
    this.rapidPods.visible = false;
    this.group.add(this.rapidPods);
    // Magnet: lime orbit ring around the jet
    this.magnetRing = new THREE.Mesh(geo('magnetRing', () => new THREE.TorusGeometry(9, 0.16, 6, 40)), new THREE.MeshStandardMaterial({ color: 0xb6ff3c, emissive: 0xb6ff3c, emissiveIntensity: 2.6, transparent: true, opacity: 0.8 }));
    this.magnetRing.visible = false;
    this.group.add(this.magnetRing);
    // Score x2: gold halo above the canopy
    this.x2Halo = new THREE.Mesh(geo('x2Halo', () => new THREE.TorusGeometry(1.6, 0.18, 6, 16)), new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0xffd54a, emissiveIntensity: 3.0 }));
    this.x2Halo.position.set(0, 2.6, -1.4);
    this.x2Halo.rotation.x = Math.PI / 2;
    this.x2Halo.visible = false;
    this.group.add(this.x2Halo);
    this.fxTimer = 0;

    // Shield shimmer shown while invulnerable after a crown steal
    this.shield = new THREE.Mesh(
      geo('shield', () => new THREE.IcosahedronGeometry(7.5, 1)),
      new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0xffd54a, emissiveIntensity: 1.2, transparent: true, opacity: 0.18, flatShading: true, depthWrite: false })
    );
    this.shield.visible = false;
    this.group.add(this.shield);

    // Super-charge contrail glow rings
    this.superRing = new THREE.Mesh(
      geo('superring', () => new THREE.TorusGeometry(2.2, 0.22, 6, 18)),
      new THREE.MeshStandardMaterial({ color: 0x4ff1ff, emissive: 0x4ff1ff, emissiveIntensity: 3.5 })
    );
    this.superRing.position.z = 5.2;
    this.superRing.visible = false;
    this.group.add(this.superRing);

    // Name tag (sprite from canvas): portrait + player name + pilot callsign
    this.label = makeLabel(name, this.trailCss, pilot.callsign, portrait);
    this.label.position.y = 4.6;
    this.group.add(this.label);

    // Red vs Blue team ring (set via setTeam; invisible outside team mode)
    this.teamRingMat = new THREE.MeshStandardMaterial({ color: 0xff5e5b, emissive: 0xff5e5b, emissiveIntensity: 2.2, transparent: true, opacity: 0.75 });
    this.teamRing = new THREE.Mesh(geo('teamRing', () => new THREE.TorusGeometry(9.5, 0.45, 6, 40)), this.teamRingMat);
    this.teamRing.rotation.x = Math.PI / 2;
    this.teamRing.position.y = -1.2;
    this.teamRing.visible = false;
    this.group.add(this.teamRing);

    this.exhaustTimer = 0;
    this.tumbleSpin = 0;
    this.trailColors = [new THREE.Color(0xfff2c0), new THREE.Color(trail), new THREE.Color(0x4a4458)];
  }

  setName(name) {
    this.group.remove(this.label);
    this.name = name;
    this.label = makeLabel(name, this.trailCss, this.pilot.callsign, this.portrait);
    this.label.position.y = 4.6;
    this.group.add(this.label);
  }

  /** Red vs Blue: show this jet's team ring (team = 'red' | 'blue' | null). */
  setTeam(team) {
    if (!team) { this.teamRing.visible = false; return; }
    const hex = team === 'blue' ? 0x47c8ff : 0xff5e5b;
    this.teamRingMat.color.setHex(hex);
    this.teamRingMat.emissive.setHex(hex);
    this.teamRing.visible = true;
  }

  /** Ghost power-up: fade every opaque material. */
  _setGhost(on) {
    if (on === this.ghosted) return;
    this.ghosted = on;
    for (const m of this.opaqueMats) {
      m.transparent = on;
      m.opacity = on ? 0.35 : 1;
      m.needsUpdate = true;
    }
  }

  /** Per-frame visual flourish: afterburner size, super ring, shield, power-ups, tumble spin. */
  updateVisual(dt, info, particles, time) {
    const fx = info.fx || {};
    const boostAmt = info.boost ? 1 : 0;
    const superAmt = info.super ? 1 : 0;
    // Power-up visuals
    this.bubble.visible = Boolean(fx.shield);
    if (this.bubble.visible) { this.bubble.rotation.y += dt * 0.8; this.bubble.rotation.z -= dt * 0.5; this.bubbleMat.opacity = 0.14 + Math.sin(time * 6) * 0.04; }
    this.turboFlames.visible = Boolean(fx.turbo);
    if (this.turboFlames.visible) { const k = 1 + Math.sin(time * 50) * 0.25; this.turboFlames.scale.set(1, 1, k); }
    this.rapidPods.visible = Boolean(fx.rapid);
    if (this.rapidPods.visible) this.rapidMat.emissiveIntensity = 2.4 + Math.sin(time * 30) * 1.2;
    this.magnetRing.visible = Boolean(fx.magnet);
    if (this.magnetRing.visible) { this.magnetRing.rotation.x = Math.sin(time * 2) * 0.6; this.magnetRing.rotation.y += dt * 3; }
    this.x2Halo.visible = Boolean(fx.x2);
    if (this.x2Halo.visible) this.x2Halo.rotation.z += dt * 4;
    this._setGhost(Boolean(fx.ghost));
    this.fxTimer -= dt;
    if (particles && this.fxTimer <= 0 && (fx.turbo || fx.magnet || fx.x2)) {
      this.fxTimer = 0.08;
      const col = fx.turbo ? TURBO_COLORS : fx.magnet ? MAGNET_COLORS : GOLD_COLORS;
      const off = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 3, 2 + Math.random() * 5).applyQuaternion(this.group.quaternion).add(this.group.position);
      particles.spawn({ pos: off, vel: { x: (Math.random() - 0.5) * 4, y: 1 + Math.random() * 2, z: (Math.random() - 0.5) * 4 }, life: 0.5, size: 0.5, drag: 1.5, colors: col, glow: 2.2 });
    }
    const s = 0.8 + boostAmt * 0.6 + superAmt * 0.9 + Math.sin(time * 40) * 0.12;
    this.burner.scale.set(1 + boostAmt * 0.3 + superAmt * 0.4, 1 + boostAmt * 0.3 + superAmt * 0.4, s);
    this.burnerMat.emissiveIntensity = 2.6 + boostAmt * 1.0 + superAmt * 1.4;
    this.burnerMat.emissive.setHex(info.super ? 0x4ff1ff : 0xff9a2a);
    this.shield.visible = Boolean(info.invuln);
    if (this.shield.visible) { this.shield.rotation.y += dt * 2; this.shield.rotation.x += dt * 1.3; }
    if (this.teamRing.visible) { this.teamRing.rotation.z += dt * 0.9; this.teamRingMat.emissiveIntensity = 1.8 + Math.sin(time * 4) * 0.6; }
    this.superRing.visible = Boolean(info.super);
    if (this.superRing.visible) this.superRing.rotation.z += dt * 12;
    // Tumble: a harmless 360 spin on hit
    if (info.tumble > 0) {
      this.tumbleSpin = (info.tumble / 0.6) * Math.PI * 2;
      this.body.rotation.x = this.tumbleSpin;
    } else if (this.body.rotation.x !== 0) {
      this.body.rotation.x = 0;
    }
    // Exhaust puffs
    this.exhaustTimer -= dt;
    if (particles && this.exhaustTimer <= 0) {
      this.exhaustTimer = info.boost || info.super ? 0.025 : 0.06;
      const back = new THREE.Vector3(0, 0, 7.5).applyQuaternion(this.group.quaternion).add(this.group.position);
      const spread = 0.6;
      particles.spawn({
        pos: back,
        vel: { x: (Math.random() - 0.5) * spread * 4, y: (Math.random() - 0.5) * spread * 4 + 1, z: (Math.random() - 0.5) * spread * 4 },
        life: info.super ? 0.9 : info.boost ? 0.7 : 0.5,
        size: info.boost || info.super ? 0.9 : 0.6,
        drag: 1.2,
        colors: info.super ? SUPER_COLORS : (info.boost || fx.turbo) ? this.trailColors : EXHAUST_COLORS,
        glow: info.boost || info.super || fx.turbo ? 2.0 : 1.4,
      });
    }
  }

  dispose() {
    this.bodyMat.dispose();
    this.wingMat.dispose();
    this.burnerMat.dispose();
    this.bubbleMat.dispose();
    this.turboMat.dispose();
    this.rapidMat.dispose();
    this.teamRingMat.dispose();
    if (this.label.material.map) this.label.material.map.dispose();
    this.label.material.dispose();
  }
}

const EXHAUST_COLORS = [new THREE.Color(0xfff2c0), new THREE.Color(0xff8a2a), new THREE.Color(0x4a4458)];
const SUPER_COLORS = [new THREE.Color(0xe0ffff), new THREE.Color(0x4ff1ff), new THREE.Color(0x2b3f6e)];
const TURBO_COLORS = [new THREE.Color(0xfff2c0), new THREE.Color(0xff7a1a), new THREE.Color(0x6e2a1d)];
const MAGNET_COLORS = [new THREE.Color(0xf4ffd0), new THREE.Color(0xb6ff3c), new THREE.Color(0x2d5a1d)];
export const SHIELD_COLORS = [new THREE.Color(0xffffff), new THREE.Color(0x4ff1ff), new THREE.Color(0x1d3c6e)];
/** Particle palette for each power-up type (pickup bursts). */
export function powerupPalette(type) {
  const c = new THREE.Color(POWERUPS[type] ? POWERUPS[type].color : 0xffffff);
  return [new THREE.Color(0xffffff), c, c.clone().multiplyScalar(0.3)];
}
export const FIREWORK_PALETTES = [
  [new THREE.Color(0xffffff), new THREE.Color(0xff5e5b), new THREE.Color(0x6e1f3a)],
  [new THREE.Color(0xffffff), new THREE.Color(0x4ff0b0), new THREE.Color(0x1d5a4a)],
  [new THREE.Color(0xffffff), new THREE.Color(0x47c8ff), new THREE.Color(0x1d3c6e)],
  [new THREE.Color(0xffffff), new THREE.Color(0xffe84a), new THREE.Color(0x6e5a1d)],
  [new THREE.Color(0xffffff), new THREE.Color(0xff6bd6), new THREE.Color(0x6e1d5a)],
];
export const SPLASH_COLORS = [new THREE.Color(0xffffff), new THREE.Color(0x9fe8ff), new THREE.Color(0x0f5e78)];
export const GOLD_COLORS = [new THREE.Color(0xfff6c0), new THREE.Color(0xffd54a), new THREE.Color(0x8a5a10)];

function makeLabel(text, color, callsign = '', portrait = null) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  const font = '-apple-system, Segoe UI, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 34px ${font}`;
  const nameW = ctx.measureText(text).width;
  ctx.font = `bold 20px ${font}`;
  const callW = callsign ? ctx.measureText(callsign).width : 0;
  const textW = Math.max(nameW, callW);
  const padL = portrait ? 76 : 16;
  const w = Math.min(312, textW + padL + 16);
  const x0 = 160 - w / 2;
  ctx.fillStyle = 'rgba(20,14,40,0.6)';
  roundRect(ctx, x0, 6, w, 68, 16);
  ctx.fill();
  if (portrait) {
    ctx.save();
    roundRect(ctx, x0 + 8, 12, 56, 56, 12);
    ctx.clip();
    ctx.drawImage(portrait, x0 + 8, 12, 56, 56);
    ctx.restore();
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = color;
  ctx.font = `bold 34px ${font}`;
  ctx.fillText(text, x0 + padL, callsign ? 30 : 40, w - padL - 12);
  if (callsign) {
    ctx.fillStyle = 'rgba(255,246,232,0.8)';
    ctx.font = `bold 20px ${font}`;
    ctx.fillText(callsign, x0 + padL, 58, w - padL - 12);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(12, 3, 1);
  sprite.renderOrder = 5;
  return sprite;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Floating emote: a big emoji drawn onto a canvas sprite (name-tag rendering approach). */
export function makeEmojiSprite(emoji) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = '92px -apple-system, Segoe UI, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(7, 7, 1);
  sprite.renderOrder = 6;
  return sprite;
}

// ---------------------------------------------------------------------------
// Golden Crown
// ---------------------------------------------------------------------------
export class Crown {
  constructor() {
    this.group = new THREE.Group();
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0xffb300, emissiveIntensity: 3.0, roughness: 0.3, metalness: 0.6, flatShading: true });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.7, 1.8, 8, 1, true), this.mat);
    band.material.side = THREE.DoubleSide;
    this.group.add(band);
    for (let i = 0; i < 8; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.75, i % 2 ? 2.4 : 3.4, 4), this.mat);
      const ang = (i / 8) * Math.PI * 2;
      spike.position.set(Math.cos(ang) * 2.9, 1.6 + (i % 2 ? 0.7 : 1.2), Math.sin(ang) * 2.9);
      this.group.add(spike);
    }
    const gemMat = new THREE.MeshStandardMaterial({ color: 0xff4fd8, emissive: 0xff4fd8, emissiveIntensity: 2.5, flatShading: true });
    for (let i = 0; i < 4; i++) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), gemMat);
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 8;
      gem.position.set(Math.cos(ang) * 3.1, 0, Math.sin(ang) * 3.1);
      this.group.add(gem);
    }
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.18, 6, 32), new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffe08a, emissiveIntensity: 2.2, transparent: true, opacity: 0.7 }));
    this.halo.rotation.x = Math.PI / 2;
    this.group.add(this.halo);
    this.group.scale.setScalar(1.3);
    this.glowTimer = 0;
  }

  update(dt, time, loose, particles) {
    this.group.rotation.y += dt * 1.6;
    this.halo.rotation.z += dt * 0.8;
    this.mat.emissiveIntensity = 2.8 + Math.sin(time * 5) * 0.5;
    const s = loose ? 2.2 + Math.sin(time * 3) * 0.15 : 1.3;
    this.group.scale.setScalar(s);
    if (loose) this.group.position.y += Math.sin(time * 2.2) * dt * 1.5;
    this.glowTimer -= dt;
    if (particles && this.glowTimer <= 0) {
      this.glowTimer = loose ? 0.12 : 0.2;
      particles.spawn({
        pos: this.group.position,
        vel: { x: (Math.random() - 0.5) * 6, y: 3 + Math.random() * 4, z: (Math.random() - 0.5) * 6 },
        life: 0.7, size: 0.7, drag: 1.5, colors: GOLD_COLORS, glow: 2.4,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Ribbon contrail of the crown holder (steal by flying through it)
// ---------------------------------------------------------------------------
export class Ribbon {
  constructor(maxPoints = 48) {
    this.maxPoints = maxPoints;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(maxPoints * 2 * 3);
    this.alphas = new Float32Array(maxPoints * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    const indices = [];
    for (let i = 0; i < maxPoints - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }
    geo.setIndex(indices);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0xffd54a) }, time: { value: 0 } },
      vertexShader: `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 color;
        uniform float time;
        varying float vAlpha;
        void main() {
          float shimmer = 0.8 + 0.2 * sin(time * 12.0 + vAlpha * 20.0);
          gl_FragColor = vec4(color * 2.6 * shimmer, vAlpha * 0.85);
        }`,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.count = 0;
  }

  /** points: array of [x, y, z] from oldest to newest. */
  setPoints(points, time) {
    this.mat.uniforms.time.value = time;
    const n = Math.min(points.length, this.maxPoints);
    if (n < 2) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const up = new THREE.Vector3(), dir = new THREE.Vector3(), side = new THREE.Vector3();
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = 0; i < this.maxPoints; i++) {
      const idx = Math.min(i, n - 1);
      const pt = points[points.length - n + idx];
      p.set(pt[0], pt[1], pt[2]);
      const nxt = points[points.length - n + Math.min(idx + 1, n - 1)];
      const prv = points[points.length - n + Math.max(idx - 1, 0)];
      q.set(nxt[0] - prv[0], nxt[1] - prv[1], nxt[2] - prv[2]);
      dir.copy(q).normalize();
      up.set(0, 1, 0);
      side.crossVectors(dir, up).normalize();
      if (side.lengthSq() < 0.01) side.set(1, 0, 0);
      const age = idx / Math.max(1, n - 1);
      const width = 1.2 + age * 1.6;
      const wave = Math.sin(time * 6 + idx * 0.6) * 0.5;
      this.positions[i * 6] = p.x + side.x * width + wave * up.x;
      this.positions[i * 6 + 1] = p.y + side.y * width + wave;
      this.positions[i * 6 + 2] = p.z + side.z * width;
      this.positions[i * 6 + 3] = p.x - side.x * width;
      this.positions[i * 6 + 4] = p.y - side.y * width - wave;
      this.positions[i * 6 + 5] = p.z - side.z * width;
      this.alphas[i * 2] = age * 0.9;
      this.alphas[i * 2 + 1] = age * 0.9;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Hot-air balloons
// ---------------------------------------------------------------------------
export class Balloon {
  constructor(tintIndex) {
    this.group = new THREE.Group();
    const tint = BALLOON_TINTS[tintIndex % BALLOON_TINTS.length];
    this.mat = new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 1.6, flatShading: true, roughness: 0.6 });
    const envelope = new THREE.Mesh(geo('balloon', () => {
      const g = new THREE.SphereGeometry(5, 10, 8);
      g.scale(1, 1.2, 1);
      return g;
    }), this.mat);
    envelope.position.y = 4;
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xfff6e8, emissive: 0xfff6e8, emissiveIntensity: 0.9, flatShading: true });
    const stripe = new THREE.Mesh(geo('balloonStripe', () => new THREE.TorusGeometry(5.05, 0.35, 6, 14)), stripeMat);
    stripe.rotation.x = Math.PI / 2;
    stripe.position.y = 4;
    const basket = new THREE.Mesh(geo('basket', () => new THREE.BoxGeometry(2.2, 1.6, 2.2)), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, flatShading: true, roughness: 0.9 }));
    basket.position.y = -3.6;
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x4a4458 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const rope = new THREE.Mesh(geo('rope', () => new THREE.CylinderGeometry(0.08, 0.08, 3.4, 3)), ropeMat);
        rope.position.set(sx * 1.6, -1.6, sz * 1.6);
        rope.rotation.z = sx * 0.35;
        rope.rotation.x = -sz * 0.35;
        this.group.add(rope);
      }
    }
    envelope.castShadow = true;
    this.group.add(envelope, stripe, basket);
    this.bobPhase = Math.random() * Math.PI * 2;
    this.baseY = 0;
    this.tint = tint;
  }

  setPosition(x, y, z) {
    this.baseY = y;
    this.group.position.set(x, y, z);
  }

  update(dt, time) {
    this.group.position.y = this.baseY + Math.sin(time * 0.9 + this.bobPhase) * 1.5;
    this.group.rotation.y += dt * 0.25;
  }
}

// ---------------------------------------------------------------------------
// Firework rocket
// ---------------------------------------------------------------------------
export class Rocket {
  /** @param {number} paint hex colour of the firing pilot's trail */
  constructor(paint) {
    this.group = new THREE.Group();
    this.headMat = new THREE.MeshStandardMaterial({ color: paint, emissive: paint, emissiveIntensity: 3.6, flatShading: true });
    const head = new THREE.Mesh(geo('rocketHead', () => {
      const g = new THREE.ConeGeometry(0.9, 2.2, 6);
      g.rotateX(-Math.PI / 2);
      return g;
    }), this.headMat);
    head.position.z = -1.6;
    const body = new THREE.Mesh(geo('rocketBody', () => {
      const g = new THREE.CylinderGeometry(0.75, 0.75, 2.6, 6);
      g.rotateX(-Math.PI / 2);
      return g;
    }), new THREE.MeshStandardMaterial({ color: 0xfff6e8, flatShading: true, roughness: 0.5 }));
    body.position.z = 0.6;
    const fins = new THREE.Mesh(geo('rocketFins', () => {
      const g = new THREE.ConeGeometry(1.5, 1.4, 4);
      g.rotateX(Math.PI / 2);
      return g;
    }), new THREE.MeshStandardMaterial({ color: 0x2a2438, flatShading: true }));
    fins.position.z = 2.0;
    const flame = new THREE.Mesh(geo('rocketFlame', () => {
      const g = new THREE.ConeGeometry(0.6, 2.4, 5);
      g.rotateX(Math.PI / 2);
      return g;
    }), new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb347, emissiveIntensity: 3.0 }));
    flame.position.z = 3.2;
    this.group.add(head, body, fins, flame);
    this.trailTimer = 0;
    this.colors = [new THREE.Color(0xffffff), new THREE.Color(paint), new THREE.Color(0x4a4458)];
  }

  update(dt, particles) {
    this.trailTimer -= dt;
    if (particles && this.trailTimer <= 0) {
      this.trailTimer = 0.03;
      const back = new THREE.Vector3(0, 0, 3.5).applyQuaternion(this.group.quaternion).add(this.group.position);
      particles.spawn({
        pos: back,
        vel: { x: (Math.random() - 0.5) * 5, y: (Math.random() - 0.5) * 5, z: (Math.random() - 0.5) * 5 },
        life: 0.55, size: 1.0, drag: 1.0, colors: this.colors, glow: 1.8,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Power-up pickup orbs: glowing core + type-specific inner symbol + orbit ring.
// ---------------------------------------------------------------------------
export class Pickup {
  constructor(type) {
    this.type = type;
    this.group = new THREE.Group();
    const def = POWERUPS[type] || POWERUPS.turbo;
    const col = def.color;
    this.coreMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.2, transparent: true, opacity: 0.55, flatShading: true, depthWrite: false });
    this.symbolMat = new THREE.MeshStandardMaterial({ color: 0xfff6e8, emissive: col, emissiveIntensity: 3.2, flatShading: true });
    this.ringMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.6, transparent: true, opacity: 0.85 });
    this.core = new THREE.Mesh(geo('pickupCore', () => new THREE.IcosahedronGeometry(4.2, 1)), this.coreMat);
    this.group.add(this.core);
    this.cage = new THREE.Mesh(geo('pickupCage', () => new THREE.IcosahedronGeometry(4.6, 0)), new THREE.MeshBasicMaterial({ color: col, wireframe: true, transparent: true, opacity: 0.6 }));
    this.group.add(this.cage);
    this.symbol = new THREE.Group();
    switch (type) {
      case 'turbo': {
        const m = new THREE.Mesh(geo('pkTurbo', () => { const g = new THREE.ConeGeometry(1.3, 3.4, 4); g.rotateX(Math.PI / 2); return g; }), this.symbolMat);
        const m2 = m.clone(); m2.position.z = 1.2; m2.scale.setScalar(0.65);
        m.position.z = -1.2;
        this.symbol.add(m, m2);
        break;
      }
      case 'shield': {
        const m = new THREE.Mesh(geo('pkShield', () => new THREE.OctahedronGeometry(2.1, 0)), this.symbolMat);
        m.scale.set(1, 1.35, 0.45);
        this.symbol.add(m);
        break;
      }
      case 'rapid': {
        for (let i = 0; i < 3; i++) {
          const m = new THREE.Mesh(geo('pkRapid', () => { const g = new THREE.CylinderGeometry(0.4, 0.4, 3.2, 5); g.rotateX(Math.PI / 2); return g; }), this.symbolMat);
          m.position.set((i - 1) * 1.3, 0, 0);
          this.symbol.add(m);
        }
        break;
      }
      case 'magnet': {
        const m = new THREE.Mesh(geo('pkMagnet', () => new THREE.TorusGeometry(1.7, 0.5, 6, 12, Math.PI)), this.symbolMat);
        m.rotation.z = Math.PI;
        const tipMat = new THREE.MeshStandardMaterial({ color: 0xff5e5b, emissive: 0xff5e5b, emissiveIntensity: 2.4, flatShading: true });
        for (const sx of [-1.7, 1.7]) {
          const tip = new THREE.Mesh(geo('pkMagnetTip', () => new THREE.BoxGeometry(1.0, 1.1, 1.0)), tipMat);
          tip.position.set(sx, 0.9, 0);
          this.symbol.add(tip);
        }
        this.symbol.add(m);
        break;
      }
      case 'ghost': {
        const m = new THREE.Mesh(geo('pkGhost', () => { const g = new THREE.SphereGeometry(1.9, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.62); return g; }), this.symbolMat);
        m.position.y = 0.4;
        this.symbol.add(m);
        const skirt = new THREE.Mesh(geo('pkGhostSkirt', () => new THREE.ConeGeometry(1.9, 1.6, 8, 1, true)), this.symbolMat);
        skirt.rotation.x = Math.PI;
        skirt.position.y = -0.6;
        this.symbol.add(skirt);
        break;
      }
      case 'mine': {
        const m = new THREE.Mesh(geo('pkMine', () => new THREE.IcosahedronGeometry(1.5, 0)), this.symbolMat);
        this.symbol.add(m);
        const spGeo = geo('pkMineSp', () => { const g = new THREE.ConeGeometry(0.4, 1.2, 4); g.rotateX(Math.PI / 2); return g; });
        for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const sp = new THREE.Mesh(spGeo, this.symbolMat);
          sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(x, y, z));
          sp.position.set(x * 1.3, y * 1.3, z * 1.3);
          this.symbol.add(sp);
        }
        break;
      }
      case 'decoy': {
        const fuselage = new THREE.Mesh(geo('pkDecoyFus', () => { const g = new THREE.ConeGeometry(0.9, 2.8, 4); g.rotateX(Math.PI / 2); return g; }), this.symbolMat);
        const wings = new THREE.Mesh(geo('pkDecoyWing', () => new THREE.BoxGeometry(3.0, 0.15, 1.2)), this.symbolMat);
        this.symbol.add(fuselage, wings);
        break;
      }
      default: {
        // x2: a pair of spinning diamonds
        for (const sx of [-1.3, 1.3]) {
          const m = new THREE.Mesh(geo('pkX2', () => new THREE.OctahedronGeometry(1.3, 0)), this.symbolMat);
          m.position.x = sx;
          this.symbol.add(m);
        }
      }
    }
    this.group.add(this.symbol);
    this.ring = new THREE.Mesh(geo('pickupRing', () => new THREE.TorusGeometry(6.2, 0.22, 6, 30)), this.ringMat);
    this.ring.rotation.x = Math.PI / 2;
    this.group.add(this.ring);
    this.baseY = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.sparkTimer = 0;
  }

  setPosition(x, y, z) {
    this.baseY = y;
    this.group.position.set(x, y, z);
  }

  update(dt, time, particles) {
    this.group.position.y = this.baseY + Math.sin(time * 1.4 + this.phase) * 1.8;
    this.symbol.rotation.y += dt * 2.2;
    this.cage.rotation.y -= dt * 0.7;
    this.cage.rotation.x += dt * 0.4;
    this.ring.rotation.z += dt * 1.5;
    this.ring.rotation.x = Math.PI / 2 + Math.sin(time * 1.1 + this.phase) * 0.35;
    const pulse = 1 + Math.sin(time * 4 + this.phase) * 0.08;
    this.core.scale.setScalar(pulse);
    this.coreMat.emissiveIntensity = 1.9 + Math.sin(time * 4 + this.phase) * 0.5;
    this.sparkTimer -= dt;
    if (particles && this.sparkTimer <= 0) {
      this.sparkTimer = 0.25;
      particles.spawn({
        pos: this.group.position,
        vel: { x: (Math.random() - 0.5) * 5, y: 2 + Math.random() * 3, z: (Math.random() - 0.5) * 5 },
        life: 0.8, size: 0.5, drag: 1.2, colors: powerupPalette(this.type), glow: 2.0,
      });
    }
  }

  dispose() {
    this.coreMat.dispose();
    this.symbolMat.dispose();
    this.ringMat.dispose();
  }
}

// ---------------------------------------------------------------------------
// Sky Mine: hovering proximity mine with pulsing warning spikes
// ---------------------------------------------------------------------------
export class Mine {
  constructor() {
    this.group = new THREE.Group();
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xff3366,
      emissive: 0xff2244,
      emissiveIntensity: 2.2,
      roughness: 0.3,
      metalness: 0.2,
      flatShading: true,
    });
    const core = new THREE.Mesh(geo('mineBody', () => new THREE.IcosahedronGeometry(2.0, 1)), this.mat);
    this.group.add(core);
    const spikeGeo = geo('mineSpike', () => {
      const g = new THREE.ConeGeometry(0.6, 1.5, 4);
      g.rotateX(Math.PI / 2);
      return g;
    });
    for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const sp = new THREE.Mesh(spikeGeo, this.mat);
      sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(x, y, z));
      sp.position.set(x * 1.6, y * 1.6, z * 1.6);
      this.group.add(sp);
    }
  }

  setPosition(x, y, z) {
    this.group.position.set(x, y, z);
  }

  update(dt, t, armed) {
    this.group.rotation.x += dt * (armed ? 2.5 : 0.8);
    this.group.rotation.y += dt * (armed ? 3.0 : 1.0);
    const pulse = armed ? 3.2 + Math.sin(t * 12) * 2.0 : 1.4 + Math.sin(t * 3) * 0.6;
    this.mat.emissiveIntensity = pulse;
  }

  dispose() {
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------
// Meteor (Meteor Shower event): flaming rock with a fire trail
// ---------------------------------------------------------------------------
export class Meteor {
  constructor() {
    this.group = new THREE.Group();
    this.mat = new THREE.MeshStandardMaterial({ color: 0x5a4634, emissive: 0xff5a1a, emissiveIntensity: 2.6, flatShading: true, roughness: 0.9 });
    const rock = new THREE.Mesh(geo('meteorRock', () => new THREE.IcosahedronGeometry(2.6, 0)), this.mat);
    rock.castShadow = true;
    this.group.add(rock);
    this.fireMat = new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xff8c2a, emissiveIntensity: 3.2, transparent: true, opacity: 0.85, depthWrite: false });
    const fire = new THREE.Mesh(geo('meteorFire', () => { const g = new THREE.ConeGeometry(1.6, 4.4, 5); g.rotateX(Math.PI / 2); return g; }), this.fireMat);
    fire.position.z = 3.0;
    this.group.add(fire);
    this.trailTimer = 0;
    this.colors = [new THREE.Color(0xfff1a8), new THREE.Color(0xff8c2a), new THREE.Color(0x8a2b0a)];
  }

  setPosition(x, y, z) {
    this.group.position.set(x, y, z);
  }

  update(dt, particles) {
    this.group.rotation.x += dt * 2.2;
    this.group.rotation.y += dt * 1.6;
    this.trailTimer -= dt;
    if (particles && this.trailTimer <= 0) {
      this.trailTimer = 0.04;
      particles.spawn({
        pos: this.group.position,
        vel: { x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 },
        life: 0.6, size: 1.4, drag: 1.1, colors: this.colors, glow: 2.2,
      });
    }
  }

  dispose() {
    this.mat.dispose();
    this.fireMat.dispose();
  }
}
