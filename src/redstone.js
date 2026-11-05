// ============================================================================
// Mineblock — redstone: dust, levers, lamps, pistons (normal + sticky),
// observers, doors, and the TNT trigger
// ----------------------------------------------------------------------------
//   const rs = new Redstone(game); rs.attach(dim)   listens for block changes
//   rs.update(dt)                 runs redstone ticks (10 a second)
//   rs.place(t, key)              place a redstone block with the right facing; true/false, undefined = not ours
//   rs.placeDoor(t)               the Oak Door item
//   rs.toggleLever(t) / rs.toggleDoor(t)
//
// Directions are indexes into D6 (same order as block faces):
//   0 up, 1 down, 2 north (-z), 3 south (+z), 4 east (+x), 5 west (-x)
// Block meta (stored per block in the chunk):
//   redstone_wire   power 0..15
//   lever           bits 0-2 = direction of the block it hangs on, bit 3 = on, bit 4 = floor lever turned 90°
//   piston, sticky  bits 0-2 = facing (the side that pushes), bit 3 = extended
//   piston_head     bits 0-2 = facing, bit 3 = sticky
//   observer        bits 0-2 = the way its face looks, bit 3 = sending a pulse (out of its back)
//   door halves     bits 0-1 = facing (0 N, 1 E, 2 S, 3 W), bit 2 = open, bit 3 = hinge on the right, bit 4 = powered
//
// Rules (a simplified version of Minecraft's):
//   * Levers (when on), blocks of redstone and pulsing observers are power sources.
//   * Dust carries power, losing 1 per block, and climbs up/down one block.
//   * A lever "strongly" powers the block it's attached to; an observer strongly powers the block
//     behind it. Dust next to a strongly powered block gets full power.
//   * Dust "weakly" powers the block it sits on and blocks beside it. Weak and strong powered blocks
//     power the machines next to them (pistons, doors, lamps, TNT).
//   * Pistons push up to 12 blocks. Slime and honey blocks drag their neighbours along.
// ============================================================================
import { BLOCKS, BLOCK_LIST, BLOCK_ID } from './blocks.js';
import { OPAQUE, LIQUID } from './tables.js';
import { sfx } from './sfx.js';

export const D6 = [[0, 1, 0], [0, -1, 0], [0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0]];
export const OPP = [1, 0, 3, 2, 5, 4];
const ID = BLOCK_ID;
const WIRE = ID.redstone_wire, LEVER = ID.lever, RBLOCK = ID.redstone_block, LAMP = ID.redstone_lamp, LAMP_ON = ID.redstone_lamp_lit;
const PISTON = ID.piston, STICKY = ID.sticky_piston, HEAD = ID.piston_head, OBS = ID.observer, TNT = ID.tnt;
const DOOR_L = ID.door_lower, DOOR_U = ID.door_upper, SLIME = ID.slime_block, HONEY = ID.honey_block;
const TICK = 0.1, PUSH_LIMIT = 12;
const key = (x, y, z) => `${x},${y},${z}`;
const unkey = (k) => k.split(',').map(Number);

// blocks that carry power through themselves (weak/strong powering)
const CONDUCT = new Uint8Array(BLOCK_LIST.length);
BLOCK_LIST.forEach((k, i) => { CONDUCT[i] = OPAQUE[i] && ![PISTON, STICKY, OBS, RBLOCK].includes(i) ? 1 : 0; });
// pistons can't move these
const IMMOVABLE = new Set(['bedrock', 'obsidian', 'end_portal_frame', 'end_portal_frame_filled', 'end_portal', 'nether_portal', 'furnace', 'furnace_lit', 'bed_foot', 'bed_head', 'piston_head'].map((k) => ID[k]));
// pistons break these (they pop off as items)
const BREAKS = new Set(BLOCK_LIST.map((k, i) => (BLOCKS[k].popsOff || BLOCKS[k].model === 'cross' ? i : -1)).filter((i) => i >= 0));
const isPiston = (id) => id === PISTON || id === STICKY;
const isDoor = (id) => id === DOOR_L || id === DOOR_U;

