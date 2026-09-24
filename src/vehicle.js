import * as THREE from 'three';
import { clamp, damp } from './util.js';
import { Track } from './track.js';

export const PHYS = {
  vMax: 150,        // m/s at full throttle (540 km/h)
  vBoost: 205,      // m/s while boosting
  accel: 58,
  boostAccel: 75,
  brake: 95,
  roll: 4,
  steerBase: 9,
  steerRate: 0.36,  // lateral m/s per m/s of forward speed
  steerLerp: 7,
  centrifugal: 0.2,
  wallBounce: 0.45,
  wallSpeedLoss: 0.72,
  hover: 1.7,
  boostDrain: 40,
  boostRegen: 7,
  padEnergy: 45,
  padKick: 38,
  bodyHalfWidth: 2.6,
};

let craftId = 0;

export class Craft {
  constructor(track, opts) {
    this.id = craftId++;
    this.track = track;
    this.name = opts.name;
    this.isPlayer = !!opts.isPlayer;
    this.color = new THREE.Color(opts.color);
    this.accent = new THREE.Color(opts.accent);
    this.ai = opts.ai || null;

    this.input = { throttle: 0, brake: 0, steer: 0, boost: false };
    this.frame = Track.makeFrame();
    this.position = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.bobPhase = Math.random() * Math.PI * 2;

    this.mesh = this._buildMesh();
    this.reset(opts.startS, opts.startLat);
  }

  reset(startS, startLat) {
    this.s = startS;
    this.lat = startLat;
    this.speed = 0;
    this.latVel = 0;
    this.boostEnergy = 60;
    this.boosting = false;
    this.laps = -1;
    this.totalDist = 0;
    this.lapTimes = [];
    this.bestLap = null;
    this.lapStart = null;
    this.finished = false;
    this.finishTime = null;
    this.lastPad = null;
    this.wallCooldown = 0;
    this.padGlow = 0;
    this.startS = startS;
    this.startLat = startLat;
    this.updateVisual(0);
  }

  // ---- physics -------------------------------------------------------------

  step(dt, raceTime, events) {
    const P = PHYS;
    const T = this.track;
    const inp = this.input;

    this.wallCooldown = Math.max(0, this.wallCooldown - dt);

    const wantBoost = inp.boost && this.boostEnergy > 0;
    this.boosting = wantBoost;
    const vCap = wantBoost ? P.vBoost : P.vMax;
    const fullAccel = P.accel + (wantBoost ? P.boostAccel : 0);

    let acc = inp.throttle * P.accel;
    if (wantBoost) {
      acc += P.boostAccel;
      this.boostEnergy = Math.max(0, this.boostEnergy - P.boostDrain * dt);
    } else {
      this.boostEnergy = Math.min(100, this.boostEnergy + P.boostRegen * dt);
    }
    const dragK = fullAccel / (vCap * vCap);
    acc -= dragK * this.speed * this.speed * (inp.throttle > 0.1 || wantBoost ? 1 : 0.6);
    acc -= inp.brake * P.brake;
    acc -= P.roll;
    this.speed = Math.max(0, this.speed + acc * dt);

    // Lateral dynamics: steering sets a target slide velocity, curves push outward.
    const maxLat = P.steerBase + P.steerRate * this.speed;
    this.latVel = damp(this.latVel, inp.steer * maxLat, P.steerLerp, dt);
    const kappa = T.kappaAt(this.s);
    const centrifugal = P.centrifugal * kappa * this.speed * this.speed;
    const vl = this.latVel + centrifugal;
    this.lat += vl * dt;

    const limit = T.halfWidth - P.bodyHalfWidth;
    if (Math.abs(this.lat) > limit) {
      const side = Math.sign(this.lat);
      this.lat = side * limit;
      const vIn = vl * side;
      if (vIn > 0) {
        this.latVel = -side * vIn * P.wallBounce;
        this.speed *= 1 - 0.7 * dt;
        if (vIn > 11 && this.wallCooldown <= 0) {
          this.speed *= P.wallSpeedLoss;
          this.wallCooldown = 0.45;
          events?.wallHit?.(this, side, vIn);
        }
      }
    }

    // Boost pads.
    const pad = T.padAt(this.s, this.lat);
    if (pad && pad !== this.lastPad) {
      this.lastPad = pad;
      this.speed = Math.min(this.speed + P.padKick, P.vBoost + 15);
      this.boostEnergy = Math.min(100, this.boostEnergy + P.padEnergy);
      this.padGlow = 1;
      events?.pad?.(this);
    } else if (!pad) {
      this.lastPad = null;
    }
    this.padGlow = Math.max(0, this.padGlow - dt * 1.5);

    // Progress & laps.
    this.s += this.speed * dt;
    if (this.s >= T.length) {
      this.s -= T.length;
      this.laps++;
      if (this.laps >= 1) {
        const lapTime = raceTime - this.lapStart;
        this.lapTimes.push(lapTime);
        if (this.bestLap == null || lapTime < this.bestLap) this.bestLap = lapTime;
      }
      this.lapStart = raceTime;
      events?.lap?.(this);
    }
    this.totalDist = this.laps * T.length + this.s;
  }

  // ---- visuals -------------------------------------------------------------

