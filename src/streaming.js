// ============================================================================
// Mineblock — chunk streaming: generate / mesh / unload around the player
// ----------------------------------------------------------------------------
//   const cm = new ChunkManager(scene, atlas, mats)
//   cm.setDimension(dim)                        switch world (old meshes are disposed)
//   cm.update(px, pz, renderDist, budgetMs)     call once per frame
//   cm.ready(px, pz, radius)                    are chunks around (px,pz) meshed?
// Chunks within R+1 are generated, chunks within R are meshed once their four
// neighbours exist, chunks beyond R+3 are unloaded (edits survive in dim.stores).
// ============================================================================
import * as THREE from 'three';
import { meshChunk, disposeMeshes } from './chunkmesh.js';

export class ChunkManager {
  constructor(scene, atlas, mats) {
    this.scene = scene; this.atlas = atlas; this.mats = mats;
    this.group = new THREE.Group(); scene.add(this.group);
    this.dim = null; this.order = []; this.lastCx = NaN; this.lastCz = NaN; this.lastR = 0;
    this.stats = { chunks: 0, meshed: 0, dirty: 0 };
  }
  setDimension(dim) {
    this.clear();
    this.dim = dim; this.lastCx = NaN;
  }
  clear() {
    if (!this.dim) return;
    for (const c of this.dim.chunks.values()) disposeMeshes(c.meshes, this.group);
    this.dim.chunks.clear(); this.dim.dirty.clear();
  }
  _rebuildOrder(cx, cz, R) {
    const list = [];
    const G = R + 1;
    for (let dz = -G; dz <= G; dz++) for (let dx = -G; dx <= G; dx++) {
      const d2 = dx * dx + dz * dz; if (d2 <= G * G + 1) list.push([dx, dz, d2]);
    }
    list.sort((a, b) => a[2] - b[2]);
    this.order = list;
  }
  ready(px, pz, radius = 1) {
    const cx = Math.floor(px) >> 4, cz = Math.floor(pz) >> 4;
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const c = this.dim.chunk(cx + dx, cz + dz);
      if (!c || c.dirty || !c.meshes.length && c.firstMesh === undefined) return false;
    }
    return true;
  }
  update(px, pz, R, budgetMs = 7) {
    const dim = this.dim; if (!dim) return;
    const t0 = performance.now();
    const cx = Math.floor(px) >> 4, cz = Math.floor(pz) >> 4;
    if (cx !== this.lastCx || cz !== this.lastCz || R !== this.lastR) { this._rebuildOrder(cx, cz, R); this.lastCx = cx; this.lastCz = cz; this.lastR = R; }
    // 1. remesh dirty chunks (edits first, nearest first)
    let meshedThisFrame = 0;
    const cand = [];
    for (const c of dim.dirty) cand.push(c);
    cand.sort((a, b) => ((a.cx - cx) ** 2 + (a.cz - cz) ** 2) - ((b.cx - cx) ** 2 + (b.cz - cz) ** 2));
    for (const c of cand) {
      const d2 = (c.cx - cx) ** 2 + (c.cz - cz) ** 2;
      if (d2 > R * R + 1) continue;
      if (!dim.chunk(c.cx + 1, c.cz) || !dim.chunk(c.cx - 1, c.cz) || !dim.chunk(c.cx, c.cz + 1) || !dim.chunk(c.cx, c.cz - 1)) continue;
      const edit = c.meshes.length > 0;
      if (!edit && meshedThisFrame >= 2 && performance.now() - t0 > budgetMs) continue;
      disposeMeshes(c.meshes, this.group);
      c.meshes = meshChunk(dim, c, this.atlas, this.mats);
      for (const m of c.meshes) this.group.add(m);
      c.firstMesh = true; c.dirty = false; dim.dirty.delete(c);
      meshedThisFrame++;
      if (performance.now() - t0 > budgetMs * 1.6) break;
    }
    // 2. generate missing chunks in a spiral, within budget
    for (const [dx, dz] of this.order) {
      if (performance.now() - t0 > budgetMs) break;
      if (!dim.chunk(cx + dx, cz + dz)) dim.ensureChunk(cx + dx, cz + dz);
    }
    // 3. unload far chunks (cheap scan, once every 30 frames)
    this._f = (this._f || 0) + 1;
    if (this._f % 30 === 0) {
      for (const c of [...dim.chunks.values()]) {
        if ((c.cx - cx) ** 2 + (c.cz - cz) ** 2 > (R + 3) ** 2) { disposeMeshes(c.meshes, this.group); dim.dirty.delete(c); dim.chunks.delete(c.cx * 65536 + c.cz); }
      }
    }
    this.stats.chunks = dim.chunks.size; this.stats.dirty = dim.dirty.size;
  }
}