// Door panel in the block, as [x0, z0, x1, z1] (0..1). Closed: on the side the player stood.
// Open: swung against the hinge side.
const HD = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const T = 3 / 16;
export function doorBox(meta) {
  const [lx, lz] = HD[meta & 3];
  if (!(meta & 4)) {
    if (lz) return lz < 0 ? [0, 1 - T, 1, 1] : [0, 0, 1, T];
    return lx < 0 ? [1 - T, 0, 1, 1] : [0, 0, T, 1];
  }
  let sx = lz, sz = -lx;                     // left of where the player looked
  if (meta & 8) { sx = -sx; sz = -sz; }
  if (sx) return sx < 0 ? [0, 0, T, 1] : [1 - T, 0, 1, 1];
  return sz < 0 ? [0, 0, 1, T] : [0, 1 - T, 1, 1];
}

export class Redstone {
  constructor(game) {
    this.g = game; this.acc = 0; this.t = 0;
    this.dirty = new Set(); this.queue = []; this.pending = new Set(); this.busy = false;
  }
  get dim() { return this.g.dim; }
  attach(dim) { dim.listeners.push((x, y, z, o, n, om) => this.onChange(dim, x, y, z, o, n, om)); }
  clear() { this.dirty.clear(); this.queue.length = 0; this.pending.clear(); this.busy = false; }

  // ------------------------------------------------------------ helpers
  id(x, y, z) { return this.dim.getId(x, y, z); }
  meta(x, y, z) { return this.dim.getMeta(x, y, z); }
  mark(x, y, z) { this.dirty.add(key(x, y, z)); }
  later(ticks, fn) { this.queue.push({ at: this.t + ticks, fn }); }
  setMeta(x, y, z, v) { if (this.meta(x, y, z) === v) return; this.dim.setMeta(x, y, z, v); this.mark(x, y, z); this.notifyObservers(x, y, z); }
  drop(item, x, y, z) { if (!this.g.creative && item) this.g.drops.spawn(item, 1, x + 0.5, y + 0.4, z + 0.5, (Math.random() - 0.5) * 2, 2.5, (Math.random() - 0.5) * 2); }
  // remove a block the way a piston or lost support does: it pops off as an item
  pop(x, y, z) {
    const id = this.id(x, y, z), b = BLOCKS[BLOCK_LIST[id]];
    this.g.particles.breakBurst(x, y, z, BLOCK_LIST[id]);
    if (isDoor(id)) {
      const ly = id === DOOR_L ? y : y - 1, was = this.busy;
      this.busy = true; this.dim.setBlock(x, ly, z, 'air'); this.dim.setBlock(x, ly + 1, z, 'air'); this.busy = was;
      this.drop('oak_door', x, ly, z);
      return;
    }
    this.dim.setBlock(x, y, z, 'air');
    this.drop(b.drops === undefined ? b.key : b.drops, x, y, z);
  }

