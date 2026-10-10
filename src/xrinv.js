// ============================================================================
// Mineblock — inventory inside VR: a floating panel you point at, plus a
// hotbar + health strip on the left wrist
// ----------------------------------------------------------------------------
//   const vi = new VRInventory(game, xr)
//   vi.open(mode)      'inv' | 'craft' | 'furnace' | 'creative'   (X on the left controller toggles)
//   vi.close()
//   vi.update(dt, trigger, grip)   trigger/grip: true on the frame the button went down
// The panel is a canvas texture on a plane that lives in the XR dolly, so it
// moves with the player. The right controller ray picks a slot; trigger =
// left click, grip = right click, exactly the desktop inventory semantics
// (inv.click / game.furnaceClick). Creative: pointing at an item puts it in
// the selected hotbar slot.
// ============================================================================
import * as THREE from 'three';
import { CREATIVE_ORDER, ITEMS, itemDef, maxStack } from './blocks.js';
import { iconFor } from './ui.js';
import { SMELT_TIME } from './furnace.js';

const W = 1024, H = 768, S = 76, G = 8;              // canvas size, slot size, gap (canvas px)
const PANEL_W = 0.92, PANEL_H = PANEL_W * H / W;     // metres
const CREATIVE = [...CREATIVE_ORDER, ...Object.keys(ITEMS)];
const COLS = 9, ROWS = 4, PAGE = COLS * ROWS;
const TITLES = { inv: 'Inventory', craft: 'Crafting Table', furnace: 'Furnace', creative: 'Creative Items' };

function texFor(canvas) { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; return t; }

