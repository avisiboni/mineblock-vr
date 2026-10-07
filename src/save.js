// ============================================================================
// Mineblock — saving and loading (localStorage, three slots)
// ----------------------------------------------------------------------------
// Only EDITS are stored (delta against the generator), so saves stay small:
//   { v, name, seed, created, played, creative, time, dim, camMode,
//     player{x,y,z,yaw,pitch,hp,hunger,xp,spawn}, inv, dims{ name:{ chunks{ "cx,cz":{e:[idx,id,..],m:[idx,val,..]} }, tiles, portals } } }
// ============================================================================
export const SLOTS = 3;
const key = (slot) => `mineblock:slot:${slot}`;

export function listSlots() {
  const out = [];
  for (let i = 0; i < SLOTS; i++) {
    try {
      const raw = localStorage.getItem(key(i));
      if (!raw) { out.push(null); continue; }
      const d = JSON.parse(raw);
      out.push({ slot: i, name: d.name, seed: d.seed, played: d.played, creative: !!d.creative, dim: d.dim });
    } catch { out.push(null); }
  }
  return out;
}
export function readSlot(slot) { try { return JSON.parse(localStorage.getItem(key(slot))); } catch { return null; } }
export function deleteSlot(slot) { try { localStorage.removeItem(key(slot)); } catch {} }

function dimToJSON(dim) {
  const chunks = {};
  for (const s of dim.stores.values()) {
    if (!s.edits.size && !s.meta.size) continue;
    const e = []; for (const [i, id] of s.edits) e.push(i, id);
    const m = []; for (const [i, v] of s.meta) m.push(i, v);
    chunks[`${s.cx},${s.cz}`] = { e, m };
  }
  const tiles = {}; for (const [k, te] of dim.tiles) tiles[k] = te;
  return { chunks, tiles, portals: dim.portals };
}
function dimFromJSON(dim, j) {
  if (!j) return;
  for (const k in j.chunks || {}) {
    const [cx, cz] = k.split(',').map(Number); const s = dim.storeFor(cx, cz); const c = j.chunks[k];
    for (let i = 0; i < c.e.length; i += 2) s.edits.set(c.e[i], c.e[i + 1]);
    for (let i = 0; i < (c.m || []).length; i += 2) s.meta.set(c.m[i], c.m[i + 1]);
  }
  for (const k in j.tiles || {}) dim.tiles.set(k, j.tiles[k]);
  dim.portals = j.portals || [];
}

export function serialize(g) {
  const p = g.player;
  return {
    v: 1, name: g.worldName, seed: g.world.seed, created: g.created, played: Date.now(), creative: g.creative, time: g.time, dim: g.dimName, camMode: g.camMode,
    renderDist: g.renderDist,
    player: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, hp: p.hp, hunger: p.hunger, xp: p.xp, spawn: p.spawn },
    inv: g.inv.toJSON(),
    dims: { overworld: dimToJSON(g.world.dims.overworld), nether: dimToJSON(g.world.dims.nether) },
  };
}
export function applyToWorld(world, data) { dimFromJSON(world.dims.overworld, data.dims?.overworld); dimFromJSON(world.dims.nether, data.dims?.nether); }

export function saveGame(g) {
  if (g.slot == null) return false;
  try { localStorage.setItem(key(g.slot), JSON.stringify(serialize(g))); return true; }
  catch (e) { g.hud?.toast('Save failed: storage full', 3000); return false; }
}
