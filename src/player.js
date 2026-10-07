// ============================================================================
// Mineblock — player physics and vitals (no rendering, no DOM)
// ----------------------------------------------------------------------------
//   p.tick(dt, ctx)   ctx = { dim, input, camMode: 'fp'|'top', creative, allowInput }
//   p.damage(n, why)  respects invulnerability frames, returns true if applied
// Conventions: p.x/p.y/p.z = feet centre. yaw uses the camera convention
// (forward = (-sin yaw, -cos yaw)); a character rig faces yaw + PI.
// Units: metres, seconds. 60 Hz fixed steps.
// ============================================================================
import { BLOCKS, BLOCK_LIST } from './blocks.js';
import { moveBox, collides, touches, PORTAL } from './physics.js';
import { LIQUID } from './tables.js';

const moveToward = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

export class Player {
  constructor() {
    this.x = 0; this.y = 80; this.z = 0; this.px = 0; this.py = 80; this.pz = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.w = 0.6; this.h = 1.8; this.eye = 1.62;
    this.yaw = 0; this.pitch = 0;
    this.onGround = false; this.wasGround = false;
    this.inWater = false; this.inLava = false; this.eyeMedium = 'air';
    this.sprinting = false; this.sneaking = false; this.flying = false;
    this.hp = 20; this.hunger = 20; this.air = 10; this.xp = 0;
    this.fall = 0; this.invuln = 0; this.dead = false;
    this.envTimer = 0; this.regenTimer = 0; this.hungerTimer = 0; this.drownTimer = 0;
    this.walkDist = 0; this.speedFrac = 0; this.inPortal = false;
    this.ground = 'air'; this.spawn = { x: 0, y: 80, z: 0 };
    this.onHurt = null; this.onLand = null; this.onSplash = null; this.onJump = null;
    this.sneakEye = 1.62;
    // double-tap helpers (updated per frame by handleKeys)
    this.lastW = -1; this.lastSpace = -1; this.sprintTap = false;
  }
  teleport(x, y, z) { this.x = this.px = x; this.y = this.py = y; this.z = this.pz = z; this.vx = this.vy = this.vz = 0; this.fall = 0; }

  // called once per rendered frame with edge-detected keys
  handleKeys(input, now, creative) {
    if (input.pressed('KeyW')) { if (now - this.lastW < 0.3) this.sprintTap = true; this.lastW = now; }
    if (!input.held('KeyW')) this.sprintTap = false;
    if (creative && input.pressed('Space')) { if (now - this.lastSpace < 0.3) { this.flying = !this.flying; this.vy = 0; } this.lastSpace = now; }
  }

  damage(n, why = '') {
    if (this.dead || this.invuln > 0 || n <= 0) return false;
    this.hp = Math.max(0, this.hp - n); this.invuln = 0.5;
    this.onHurt?.(n, why);
    if (this.hp <= 0) this.dead = true;
    return true;
  }
  heal(n) { this.hp = Math.min(20, this.hp + n); }