  // ------------------------------------------------------------ world changes
  onChange(dim, x, y, z, oldKey, newKey, oldMeta = 0) {
    if (dim !== this.g.dim) return;
    this.mark(x, y, z);
    this.notifyObservers(x, y, z);
    const oid = ID[oldKey], nid = ID[newKey];
    // things that hang on this block fall off when it goes away
    if (!OPAQUE[nid]) {
      if (this.id(x, y + 1, z) === WIRE || this.id(x, y + 1, z) === DOOR_L) this.pop(x, y + 1, z);
      for (let i = 0; i < 6; i++) {
        const n = D6[i], lx = x + n[0], ly = y + n[1], lz = z + n[2];
        if (this.id(lx, ly, lz) === LEVER && (this.meta(lx, ly, lz) & 7) === OPP[i]) this.pop(lx, ly, lz);
      }
    }
    if (this.busy) return;
    // piston base and head belong together
    if (oid === HEAD && nid !== HEAD) {
      const d = D6[oldMeta & 7], bx = x - d[0], by = y - d[1], bz = z - d[2], bid = this.id(bx, by, bz);
      if (isPiston(bid) && (this.meta(bx, by, bz) & 8)) { this.busy = true; dim.setBlock(bx, by, bz, 'air'); this.busy = false; this.drop(BLOCK_LIST[bid], bx, by, bz); }
    }
    if (isPiston(oid) && (oldMeta & 8) && !isPiston(nid)) {
      const d = D6[oldMeta & 7];
      if (this.id(x + d[0], y + d[1], z + d[2]) === HEAD) { this.busy = true; dim.setBlock(x + d[0], y + d[1], z + d[2], 'air'); this.busy = false; }
    }
    // a door is two blocks
    if (isDoor(oid) && !isDoor(nid)) {
      const py = oid === DOOR_L ? y + 1 : y - 1;
      if (this.id(x, py, z) === (oid === DOOR_L ? DOOR_U : DOOR_L)) { this.busy = true; dim.setBlock(x, py, z, 'air'); this.busy = false; }
      this.drop('oak_door', x, Math.min(y, py), z);
    }
  }

  // observers whose face looks at (x,y,z) send a pulse
  notifyObservers(x, y, z) {
    for (let i = 0; i < 6; i++) {
      const n = D6[i], ox = x + n[0], oy = y + n[1], oz = z + n[2];
      if (this.id(ox, oy, oz) === OBS && (this.meta(ox, oy, oz) & 7) === OPP[i]) this.pulse(ox, oy, oz);
    }
  }
  pulse(x, y, z) {
    const k = 'o' + key(x, y, z);
    if (this.pending.has(k)) return;
    this.pending.add(k);
    this.later(1, () => {
      if (this.id(x, y, z) !== OBS) { this.pending.delete(k); return; }
      this.setObs(x, y, z, true);
      this.later(2, () => { this.pending.delete(k); if (this.id(x, y, z) === OBS) this.setObs(x, y, z, false); });
    });
  }
  setObs(x, y, z, on) {
    const m = this.meta(x, y, z), b = D6[OPP[m & 7]];
    this.setMeta(x, y, z, on ? m | 8 : m & ~8);
    this.mark(x + b[0], y + b[1], z + b[2]);
  }

