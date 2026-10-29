// world.js - seeded PRNG, deterministic archipelago layout, procedural islands,
// stone arches with neon ring gates, animated low-poly ocean, gradient sky dome and clouds.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WATER_LEVEL = 0;
export const WORLD_RADIUS = 950;
export const CEILING = 260;

// ---------------------------------------------------------------------------
// Shared deterministic layout (identical code lives in server.js)
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBalloonPos(rand, islands) {
  for (let tries = 0; tries < 20; tries++) {
    const ang = rand() * Math.PI * 2;
    const dist = 60 + rand() * 560;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    const y = 30 + rand() * 110;
    let ok = true;
    for (const isl of islands) {
      if (Math.hypot(x - isl.x, z - isl.z) < isl.rx + 12 && y < isl.cy + isl.ry + 20 && y > isl.cy - isl.ry - 10) {
        ok = false;
        break;
      }
    }
    if (ok) return { x, y, z };
  }
  return { x: 0, y: 160, z: 0 };
}

export function generateLayout(seed) {
  const rand = mulberry32(seed);
  const islands = [];
  islands.push({ kind: 'central', x: 0, y: 0, z: 0, r: 110, cx: 0, cy: 2, cz: 0, rx: 108, ry: 46 });
  const outer = 6;
  for (let i = 0; i < outer; i++) {
    const ang = (i / outer) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const dist = 300 + rand() * 140;
    const r = 42 + rand() * 34;
    const y = 40 + rand() * 70;
    islands.push({
      kind: 'floating',
      x: Math.cos(ang) * dist,
      y,
      z: Math.sin(ang) * dist,
      r,
      cx: Math.cos(ang) * dist,
      cy: y - r * 0.3,
      cz: Math.sin(ang) * dist,
      rx: r * 1.02,
      ry: r * 0.75,
    });
  }
  const arches = [];
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + (rand() - 0.5) * 0.3;
    const dist = 170 + rand() * 330;
    let x = Math.cos(ang) * dist;
    let z = Math.sin(ang) * dist;
    for (const isl of islands) {
      const dx = x - isl.x;
      const dz = z - isl.z;
      const d = Math.hypot(dx, dz);
      if (d < isl.rx + 34) {
        const k = (isl.rx + 34) / Math.max(d, 1);
        x = isl.x + dx * k;
        z = isl.z + dz * k;
      }
    }
    const y = 35 + rand() * 90;
    const yaw = rand() * Math.PI * 2;
    arches.push({ id: i, x, y, z, yaw, r: 14, gateR: 10, hue: i % 2 });
  }
  const balloons = [];
  for (let i = 0; i < 40; i++) {
    const p = randomBalloonPos(rand, islands);
    balloons.push({ id: i, x: p.x, y: p.y, z: p.z, tint: Math.floor(rand() * 6) });
  }
  const clouds = [];
  for (let i = 0; i < 36; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = 100 + rand() * 900;
    clouds.push({ x: Math.cos(ang) * dist, y: 150 + rand() * 120, z: Math.sin(ang) * dist, s: 10 + rand() * 18, puffs: 3 + Math.floor(rand() * 4) });
  }
  return { seed, islands, arches, balloons, clouds };
}

