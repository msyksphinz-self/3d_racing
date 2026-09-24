import { formatTime } from './util.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(track) {
    this.track = track;
    this.el = {
      speed: $('speed'), lap: $('lap'), pos: $('pos'), time: $('time'), laptime: $('laptime'), best: $('best'),
      boostfill: $('boostfill'), center: $('center'), results: $('results'), title: $('title'),
      flash: $('flash'), vignette: $('vignette'), minimap: $('minimap'), mute: $('mute'), boostwrap: $('boostwrap'),
    };
    this.ctx = this.el.minimap.getContext('2d');
    this.centerTimer = 0;
    this.flashLevel = 0;
    this._prepMap();
  }

  _prepMap() {
    const m = this.track.map;
    const W = this.el.minimap.width, H = this.el.minimap.height;
    const pad = 14;
    const sx = (W - pad * 2) / (m.maxX - m.minX);
    const sz = (H - pad * 2) / (m.maxZ - m.minZ);
    this.mapScale = Math.min(sx, sz);
    this.mapOff = [
      pad + ((W - pad * 2) - (m.maxX - m.minX) * this.mapScale) / 2,
      pad + ((H - pad * 2) - (m.maxZ - m.minZ) * this.mapScale) / 2,
    ];
  }

  mapXY(x, z) {
    const m = this.track.map;
    return [this.mapOff[0] + (x - m.minX) * this.mapScale, this.el.minimap.height - (this.mapOff[1] + (z - m.minZ) * this.mapScale)];
  }

  showTitle(show) { this.el.title.classList.toggle('hidden', !show); }

  message(text, seconds = 1.2, big = false) {
    this.el.center.textContent = text;
    this.el.center.classList.toggle('big', big);
    this.el.center.classList.add('show');
    this.centerTimer = seconds;
  }

  clearMessage() { this.centerTimer = 0; this.el.center.classList.remove('show'); }

  flash(strength = 1) { this.flashLevel = Math.max(this.flashLevel, strength); }

  showResults(player, crafts, raceTime) {
    const order = [...crafts].sort((a, b) => (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity) || b.totalDist - a.totalDist);
    const rows = order.map((c, i) => `<tr class="${c.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td>${c.name}</td><td>${formatTime(c.finishTime)}</td><td>${formatTime(c.bestLap)}</td></tr>`).join('');
    const rank = order.indexOf(player) + 1;
    this.el.results.innerHTML = `
      <h2>FINISH &mdash; ${ordinal(rank)} PLACE</h2>
      <table><thead><tr><th>#</th><th>PILOT</th><th>TOTAL</th><th>BEST LAP</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="hint">Press <b>R</b> to race again</p>`;
    this.el.results.classList.remove('hidden');
  }

  hideResults() { this.el.results.classList.add('hidden'); }

  update(dt, { player, crafts, raceTime, state, laps, muted }) {
    const e = this.el;
    e.speed.textContent = String(Math.round(player.speed * 3.6)).padStart(3, '0');
    e.lap.textContent = String(Math.min(laps, Math.max(1, player.laps + 1)));
    const sorted = [...crafts].sort((a, b) => b.totalDist - a.totalDist);
    e.pos.textContent = String(sorted.indexOf(player) + 1);
    e.time.textContent = formatTime(state === 'countdown' ? 0 : (player.finished ? player.finishTime : raceTime));
    e.laptime.textContent = formatTime(player.lapStart == null || player.finished ? null : raceTime - player.lapStart);
    e.best.textContent = formatTime(player.bestLap);
    e.boostfill.style.width = `${player.boostEnergy}%`;
    e.boostwrap.classList.toggle('boosting', player.boosting);
    e.mute.textContent = muted ? 'M: SOUND OFF' : 'M: SOUND ON';

    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      if (this.centerTimer <= 0) e.center.classList.remove('show');
    }
    this.flashLevel = Math.max(0, this.flashLevel - dt * 3);
    e.flash.style.opacity = this.flashLevel * 0.55;
    const v = Math.min(1, Math.max(0, (player.speed - 80) / 120));
    e.vignette.style.opacity = 0.25 + v * 0.55 + (player.boosting ? 0.15 : 0);

    this._drawMap(crafts, player);
  }

  _drawMap(crafts, player) {
    const ctx = this.ctx;
    const W = this.el.minimap.width, H = this.el.minimap.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(5,6,16,0.55)';
    ctx.beginPath(); ctx.roundRect(0, 0, W, H, 12); ctx.fill();
    const pts = this.track.map.pts;
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = this.mapXY(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(34,211,238,0.35)'; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#9ff3ff'; ctx.stroke();
    const [sx, sy] = this.mapXY(this.track.pos[0].x, this.track.pos[0].z);
    ctx.fillStyle = '#fff'; ctx.fillRect(sx - 3, sy - 3, 6, 6);
    for (const c of crafts) {
      const [x, y] = this.mapXY(c.position.x, c.position.z);
      ctx.beginPath();
      ctx.arc(x, y, c.isPlayer ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = c.isPlayer ? '#ffffff' : `#${c.accent.getHexString()}`;
      ctx.fill();
      if (c.isPlayer) { ctx.lineWidth = 2; ctx.strokeStyle = '#22d3ee'; ctx.stroke(); }
    }
  }
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
