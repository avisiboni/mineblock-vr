// ============================================================================
// Mineblock — entry point: boot, menus, world slots
// ----------------------------------------------------------------------------
// Flow: title -> world list -> (new world form | continue) -> Game.startWorld.
// All gameplay lives in game.js and the modules it wires together.
// ============================================================================
import { buildAtlas } from './textures.js';
import { Game } from './game.js';
import { createTitleMenu, createWorldList, createNewWorld, createPauseMenu, createDeathScreen, createLoading, createCreativePanel } from './menus.js';
import { listSlots, readSlot, deleteSlot } from './save.js';
import { seedFromString } from './noise.js';
import { sfx } from './sfx.js';

const ui = document.getElementById('ui');
const canvas = document.getElementById('game');
const atlas = buildAtlas();
const game = new Game(canvas, ui, atlas);
window.__game = game;   // handy for debugging in the console

// scale the pixel-UI unit with the window so the hotbar / inventory always fit
const fitUI = () => document.documentElement.style.setProperty('--ui', `${Math.max(1.5, Math.min(3, Math.min(innerWidth / 210, innerHeight / 150)))}px`);
addEventListener('resize', fitUI); fitUI();

const DISTANCES = [4, 6, 8, 12];
let title, worldList, newWorld, pause, death, loading, creative;

const show = (m) => { for (const s of [title, worldList, newWorld]) s.close(); m?.open(); };
const refreshList = () => worldList.render(listSlots());

title = createTitleMenu(ui, { onSingle: () => { refreshList(); show(worldList); }, onShowcase: () => (location.href = 'showcase.html') });
worldList = createWorldList(ui, {
  onPlay: (slot) => { const data = readSlot(slot); if (!data) return; show(null); game.startWorld({ seed: data.seed, name: data.name, slot, creative: data.creative, data }); sfx.unlock(); },
  onNew: (slot) => { newWorld.setSlot(slot); show(newWorld); },
  onDelete: (slot) => { deleteSlot(slot); refreshList(); },
  onBack: () => show(title),
});
newWorld = createNewWorld(ui, {
  onCreate: ({ name, seed, creative: cr, slot }) => { show(null); game.startWorld({ seed: seedFromString(seed), name, slot, creative: cr }); sfx.unlock(); },
  onBack: () => show(worldList),
});
pause = createPauseMenu(ui, {
  onResume: () => game.resume(),
  onCamera: () => { game.cams.setMode(game.camMode === 'fp' ? 'top' : 'fp'); pause.refresh(); },
  onDistance: () => { const i = DISTANCES.indexOf(game.renderDist); game.setRenderDist(DISTANCES[(i + 1) % DISTANCES.length]); pause.refresh(); },
  onCreative: () => { game.toggleCreative(); pause.refresh(); },
  onSound: () => { game.setSound(!game.sound); pause.refresh(); },
  onQuit: () => game.quitToTitle(),
  getState: () => ({ camMode: game.camMode, renderDist: game.renderDist, creative: game.creative, sound: game.sound }),
});
death = createDeathScreen(ui, { onRespawn: () => game.respawn(), onQuit: () => game.quitToTitle() });
loading = createLoading(ui);
creative = createCreativePanel(ui, {
  onGive: (item, n) => game.giveCreative(item, n),
  onHotbarClick: (i, button) => { if (button === 2) game.inv.hotbar[i] = null; else game.inv.selected = i; game.afterInv(); },
  onSurvival: () => { game.closePanel(); game.openPanel('inv'); },
});
game.attachMenus({ pause, death, loading, creative, onQuit: () => show(title) });
title.open();
