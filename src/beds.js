// ============================================================================
// Mineblock — beds: placing (two blocks), sleeping through the night, respawn point
// ----------------------------------------------------------------------------
//   beds.place(target)        right-click with a Bed item: foot where you click, head further away
//   beds.use(target)          right-click a bed: set respawn point, sleep if it is night
//   beds.onBroken(x, y, z)    one half was broken: remove the other half, drop the bed item
// Beds anywhere but the Overworld blow up, like in Minecraft.
// ============================================================================
import { BLOCK_ID } from './blocks.js';
import { OPAQUE, LIQUID } from './tables.js';
import { Sky, DAY_LENGTH } from './sky.js';
import { sfx } from './sfx.js';

const FOOT = BLOCK_ID.bed_foot, HEAD = BLOCK_ID.bed_head;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // meta 0..3: head lies north, east, south, west of the foot

export class Beds {
  constructor(game) { this.g = game; this.sleepT = 0; this.fade = document.createElement('div');
    this.fade.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .8s;z-index:4';
    game.ui.appendChild(this.fade); }

  place(t) {
    const g = this.g, dim = g.dim, p = g.player;
    if (!t) return false;
    const x = t.px, y = t.py, z = t.pz;
    // the head goes in the direction the player is facing (forward = -sin yaw, -cos yaw)
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const meta = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 2 : 0);
    const hx = x + DIRS[meta][0], hz = z + DIRS[meta][1];
    const free = (cx, cy, cz) => { const id = dim.getId(cx, cy, cz); return id === 0 || LIQUID[id]; };
    if (!free(x, y, z) || !free(hx, y, hz) || !OPAQUE[dim.getId(x, y - 1, z)] || !OPAQUE[dim.getId(hx, y - 1, hz)]) return false;
    if (g.interact._playerBlocks(x, y, z) || g.interact._playerBlocks(hx, y, hz)) return false;
    dim.setBlock(x, y, z, 'bed_foot', { meta });
    dim.setBlock(hx, y, hz, 'bed_head', { meta });
    sfx.play('place', 0.9);
    if (!g.creative) g.inv.consumeHeld(1);
    g.refreshHotbar();
    return true;
  }

  // the other half of the bed at (x,y,z), using its stored facing
  partner(dim, x, y, z, id, meta) {
    const d = DIRS[meta & 3], s = id === FOOT ? 1 : -1;
    return [x + d[0] * s, y, z + d[1] * s];
  }

  onBroken(x, y, z, id, meta) {
    const g = this.g, dim = g.dim;
    const [px, py, pz] = this.partner(dim, x, y, z, id, meta);
    if (dim.getId(px, py, pz) === (id === FOOT ? HEAD : FOOT)) { g.particles.breakBurst(px, py, pz, id === FOOT ? 'bed_head' : 'bed_foot'); dim.setBlock(px, py, pz, 'air'); }
    if (!g.creative) g.drops.spawn('bed', 1, x + 0.5, y + 0.4, z + 0.5, 0, 2, 0);
    const sp = g.player.spawn;
    if (sp.bed && [x, px].includes(sp.bed.x) && [z, pz].includes(sp.bed.z) && sp.bed.y === y) { g.player.spawn = { ...g.player.worldSpawn }; g.hud.toast('Your bed was broken', 1500); }
  }

  use(t) {
    const g = this.g, dim = g.dim, p = g.player;
    if (g.dimName !== 'overworld') {
      // Minecraft rule: beds explode outside the Overworld
      const meta = dim.getMeta(t.x, t.y, t.z), id = t.id;
      const [px, py, pz] = this.partner(dim, t.x, t.y, t.z, id, meta);
      dim.setBlock(t.x, t.y, t.z, 'air'); if (dim.getId(px, py, pz) === (id === FOOT ? HEAD : FOOT)) dim.setBlock(px, py, pz, 'air');
      g.particles.smoke(t.x + 0.5, t.y + 0.5, t.z + 0.5, 30); sfx.play('explode'); g.shake = 1;
      if (!g.creative) p.damage(6, 'bed');
      g.hud.toast('Beds only work in the Overworld!', 2500);
      return;
    }
    // respawn point: next to the foot of the bed
    let fx = t.x, fz = t.z;
    if (t.id === HEAD) { const m = dim.getMeta(t.x, t.y, t.z); fx -= DIRS[m & 3][0]; fz -= DIRS[m & 3][1]; }
    p.spawn = { x: t.x + 0.5, y: t.y + 1, z: t.z + 0.5, bed: { x: fx, y: t.y, z: fz } };
    if (Sky.brightness(g.time) > 0.45) { g.hud.toast('Respawn point set. You can only sleep at night', 2500); return; }
    const monster = g.mobs.list.some((m) => !m.dying && (m.def.hostile || m.angry) && Math.hypot(m.x - p.x, m.y - p.y, m.z - p.z) < 8);
    if (monster) { g.hud.toast('You may not rest now, there are monsters nearby', 2500); return; }
    this.sleepT = 1.6; this.fade.style.opacity = '1';
    g.hud.toast('Respawn point set. Sleeping…', 1500);
  }

  update(dt) {
    if (this.sleepT <= 0) return;
    this.sleepT -= dt;
    if (this.sleepT <= 0) {
      const g = this.g;
      // jump to the next sunrise (time 0 = sunrise), a little after so it is already bright
      g.time = Math.ceil(g.time / DAY_LENGTH) * DAY_LENGTH + DAY_LENGTH * 0.04;
      this.fade.style.opacity = '0';
      g.hud.toast('Good morning!', 1500);
    }
  }
}
