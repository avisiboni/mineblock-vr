// ============================================================================
// Mineblock — lightweight world entities: particles, dropped items, falling blocks
// ============================================================================
import * as THREE from 'three';
import { BLOCKS, BLOCK_LIST, BLOCK_ID, ITEMS, faceTile, isBlockItem } from './blocks.js';
import { blockGeometry } from './blockmesh.js';
import { paintTile } from './textures.js';
import { moveBox } from './physics.js';
import { SOLID, LIQUID } from './tables.js';

// ------------------------------------------------------------- particles
// One dynamic quad buffer, billboarded on the CPU. Sub-rectangles of atlas tiles
// give every particle the colour of the block it came from.
export class Particles {
  constructor(scene, atlas, texture, max = 700) {
    this.atlas = atlas; this.max = max; this.list = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 12); this.uv = new Float32Array(max * 8); this.col = new Float32Array(max * 12);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) { const v = i * 4; idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6); }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }
  add(x, y, z, vx, vy, vz, life, size, tile, sx, sy, cells = 4, gravity = 14, light = 1) {
    if (this.list.length >= this.max) this.list.shift();
    const t = this.atlas.uv(tile); const du = (t.u1 - t.u0) / 16, dv = (t.v1 - t.v0) / 16;
    this.list.push({ x, y, z, vx, vy, vz, life, max: life, size, g: gravity, light,
      u0: t.u0 + du * sx, u1: t.u0 + du * (sx + cells), v0: t.v0 + dv * (15 - sy - cells + 1), v1: t.v0 + dv * (16 - sy) });
  }
  breakBurst(x, y, z, blockKey) {
    const b = BLOCKS[blockKey]; if (!b || !b.faces) return;
    const tile = faceTile(b, 'east');
    for (let i = 0; i < 12; i++) {
      this.add(x + 0.5 + (Math.random() - 0.5) * 0.8, y + 0.5 + (Math.random() - 0.5) * 0.8, z + 0.5 + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 3, Math.random() * 3 + 0.5, (Math.random() - 0.5) * 3, 0.6 + Math.random() * 0.5, 0.09 + Math.random() * 0.06, tile,
        (Math.random() * 12) | 0, (Math.random() * 12) | 0, 4);
    }
  }
  smoke(x, y, z, n = 5) { for (let i = 0; i < n; i++) this.add(x, y, z, (Math.random() - 0.5) * 1.2, 1 + Math.random(), (Math.random() - 0.5) * 1.2, 0.8, 0.12, 'gravel', 4, 4, 2, -1, 0.8); }
  flame(x, y, z) { this.add(x + (Math.random() - 0.5) * 0.08, y, z + (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.3, 0.6, (Math.random() - 0.5) * 0.3, 0.5, 0.05, 'torch', 7, 2, 2, -0.5, 1); }
  portal(x, y, z, tx, ty, tz) { this.add(x, y, z, (tx - x) * 1.2, (ty - y) * 1.2, (tz - z) * 1.2, 0.9, 0.06, 'nether_portal', (Math.random() * 14) | 0, (Math.random() * 14) | 0, 2, 0, 1); }
  update(dt, camera) {
    const right = new THREE.Vector3(), up = new THREE.Vector3();
    camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt; if (p.life <= 0) { this.list.splice(i, 1); continue; }
      p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    for (const p of this.list) {
      const s = p.size * (p.life / p.max > 0.2 ? 1 : (p.life / p.max) * 5);
      const rx = right.x * s, ry = right.y * s, rz = right.z * s, ux = up.x * s, uy = up.y * s, uz = up.z * s;
      const o = n * 12;
      this.pos[o] = p.x - rx - ux; this.pos[o + 1] = p.y - ry - uy; this.pos[o + 2] = p.z - rz - uz;
      this.pos[o + 3] = p.x + rx - ux; this.pos[o + 4] = p.y + ry - uy; this.pos[o + 5] = p.z + rz - uz;
      this.pos[o + 6] = p.x + rx + ux; this.pos[o + 7] = p.y + ry + uy; this.pos[o + 8] = p.z + rz + uz;
      this.pos[o + 9] = p.x - rx + ux; this.pos[o + 10] = p.y - ry + uy; this.pos[o + 11] = p.z - rz + uz;
      const u = n * 8;
      this.uv[u] = p.u0; this.uv[u + 1] = p.v0; this.uv[u + 2] = p.u1; this.uv[u + 3] = p.v0; this.uv[u + 4] = p.u1; this.uv[u + 5] = p.v1; this.uv[u + 6] = p.u0; this.uv[u + 7] = p.v1;
      for (let k = 0; k < 12; k++) this.col[o + k] = p.light;
      n++;
    }
    const g = this.mesh.geometry;
    g.setDrawRange(0, n * 6);
    g.attributes.position.needsUpdate = g.attributes.uv.needsUpdate = g.attributes.color.needsUpdate = true;
  }
  clear() { this.list.length = 0; }
}

// ---------------------------------------------------------- dropped items
const iconTextures = new Map();
function itemTexture(key) {
  if (!iconTextures.has(key)) {
    const t = new THREE.CanvasTexture(paintTile(ITEMS[key].tile));
    t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; iconTextures.set(key, t);
  }
  return iconTextures.get(key);
}
const planeGeo = new THREE.PlaneGeometry(0.42, 0.42);

