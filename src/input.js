// Keyboard + gamepad input mapped to a single control state.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.anyKey = false;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.anyKey = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.state = { throttle: 0, brake: 0, steer: 0, boost: false };
  }

  down(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); this.anyKey = false; }

  poll() {
    const s = this.state;
    s.throttle = (this.down('ArrowUp') || this.down('KeyW')) ? 1 : 0;
    s.brake = (this.down('ArrowDown') || this.down('KeyS')) ? 1 : 0;
    s.steer = ((this.down('ArrowRight') || this.down('KeyD')) ? 1 : 0) - ((this.down('ArrowLeft') || this.down('KeyA')) ? 1 : 0);
    s.boost = this.down('ShiftLeft') || this.down('ShiftRight') || this.down('Space');

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
