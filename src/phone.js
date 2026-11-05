// ============================================================================
// Mineblock — the Phone item
// ----------------------------------------------------------------------------
// While you hold it, its screen (a canvas texture on the phone in your hand,
// desktop and VR alike) shows the time, where you are, and an arrow + distance
// to home (your bed, or the world spawn). Use it once and it offers to
// "call home"; use it again within 4 seconds to teleport there.
//   phone.texture     THREE texture for the screen
//   phone.update(dt)  redraws a few times a second while held
//   phone.use()       right click / tap / VR grip with the phone
// ============================================================================
import * as THREE from 'three';
import { DAY_LENGTH } from './sky.js';
import { sfx } from './sfx.js';

const W = 160, H = 288;

export class Phone {
  constructor(game) {
    this.g = game; this.armed = 0; this.t = 0; this.callT = 0;
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw();
  }
  home() { const s = this.g.player.spawn; return { x: s.x, z: s.z, bed: !!s.bed }; }

  use() {
    const g = this.g;
    if (this.callT > 0) return true;
    if (this.armed > 0) {
      this.armed = 0; this.callT = 1.2; sfx.play('phone');
      g.hud.toast('Calling home…', 1200);
      return true;
    }
    this.armed = 4; sfx.play('click');
    const p = g.player, h = this.home(), d = Math.round(Math.hypot(h.x - p.x, h.z - p.z));
    g.hud.toast(`${g.dimName === 'overworld' ? `Home is ${d} blocks away.` : 'Home is in the Overworld.'} Use the phone again to go there`, 3500);
    this.draw();
    return true;
  }

  update(dt) {
    const g = this.g;
    if (this.armed > 0) this.armed = Math.max(0, this.armed - dt);
    if (this.callT > 0) {
      this.callT -= dt;
      if (this.callT <= 0) {
        const p = g.player;
        g.particles.portal(p.x, p.y + 1, p.z, p.x, p.y + 1.5, p.z);
        if (g.dimName !== 'overworld') g.switchDimension('overworld', 0, 0, 0, false, 'spawn');
        else { const s = g.spawnArrival(g.dim); p.teleport(s.x, s.y, s.z); g.loading = true; g.menus.loading?.open('Going home…'); }
        sfx.play('portal', 1.4);
        g.hud.toast('Welcome home!', 1500);
      }
    }
    this.t -= dt;
    if (this.t <= 0 && g.inv.held?.item === 'phone') { this.t = 0.2; this.draw(); }
  }

  draw() {
    const g = this.g, c = this.ctx, p = g.player;
    const grad = c.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, '#1d3f7a'); grad.addColorStop(1, '#0c1a33');
    c.fillStyle = grad; c.fillRect(0, 0, W, H);
    c.textAlign = 'center'; c.fillStyle = '#fff';
    // clock (time 0 = sunrise = 6:00)
    const hours = ((g.time / DAY_LENGTH) * 24 + 6) % 24, hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60);
    c.font = 'bold 40px monospace'; c.fillText(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, W / 2, 50);
    c.font = '15px monospace'; c.fillStyle = '#9ec3ff';
    c.fillText(`Day ${Math.floor(g.time / DAY_LENGTH) + 1} · ${hh >= 6 && hh < 18 ? 'day' : 'night'}`, W / 2, 72);
    c.fillText({ overworld: 'Overworld', nether: 'The Nether', end: 'The End' }[g.dimName] || '', W / 2, 92);
    // position
    c.fillStyle = '#fff'; c.font = 'bold 15px monospace';
    c.fillText(`X ${Math.floor(p.x)}  Y ${Math.floor(p.y)}  Z ${Math.floor(p.z)}`, W / 2, 120);
    // compass arrow to home
    const h = this.home(), cx = W / 2, cy = 182;
    c.strokeStyle = '#3d6bb5'; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, 44, 0, Math.PI * 2); c.stroke();
    if (g.dimName === 'overworld') {
      const want = Math.atan2(-(h.x - p.x), -(h.z - p.z));   // yaw that would face home
      const a = want - p.yaw;                                    // 0 = straight ahead (arrow up)
      c.save(); c.translate(cx, cy); c.rotate(-a);
      c.fillStyle = '#ff5a4a'; c.beginPath(); c.moveTo(0, -36); c.lineTo(13, 8); c.lineTo(0, 0); c.lineTo(-13, 8); c.closePath(); c.fill();
      c.restore();
      c.fillStyle = '#fff'; c.font = 'bold 16px monospace';
      c.fillText(`${h.bed ? 'Bed' : 'Spawn'} ${Math.round(Math.hypot(h.x - p.x, h.z - p.z))} m`, W / 2, 248);
    } else { c.fillStyle = '#9ec3ff'; c.font = '14px monospace'; c.fillText('no signal', cx, cy + 5); c.fillText('home: Overworld', W / 2, 248); }
    // call button
    c.fillStyle = this.armed > 0 || this.callT > 0 ? '#3fcf5a' : '#2a4a80';
    c.beginPath(); c.roundRect?.(20, 258, W - 40, 24, 12); if (!c.roundRect) c.rect(20, 258, W - 40, 24); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 13px monospace';
    c.fillText(this.callT > 0 ? 'Calling…' : this.armed > 0 ? 'Use again: go home' : 'Use: call home', W / 2, 275);
    this.texture.needsUpdate = true;
  }
}
