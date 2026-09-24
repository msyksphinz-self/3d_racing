import { clamp } from './util.js';
import { PHYS } from './vehicle.js';

// Autopilot used by opponents (and by the player after finishing).
export function aiControl(craft, track, crafts, time, player) {
  const inp = craft.input;
  const ai = craft.ai;
  const v = craft.speed;

  // Look ahead proportional to speed to judge upcoming corners.
  const look1 = 25 + v * 0.35;
  const look2 = 60 + v * 0.8;
  const k0 = track.kappaAt(craft.s + 10);
  const k1 = track.kappaAt(craft.s + look1);
  const k2 = track.kappaAt(craft.s + look2);
  const kMax = Math.max(Math.abs(k0), Math.abs(k1), Math.abs(k2));

  // Rubber banding keeps the pack close to the player.
  let skill = ai.skill;
  if (player && player !== craft) {
    const gap = player.totalDist - craft.totalDist;
    if (gap > 350) skill += 0.06;
    else if (gap < -350) skill -= 0.05;
  }

  const vLimit = skill * PHYS.vMax * (1 - clamp(kMax * 48, 0, 0.5)) * (1 + (craft.boosting ? 0.35 : 0));
  inp.throttle = v < vLimit ? 1 : 0.15;
  inp.brake = v > vLimit * 1.15 ? 0.7 : 0;

  // Racing line: hug the inside of the next corner, add personal offset & drift.
  const hw = track.halfWidth - PHYS.bodyHalfWidth - 1.0;
  const inside = -Math.sign(k1) * Math.min(hw * 0.55, Math.abs(k1) * 1000);
  let target = inside + ai.offset + Math.sin(time * 0.6 + ai.phase) * 2.0;

  // Avoid crafts just ahead.
  for (const o of crafts) {
    if (o === craft) continue;
    let ds = o.s - craft.s;
    if (ds > track.length / 2) ds -= track.length;
    if (ds < -track.length / 2) ds += track.length;
    if (ds > 0 && ds < 40 && Math.abs(o.lat - craft.lat) < 6) {
      target += o.lat > craft.lat ? -5 : 5;
    }
  }
  target = clamp(target, -hw + 1.5, hw - 1.5);

  // Prefer boost pads that are within reach.
  const padAhead = nearestPadAhead(track, craft.s, 120);
  if (padAhead) {
    const mid = (padAhead.lat0 + padAhead.lat1) / 2;
    if (Math.abs(mid - craft.lat) < 12) target = clamp(mid, -hw + 1.5, hw - 1.5);
  }

  const err = target - craft.lat;
  const kappa = track.kappaAt(craft.s);
  const centrifugal = PHYS.centrifugal * kappa * v * v;
  const desiredLatVel = clamp(err * 2.2, -60, 60) - centrifugal;
  const maxLat = PHYS.steerBase + PHYS.steerRate * v;
  inp.steer = clamp(desiredLatVel / maxLat, -1, 1);

  // Boost on straights when the tank is full enough.
  const straight = kMax < 0.0025;
  if (!craft.boosting && craft.boostEnergy > 55 && straight && Math.random() < ai.aggression * 0.02) {
    inp.boost = true;
  } else if (craft.boosting && (craft.boostEnergy < 8 || kMax > 0.006)) {
    inp.boost = false;
  }
}

function nearestPadAhead(track, s, range) {
  const L = track.length;
  let best = null, bestD = Infinity;
  for (const p of track.pads) {
    let d = p.s - s;
    d = ((d % L) + L) % L;
    if (d < range && d < bestD) { best = p; bestD = d; }
  }
  return best;
}
