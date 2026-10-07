// ============================================================================
// Mineblock — Nether portals: frame detection, ignition, travel, arrival
// ----------------------------------------------------------------------------
//   portals.tryIgnite(target)     flint and steel on obsidian / inside a frame
//   portals.update(dt)            4 s in a portal -> switch dimension
//   portals.arrive(dim, x, y, z)  find or build the exit portal, returns stand position
// Interior sizes 2x3 .. 21x21 are supported, on either horizontal axis.
// Portal blocks carry meta 0 (plane spans X) or 1 (plane spans Z).
// ============================================================================
import { BLOCK_ID, BLOCK_LIST } from './blocks.js';
import { OPAQUE, LIQUID } from './tables.js';
import { sfx } from './sfx.js';

const AIR = BLOCK_ID.air, OBS = BLOCK_ID.obsidian, PORTAL = BLOCK_ID.nether_portal;
export const TRAVEL_TIME = 4;

export function findFrame(dim, sx, sy, sz) {
  const free = (x, y, z) => { const id = dim.getId(x, y, z); return id === AIR || id === PORTAL; };
  if (!free(sx, sy, sz)) return null;
  for (const axis of [0, 1]) {            // 0: frame plane spans X, 1: spans Z
    const dx = axis === 0 ? 1 : 0, dz = axis === 0 ? 0 : 1;
    let x = sx, y = sy, z = sz;
    for (let i = 0; i < 25; i++) {
      let moved = false;
      if (free(x, y - 1, z)) { y--; moved = true; }
      if (free(x - dx, y, z - dz)) { x -= dx; z -= dz; moved = true; }
      if (!moved) break;
    }
    if (dim.getId(x, y - 1, z) !== OBS || dim.getId(x - dx, y, z - dz) !== OBS) continue;
    let w = 0; while (w <= 21 && free(x + dx * w, y, z + dz * w)) w++;
    let h = 0; while (h <= 21 && free(x, y + h, z)) h++;
    if (w < 2 || w > 21 || h < 3 || h > 21) continue;
    let ok = true;
    for (let i = 0; i < w && ok; i++) for (let j = 0; j < h && ok; j++) ok = free(x + dx * i, y + j, z + dz * i);
    for (let i = 0; i < w && ok; i++) ok = dim.getId(x + dx * i, y - 1, z + dz * i) === OBS && dim.getId(x + dx * i, y + h, z + dz * i) === OBS;
    for (let j = 0; j < h && ok; j++) ok = dim.getId(x - dx, y + j, z - dz) === OBS && dim.getId(x + dx * w, y + j, z + dz * w) === OBS;
    if (ok) return { x, y, z, axis, w, h, dx, dz };
  }
  return null;
}

export class Portals {
  constructor(game) { this.g = game; this.timer = 0; this.cooldown = 0; this.humming = false; this.travelling = false; }

  tryIgnite(t) {
    const g = this.g, dim = g.dim;
    // interior candidates: the air cell in front of the clicked face, plus the air cells around the clicked block
    // (so clicking any part of the obsidian frame works, not just its inner face)
    const cand = [[t.px, t.py, t.pz]];
    for (const [dx, dy, dz] of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) cand.push([t.x + dx, t.y + dy, t.z + dz]);
    for (const [x, y, z] of cand) {
      const f = findFrame(dim, x, y, z);
      if (f) { this.fill(dim, f); return true; }
    }
    return false;
  }
  fill(dim, f) {
    for (let i = 0; i < f.w; i++) for (let j = 0; j < f.h; j++) dim.setBlock(f.x + f.dx * i, f.y + j, f.z + f.dz * i, 'nether_portal', { meta: f.axis, silent: true });
    if (!dim.portals.some((p) => p.x === f.x && p.y === f.y && p.z === f.z)) dim.portals.push({ x: f.x, y: f.y, z: f.z, axis: f.axis, w: f.w, h: f.h });
    this.g.particles.smoke(f.x + 0.5, f.y + 1, f.z + 0.5, 10);
    this.g.hud.toast('A portal opens…', 1500);
  }