/** Returns { n: THREE.Vector3 outward normal, push, island } if pos is inside an island ellipsoid, else null. */
export function islandCollision(pos, islands) {
  for (const isl of islands) {
    const dx = (pos.x - isl.cx) / isl.rx;
    const dy = (pos.y - isl.cy) / isl.ry;
    const dz = (pos.z - isl.cz) / isl.rx;
    const q = dx * dx + dy * dy + dz * dz;
    if (q < 1) {
      const n = new THREE.Vector3(dx / isl.rx, dy / isl.ry, dz / isl.rx).normalize();
      const push = (1 - Math.sqrt(q)) * Math.min(isl.rx, isl.ry) + 2;
      return { n, push, island: isl };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Procedural geometry helpers
// ---------------------------------------------------------------------------
function noise3(x, y, z) {
  // Cheap trigonometric 3D noise in roughly [-1, 1]
  return (
    Math.sin(x * 0.11 + Math.sin(z * 0.07) * 1.5) * Math.cos(z * 0.09 + y * 0.05) * 0.6 +
    Math.sin(x * 0.23 + z * 0.19 + y * 0.13) * 0.3 +
    Math.cos(x * 0.41 - z * 0.37 + y * 0.29) * 0.1
  );
}

const C_SAND = new THREE.Color('#e8c170');
const C_GRASS = new THREE.Color('#3ca370');
const C_GRASS2 = new THREE.Color('#5ec98a');
const C_CLIFF_HI = new THREE.Color('#b85d43');
const C_CLIFF_LO = new THREE.Color('#4a4458');

/** Colour every face of a non-indexed geometry from world-space height and face normal. */
function paintTerrain(geo, meshY, base, top, rand) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    const y = (a.y + b.y + c.y) / 3 + meshY;
    const ny = n.y;
    if (y < 4) tmp.copy(C_SAND);
    else if (ny > 0.65) tmp.copy(C_GRASS).lerp(C_GRASS2, rand() * 0.5);
    else {
      const k = THREE.MathUtils.clamp((y - base) / Math.max(1, top - base), 0, 1);
      tmp.copy(C_CLIFF_LO).lerp(C_CLIFF_HI, Math.pow(k, 0.8));
    }
    const v = 1 + (rand() - 0.5) * 0.09;
    tmp.r *= v; tmp.g *= v; tmp.b *= v;
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = tmp.r;
      colors[(i + k) * 3 + 1] = tmp.g;
      colors[(i + k) * 3 + 2] = tmp.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function buildCentralIsland(isl, rand) {
  const base = -32, top = 42;
  let geo = new THREE.CylinderGeometry(80, 120, top - base, 30, 8);
  geo.translate(0, (top + base) / 2, 0);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const ox = rand() * 100, oz = rand() * 100;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const rr = Math.hypot(v.x, v.z);
    const nz = noise3(v.x + ox, v.y, v.z + oz);
    if (v.y > top - 0.01) {
      // Caldera: top disc sinks toward the middle to form a lake basin
      const crater = THREE.MathUtils.smoothstep(rr, 20, 60);
      v.y = top - (1 - crater) * 20 + nz * 3 + (rr > 25 ? Math.abs(noise3(v.x * 2 + ox, 0, v.z * 2)) * 10 : 0);
    } else if (v.y < base + 0.01) {
      v.y = base + nz * 4;
    } else {
      const k = 1 + nz * 0.12;
      v.x *= k; v.z *= k;
      v.y += nz * 4;
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  paintTerrain(geo, 0, base, top, rand);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  // Caldera lake
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(24, 18),
    new THREE.MeshStandardMaterial({ color: 0x1f8fa8, emissive: 0x0f5e78, emissiveIntensity: 0.4, roughness: 0.2, metalness: 0.1, flatShading: true })
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.y = top - 17;
  group.add(lake);
  group.add(buildPalms(rand, 22, (r) => {
    const ang = r() * Math.PI * 2;
    const d = 62 + r() * 32;
    return new THREE.Vector3(Math.cos(ang) * d, top + 1, Math.sin(ang) * d);
  }));
  return group;
}

function buildFloatingIsland(isl, rand) {
  const r = isl.r;
  let geo = new THREE.IcosahedronGeometry(r, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const ox = rand() * 100, oz = rand() * 100;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const nz = noise3(v.x * 1.6 + ox, v.y * 1.6, v.z * 1.6 + oz);
    if (v.y > 0) {
      v.y *= 0.42;
      v.y += nz * r * 0.05;
    } else {
      const taper = 1 - (-v.y / r) * 0.55;
      v.x *= taper; v.z *= taper;
      v.y *= 1.0 + nz * 0.15;
    }
    v.x *= 1 + nz * 0.08;
    v.z *= 1 + nz * 0.08;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  paintTerrain(geo, isl.y, isl.y - r, isl.y + r * 0.42, rand);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.position.set(isl.x, isl.y, isl.z);
  group.add(mesh);
  group.add(buildPalms(rand, 3 + Math.floor(rand() * 4), (rr) => {
    const ang = rr() * Math.PI * 2;
    const d = rr() * r * 0.55;
    return new THREE.Vector3(Math.cos(ang) * d, r * 0.4, Math.sin(ang) * d);
  }));
  return group;
}

function buildPalms(rand, count, placer) {
  const trunks = [];
  const fronds = [];
  for (let i = 0; i < count; i++) {
    const p = placer(rand);
    const h = 6 + rand() * 5;
    const trunk = new THREE.CylinderGeometry(0.5, 0.9, h, 5);
    trunk.translate(p.x, p.y + h / 2, p.z);
    trunks.push(trunk);
    const frond = new THREE.ConeGeometry(4 + rand() * 2, 3.5, 6);
    frond.translate(p.x, p.y + h + 1, p.z);
    fronds.push(frond);
  }
  const group = new THREE.Group();
  if (!trunks.length) return group;
  const trunkMesh = new THREE.Mesh(mergeGeometries(trunks), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, flatShading: true, roughness: 0.9 }));
  const frondMesh = new THREE.Mesh(mergeGeometries(fronds), new THREE.MeshStandardMaterial({ color: 0x2e9a62, flatShading: true, roughness: 0.85 }));
  trunkMesh.castShadow = true;
  frondMesh.castShadow = true;
  group.add(trunkMesh, frondMesh);
  return group;
}

function buildArch(a, rand) {
  const group = new THREE.Group();
  group.position.set(a.x, a.y, a.z);
  group.rotation.y = a.yaw;
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6d6378, flatShading: true, roughness: 0.9, metalness: 0.02 });
  const arc = new THREE.TorusGeometry(a.r, 3.2, 6, 18, Math.PI);
  const pos = arc.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + (rand() - 0.5) * 0.18;
    pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  const arcMesh = new THREE.Mesh(arc, stoneMat);
  arcMesh.castShadow = true;
  group.add(arcMesh);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, a.r + 6, 6), stoneMat);
    pillar.position.set(side * a.r, -(a.r + 6) / 2, 0);
    pillar.castShadow = true;
    group.add(pillar);
    const cap = new THREE.Mesh(new THREE.DodecahedronGeometry(3.6, 0), stoneMat);
    cap.position.set(side * a.r, -(a.r + 6), 0);
    group.add(cap);
  }
  const gateColor = a.hue === 0 ? 0x4ff1ff : 0xff4fd8;
  const gateMat = new THREE.MeshStandardMaterial({ color: gateColor, emissive: gateColor, emissiveIntensity: 3.2, roughness: 0.3, metalness: 0.2, flatShading: true });
  const gate = new THREE.Mesh(new THREE.TorusGeometry(a.gateR, 0.75, 8, 40), gateMat);
  gate.name = 'gate';
  group.add(gate);
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(a.gateR - 0.6, 32),
    new THREE.MeshBasicMaterial({ color: gateColor, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
  );
  group.add(halo);
  group.userData.gateMat = gateMat;
  group.userData.gate = gate;
  return group;
}

