// ============================================================================
// Mineblock — the End: portal frames, Eyes of Ender, travel to and from the End
// ----------------------------------------------------------------------------
//   end.useEye(target, stack)     right-click with an Eye of Ender: fill a frame,
//                                 or throw it toward the nearest portal room
//   end.onFrameBroken(dim, x,y,z) a frame was removed: close the portal it held
//   end.update(dt)                eye flights + stepping into an End portal
//   end.arrive(dim)               build the obsidian platform in the End, return stand position
// A portal opens when 12 frames (5x5 ring without corners, all at one height)
// hold an eye; the 3x3 middle becomes End portal. The End's exit portal sits at
// (0, 0) and is always open; it takes you back to your spawn point (or bed).
// ============================================================================
import * as THREE from 'three';
import { BLOCK_ID } from './blocks.js';
import { END_Y } from './worldgen.js';
import { paintTile } from './textures.js';
import { sfx } from './sfx.js';

const FRAME = BLOCK_ID.end_portal_frame, FILLED = BLOCK_ID.end_portal_frame_filled, PORTAL = BLOCK_ID.end_portal;
const onRing = (dx, dz) => { const a = Math.abs(dx), b = Math.abs(dz); return Math.max(a, b) === 2 && Math.min(a, b) <= 1; };

export class EndPortals {
  constructor(game) {
    this.g = game; this.cooldown = 0; this.eyes = [];
    const t = new THREE.CanvasTexture(paintTile('eye_of_ender'));
    t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
    this.eyeMat = new THREE.SpriteMaterial({ map: t, transparent: true, alphaTest: 0.5 });
  }
  clear() { for (const e of this.eyes) this.g.scene.remove(e.sprite); this.eyes.length = 0; }

  useEye(t, stack) {
    const g = this.g, dim = g.dim;
    if (t && t.id === FRAME) {
      dim.setBlock(t.x, t.y, t.z, 'end_portal_frame_filled');
      g.particles.portal(t.x + 0.5, t.y + 1.2, t.z + 0.5, t.x + 0.5, t.y + 0.9, t.z + 0.5);
      sfx.play('place', 1.4);
      if (!g.creative) g.inv.consumeHeld(1);
      g.refreshHotbar();
      this.tryOpen(dim, t.x, t.y, t.z);
      return true;
    }
    if (t && t.id === FILLED) return false;
    return this.throwEye();
  }

  // look for a complete ring that contains the frame at (x,y,z)
  tryOpen(dim, x, y, z) {
    for (let cz = z - 2; cz <= z + 2; cz++) for (let cx = x - 2; cx <= x + 2; cx++) {
      if (!onRing(x - cx, z - cz)) continue;
      let ok = true;
      for (let dz = -2; dz <= 2 && ok; dz++) for (let dx = -2; dx <= 2 && ok; dx++) if (onRing(dx, dz)) ok = dim.getId(cx + dx, y, cz + dz) === FILLED;
      if (!ok) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) dim.setBlock(cx + dx, y, cz + dz, 'end_portal', { silent: true });
      sfx.play('portal'); sfx.play('explode', 0.5);
      for (let i = 0; i < 30; i++) this.g.particles.portal(cx + 0.5 + (Math.random() - 0.5) * 3, y + 1 + Math.random() * 2, cz + 0.5 + (Math.random() - 0.5) * 3, cx + 0.5, y + 0.8, cz + 0.5);
      this.g.hud.toast('The End portal opens!', 2500);
      return true;
    }
    return false;
  }

  onFrameBroken(dim, x, y, z) {
    const stack = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (dim.getId(x + dx, y, z + dz) === PORTAL) stack.push([x + dx, z + dz]);
    let n = 0;
    while (stack.length && n < 64) {
      const [px, pz] = stack.pop();
      if (dim.getId(px, y, pz) !== PORTAL) continue;
      dim.setBlock(px, y, pz, 'air', { silent: true }); n++;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (dim.getId(px + dx, y, pz + dz) === PORTAL) stack.push([px + dx, pz + dz]);
    }
  }

  // The eye floats toward the nearest portal room, hovers, then drops (or shatters).
  throwEye() {
    const g = this.g, p = g.player;
    if (g.dimName !== 'overworld') { g.hud.toast('The eye does nothing here', 1500); return false; }
    const target = g.world.gen.portalRoomNear(p.x, p.z);
    const sprite = new THREE.Sprite(this.eyeMat); sprite.scale.setScalar(0.45);
    const x = p.x, y = p.y + 1.5, z = p.z;
    sprite.position.set(x, y, z); g.scene.add(sprite);
    const dx = target.x - x, dz = target.z - z, dist = Math.hypot(dx, dz) || 1, go = Math.min(12, dist);
    this.eyes.push({ sprite, x0: x, y0: y, z0: z, x1: x + dx / dist * go, z1: z + dz / dist * go, t: 0, creative: g.creative });
    if (!g.creative) g.inv.consumeHeld(1);
    g.refreshHotbar();
    sfx.play('portal', 1.5);
    const dir = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][((Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) % 8) + 8) % 8];
    g.hud.toast(dist < 14 ? 'The portal room is right below you!' : `The eye flies ${dir}… (about ${Math.round(dist / 10) * 10} blocks)`, 3000);
    return true;
  }

  update(dt) {
    const g = this.g, p = g.player;
    for (const e of [...this.eyes]) {
      e.t += dt;
      const k = Math.min(1, e.t / 2.2), ease = 1 - (1 - k) * (1 - k);
      e.sprite.position.set(e.x0 + (e.x1 - e.x0) * ease, e.y0 + Math.sin(k * Math.PI * 0.5) * 2.5 + (k >= 1 ? Math.sin(e.t * 6) * 0.1 : 0), e.z0 + (e.z1 - e.z0) * ease);
      if (Math.random() < dt * 20) g.particles.portal(e.sprite.position.x, e.sprite.position.y, e.sprite.position.z, e.sprite.position.x, e.sprite.position.y - 0.4, e.sprite.position.z);
      if (e.t > 3.2) {
        const { x, y, z } = e.sprite.position;
        g.scene.remove(e.sprite); this.eyes.splice(this.eyes.indexOf(e), 1);
        if (!e.creative && Math.random() < 0.8) g.drops.spawn('eye_of_ender', 1, x, y, z, 0, 1, 0);
        else { g.particles.smoke(x, y, z, 8); sfx.play('dig', 1.6); }
      }
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (p.inEndPortal && this.cooldown <= 0 && !p.dead) {
      this.cooldown = 3;
      sfx.play('portal');
      if (g.dimName === 'end') { g.switchDimension('overworld', 0, 0, 0, false, 'spawn'); g.hud.toast('Returning to the Overworld', 2500); }
      else { g.switchDimension('end', 0, 0, 0, false, 'end'); g.hud.toast('Entering the End', 2500); }
    }
  }

  // 5x5 obsidian platform on the island's east side, facing the centre
  arrive(dim) {
    const X = 64, Z = 0, Y = END_Y;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) dim.ensureChunk((X >> 4) + dx, (Z >> 4) + dz);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      dim.setBlock(X + dx, Y, Z + dz, 'obsidian', { silent: true });
      for (let y = Y + 1; y <= Y + 3; y++) dim.setBlock(X + dx, y, Z + dz, 'air', { silent: true });
    }
    return { x: X + 0.5, y: Y + 1, z: Z + 0.5, yaw: Math.PI / 2 };
  }
}
