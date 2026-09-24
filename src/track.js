import * as THREE from 'three';
import { clamp, lerp, wrap } from './util.js';

// Hand-laid control points (x, y, z). Direction of travel follows the array.
// The course starts on a long straight heading +Z, sweeps right, climbs and
// crosses back over the start straight on an overpass, then winds through a
// hairpin on the far side before returning.
const CONTROL_POINTS = [
  [0, 0, -380],
  [0, 0, 0],
  [0, 5, 250],
  [120, 15, 420],
  [330, 30, 470],
  [480, 40, 340],
  [470, 45, 160],
  [330, 40, 60],
  [0, 52, -120],
  [-160, 45, -200],
  [-330, 30, -140],
  [-400, 20, 40],
  [-340, 10, 200],
  [-430, 0, 390],
  [-570, -8, 320],
  [-600, -15, 80],
  [-460, -20, -220],
  [-300, -15, -420],
  [-140, -5, -480],
];

const SEGMENTS = 2000;
const HALF_WIDTH = 14;
const RAIL_HEIGHT = 2.4;
const SLAB_DEPTH = 3.0;

export class Track {
  constructor() {
    this.halfWidth = HALF_WIDTH;
    this.railHeight = RAIL_HEIGHT;
    this.N = SEGMENTS;

    const pts = CONTROL_POINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.length = this.curve.getLength();
    this.ds = this.length / this.N;

    this.pos = [];
    this.tan = [];
    this.up = [];
    this.right = [];
    this.kappa = new Float32Array(this.N);
    this.bank = new Float32Array(this.N);

    this._sample();
    this._buildBoostPads();
    this._buildMinimap();
    this.group = new THREE.Group();
    this._buildMeshes();
  }

  // ---- geometry sampling -------------------------------------------------

