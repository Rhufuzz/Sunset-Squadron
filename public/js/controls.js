// controls.js - independent multi-touch tracking (floating left virtual stick +
// right-hand BOOST/ROLL and FIREWORK thumb buttons) with a desktop keyboard fallback.
//
// Every touch is tracked by touch.identifier via changedTouches; e.touches[0] is never used.

const JOY_RADIUS = 65;
const TAP_MAX_MS = 220;

export class Controls {
  constructor(layerEl, joyBaseEl, joyKnobEl, boostBtn, fireBtn) {
    this.layer = layerEl;
    this.joyBase = joyBaseEl;
    this.joyKnob = joyKnobEl;
    this.boostBtn = boostBtn;
    this.fireBtn = fireBtn;

    // Public input state (read every frame by the flight model)
    this.joyX = 0;
    this.joyY = 0;
    this.boost = false;
    this.fire = false;
    this.enabled = false;

    // One-shot events, consumed via takeRollTap()
    this._rollTaps = 0;

    // Touch bookkeeping
    this.joyTouchId = null;
    this.joyOrigin = { x: 0, y: 0 };
    this.buttonTouches = new Map(); // identifier -> { kind: 'boost' | 'fire', startedAt }

    // Keyboard state
    this.keys = new Set();
    this.shiftDownAt = 0;

    this._bind();
  }