  // ------------------------------------------------------------ power
  isSource(nid, nx, ny, nz, tx, ty, tz) {
    if (nid === RBLOCK) return true;
    if (nid === LEVER) return !!(this.meta(nx, ny, nz) & 8);
    if (nid === OBS) { const m = this.meta(nx, ny, nz); if (!(m & 8)) return false; const b = D6[OPP[m & 7]]; return nx + b[0] === tx && ny + b[1] === ty && nz + b[2] === tz; }
    return false;
  }
  // a lever on it, or an observer pointing its back at it
  strong(x, y, z) {
    for (let i = 0; i < 6; i++) {
      const n = D6[i], sx = x + n[0], sy = y + n[1], sz = z + n[2], sid = this.id(sx, sy, sz);
      if (sid === LEVER) { const m = this.meta(sx, sy, sz); if ((m & 8) && (m & 7) === OPP[i]) return true; }
      else if (sid === OBS && this.isSource(sid, sx, sy, sz, x, y, z)) return true;
    }
    return false;
  }
  weak(x, y, z) {
    if (this.id(x, y + 1, z) === WIRE && this.meta(x, y + 1, z) > 0) return true;
    for (let i = 2; i < 6; i++) { const n = D6[i]; if (this.id(x + n[0], y, z + n[2]) === WIRE && this.meta(x + n[0], y, z + n[2]) > 0) return true; }
    return false;
  }
  // is a machine at (x,y,z) powered? skip = a side that doesn't count (a piston's front)
  powered(x, y, z, skip = -1) {
    for (let i = 0; i < 6; i++) {
      if (i === skip) continue;
      const n = D6[i], nx = x + n[0], ny = y + n[1], nz = z + n[2], nid = this.id(nx, ny, nz);
      if (this.isSource(nid, nx, ny, nz, x, y, z)) return true;
      if (nid === WIRE) { if (i !== 1 && this.meta(nx, ny, nz) > 0) return true; continue; }
      if (CONDUCT[nid] && (this.strong(nx, ny, nz) || this.weak(nx, ny, nz))) return true;
    }
    return false;
  }
  wireInput(x, y, z) {
    for (let i = 0; i < 6; i++) {
      const n = D6[i], nx = x + n[0], ny = y + n[1], nz = z + n[2], nid = this.id(nx, ny, nz);
      if (this.isSource(nid, nx, ny, nz, x, y, z)) return 15;
      if (CONDUCT[nid] && this.strong(nx, ny, nz)) return 15;
    }
    return 0;
  }
  // dust connected to this dust (same level, one down, one up)
  wireLinks(x, y, z) {
    const out = [];
    const upFree = !OPAQUE[this.id(x, y + 1, z)];
    for (let i = 2; i < 6; i++) {
      const n = D6[i], nx = x + n[0], nz = z + n[2], side = this.id(nx, y, nz);
      if (side === WIRE) out.push([nx, y, nz]);
      else {
        if (!OPAQUE[side] && this.id(nx, y - 1, nz) === WIRE) out.push([nx, y - 1, nz]);
        if (upFree && OPAQUE[side] && this.id(nx, y + 1, nz) === WIRE) out.push([nx, y + 1, nz]);
      }
    }
    return out;
  }
  // recompute the power of a whole network of connected dust
  network(sx, sy, sz, seen, changed) {
    const nodes = new Map(), stack = [[sx, sy, sz]];
    seen.add(key(sx, sy, sz));
    while (stack.length && nodes.size < 3000) {
      const [x, y, z] = stack.pop(), k = key(x, y, z);
      const node = { x, y, z, k, links: [], lvl: this.wireInput(x, y, z) };
      nodes.set(k, node);
      for (const l of this.wireLinks(x, y, z)) { const lk = key(...l); node.links.push(lk); if (!seen.has(lk)) { seen.add(lk); stack.push(l); } }
    }
    const buckets = Array.from({ length: 16 }, () => []);
    for (const n of nodes.values()) if (n.lvl) buckets[n.lvl].push(n);
    for (let l = 15; l > 1; l--) for (const n of buckets[l]) {
      if (n.lvl !== l) continue;
      for (const lk of n.links) { const c = nodes.get(lk); if (c && c.lvl < l - 1) { c.lvl = l - 1; buckets[l - 1].push(c); } }
    }
    for (const n of nodes.values()) if (this.meta(n.x, n.y, n.z) !== n.lvl) { this.dim.setMeta(n.x, n.y, n.z, n.lvl); this.notifyObservers(n.x, n.y, n.z); changed.push(n); }
  }

