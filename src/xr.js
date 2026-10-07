// ============================================================================
// Mineblock — WebXR (VR headset) support
// ----------------------------------------------------------------------------
//   const xr = new XRSupport(game)   adds the ENTER VR button and controllers
//   xr.active                        true while an immersive session is running
//   xr.update(dt)                    once per frame, before the game step:
//                                    maps controllers onto game.input
//   xr.aim(o, d)                     right-hand pointer ray (world space)
// The camera lives inside `dolly`, which sits at the player's feet and carries
// the snap-turn yaw; the headset pose is applied on top of it by three.js.
// Controls (Touch controllers):
//   left stick  move (head-relative)      left stick click  sprint
//   right stick left/right  snap turn     right stick up/down  hotbar slot
//   right trigger  break / attack         right grip  place / use
//   A  jump / swim                        B  sneak
// ============================================================================
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

const DEAD = 0.4, SNAP = Math.PI / 6;
const MOVE_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ShiftLeft'];

export class XRSupport {
  constructor(game) {
    this.g = game;
    const r = game.renderer;
    r.xr.enabled = true;
    r.xr.setReferenceSpaceType('local-floor');
    this.dolly = new THREE.Group(); game.scene.add(this.dolly);
    this.turn = 0; this.snapArmed = true; this.slotArmed = true; this.prev = { left: [], right: [] };
    this.hands = {}; this.deadT = 0;
    const factory = new XRControllerModelFactory();
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    for (let i = 0; i < 2; i++) {
      const ray = r.xr.getController(i), grip = r.xr.getControllerGrip(i);
      grip.add(factory.createControllerModel(grip));
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
      line.scale.z = 5; line.visible = false; ray.add(line);
      ray.addEventListener('connected', (e) => { const h = e.data.handedness; this.hands[h] = { ray, grip, line, src: e.data }; line.visible = h === 'right'; });
      ray.addEventListener('disconnected', () => { for (const k in this.hands) if (this.hands[k].ray === ray) { ray.children[0].visible = false; delete this.hands[k]; } });
      this.dolly.add(ray, grip);
    }
    r.xr.addEventListener('sessionstart', () => this._start());
    r.xr.addEventListener('sessionend', () => this._end());
    const btn = VRButton.createButton(r);
    btn.style.zIndex = '60';
    document.body.appendChild(btn);
  }

  get active() { return this.g.renderer.xr.isPresenting; }

  _start() {
    const g = this.g;
    g.renderer.xr.setFoveation?.(1);
    this.dolly.add(g.camera);
    this.turn = g.player.yaw;
    g.input.xr = true; g.input.unlock();
    g.hint.style.display = 'none';
    if (g.camMode !== 'fp') g.cams.setMode('fp');
    g.closePanelSilently();
    if (g.paused) { g.paused = false; g.menus.pause?.close(); g.last = performance.now(); }
    this.prevDist = g.renderDist; g.setRenderDist(Math.min(g.renderDist, 6));
  }

  _end() {
    const g = this.g, vm = g.viewmodel;
    g.scene.add(g.camera);
    g.input.xr = false;
    for (const k of MOVE_KEYS) g.input.keys.delete(k);
    g.input.buttons[0] = g.input.buttons[2] = false;
    g.camera.add(vm.holder); vm.holder.position.set(0, 0, 0); vm.holder.scale.setScalar(1);
    vm.setHeld(null); vm.setHeld(g.inv.held);
    if (this.prevDist) g.setRenderDist(this.prevDist);
    if (g.playing && !g.player.dead) g.pause();
  }

  // pointer ray from the right controller (falls back to head gaze)
  aim(o, d) {
    const h = this.hands.right; if (!h) return false;
    h.ray.getWorldPosition(o);
    d.set(0, 0, -1).applyQuaternion(h.ray.getWorldQuaternion(new THREE.Quaternion()));
    return true;
  }

  // called from CameraRig in first person: put the play space at the player's feet
  place(x, y, z) { this.dolly.position.set(x, y, z); this.dolly.rotation.set(0, this.turn, 0); }

  update(dt) {
    if (!this.active) return;
    const g = this.g, inp = g.input, p = g.player;
    // held item rides on the right controller instead of floating in front of the face
    const vm = g.viewmodel, right = this.hands.right;
    if (right && vm.holder.parent !== right.grip) { right.grip.add(vm.holder); vm.holder.scale.setScalar(0.45); vm.holder.position.set(-0.22, 0.18, 0.3); }
    vm.fp.group.visible = false;

    // facing follows the head, so movement and the player model match where you look
    const d = g.camera.getWorldDirection(new THREE.Vector3());
    p.yaw = Math.atan2(-d.x, -d.z); p.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));

    // no menus in the headset: respawn automatically after a short pause
    if (p.dead) { this.deadT += dt; if (this.deadT > 2.5) { this.deadT = 0; g.respawn(); } } else this.deadT = 0;

    const L = this.hands.left?.src.gamepad, R = this.hands.right?.src.gamepad;
    const btn = (gp, i) => !!gp?.buttons[i]?.pressed;
    const stick = (gp) => gp ? [gp.axes[2] ?? gp.axes[0] ?? 0, gp.axes[3] ?? gp.axes[1] ?? 0] : [0, 0];
    const key = (code, on) => {
      if (on && !inp.keys.has(code)) { inp.keys.add(code); inp._pressed.add(code); }
      else if (!on) inp.keys.delete(code);
    };

    const [lx, ly] = stick(L);
    key('KeyW', ly < -DEAD); key('KeyS', ly > DEAD); key('KeyA', lx < -DEAD); key('KeyD', lx > DEAD);
    key('Space', btn(R, 4)); key('ShiftLeft', btn(R, 5));
    if (btn(L, 3) && ly < -DEAD) p.sprintTap = true;

    // trigger = left mouse (break), grip = right mouse (place)
    const edge = (i, on) => {
      if (on && !inp.buttons[i]) inp.clicked[i] = true;
      if (!on && inp.buttons[i]) inp.released[i] = true;
      inp.buttons[i] = on;
    };
    edge(0, btn(R, 0)); edge(2, btn(R, 1));

    // right stick: snap turn and hotbar
    const [rx, ry] = stick(R);
    if (Math.abs(rx) > 0.7 && this.snapArmed) { this.turn -= Math.sign(rx) * SNAP; this.snapArmed = false; }
    else if (Math.abs(rx) < 0.3) this.snapArmed = true;
    if (Math.abs(ry) > 0.7 && this.slotArmed) { inp.wheel += ry > 0 ? 1 : -1; this.slotArmed = false; }
    else if (Math.abs(ry) < 0.3) this.slotArmed = true;
  }
}
