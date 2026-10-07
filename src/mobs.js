// ============================================================================
// Mineblock — mobs: spawning, AI, combat, drops
// ----------------------------------------------------------------------------
//   const mobs = new Mobs(game)
//   mobs.update(dt, time)        spawn / move / attack / animate
//   mobs.raycast(origin, dir, max) -> { mob, t } | null
//   mobs.attack(mob, heldStack)  player hits a mob
// Overworld: pig (day, grass), zombie (dark places).  Nether: piglin, wisp.
// Uses the rigs and animations from characters.js and the shared physics.
// ============================================================================
import * as THREE from 'three';
import { BLOCK_LIST, itemDef } from './blocks.js';
import { buildCharacter, animateCharacter, CHARACTERS } from './characters.js';
import { moveBox, raycast } from './physics.js';
import { OPAQUE, LIQUID } from './tables.js';
import { sfx } from './sfx.js';
import { Sky } from './sky.js';

const MAX_MOBS = 20;
const LIMITS = { pig: 8, zombie: 10, piglin: 6, wisp: 4 };
const DROPS = { pig: ['porkchop', 1, 3], piglin: ['gold_ingot', 1, 1], wisp: ['blaze_rod', 1, 1] };
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class Mobs {
  constructor(game) {
    this.g = game; this.list = []; this.spawnT = 0; this.fireballs = [];
    this.group = new THREE.Group(); game.scene.add(this.group);
    this.fbGeo = new THREE.SphereGeometry(0.22, 8, 8);
    this.fbMat = new THREE.MeshBasicMaterial({ color: 0xffb030 });
    this.soundT = 5;
  }
  clear() {
    for (const m of this.list) this.group.remove(m.rig.group);
    for (const f of this.fireballs) this.group.remove(f.mesh);
    this.list.length = 0; this.fireballs.length = 0;
  }

  spawnAt(kind, x, y, z) {
    const def = CHARACTERS[kind];
    const rig = buildCharacter(THREE, kind);
    rig.material.depthTest = true;
    rig.group.position.set(x, y, z); this.group.add(rig.group);
    const m = { kind, def, rig, x, y, z, vx: 0, vy: 0, vz: 0, w: def.width, h: def.height, heading: Math.random() * 6.28, hp: def.hp || 10, maxHp: def.hp || 10,
      wanderT: 0, tx: x, tz: z, moving: false, attackCd: 1, attackAnim: 0, hurt: 0, dying: 0, despawnT: 0, fireT: 2 + Math.random() * 2, onGround: false, head: 0 };
    this.list.push(m);
    return m;
  }

  count(kind) { let n = 0; for (const m of this.list) if (m.kind === kind && !m.dying) n++; return n; }

  trySpawn() {
    const g = this.g, dim = g.dim, p = g.player;
    if (this.list.length >= MAX_MOBS) return;
    const ang = Math.random() * Math.PI * 2, dist = 24 + Math.random() * 24;
    const x = Math.floor(p.x + Math.cos(ang) * dist), z = Math.floor(p.z + Math.sin(ang) * dist);
    if (!dim.loaded(x, z)) return;
    const bright = Sky.brightness(g.time);
    if (dim.name === 'overworld') {
      let y = Math.min(126, Math.floor(p.y) + 24);
      for (; y > Math.floor(p.y) - 24 && y > 1; y--) if (OPAQUE[dim.getId(x, y, z)] && !OPAQUE[dim.getId(x, y + 1, z)] && !OPAQUE[dim.getId(x, y + 2, z)] && !LIQUID[dim.getId(x, y + 1, z)]) break;
      if (y <= 1 || y <= Math.floor(p.y) - 24) return;
      const floor = BLOCK_LIST[dim.getId(x, y, z)];
      const light = Math.max(dim.getSky(x, y + 1, z) / 15 * bright, dim.getBlockLight(x, y + 1, z) / 15);
      if ((floor === 'grass' || floor === 'snow_grass') && light > 0.7 && bright > 0.6 && this.count('pig') < LIMITS.pig) this.spawnAt('pig', x + 0.5, y + 1, z + 0.5);
      else if (light < 0.3 && this.count('zombie') < LIMITS.zombie) this.spawnAt('zombie', x + 0.5, y + 1, z + 0.5);
    } else {
      if (Math.random() < 0.3 && this.count('wisp') < LIMITS.wisp) {
        const y = 40 + Math.floor(Math.random() * 60);
        for (let k = 0; k < 6; k++) if (dim.getId(x, y + k, z) !== 0) return;
        this.spawnAt('wisp', x + 0.5, y + 2, z + 0.5);
        return;
      }
      if (this.count('piglin') >= LIMITS.piglin) return;
      let y = Math.min(110, Math.floor(p.y) + 20);
      for (; y > Math.max(33, Math.floor(p.y) - 24); y--) if (OPAQUE[dim.getId(x, y, z)] && !OPAQUE[dim.getId(x, y + 1, z)] && !OPAQUE[dim.getId(x, y + 2, z)] && !LIQUID[dim.getId(x, y + 1, z)]) break;
      if (y <= Math.max(33, Math.floor(p.y) - 24)) return;
      const floor = BLOCK_LIST[dim.getId(x, y, z)];
      if (floor === 'netherrack' || floor === 'soul_sand' || floor === 'nether_bricks') this.spawnAt('piglin', x + 0.5, y + 1, z + 0.5);
    }
  }

  raycast(o, d, max) {
    let best = null;
    for (const m of this.list) {
      if (m.dying) continue;
      const min = [m.x - m.w / 2, m.y, m.z - m.w / 2], mx = [m.x + m.w / 2, m.y + m.h, m.z + m.w / 2];
      let t0 = 0, t1 = max, ok = true;
      const od = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
      for (let i = 0; i < 3 && ok; i++) {
        if (Math.abs(dd[i]) < 1e-9) { if (od[i] < min[i] || od[i] > mx[i]) ok = false; }
        else { let a = (min[i] - od[i]) / dd[i], b = (mx[i] - od[i]) / dd[i]; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) ok = false; }
      }
      if (ok && (!best || t0 < best.t)) best = { mob: m, t: t0 };
    }
    return best;
  }

  attack(m, held) {
    const g = this.g, p = g.player;
    const def = held ? itemDef(held.item) : null;
    const dmg = def?.damage || 1;
    m.hp -= g.creative ? Math.max(dmg, 6) : dmg; m.hurt = 0.25;
    const dx = m.x - p.x, dz = m.z - p.z, l = Math.hypot(dx, dz) || 1;
    m.vx += dx / l * 6; m.vz += dz / l * 6; m.vy = Math.max(m.vy, 4.5);
    sfx.play('hurt');
    if (def?.tool && def.durability && !g.creative) { g.inv.damageHeld(1); g.refreshHotbar(); }
    m.target = true;   // retaliate / flee handled in AI
    if (m.hp <= 0 && !m.dying) { m.dying = 0.001; this.drop(m); if (!g.creative) g.addXP(0.2); }
  }
  drop(m) {
    const d = DROPS[m.kind]; if (!d || this.g.creative) return;
    const n = d[1] + ((Math.random() * (d[2] - d[1] + 1)) | 0);
    this.g.drops.spawn(d[0], n, m.x, m.y + 0.5, m.z, 0, 3, 0);
  }

  canSee(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz);
    if (L < 0.01) return true;
    const hit = raycast(this.g.dim, a.x, a.y, a.z, dx / L, dy / L, dz / L, L, (id) => OPAQUE[id] === 1);
    return !hit;
  }

  update(dt, time) {
    const g = this.g, dim = g.dim, p = g.player;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && g.playing) { this.spawnT = 2; for (let i = 0; i < 4; i++) this.trySpawn(); }
    this.soundT -= dt;
    for (const m of [...this.list]) {
      const dist = Math.hypot(m.x - p.x, m.z - p.z);
      if (dist > 64 || m.y < -10) { this.remove(m); continue; }
      if (!dim.loaded(Math.floor(m.x), Math.floor(m.z))) continue;
      m.hurt = Math.max(0, m.hurt - dt); m.attackAnim = Math.max(0, m.attackAnim - dt * 2.2); m.attackCd -= dt;
      if (m.dying) {
        m.dying += dt; m.rig.group.rotation.z = Math.min(1, m.dying / 0.5) * Math.PI / 2;
        m.vx *= 0.9; m.vz *= 0.9; m.vy -= 32 * dt; moveBox(dim, m, m.vx * dt, m.vy * dt, m.vz * dt); if (m.hitY) m.vy = 0;
        m.rig.group.position.set(m.x, m.y, m.z); m.rig.material.color.setRGB(1, 0.4, 0.4);
        if (m.dying > 1) this.remove(m);
        continue;
      }
      const def = m.def, flying = def.flies;
      const eye = { x: m.x, y: m.y + def.eyeHeight, z: m.z }, pe = { x: p.x, y: p.y + 1.4, z: p.z };
      const near = !p.dead && def.hostile && dist < (flying ? 24 : 16) && Math.abs(m.y - p.y) < 12 && !g.creative && this.canSee(eye, pe);
      let wantX = 0, wantZ = 0, speed = def.speed;
      if (near) {
        const dx = p.x - m.x, dz = p.z - m.z, l = Math.hypot(dx, dz) || 1;
        wantX = dx / l; wantZ = dz / l;
        m.tx = p.x; m.tz = p.z;
        if (flying) { const keep = 4; if (l < keep) { wantX *= -0.3; wantZ *= -0.3; } }
      } else {
        m.wanderT -= dt;
        if (m.wanderT <= 0) { m.wanderT = 3 + Math.random() * 3; if (Math.random() < 0.7) { m.tx = m.x + (Math.random() - 0.5) * 16; m.tz = m.z + (Math.random() - 0.5) * 16; } else { m.tx = m.x; m.tz = m.z; } }
        const dx = m.tx - m.x, dz = m.tz - m.z, l = Math.hypot(dx, dz);
        if (l > 0.4) { wantX = dx / l; wantZ = dz / l; speed *= 0.5; }
      }
      const wantMove = wantX !== 0 || wantZ !== 0;
      // velocity approach
      const rate = m.onGround || flying ? 30 : 6;
      m.vx += Math.max(-rate * dt, Math.min(rate * dt, wantX * speed - m.vx)); m.vz += Math.max(-rate * dt, Math.min(rate * dt, wantZ * speed - m.vz));
      const inLiq = LIQUID[dim.getId(Math.floor(m.x), Math.floor(m.y + 0.3), Math.floor(m.z))];
      if (flying) {
        const targetY = near ? p.y + 2.2 : m.y;
        m.vy += Math.max(-10 * dt, Math.min(10 * dt, (targetY - m.y) * 1.5 - m.vy));
        if (!near) m.vy += Math.sin(time * 1.3 + m.x) * 0.02;
      } else if (inLiq) m.vy = Math.min(2, m.vy + 20 * dt);
      else m.vy = Math.max(-60, m.vy - 32 * dt);
      moveBox(dim, m, m.vx * dt, m.vy * dt, m.vz * dt);
      if (m.hitY) m.vy = 0;
      if (!flying && m.onGround && (m.hitX || m.hitZ) && wantMove) m.vy = 8.2;
      // heading
      const hv = Math.hypot(m.vx, m.vz);
      if (hv > 0.25) { const target = Math.atan2(m.vx, m.vz); m.heading += angDiff(m.heading, target) * Math.min(1, dt * 8); }
      // attack
      if (near && dist < (flying ? 99 : 1.5) && Math.abs(p.y - m.y) < 1.8 && !flying && m.attackCd <= 0) {
        m.attackCd = 1.25; m.attackAnim = 1;
        if (p.damage(def.damage, 'mob')) { const dx = p.x - m.x, dz = p.z - m.z, l = Math.hypot(dx, dz) || 1; p.vx += dx / l * 6; p.vz += dz / l * 6; p.vy = Math.max(p.vy, 4); }
      }
      if (flying && near) {
        m.fireT -= dt;
        if (m.fireT <= 0 && dist < 22) { m.fireT = 3.2; this.shoot(m, p); }
      }
      // presentation
      const l01 = Math.max(dim.getSky(Math.floor(m.x), Math.floor(m.y + 1), Math.floor(m.z)) / 15 * g.sky.dayFactor, dim.getBlockLight(Math.floor(m.x), Math.floor(m.y + 1), Math.floor(m.z)) / 15);
      const b = 0.4 + 0.6 * Math.min(1, l01 + (dim.name === 'nether' ? 0.3 : 0));
      if (m.hurt > 0) m.rig.material.color.setRGB(1, 0.35 + b * 0.0, 0.35); else m.rig.material.color.setScalar(b);
      m.rig.group.position.set(m.x, m.y, m.z);
      m.rig.group.rotation.y = m.heading;
      m.rig.group.rotation.z = 0;
      const toP = Math.atan2(p.x - m.x, p.z - m.z);
      const headYaw = near || dist < 8 ? Math.max(-1, Math.min(1, angDiff(m.heading, toP))) : 0;
      animateCharacter(m.rig, time + m.heading * 3, { speed: Math.min(1, hv / Math.max(0.1, def.speed)), attack: m.attackAnim > 0 ? 1 - m.attackAnim : 0, headYaw, headPitch: 0 });
      if (this.soundT <= 0 && dist < 14 && Math.random() < 0.05) { this.soundT = 6 + Math.random() * 8; sfx.play(m.kind === 'pig' ? 'pig' : 'zombie', 0.9 + Math.random() * 0.3); }
    }
    // fireballs
    for (const f of [...this.fireballs]) {
      f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; f.mesh.position.set(f.x, f.y, f.z);
      const hitP = Math.hypot(f.x - p.x, f.y - (p.y + 0.9), f.z - p.z) < 0.9;
      if (hitP || f.life <= 0 || OPAQUE[dim.getId(Math.floor(f.x), Math.floor(f.y), Math.floor(f.z))]) {
        if (hitP && !g.creative) p.damage(6, 'fireball');
        g.particles.smoke(f.x, f.y, f.z, 6); sfx.play('explode');
        this.group.remove(f.mesh); this.fireballs.splice(this.fireballs.indexOf(f), 1);
      }
    }
  }
  shoot(m, p) {
    const dx = p.x - m.x, dy = p.y + 1 - (m.y + 0.5), dz = p.z - m.z, l = Math.hypot(dx, dy, dz) || 1;
    const mesh = new THREE.Mesh(this.fbGeo, this.fbMat); this.group.add(mesh);
    this.fireballs.push({ x: m.x, y: m.y + 0.5, z: m.z, vx: dx / l * 7, vy: dy / l * 7, vz: dz / l * 7, life: 6, mesh });
    sfx.play('fire'); m.attackAnim = 1;
  }
  remove(m) { this.group.remove(m.rig.group); m.rig.group.traverse((o) => { o.geometry?.dispose?.(); }); m.rig.texture?.dispose(); m.rig.material?.dispose(); const i = this.list.indexOf(m); if (i >= 0) this.list.splice(i, 1); }
}
