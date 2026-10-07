// ============================================================================
// Mineblock — keyboard / mouse / touch input
// ----------------------------------------------------------------------------
//   input.keys            Set of e.code currently held
//   input.pressed(code)   true once on the frame the key went down
//   input.mouse           { dx, dy, x, y }  (dx,dy accumulate while pointer-locked)
//   input.buttons[0..2]   held;  input.clicked[0..2] edge (this frame)
//   input.wheel           accumulated wheel delta (reset each frame)
//   input.lock()/unlock()/locked
//   input.onKey(fn)       discrete key handler (code, event)
//   input.endFrame()      clear edges — call once per rendered frame
// ============================================================================
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set(); this._pressed = new Set();
    this.mouse = { dx: 0, dy: 0, x: 0, y: 0 };
    this.buttons = [false, false, false]; this.clicked = [false, false, false]; this.released = [false, false, false];
    this.wheel = 0; this.enabled = true; this.handlers = []; this.lockHandlers = [];
    this.touchLook = null; this.lockFailed = false; this.altDown = false;
    const prevent = new Set(['Space', 'Tab', 'F3', 'F5', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (prevent.has(e.code) || (e.ctrlKey && e.code.startsWith('Key') && this.enabled)) e.preventDefault();
      if (!e.repeat) { this.keys.add(e.code); this._pressed.add(e.code); for (const h of this.handlers) h(e.code, e); }
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('blur', () => { this.keys.clear(); this.buttons.fill(false); });
    addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.locked || (this.lockFailed && e.altKey)) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    addEventListener('mousedown', (e) => {
      if (!this.enabled || e.target !== canvas) return;
      this.buttons[e.button] = true; this.clicked[e.button] = true;
    });
    addEventListener('mouseup', (e) => { if (this.buttons[e.button]) this.released[e.button] = true; this.buttons[e.button] = false; });
    addEventListener('wheel', (e) => { if (this.enabled) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; for (const h of this.lockHandlers) h(false, true); });
    document.addEventListener('pointerlockchange', () => { for (const h of this.lockHandlers) h(this.locked); });
    this._initTouch();
  }
  get locked() { return document.pointerLockElement === this.canvas; }
  // true when the game should react to input: mouse captured, or capture is unavailable (fallback: arrow keys look)
  get active() { return this.locked || this.lockFailed || this.xr; }
  lock() {
    if (this.locked) return;
    this.wantLock = true;
    let p; try { p = this.canvas.requestPointerLock?.(); } catch { this.lockFailed = true; return; }
    p?.catch?.(() => { this.lockFailed = true; });
    if (!this.canvas.requestPointerLock) this.lockFailed = true;
    clearTimeout(this._lt); this._lt = setTimeout(() => { if (!this.locked && this.wantLock) { this.lockFailed = true; for (const h of this.lockHandlers) h(false, true); } }, 700);
  }
  unlock() { this.wantLock = false; if (this.locked) document.exitPointerLock(); }
  onKey(fn) { this.handlers.push(fn); }
  onLock(fn) { this.lockHandlers.push(fn); }
  pressed(code) { return this._pressed.has(code); }
  held(code) { return this.keys.has(code); }
  endFrame() {
    this._pressed.clear(); this.mouse.dx = 0; this.mouse.dy = 0; this.wheel = 0;
    this.clicked.fill(false); this.released.fill(false);
  }
  // On-screen controls for touch devices (index.html .touch) — look by dragging, tap = place, hold = break.
  _initTouch() {
    const touch = document.getElementById('touch');
    if (!touch) return;
    touch.querySelectorAll('[data-key]').forEach((el) => {
      const code = el.dataset.key;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); this.keys.add(code); this._pressed.add(code); for (const h of this.handlers) h(code, e); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); this.keys.delete(code); }, { passive: false });
    });
    touch.querySelectorAll('[data-wheel]').forEach((el) => el.addEventListener('touchstart', (e) => { e.preventDefault(); this.wheel += +el.dataset.wheel; }, { passive: false }));
    let look = null;
    this.canvas.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0]; look = { id: t.identifier, x: t.clientX, y: t.clientY, t0: performance.now(), moved: 0, holdTimer: null };
      look.holdTimer = setTimeout(() => { if (look && look.moved < 10) { this.buttons[0] = true; this.clicked[0] = true; } }, 350);
      e.preventDefault();
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) if (look && t.identifier === look.id) {
        const dx = t.clientX - look.x, dy = t.clientY - look.y; look.x = t.clientX; look.y = t.clientY; look.moved += Math.abs(dx) + Math.abs(dy);
        this.mouse.dx += dx * 1.4; this.mouse.dy += dy * 1.4;
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) if (look && t.identifier === look.id) {
        clearTimeout(look.holdTimer);
        if (this.buttons[0]) { this.buttons[0] = false; this.released[0] = true; }
        else if (look.moved < 10 && performance.now() - look.t0 < 300) { this.clicked[2] = true; }   // tap = place
        look = null;
      }
    };
    this.canvas.addEventListener('touchend', end); this.canvas.addEventListener('touchcancel', end);
  }
}
