import * as THREE from 'three';
import { clamp } from './util.js';

// Streaks flying past the camera; opacity scales with speed.
export class SpeedLines {
  constructor(camera, count = 160) {
    this.count = count;
    this.zMin = -70; this.zMax = -4;
    const positions = new Float32Array(count * 2 * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.mat = new THREE.LineBasicMaterial({
      color: 0xbfefff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.data = [];
    for (let i = 0; i < count; i++) {
      this.data.push(this._spawn(true));
    }
    camera.add(this.lines);
    this._write();
  }

  _spawn(anywhere) {
    const a = Math.random() * Math.PI * 2;
    const r = 2.5 + Math.random() * 9;
    return {
      x: Math.cos(a) * r, y: Math.sin(a) * r * 0.65,
      z: anywhere ? this.zMin + Math.random() * (this.zMax - this.zMin) : this.zMin,
      len: 1.5 + Math.random() * 3,
    };
  }

  _write() {
    const p = this.geo.attributes.position.array;
    for (let i = 0; i < this.count; i++) {
      const d = this.data[i];
      const o = i * 6;
      p[o] = d.x; p[o + 1] = d.y; p[o + 2] = d.z;
      p[o + 3] = d.x; p[o + 4] = d.y; p[o + 5] = d.z + d.len;
    }
    this.geo.attributes.position.needsUpdate = true;
  }

  update(dt, speed, boosting) {
    const t = clamp((speed - 70) / 130, 0, 1);
    this.mat.opacity = t * t * 0.55 + (boosting ? 0.25 : 0);
    if (this.mat.opacity <= 0.001) return;
    const vz = speed * 0.8 * dt;
    for (let i = 0; i < this.count; i++) {
      const d = this.data[i];
      d.z += vz;
      d.len = 1.5 + speed * 0.04;
      if (d.z > this.zMax) Object.assign(d, this._spawn(false));
    }
    this._write();
  }
}

// Pooled additive particle sparks (wall hits, boost pads).
export class Particles {
  constructor(scene, max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.base = new Float32Array(max * 3);
    this.next = 0;
    for (let i = 0; i < max; i++) { this.pos[i * 3 + 1] = -9999; this.age[i] = 1; this.life[i] = 1; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = geo;
    const mat = new THREE.PointsMaterial({
      size: 0.7, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, sizeAttenuation: true, toneMapped: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(origin, dir, color, count, spread, speed, life) {
    for (let k = 0; k < count; k++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      const o = i * 3;
      this.pos[o] = origin.x; this.pos[o + 1] = origin.y; this.pos[o + 2] = origin.z;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.vel[o] = (dir.x + (Math.random() - 0.5) * spread) * sp;
      this.vel[o + 1] = (dir.y + (Math.random() - 0.5) * spread) * sp;
      this.vel[o + 2] = (dir.z + (Math.random() - 0.5) * spread) * sp;
      this.base[o] = color.r; this.base[o + 1] = color.g; this.base[o + 2] = color.b;
      this.life[i] = life * (0.6 + Math.random() * 0.6);
      this.age[i] = 0;
    }
  }

  update(dt) {
    const n = this.max;
    for (let i = 0; i < n; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const o = i * 3;
      if (this.age[i] >= this.life[i]) {
        this.pos[o + 1] = -9999;
        this.col[o] = this.col[o + 1] = this.col[o + 2] = 0;
        continue;
      }
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      this.vel[o + 1] -= 12 * dt;
      const f = 1 - this.age[i] / this.life[i];
      const b = f * 2.5;
      this.col[o] = this.base[o] * b; this.col[o + 1] = this.base[o + 1] * b; this.col[o + 2] = this.base[o + 2] * b;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