export class VRInventory {
  constructor(game, xr) {
    this.g = game; this.xr = xr; this.mode = null; this.page = 0; this.regions = []; this.hover = null; this.hoverPx = null; this.redrawT = 0;
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d'); this.ctx.imageSmoothingEnabled = false;
    this.tex = texFor(this.canvas);
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, fog: false }));
    this.panel.renderOrder = 2000; this.panel.visible = false;
    xr.dolly.add(this.panel);
    // wrist strip: hotbar + hearts
    this.wc = document.createElement('canvas'); this.wc.width = 9 * 64 + 16; this.wc.height = 112;
    this.wctx = this.wc.getContext('2d'); this.wctx.imageSmoothingEnabled = false;
    this.wtex = texFor(this.wc);
    this.wrist = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2 * this.wc.height / this.wc.width), new THREE.MeshBasicMaterial({ map: this.wtex, transparent: true, depthTest: false, fog: false }));
    this.wrist.renderOrder = 1999; this.wrist.visible = false;
    this.wristT = 0; this.wristKey = '';
    this.ray = new THREE.Raycaster(); this._o = new THREE.Vector3(); this._d = new THREE.Vector3();
  }

  get isOpen() { return !!this.mode; }

  open(mode) {
    const g = this.g;
    if (this.mode) this.close();
    this.mode = mode; this.page = 0;
    g.panelOpen = 'vr';
    if (mode === 'inv') g.inv.setCraftSize(4); else if (mode === 'craft') g.inv.setCraftSize(9);
    // place it 0.75 m in front of the head, level, facing the player
    const cam = g.camera, head = cam.getWorldPosition(new THREE.Vector3()), fwd = cam.getWorldDirection(new THREE.Vector3());
    fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); fwd.normalize();
    const at = head.clone().addScaledVector(fwd, 0.75); at.y -= 0.12;
    this.panel.position.copy(this.xr.dolly.worldToLocal(at.clone()));
    this.panel.visible = true;
    this.panel.lookAt(head.x, at.y, head.z);
    this.draw();
  }

  close() {
    const g = this.g; if (!this.mode) return;
    const mode = this.mode; this.mode = null; this.panel.visible = false; this.hover = null;
    if (mode === 'inv' || mode === 'craft') g.inv.setCraftSize(4);
    if (g.inv.cursor) { const c = g.inv.cursor; g.inv.cursor = null; const left = g.inv.add(c.item, c.count); if (left) g.inv.drop({ ...c, count: left }); }
    g.furnaceTE = null;
    if (g.panelOpen === 'vr') g.panelOpen = null;
    g.refreshHotbar();
  }

  // ---------------------------------------------------------------- drawing
  slot(x, y, stack, region, opts = {}) {
    const c = this.ctx;
    c.fillStyle = '#8b8b8b'; c.fillRect(x, y, S, S);
    c.fillStyle = '#373737'; c.fillRect(x, y, S, 4); c.fillRect(x, y, 4, S);
    c.fillStyle = '#ffffff'; c.fillRect(x, y + S - 4, S, 4); c.fillRect(x + S - 4, y, 4, S);
    if (opts.selected) { c.strokeStyle = '#ffffff'; c.lineWidth = 6; c.strokeRect(x - 3, y - 3, S + 6, S + 6); }
    if (region) this.regions.push({ x, y, w: S, h: S, ...region });
    if (this.hover && region && this.hover.section === region.section && this.hover.index === region.index && this.hover.item === region.item) { c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x + 4, y + 4, S - 8, S - 8); }
    if (stack) this.drawStack(x + 8, y + 8, S - 16, stack);
  }
  drawStack(x, y, size, stack) {
    const c = this.ctx;
    c.drawImage(iconFor(stack.item, 64), x, y, size, size);
    if (stack.count > 1) { c.font = 'bold 26px monospace'; c.textAlign = 'right'; c.fillStyle = '#3f3f3f'; c.fillText(stack.count, x + size + 4, y + size + 6); c.fillStyle = '#fff'; c.fillText(stack.count, x + size + 2, y + size + 4); }
    const def = itemDef(stack.item);
    if (def?.durability && stack.durability !== undefined && stack.durability < def.durability) {
      const f = stack.durability / def.durability; c.fillStyle = '#000'; c.fillRect(x, y + size - 4, size, 6); c.fillStyle = `hsl(${f * 120},90%,50%)`; c.fillRect(x, y + size - 4, size * f, 4);
    }
  }
  button(x, y, w, h, label, action) {
    const c = this.ctx;
    const hot = this.hover?.action === action;
    c.fillStyle = hot ? '#7f8fc0' : '#6f6f6f'; c.fillRect(x, y, w, h);
    c.fillStyle = '#000'; c.fillRect(x, y + h - 4, w, 4);
    c.font = 'bold 26px monospace'; c.textAlign = 'center'; c.fillStyle = '#fff'; c.fillText(label, x + w / 2, y + h / 2 + 9);
    this.regions.push({ x, y, w, h, action });
  }

  draw() {
    const g = this.g, c = this.ctx, inv = g.inv; this.regions = [];
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#c6c6c6'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, 6); c.fillRect(0, 0, 6, H);
    c.fillStyle = '#555555'; c.fillRect(0, H - 6, W, 6); c.fillRect(W - 6, 0, 6, H);
    c.font = 'bold 34px monospace'; c.textAlign = 'left'; c.fillStyle = '#3f3f3f'; c.fillText(TITLES[this.mode], 40, 56);
    this.button(W - 190, 22, 160, 50, 'Close', 'close');
    const gx = (W - (COLS * S + (COLS - 1) * G)) / 2;   // left edge of a 9-wide grid
    if (this.mode === 'creative') {
      const pages = Math.ceil(CREATIVE.length / PAGE);
      for (let i = 0; i < PAGE; i++) {
        const key = CREATIVE[this.page * PAGE + i]; if (!key) break;
        this.slot(gx + (i % COLS) * (S + G), 100 + Math.floor(i / COLS) * (S + G), { item: key, count: 1 }, { item: key });
      }
      const py = 100 + ROWS * (S + G) + 4;
      this.button(gx, py, 150, 50, '< Prev', 'prev'); this.button(gx + COLS * (S + G) - G - 150, py, 150, 50, 'Next >', 'next');
      c.font = 'bold 26px monospace'; c.textAlign = 'center'; c.fillStyle = '#3f3f3f'; c.fillText(`Page ${this.page + 1} / ${pages}`, W / 2, py + 34);
      c.textAlign = 'left'; c.fillText('Pick an item: it goes into your selected hotbar slot', gx, H - 150);
    } else {
      let top = 96;
      if (this.mode === 'furnace') {
        const te = g.furnaceTE;
        if (te) {
          const fx = W / 2 - 180;
          this.slot(fx, top, te.input, { section: 'input', index: 0 });
          this.slot(fx, top + S + 40, te.fuel, { section: 'fuel', index: 0 });
          // flame + arrow progress
          const burn = te.burnMax ? te.burn / te.burnMax : 0;
          c.fillStyle = '#8b8b8b'; c.fillRect(fx + 22, top + S + 8, 32, 26); c.fillStyle = '#ff9a2a'; c.fillRect(fx + 22, top + S + 8 + 26 * (1 - burn), 32, 26 * burn);
          c.fillStyle = '#8b8b8b'; c.fillRect(fx + S + 40, top + S / 2 + 10, 150, 26); c.fillStyle = '#ffffff'; c.fillRect(fx + S + 40, top + S / 2 + 10, 150 * Math.min(1, te.progress / SMELT_TIME), 26);
          this.slot(fx + S + 220, top + S / 2, te.output, { section: 'output', index: 0 });
        }
        top += 2 * S + 70;
      } else {
        const n = this.mode === 'craft' ? 3 : 2, cx = W / 2 - (n * (S + G) + 140) / 2;
        for (let i = 0; i < n * n; i++) this.slot(cx + (i % n) * (S + G), top + Math.floor(i / n) * (S + G), inv.craft[i], { section: 'craft', index: i });
        const ay = top + (n * (S + G) - G) / 2;
        c.fillStyle = '#8b8b8b'; c.beginPath(); c.moveTo(cx + n * (S + G) + 14, ay - 14); c.lineTo(cx + n * (S + G) + 54, ay - 14); c.lineTo(cx + n * (S + G) + 54, ay - 28); c.lineTo(cx + n * (S + G) + 84, ay); c.lineTo(cx + n * (S + G) + 54, ay + 28); c.lineTo(cx + n * (S + G) + 54, ay + 14); c.lineTo(cx + n * (S + G) + 14, ay + 14); c.fill();
        this.slot(cx + n * (S + G) + 100, ay - S / 2, inv.craftResult, { section: 'result', index: 0 });
        top += n * (S + G) + 14;
      }
      for (let i = 0; i < 27; i++) this.slot(gx + (i % 9) * (S + G), top + Math.floor(i / 9) * (S + G), inv.main[i], { section: 'main', index: i });
    }
    const hy = H - 16 - S;
    for (let i = 0; i < 9; i++) this.slot(gx + i * (S + G), hy, inv.hotbar[i], { section: 'hotbar', index: i }, { selected: i === inv.selected });
    if (this.mode !== 'creative') { c.font = 'bold 20px monospace'; c.textAlign = 'right'; c.fillStyle = '#5a5a5a'; c.fillText('Trigger: pick up / drop   Grip: split', W - 210, 54); }
    // what you're carrying follows the pointer
    if (inv.cursor && this.hoverPx) this.drawStack(this.hoverPx[0] - 28, this.hoverPx[1] - 28, 56, inv.cursor);
    if (this.hoverPx) { c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 3; c.beginPath(); c.arc(this.hoverPx[0], this.hoverPx[1], 7, 0, Math.PI * 2); c.fill(); c.stroke(); }
    this.tex.needsUpdate = true;
  }

  // -------------------------------------------------------------- pointing
  pick() {
    if (!this.xr.aim(this._o, this._d)) return null;
    this.ray.set(this._o, this._d);
    const hit = this.ray.intersectObject(this.panel, false)[0];
    if (!hit?.uv) return null;
    const px = hit.uv.x * W, py = (1 - hit.uv.y) * H;
    this.hoverPx = [px, py];
    return this.regions.find((r) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) || { outside: true };
  }

  click(r, button) {
    const g = this.g, inv = g.inv;
    if (!r) return;
    if (r.action === 'close') { this.close(); return; }
    if (r.action === 'prev' || r.action === 'next') { const pages = Math.ceil(CREATIVE.length / PAGE); this.page = (this.page + (r.action === 'next' ? 1 : -1) + pages) % pages; return; }
    if (r.item) {   // creative palette
      const def = ITEMS[r.item];
      inv.hotbar[inv.selected] = { item: r.item, count: button === 2 ? 1 : maxStack(r.item), ...(def?.durability ? { durability: def.durability } : {}) };
      return;
    }
    if (this.mode === 'creative' && r.section === 'hotbar') { if (button === 2) inv.hotbar[r.index] = null; else inv.selected = r.index; return; }
    if (r.section) { if (this.mode === 'furnace') g.furnaceClick(r.section, r.index, button, false); else inv.click(r.section, r.index, button, false); }
  }

  update(dt, trigger, grip) {
    this.updateWrist(dt);
    if (!this.mode) return;
    const r = this.pick();
    if (!r) this.hoverPx = null;
    const changed = (r?.section ?? r?.action ?? r?.item) !== (this.hover?.section ?? this.hover?.action ?? this.hover?.item) || r?.index !== this.hover?.index;
    this.hover = r;
    this.redrawT -= dt;
    if (trigger || grip) { this.click(r, trigger ? 0 : 2); this.g.refreshHotbar(); this.redrawT = 0; }
    // redraw (a texture upload) at most ~25 times a second, and only while something can change
    const live = changed || this.hoverPx || this.mode === 'furnace';
    if (this.mode && this.redrawT <= 0 && (live || this.redrawT < -0.5)) { this.redrawT = 0.04; this.draw(); }
  }

  // ------------------------------------------------------------ wrist strip
  updateWrist(dt) {
    const g = this.g, left = this.xr.hands.left;
    if (!left) { this.wrist.visible = false; return; }
    if (this.wrist.parent !== left.grip) { left.grip.add(this.wrist); this.wrist.position.set(0, 0.03, 0.12); this.wrist.rotation.set(-Math.PI / 2.6, 0, 0); }
    this.wrist.visible = true;
    this.wristT -= dt; if (this.wristT > 0) return; this.wristT = 0.2;
    const inv = g.inv, p = g.player;
    const key = JSON.stringify([inv.hotbar.map((s) => s && [s.item, s.count]), inv.selected, Math.ceil(p.hp), Math.ceil(p.hunger), g.creative]);
    if (key === this.wristKey) return; this.wristKey = key;
    const c = this.wctx, cw = this.wc.width;
    c.clearRect(0, 0, cw, this.wc.height);
    if (!g.creative) {
      for (let i = 0; i < 10; i++) { const v = Math.max(0, Math.min(2, p.hp - i * 2)); c.fillStyle = '#3a0d0d'; c.fillRect(8 + i * 28, 6, 24, 22); if (v) { c.fillStyle = '#e8262b'; c.fillRect(8 + i * 28, 6, 24 * v / 2, 22); } }
      for (let i = 0; i < 10; i++) { const v = Math.max(0, Math.min(2, p.hunger - i * 2)); c.fillStyle = '#3a2a10'; c.fillRect(cw - 32 - i * 28, 6, 24, 22); if (v) { c.fillStyle = '#c8822a'; c.fillRect(cw - 32 - i * 28 + 24 * (1 - v / 2), 6, 24 * v / 2, 22); } }
    }
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, 38, cw, 74);
    for (let i = 0; i < 9; i++) {
      const x = 8 + i * 64, s = inv.hotbar[i];
      c.fillStyle = 'rgba(139,139,139,0.8)'; c.fillRect(x + 2, 44, 60, 60);
      if (s) {
        c.drawImage(iconFor(s.item, 64), x + 8, 50, 48, 48);
        if (s.count > 1) { c.font = 'bold 22px monospace'; c.textAlign = 'right'; c.fillStyle = '#fff'; c.fillText(s.count, x + 60, 102); }
      }
      if (i === inv.selected) { c.strokeStyle = '#fff'; c.lineWidth = 5; c.strokeRect(x + 1, 43, 62, 62); }
    }
    this.wtex.needsUpdate = true;
  }
}
