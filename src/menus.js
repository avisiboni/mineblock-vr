// ============================================================================
// Mineblock — full-screen menus (DOM): title, world list, new world, pause,
// death, loading, and the creative item palette.
// Each factory returns { el, open(), close(), isOpen(), ...extras }.
// ============================================================================
import { BLOCKS, ITEMS, CREATIVE_ORDER, itemDef } from './blocks.js';
import { renderSlot, showTooltip, hideTooltip } from './ui.js';

function h(tag, cls, parent, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; if (parent) parent.appendChild(e); return e; }
function screen(root, extra = '') {
  const el = h('div', `overlay dirt-bg hidden ${extra}`, root);
  const col = h('div', 'menu-col', el);
  return { el, col, open() { el.classList.remove('hidden'); }, close() { el.classList.add('hidden'); }, isOpen() { return !el.classList.contains('hidden'); } };
}
const btn = (parent, label, fn, cls = '') => { const b = h('button', `btn ${cls}`, parent, label); b.addEventListener('click', (e) => { e.stopPropagation(); fn(e); }); return b; };

export function createTitleMenu(root, { onSingle, onShowcase }) {
  const s = screen(root);
  const SPLASH = ['Now with 100% more blocks!', 'Also try the Nether!', 'Diamonds are forever', 'Watch out for lava', 'Procedurally painted!', 'Mind the creeper… wait, no creepers', 'Pig-approved'];
  const logo = h('div', 'title-logo', s.col, 'MINEBLOCK');
  h('small', '', logo, SPLASH[(Math.random() * SPLASH.length) | 0]);
  btn(s.col, 'Singleplayer', onSingle); btn(s.col, 'Design Showcase', onShowcase);
  h('div', 'hint', s.col, 'WASD move · Space jump · E inventory · F5 camera · F3 debug');
  return s;
}

export function createWorldList(root, { onPlay, onNew, onDelete, onBack }) {
  const s = screen(root);
  h('h2', '', s.col, 'Select World');
  const list = h('div', '', s.col);
  btn(s.col, 'Back', onBack);
  s.render = (slots) => {
    list.innerHTML = '';
    slots.forEach((info, i) => {
      const row = h('div', 'world-row', list);
      if (info) {
        const b = btn(row, info.name, () => onPlay(i)); const sm = h('small', '', b, `${info.creative ? 'Creative' : 'Survival'} · ${info.dim} · ${new Date(info.played).toLocaleString()}`);
        btn(row, 'Delete', () => { if (confirm(`Delete world "${info.name}"? This cannot be undone.`)) onDelete(i); }, 'del');
      } else { const b = btn(row, `Empty slot ${i + 1}`, () => onNew(i)); h('small', '', b, 'Click to create a new world'); }
    });
  };
  return s;
}

export function createNewWorld(root, { onCreate, onBack }) {
  const s = screen(root);
  h('h2', '', s.col, 'New World');
  const f1 = h('label', 'field', s.col, 'World name'); const name = h('input', '', f1); name.value = 'New World'; name.maxLength = 24;
  const f2 = h('label', 'field', s.col, 'Seed (leave blank for random)'); const seed = h('input', '', f2); seed.maxLength = 24;
  const chips = h('div', 'chips', s.col);
  let creative = false;
  const mode = btn(chips, 'Mode: Survival', () => { creative = !creative; mode.textContent = `Mode: ${creative ? 'Creative' : 'Survival'}`; }, 'small');
  btn(s.col, 'Create World', () => onCreate({ name: name.value.trim() || 'New World', seed: seed.value.trim(), creative, slot: s.slot }));
  btn(s.col, 'Cancel', onBack);
  s.setSlot = (i) => { s.slot = i; name.value = `World ${i + 1}`; seed.value = ''; };
  return s;
}

export function createPauseMenu(root, { onResume, onCamera, onDistance, onCreative, onSound, onQuit, getState }) {
  const s = screen(root);
  h('h2', '', s.col, 'Game Menu');
  btn(s.col, 'Back to Game', onResume);
  const cam = btn(s.col, '', onCamera), dist = btn(s.col, '', onDistance), cre = btn(s.col, '', onCreative), snd = btn(s.col, '', onSound);
  btn(s.col, 'Save & Quit to Title', onQuit);
  s.refresh = () => {
    const st = getState();
    cam.textContent = `Camera: ${st.camMode === 'fp' ? 'First Person' : 'Top-Down'}`;
    dist.textContent = `Render Distance: ${st.renderDist}`;
    cre.textContent = `Creative Mode: ${st.creative ? 'ON' : 'OFF'}`;
    snd.textContent = `Sound: ${st.sound ? 'ON' : 'OFF'}`;
  };
  const open = s.open; s.open = () => { s.refresh(); open(); };
  return s;
}

export function createDeathScreen(root, { onRespawn, onQuit }) {
  const s = screen(root, 'death');
  h('div', 'title-logo', s.col, 'You Died!');
  btn(s.col, 'Respawn', onRespawn); btn(s.col, 'Save & Quit to Title', onQuit);
  return s;
}

export function createLoading(root) {
  const el = h('div', 'loading-screen dirt-bg hidden', root);
  const t = h('div', '', el, 'Generating world…'); const bar = h('div', 'loading-bar', el); const fill = h('i', '', bar);
  return { el, open(msg) { if (msg) t.textContent = msg; el.classList.remove('hidden'); }, close() { el.classList.add('hidden'); }, progress(f) { fill.style.width = `${Math.round(f * 100)}%`; }, isOpen() { return !el.classList.contains('hidden'); } };
}

// Creative palette: every block and item, click to add a stack. Hotbar below (click to select, right-click to clear).
export function createCreativePanel(root, { onGive, onHotbarClick, onSurvival }) {
  const overlay = h('div', 'overlay hidden', root);
  const panel = h('div', 'panel', overlay);
  const head = h('div', 'craft', panel); h('h2', '', head, 'Creative Items').style.margin = '0 auto 0 0';
  const sb = btn(head, 'Inventory', onSurvival, 'small');
  const grid = h('div', 'creative-grid', panel);
  const entries = [...CREATIVE_ORDER.filter((k) => k !== 'air'), ...Object.keys(ITEMS)];
  for (const key of entries) {
    const s = h('div', 'slot', grid); renderSlot(s, { item: key, count: 1 });
    s.addEventListener('mousedown', (e) => { e.preventDefault(); onGive(key, e.shiftKey ? 1 : 64); });
    s.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, { item: key, count: 1 }));
    s.addEventListener('mouseleave', hideTooltip);
  }
  h('p', 'section-title', panel, 'Hotbar').style.marginTop = 'calc(var(--ui) * 3)';
  const hot = h('div', 'grid', panel); const slots = [];
  for (let i = 0; i < 9; i++) {
    const s = h('div', 'slot', hot); slots.push(s);
    s.addEventListener('mousedown', (e) => { e.preventDefault(); onHotbarClick(i, e.button); });
    s.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  return {
    el: overlay, open() { overlay.classList.remove('hidden'); }, close() { overlay.classList.add('hidden'); hideTooltip(); }, isOpen() { return !overlay.classList.contains('hidden'); },
    render(inv) { slots.forEach((s, i) => { renderSlot(s, inv.hotbar[i]); s.style.outline = i === inv.selected ? 'calc(var(--ui)) solid #fff' : 'none'; }); },
  };
}
