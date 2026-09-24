import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Track } from './track.js';
import { Craft, PHYS, resolveCraftCollisions } from './vehicle.js';
import { aiControl } from './ai.js';
import { SpeedLines, Particles } from './effects.js';
import { buildScenery } from './scenery.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { clamp, damp } from './util.js';

const LAPS = 3;
const FIXED_DT = 1 / 120;

// ---- renderer --------------------------------------------------------------

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0818, 0.00085);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.5, 6000);
scene.add(camera);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.5, 0.72);
composer.addPass(bloom);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---- world -----------------------------------------------------------------

const track = new Track();
scene.add(track.group);
buildScenery(scene, track);

const speedLines = new SpeedLines(camera);
const particles = new Particles(scene);
const input = new Input();
const audio = new GameAudio();
const hud = new HUD(track);

const ROSTER = [
  { name: 'YOU', color: 0xffffff, accent: 0x22d3ee, isPlayer: true, ai: { skill: 0.95, offset: 0, phase: 0, aggression: 0.7 } },
  { name: 'KAGE', color: 0x1d1f3a, accent: 0xf043c8, ai: { skill: 0.96, offset: -3, phase: 1.0, aggression: 1.0 } },
  { name: 'SOLAR', color: 0xff8c1a, accent: 0xffe66d, ai: { skill: 0.94, offset: 4, phase: 2.1, aggression: 0.8 } },
  { name: 'VIRIDIS', color: 0x1fbf5c, accent: 0x9dff6a, ai: { skill: 0.92, offset: -6, phase: 3.2, aggression: 0.6 } },
  { name: 'ZERO', color: 0x7c5cff, accent: 0xc9b8ff, ai: { skill: 0.90, offset: 6, phase: 4.3, aggression: 0.9 } },
  { name: 'RUBY', color: 0xd81e3c, accent: 0xff8fa3, ai: { skill: 0.88, offset: 0, phase: 5.4, aggression: 0.5 } },
];

const crafts = ROSTER.map((r, i) => {
  // Staggered grid two abreast behind the start line.
  const row = Math.floor(i / 2);
  const col = i % 2 === 0 ? -1 : 1;
  const c = new Craft(track, {
    ...r,
    startS: track.length - 24 - row * 16,
    startLat: col * 6,
  });
  scene.add(c.mesh);
  return c;
});
const player = crafts[0];

// ---- race state ------------------------------------------------------------

const game = {
  state: 'title', // title | countdown | racing | finished
  raceTime: 0,
  countdown: 0,
  countdownStep: -1,
  resultsTimer: -1,
  paused: false,
  autopilot: false, // debug: let the AI drive the player
  freeCam: false,   // debug: leave the camera where a test put it
  shake: 0,
  fov: 72,
  camLat: 0,
  camUp: new THREE.Vector3(0, 1, 0),
};

const events = {
  wallHit(craft, side, strength) {
    const F = craft.frame;
    const origin = craft.position.clone().addScaledVector(F.right, side * PHYS.bodyHalfWidth);
    const dir = F.tan.clone().multiplyScalar(-0.6).addScaledVector(F.right, -side * 0.4).addScaledVector(F.up, 0.5);
    particles.emit(origin, dir, new THREE.Color(0xffc46a), 40, 1.2, 18 + strength * 0.4, 0.6);
    if (craft.isPlayer) {
      game.shake = Math.min(1.2, 0.35 + strength * 0.015);
      audio.wallHit(strength);
    }
  },
  pad(craft) {
    const F = craft.frame;
    particles.emit(craft.position, F.tan.clone().multiplyScalar(-1), new THREE.Color(0xff9a2e), 30, 0.8, 30, 0.5);
    if (craft.isPlayer) { hud.flash(0.8); audio.pad(); game.shake = Math.max(game.shake, 0.25); }
  },
  lap(craft) {
    if (craft.laps >= LAPS && !craft.finished) {
      craft.finished = true;
      craft.finishTime = game.raceTime;
      if (craft.isPlayer) finishRace();
    } else if (craft.isPlayer && craft.laps >= 1 && craft.laps < LAPS) {
      hud.message(craft.laps === LAPS - 1 ? 'FINAL LAP' : `LAP ${craft.laps + 1}`, 1.4);
      audio.lap();
    }
  },
  bump(a, b) {
    if (a.isPlayer || b.isPlayer) { game.shake = Math.max(game.shake, 0.2); audio.bump(); }
  },
};

function startRace() {
  crafts.forEach((c) => c.reset(c.startS, c.startLat));
  game.state = 'countdown';
  game.raceTime = 0;
  game.countdown = 3.6;
  game.countdownStep = -1;
  game.resultsTimer = -1;
  game.paused = false;
  hud.hideResults();
  hud.showTitle(false);
}

function finishRace() {
  game.state = 'finished';
  hud.message('FINISH', 2.5, true);
  game.resultsTimer = 1.5;
}

// ---- simulation ------------------------------------------------------------

const camFrame = Track.makeFrame();
const tmpV = new THREE.Vector3();
const lookV = new THREE.Vector3();

