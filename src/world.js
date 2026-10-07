// ============================================================================
// Mineblock — world storage: chunks, dimensions, block access, edits
// ----------------------------------------------------------------------------
//   Chunk      16x128x16 block ids + sky/block light nibbles + meta
//   Dimension  chunk map for one dimension ('overworld' | 'nether')
//   World      both dimensions + seed
// getBlock() returns a block KEY string (plugs into the old mesher API);
// getId() returns the numeric id (hot loops). Unloaded chunks read as stone so
// physics and meshing never see a hole.
// ============================================================================
import { BLOCKS, BLOCK_LIST, BLOCK_ID } from './blocks.js';
import { Generator, CH, HT } from './worldgen.js';
import { lightChunk, relightAfterChange } from './light.js';
import { SOLID, OPAQUE, LIQUID, EMIT } from './tables.js';

export { CH, HT };
export const ckey = (cx, cz) => cx * 65536 + cz;
export const idx = (lx, y, lz) => lx + 16 * lz + 256 * y;

export { SOLID, OPAQUE, LIQUID, EMIT };
export const ID = BLOCK_ID;

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = new Uint8Array(CH * HT * CH);
    this.sky = new Uint8Array(CH * HT * CH);
    this.blight = new Uint8Array(CH * HT * CH);
    this.meta = new Map();       // local index -> small int (furnace facing, portal axis)
    this.maxY = HT - 1;
    this.meshes = [];            // THREE objects owned by the renderer
    this.generated = false;
    this.lit = false;
    this.dirty = false;
    this.store = null;           // persistent edits {edits: Map, meta: Map}
  }
}

export class Dimension {
  constructor(name, gen) {
    this.name = name; this.gen = gen;
    this.chunks = new Map();
    this.stores = new Map();     // ckey -> { edits: Map(idx->id), meta: Map(idx->val) }  survives unloads
    this.dirty = new Set();      // chunks needing remesh
    this.tiles = new Map();      // "x,y,z" -> tile entity (furnace)
    this.portals = [];           // [{x,y,z,axis}] registered portal interiors (bottom-left block)
    this.sky = name === 'overworld';
    this.listeners = [];         // (x,y,z,oldKey,newKey) => void
    this._last = null;
  }
  chunk(cx, cz) { return this.chunks.get(ckey(cx, cz)); }
  chunkAt(x, z) { return this.chunks.get(ckey(x >> 4, z >> 4)); }
  storeFor(cx, cz) {
    const k = ckey(cx, cz); let s = this.stores.get(k);
    if (!s) { s = { cx, cz, edits: new Map(), meta: new Map() }; this.stores.set(k, s); }
    return s;
  }

  // ---- generation
  ensureChunk(cx, cz) {
    let c = this.chunk(cx, cz);
    if (c) return c;
    c = new Chunk(cx, cz);
    this.gen.generateChunk(c, this.name);
    const st = this.stores.get(ckey(cx, cz));
    if (st) {
      c.store = st;
      for (const [i, id] of st.edits) c.blocks[i] = id;
      for (const [i, v] of st.meta) c.meta.set(i, v);
    }
    c.generated = true;
    this.chunks.set(ckey(cx, cz), c);
    lightChunk(this, c);
    c.dirty = true; this.dirty.add(c);
    return c;
  }
  unloadChunk(cx, cz) { this.chunks.delete(ckey(cx, cz)); this.dirty.delete(this.chunk(cx, cz)); }

