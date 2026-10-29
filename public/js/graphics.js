// graphics.js - WebGLRenderer, ACESFilmic tone mapping, golden-hour lighting rig,
// time-of-day presets, UnrealBloomPass composer and the instanced particle system.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const PRESETS = {
  sunset: {
    label: 'Golden Sunset',
    sunColor: 0xff8c42, sunIntensity: 3.2, sunPos: [300, 180, -250],
    hemiSky: 0x8ab4ff, hemiGround: 0x3b2d54, hemiIntensity: 1.45,
    fog: 0xf4976c, fogDensity: 0.0014,
    zenith: '#2b1e4a', horizon: '#e86f52', glow: '#ffbe76',
    ocean: 0x0f5e78, exposure: 1.15, bloom: 0.75, stars: false,
  },
  noon: {
    label: 'High Noon Tropics',
    sunColor: 0xfff1d0, sunIntensity: 3.0, sunPos: [120, 420, 80],
    hemiSky: 0xbfe6ff, hemiGround: 0x5f7a4a, hemiIntensity: 1.25,
    fog: 0xcfe9f5, fogDensity: 0.0009,
    zenith: '#2f7fd8', horizon: '#a9d8f0', glow: '#ffffff',
    ocean: 0x1b8fa6, exposure: 1.05, bloom: 0.55, stars: false,
  },
  twilight: {
    label: 'Neon Twilight',
    sunColor: 0xff5fb8, sunIntensity: 1.9, sunPos: [-260, 90, 300],
    hemiSky: 0x5e3fa8, hemiGround: 0x1a1030, hemiIntensity: 1.1,
    fog: 0x3a2060, fogDensity: 0.0017,
    zenith: '#090418', horizon: '#4a1f6e', glow: '#ff3fa0',
    ocean: 0x0b3350, exposure: 1.0, bloom: 1.1, stars: true,
  },
};

const PARTICLE_COUNT = 600;
const BLOOM_THRESHOLD = 1.35;

export class Graphics {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xf4976c, 0.0014);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 4000);
    this.camera.position.set(0, 120, 300);
    this.targetFov = 60;

    // Golden-hour lighting rig
    this.sun = new THREE.DirectionalLight(0xff8c42, 3.2);
    this.sun.position.set(300, 180, -250);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -400;
    this.sun.shadow.camera.right = 400;
    this.sun.shadow.camera.top = 400;
    this.sun.shadow.camera.bottom = -400;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 1000;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.6;
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    this.scene.add(this.sun);

    this.hemi = new THREE.HemisphereLight(0x8ab4ff, 0x3b2d54, 1.45);
    this.scene.add(this.hemi);

    // Composer: render -> selective-threshold bloom -> output (tone mapping + sRGB)
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    // The composer renders in linear HDR (half-float). Sun 3.2 + hemisphere 1.45 lights put bright
    // sand/cloud facets at ~1.0-1.3 linear luminance, so the threshold sits just above that: terrain,
    // water and jets stay un-bloomed while emissive 2.5-4.0 thrusters, gates, rockets and the crown glow.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.4, BLOOM_THRESHOLD);
    this.composer.addPass(this.bloom);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.shake = 0;
    this._shakeVec = new THREE.Vector3();
    this.presetName = 'sunset';
    this.world = null;

    this.particles = new ParticleSystem(this.scene);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  attachWorld(world) {
    this.world = world;
    this.applyPreset(this.presetName);
  }

  applyPreset(name) {
    const p = PRESETS[name] || PRESETS.sunset;
    this.presetName = PRESETS[name] ? name : 'sunset';
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.sun.position.set(p.sunPos[0], p.sunPos[1], p.sunPos[2]);
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.scene.fog.color.set(p.fog);
    this.scene.fog.density = p.fogDensity;
    this.renderer.toneMappingExposure = p.exposure;
    this.bloom.strength = p.bloom;
    if (this.world) {
      this.world.setSky(p.zenith, p.horizon, p.glow, new THREE.Vector3(p.sunPos[0], p.sunPos[1], p.sunPos[2]), p.stars);
      this.world.setOceanColor(p.ocean);
    }
  }

  /** Keep the shadow frustum centred on the local player so shadows stay crisp. */
  followShadow(pos) {
    this.sunTarget.position.copy(pos);
    const dir = new THREE.Vector3().fromArray(PRESETS[this.presetName].sunPos).normalize();
    this.sun.position.copy(pos).addScaledVector(dir, 450);
  }

  addShake(amount) { this.shake = Math.min(1.5, this.shake + amount); }

  render(dt) {
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.targetFov, Math.min(1, dt * 5));
    this.camera.updateProjectionMatrix();
    if (this.shake > 0.001) {
      this._shakeVec.set((Math.random() - 0.5) * this.shake * 2, (Math.random() - 0.5) * this.shake * 2, 0);
      this.camera.position.add(this._shakeVec);
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    this.particles.update(dt, this.camera.position);
    this.composer.render(dt);
  }
}

// ---------------------------------------------------------------------------
// Instanced particle system: exhaust puffs, firework trails, explosion clouds
// ---------------------------------------------------------------------------
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();
const C_SPAWN = new THREE.Color(0xfff7c2);
const C_MID = new THREE.Color(0xff8a2a);
const C_END = new THREE.Color(0x3a3448);