  // ------------------------------------------------------------ ticking
  update(dt) {
    this.acc += dt;
    let n = 0;
    while (this.acc >= TICK && n++ < 4) { this.acc -= TICK; this.tick(); }
    if (n >= 4) this.acc = 0;
  }
  tick() {
    this.t++;
    const due = this.queue.filter((e) => e.at <= this.t);
    if (due.length) { this.queue = this.queue.filter((e) => e.at > this.t); for (const e of due) e.fn(); }
    if (!this.dirty.size) return;
    const dirty = [...this.dirty].map(unkey); this.dirty.clear();
    const seen = new Set(), changed = [];
    const around = (list, r, fn) => { for (const [x, y, z] of list) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= r + 1) fn(x + dx, y + dy, z + dz); };
    around(dirty, 2, (x, y, z) => { if (this.id(x, y, z) === WIRE && !seen.has(key(x, y, z))) this.network(x, y, z, seen, changed); });
    const cands = new Set();
    const add = (x, y, z) => { const id = this.id(x, y, z); if (isPiston(id) || id === TNT || id === LAMP || id === LAMP_ON || id === DOOR_L) cands.add(key(x, y, z)); else if (id === DOOR_U) cands.add(key(x, y - 1, z)); };
    around(dirty, 2, add);
    around(changed.map((n) => [n.x, n.y, n.z]), 2, add);
    for (const k of cands) this.evaluate(...unkey(k));
  }

  evaluate(x, y, z) {
    const id = this.id(x, y, z), m = this.meta(x, y, z), k = key(x, y, z);
    if (isPiston(id)) {
      const want = this.powered(x, y, z, m & 7), ext = !!(m & 8);
      if (want !== ext && !this.pending.has(k)) {
        this.pending.add(k);
        this.later(1, () => {
          this.pending.delete(k);
          const id2 = this.id(x, y, z), m2 = this.meta(x, y, z); if (!isPiston(id2)) return;
          const on = this.powered(x, y, z, m2 & 7);
          if (on && !(m2 & 8)) this.extend(x, y, z); else if (!on && (m2 & 8)) this.retract(x, y, z);
        });
      }
    } else if (id === TNT) {
      if (this.powered(x, y, z)) this.g.explosions.prime(x, y, z);
    } else if (id === LAMP) {
      if (this.powered(x, y, z)) this.dim.setBlock(x, y, z, 'redstone_lamp_lit');
    } else if (id === LAMP_ON) {
      if (!this.powered(x, y, z) && !this.pending.has(k)) { this.pending.add(k); this.later(2, () => { this.pending.delete(k); if (this.id(x, y, z) === LAMP_ON && !this.powered(x, y, z)) this.dim.setBlock(x, y, z, 'redstone_lamp'); }); }
    } else if (id === DOOR_L) {
      const on = this.powered(x, y, z) || this.powered(x, y + 1, z);
      if (on !== !!(m & 16)) this.setDoor(x, y, z, (m & ~20) | (on ? 20 : 0));
    }
  }

  // ------------------------------------------------------------ levers & doors
  toggleLever(t) {
    const m = this.meta(t.x, t.y, t.z) ^ 8;
    this.setMeta(t.x, t.y, t.z, m);
    const s = D6[m & 7]; this.mark(t.x + s[0], t.y + s[1], t.z + s[2]);
    sfx.play('click'); sfx.play('place', m & 8 ? 1.6 : 1.2);
  }
  setDoor(x, y, z, m) {
    const was = this.meta(x, y, z);
    this.setMeta(x, y, z, m); if (this.id(x, y + 1, z) === DOOR_U) this.setMeta(x, y + 1, z, m);
    if ((was & 4) !== (m & 4)) sfx.play('door', m & 4 ? 1 : 0.85);
  }
  toggleDoor(t) {
    const y = this.id(t.x, t.y, t.z) === DOOR_U ? t.y - 1 : t.y;
    if (this.id(t.x, y, t.z) !== DOOR_L) return;
    this.setDoor(t.x, y, t.z, this.meta(t.x, y, t.z) ^ 4);
  }

  // ------------------------------------------------------------ placing
  // which way a block faces when placed: toward the player (pistons push at you, observers look at you)
  facingTowardPlayer() {
    const p = this.g.player;
    if (this.g.camMode !== 'top' && Math.abs(p.pitch) > 0.85) return p.pitch < 0 ? 0 : 1;
    const sx = Math.sin(p.yaw), sz = Math.cos(p.yaw);
    return Math.abs(sx) > Math.abs(sz) ? (sx > 0 ? 4 : 5) : (sz > 0 ? 3 : 2);
  }
  place(t, key) {
    const dim = this.dim, x = t.px, y = t.py, z = t.pz;
    if (key === 'redstone_wire') {
      if (!OPAQUE[dim.getId(x, y - 1, z)]) return false;
      dim.setBlock(x, y, z, 'redstone_wire', { meta: 0 });
      return true;
    }
    if (key === 'lever') {
      const s = [t.x - x, t.y - y, t.z - z], dir = D6.findIndex((d) => d[0] === s[0] && d[1] === s[1] && d[2] === s[2]);
      if (dir < 0 || !OPAQUE[dim.getId(t.x, t.y, t.z)]) return false;
      const p = this.g.player, alongX = Math.abs(Math.sin(p.yaw)) > Math.abs(Math.cos(p.yaw));
      dim.setBlock(x, y, z, 'lever', { meta: dir | (dir < 2 && alongX ? 16 : 0) });
      return true;
    }
    if (key === 'piston' || key === 'sticky_piston' || key === 'observer') {
      dim.setBlock(x, y, z, key, { meta: this.facingTowardPlayer() });
      return true;
    }
    return undefined;
  }
  placeDoor(t) {
    const g = this.g, dim = this.dim, p = g.player;
    if (!t) return false;
    const x = t.px, y = t.py, z = t.pz;
    const free = (cy) => { const id = dim.getId(x, cy, z); return id === 0 || LIQUID[id]; };
    if (!free(y) || !free(y + 1) || !OPAQUE[dim.getId(x, y - 1, z)]) return false;
    if (g.interact._playerBlocks(x, y, z) || g.interact._playerBlocks(x, y + 1, z)) return false;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const facing = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 2 : 0);
    // hinge on the right when there's a door to the left (so double doors open apart)
    const [lx, lz] = [HD[facing][1], -HD[facing][0]];
    const hinge = dim.getId(x + lx, y, z + lz) === DOOR_L ? 8 : 0;
    dim.setBlock(x, y, z, 'door_lower', { meta: facing | hinge });
    dim.setBlock(x, y + 1, z, 'door_upper', { meta: facing | hinge });
    sfx.play('place', 0.9);
    if (!g.creative) g.inv.consumeHeld(1);
    g.refreshHotbar();
    return true;
  }

  // ------------------------------------------------------------ pistons
  // Blocks that move when (sx,sy,sz) is pushed one step along d. Returns { move, brk } or null if stuck.
  structure(sx, sy, sz, d, base) {
    const move = new Map(), brk = new Map(), queue = [[sx, sy, sz]];
    const bk = key(...base);
    const movable = (id) => id !== 0 && !LIQUID[id] && !BREAKS.has(id) && !IMMOVABLE.has(id) && BLOCKS[BLOCK_LIST[id]].hardness >= 0;
    while (queue.length) {
      const [x, y, z] = queue.shift(), k = key(x, y, z);
      if (move.has(k)) continue;
      if (k === bk) return null;
      const id = this.id(x, y, z);
      if (isPiston(id) && (this.meta(x, y, z) & 8)) return null;
      move.set(k, [x, y, z, id]);
      if (move.size > PUSH_LIMIT) return null;
      // whatever is in front has to move too (or break)
      const nx = x + d[0], ny = y + d[1], nz = z + d[2], nid = this.id(nx, ny, nz);
      if (ny < 0 || ny >= 128) return null;
      if (nid !== 0 && !LIQUID[nid]) {
        if (BREAKS.has(nid)) brk.set(key(nx, ny, nz), [nx, ny, nz]);
        else if (!movable(nid) && key(nx, ny, nz) !== bk) return null;
        else queue.push([nx, ny, nz]);
      }
      // slime and honey stick to their neighbours (but not to each other)
      if (id === SLIME || id === HONEY) for (let i = 0; i < 6; i++) {
        const e = D6[i]; if (e[0] === d[0] && e[1] === d[1] && e[2] === d[2]) continue;
        const ex = x + e[0], ey = y + e[1], ez = z + e[2], eid = this.id(ex, ey, ez);
        if (key(ex, ey, ez) === bk || !movable(eid)) continue;
        if ((id === SLIME && eid === HONEY) || (id === HONEY && eid === SLIME)) continue;
        queue.push([ex, ey, ez]);
      }
    }
    for (const k of move.keys()) brk.delete(k);
    return { move: [...move.values()], brk: [...brk.values()] };
  }
  shift(st, d) {
    const dim = this.dim;
    for (const [x, y, z] of st.brk) this.pop(x, y, z);
    const metas = st.move.map(([x, y, z]) => this.meta(x, y, z));
    this.busy = true;
    for (const [x, y, z] of st.move) dim.setBlock(x, y, z, 'air');
    st.move.forEach(([x, y, z, id], i) => dim.setBlock(x + d[0], y + d[1], z + d[2], id, metas[i] ? { meta: metas[i] } : {}));
    this.busy = false;
    for (const [x, y, z] of st.move) { this.mark(x, y, z); this.mark(x + d[0], y + d[1], z + d[2]); }
    this.pushEntities(st.move.map(([x, y, z, id]) => [x + d[0], y + d[1], z + d[2], id]), d);
  }
  extend(x, y, z) {
    const m = this.meta(x, y, z), d = D6[m & 7], sticky = this.id(x, y, z) === STICKY;
    const fx = x + d[0], fy = y + d[1], fz = z + d[2], fid = this.id(fx, fy, fz);
    if (fy < 0 || fy >= 128) return;
    if (fid !== 0 && !LIQUID[fid]) {
      if (BREAKS.has(fid)) this.pop(fx, fy, fz);
      else { const st = this.structure(fx, fy, fz, d, [x, y, z]); if (!st) return; this.shift(st, d); }
    }
    this.busy = true;
    this.dim.setMeta(x, y, z, m | 8);
    this.dim.setBlock(fx, fy, fz, 'piston_head', { meta: (m & 7) | (sticky ? 8 : 0) });
    this.busy = false;
    this.mark(x, y, z); this.notifyObservers(x, y, z);
    this.pushEntities([[fx, fy, fz, HEAD]], d);
    sfx.play('piston', 1);
  }
  retract(x, y, z) {
    const m = this.meta(x, y, z), d = D6[m & 7], sticky = this.id(x, y, z) === STICKY;
    const fx = x + d[0], fy = y + d[1], fz = z + d[2];
    this.busy = true;
    if (this.id(fx, fy, fz) === HEAD) this.dim.setBlock(fx, fy, fz, 'air');
    this.dim.setMeta(x, y, z, m & ~8);
    this.busy = false;
    this.mark(x, y, z); this.notifyObservers(x, y, z);
    if (sticky) {
      const gx = fx + d[0], gy = fy + d[1], gz = fz + d[2], gid = this.id(gx, gy, gz);
      if (gid && !LIQUID[gid] && !BREAKS.has(gid) && !IMMOVABLE.has(gid) && BLOCKS[BLOCK_LIST[gid]].hardness >= 0 && !(isPiston(gid) && (this.meta(gx, gy, gz) & 8))) {
        const back = [-d[0], -d[1], -d[2]];
        const st = this.structure(gx, gy, gz, back, [x, y, z]);
        if (st) this.shift(st, back);
      }
    }
    sfx.play('piston', 0.8);
  }
  // shove the player / mobs out of blocks that just moved into them; slime launches them
  pushEntities(cells, d) {
    const g = this.g;
    const hit = (e) => cells.find(([x, y, z]) => e.x + e.w / 2 > x && e.x - e.w / 2 < x + 1 && e.y + e.h > y && e.y < y + 1.01 && e.z + e.w / 2 > z && e.z - e.w / 2 < z + 1);
    for (const e of [g.player, ...g.mobs.list]) {
      const c = hit(e); if (!c) continue;
      if (d[1] > 0) e.y = c[1] + 1; else { e.x += d[0] * 0.8; e.y += d[1] * 0.8; e.z += d[2] * 0.8; }
      if (c[3] === SLIME) { e.vx += d[0] * 14; e.vy = Math.max(e.vy, d[1] > 0 ? 16 : 5); e.vz += d[2] * 14; }
      if (e === g.player) { e.px = e.x; e.py = e.y; e.pz = e.z; e.fall = 0; }
    }
  }
}