export class DroppedItems {
  constructor(scene, atlas, mats) {
    this.scene = scene; this.atlas = atlas; this.mats = mats; this.list = [];
    this.group = new THREE.Group(); scene.add(this.group);
    this.blockMat = new THREE.MeshBasicMaterial({ map: mats.texture, alphaTest: 0.5 });
  }
  spawn(item, count, x, y, z, vx = 0, vy = 3, vz = 0, extra = {}) {
    if (count <= 0) return;
    let mesh;
    if (isBlockItem(item)) mesh = new THREE.Mesh(blockGeometry(THREE, this.atlas, item, 0.28), this.blockMat);
    else { mesh = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: itemTexture(item), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide })); }
    if (BLOCKS[item]?.model === 'cross') { mesh.geometry.dispose?.(); mesh = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: itemTexture2(this.atlas, item), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide })); }
    this.group.add(mesh);
    if (this.list.length > 250) this.remove(this.list[0]);
    this.list.push({ item, count, ...extra, x, y, z, vx, vy, vz, w: 0.25, h: 0.25, age: 0, mesh, phase: Math.random() * 6.28 });
  }
  remove(e) { this.group.remove(e.mesh); this.list.splice(this.list.indexOf(e), 1); }
  clear() { for (const e of [...this.list]) this.remove(e); }
  update(dt, dim, player, inv, onPickup, skyFactor = 1) {
    for (const e of [...this.list]) {
      e.age += dt;
      if (e.age > 300) { this.remove(e); continue; }
      const dx = player.x - e.x, dy = player.y + 0.9 - e.y, dz = player.z - e.z, d = Math.hypot(dx, dy, dz);
      if (!player.dead && e.age > 0.6 && d < 1.6) { const k = Math.max(0, 1 - d / 1.6) * 14 + 2; e.vx += dx / d * k * dt * 4; e.vy += dy / d * k * dt * 4; e.vz += dz / d * k * dt * 4; }
      e.vy -= 20 * dt; e.vx *= 0.98; e.vz *= 0.98;
      moveBox(dim, e, e.vx * dt, e.vy * dt, e.vz * dt);
      if (e.onGround) { e.vx *= 0.7; e.vz *= 0.7; }
      if (e.hitX) e.vx = 0; if (e.hitZ) e.vz = 0; if (e.hitY) e.vy = 0;
      if (LIQUID[dim.getId(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z))]) { e.vy = 1.2; e.vx *= 0.9; e.vz *= 0.9; }
      if (!player.dead && e.age > 0.6 && d < 0.9) {
        const left = inv.add(e.item, e.count);
        if (left < e.count) onPickup?.(e.item, e.count - left);
        if (left <= 0) { this.remove(e); continue; } e.count = left;
      }
      const b = 0.55 + 0.45 * Math.max(dim.getSky(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) / 15 * skyFactor, dim.getBlockLight(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) / 15);
      e.mesh.material.color?.setScalar(b);
      e.mesh.position.set(e.x, e.y + 0.18 + Math.sin(e.age * 2.5 + e.phase) * 0.05, e.z);
      e.mesh.rotation.y = e.age * 1.6 + e.phase;
    }
  }
}
function itemTexture2(atlas, blockKey) { // cross-model blocks (torch) drop as their tile
  const k = 'b:' + blockKey;
  if (!iconTextures.has(k)) { const t = new THREE.CanvasTexture(paintTile(faceTile(BLOCKS[blockKey], 'top'))); t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; iconTextures.set(k, t); }
  return iconTextures.get(k);
}

// ---------------------------------------------------------- falling blocks
export class FallingBlocks {
  constructor(scene, atlas, mats) {
    this.atlas = atlas; this.list = []; this.group = new THREE.Group(); scene.add(this.group);
    this.mat = new THREE.MeshBasicMaterial({ map: mats.texture });
  }
  spawn(key, x, y, z) {
    const mesh = new THREE.Mesh(blockGeometry(THREE, this.atlas, key, 0.98), this.mat);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5); this.group.add(mesh);
    this.list.push({ key, x: x + 0.5, y, z: z + 0.5, vy: 0, mesh, w: 0.98, h: 0.98 });
  }
  clear() { for (const f of this.list) this.group.remove(f.mesh); this.list.length = 0; }
  update(dt, dim, drops) {
    for (const f of [...this.list]) {
      f.vy = Math.max(-40, f.vy - 26 * dt);
      const ny = f.y + f.vy * dt;
      const bx = Math.floor(f.x), bz = Math.floor(f.z);
      const belowY = Math.floor(ny - 0.0001);
      if (SOLID[dim.getId(bx, belowY, bz)] || belowY < 0) {
        // land on top of the solid block
        const ly = belowY + 1;
        this.list.splice(this.list.indexOf(f), 1); this.group.remove(f.mesh);
        const here = dim.getId(bx, ly, bz);
        if (here === 0 || LIQUID[here]) dim.setBlock(bx, ly, bz, f.key);
        else drops?.(f.key, bx, ly, bz);
        continue;
      }
      f.y = ny; f.mesh.position.set(f.x, f.y + 0.49, f.z);
    }
  }
}