function buildCloudGeometry(clouds, rand) {
  const parts = [];
  for (const c of clouds) {
    for (let i = 0; i < c.puffs; i++) {
      const g = new THREE.IcosahedronGeometry(c.s * (0.5 + rand() * 0.6), 0);
      g.scale(1.3, 0.55, 1);
      g.translate(c.x + (rand() - 0.5) * c.s * 2.2, c.y + (rand() - 0.5) * c.s * 0.4, c.z + (rand() - 0.5) * c.s * 1.4);
      parts.push(g);
    }
  }
  return mergeGeometries(parts);
}

// ---------------------------------------------------------------------------
// Sky dome shader
// ---------------------------------------------------------------------------
const SKY_VERT = `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SKY_FRAG = `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 glow;
uniform vec3 sunDir;
uniform float starAmount;
varying vec3 vWorld;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main() {
  vec3 dir = normalize(vWorld);
  float h = dir.y;
  vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55));
  if (h < 0.0) col = mix(horizon, horizon * 0.55, clamp(-h * 3.0, 0.0, 1.0));
  float sd = max(dot(dir, sunDir), 0.0);
  float band = 1.0 - clamp(abs(h) * 2.2, 0.0, 1.0);
  col += glow * pow(sd, 5.0) * (0.25 + band * 0.6);
  col += glow * pow(sd, 90.0) * 0.8;
  // Keep the dome itself below the bloom threshold; only the small sun disc is allowed to glow.
  col = min(col, vec3(1.0));
  col += vec3(1.0, 0.95, 0.8) * pow(sd, 1200.0) * 2.5;
  if (starAmount > 0.0 && h > 0.02) {
    vec3 cell = floor(dir * 160.0);
    float s = hash(cell);
    float star = step(0.995, s) * starAmount * smoothstep(0.02, 0.3, h);
    col += vec3(star);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
export class World {
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed;
    this.layout = generateLayout(seed);
    this.group = new THREE.Group();
    this.arches = [];
    this.time = 0;
    const rand = mulberry32((seed ^ 0x5bd1e995) >>> 0);
    this.rand = rand;

    // Islands
    for (const isl of this.layout.islands) {
      const mesh = isl.kind === 'central' ? buildCentralIsland(isl, rand) : buildFloatingIsland(isl, rand);
      this.group.add(mesh);
    }

    // Stone arches + ring gates
    for (const a of this.layout.arches) {
      const g = buildArch(a, rand);
      this.arches.push(g);
      this.group.add(g);
    }

    // Ocean
    const oceanGeo = new THREE.PlaneGeometry(2500, 2500, 96, 96);
    oceanGeo.rotateX(-Math.PI / 2);
    this.oceanBase = Float32Array.from(oceanGeo.attributes.position.array);
    // Roughness 0.45 keeps the low sun's glint on the water as a soft sparkle instead of a
    // mirror-like highlight that would blow past the bloom threshold and flood the screen pink.
    this.oceanMat = new THREE.MeshStandardMaterial({ color: 0x0f5e78, roughness: 0.45, metalness: 0.05, flatShading: true });
    this.ocean = new THREE.Mesh(oceanGeo, this.oceanMat);
    this.ocean.position.y = WATER_LEVEL;
    this.ocean.receiveShadow = true;
    this.group.add(this.ocean);

    // Clouds
    this.cloudMat = new THREE.MeshStandardMaterial({ color: 0xe9dfe3, flatShading: true, roughness: 1, metalness: 0, transparent: true, opacity: 0.92 });
    this.clouds = new THREE.Mesh(buildCloudGeometry(this.layout.clouds, rand), this.cloudMat);
    this.group.add(this.clouds);

    // Sky dome
    this.skyUniforms = {
      zenith: { value: new THREE.Color('#2b1e4a') },
      horizon: { value: new THREE.Color('#e86f52') },
      glow: { value: new THREE.Color('#ffbe76') },
      sunDir: { value: new THREE.Vector3(300, 180, -250).normalize() },
      starAmount: { value: 0 },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1800, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false })
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.group.add(this.sky);

    scene.add(this.group);
  }

  setSky(zenith, horizon, glow, sunDir, stars) {
    this.skyUniforms.zenith.value.set(zenith);
    this.skyUniforms.horizon.value.set(horizon);
    this.skyUniforms.glow.value.set(glow);
    this.skyUniforms.sunDir.value.copy(sunDir).normalize();
    this.skyUniforms.starAmount.value = stars ? 1 : 0;
  }

  setOceanColor(hex) { this.oceanMat.color.set(hex); }

  update(dt, cameraPos) {
    this.time += dt;
    const t = this.time;
    const pos = this.ocean.geometry.attributes.position;
    const arr = pos.array;
    const base = this.oceanBase;
    for (let i = 0; i < arr.length; i += 3) {
      const x = base[i], z = base[i + 2];
      arr[i + 1] = (Math.sin(x * 0.05 + t) + Math.cos(z * 0.05 + t * 0.8)) * 1.3 + Math.sin((x + z) * 0.013 + t * 0.4) * 0.6;
    }
    pos.needsUpdate = true;
    this.ocean.position.x = Math.round(cameraPos.x / 26) * 26;
    this.ocean.position.z = Math.round(cameraPos.z / 26) * 26;
    this.sky.position.copy(cameraPos);
    this.clouds.rotation.y += dt * 0.004;
    for (let i = 0; i < this.arches.length; i++) {
      const g = this.arches[i];
      const gate = g.userData.gate;
      gate.rotation.z += dt * (i % 2 ? 0.6 : -0.6);
      g.userData.gateMat.emissiveIntensity = 2.6 + Math.sin(t * 3 + i) * 0.6;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
}
