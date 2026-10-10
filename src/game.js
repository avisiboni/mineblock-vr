// ============================================================================
// Mineblock — the game: owns the renderer, world, player and every subsystem
// ----------------------------------------------------------------------------
//   const game = new Game(canvas, uiRoot, atlas)
//   game.attachMenus({ pause, death, loading, creative, onQuit })
//   game.startWorld({ seed, name, slot, creative, data? })   data = saved world
//   game.quitToTitle()
// Fixed 60 Hz physics with interpolated rendering; everything else runs per frame.
// ============================================================================
import * as THREE from 'three';
import { BLOCKS, BLOCK_LIST, ITEMS, itemDef, isBlockItem, maxStack } from './blocks.js';
import { World } from './world.js';
import { SEA } from './worldgen.js';
import { SOLID, OPAQUE, LIQUID } from './tables.js';
import { makeMaterials, updateAnimated, disposeMeshes } from './chunkmesh.js';
import { ChunkManager } from './streaming.js';
import { Sky, DAY_LENGTH } from './sky.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Particles, DroppedItems, FallingBlocks } from './entities.js';
import { Interaction } from './interact.js';
import { Mobs } from './mobs.js';
import { Portals } from './portal.js';
import { EndPortals } from './end.js';
import { Beds } from './beds.js';
import { Simulation } from './sim.js';
import { CameraRig, ViewModel } from './view.js';
import { Inventory } from './inventory.js';
import { FUEL, SMELT, SMELT_TIME, newFurnace } from './furnace.js';
import { initIcons, createHUD, createInventoryPanel, createCraftingPanel, createFurnacePanel } from './ui.js';
import { buildCharacter, animateCharacter } from './characters.js';
import { saveGame, serialize, applyToWorld } from './save.js';
import { sfx } from './sfx.js';
import { XRSupport } from './xr.js';

