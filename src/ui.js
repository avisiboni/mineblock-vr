// ============================================================================
// Mineblock — HUD, icons, inventory panel (DOM)
// ----------------------------------------------------------------------------
// Pure presentation. Game logic calls these to render state; click events are
// forwarded through callbacks so inventory.js decides what happens.
//
//   initIcons(atlas)              must be called once
//   iconFor(key, size)            isometric block icon or flat item icon (cached canvas)
//   renderSlot(el, stack)         draw a stack {item,count,durability?} into a .slot
//   createHUD(root)               crosshair, hotbar, hearts, armor, hunger, tints, toasts
//   createInventoryPanel(root, cb)  survival inventory with 2x2 crafting
//   createCraftingPanel(root, cb)   3x3 crafting table
//   createFurnacePanel(root, cb)
//   showTooltip(x, y, stack) / hideTooltip()
// ============================================================================
import { BLOCKS, ITEMS, faceTile, itemDef } from './blocks.js';
import { paintTile } from './textures.js';

let ATLAS = null;
const iconCache = new Map();
const tileCanvasCache = new Map();
function tileCanvas(name) {
  if (!tileCanvasCache.has(name)) tileCanvasCache.set(name, paintTile(name));
  return tileCanvasCache.get(name);
}
export function initIcons(atlas) { ATLAS = atlas; }

// Isometric cube: top face, left face (west), right face (south), like the
// Minecraft inventory. Faces are shaded to match in-world lighting.
export function blockIcon(key, size = 48) {
  const ck = `b:${key}:${size}`;
  if (iconCache.has(ck)) return iconCache.get(ck);
  const block = BLOCKS[key];
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  if (block.model === 'cross') {
    ctx.drawImage(tileCanvas(faceTile(block, 'top')), 0, 0, size, size);
  } else {
    const S = size, top = tileCanvas(faceTile(block, 'top')), left = tileCanvas(faceTile(block, 'west')), right = tileCanvas(faceTile(block, 'south'));
    const draw = (img, A, B, D, shade) => {
      ctx.save();
      ctx.setTransform((B[0] - A[0]) / 16, (B[1] - A[1]) / 16, (D[0] - A[0]) / 16, (D[1] - A[1]) / 16, A[0], A[1]);
      ctx.drawImage(img, 0, 0, 16, 16);
      if (shade) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = `rgba(0,0,0,${shade})`; ctx.fillRect(0, 0, 16, 16); }
      ctx.restore();
    };
    const m = S * 0.04; // margin
    const w = S - 2 * m, h = S - 2 * m;
    const T = [m + w / 2, m], R = [m + w, m + h / 4], Bt = [m + w / 2, m + h / 2], L = [m, m + h / 4];
    const BL = [m, m + 3 * h / 4], BB = [m + w / 2, m + h], BR = [m + w, m + 3 * h / 4];
    draw(top, L, Bt, T, 0);          // top: A=left, B=bottom(centre), D=top  (unit square rotated)
    draw(left, L, Bt, BL, 0.35);     // west face
    draw(right, Bt, R, BB, 0.2);     // south face
  }
  iconCache.set(ck, c);
  return c;
}
export function itemIcon(key, size = 48) {
  const ck = `i:${key}:${size}`;
  if (iconCache.has(ck)) return iconCache.get(ck);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tileCanvas(ITEMS[key].tile), 0, 0, size, size);
  iconCache.set(ck, c);
  return c;
}
export function iconFor(key, size = 48) { return BLOCKS[key] ? blockIcon(key, size) : itemIcon(key, size); }

export function renderSlot(el, stack) {
  el.innerHTML = '';
  el.classList.toggle('filled', !!stack);
  if (!stack) return;
  const icon = iconFor(stack.item, 48).cloneNode();
  icon.getContext('2d').drawImage(iconFor(stack.item, 48), 0, 0);
  el.appendChild(icon);
  if (stack.count > 1) { const n = document.createElement('span'); n.className = 'count'; n.textContent = stack.count; el.appendChild(n); }
  const def = itemDef(stack.item);
  if (def?.durability && stack.durability !== undefined && stack.durability < def.durability) {
    const d = document.createElement('div'); d.className = 'durability';
    const f = stack.durability / def.durability;
    d.innerHTML = `<i style="width:${f * 100}%;--dur-color:hsl(${f * 120},90%,50%)"></i>`;
    el.appendChild(d);
  }
}

