// ============================================================================
// Mineblock — world simulation: falling blocks, torch support, portal upkeep,
// furnace ticking, ice / snow melting near heat sources.
// ============================================================================
import { BLOCKS, BLOCK_LIST } from './blocks.js';
import { SOLID, OPAQUE, LIQUID } from './tables.js';
import { tickFurnace } from './furnace.js';

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export class Simulation {
  constructor(game) {
    this.g = game; this.acc = 0; this.melt = new Map(); this.meltAcc = 0;
  }
  attach(dim) { dim.listeners.push((x, y, z, o, n) => this.onChange(dim, x, y, z, o, n)); }

  // gravity blocks (sand, gravel)
  checkFall(x, y, z) {
    const dim = this.g.dim;
    const key = dim.getBlock(x, y, z);
    if (!BLOCKS[key].gravity) return;
    const below = dim.getId(x, y - 1, z);
    if (y > 0 && !SOLID[below]) {
      dim.setBlock(x, y, z, 'air');
      this.g.falling.spawn(key, x, y, z);
    }
  }

  onChange(dim, x, y, z, oldKey, newKey) {
    if (dim !== this.g.dim) return;
    const nb = BLOCKS[newKey];
    // the block above a removed block may fall
    if (!nb.solid || nb.transparent) this.checkFall(x, y + 1, z);
    if (nb.gravity) this.checkFall(x, y, z);
    // torches lose their support
    if (!OPAQUE[BLOCKS[newKey].id]) {
      for (const [dx, dy, dz] of DIRS) {
        if (dim.getBlock(x + dx, y + dy, z + dz) === 'torch' && !this.torchSupported(dim, x + dx, y + dy, z + dz)) {
          dim.setBlock(x + dx, y + dy, z + dz, 'air');
          if (!this.g.creative) this.g.drops.spawn('torch', 1, x + dx + 0.5, y + dy + 0.4, z + dz + 0.5);
        }
      }
    }
    // portal structure broken
    if ((oldKey === 'obsidian' || oldKey === 'nether_portal') && newKey !== 'obsidian' && newKey !== 'nether_portal') this.g.portals.onFrameBroken(dim, x, y, z);
  }
  torchSupported(dim, x, y, z) {
    return DIRS.some(([dx, dy, dz]) => dy >= 0 ? (dy === 0 && OPAQUE[dim.getId(x + dx, y, z + dz)]) : OPAQUE[dim.getId(x, y - 1, z)]);
  }

  update(dt) {
    const g = this.g, dim = g.dim;
    // furnaces tick every frame (few of them) so the progress arrow is smooth
    for (const [k, te] of dim.tiles) {
      const [x, y, z] = k.split(',').map(Number);
      if (!dim.loaded(x, z)) continue;
      const lit = tickFurnace(te, dt);
      const cur = dim.getBlock(x, y, z);
      if (lit && cur === 'furnace') dim.setBlock(x, y, z, 'furnace_lit', { keepMeta: true, silent: true });
      else if (!lit && cur === 'furnace_lit') dim.setBlock(x, y, z, 'furnace', { keepMeta: true, silent: true });
    }
    // melting near heat (around the player only)
    this.meltAcc += dt;
    if (this.meltAcc >= 0.25) {
      const step = this.meltAcc; this.meltAcc = 0;
      const p = g.player;
      for (let i = 0; i < 160; i++) {
        const x = Math.floor(p.x + (Math.random() - 0.5) * 26), z = Math.floor(p.z + (Math.random() - 0.5) * 26), y = Math.max(1, Math.min(126, Math.floor(p.y + (Math.random() - 0.5) * 18)));
        const k = dim.getBlock(x, y, z);
        if (k !== 'ice' && k !== 'snow') continue;
        let heat = dim.getBlockLight(x, y, z);
        for (const [dx, dy, dz] of DIRS) heat = Math.max(heat, dim.getBlockLight(x + dx, y + dy, z + dz));
        const key = `${x},${y},${z}`;
        if (heat >= 11 && !this.melt.has(key)) this.melt.set(key, 10);
      }
      for (const [key, left] of [...this.melt]) {
        const [x, y, z] = key.split(',').map(Number);
        const k = dim.getBlock(x, y, z);
        if (k !== 'ice' && k !== 'snow') { this.melt.delete(key); continue; }
        if (left - step <= 0) {
          this.melt.delete(key);
          dim.setBlock(x, y, z, k === 'ice' ? 'water' : 'air');
          g.particles.smoke(x + 0.5, y + 0.6, z + 0.5, 3);
        } else this.melt.set(key, left - step);
      }
    }
  }
  clear() { this.melt.clear(); }
}
