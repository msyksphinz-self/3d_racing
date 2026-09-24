import * as THREE from 'three';
import { mulberry32 } from './util.js';

export const GROUND_Y = -120;

export function buildScenery(scene, track) {
  const rnd = mulberry32(1337);

  // Sky dome with vertical gradient.
  const skyGeo = new THREE.SphereGeometry(4200, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x03040c) },
      mid: { value: new THREE.Color(0x151033) },
      bottom: { value: new THREE.Color(0x3a1650) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y;
        vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : mix(mid, bottom, pow(-h, 0.8));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // Stars.
  {
    const n = 2200;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const e = Math.asin(rnd() * 0.95 + 0.03);
      const r = 3800;
      p[i * 3] = Math.cos(a) * Math.cos(e) * r;
      p[i * 3 + 1] = Math.sin(e) * r;
      p[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const m = new THREE.PointsMaterial({ color: 0xcfe6ff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9 });
    scene.add(new THREE.Points(g, m));
  }

  // Ground grid plane.
  {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#07070f';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#1c2a4a';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, 253, 253);
    ctx.strokeStyle = '#111a30';
    ctx.lineWidth = 1;
    for (let k = 64; k < 256; k += 64) {
      ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(256, k); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(90, 90);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000), new THREE.MeshBasicMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    scene.add(ground);
  }

  // City blocks kept clear of the track.
  const trackPts = track.pos.filter((_, i) => i % 6 === 0);
  const clearOf = (x, z, r) => {
    const r2 = r * r;
    for (const p of trackPts) {
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < r2) return false;
    }
    return true;
  };

  {
    const count = 420;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x0c0e1c, roughness: 0.9, metalness: 0.1 });
    const im = new THREE.InstancedMesh(geo, mat, count);
    const M = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    let placed = 0, tries = 0;
    while (placed < count && tries < 20000) {
      tries++;
      const x = (rnd() - 0.5) * 2200;
      const z = (rnd() - 0.5) * 2200;
      if (!clearOf(x, z, 60)) continue;
      const w = 18 + rnd() * 50;
      const d = 18 + rnd() * 50;
      const h = 30 + rnd() * rnd() * 220;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 0.3 - 0.15);
      M.compose(new THREE.Vector3(x, GROUND_Y, z), q, new THREE.Vector3(w, h, d));
      im.setMatrixAt(placed, M);
      col.setHSL(0.62 + rnd() * 0.15, 0.4, 0.05 + rnd() * 0.06);
      im.setColorAt(placed, col);
      placed++;
    }
    im.count = placed;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    scene.add(im);
  }

  // Neon towers.
  {
    const count = 70;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const palette = [0x22d3ee, 0xf043c8, 0xffa02e, 0x7c5cff, 0x3dff9a];
    const mats = palette.map((c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
    const M = new THREE.Matrix4();
    const ims = mats.map((m) => new THREE.InstancedMesh(geo, m, count));
    const counts = new Array(mats.length).fill(0);
    let placed = 0, tries = 0;
    while (placed < count && tries < 20000) {
      tries++;
      const x = (rnd() - 0.5) * 2400;
      const z = (rnd() - 0.5) * 2400;
      if (!clearOf(x, z, 90)) continue;
      const k = Math.floor(rnd() * mats.length);
      const h = 80 + rnd() * 320;
      M.compose(new THREE.Vector3(x, GROUND_Y, z), new THREE.Quaternion(), new THREE.Vector3(2.5 + rnd() * 3, h, 2.5 + rnd() * 3));
      ims[k].setMatrixAt(counts[k]++, M);
      placed++;
    }
    ims.forEach((im, k) => { im.count = counts[k]; im.instanceMatrix.needsUpdate = true; scene.add(im); });
  }

  // Floating rings / arches over the track for a sense of speed.
  {
    const F = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), up: new THREE.Vector3(), right: new THREE.Vector3(), kappa: 0 };
    const ringGeo = new THREE.TorusGeometry(26, 0.9, 8, 40);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x7c5cff, toneMapped: false });
    const n = 18;
    for (let k = 0; k < n; k++) {
      const s = ((k + 0.5) / n) * track.length;
      track.frameAt(s, F);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(F.pos).addScaledVector(F.up, 6);
      const m = new THREE.Matrix4().makeBasis(F.right, F.up, F.tan);
      ring.quaternion.setFromRotationMatrix(m);
      scene.add(ring);
    }
  }

  // Lights.
  scene.add(new THREE.HemisphereLight(0x8fa8ff, 0x2a1040, 0.9));
  const sun = new THREE.DirectionalLight(0xfff0e0, 1.6);
  sun.position.set(300, 500, -200);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xff60d0, 0.7);
  rim.position.set(-400, 200, 300);
  scene.add(rim);
}