  // obsidian or a portal block was removed: dissolve connected portal blocks
  onFrameBroken(dim, x, y, z) {
    const stack = [];
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) if (dim.getId(x + dx, y + dy, z + dz) === PORTAL) stack.push([x + dx, y + dy, z + dz]);
    let n = 0;
    while (stack.length && n < 1200) {
      const [px, py, pz] = stack.pop();
      if (dim.getId(px, py, pz) !== PORTAL) continue;
      dim.setBlock(px, py, pz, 'air', { silent: true }); n++;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) if (dim.getId(px + dx, py + dy, pz + dz) === PORTAL) stack.push([px + dx, py + dy, pz + dz]);
    }
    if (n) dim.portals = dim.portals.filter((p) => dim.getId(p.x, p.y, p.z) === PORTAL || !dim.loaded(p.x, p.z));
  }

  update(dt) {
    const g = this.g, p = g.player;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.travelling) return;
    if (p.inPortal && this.cooldown <= 0) {
      this.timer += dt;
      if (!this.humming) { this.humming = true; sfx.portalHum(true); }
      const need = g.creative ? 0.15 : TRAVEL_TIME;
      if (Math.random() < dt * 40) g.particles.portal(p.x + (Math.random() - 0.5) * 1.5, p.y + Math.random() * 2, p.z + (Math.random() - 0.5) * 1.5, p.x, p.y + 1, p.z);
      if (this.timer >= need) { this.timer = 0; this.travel(); }
    } else {
      if (this.timer > 0) { this.timer = Math.max(0, this.timer - dt * 2); }
      if (this.timer <= 0 && this.humming) { this.humming = false; sfx.portalHum(false); }
    }
  }
  // 0..1 progress for FOV wobble
  get progress() { return Math.min(1, this.timer / TRAVEL_TIME); }

  travel() {
    const g = this.g, p = g.player;
    const to = g.dimName === 'overworld' ? 'nether' : 'overworld';
    const s = to === 'nether' ? 1 / 8 : 8;
    this.humming = false; sfx.portalHum(false); sfx.play('portal');
    this.travelling = true;
    g.switchDimension(to, p.x * s, p.y, p.z * s);
    this.travelling = false; this.cooldown = 10; this.timer = 0;
    g.hud.toast(to === 'nether' ? 'Entering the Nether' : 'Returning to the Overworld', 2500);
  }

  // Load chunks near (tx,tz) in `dim` (already the active dimension), then return the standing position in front of an existing or freshly built portal.
  arrive(dim, tx, ty, tz) {
    const cx = Math.floor(tx) >> 4, cz = Math.floor(tz) >> 4;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) dim.ensureChunk(cx + dx, cz + dz);
    // 1. existing portal within 128 blocks
    let best = null, bd = 128 * 128;
    for (const pr of dim.portals) { const d = (pr.x - tx) ** 2 + (pr.z - tz) ** 2; if (d < bd) { bd = d; best = pr; } }
    if (best) {
      const bcx = best.x >> 4, bcz = best.z >> 4;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) dim.ensureChunk(bcx + dx, bcz + dz);
      if (dim.getId(best.x, best.y, best.z) === PORTAL) return this.standBeside(dim, best);
      dim.portals = dim.portals.filter((q) => q !== best);
    }
    // 2. choose a floor and build one
    const spot = this.findSpot(dim, Math.floor(tx), Math.floor(ty), Math.floor(tz));
    return this.build(dim, spot.x, spot.y, spot.z);
  }

  standBeside(dim, pr) {
    const dx = pr.axis === 0 ? 1 : 0, dz = pr.axis === 0 ? 0 : 1;
    const cx = pr.x + 0.5 + dx * ((pr.w || 2) - 1) / 2, cz = pr.z + 0.5 + dz * ((pr.w || 2) - 1) / 2;
    // step off the portal plane to whichever side has room
    for (const side of [1.4, -1.4, 2.4, -2.4]) {
      const x = cx + (pr.axis === 1 ? side : 0), z = cz + (pr.axis === 0 ? side : 0);
      if (!OPAQUE[dim.getId(Math.floor(x), pr.y, Math.floor(z))] && !OPAQUE[dim.getId(Math.floor(x), pr.y + 1, Math.floor(z))] && OPAQUE[dim.getId(Math.floor(x), pr.y - 1, Math.floor(z))]) return { x, y: pr.y, z, yaw: pr.axis === 0 ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2) };
    }
    return { x: cx, y: pr.y, z: cz + 1.4, yaw: 0 };
  }

  findSpot(dim, tx, ty, tz) {
    const floorAt = (x, z) => {
      if (dim.name === 'overworld') {
        for (let y = 126; y > 1; y--) { const id = dim.getId(x, y, z); if (OPAQUE[id] || LIQUID[id]) return y; }
        return -1;
      }
      for (let y = Math.min(100, Math.max(36, ty + 10)); y > 32; y--) {
        const id = dim.getId(x, y, z);
        if (OPAQUE[id] && !OPAQUE[dim.getId(x, y + 1, z)] && !LIQUID[dim.getId(x, y + 1, z)] && !OPAQUE[dim.getId(x, y + 2, z)] && !OPAQUE[dim.getId(x, y + 3, z)]) return y;
      }
      return -1;
    };
    for (let r = 0; r <= 24; r += 3) for (let a = 0; a < (r === 0 ? 1 : 8); a++) {
      const x = Math.round(tx + Math.cos(a * Math.PI / 4) * r), z = Math.round(tz + Math.sin(a * Math.PI / 4) * r);
      const y = floorAt(x, z);
      if (y > 0) return { x, y, z };
    }
    return { x: tx, y: dim.name === 'nether' ? 64 : 70, z: tz };
  }

  // Builds a 4x5 obsidian frame (axis 0) on a floor at y0, clears room around it, lights it.
  build(dim, cx, y0, cz) {
    const x0 = cx - 1;
    for (let x = x0 - 1; x <= x0 + 2; x++) for (let z = cz - 1; z <= cz + 2; z++) for (let y = y0 + 1; y <= y0 + 4; y++) dim.setBlock(x, y, z, 'air', { silent: true });
    for (let x = x0 - 1; x <= x0 + 2; x++) for (let z = cz - 1; z <= cz + 2; z++) { if (!OPAQUE[dim.getId(x, y0, z)]) dim.setBlock(x, y0, z, 'obsidian', { silent: true }); }
    for (let x = x0 - 1; x <= x0 + 2; x++) { dim.setBlock(x, y0, cz, 'obsidian', { silent: true }); dim.setBlock(x, y0 + 4, cz, 'obsidian', { silent: true }); }
    for (let y = y0 + 1; y <= y0 + 3; y++) { dim.setBlock(x0 - 1, y, cz, 'obsidian', { silent: true }); dim.setBlock(x0 + 2, y, cz, 'obsidian', { silent: true }); }
    for (let x = x0; x <= x0 + 1; x++) for (let y = y0 + 1; y <= y0 + 3; y++) dim.setBlock(x, y, cz, 'nether_portal', { meta: 0, silent: true });
    const pr = { x: x0, y: y0 + 1, z: cz, axis: 0, w: 2, h: 3 };
    dim.portals.push(pr);
    return { x: cx + 0.5, y: y0 + 1, z: cz + 1.5, yaw: 0 };
  }
}