  // ---- reads
  getId(x, y, z) {
    if (y < 0) return ID.bedrock;
    if (y >= HT) return 0;
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    if (!c) return ID.stone;
    return c.blocks[(x & 15) + 16 * (z & 15) + 256 * y];
  }
  getBlock(x, y, z) { return BLOCK_LIST[this.getId(x, y, z)]; }
  isSolid(x, y, z) { return SOLID[this.getId(x, y, z)] === 1; }
  loaded(x, z) { return this.chunks.has(ckey(x >> 4, z >> 4)); }
  getSky(x, y, z) { if (y >= HT) return 15; if (y < 0) return 0; const c = this.chunkAt(x, z); return c ? c.sky[(x & 15) + 16 * (z & 15) + 256 * y] : 0; }
  getBlockLight(x, y, z) { if (y < 0 || y >= HT) return 0; const c = this.chunkAt(x, z); return c ? c.blight[(x & 15) + 16 * (z & 15) + 256 * y] : 0; }
  getMeta(x, y, z) { const c = this.chunkAt(x, z); return c ? (c.meta.get((x & 15) + 16 * (z & 15) + 256 * y) ?? 0) : 0; }
  // y of the highest solid block in the column, or -1
  highest(x, z) { for (let y = HT - 1; y >= 0; y--) if (SOLID[this.getId(x, y, z)] || LIQUID[this.getId(x, y, z)]) return y; return -1; }

  // ---- writes
  markDirty(c) { if (c) { c.dirty = true; this.dirty.add(c); } }
  markDirtyAround(x, z) {
    const lx = x & 15, lz = z & 15, cx = x >> 4, cz = z >> 4;
    this.markDirty(this.chunk(cx, cz));
    if (lx === 0) this.markDirty(this.chunk(cx - 1, cz)); if (lx === 15) this.markDirty(this.chunk(cx + 1, cz));
    if (lz === 0) this.markDirty(this.chunk(cx, cz - 1)); if (lz === 15) this.markDirty(this.chunk(cx, cz + 1));
  }
  setBlock(x, y, z, key, opts = {}) {
    if (y < 0 || y >= HT) return false;
    const c = this.chunkAt(x, z); if (!c) return false;
    const id = typeof key === 'number' ? key : BLOCK_ID[key];
    const i = (x & 15) + 16 * (z & 15) + 256 * y;
    const old = c.blocks[i];
    if (old === id) return false;
    c.blocks[i] = id;
    if (opts.record !== false) {
      if (!c.store) c.store = this.storeFor(c.cx, c.cz);
      c.store.edits.set(i, id);
    }
    if (c.meta.has(i) && opts.keepMeta !== true) { c.meta.delete(i); c.store?.meta.delete(i); }
    if (opts.meta !== undefined) this.setMeta(x, y, z, opts.meta);
    if (y > c.maxY - 2) c.maxY = Math.min(HT - 1, y + 2);
    this.markDirtyAround(x, z);
    relightAfterChange(this, x, y, z, old, id);
    if (opts.silent !== true) for (const f of this.listeners) f(x, y, z, BLOCK_LIST[old], BLOCK_LIST[id]);
    return true;
  }
  setMeta(x, y, z, v) {
    const c = this.chunkAt(x, z); if (!c) return;
    const i = (x & 15) + 16 * (z & 15) + 256 * y;
    c.meta.set(i, v);
    if (!c.store) c.store = this.storeFor(c.cx, c.cz);
    c.store.meta.set(i, v);
    this.markDirtyAround(x, z);
  }
  // light helpers used by light.js (return false if chunk missing)
  setSky(x, y, z, v) { const c = this.chunkAt(x, z); if (!c) return; c.sky[(x & 15) + 16 * (z & 15) + 256 * y] = v; this.lightTouched(c, x, z); }
  setBlockLight(x, y, z, v) { const c = this.chunkAt(x, z); if (!c) return; c.blight[(x & 15) + 16 * (z & 15) + 256 * y] = v; this.lightTouched(c, x, z); }
  lightTouched(c, x, z) {
    if (!c.lit) return;
    this.markDirty(c);
    const lx = x & 15, lz = z & 15;
    if (lx === 0) this.markDirty(this.chunk(c.cx - 1, c.cz)); if (lx === 15) this.markDirty(this.chunk(c.cx + 1, c.cz));
    if (lz === 0) this.markDirty(this.chunk(c.cx, c.cz - 1)); if (lz === 15) this.markDirty(this.chunk(c.cx, c.cz + 1));
  }
}

export class World {
  constructor(seed) {
    this.seed = seed | 0;
    this.gen = new Generator(this.seed);
    this.dims = { overworld: new Dimension('overworld', this.gen), nether: new Dimension('nether', this.gen) };
  }
}