function h(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

// ------------------------------------------------------------------- HUD
export function createHUD(root) {
  const el = h('div', 'hud', root);
  h('div', 'crosshair', el);
  const tints = {};
  ['water', 'lava', 'portal', 'hurt'].forEach((k) => (tints[k] = h('div', `tint ${k}`, el)));
  const heldName = h('div', 'held-name txt-shadow', el);
  const bubbles = h('div', 'bubbles hidden', el);
  const status = h('div', 'status', el);
  const leftCol = h('div', '', status), rightCol = h('div', '', status);
  const armor = h('div', 'armor', leftCol), hearts = h('div', 'hearts', leftCol);
  const hunger = h('div', 'hunger', rightCol);
  leftCol.style.display = rightCol.style.display = 'grid'; leftCol.style.gap = rightCol.style.gap = 'var(--ui)';
  rightCol.style.justifyItems = 'end';
  const xp = h('div', 'xp', el); const xpFill = h('i', '', xp);
  const hotbar = h('div', 'hotbar', el);
  const slots = [];
  for (let i = 0; i < 9; i++) slots.push(h('div', 'slot', hotbar));
  const toast = h('div', 'toast', el);
  const messages = h('div', 'messages', el);
  const debug = h('div', 'debug hidden', el);
  for (let i = 0; i < 10; i++) { h('div', 'heart', hearts); h('div', 'drum', hunger); h('div', 'chest', armor); }
  let nameTimer = 0, toastTimer = 0;
  return {
    el, hotbar, slots, debug,
    setHotbar(stacks, selected) {
      slots.forEach((s, i) => { renderSlot(s, stacks[i]); s.classList.toggle('selected', i === selected); });
    },
    showHeldName(name) {
      heldName.textContent = name || ''; heldName.classList.add('show');
      clearTimeout(nameTimer); nameTimer = setTimeout(() => heldName.classList.remove('show'), 1200);
    },
    setHealth(hp, max = 20) {
      [...hearts.children].forEach((e, i) => {
        const v = hp - i * 2;
        e.classList.toggle('empty', v <= 0); e.classList.toggle('half', v === 1);
      });
    },
    hurt() { [...hearts.children].forEach((e) => { e.classList.remove('hurt'); void e.offsetWidth; e.classList.add('hurt'); }); },
    setHunger(n) { [...hunger.children].forEach((e, i) => e.classList.toggle('empty', n <= i * 2)); },
    setArmor(n) { armor.classList.toggle('hidden', n <= 0); [...armor.children].forEach((e, i) => e.classList.toggle('empty', n <= i * 2)); },
    setXP(frac) { xpFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`; },
    setAir(frac) { bubbles.classList.toggle('hidden', frac >= 1); bubbles.innerHTML = ''; for (let i = 0; i < Math.ceil(frac * 10); i++) h('div', 'bubble', bubbles); },
    setTint(kind, on) { for (const k in tints) tints[k].classList.toggle('on', k === kind && on); },
    toast(msg, ms = 2000) { toast.textContent = msg; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), ms); },
    message(msg) { const m = h('div', '', messages, msg); setTimeout(() => m.remove(), 8000); },
    setDebug(text) { debug.textContent = text; },
    toggleDebug() { debug.classList.toggle('hidden'); },
  };
}

// --------------------------------------------------------------- tooltip
let tipEl = null;
export function showTooltip(x, y, stack) {
  if (!stack) return hideTooltip();
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tooltip'; document.body.appendChild(tipEl); }
  const def = itemDef(stack.item);
  const tier = def.tier >= 4 ? 'rare' : '';
  let html = `<span class="${tier}">${def.name}</span>`;
  if (def.tool) html += `<div class="sub">${def.tool} · tier ${def.tier}${def.damage ? ` · ${def.damage} dmg` : ''}</div>`;
  if (def.durability) html += `<div class="sub">Durability ${stack.durability ?? def.durability} / ${def.durability}</div>`;
  if (def.light) html += `<div class="sub">Light ${def.light}</div>`;
  tipEl.innerHTML = html;
  tipEl.style.left = `${x + 14}px`; tipEl.style.top = `${y - 8}px`;
  tipEl.style.display = 'block';
}
export function hideTooltip() { if (tipEl) tipEl.style.display = 'none'; }

// ------------------------------------------------------------ inventory
// cb(section, index, button, shift) is called on slot clicks.
// Sections: 'main' (27), 'hotbar' (9), 'armor' (4), 'craft' (4 or 9), 'result' (1),
// 'input' / 'fuel' / 'output' for the furnace.
function makeGrid(parent, section, count, cols, cb) {
  const grid = h('div', `grid ${cols === 9 ? '' : cols === 2 ? 'two' : cols === 3 ? 'three' : 'one'}`, parent);
  const slots = [];
  for (let i = 0; i < count; i++) {
    const s = h('div', 'slot', grid);
    s.dataset.section = section; s.dataset.index = i;
    s.addEventListener('mousedown', (e) => { e.preventDefault(); cb?.(section, i, e.button, e.shiftKey); });
    s.addEventListener('contextmenu', (e) => e.preventDefault());
    s.addEventListener('mousemove', (e) => s._stack && showTooltip(e.clientX, e.clientY, s._stack));
    s.addEventListener('mouseleave', hideTooltip);
    slots.push(s);
  }
  return slots;
}
function fill(slots, stacks) { slots.forEach((s, i) => { s._stack = stacks?.[i]; renderSlot(s, stacks?.[i]); }); }

function makeCursor() {
  const c = h('div', 'cursor-item hidden', document.body);
  window.addEventListener('mousemove', (e) => { c.style.left = `${e.clientX - c.offsetWidth / 2}px`; c.style.top = `${e.clientY - c.offsetHeight / 2}px`; });
  return { el: c, set(stack) { c.classList.toggle('hidden', !stack); renderSlot(c, stack); } };
}

export function createInventoryPanel(root, cb) {
  const overlay = h('div', 'overlay hidden', root);
  const panel = h('div', 'panel', overlay);
  const top = h('div', 'inventory-top', panel);
  const armorSlots = makeGrid(top, 'armor', 4, 1, cb);
  armorSlots.forEach((s) => s.classList.add('empty-armor'));
  const doll = h('div', 'paperdoll', top);
  const craftWrap = h('div', '', top);
  h('p', 'section-title', craftWrap, 'Crafting');
  const craft = h('div', 'craft', craftWrap);
  const craftSlots = makeGrid(craft, 'craft', 4, 2, cb);
  h('div', 'arrow', craft);
  const resultSlots = makeGrid(craft, 'result', 1, 1, cb);
  resultSlots[0].classList.add('result');
  h('p', 'section-title', panel, 'Inventory');
  const mainSlots = makeGrid(panel, 'main', 27, 9, cb);
  const hotWrap = h('div', 'hotbar-row', panel);
  const hotSlots = makeGrid(hotWrap, 'hotbar', 9, 9, cb);
  const cursor = makeCursor();
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) cb?.('outside', 0, e.button, e.shiftKey); });
  return {
    el: overlay, doll,
    open() { overlay.classList.remove('hidden'); }, close() { overlay.classList.add('hidden'); hideTooltip(); cursor.set(null); },
    isOpen() { return !overlay.classList.contains('hidden'); },
    render(inv) {
      fill(mainSlots, inv.main); fill(hotSlots, inv.hotbar); fill(armorSlots, inv.armor);
      armorSlots.forEach((s, i) => s.classList.toggle('empty-armor', !inv.armor?.[i]));
      fill(craftSlots, inv.craft); fill(resultSlots, [inv.craftResult]);
      cursor.set(inv.cursor);
    },
  };
}

export function createCraftingPanel(root, cb) {
  const overlay = h('div', 'overlay hidden', root);
  const panel = h('div', 'panel', overlay);
  h('h2', '', panel, 'Crafting');
  const craft = h('div', 'craft', panel);
  const craftSlots = makeGrid(craft, 'craft', 9, 3, cb);
  h('div', 'arrow', craft);
  const resultSlots = makeGrid(craft, 'result', 1, 1, cb);
  resultSlots[0].classList.add('result');
  h('p', 'section-title', panel, 'Inventory').style.marginTop = 'calc(var(--ui) * 4)';
  const mainSlots = makeGrid(panel, 'main', 27, 9, cb);
  const hotSlots = makeGrid(h('div', 'hotbar-row', panel), 'hotbar', 9, 9, cb);
  const cursor = makeCursor();
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) cb?.('outside', 0, e.button, e.shiftKey); });
  return {
    el: overlay,
    open() { overlay.classList.remove('hidden'); }, close() { overlay.classList.add('hidden'); hideTooltip(); cursor.set(null); },
    isOpen() { return !overlay.classList.contains('hidden'); },
    render(inv) { fill(mainSlots, inv.main); fill(hotSlots, inv.hotbar); fill(craftSlots, inv.craft); fill(resultSlots, [inv.craftResult]); cursor.set(inv.cursor); },
  };
}

export function createFurnacePanel(root, cb) {
  const overlay = h('div', 'overlay hidden', root);
  const panel = h('div', 'panel', overlay);
  h('h2', '', panel, 'Furnace');
  const row = h('div', 'craft', panel);
  const col = h('div', '', row); col.style.display = 'grid'; col.style.gap = 'calc(var(--ui)*3)'; col.style.justifyItems = 'center';
  const inputSlots = makeGrid(col, 'input', 1, 1, cb);
  const fire = h('div', 'furnace-fire', col); h('i', '', fire);
  const fuelSlots = makeGrid(col, 'fuel', 1, 1, cb);
  const arrow = h('div', 'arrow progress', row);
  const outputSlots = makeGrid(row, 'output', 1, 1, cb);
  outputSlots[0].classList.add('result');
  h('p', 'section-title', panel, 'Inventory').style.marginTop = 'calc(var(--ui) * 4)';
  const mainSlots = makeGrid(panel, 'main', 27, 9, cb);
  const hotSlots = makeGrid(h('div', 'hotbar-row', panel), 'hotbar', 9, 9, cb);
  const cursor = makeCursor();
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) cb?.('outside', 0, e.button, e.shiftKey); });
  return {
    el: overlay,
    open() { overlay.classList.remove('hidden'); }, close() { overlay.classList.add('hidden'); hideTooltip(); cursor.set(null); },
    isOpen() { return !overlay.classList.contains('hidden'); },
    // furnace: { input, fuel, output, progress 0..1, burn 0..1 }
    render(inv, furnace) {
      fill(mainSlots, inv.main); fill(hotSlots, inv.hotbar);
      fill(inputSlots, [furnace.input]); fill(fuelSlots, [furnace.fuel]); fill(outputSlots, [furnace.output]);
      arrow.style.setProperty('--p', `${(furnace.progress || 0) * 100}%`);
      fire.style.setProperty('--p', `${(furnace.burn || 0) * 100}%`);
      cursor.set(inv.cursor);
    },
  };
}

// Title / pause menus
export function createMenu(root, title, buttons, splash) {
  const overlay = h('div', 'overlay dirt-bg hidden', root);
  const box = h('div', '', overlay);
  const logo = h('div', 'title-logo', box, title);
  if (splash) h('small', '', logo, splash);
  buttons.forEach(([label, fn]) => { const b = h('button', 'btn', box, label); b.addEventListener('click', fn); });
  return { el: overlay, open() { overlay.classList.remove('hidden'); }, close() { overlay.classList.add('hidden'); }, isOpen() { return !overlay.classList.contains('hidden'); } };
}