  _bind() {
    const opts = { passive: false };
    this.layer.addEventListener('touchstart', (e) => this._onTouchStart(e), opts);
    this.layer.addEventListener('touchmove', (e) => this._onTouchMove(e), opts);
    this.layer.addEventListener('touchend', (e) => this._onTouchEnd(e), opts);
    this.layer.addEventListener('touchcancel', (e) => this._onTouchEnd(e), opts);

    // iOS gesture + double-tap-zoom guards
    document.addEventListener('gesturestart', (e) => e.preventDefault(), opts);
    document.addEventListener('gesturechange', (e) => e.preventDefault(), opts);
    document.addEventListener('gestureend', (e) => e.preventDefault(), opts);
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTouchEnd < 300 && this.enabled) e.preventDefault();
      lastTouchEnd = now;
    }, opts);
    document.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });

    // Mouse fallback on desktop: left half drag = stick, clicking the buttons works too
    this.mouseDown = false;
    this.layer.addEventListener('mousedown', (e) => this._onMouseDown(e));
    window.addEventListener('mousemove', (e) => this._onMouseMove(e));
    window.addEventListener('mouseup', (e) => this._onMouseUp(e));

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
    window.addEventListener('blur', () => this.reset());
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.reset();
  }

  reset() {
    this.joyX = 0; this.joyY = 0;
    this.boost = false; this.fire = false;
    this.joyTouchId = null;
    this.buttonTouches.clear();
    this.keys.clear();
    this.joyBase.classList.remove('active');
    this.boostBtn.classList.remove('pressed');
    this.fireBtn.classList.remove('pressed');
    this.mouseDown = false;
  }

  /** Returns true once per queued barrel-roll tap. */
  takeRollTap() {
    if (this._rollTaps > 0) { this._rollTaps--; return true; }
    return false;
  }

  // ---------------- touch ----------------
  _hitButton(x, y) {
    for (const [el, kind] of [[this.fireBtn, 'fire'], [this.boostBtn, 'boost']]) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const rad = Math.max(r.width, r.height) / 2 + 18;
      if (Math.hypot(x - cx, y - cy) <= rad) return kind;
    }
    // Generic right-half fallback: upper area boosts, lower area fires
    return y < window.innerHeight * 0.5 ? 'boost' : 'fire';
  }

  _onTouchStart(e) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < window.innerWidth * 0.5) {
        if (this.joyTouchId === null) {
          this.joyTouchId = t.identifier;
          this.joyOrigin = { x: t.clientX, y: t.clientY };
          this.joyBase.style.left = `${t.clientX}px`;
          this.joyBase.style.top = `${t.clientY}px`;
          this.joyBase.classList.add('active');
          this._setKnob(0, 0);
        }
      } else {
        const kind = this._hitButton(t.clientX, t.clientY);
        this.buttonTouches.set(t.identifier, { kind, startedAt: performance.now() });
        this._refreshButtons();
      }
    }
  }

  _onTouchMove(e) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.joyTouchId) {
        let dx = t.clientX - this.joyOrigin.x;
        let dy = t.clientY - this.joyOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > JOY_RADIUS) { dx = (dx / len) * JOY_RADIUS; dy = (dy / len) * JOY_RADIUS; }
        this._setKnob(dx, dy);
        this.joyX = dx / JOY_RADIUS;
        this.joyY = dy / JOY_RADIUS;
      }
    }
  }

  _onTouchEnd(e) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.joyTouchId) {
        this.joyTouchId = null;
        this.joyX = 0; this.joyY = 0;
        this.joyBase.classList.remove('active');
        this._setKnob(0, 0);
      } else if (this.buttonTouches.has(t.identifier)) {
        const info = this.buttonTouches.get(t.identifier);
        this.buttonTouches.delete(t.identifier);
        if (info.kind === 'boost' && performance.now() - info.startedAt < TAP_MAX_MS) this._rollTaps++;
        this._refreshButtons();
      }
    }
  }

  _setKnob(dx, dy) {
    this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  _refreshButtons() {
    let boost = false, fire = false;
    for (const info of this.buttonTouches.values()) {
      if (info.kind === 'boost') boost = true;
      if (info.kind === 'fire') fire = true;
    }
    this.boost = boost || this.keys.has('shift');
    this.fire = fire || this.keys.has(' ');
    this.boostBtn.classList.toggle('pressed', this.boost);
    this.fireBtn.classList.toggle('pressed', this.fire);
  }

  // ---------------- mouse (desktop) ----------------
  _onMouseDown(e) {
    if (!this.enabled || e.button !== 0) return;
    e.preventDefault();
    if (e.clientX < window.innerWidth * 0.5) {
      this.mouseDown = true;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyBase.style.left = `${e.clientX}px`;
      this.joyBase.style.top = `${e.clientY}px`;
      this.joyBase.classList.add('active');
      this._setKnob(0, 0);
    } else {
      const kind = this._hitButton(e.clientX, e.clientY);
      this.buttonTouches.set('mouse', { kind, startedAt: performance.now() });
      this._refreshButtons();
    }
  }
  _onMouseMove(e) {
    if (!this.mouseDown) return;
    let dx = e.clientX - this.joyOrigin.x;
    let dy = e.clientY - this.joyOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > JOY_RADIUS) { dx = (dx / len) * JOY_RADIUS; dy = (dy / len) * JOY_RADIUS; }
    this._setKnob(dx, dy);
    this.joyX = dx / JOY_RADIUS;
    this.joyY = dy / JOY_RADIUS;
  }
  _onMouseUp() {
    if (this.mouseDown) {
      this.mouseDown = false;
      this.joyX = 0; this.joyY = 0;
      this.joyBase.classList.remove('active');
      this._setKnob(0, 0);
    }
    if (this.buttonTouches.has('mouse')) {
      const info = this.buttonTouches.get('mouse');
      this.buttonTouches.delete('mouse');
      if (info.kind === 'boost' && performance.now() - info.startedAt < TAP_MAX_MS) this._rollTaps++;
      this._refreshButtons();
    }
  }

  // ---------------- keyboard (desktop) ----------------
  _onKey(e, down) {
    if (!this.enabled) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const map = {
      w: 'up', ArrowUp: 'up', s: 'down', ArrowDown: 'down',
      a: 'left', ArrowLeft: 'left', d: 'right', ArrowRight: 'right',
      Shift: 'shift', ' ': ' ', q: 'roll',
    };
    const action = map[k];
    if (!action) return;
    e.preventDefault();
    if (down) {
      if (action === 'shift' && !this.keys.has('shift')) this.shiftDownAt = performance.now();
      if (action === 'roll' && !this.keys.has('roll')) this._rollTaps++;
      this.keys.add(action);
    } else {
      if (action === 'shift' && performance.now() - this.shiftDownAt < TAP_MAX_MS) this._rollTaps++;
      this.keys.delete(action);
    }
    this._applyKeys();
  }

  _applyKeys() {
    // Keyboard overrides the stick only while the stick is idle
    if (this.joyTouchId === null && !this.mouseDown) {
      let x = 0, y = 0;
      if (this.keys.has('left')) x -= 1;
      if (this.keys.has('right')) x += 1;
      if (this.keys.has('up')) y -= 1;
      if (this.keys.has('down')) y += 1;
      this.joyX = x;
      this.joyY = y;
    }
    this._refreshButtons();
  }

  /** Called once per frame so that key-held state is reflected even without events. */
  poll() {
    if (this.keys.size) this._applyKeys();
  }
}
