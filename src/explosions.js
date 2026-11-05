// ============================================================================
// Mineblock — TNT and explosions
// ----------------------------------------------------------------------------
//   ex.prime(x, y, z, fuse?)      turn a TNT block into lit, falling TNT (4 s fuse)
//   ex.explode(x, y, z, power)    blow a hole (TNT 4, creeper 3), hurt and push nearby things
//   ex.update(dt) / ex.clear()
// TNT is lit by flint and steel, redstone power, or another explosion.
// ============================================================================
import * as THREE from 'three';
import { BLOCKS, BLOCK_LIST, BLOCK_ID } from './blocks.js';
import { blockGeometry } from './blockmesh.js';
import { moveBox } from './physics.js';
import { LIQUID } from './tables.js';
import { sfx } from './sfx.js';

const RESIST = new Set(['bedrock', 'obsidian', 'end_portal_frame', 'end_portal_frame_filled', 'end_portal', 'nether_portal', 'ancient_debris', 'netherite_block'].map((k) => BLOCK_ID[k]));

export class Explosions {
  constructor(game) {
    this.g = game; this.list = [];
    this.group = new THREE.Group(); game.scene.add(this.group);
    this.mat = new THREE.MeshBasicMaterial({ map: game.mats.texture });
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    this.geo = null; this.flashGeo = new THREE.BoxGeometry(1.01, 1.01, 1.01);
  }
  clear() { for (const t of this.list) this.group.remove(t.mesh); this.list.length = 0; }

  prime(x, y, z, fuse = 4) {
    const g = this.g;
    if (g.dim.getId(x, y, z) === BLOCK_ID.tnt) g.dim.setBlock(x, y, z, 'air');
    if (!this.geo) this.geo = blockGeometry(THREE, g.atlas, 'tnt', 0.98);
    const mesh = new THREE.Mesh(this.geo, this.mat), flash = new THREE.Mesh(this.flashGeo, this.flashMat.clone());
    mesh.add(flash); this.group.add(mesh);
    const a = Math.random() * Math.PI * 2;
    this.list.push({ x: x + 0.5, y, z: z + 0.5, vx: Math.cos(a) * 0.6, vy: 3, vz: Math.sin(a) * 0.6, w: 0.98, h: 0.98, fuse, mesh, flash });
    sfx.play('hiss');
    return true;
  }

  update(dt) {
    const dim = this.g.dim;
    for (const t of [...this.list]) {
      t.fuse -= dt;
      t.vy = Math.max(-40, t.vy - 26 * dt); t.vx *= 0.96; t.vz *= 0.96;
      moveBox(dim, t, t.vx * dt, t.vy * dt, t.vz * dt);
      if (t.hitY) t.vy = 0; if (t.onGround) { t.vx *= 0.8; t.vz *= 0.8; }
      t.mesh.position.set(t.x, t.y + 0.49, t.z);
      const blink = Math.floor(t.fuse * 4) % 2 === 0;
      t.flash.material.opacity = blink ? 0.55 : 0;
      t.mesh.scale.setScalar(t.fuse < 0.3 ? 1 + (0.3 - t.fuse) * 0.6 : 1);
      if (Math.random() < dt * 10) this.g.particles.smoke(t.x, t.y + 1.05, t.z, 1);
      if (t.fuse <= 0) {
        this.group.remove(t.mesh); t.flash.material.dispose(); this.list.splice(this.list.indexOf(t), 1);
        this.explode(t.x, t.y + 0.5, t.z, 4);
      }
    }
  }

  explode(cx, cy, cz, power) {
    const g = this.g, dim = g.dim;
    const r = power * 0.9, R = Math.ceil(r + 1);
    const inWater = LIQUID[dim.getId(Math.floor(cx), Math.floor(cy), Math.floor(cz))];
    const gone = [];
    if (!inWater) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy, dz);
      if (d > r * (0.7 + Math.random() * 0.45)) continue;
      const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy, z = Math.floor(cz) + dz;
      const id = dim.getId(x, y, z);
      if (!id || LIQUID[id] || RESIST.has(id) || BLOCKS[BLOCK_LIST[id]].hardness < 0) continue;
      gone.push([x, y, z, id]);
    }
    let drops = 0;
    for (const [x, y, z, id] of gone) {
      if (dim.getId(x, y, z) !== id) continue;           // already removed (bed / door halves)
      const key = BLOCK_LIST[id], b = BLOCKS[key];
      if (key === 'tnt') { this.prime(x, y, z, 0.5 + Math.random()); continue; }
      const tk = `${x},${y},${z}`;
      if (dim.tiles.has(tk)) { const te = dim.tiles.get(tk); for (const s of [te.input, te.fuel, te.output]) if (s) g.drops.spawn(s.item, s.count, x + 0.5, y + 0.5, z + 0.5); dim.tiles.delete(tk); }
      const meta = dim.getMeta(x, y, z);
      if (!g.creative && b.drops !== null && drops < 40 && Math.random() < 0.3) { g.drops.spawn(b.drops === undefined ? key : b.drops, 1, x + 0.5, y + 0.5, z + 0.5, (Math.random() - 0.5) * 4, 4, (Math.random() - 0.5) * 4); drops++; }
      dim.setBlock(x, y, z, 'air');
      if (key === 'bed_foot' || key === 'bed_head') g.beds.onBroken(x, y, z, id, meta);
    }
    // smoke and noise
    for (let i = 0; i < 40; i++) g.particles.smoke(cx + (Math.random() - 0.5) * r * 1.4, cy + (Math.random() - 0.5) * r, cz + (Math.random() - 0.5) * r * 1.4, 1);
    for (let i = 0; i < 6 && i < gone.length; i++) { const c = gone[(Math.random() * gone.length) | 0]; g.particles.breakBurst(c[0], c[1], c[2], BLOCK_LIST[c[3]]); }
    sfx.play('boom'); sfx.play('explode');
    const p = g.player, pd = Math.hypot(p.x - cx, p.y + 0.9 - cy, p.z - cz);
    g.shake = Math.max(g.shake, Math.max(0, 1.6 - pd / 12));
    g.xr?.buzz?.(1, 250);
    // hurt and push the player and mobs
    const hurt = (e, isPlayer) => {
      const ex = e.x - cx, ey = e.y + e.h / 2 - cy, ez = e.z - cz, d = Math.hypot(ex, ey, ez) || 0.01;
      if (d > r * 2) return;
      const f = 1 - d / (r * 2), dmg = Math.round(f * power * 4.5);
      e.vx += ex / d * f * 14; e.vy = Math.max(e.vy, ey / d * f * 10 + f * 6); e.vz += ez / d * f * 14;
      if (isPlayer) { if (!g.creative) p.damage(dmg, 'explosion'); }
      else g.mobs.hurt(e, dmg);
    };
    if (!p.dead) hurt(p, true);
    for (const m of [...g.mobs.list]) if (!m.dying) hurt(m, false);
  }
}