  updateVisual(time) {
    const P = PHYS;
    const F = this.track.frameAt(this.s, this.frame);
    const bob = Math.sin(time * 7 + this.bobPhase) * 0.1 + Math.sin(time * 11.3 + this.bobPhase) * 0.05;
    this.position.copy(F.pos).addScaledVector(F.right, this.lat).addScaledVector(F.up, P.hover + bob);

    const fwdSpeed = Math.max(this.speed, 25);
    this.forward.copy(F.tan).multiplyScalar(fwdSpeed).addScaledVector(F.right, this.latVel).normalize();
    const roll = -this.input.steer * 0.42 - this.latVel * 0.004;
    const up = _v1.copy(F.up).applyAxisAngle(this.forward, roll);
    const right = _v2.crossVectors(this.forward, up).normalize();
    up.crossVectors(right, this.forward).normalize();
    _m.makeBasis(right, up, this.forward);
    this.mesh.quaternion.setFromRotationMatrix(_m);
    this.mesh.position.copy(this.position);

    const thrust = this.input.throttle * 0.7 + (this.boosting ? 0.9 : 0) + this.padGlow * 0.6;
    const flameLen = 0.5 + thrust * 1.3 + Math.random() * 0.2;
    for (const f of this.flames) {
      f.scale.set(1 + thrust * 0.15, 1 + thrust * 0.15, flameLen);
    }
    const glow = 1.0 + thrust * 0.9;
    this.engineMat.color.copy(this.accent).multiplyScalar(glow);
    this.flameMat.color.copy(this.boosting ? _boostCol : this.accent).multiplyScalar(glow * 0.6);
  }

  _buildMesh() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.color, roughness: 0.45, metalness: 0.35, flatShading: true,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x141622, roughness: 0.6, metalness: 0.4, flatShading: true });
    const accentMat = new THREE.MeshStandardMaterial({
      color: this.accent, emissive: this.accent, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.2,
    });
    this.engineMat = new THREE.MeshBasicMaterial({ color: this.accent, toneMapped: false });
    this.flameMat = new THREE.MeshBasicMaterial({
      color: this.accent, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    });

    // Fuselage: elongated cone, nose toward +Z.
    const fus = new THREE.Mesh(new THREE.ConeGeometry(1.15, 7, 7), bodyMat);
    fus.geometry.rotateX(Math.PI / 2);
    fus.geometry.scale(1.15, 0.6, 1);
    fus.position.z = 0.6;
    g.add(fus);

    // Rear body block.
    const rear = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.0, 2.6), darkMat);
    rear.position.set(0, -0.05, -2.6);
    g.add(rear);

    // Canopy.
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), new THREE.MeshStandardMaterial({
      color: 0x8fdfff, emissive: 0x2a78a8, emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.1,
    }));
    canopy.scale.set(1, 0.7, 1.8);
    canopy.position.set(0, 0.45, 0.2);
    g.add(canopy);

    // Swept wings built from a 2D outline (x = span, y = along the hull), extruded thin.
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0.9, -0.6);
    wingShape.lineTo(3.3, -3.0);
    wingShape.lineTo(3.3, -3.9);
    wingShape.lineTo(0.9, -3.6);
    wingShape.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.16, bevelEnabled: false });
    wingGeo.rotateX(Math.PI / 2); // lay flat: shape y -> z, extrude depth -> -y
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wingGeo, bodyMat);
      w.scale.x = side;
      w.position.set(0, -0.1, 0);
      w.rotation.z = side * 0.08;
      g.add(w);
      // Wing-tip fin, parented to the wing so it follows the mirror/tilt.
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 1.1), accentMat);
      tip.position.set(3.3, 0.25, -3.45);
      w.add(tip);
      // Engine nozzle + glowing exhaust disc.
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.5, 10), darkMat);
      noz.geometry.rotateX(Math.PI / 2);
      noz.position.set(side * 0.9, -0.05, -3.95);
      g.add(noz);
      const eng = new THREE.Mesh(new THREE.CircleGeometry(0.38, 12), this.engineMat);
      eng.position.set(side * 0.9, -0.05, -4.2);
      eng.rotation.y = Math.PI;
      g.add(eng);
    }
    this.flames = [];
    for (const side of [-1, 1]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 8, 1, true), this.flameMat);
      flame.geometry.rotateX(-Math.PI / 2);
      flame.geometry.translate(0, 0, -0.5);
      flame.position.set(side * 0.9, -0.05, -4.2);
      g.add(flame);
      this.flames.push(flame);
    }
    // Vertical fin.
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 1.6), accentMat);
    fin.position.set(0, 0.9, -3.0);
    fin.rotation.x = 0.35;
    g.add(fin);

    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    return g;
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _boostCol = new THREE.Color(0xfff3a0);

// Simple craft-vs-craft separation along the track.
export function resolveCraftCollisions(crafts, track, events) {
  const L = track.length;
  for (let i = 0; i < crafts.length; i++) {
    for (let j = i + 1; j < crafts.length; j++) {
      const a = crafts[i], b = crafts[j];
      let ds = a.s - b.s;
      if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
      const dl = a.lat - b.lat;
      if (Math.abs(ds) < 8.5 && Math.abs(dl) < 5.2) {
        const push = (5.2 - Math.abs(dl)) * 0.5 * (dl >= 0 ? 1 : -1);
        a.lat += push; b.lat -= push;
        const limit = track.halfWidth - PHYS.bodyHalfWidth;
        a.lat = clamp(a.lat, -limit, limit);
        b.lat = clamp(b.lat, -limit, limit);
        a.latVel += push * 4; b.latVel -= push * 4;
        // Rear car gets slowed slightly, front car nudged forward.
        if (ds > 0) { b.speed *= 0.985; a.speed = Math.min(a.speed + 0.5, PHYS.vBoost); }
        else { a.speed *= 0.985; b.speed = Math.min(b.speed + 0.5, PHYS.vBoost); }
        events?.bump?.(a, b);
      }
    }
  }
}
