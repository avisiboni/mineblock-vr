// ============================================================================
// Mineblock — camera controller (first person / top-down) and the held-item view model
// ----------------------------------------------------------------------------
//   const cams = new CameraRig(game)   cams.update(dt, alpha)  positions game.camera
//   const vm = new ViewModel(game)     vm.setHeld(stack) / vm.update(dt, t)
// Everything renders from interpolated physics state so motion stays smooth at any
// refresh rate.
// ============================================================================
import * as THREE from 'three';
import { BLOCKS, ITEMS, isBlockItem, faceTile } from './blocks.js';
import { blockGeometry } from './blockmesh.js';
import { buildFirstPersonArm, animateArm, buildCharacter, animateCharacter } from './characters.js';
import { paintTile } from './textures.js';

const lerp = (a, b, t) => a + (b - a) * t;

export class CameraRig {
  constructor(game) {
    this.g = game; this.fov = 70; this.zoom = 15; this.focus = new THREE.Vector3(); this.first = true; this.roll = 0;
    this.playerRig = buildCharacter(THREE, 'player'); this.playerRig.group.visible = false; game.scene.add(this.playerRig.group);
    this.tAnim = 0;
  }
  setMode(mode) {
    this.g.camMode = mode; this.playerRig.group.visible = mode === 'top'; this.first = true;
    const cross = this.g.hud.el.querySelector('.crosshair'); if (cross) cross.style.display = mode === 'top' ? 'none' : '';
    this.g.canvas.style.cursor = mode === 'top' ? 'crosshair' : '';
    if (mode === 'top') this.g.input.unlock(); else if (this.g.playing && !this.g.panelOpen) this.g.input.lock();
  }
  update(dt, alpha, time) {
    const g = this.g, p = g.player, cam = g.camera;
    const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha), z = lerp(p.pz, p.z, alpha);
    const eye = p.eyeHeight(dt);
    // FOV: sprint widens, portal wobbles
    let targetFov = g.camMode === 'top' ? 50 : (p.sprinting ? 80 : 70);
    const pg = g.portals.progress;
    if (pg > 0) targetFov += Math.sin(time * 6) * 3 * pg;
    this.fov = lerp(this.fov, targetFov, Math.min(1, dt * 8));
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }

    if (g.camMode === 'fp' && g.xr?.active) {
      g.xr.place(x, y, z);
      this.playerRig.group.visible = false;
    } else if (g.camMode === 'fp') {
      const bob = p.onGround ? p.speedFrac : 0;
      const ph = p.walkDist * 4.6;
      cam.position.set(x, y + eye + Math.abs(Math.sin(ph)) * 0.035 * bob, z);
      const shake = g.shake > 0 ? (Math.random() - 0.5) * 0.03 * g.shake : 0;
      cam.rotation.order = 'YXZ';
      cam.rotation.set(p.pitch + shake, p.yaw + shake, Math.sin(ph) * 0.006 * bob + (this.roll = lerp(this.roll, g.hurtRoll || 0, 0.2)), 'YXZ');
      this.playerRig.group.visible = false;
    } else {
      const target = new THREE.Vector3(x, y + 0.9, z);
      if (this.first) { this.focus.copy(target); this.first = false; }
      this.focus.lerp(target, 1 - Math.exp(-dt * 9));
      const zoom = this.zoom;
      cam.position.set(this.focus.x, this.focus.y + zoom, this.focus.z + zoom * 0.32);
      cam.rotation.order = 'YXZ'; cam.lookAt(this.focus);
      const rig = this.playerRig;
      rig.group.visible = true; rig.group.position.set(x, y, z); rig.group.rotation.y = p.yaw + Math.PI;
      const l = Math.max(g.dim.getSky(Math.floor(x), Math.floor(y + 1), Math.floor(z)) / 15 * g.sky.dayFactor, g.dim.getBlockLight(Math.floor(x), Math.floor(y + 1), Math.floor(z)) / 15);
      rig.material.color.setScalar(g.player.invuln > 0.25 ? 1 : 0.45 + 0.55 * Math.min(1, l + 0.1));
      if (g.player.invuln > 0.3) rig.material.color.setRGB(1, 0.5, 0.5);
      this.tAnim += dt;
      animateCharacter(rig, this.tAnim * (0.6 + p.speedFrac), { speed: p.speedFrac, mining: g.interact.mining, attack: g.interact.swing > 0 ? 1 - g.interact.swing : 0, sneaking: p.sneaking, inAir: false, headPitch: 0 });
    }
  }
  wheel(d) { this.zoom = Math.max(8, Math.min(36, this.zoom + d * 2)); }
}