const STEP = 1 / 60;
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class Game {
  constructor(canvas, ui, atlas) {
    this.canvas = canvas; this.ui = ui; this.atlas = atlas;
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 999);
    this.scene = new THREE.Scene(); this.scene.fog = new THREE.Fog(0xa9d0ff, 50, 120);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 700);
    this.mats = makeMaterials(atlas);
    this.chunks = new ChunkManager(this.scene, atlas, this.mats);
    this.sky = new Sky(this.scene, this.camera);
    this.input = new Input(canvas);
    initIcons(atlas);
    this.hud = createHUD(ui); this.hud.el.classList.add('hidden');
    this.inv = new Inventory();
    this.player = new Player();
    this.particles = new Particles(this.scene, atlas, this.mats.texture);
    this.drops = new DroppedItems(this.scene, atlas, this.mats);
    this.falling = new FallingBlocks(this.scene, atlas, this.mats);
    this.interact = new Interaction(this);
    this.mobs = new Mobs(this);
    this.portals = new Portals(this);
    this.end = new EndPortals(this);
    this.beds = new Beds(this);
    this.sim = new Simulation(this);
    this.cams = new CameraRig(this);
    this.viewmodel = new ViewModel(this);
    this.xr = new XRSupport(this);
    this._eye = new THREE.Vector3();

    // state
    this.playing = false; this.paused = false; this.loading = false; this.panelOpen = null;
    this.camMode = 'fp'; this.creative = false; this.renderDist = this.isTouch ? 5 : 8;
    this.time = 60; this.shake = 0; this.hurtRoll = 0; this.clipY = 999; this.sound = true;
    this.world = null; this.dim = null; this.dimName = 'overworld'; this.slot = null; this.worldName = ''; this.created = 0;
    this.menus = {}; this.expectUnlock = 0; this.acc = 0; this.last = 0; this.saveT = 0; this.fps = 0; this._fc = 0; this._ft = 0;
    this.tintKind = null; this.hurtTint = 0; this.lastHud = {};
    this.furnaceTE = null; this.furnaceKey = null;

    this._buildPanels();
    this._bindInput();
    this._buildPlayerCallbacks();
    this.hint = document.createElement('div');
    this.hint.style.cssText = 'position:fixed;left:50%;top:22%;transform:translateX(-50%);width:max-content;max-width:min(86vw,560px);box-sizing:border-box;color:#fff;font:10px/1.9 "Press Start 2P",monospace;text-shadow:2px 2px #000;pointer-events:none;display:none;text-align:center;background:rgba(0,0,0,.55);padding:10px 14px;z-index:5';
    this.hint.textContent = 'Click to play'; ui.appendChild(this.hint);
    addEventListener('resize', () => this.resize()); this.resize();
    addEventListener('pagehide', () => this.save()); addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.save(); if (this.playing && !this.paused && !this.panelOpen) this.pause(); } });
    this.renderer.setAnimationLoop((t) => this.frame(t));   // drives both the flat page and the VR headset
  }

  attachMenus(m) { this.menus = m; }
  resize() { const w = innerWidth, h = innerHeight; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  get held() { return this.inv.held; }

  // ------------------------------------------------------------ panels
  _buildPanels() {
    const ui = this.ui;
    this.invPanel = createInventoryPanel(ui, (s, i, b, sh) => { this.inv.click(s, i, b, sh); this.afterInv(); });
    this.craftPanel = createCraftingPanel(ui, (s, i, b, sh) => { this.inv.click(s, i, b, sh); this.afterInv(); });
    this.furnacePanel = createFurnacePanel(ui, (s, i, b, sh) => { this.furnaceClick(s, i, b, sh); this.afterInv(); });
    this.inv.drop = (stack) => {
      const p = this.player, f = [-Math.sin(p.yaw), -Math.cos(p.yaw)];
      this.drops.spawn(stack.item, stack.count, p.x + f[0] * 0.6, p.y + 1.3, p.z + f[1] * 0.6, f[0] * 4, 2, f[1] * 4, stack.durability !== undefined ? { durability: stack.durability } : {});
    };
    for (const pnl of [this.invPanel, this.craftPanel, this.furnacePanel]) pnl.el.addEventListener('dblclick', () => this.gatherCursor());
    // paper doll
    this.doll = null;
  }
  _ensureDoll() {
    if (this.doll) return;
    const r = new THREE.WebGLRenderer({ alpha: true, antialias: false }); r.setSize(120, 180); r.outputColorSpace = THREE.SRGBColorSpace;
    const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 120 / 180, 0.1, 10); cam.position.set(0, 1, 4.2); cam.lookAt(0, 0.95, 0);
    sc.add(new THREE.AmbientLight(0xffffff, 1.2)); const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(1, 2, 3); sc.add(dl);
    const rig = buildCharacter(THREE, 'player'); rig.group.rotation.y = 0.35; sc.add(rig.group);
    this.invPanel.doll.appendChild(r.domElement);
    this.doll = { r, sc, cam, rig };
  }
  get activePanel() { return { inv: this.invPanel, craft: this.craftPanel, furnace: this.furnacePanel, creative: this.menus.creative }[this.panelOpen]; }

  afterInv() {
    const inv = this.inv;
    if (this.panelOpen === 'inv') this.invPanel.render(inv);
    else if (this.panelOpen === 'craft') this.craftPanel.render(inv);
    else if (this.panelOpen === 'furnace') this.renderFurnace();
    else if (this.panelOpen === 'creative') this.menus.creative.render(inv);
    this.refreshHotbar();
  }
  renderFurnace() {
    const te = this.furnaceTE; if (!te) return;
    this.furnacePanel.render(this.inv, { input: te.input, fuel: te.fuel, output: te.output, progress: te.progress / SMELT_TIME, burn: te.burnMax ? te.burn / te.burnMax : 0 });
  }
  furnaceClick(section, idx, button, shift) {
    const te = this.furnaceTE, inv = this.inv; if (!te) return;
    if (shift && (section === 'main' || section === 'hotbar')) {
      const arr = inv[section], s = arr[idx];
      if (s) {
        const target = SMELT[s.item] ? 'input' : FUEL[s.item] ? 'fuel' : null;
        if (target && (!te[target] || te[target].item === s.item)) {
          const room = 64 - (te[target]?.count || 0), n = Math.min(room, s.count);
          if (n > 0) { te[target] = { item: s.item, count: (te[target]?.count || 0) + n }; s.count -= n; if (s.count <= 0) arr[idx] = null; return; }
        }
      }
    }
    if (section === 'output') {
      if (!te.output) return;
      if (shift) { const left = inv.add(te.output.item, te.output.count); te.output = left ? { ...te.output, count: left } : null; return; }
      if (!inv.cursor) { inv.cursor = te.output; te.output = null; }
      else if (inv.cursor.item === te.output.item && inv.cursor.count + te.output.count <= 64) { inv.cursor.count += te.output.count; te.output = null; }
      return;
    }
    if (section === 'input' || section === 'fuel') {
      if (inv.cursor && section === 'fuel' && !FUEL[inv.cursor.item]) return;
      if (inv.cursor && section === 'input' && !SMELT[inv.cursor.item]) return;
      inv[section] = [te[section]]; inv.click(section, 0, button, shift); te[section] = inv[section][0] ?? null; delete inv[section];
      return;
    }
    inv.click(section, idx, button, shift);
  }

  openPanel(kind) {
    if (this.panelOpen || !this.playing || this.paused) return;
    this.panelOpen = kind; this.hint.style.display = 'none';
    if (kind === 'inv') { this.inv.setCraftSize(4); this._ensureDoll(); }
    else if (kind === 'craft') this.inv.setCraftSize(9);
    this.afterInv();
    this.activePanel.open();
    this.unlockForUI();
  }
  closePanel() {
    if (!this.panelOpen) return;
    if (this.panelOpen === 'vr') { this.xr.inv.close(); return; }
    const p = this.activePanel, kind = this.panelOpen;
    p.close(); this.panelOpen = null;
    if (kind === 'inv' || kind === 'craft') this.inv.setCraftSize(4);
    if (this.inv.cursor) { const c = this.inv.cursor; this.inv.cursor = null; const left = this.inv.add(c.item, c.count); if (left) this.inv.drop({ ...c, count: left }); }
    this.furnaceTE = null;
    this.refreshHotbar();
    if (this.camMode === 'fp' && !this.isTouch) this.input.lock();
  }
  openInventory() { this.openPanel(this.creative ? 'creative' : 'inv'); }
  openStation(kind, t) {
    const vr = this.xr.active;   // in the headset, stations open the floating VR panel instead of the page UI
    if (kind === 'bed') this.beds.use(t);
    else if (kind === 'crafting') { if (vr) this.xr.inv.open('craft'); else this.openPanel('craft'); }
    else if (kind === 'furnace') {
      const k = `${t.x},${t.y},${t.z}`;
      if (!this.dim.tiles.has(k)) this.dim.tiles.set(k, newFurnace());
      this.furnaceTE = this.dim.tiles.get(k); this.furnaceKey = k;
      if (vr) this.xr.inv.open('furnace'); else this.openPanel('furnace');
    }
  }
  unlockForUI() { if (this.input.locked) { this.expectUnlock++; this.input.unlock(); } }

  refreshHotbar() {
    const inv = this.inv;
    this.hud.setHotbar(inv.hotbar, inv.selected);
    const held = inv.held;
    const key = held ? held.item : '';
    if (key !== this._heldKey) { this._heldKey = key; this.hud.showHeldName(held ? itemDef(held.item).name : ''); }
    this.viewmodel.setHeld(held);
    if (this.panelOpen === 'creative') this.menus.creative.render(inv);
  }
  giveCreative(item, n) {
    const max = isBlockItem(item) ? 64 : ITEMS[item].stack || 64;
    const left = this.inv.add(item, Math.min(n, max));
    if (left === Math.min(n, max)) this.hud.toast('Inventory full', 800);
    this.afterInv();
  }
  addXP(v) { const p = this.player; p.xp = (p.xp + v) % 1; }

  // ------------------------------------------------------------ input bindings
  _bindInput() {
    const inp = this.input;
    inp.onKey((code) => {
      if (this.hint.style.display !== 'none' && /^(Key[WASD]|Arrow|Space)/.test(code)) this.hint.style.display = 'none';
      if (!this.playing || this.loading) return;
      if (code === 'Escape') { if (this.panelOpen) this.closePanel(); else if (!this.paused && !this.player.dead) this.pause(); return; }
      if (this.paused || this.player.dead) return;
      if (this.panelOpen && code.startsWith('Digit')) { this.hoverSwap(+code.slice(5) - 1); return; }
      if (code === 'KeyE') { if (this.panelOpen) this.closePanel(); else this.openInventory(); return; }
      if (code === 'F3') { this.hud.toggleDebug(); return; }
      if (code === 'F5') { this.cams.setMode(this.camMode === 'fp' ? 'top' : 'fp'); this.hud.toast(this.camMode === 'fp' ? 'First person' : 'Top-down view', 900); return; }
      if (this.panelOpen) return;
      if (code.startsWith('Digit')) { const n = +code.slice(5); if (n >= 1 && n <= 9) { this.inv.selected = n - 1; this.refreshHotbar(); } }
      if (code === 'KeyQ') { const s = this.inv.held; if (s) { const n = inp.held('ControlLeft') ? s.count : 1; this.inv.drop({ ...s, count: n }); s.count -= n; if (s.count <= 0) this.inv.hotbar[this.inv.selected] = null; this.refreshHotbar(); } }
    });
    inp.onLock((locked, failed) => {
      if (locked) { this.hint.style.display = 'none'; return; }
      if (failed) { this.hint.textContent = 'Look: arrow keys (or hold Alt + move mouse)'; this.hint.style.display = 'block'; clearTimeout(this._hintT); this._hintT = setTimeout(() => (this.hint.style.display = 'none'), 4000); return; }
      if (this.expectUnlock > 0) { this.expectUnlock--; return; }
      if (this.playing && !this.paused && !this.panelOpen && !this.loading && this.camMode === 'fp' && !this.player.dead) this.pause();
    });
    this.canvas.addEventListener('mousedown', () => {
      sfx.unlock();
      if (this.playing && !this.paused && !this.panelOpen && !this.loading && this.camMode === 'fp' && !inp.locked && !inp.lockFailed && !this.isTouch) inp.lock();
    });
  }
  // Number key while hovering an inventory slot: swap that stack with hotbar slot n.
  hoverSwap(n) {
    if (n < 0 || n > 8) return;
    const el = document.elementFromPoint(this.input.mouse.x, this.input.mouse.y)?.closest?.('.slot');
    const section = el?.dataset?.section; if (section !== 'main' && section !== 'hotbar') return;
    const arr = this.inv[section], i = +el.dataset.index, hot = this.inv.hotbar;
    [arr[i], hot[n]] = [hot[n], arr[i]];
    this.afterInv();
  }
  // Double-click with an item on the cursor: pull every matching stack into it.
  gatherCursor() {
    const c = this.inv.cursor; if (!c || c.durability !== undefined) return;
    const max = maxStack(c.item);
    for (const arr of [this.inv.hotbar, this.inv.main]) for (let i = 0; i < arr.length && c.count < max; i++) {
      const s = arr[i]; if (!s || s.item !== c.item) continue;
      const n = Math.min(max - c.count, s.count); c.count += n; s.count -= n; if (s.count <= 0) arr[i] = null;
    }
    this.afterInv();
  }
  _buildPlayerCallbacks() {
    const p = this.player;
    p.onHurt = (n, why) => { this.hud.hurt(); this.hurtTint = 0.3; this.shake = 1; this.hurtRoll = (Math.random() < 0.5 ? -1 : 1) * 0.05; sfx.play('hurt'); };
    p.onLand = (f) => sfx.play('place', 0.5);
    p.onSplash = () => sfx.play('splash');
  }

  // ------------------------------------------------------------ pause / death
  pause() {
    if (!this.playing || this.paused || this.xr.active) return;
    this.paused = true; this.expectUnlock = 0; this.input.unlock(); this.hint.style.display = 'none';
    this.menus.pause?.open(); sfx.portalHum(false);
  }
  resume() {
    this.paused = false; this.menus.pause?.close(); this.last = performance.now();
    if (this.camMode === 'fp' && !this.isTouch) this.input.lock();
  }
  toggleCreative() { this.creative = !this.creative; if (!this.creative) this.player.flying = false; this.afterInv(); this.hud.toast(this.creative ? 'Creative mode' : 'Survival mode', 1200); }
  setRenderDist(d) { this.renderDist = d; }
  setSound(on) { this.sound = on; sfx.setEnabled(on); }
  respawn() {
    const p = this.player; p.dead = false; p.hp = 20; p.hunger = 20; p.air = 10; p.fall = 0; p.invuln = 2; p.vx = p.vy = p.vz = 0;
    this.menus.death?.close();
    if (this.dimName !== 'overworld') this.switchDimension('overworld', 0, 0, 0, true, 'spawn');
    else { const s = this.spawnArrival(this.dim); p.teleport(s.x, s.y, s.z); }
    this.mobs.clear(); this.loading = true; this.menus.loading?.open('Respawning…');
    if (this.camMode === 'fp' && !this.isTouch) this.input.lock();
  }

  // ------------------------------------------------------------ world lifecycle
  startWorld({ seed, name, slot, creative, data }) {
    this.teardown();
    this.world = new World(data ? data.seed : seed);
    if (data) applyToWorld(this.world, data);
    for (const d of Object.values(this.world.dims)) this.sim.attach(d);
    this.slot = slot; this.worldName = name; this.created = data?.created || Date.now();
    this.creative = data ? !!data.creative : !!creative;
    this.time = data?.time ?? 60; this.renderDist = data?.renderDist || this.renderDist;
    this.inv = new Inventory();
    if (data?.inv) { const j = Inventory.fromJSON(data.inv); Object.assign(this.inv, { main: j.main, hotbar: j.hotbar, armor: j.armor, selected: j.selected }); }
    this.inv.drop = (s) => this._dropFromInv(s);
    this._rebindInv();
    const p = this.player; p.dead = false; p.hp = data?.player?.hp ?? 20; p.hunger = data?.player?.hunger ?? 20; p.xp = data?.player?.xp ?? 0; p.air = 10; p.fall = 0; p.flying = false; p.invuln = 1;
    this.dimName = data?.dim || 'overworld'; this.dim = this.world.dims[this.dimName];
    this.chunks.setDimension(this.dim);
    if (data) {
      p.teleport(data.player.x, data.player.y, data.player.z); p.yaw = data.player.yaw; p.pitch = data.player.pitch; p.spawn = data.player.spawn || p.spawn;
      const ws = data.player.worldSpawn || p.spawn; p.worldSpawn = { x: ws.x, y: ws.y, z: ws.z };
    } else {
      const s = this.findSpawn(); p.teleport(s.x, s.y, s.z); p.spawn = { ...s }; p.worldSpawn = { ...s }; p.yaw = 0; p.pitch = 0;
    }
    this.cams.setMode(data?.camMode === 'top' ? 'top' : 'fp');
    this.playing = true; this.paused = false; this.panelOpen = null; this.loading = true; this.saveT = 0;
    this.hud.el.classList.remove('hidden');
    this.menus.loading?.open('Generating world…');
    this.acc = 0; this.last = performance.now();
    this.refreshHotbar(); this._heldKey = this.inv.held?.item || '';
    this.hud.setHealth(p.hp); this.hud.setHunger(p.hunger);
    this.lastHud = {};
  }
  _rebindInv() { /* panels read this.inv on each render, nothing cached */ }
  _dropFromInv(stack) { const p = this.player, f = [-Math.sin(p.yaw), -Math.cos(p.yaw)]; this.drops.spawn(stack.item, stack.count, p.x + f[0] * 0.6, p.y + 1.3, p.z + f[1] * 0.6, f[0] * 4, 2, f[1] * 4, stack.durability !== undefined ? { durability: stack.durability } : {}); }

  findSpawn() {
    const dim = this.world.dims.overworld;
    for (let r = 0; r <= 160; r += 16) for (let a = 0; a < (r ? 8 : 1); a++) {
      const x = Math.round(Math.cos(a * Math.PI / 4) * r), z = Math.round(Math.sin(a * Math.PI / 4) * r);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) dim.ensureChunk((x >> 4) + dx, (z >> 4) + dz);
      const y = dim.highest(x, z);
      if (y > SEA && OPAQUE[dim.getId(x, y, z)]) return { x: x + 0.5, y: y + 1, z: z + 0.5 };
    }
    return { x: 0.5, y: 90, z: 0.5 };
  }

  // how: 'portal' (find/build a nether portal), 'end' (obsidian platform in the End), 'spawn' (bed or world spawn)
  switchDimension(name, x, y, z, silentLoad, how = 'portal') {
    const p = this.player;
    this.dimName = name; this.dim = this.world.dims[name];
    this.chunks.setDimension(this.dim);
    this.mobs.clear(); this.drops.clear(); this.particles.clear(); this.falling.clear(); this.sim.clear(); this.end.clear();
    const pos = how === 'spawn' ? this.spawnArrival(this.dim) : how === 'end' ? this.end.arrive(this.dim) : this.portals.arrive(this.dim, x, y, z);
    p.teleport(pos.x, pos.y, pos.z); if (pos.yaw !== undefined) p.yaw = pos.yaw;
    p.vx = p.vy = p.vz = 0; p.fall = 0;
    this.loading = true; if (!silentLoad) this.menus.loading?.open(name === 'nether' ? 'Entering the Nether…' : name === 'end' ? 'Entering the End…' : 'Returning to the Overworld…');
    this.save();
  }
  // Overworld respawn position: the bed if it still exists, otherwise the world spawn
  spawnArrival(dim) {
    const p = this.player, b = p.spawn.bed;
    if (b) {
      dim.ensureChunk(b.x >> 4, b.z >> 4);
      const k = dim.getBlock(b.x, b.y, b.z);
      if (k !== 'bed_foot' && k !== 'bed_head') { p.spawn = { ...p.worldSpawn }; this.hud.toast('Your bed was missing', 2000); }
    }
    return { x: p.spawn.x, y: p.spawn.y, z: p.spawn.z };
  }

  teardown() {
    this.mobs.clear(); this.drops.clear(); this.particles.clear(); this.falling.clear(); this.sim.clear(); this.end?.clear();
    this.chunks.clear(); this.closePanelSilently(); sfx.portalHum(false);
    this.hud.setTint('none', false);
  }
  closePanelSilently() { if (this.panelOpen === 'vr') this.xr.inv.close(); if (this.panelOpen) { this.activePanel?.close(); this.panelOpen = null; } }

  save() { if (this.playing && this.world && this.slot != null && !this.loading) saveGame(this); }
  quitToTitle() {
    this.save(); this.playing = false; this.paused = false; this.input.unlock();
    this.teardown(); this.hud.el.classList.add('hidden'); this.hint.style.display = 'none';
    this.menus.pause?.close(); this.menus.death?.close(); this.menus.loading?.close();
    this.renderer.clippingPlanes = [];
    this.menus.onQuit?.();
  }

  // ------------------------------------------------------------ frame
  frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - (this.last || now)) / 1000)); this.last = now;
    const inp = this.input, p = this.player;
    this._fc++; this._ft += dt; if (this._ft >= 0.5) { this.fps = Math.round(this._fc / this._ft); this._fc = 0; this._ft = 0; }

    if (!this.playing) { this.renderer.render(this.scene, this.camera); inp.endFrame(); return; }

    const running = !this.paused;
    this.xr.update(dt);
    if (this.loading) { this.stepLoading(); }
    else if (running) this.stepGame(dt, now / 1000);

    // view + render (also while paused so the menu has a world behind it)
    this.cams.update(running && !this.loading ? dt : 0, running ? this.acc / STEP : 1, now / 1000);
    this.viewmodel.update(running ? dt : 0, now / 1000);
    const eye = this.camera.getWorldPosition(this._eye);
    this.sky.update({ dim: this.dimName, time: this.time, camPos: eye, renderDist: this.renderDist, eyeMedium: p.eyeMedium });
    if (this.camMode === 'top') { this.clipY = Math.floor(p.y) + 3.0; this.clipPlane.constant = this.clipY; this.renderer.clippingPlanes = [this.clipPlane]; }
    else if (this.renderer.clippingPlanes.length) this.renderer.clippingPlanes = [];
    updateAnimated(this.mats, now / 1000);
    if (this.panelOpen === 'inv' && this.doll) this.renderDoll(now / 1000);
    if (this.panelOpen === 'furnace') this.renderFurnace();
    this.renderer.render(this.scene, this.camera);
    inp.endFrame();
  }

  stepLoading() {
    const p = this.player;
    this.chunks.update(p.x, p.z, this.renderDist, 45);
    const R = 2, cx = Math.floor(p.x) >> 4, cz = Math.floor(p.z) >> 4; let ok = 0, n = 0;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) { n++; const c = this.dim.chunk(cx + dx, cz + dz); if (c && c.firstMesh && !c.dirty) ok++; }
    this.menus.loading?.progress(ok / n);
    if (ok === n) {
      this.loading = false; this.menus.loading?.close(); this.last = performance.now(); this.acc = 0;
      // stand on the ground: lift out of any block we were teleported into
      if (!this.player.dead) { let guard = 0; while (SOLID[this.dim.getId(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))] && guard++ < 100) p.y += 1; p.px = p.x; p.py = p.y; p.pz = p.z; }
      if (this.camMode === 'fp' && !this.isTouch && !this.input.locked) { this.input.lock(); setTimeout(() => { if (!this.input.active && this.playing && !this.paused && !this.panelOpen && this.camMode === 'fp') this.hint.style.display = 'block'; }, 400); }
    }
  }

  stepGame(dt, t) {
    const inp = this.input, p = this.player, dim = this.dim;
    this.time += dt; this.shake = Math.max(0, this.shake - dt * 4); this.hurtRoll *= 0.9;
    const canLook = !this.panelOpen && !p.dead;
    // look / facing
    if (canLook && this.camMode === 'fp' && (inp.active || this.isTouch)) {
      p.yaw -= inp.mouse.dx * 0.0022; p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - inp.mouse.dy * 0.0022));
      // fallback look for browsers that refuse pointer lock: arrow keys
      const ax = (inp.held('ArrowLeft') ? 1 : 0) - (inp.held('ArrowRight') ? 1 : 0), ay = (inp.held('ArrowUp') ? 1 : 0) - (inp.held('ArrowDown') ? 1 : 0);
      p.yaw += ax * dt * 2.4; p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch + ay * dt * 1.8));
    } else if (canLook && this.camMode === 'top') {
      let tx = null;
      const tg = this.interact.target;
      if (tg && (inp.buttons[0] || inp.buttons[2])) tx = Math.atan2(-(tg.x + 0.5 - p.x), -(tg.z + 0.5 - p.z));
      else { const fwd = (inp.held('KeyW') ? 1 : 0) - (inp.held('KeyS') ? 1 : 0), str = (inp.held('KeyD') ? 1 : 0) - (inp.held('KeyA') ? 1 : 0); if (fwd || str) tx = Math.atan2(-str, fwd); }
      if (tx !== null) p.yaw += angDiff(p.yaw, tx) * Math.min(1, dt * 14);
    }
    if (!this.panelOpen) {
      if (inp.wheel) { if (this.camMode === 'top') this.cams.wheel(inp.wheel); else { this.inv.selected = (this.inv.selected + inp.wheel + 9) % 9; this.refreshHotbar(); } }
    }
    p.handleKeys(inp, t, this.creative);
    // fixed-step physics
    this.acc += dt; let steps = 0;
    while (this.acc >= STEP && steps < 6) {
      p.tick(STEP, { dim, input: inp, camMode: this.camMode, creative: this.creative, allowInput: !this.panelOpen && !this.paused && !p.dead && (inp.active || this.camMode === 'top' || this.isTouch) });
      this.acc -= STEP; steps++;
    }
    if (steps === 6) this.acc = 0;
    // subsystems
    this.interact.update(dt);
    this.sim.update(dt);
    this.portals.update(dt);
    this.end.update(dt);
    this.beds.update(dt);
    this.mobs.update(dt, t);
    this.drops.update(dt, dim, p, this.inv, (item, n) => { sfx.play('pop', 0.8 + Math.random() * 0.5); this.refreshHotbar(); this.hud.message(`+${n} ${itemDef(item).name}`); }, this.sky.dayFactor);
    this.falling.update(dt, dim, (key, x, y, z) => this.drops.spawn(key, 1, x + 0.5, y + 0.5, z + 0.5));
    this.particles.update(dt, this.camera);
    this.streamAndEffects(dt, t);
    this.updateHud(dt);
    if (p.dead && !this.menus.death?.isOpen()) { this.input.unlock(); this.closePanelSilently(); this.menus.death?.open(); }
    this.saveT += dt; if (this.saveT > 30) { this.saveT = 0; this.save(); }
  }

  streamAndEffects(dt, t) {
    const p = this.player;
    this.chunks.update(p.x, p.z, this.renderDist, 7);
    // torch flames near the player (cheap: only sampled blocks in view)
    this._flameT = (this._flameT || 0) - dt;
    if (this._flameT <= 0) {
      this._flameT = 0.25;
      const dim = this.dim, px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
      for (let i = 0; i < 60; i++) {
        const x = px + ((Math.random() * 25) | 0) - 12, y = py + ((Math.random() * 13) | 0) - 4, z = pz + ((Math.random() * 25) | 0) - 12;
        const id = dim.getId(x, y, z);
        if (BLOCK_LIST[id] === 'torch') this.particles.flame(x + 0.5, y + 0.75, z + 0.5);
        else if (BLOCK_LIST[id] === 'nether_portal' && Math.random() < 0.3) this.particles.portal(x + Math.random(), y + Math.random(), z + Math.random(), x + 0.5, y + 0.5, z + 0.5);
        else if (BLOCK_LIST[id] === 'lava' && Math.random() < 0.05 && dim.getId(x, y + 1, z) === 0) this.particles.add(x + Math.random(), y + 1.05, z + Math.random(), 0, 1.5, 0, 0.6, 0.06, 'lava', 4, 4, 2, 6, 1);
      }
    }
  }

  updateHud(dt) {
    const hud = this.hud, p = this.player, L = this.lastHud;
    if (L.hp !== p.hp) { hud.setHealth(p.hp); L.hp = p.hp; }
    if (L.hunger !== p.hunger) { hud.setHunger(p.hunger); L.hunger = p.hunger; }
    const air = Math.ceil(p.air) / 10; if (L.air !== air) { hud.setAir(air); L.air = air; }
    if (L.xp !== p.xp) { hud.setXP(p.xp); L.xp = p.xp; }
    if (L.armor === undefined) { hud.setArmor(0); L.armor = 0; }
    // screen tint priority: hurt > portal > lava > water
    this.hurtTint = Math.max(0, this.hurtTint - dt);
    const kind = this.hurtTint > 0 ? 'hurt' : this.portals.progress > 0.02 ? 'portal' : p.eyeMedium === 'lava' ? 'lava' : p.eyeMedium === 'water' ? 'water' : null;
    if (kind !== this.tintKind) { this.tintKind = kind; hud.setTint(kind || 'none', !!kind); }
    if (hud.debug && !hud.debug.classList.contains('hidden')) {
      const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
      const c = this.dim.chunkAt(x, z);
      hud.setDebug(`Mineblock  ${this.fps} fps\nXYZ ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}\nChunk ${x >> 4}, ${z >> 4}  loaded ${this.chunks.stats.chunks}  dirty ${this.chunks.stats.dirty}\nDim ${this.dimName}  Cam ${this.camMode}  ${this.creative ? 'Creative' : 'Survival'}${p.flying ? ' (flying)' : ''}\nLight sky ${this.dim.getSky(x, y + 1, z)} block ${this.dim.getBlockLight(x, y + 1, z)}\nTime ${(this.time / DAY_LENGTH * 24 % 24).toFixed(1)}h  Mobs ${this.mobs.list.length}  Items ${this.drops.list.length}\nStanding on ${p.ground}${p.inWater ? '  [swimming]' : ''}\nTarget ${this.interact.target ? BLOCK_LIST[this.interact.target.id] : '-'}`);
    }
  }

  renderDoll(t) {
    const d = this.doll, el = this.invPanel.doll.getBoundingClientRect();
    const mx = this.input.mouse.x - (el.left + el.width / 2), my = this.input.mouse.y - (el.top + el.height * 0.25);
    d.rig.group.rotation.y = Math.max(-0.7, Math.min(0.7, mx / 500));
    animateCharacter(d.rig, t, { speed: 0, headYaw: Math.max(-0.9, Math.min(0.9, mx / 260)), headPitch: Math.max(-0.5, Math.min(0.5, my / 400)) });
    d.r.render(d.sc, d.cam);
  }
}
