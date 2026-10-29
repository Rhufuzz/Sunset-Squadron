// audio.js - procedural Web Audio synthesizer. No .mp3/.wav files anywhere.
// initAndUnlock() must be called from a user gesture (LAUNCH JET button) for iOS Safari.

const NOTE = { C5: 523.25, E5: 659.25, G5: 783.99, B5: 987.77, D6: 1174.66 };

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.unlocked = false;
    this.engine = null;
    this.muted = false;
  }

  initAndUnlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!this.ctx) {
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.ratio.value = 4;
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
      this.noiseBuffer = this._makeNoiseBuffer(2.0);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // Play a silent buffer inside the gesture so iOS lets audio through later
    const src = this.ctx.createBufferSource();
    src.buffer = this.ctx.createBuffer(1, 1, 22050);
    src.connect(this.ctx.destination);
    src.start(0);
    this.unlocked = true;
    this._startEngine();
    return true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  _makeNoiseBuffer(seconds) {
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseSource(loop = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = loop;
    return src;
  }

  // ---------------- continuous jet engine hum ----------------
  _startEngine() {
    if (this.engine || !this.ctx) return;
    const ctx = this.ctx;
    const noise = this._noiseSource(true);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 140;
    band.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    // Low rumble oscillator layered under the noise for body
    const rumble = ctx.createOscillator();
    rumble.type = 'sawtooth';
    rumble.frequency.value = 48;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 180;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.0;
    noise.connect(band).connect(gain).connect(this.master);
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(this.master);
    noise.start();
    rumble.start();
    this.engine = { band, gain, rumble, rumbleGain };
  }

  /** speed01: 0..1 normalised jet speed, called every frame. */
  updateEngine(speed01, active) {
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    const k = Math.max(0, Math.min(1, speed01));
    const freq = 140 + k * 380;
    this.engine.band.frequency.setTargetAtTime(freq, t, 0.08);
    this.engine.gain.gain.setTargetAtTime(active ? 0.10 + k * 0.16 : 0, t, 0.1);
    this.engine.rumble.frequency.setTargetAtTime(42 + k * 40, t, 0.1);
    this.engine.rumbleGain.gain.setTargetAtTime(active ? 0.05 + k * 0.08 : 0, t, 0.1);
  }

  // ---------------- one-shots ----------------
  _env(gainNode, t, peak, attack, decay) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  fireworkLaunch(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const type of ['sawtooth', 'triangle']) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(300, t);
      osc.frequency.exponentialRampToValueAtTime(950, t + 0.18);
      const g = ctx.createGain();
      this._env(g, t, 0.12 * volume, 0.01, 0.22);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.3);
    }
    const hiss = this._noiseSource(false);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const hg = ctx.createGain();
    this._env(hg, t, 0.09 * volume, 0.01, 0.3);
    hiss.connect(hp).connect(hg).connect(this.master);
    hiss.start(t);
    hiss.stop(t + 0.35);
  }

  fireworkPop(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, t);
    sub.frequency.exponentialRampToValueAtTime(30, t + 0.3);
    const sg = ctx.createGain();
    this._env(sg, t, 0.5 * volume, 0.005, 0.32);
    sub.connect(sg).connect(this.master);
    sub.start(t);
    sub.stop(t + 0.4);
    const crackle = this._noiseSource(false);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const cg = ctx.createGain();
    this._env(cg, t, 0.25 * volume, 0.005, 0.28);
    crackle.connect(hp).connect(cg).connect(this.master);
    crackle.start(t);
    crackle.stop(t + 0.35);
    // Sparkle tail
    for (let i = 0; i < 5; i++) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 1400 + Math.random() * 2200;
      const g = ctx.createGain();
      const st = t + 0.05 + Math.random() * 0.25;
      this._env(g, st, 0.05 * volume, 0.005, 0.12);
      o.connect(g).connect(this.master);
      o.start(st);
      o.stop(st + 0.2);
    }
  }

  /** Arpeggiated major-9th chime: C5 -> E5 -> G5 -> B5 -> D6 */
  fanfare(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const notes = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.B5, NOTE.D6];
    notes.forEach((f, i) => {
      const st = t + i * 0.085;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.22 * volume, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.9);
      o.connect(g).connect(this.master);
      o.start(st);
      o.stop(st + 1.0);
      // Soft octave shimmer
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 2;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, st);
      g2.gain.exponentialRampToValueAtTime(0.06 * volume, st + 0.01);
      g2.gain.exponentialRampToValueAtTime(0.0001, st + 0.6);
      o2.connect(g2).connect(this.master);
      o2.start(st);
      o2.stop(st + 0.7);
    });
  }

  /** Short chime for balloon pops (two quick notes). */
  balloonPop(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const crackle = this._noiseSource(false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3000;
    bp.Q.value = 0.8;
    const cg = ctx.createGain();
    this._env(cg, t, 0.3 * volume, 0.003, 0.12);
    crackle.connect(bp).connect(cg).connect(this.master);
    crackle.start(t);
    crackle.stop(t + 0.15);
    [NOTE.G5, NOTE.D6].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      this._env(g, t + i * 0.07, 0.14 * volume, 0.01, 0.3);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.07);
      o.stop(t + i * 0.07 + 0.35);
    });
  }

  /** Playful shield bump when touching an island. */
  bump(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    this._env(g, t, 0.28 * volume, 0.005, 0.22);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
    const wob = ctx.createOscillator();
    wob.type = 'sine';
    wob.frequency.setValueAtTime(600, t);
    wob.frequency.exponentialRampToValueAtTime(300, t + 0.12);
    const wg = ctx.createGain();
    this._env(wg, t, 0.12 * volume, 0.005, 0.15);
    wob.connect(wg).connect(this.master);
    wob.start(t);
    wob.stop(t + 0.2);
  }

  /** Water splash: low-passed noise swoosh. */
  splash(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noiseSource(false);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(2400, t + 0.15);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.5);
    const g = ctx.createGain();
    this._env(g, t, 0.3 * volume, 0.03, 0.5);
    n.connect(lp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.6);
  }

  /** Afterburner ignite whoosh when boost starts. */
  boostWhoosh(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noiseSource(false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(1600, t + 0.35);
    bp.Q.value = 2;
    const g = ctx.createGain();
    this._env(g, t, 0.22 * volume, 0.05, 0.4);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.5);
  }

  /** Barrel-roll swoosh: quick pitch-bent sine. */
  rollSwoosh(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(500, t);
    o.frequency.exponentialRampToValueAtTime(1100, t + 0.2);
    o.frequency.exponentialRampToValueAtTime(450, t + 0.45);
    const g = ctx.createGain();
    this._env(g, t, 0.12 * volume, 0.02, 0.45);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
  }

  /** Countdown tick / round-start blip. */
  blip(freq = 880, volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = ctx.createGain();
    this._env(g, t, 0.1 * volume, 0.005, 0.12);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }

  /** Power-up collected: quick rising arpeggio, pitched per type, with a sparkle tail. */
  pickup(type = 'turbo', volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const bases = { turbo: 440, shield: 392, rapid: 523.25, magnet: 349.23, ghost: 311.13, x2: 587.33, mine: 329.63, decoy: 493.88 };
    const base = bases[type] || 440;
    const ratios = type === 'ghost' ? [1, 1.189, 1.414, 1.682] : type === 'mine' ? [1, 0.9, 1.2, 0.8] : [1, 1.25, 1.5, 2];
    ratios.forEach((r, i) => {
      const st = t + i * 0.06;
      const o = ctx.createOscillator();
      o.type = type === 'shield' ? 'sine' : type === 'mine' ? 'sawtooth' : 'triangle';
      o.frequency.value = base * r;
      const g = ctx.createGain();
      this._env(g, st, 0.16 * volume, 0.008, 0.35);
      o.connect(g).connect(this.master);
      o.start(st);
      o.stop(st + 0.4);
    });
    const shimmer = this._noiseSource(false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2500, t);
    bp.frequency.exponentialRampToValueAtTime(6000, t + 0.3);
    bp.Q.value = 3;
    const sg = ctx.createGain();
    this._env(sg, t, 0.07 * volume, 0.02, 0.35);
    shimmer.connect(bp).connect(sg).connect(this.master);
    shimmer.start(t);
    shimmer.stop(t + 0.4);
  }

  /** Sky mine deployed behind jet: low mechanical release and armed beep. */
  mineDeploy(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.15);
    const g = ctx.createGain();
    this._env(g, t, 0.18 * volume, 0.005, 0.18);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
    // Short arming chirp
    const chirp = ctx.createOscillator();
    chirp.type = 'sine';
    chirp.frequency.setValueAtTime(880, t + 0.12);
    chirp.frequency.setValueAtTime(1174, t + 0.18);
    const cg = ctx.createGain();
    this._env(cg, t + 0.12, 0.12 * volume, 0.003, 0.12);
    chirp.connect(cg).connect(this.master);
    chirp.start(t + 0.12);
    chirp.stop(t + 0.25);
  }

  /** Decoy deployed: jet launch flare swoosh. */
  decoyDeploy(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noiseSource(false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(2800, t + 0.25);
    bp.Q.value = 2.5;
    const ng = ctx.createGain();
    this._env(ng, t, 0.2 * volume, 0.01, 0.3);
    n.connect(bp).connect(ng).connect(this.master);
    n.start(t);
    n.stop(t + 0.35);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.2);
    const g = ctx.createGain();
    this._env(g, t, 0.14 * volume, 0.005, 0.25);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** Power-up ran out: soft two-note descending "power down". */
  powerDown(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [660, 440].forEach((f, i) => {
      const st = t + i * 0.12;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, st);
      o.frequency.exponentialRampToValueAtTime(f * 0.8, st + 0.18);
      const g = ctx.createGain();
      this._env(g, st, 0.1 * volume, 0.01, 0.2);
      o.connect(g).connect(this.master);
      o.start(st);
      o.stop(st + 0.25);
    });
  }

  /** Shield Bubble absorbed a hit: glassy crack + low thump. */
  shieldBreak(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noiseSource(false);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    const ng = ctx.createGain();
    this._env(ng, t, 0.22 * volume, 0.003, 0.25);
    n.connect(hp).connect(ng).connect(this.master);
    n.start(t);
    n.stop(t + 0.3);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1800, t);
    o.frequency.exponentialRampToValueAtTime(400, t + 0.25);
    const g = ctx.createGain();
    this._env(g, t, 0.18 * volume, 0.005, 0.3);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.35);
  }

  /** Personal-best sting on the round-end screen. */
  personalBest(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [NOTE.C5, NOTE.G5, NOTE.D6, NOTE.D6 * 1.5].forEach((f, i) => {
      const st = t + i * 0.1;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      this._env(g, st, 0.08 * volume, 0.01, 0.45);
      o.connect(g).connect(this.master);
      o.start(st);
      o.stop(st + 0.5);
    });
  }

  /** Round-over jingle: descending then rising arpeggio. */
  roundOver(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [NOTE.G5, NOTE.E5, NOTE.C5, NOTE.E5, NOTE.G5, NOTE.D6].forEach((f, i) => {
      const st = t + i * 0.14;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      this._env(g, st, 0.2 * volume, 0.01, 0.5);
      o.connect(g).connect(this.master);
      o.start(st);
      o.stop(st + 0.6);
    });
  }
}