function simulate(dt) {
  const racing = game.state === 'racing' || game.state === 'finished';
  if (racing) game.raceTime += dt;

  for (const c of crafts) {
    if (c.isPlayer && !c.finished && !game.autopilot && game.state !== 'title') {
      const s = input.state;
      if (game.state === 'racing') {
        c.input.throttle = s.throttle; c.input.brake = s.brake; c.input.steer = s.steer; c.input.boost = s.boost;
      } else {
        c.input.throttle = 0; c.input.brake = 1; c.input.steer = 0; c.input.boost = false;
      }
    } else if (racing) {
      aiControl(c, track, crafts, game.raceTime, player);
    } else {
      c.input.throttle = 0; c.input.brake = 1; c.input.steer = 0; c.input.boost = false;
    }
    if (racing) c.step(dt, game.raceTime, events);
  }
  if (racing) resolveCraftCollisions(crafts, track, events);
}

function updateCountdown(dt) {
  if (game.state !== 'countdown') return;
  game.countdown -= dt;
  const step = Math.ceil(game.countdown);
  if (step !== game.countdownStep) {
    game.countdownStep = step;
    if (step >= 1 && step <= 3) { hud.message(String(step), 0.9, true); audio.countdown(false); }
  }
  if (game.countdown <= 0) {
    game.state = 'racing';
    hud.message('GO!', 0.9, true);
    audio.countdown(true);
    for (const c of crafts) c.lapStart = 0;
  }
}

function updateCamera(dt) {
  if (game.freeCam) return;
  if (game.state === 'title') { titleCamera(); return; }
  const c = player;
  const speedRatio = clamp(c.speed / PHYS.vBoost, 0, 1);
  const back = 12.5 + speedRatio * 5;
  const height = 4.3 + speedRatio * 0.7;

  track.frameAt(c.s - back, camFrame);
  game.camLat = damp(game.camLat, c.lat * 0.75, 6, dt);
  game.camUp.lerp(camFrame.up, 1 - Math.exp(-5 * dt)).normalize();

  tmpV.copy(camFrame.pos).addScaledVector(camFrame.right, game.camLat).addScaledVector(camFrame.up, height);
  if (game.shake > 0.001) {
    const k = game.shake * 0.45;
    tmpV.addScaledVector(camFrame.right, (Math.random() - 0.5) * k).addScaledVector(camFrame.up, (Math.random() - 0.5) * k);
    game.shake = damp(game.shake, 0, 6, dt);
  }
  camera.position.copy(tmpV);
  lookV.copy(c.position).addScaledVector(c.frame.tan, 26).addScaledVector(c.frame.up, 0.5);
  camera.up.copy(game.camUp);
  camera.lookAt(lookV);

  const targetFov = 68 + speedRatio * 26 + (c.boosting ? 6 : 0);
  game.fov = damp(game.fov, targetFov, 4, dt);
  camera.fov = game.fov;
  camera.updateProjectionMatrix();
}

// ---- main loop -------------------------------------------------------------

let last = performance.now();
let acc = 0;
let time = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  input.poll();
  handleGlobalKeys();

  if (game.paused) { input.endFrame(); return; }
  time += dt;

  acc += dt;
  let steps = 0;
  while (acc >= FIXED_DT && steps < 10) {
    updateCountdown(FIXED_DT);
    simulate(FIXED_DT);
    acc -= FIXED_DT;
    steps++;
  }

  for (const c of crafts) c.updateVisual(time);
  updateCamera(dt);
  track.update(dt);
  speedLines.update(dt, player.speed, player.boosting);
  particles.update(dt);
  audio.updateEngine(player.speed, player.input.throttle, player.boosting, dt);
  hud.update(dt, { player, crafts, raceTime: game.raceTime, state: game.state, laps: LAPS, muted: audio.muted });
  if (game.state === 'finished' && game.resultsTimer >= 0) {
    // Show the table shortly after the finish and keep it live while the AI crosses the line.
    game.resultsTimer -= dt;
    if (game.resultsTimer < 0) {
      hud.showResults(player, crafts, game.raceTime);
      game.resultsTimer = crafts.every((c) => c.finished) ? -1 : 0.5;
    }
  }

  composer.render();
  input.endFrame();
}

function handleGlobalKeys() {
  if (game.state === 'title') {
    if (input.anyKey) {
      audio.start();
      audio.resume();
      startRace();
    }
    return;
  }
  if (input.wasPressed('KeyR')) { audio.resume(); startRace(); }
  if (input.wasPressed('KeyP') || input.wasPressed('Escape')) {
    game.paused = !game.paused;
    if (game.paused) hud.message('PAUSED', 1e9); else hud.clearMessage();
    last = performance.now();
  }
  if (input.wasPressed('KeyM')) audio.toggleMute();
}

// Idle camera on the title screen: slow orbit around the grid.
function titleCamera() {
  const t = performance.now() / 1000;
  track.frameAt(track.length - 40 + Math.sin(t * 0.3) * 10, camFrame);
  camera.position.copy(camFrame.pos).addScaledVector(camFrame.right, Math.sin(t * 0.4) * 30).addScaledVector(camFrame.up, 14 + Math.sin(t * 0.7) * 3);
  camera.up.set(0, 1, 0);
  camera.lookAt(player.position);
}

hud.showTitle(true);
crafts.forEach((c) => c.updateVisual(0));
requestAnimationFrame(frame);

// Expose for debugging / automated tests.
window.__game = {
  game, crafts, player, track, startRace, PHYS, camera,
  // Deterministically advance the simulation (used by automated tests).
  advance(seconds) {
    const n = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < n; i++) { updateCountdown(FIXED_DT); simulate(FIXED_DT); }
    for (const c of crafts) c.updateVisual(time);
  },
};