export class ParticleSystem {
  constructor(scene) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    // Unlit cartoon puffs: instance colours above 1.0 (set via the `glow` option) push into bloom.
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, PARTICLE_COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    this.pos = new Float32Array(PARTICLE_COUNT * 3);
    this.vel = new Float32Array(PARTICLE_COUNT * 3);
    this.life = new Float32Array(PARTICLE_COUNT);
    this.maxLife = new Float32Array(PARTICLE_COUNT);
    this.size = new Float32Array(PARTICLE_COUNT);
    this.drag = new Float32Array(PARTICLE_COUNT);
    this.gravity = new Float32Array(PARTICLE_COUNT);
    this.colA = new Float32Array(PARTICLE_COUNT * 3);
    this.colB = new Float32Array(PARTICLE_COUNT * 3);
    this.colC = new Float32Array(PARTICLE_COUNT * 3);
    this.cursor = 0;
    _scale.set(0, 0, 0);
    _mat4.compose(new THREE.Vector3(0, -1000, 0), _quat, _scale);
    for (let i = 0; i < PARTICLE_COUNT; i++) this.mesh.setMatrixAt(i, _mat4);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Spawn a particle. opts: { pos, vel, life, size, drag, gravity, colors: [start, mid, end] }
   */
  spawn(o) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % PARTICLE_COUNT;
    this.pos[i * 3] = o.pos.x; this.pos[i * 3 + 1] = o.pos.y; this.pos[i * 3 + 2] = o.pos.z;
    const v = o.vel || { x: 0, y: 0, z: 0 };
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = o.life || 1;
    this.maxLife[i] = o.life || 1;
    this.size[i] = o.size || 1;
    this.drag[i] = o.drag === undefined ? 1.5 : o.drag;
    this.gravity[i] = o.gravity || 0;
    const cs = o.colors || [C_SPAWN, C_MID, C_END];
    const glow = o.glow || 1;
    this.colA[i * 3] = cs[0].r * glow; this.colA[i * 3 + 1] = cs[0].g * glow; this.colA[i * 3 + 2] = cs[0].b * glow;
    this.colB[i * 3] = cs[1].r; this.colB[i * 3 + 1] = cs[1].g; this.colB[i * 3 + 2] = cs[1].b;
    this.colC[i * 3] = cs[2].r; this.colC[i * 3 + 1] = cs[2].g; this.colC[i * 3 + 2] = cs[2].b;
  }

  burst(center, count, speed, opts = {}) {
    for (let k = 0; k < count; k++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn({
        pos: center,
        vel: { x: r * Math.cos(th) * s, y: u * s, z: r * Math.sin(th) * s },
        life: (opts.life || 1.1) * (0.6 + Math.random() * 0.7),
        size: (opts.size || 2.2) * (0.6 + Math.random() * 0.8),
        drag: opts.drag === undefined ? 1.8 : opts.drag,
        gravity: opts.gravity || 0,
        colors: opts.colors,
        glow: opts.glow === undefined ? 1.7 : opts.glow,
      });
    }
  }

  update(dt, camPos) {
    const posArr = this.pos, vel = this.vel;
    const cx = camPos ? camPos.x : 0, cy = camPos ? camPos.y : 0, cz = camPos ? camPos.z : 0;
    let any = false;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const d = Math.max(0, 1 - this.drag[i] * dt);
      vel[i * 3] *= d; vel[i * 3 + 1] = vel[i * 3 + 1] * d - this.gravity[i] * dt; vel[i * 3 + 2] *= d;
      posArr[i * 3] += vel[i * 3] * dt;
      posArr[i * 3 + 1] += vel[i * 3 + 1] * dt;
      posArr[i * 3 + 2] += vel[i * 3 + 2] * dt;
      // Scale: pop in, then shrink to zero. Colour: bright -> orange -> slate.
      const grow = k > 0.85 ? (1 - k) / 0.15 : 1;
      // Shrink puffs that drift right in front of the camera so they never fill the screen
      const dCam = Math.hypot(posArr[i * 3] - cx, posArr[i * 3 + 1] - cy, posArr[i * 3 + 2] - cz);
      const nearFade = dCam < 10 ? Math.max(0, (dCam - 3) / 7) : 1;
      const s = this.size[i] * grow * Math.pow(k, 0.5) * nearFade;
      _scale.set(s, s, s);
      _mat4.makeRotationY(k * 3);
      _mat4.scale(_scale);
      _mat4.setPosition(posArr[i * 3], posArr[i * 3 + 1], posArr[i * 3 + 2]);
      this.mesh.setMatrixAt(i, _mat4);
      if (k > 0.5) {
        const t = (1 - k) * 2;
        _color.setRGB(
          this.colA[i * 3] + (this.colB[i * 3] - this.colA[i * 3]) * t,
          this.colA[i * 3 + 1] + (this.colB[i * 3 + 1] - this.colA[i * 3 + 1]) * t,
          this.colA[i * 3 + 2] + (this.colB[i * 3 + 2] - this.colA[i * 3 + 2]) * t
        );
      } else {
        const t = (0.5 - k) * 2;
        _color.setRGB(
          this.colB[i * 3] + (this.colC[i * 3] - this.colB[i * 3]) * t,
          this.colB[i * 3 + 1] + (this.colC[i * 3 + 1] - this.colB[i * 3 + 1]) * t,
          this.colB[i * 3 + 2] + (this.colC[i * 3 + 2] - this.colB[i * 3 + 2]) * t
        );
      }
      this.mesh.setColorAt(i, _color);
      if (this.life[i] <= 0) {
        _scale.set(0, 0, 0);
        _mat4.compose(new THREE.Vector3(0, -1000, 0), _quat, _scale);
        this.mesh.setMatrixAt(i, _mat4);
      }
    }
    if (any) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