  _sample() {
    const N = this.N;
    for (let i = 0; i < N; i++) {
      const u = i / N;
      this.pos.push(this.curve.getPointAt(u));
      this.tan.push(this.curve.getTangentAt(u).normalize());
    }

    // Signed yaw curvature (positive = turning left), smoothed.
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.tan[(i - 1 + N) % N];
      const b = this.tan[(i + 1) % N];
      const ax = a.x, az = a.z, bx = b.x, bz = b.z;
      const la = Math.hypot(ax, az) || 1;
      const lb = Math.hypot(bx, bz) || 1;
      const cross = (az * bx - ax * bz) / (la * lb);
      raw[i] = cross / (2 * this.ds);
    }
    const win = 24;
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let k = -win; k <= win; k++) acc += raw[(i + k + N) % N];
      this.kappa[i] = acc / (2 * win + 1);
    }

    const worldUp = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < N; i++) {
      const t = this.tan[i];
      const up = worldUp.clone().addScaledVector(t, -worldUp.dot(t)).normalize();
      const bank = clamp(this.kappa[i] * 60, -0.6, 0.6);
      this.bank[i] = bank;
      up.applyAxisAngle(t, -bank);
      this.up.push(up);
      this.right.push(new THREE.Vector3().crossVectors(t, up).normalize());
    }
  }

  // Interpolated frame at arc-length s. `out` must have pos/tan/up/right Vector3.
  frameAt(s, out) {
    const N = this.N;
    const f = (wrap(s, this.length) / this.length) * N;
    const i = Math.floor(f) % N;
    const j = (i + 1) % N;
    const a = f - Math.floor(f);
    out.pos.lerpVectors(this.pos[i], this.pos[j], a);
    out.tan.lerpVectors(this.tan[i], this.tan[j], a).normalize();
    out.up.lerpVectors(this.up[i], this.up[j], a).normalize();
    out.right.lerpVectors(this.right[i], this.right[j], a).normalize();
    out.kappa = lerp(this.kappa[i], this.kappa[j], a);
    return out;
  }

  kappaAt(s) {
    const N = this.N;
    const f = (wrap(s, this.length) / this.length) * N;
    const i = Math.floor(f) % N;
    const j = (i + 1) % N;
    return lerp(this.kappa[i], this.kappa[j], f - Math.floor(f));
  }

  static makeFrame() {
    return {
      pos: new THREE.Vector3(),
      tan: new THREE.Vector3(),
      up: new THREE.Vector3(),
      right: new THREE.Vector3(),
      kappa: 0,
    };
  }

  // ---- boost pads ----------------------------------------------------------

  _buildBoostPads() {
    const L = this.length;
    const hw = this.halfWidth;
    this.pads = [
      { s: 0.09 * L, len: 16, lat0: -hw, lat1: hw },
      { s: 0.24 * L, len: 14, lat0: -hw, lat1: -1 },
      { s: 0.33 * L, len: 14, lat0: 1, lat1: hw },
      { s: 0.47 * L, len: 16, lat0: -hw, lat1: hw },
      { s: 0.60 * L, len: 14, lat0: -hw, lat1: 0 },
      { s: 0.74 * L, len: 14, lat0: 0, lat1: hw },
      { s: 0.88 * L, len: 16, lat0: -hw, lat1: hw },
    ];
  }

  padAt(s, lat) {
    const L = this.length;
    const sw = wrap(s, L);
    for (const p of this.pads) {
      const d = wrap(sw - p.s, L);
      if (d >= 0 && d <= p.len && lat >= p.lat0 && lat <= p.lat1) return p;
    }
    return null;
  }

  // ---- minimap -------------------------------------------------------------

  _buildMinimap() {
    const pts = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.N; i += 8) {
      const p = this.pos[i];
      pts.push([p.x, p.z]);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    this.map = { pts, minX, maxX, minZ, maxZ };
  }

  // ---- meshes --------------------------------------------------------------

  _strip(pointFn, material, vRepeat, step = 1) {
    const N = this.N;
    const rings = Math.floor(N / step) + 1;
    const positions = new Float32Array(rings * 2 * 3);
    const uvs = new Float32Array(rings * 2 * 2);
    const indices = [];
    const A = new THREE.Vector3();
    const B = new THREE.Vector3();
    for (let r = 0; r < rings; r++) {
      const i = (r * step) % N;
      pointFn(i, A, B);
      const o = r * 6;
      positions[o] = A.x; positions[o + 1] = A.y; positions[o + 2] = A.z;
      positions[o + 3] = B.x; positions[o + 4] = B.y; positions[o + 5] = B.z;
      const v = (r / (rings - 1)) * vRepeat;
      const uo = r * 4;
      uvs[uo] = 0; uvs[uo + 1] = v;
      uvs[uo + 2] = 1; uvs[uo + 3] = v;
      if (r < rings - 1) {
        const a = r * 2, b = a + 1, c = a + 2, d = a + 3;
        indices.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false;
    return m;
  }

  _roadTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#14161f';
    ctx.fillRect(0, 0, 256, 256);
    // subtle noise
    for (let i = 0; i < 1800; i++) {
      const v = 18 + Math.random() * 14;
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 8})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    // lane marks
    ctx.fillStyle = '#2a2d3a';
    ctx.fillRect(0, 0, 256, 3);
    ctx.fillStyle = '#5fe3ff';
    ctx.fillRect(4, 0, 5, 256);
    ctx.fillRect(247, 0, 5, 256);
    ctx.fillStyle = '#ff4fd8';
    ctx.fillRect(126, 40, 4, 110);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  _padTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff6a00';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#ffe66d';
    for (let k = 0; k < 2; k++) {
      const y = k * 64;
      ctx.beginPath();
      ctx.moveTo(0, y + 10); ctx.lineTo(64, y + 40); ctx.lineTo(128, y + 10);
      ctx.lineTo(128, y + 26); ctx.lineTo(64, y + 56); ctx.lineTo(0, y + 26);
      ctx.closePath(); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _checkerTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 32;
    const ctx = c.getContext('2d');
    for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#f4f4f4' : '#101010';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _buildMeshes() {
    const hw = this.halfWidth;
    const rh = this.railHeight;
    const P = this.pos, U = this.up, R = this.right;

    const roadTex = this._roadTexture();
    const roadMat = new THREE.MeshStandardMaterial({
      map: roadTex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: roadTex,
      emissiveIntensity: 0.55,
      roughness: 0.85,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    const road = this._strip((i, A, B) => {
      A.copy(P[i]).addScaledVector(R[i], -hw);
      B.copy(P[i]).addScaledVector(R[i], hw);
    }, roadMat, this.length / 24);
    road.receiveShadow = true;
    this.group.add(road);

    const slabMat = new THREE.MeshStandardMaterial({ color: 0x0b0c14, roughness: 0.9, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      this.group.add(this._strip((i, A, B) => {
        A.copy(P[i]).addScaledVector(R[i], side * hw);
        B.copy(P[i]).addScaledVector(R[i], side * hw).addScaledVector(U[i], -SLAB_DEPTH);
      }, slabMat, 1, 2));
    }
    this.group.add(this._strip((i, A, B) => {
      A.copy(P[i]).addScaledVector(R[i], -hw).addScaledVector(U[i], -SLAB_DEPTH);
      B.copy(P[i]).addScaledVector(R[i], hw).addScaledVector(U[i], -SLAB_DEPTH);
    }, slabMat, 1, 2));

    // Transparent energy walls with glowing top rails.
    const wallColors = [0x22d3ee, 0xf043c8];
    for (const side of [-1, 1]) {
      const col = wallColors[side < 0 ? 0 : 1];
      const wallMat = new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false,
      });
      this.group.add(this._strip((i, A, B) => {
        A.copy(P[i]).addScaledVector(R[i], side * hw);
        B.copy(P[i]).addScaledVector(R[i], side * hw).addScaledVector(U[i], rh);
      }, wallMat, 1, 2));
      const railMat = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
      this.group.add(this._strip((i, A, B) => {
        A.copy(P[i]).addScaledVector(R[i], side * (hw + 0.35)).addScaledVector(U[i], rh);
        B.copy(P[i]).addScaledVector(R[i], side * (hw - 0.35)).addScaledVector(U[i], rh);
      }, railMat, 1, 2));
      const kerbMat = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
      this.group.add(this._strip((i, A, B) => {
        A.copy(P[i]).addScaledVector(R[i], side * (hw + 0.2)).addScaledVector(U[i], 0.04);
        B.copy(P[i]).addScaledVector(R[i], side * (hw - 0.5)).addScaledVector(U[i], 0.04);
      }, kerbMat, 1, 2));
    }

    // Boost pads.
    this.padTex = this._padTexture();
    const padMat = new THREE.MeshBasicMaterial({ map: this.padTex, toneMapped: false, side: THREE.DoubleSide });
    const F = Track.makeFrame();
    for (const pad of this.pads) {
      const steps = Math.ceil(pad.len / 1.5);
      const positions = [];
      const uvs = [];
      const indices = [];
      for (let k = 0; k <= steps; k++) {
        const s = pad.s + (k / steps) * pad.len;
        this.frameAt(s, F);
        const a = F.pos.clone().addScaledVector(F.right, pad.lat0).addScaledVector(F.up, 0.08);
        const b = F.pos.clone().addScaledVector(F.right, pad.lat1).addScaledVector(F.up, 0.08);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        const v = (k / steps) * 2;
        uvs.push(0, v, 1, v);
        if (k < steps) {
          const q = k * 2;
          indices.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(indices);
      const m = new THREE.Mesh(g, padMat);
      m.frustumCulled = false;
      this.group.add(m);
    }

    // Start / finish line.
    const lineMat = new THREE.MeshBasicMaterial({ map: this._checkerTexture(), side: THREE.DoubleSide });
    {
      const g = new THREE.BufferGeometry();
      const positions = [];
      const uvs = [];
      const indices = [];
      const ss = [-2.5, 2.5];
      ss.forEach((s, k) => {
        this.frameAt(s, F);
        const a = F.pos.clone().addScaledVector(F.right, -hw).addScaledVector(F.up, 0.1);
        const b = F.pos.clone().addScaledVector(F.right, hw).addScaledVector(F.up, 0.1);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        uvs.push(0, k, 1, k);
      });
      indices.push(0, 2, 1, 1, 2, 3);
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(indices);
      const m = new THREE.Mesh(g, lineMat);
      m.frustumCulled = false;
      this.group.add(m);
    }

    // Rail lights.
    const lightGeo = new THREE.SphereGeometry(0.4, 8, 6);
    const lightMats = [
      new THREE.MeshBasicMaterial({ color: 0x9ff3ff, toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: 0xffa3ec, toneMapped: false }),
    ];
    const every = 14;
    const count = Math.floor(this.N / every);
    const M = new THREE.Matrix4();
    for (const side of [-1, 1]) {
      const im = new THREE.InstancedMesh(lightGeo, lightMats[side < 0 ? 0 : 1], count);
      for (let k = 0; k < count; k++) {
        const i = k * every;
        const p = P[i].clone().addScaledVector(R[i], side * (hw + 0.6)).addScaledVector(U[i], rh + 0.5);
        M.makeTranslation(p.x, p.y, p.z);
        im.setMatrixAt(k, M);
      }
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      this.group.add(im);
    }
  }

  update(dt) {
    this.padTex.offset.y -= dt * 2.5;
  }
}
