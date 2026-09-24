// Procedural engine / effect sounds built on Web Audio (no asset files).
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.started = false;
  }

  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.started = true;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    this.engineFilter = lp;
    this.engineGain.connect(lp).connect(this.master);

    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    this.osc1.connect(this.engineGain);
    this.osc2.connect(g2).connect(this.engineGain);
    this.osc1.start(); this.osc2.start();

    // Boost whine.
    this.boostOsc = ctx.createOscillator();
    this.boostOsc.type = 'sine';
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    this.boostOsc.connect(this.boostGain).connect(this.master);
    this.boostOsc.start();

    // Pre-render a noise buffer for impacts.
    const len = ctx.sampleRate * 0.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  updateEngine(speed, throttle, boosting, dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 55 + speed * 1.35 + (boosting ? 40 : 0);
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(500 + speed * 9, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.06 + throttle * 0.08 + speed * 0.0006, t, 0.08);
    this.boostOsc.frequency.setTargetAtTime(400 + speed * 4, t, 0.05);
    this.boostGain.gain.setTargetAtTime(boosting ? 0.08 : 0, t, 0.08);
  }

  _burst(gain, dur, filterFreq) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filterFreq;
    f.Q.value = 0.8;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    src.stop(this.ctx.currentTime + dur);
  }

  wallHit(strength) { this._burst(Math.min(0.6, 0.15 + strength * 0.01), 0.25, 700); }
  pad() { this._beep(660, 0.12, 0.12); this._beep(990, 0.18, 0.1, 0.06); }
  bump() { this._burst(0.2, 0.12, 300); }
  countdown(final) { this._beep(final ? 880 : 440, final ? 0.5 : 0.18, 0.18); }
  lap() { this._beep(523, 0.1, 0.15); this._beep(784, 0.2, 0.15, 0.1); }

  _beep(freq, dur, gain, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }
}