  tick(dt, { dim, input, camMode, creative, allowInput }) {
    this.px = this.x; this.py = this.y; this.pz = this.z;
    if (this.dead) return;
    this.invuln = Math.max(0, this.invuln - dt);
    const held = (c) => allowInput && input.held(c);
    const fwd = (held('KeyW') ? 1 : 0) - (held('KeyS') ? 1 : 0);
    const str = (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0);
    const wantUp = held('Space');
    this.sneaking = held('ShiftLeft') || held('ShiftRight');
    if (creative === false) this.flying = false;

    // environment
    const midId = dim.getId(Math.floor(this.x), Math.floor(this.y + 0.4), Math.floor(this.z));
    const eyeId = dim.getId(Math.floor(this.x), Math.floor(this.y + this.eye), Math.floor(this.z));
    this.inWater = BLOCK_LIST[midId] === 'water'; this.inLava = BLOCK_LIST[midId] === 'lava';
    const eyeKey = BLOCK_LIST[eyeId];
    this.eyeMedium = eyeKey === 'water' ? 'water' : eyeKey === 'lava' ? 'lava' : 'air';
    const liquid = this.inWater || this.inLava;
    const underId = dim.getId(Math.floor(this.x), Math.floor(this.y - 0.1), Math.floor(this.z));
    const under = BLOCKS[BLOCK_LIST[underId]];
    this.ground = BLOCK_LIST[underId];
    const friction = this.onGround ? under.friction ?? 0.6 : 0.6;

    // wish direction
    let dx = 0, dz = 0;
    if (camMode === 'top') { dx = str; dz = -fwd; }
    else { const s = Math.sin(this.yaw), c = Math.cos(this.yaw); dx = -s * fwd + c * str; dz = -c * fwd - s * str; }
    const len = Math.hypot(dx, dz);
    if (len > 0) { dx /= len; dz /= len; }
    const moving = len > 0;

    // speed selection
    this.sprinting = moving && !this.sneaking && this.hunger > 6 && (held('ControlLeft') || this.sprintTap || (camMode === 'top' && held('KeyQ') && false));
    let speed = this.sneaking ? 1.3 : this.sprinting ? 5.6 : 4.3;
    if (liquid) speed = this.inLava ? 1.2 : 2.2;
    if (under.slow && this.onGround) speed *= 0.5;
    if (this.flying) speed = this.sprinting ? 20 : 10.5;
    if (!allowInput) speed = 0;

    // horizontal acceleration (low on ice, limited in air)
    let rate;
    if (this.flying) rate = 40;
    else if (liquid) rate = 14;
    else if (this.onGround) rate = friction > 0.9 ? 3.4 : friction < 0.5 ? 25 : 55;
    else rate = 9;
    const tx = dx * speed, tz = dz * speed;
    let ax = tx - this.vx, az = tz - this.vz;
    const al = Math.hypot(ax, az), maxd = rate * dt;
    if (al > maxd) { ax *= maxd / al; az *= maxd / al; }
    this.vx += ax; this.vz += az;

    // vertical
    if (this.flying) {
      const up = wantUp ? 1 : 0, down = this.sneaking ? 1 : 0;
      this.vy = moveToward(this.vy, (up - down) * 9, 40 * dt);
    } else if (liquid) {
      const lava = this.inLava;
      if (wantUp) this.vy = moveToward(this.vy, lava ? 1.6 : 3.2, 25 * dt);
      else this.vy = moveToward(this.vy, lava ? -0.9 : -1.8, 12 * dt);
    } else {
      this.vy = Math.max(-78, this.vy - 32 * dt);
      if (wantUp && this.onGround) { this.vy = 8.75; this.onJump?.(); }
    }

    // move (with sneak edge protection)
    let mx = this.vx * dt, mz = this.vz * dt;
    if (this.sneaking && this.onGround && !this.flying) {
      const probe = (ddx, ddz) => collides(dim, { x: this.x + ddx, y: this.y - 0.6, z: this.z + ddz, w: this.w, h: this.h });
      while (mx !== 0 && !probe(mx, 0)) mx = Math.abs(mx) < 0.02 ? 0 : mx - Math.sign(mx) * 0.02;
      while (mz !== 0 && !probe(mx, mz)) mz = Math.abs(mz) < 0.02 ? 0 : mz - Math.sign(mz) * 0.02;
    }
    const preY = this.y;
    this.wasGround = this.onGround;
    moveBox(dim, this, mx, this.vy * dt, mz);
    if (this.hitX) this.vx = 0; if (this.hitZ) this.vz = 0;
    if (this.hitY) this.vy = 0;
    if (liquid && (this.hitX || this.hitZ) && wantUp) this.vy = Math.max(this.vy, 6.5);   // hop out of the water
    if (this.flying && this.onGround) this.flying = false;

    // falling
    if (liquid || this.flying) this.fall = 0;
    else if (!this.onGround && this.y < preY) this.fall += preY - this.y;
    if (this.onGround && !this.wasGround) {
      if (this.fall > 3 && !creative) this.damage(Math.ceil(this.fall - 3), 'fall');
      if (this.fall > 1) this.onLand?.(this.fall);
      this.fall = 0;
    }
    if (this.onGround) this.fall = 0;

    // view bobbing distance / speed
    const hs = Math.hypot(this.vx, this.vz);
    this.speedFrac = this.onGround && !liquid ? Math.min(1, hs / 4.3) : 0;
    this.walkDist += hs * dt * (this.onGround ? 1 : 0);

    // water entry splash
    if (liquid && !this._wasLiquid && this.vy < -2) this.onSplash?.();
    this._wasLiquid = liquid;

    // hazards
    this.envTimer -= dt;
    if (!creative) {
      if (this.inLava && this.envTimer <= 0) { this.damage(4, 'lava'); this.envTimer = 0.5; }
      else if (under.damage && this.onGround && !this.sneaking && this.envTimer <= 0) { this.damage(under.damage, 'magma'); this.envTimer = 1; }
      // air / drowning
      if (this.eyeMedium === 'water') {
        this.air = Math.max(0, this.air - dt * 1.0);
        if (this.air <= 0) { this.drownTimer -= dt; if (this.drownTimer <= 0) { this.damage(2, 'drown'); this.drownTimer = 1; } }
      } else { this.air = Math.min(10, this.air + dt * 5); this.drownTimer = 0; }
      // hunger + regen
      this.hungerTimer += dt * (this.sprinting ? 3 : 1);
      if (this.hungerTimer > 80) { this.hungerTimer = 0; this.hunger = Math.max(0, this.hunger - 1); }
      this.regenTimer += dt;
      if (this.hunger >= 18 && this.hp < 20 && this.regenTimer > 4) { this.heal(1); this.regenTimer = 0; }
      else if (this.hunger <= 0 && this.hp > 1 && this.regenTimer > 4) { this.damage(1, 'hunger'); this.regenTimer = 0; }
    } else { this.air = 10; this.hp = 20; }

    this.inPortal = touches(dim, this, PORTAL, 0.1);
    if (this.y < -30) { this.damage(99, 'void'); }
  }

  // eye height with smooth sneaking
  eyeHeight(dt) {
    const target = this.sneaking ? 1.27 : 1.62;
    this.sneakEye += (target - this.sneakEye) * Math.min(1, dt * 14);
    return this.sneakEye;
  }
}
