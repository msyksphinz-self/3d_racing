// Keyboard, gamepad and touch input mapped to a single control state.
export const IS_TOUCH = (typeof window !== 'undefined') &&
  (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0);

function capture(el, id) {
  try { el.setPointerCapture(id); } catch { /* synthetic or already-released pointer */ }
}

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.anyKey = false;
    this.touchActive = IS_TOUCH;
    this.touch = { steer: 0, accel: false, brake: false, boost: false, steering: false };
    this.tilt = { enabled: false, steer: 0 };
    this.autoAccel = IS_TOUCH; // mobile: throttle is held unless braking

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.anyKey = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this._clearTouch(); });
    window.addEventListener('touchstart', () => { this.touchActive = true; }, { passive: true, once: true });
    this.state = { throttle: 0, brake: 0, steer: 0, boost: false };
  }

  down(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); this.anyKey = false; }

  _clearTouch() {
    this.touch.steer = 0; this.touch.steering = false;
    this.touch.accel = this.touch.brake = this.touch.boost = false;
  }

  // Wire up the on-screen controls. `els` = { steer, accel, brake, boost }.
  bindTouch(els) {
    const steer = els.steer;
    const pointers = new Map();
    const updateSteer = () => {
      if (pointers.size === 0) { this.touch.steer = 0; this.touch.steering = false; return; }
      const r = steer.getBoundingClientRect();
      let sum = 0;
      for (const x of pointers.values()) sum += Math.max(-1, Math.min(1, ((x - r.left) / r.width - 0.5) * 2.6));
      this.touch.steer = sum / pointers.size;
      this.touch.steering = true;
    };
    steer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(steer, e.pointerId);
      pointers.set(e.pointerId, e.clientX);
      updateSteer();
    });
    steer.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, e.clientX);
      updateSteer();
    });
    const release = (e) => { pointers.delete(e.pointerId); updateSteer(); };
    steer.addEventListener('pointerup', release);
    steer.addEventListener('pointercancel', release);
    steer.addEventListener('lostpointercapture', release);

    const bindButton = (el, key) => {
      const active = new Set();
      const set = () => { this.touch[key] = active.size > 0; el.classList.toggle('active', active.size > 0); };
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); capture(el, e.pointerId); active.add(e.pointerId); set(); });
      const off = (e) => { active.delete(e.pointerId); set(); };
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
    };
    bindButton(els.accel, 'accel');
    bindButton(els.brake, 'brake');
    bindButton(els.boost, 'boost');
  }

  // Optional tilt steering (Android exposes deviceorientation without a prompt;
  // iOS needs DeviceOrientationEvent.requestPermission from a user gesture).
  async enableTilt(on) {
    if (on && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      try { if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') on = false; } catch { on = false; }
    }
    this.tilt.enabled = on;
    if (on && !this._tiltBound) {
      this._tiltBound = true;
      window.addEventListener('deviceorientation', (e) => {
        if (!this.tilt.enabled) return;
        // In landscape the phone is turned like a wheel around the screen's long axis: that's beta.
        const type = screen.orientation?.type || '';
        const landscape = type.startsWith('landscape') || window.innerWidth > window.innerHeight;
        let v = landscape ? (e.beta ?? 0) : (e.gamma ?? 0);
        if (type === 'landscape-secondary') v = -v;
        this.tilt.steer = Math.max(-1, Math.min(1, v / 22));
      });
    }
    if (!on) this.tilt.steer = 0;
    return on;
  }

  poll() {
    const s = this.state;
    s.throttle = (this.down('ArrowUp') || this.down('KeyW')) ? 1 : 0;
    s.brake = (this.down('ArrowDown') || this.down('KeyS')) ? 1 : 0;
    s.steer = ((this.down('ArrowRight') || this.down('KeyD')) ? 1 : 0) - ((this.down('ArrowLeft') || this.down('KeyA')) ? 1 : 0);
    s.boost = this.down('ShiftLeft') || this.down('ShiftRight') || this.down('Space');

    // Touch overlay.
    const t = this.touch;
    if (t.accel) s.throttle = 1;
    if (t.brake) s.brake = 1;
    if (t.boost) s.boost = true;
    if (t.steering) s.steer = t.steer;
    else if (this.tilt.enabled && Math.abs(this.tilt.steer) > 0.08) s.steer = this.tilt.steer;
    if (this.autoAccel && this.touchActive && !s.brake) s.throttle = 1;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.12) s.steer = Math.sign(ax) * (Math.abs(ax) - 0.12) / 0.88;
      const rt = gp.buttons[7]?.value || 0;
      const lt = gp.buttons[6]?.value || 0;
      if (rt > 0.05) s.throttle = Math.max(s.throttle, rt);
      if (gp.buttons[0]?.pressed) s.throttle = 1;
      if (lt > 0.05) s.brake = Math.max(s.brake, lt);
      if (gp.buttons[1]?.pressed) s.brake = 1;
      if (gp.buttons[2]?.pressed || gp.buttons[5]?.pressed) s.boost = true;
      if (gp.buttons[9]?.pressed) this.anyKey = true;
      break;
    }
    return s;
  }
}