export class ViewModel {
  constructor(game) {
    this.g = game;
    this.holder = new THREE.Group(); this.holder.renderOrder = 1000;
    game.camera.add(this.holder); game.scene.add(game.camera);
    this.fp = buildFirstPersonArm(THREE);
    this.fp.group.scale.setScalar(0.72); this.fp.group.position.set(0.12, -0.12, 0);
    this.fp.rig.material.depthTest = false;
    this.fp.group.traverse((o) => { o.renderOrder = 1000; });
    this.holder.add(this.fp.group);
    this.item = new THREE.Group(); this.holder.add(this.item);
    this.blockMat = new THREE.MeshBasicMaterial({ map: game.mats.texture, depthTest: false, transparent: true, alphaTest: 0.5 });
    this.cur = null; this.t = 0; this.equip = 1;
    this.texCache = new Map();
  }
  tex(tile) {
    if (!this.texCache.has(tile)) { const t = new THREE.CanvasTexture(paintTile(tile)); t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; this.texCache.set(tile, t); }
    return this.texCache.get(tile);
  }
  setHeld(stack) {
    const key = stack ? stack.item : null;
    if (key === this.cur) return;
    this.cur = key; this.equip = 0;
    while (this.item.children.length) { const c = this.item.children.pop(); c.geometry?.dispose?.(); }
    this.item.children.length = 0;
    if (!key) { this.fp.group.visible = true; return; }
    this.fp.group.visible = false;
    let mesh;
    if (isBlockItem(key) && BLOCKS[key].model !== 'cross') {
      mesh = new THREE.Mesh(blockGeometry(THREE, this.g.atlas, key, 0.34), this.blockMat);
      mesh.rotation.set(0.25, -0.65, 0); mesh.position.set(0.48, -0.42, -0.72);
    } else {
      const tile = isBlockItem(key) ? faceTile(BLOCKS[key], 'top') : ITEMS[key].tile;
      const m = new THREE.MeshBasicMaterial({ map: this.tex(tile), transparent: true, alphaTest: 0.4, depthTest: false, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.48), m);
      mesh.rotation.set(0.15, -0.75, 0.35); mesh.position.set(0.5, -0.36, -0.75);
      if (ITEMS[key]?.tool) mesh.rotation.z = 0.05;
    }
    mesh.renderOrder = 1000; this.item.add(mesh);
  }
  update(dt, t) {
    const g = this.g, p = g.player, it = g.interact;
    this.holder.visible = g.camMode === 'fp' && g.playing;
    if (!this.holder.visible) return;
    this.equip = Math.min(1, this.equip + dt * 6);
    const l = Math.max(g.dim.getSky(Math.floor(p.x), Math.floor(p.y + 1.5), Math.floor(p.z)) / 15 * g.sky.dayFactor, g.dim.getBlockLight(Math.floor(p.x), Math.floor(p.y + 1.5), Math.floor(p.z)) / 15);
    const b = 0.5 + 0.5 * Math.min(1, l + 0.15);
    this.blockMat.color.setScalar(b); this.fp.rig.material.color.setScalar(b);
    const walk = p.onGround ? p.speedFrac : 0;
    if (!this.cur) {
      animateArm(this.fp, t, { mining: it.mining, swing: it.swing > 0 ? 1 - it.swing : 0, speed: walk });
      this.fp.arm.position.y -= (1 - this.equip) * 0.5;
    } else {
      const s = it.swing > 0 ? Math.sin((1 - it.swing) * Math.PI) : 0;
      const mine = it.mining ? Math.sin(t * 20) * 0.5 + 0.5 : 0;
      this.item.position.set(Math.sin(t * 4.6) * 0.012 * walk, Math.abs(Math.cos(t * 4.6)) * 0.015 * walk - (1 - this.equip) * 0.5 - s * 0.08 - mine * 0.05, -s * 0.18 - mine * 0.08);
      this.item.rotation.set(-s * 0.9 - mine * 0.5, s * 0.3, -s * 0.2);
      if (it.eatTimer > 0) this.item.position.y += Math.sin(t * 30) * 0.02;
    }
  }
}
