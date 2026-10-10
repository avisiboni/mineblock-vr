// ============================================================================
// Mineblock — block targeting, breaking, placing, item use
// ----------------------------------------------------------------------------
// One instance per game. Call update(dt) once per rendered frame after the
// player's view has been positioned. Reads input, raycasts (from the crosshair
// in first person, from the mouse cursor in top-down), shows the selection
// outline + crack overlay, and mutates the world.
// ============================================================================
import * as THREE from 'three';
import { BLOCKS, BLOCK_LIST, BLOCK_ID, ITEMS, TIER, faceTile, isBlockItem, itemDef } from './blocks.js';
import { raycast, collides } from './physics.js';
import { SOLID, LIQUID, OPAQUE } from './tables.js';
import { sfx } from './sfx.js';

const NETHER_PORTAL = BLOCK_ID.nether_portal, END_PORTAL = BLOCK_ID.end_portal;
const FACE_DIRS = { top: [0, 1, 0], bottom: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] };

export class Interaction {
  constructor(game) {
    this.g = game;
    this.target = null; this.mobTarget = null;
    this.progress = 0; this.breakKey = ''; this.mining = false; this.swing = 0; this.placeCd = 0; this.attackCd = 0; this.breakCd = 0;
    this.eatTimer = 0;
    // selection outline
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }));
    this.outline.visible = false; this.outline.renderOrder = 6; game.scene.add(this.outline);
    // crack overlay: 10 pre-built boxes whose UVs point at destroy_stage_N
    this.crackGeos = [];
    for (let i = 0; i < 10; i++) {
      const g = new THREE.BoxGeometry(1.006, 1.006, 1.006); const t = game.atlas.uv(`destroy_stage_${i}`); const a = g.attributes.uv;
      for (let f = 0; f < 6; f++) { const j = f * 4; a.setXY(j, t.u0, t.v1); a.setXY(j + 1, t.u1, t.v1); a.setXY(j + 2, t.u0, t.v0); a.setXY(j + 3, t.u1, t.v0); }
      this.crackGeos.push(g);
    }
    this.crack = new THREE.Mesh(this.crackGeos[0], new THREE.MeshBasicMaterial({ map: game.mats.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.crack.visible = false; this.crack.renderOrder = 5; game.scene.add(this.crack);
  }

  // ---- ray building
  _ray() {
    const g = this.g, cam = g.camera;
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    if (g.camMode === 'top') {
      const nx = (g.input.mouse.x / innerWidth) * 2 - 1, ny = -(g.input.mouse.y / innerHeight) * 2 + 1;
      const rc = new THREE.Raycaster(); rc.setFromCamera({ x: nx, y: ny }, cam);
      o.copy(rc.ray.origin); d.copy(rc.ray.direction);
      // skip the part of the ray that is above the cut-away plane
      const clipY = g.clipY;
      if (o.y > clipY && d.y < 0) o.addScaledVector(d, (clipY - o.y) / d.y);
      return { o, d, max: 60 };
    }
    if (!(g.xr?.active && g.xr.aim(o, d))) { cam.getWorldPosition(o); cam.getWorldDirection(d); }
    return { o, d, max: g.creative ? 6 : 5 };
  }

  pick() {
    const g = this.g, p = g.player, dim = g.dim;
    const { o, d, max } = this._ray();
    const hit = raycast(dim, o.x, o.y, o.z, d.x, d.y, d.z, max, (id) => !LIQUID[id] && id !== NETHER_PORTAL && id !== END_PORTAL);
    let mob = g.mobs?.raycast(o, d, g.camMode === 'top' ? 60 : (g.creative ? 6 : 4.2));
    // reach limit from the player's body (matters in top-down where the ray is long)
    let block = hit;
    if (block) {
      const dx = block.x + 0.5 - p.x, dy = block.y + 0.5 - (p.y + 1.0), dz = block.z + 0.5 - p.z;
      if (Math.hypot(dx, dy, dz) > (g.creative ? 7.5 : 6.2)) block = null;
    }
    if (mob) { const dx = mob.mob.x - p.x, dz = mob.mob.z - p.z; if (Math.hypot(dx, dz) > 3.6 + (g.camMode === 'top' ? 0.8 : 0)) mob = null; }
    if (block && mob && mob.t > block.t) mob = null;
    this.target = mob ? null : block; this.mobTarget = mob;
  }

  breakTime(block, held) {
    if (block.hardness < 0) return Infinity;
    const def = held ? itemDef(held.item) : null;
    const matches = def?.tool && def.tool === block.tool;
    const canHarvest = block.tier === 0 || (matches && def.tier >= block.tier);
    let mult = matches ? def.speed || 1 : 1;
    let t = block.hardness * 1.5 / mult;
    if (!canHarvest) t = block.hardness * 1.5 * (block.tier ? 3.3 : 1);
    return Math.max(0.05, t);
  }
  canHarvest(block, held) {
    if (block.tier === 0) return true;
    const def = held ? itemDef(held.item) : null;
    return !!(def?.tool === block.tool && def.tier >= block.tier);
  }
  drops(block, held) {
    if (block.drops === null) return [];
    if (!this.canHarvest(block, held)) return [];
    const item = block.drops === undefined ? block.key : block.drops;
    let n = 1; if (block.dropCount) n = block.dropCount[0] + ((Math.random() * (block.dropCount[1] - block.dropCount[0] + 1)) | 0);
    return [{ item, count: n }];
  }

  breakBlock(t) {
    const g = this.g, dim = g.dim, key = BLOCK_LIST[t.id], block = BLOCKS[key];
    const held = g.inv.held;
    if (!g.creative) {
      for (const d of this.drops(block, held)) g.drops.spawn(d.item, d.count, t.x + 0.5, t.y + 0.4, t.z + 0.5, (Math.random() - 0.5) * 2, 2.5, (Math.random() - 0.5) * 2);
      const def = held ? itemDef(held.item) : null;
      if (def?.tool && def.durability) { if (g.inv.damageHeld(1)) sfx.play('hurt'); g.refreshHotbar(); }
    }
    // furnace contents pop out
    const tk = `${t.x},${t.y},${t.z}`;
    if (dim.tiles.has(tk)) { const te = dim.tiles.get(tk); for (const s of [te.input, te.fuel, te.output]) if (s) g.drops.spawn(s.item, s.count, t.x + 0.5, t.y + 0.5, t.z + 0.5); dim.tiles.delete(tk); }
    if (!g.creative && key.endsWith('_ore')) g.addXP(0.12);
    g.particles.breakBurst(t.x, t.y, t.z, key);
    const meta = dim.getMeta(t.x, t.y, t.z);
    dim.setBlock(t.x, t.y, t.z, 'air');
    if (key === 'end_portal_frame' || key === 'end_portal_frame_filled') g.end.onFrameBroken(dim, t.x, t.y, t.z);
    else if (key === 'bed_foot' || key === 'bed_head') g.beds.onBroken(t.x, t.y, t.z, t.id, meta);
    sfx.play('dig', 0.8 + Math.random() * 0.3);
    this.swing = 1;
  }

  // ---- placement
  _playerBlocks(x, y, z) {
    const g = this.g, p = g.player;
    const ov = (e) => e.x - e.w / 2 < x + 1 && e.x + e.w / 2 > x && e.y < y + 1 && e.y + e.h > y && e.z - e.w / 2 < z + 1 && e.z + e.w / 2 > z;
    if (ov(p)) return true;
    return g.mobs?.list.some((m) => !m.dying && ov(m)) ?? false;
  }
  place(t, stack) {
    const g = this.g, dim = g.dim;
    const key = stack.item, block = BLOCKS[key];
    const x = t.px, y = t.py, z = t.pz;
    if (y < 0 || y >= 128) return false;
    const here = dim.getId(x, y, z);
    if (here !== 0 && !LIQUID[here]) return false;
    if (block.solid && this._playerBlocks(x, y, z)) return false;
    if (key === 'torch') {
      const s = (dx, dy, dz) => OPAQUE[dim.getId(x + dx, y + dy, z + dz)];
      if (!(s(0, -1, 0) || s(1, 0, 0) || s(-1, 0, 0) || s(0, 0, 1) || s(0, 0, -1))) return false;
    }
    if (key === 'water' && dim.name === 'nether') { g.particles.smoke(x + 0.5, y + 0.5, z + 0.5, 8); sfx.play('fire'); return true; }
    let meta;
    if (block.interact) { const dx = Math.sin(g.player.yaw), dz = Math.cos(g.player.yaw); meta = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0); }
    dim.setBlock(x, y, z, key, { meta });
    if (block.gravity) g.sim.checkFall(x, y, z);
    sfx.play('place', 0.9 + Math.random() * 0.2);
    return true;
  }

  use(t, stack) {
    const g = this.g, def = ITEMS[stack.item];
    if (!def) return false;
    if (def.use === 'eye') return g.end.useEye(t, stack);
    if (def.use === 'bed') return g.beds.place(t);
    if (def.use === 'ignite') {
      if (!t) return false;
      const ok = g.portals.tryIgnite(t);
      if (ok) { stack.durability = (stack.durability ?? def.durability) - 1; if (stack.durability <= 0) g.inv.hotbar[g.inv.selected] = null; g.refreshHotbar(); sfx.play('fire'); }
      return ok;
    }
    if (def.food && g.player.hunger < 20) {
      this.eatTimer = 0.35;
      g.player.hunger = Math.min(20, g.player.hunger + def.food);
      g.inv.consumeHeld(1); g.refreshHotbar(); sfx.play('eat'); return true;
    }
    return false;
  }

  // ---- per-frame
  update(dt) {
    const g = this.g, input = g.input, inv = g.inv;
    this.placeCd = Math.max(0, this.placeCd - dt); this.attackCd = Math.max(0, this.attackCd - dt); this.breakCd = Math.max(0, this.breakCd - dt);
    this.swing = Math.max(0, this.swing - dt * 6); this.eatTimer = Math.max(0, this.eatTimer - dt);
    const active = g.playing && !g.panelOpen && (input.active || g.camMode === 'top' || g.isTouch);
    if (!active) { this._hideAll(); this.mining = false; this.progress = 0; return; }
    this.pick();
    const t = this.target, held = inv.held;

    // outline
    if (t) { this.outline.visible = true; this.outline.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5); } else this.outline.visible = false;

    // pick block
    if (input.clicked[1] && t) {
      const key = BLOCK_LIST[t.id]; const k = BLOCKS[key].drops === undefined || !BLOCKS[key].drops ? key : key;
      const slot = inv.hotbar.findIndex((s) => s && s.item === k);
      if (slot >= 0) { inv.selected = slot; g.refreshHotbar(); }
      else if (g.creative) { const empty = inv.hotbar.findIndex((s) => !s); const i = empty >= 0 ? empty : inv.selected; inv.hotbar[i] = { item: k, count: 64 }; inv.selected = i; g.refreshHotbar(); }
    }

    // attack / break (left)
    const left = input.buttons[0] || input.clicked[0];
    if (left && this.mobTarget) {
      this.mining = false; this.progress = 0; this._hideCrack();
      if (this.attackCd <= 0) { this.attackCd = 0.45; this.swing = 1; g.mobs.attack(this.mobTarget.mob, held); }
    } else if (left && t) {
      const block = BLOCKS[BLOCK_LIST[t.id]];
      const k = `${t.x},${t.y},${t.z}`;
      if (k !== this.breakKey) { this.breakKey = k; this.progress = 0; }
      if (block.hardness < 0 && !g.creative) { this.mining = true; this._hideCrack(); }
      else if (g.creative) {
        this.mining = true;
        if (this.breakCd <= 0) { this.breakBlock(t); this.breakCd = 0.22; }
      } else {
        this.mining = true;
        const need = this.breakTime(block, held);
        this.progress += dt / need;
        if (this.progress >= 1) { this.breakBlock(t); this.progress = 0; this.breakKey = ''; this.crack.visible = false; }
        else {
          this.crack.visible = true; this.crack.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
          this.crack.geometry = this.crackGeos[Math.min(9, Math.floor(this.progress * 10))];
          if (Math.floor(this.progress * 10) !== this._lastStage) { this._lastStage = Math.floor(this.progress * 10); sfx.play('dig', 0.6); }
        }
      }
      // tiny dust while mining
      if (Math.random() < dt * 8) g.particles.breakBurst(t.x, t.y, t.z, BLOCK_LIST[t.id]);
    } else {
      if (left && !t) this.swing = Math.max(this.swing, 0.5);
      this.mining = false; this.progress = 0; this.breakKey = ''; this._hideCrack();
    }
    if (!left) { this.mining = false; this.progress = 0; this.breakKey = ''; this._hideCrack(); }

    // use / place (right)
    const right = input.buttons[2];
    if ((input.clicked[2] || (right && this.placeCd <= 0)) && (t || held)) {
      const wasClick = input.clicked[2];
      if (wasClick || this.placeCd <= 0) {
        this.placeCd = 0.22;
        let done = false;
        const block = t ? BLOCKS[BLOCK_LIST[t.id]] : null;
        if (t && block.interact && !g.player.sneaking) { g.openStation(block.interact, t); done = true; }
        else if (held && !isBlockItem(held.item)) done = this.use(t, held);
        else if (held && t && isBlockItem(held.item)) {
          if (held.item === 'flint_and_steel') done = false;
          else if (this.place(t, held)) { if (!g.creative) inv.consumeHeld(1); g.refreshHotbar(); done = true; }
        }
        if (done) this.swing = 1;
      }
    }
  }
  _hideCrack() { this.crack.visible = false; this._lastStage = -1; }
  _hideAll() { this.outline.visible = false; this._hideCrack(); }
}
