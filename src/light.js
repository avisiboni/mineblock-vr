// ============================================================================
// Mineblock — lighting (Phase 8)
// ----------------------------------------------------------------------------
// Two channels per cell, both 0..15:  sky (sunlight) and block (torches, lava).
//  - lightChunk(dim, chunk): initial light for a freshly generated chunk,
//    including pulling/pushing light across borders with lit neighbours.
//  - relightAfterChange(dim, x,y,z, oldId, newId): incremental update using the
//    classic remove-BFS + add-BFS so edits stay local and cheap.
// Sunlight travels straight down without loss; everything else loses 1/step.
// ============================================================================
import { OPAQUE, EMIT } from './tables.js';

const HT = 128;
const DX = [1, -1, 0, 0, 0, 0], DY = [0, 0, 1, -1, 0, 0], DZ = [0, 0, 0, 0, 1, -1];

function accessors(dim, ch) {
  return ch === 0
    ? [(x, y, z) => dim.getSky(x, y, z), (x, y, z, v) => dim.setSky(x, y, z, v)]
    : [(x, y, z) => dim.getBlockLight(x, y, z), (x, y, z, v) => dim.setBlockLight(x, y, z, v)];
}

// q = flat [x,y,z,...] of cells whose light should spread to their neighbours.
function spread(dim, ch, q) {
  const [get, set] = accessors(dim, ch);
  for (let h = 0; h < q.length; h += 3) {
    const x = q[h], y = q[h + 1], z = q[h + 2];
    const L = get(x, y, z);
    if (L <= 1 && !(ch === 0 && L === 15)) continue;
    for (let d = 0; d < 6; d++) {
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      if (ny < 0 || ny >= HT) continue;
      if (OPAQUE[dim.getId(nx, ny, nz)]) continue;
      const nl = (ch === 0 && d === 3 && L === 15) ? 15 : L - 1;
      if (get(nx, ny, nz) < nl) { set(nx, ny, nz, nl); q.push(nx, ny, nz); }
    }
  }
}

// Removes light that flowed from (x,y,z) (which had value l); returns cells that still hold independent light.
function unspread(dim, ch, x0, y0, z0, l0, keep) {
  const [get, set] = accessors(dim, ch);
  const rq = [x0, y0, z0, l0];
  for (let h = 0; h < rq.length; h += 4) {
    const x = rq[h], y = rq[h + 1], z = rq[h + 2], l = rq[h + 3];
    for (let d = 0; d < 6; d++) {
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      if (ny < 0 || ny >= HT) continue;
      const ln = get(nx, ny, nz);
      if (ln === 0) continue;
      if (ln < l || (ch === 0 && d === 3 && l === 15 && ln === 15)) { set(nx, ny, nz, 0); rq.push(nx, ny, nz, ln); }
      else keep.push(nx, ny, nz);
    }
  }
}

export function relightAfterChange(dim, x, y, z, oldId, newId) {
  const opChanged = OPAQUE[oldId] !== OPAQUE[newId], emChanged = EMIT[oldId] !== EMIT[newId];
  if (!opChanged && !emChanged) return;
  for (const ch of dim.sky ? [1, 0] : [1]) {
    const [get, set] = accessors(dim, ch);
    const keep = [];
    const L = get(x, y, z);
    if (L > 0) { set(x, y, z, 0); unspread(dim, ch, x, y, z, L, keep); }
    if (ch === 1 && EMIT[newId] > 0) { set(x, y, z, EMIT[newId]); keep.push(x, y, z); }
    if (!OPAQUE[newId]) {
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (ny < 0 || ny >= HT) continue;
        if (get(nx, ny, nz) > 1 || (ch === 0 && get(nx, ny, nz) === 15)) keep.push(nx, ny, nz);
      }
      if (ch === 0 && y === HT - 1) { set(x, y, z, 15); keep.push(x, y, z); }
    }
    spread(dim, ch, keep);
  }
}

// Initial light for a new chunk.
export function lightChunk(dim, c) {
  const { blocks, sky, blight } = c;
  const qSky = [], qBlock = [];
  const ox = c.cx * 16, oz = c.cz * 16;
  if (dim.sky) {
    const surf = new Int16Array(256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      let y = HT - 1;
      while (y >= 0 && !OPAQUE[blocks[x + 16 * z + 256 * y]]) { sky[x + 16 * z + 256 * y] = 15; y--; }
      surf[x + 16 * z] = y;
    }
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const s = surf[x + 16 * z];
      let m = s;
      if (x > 0) m = Math.max(m, surf[x - 1 + 16 * z]); if (x < 15) m = Math.max(m, surf[x + 1 + 16 * z]);
      if (z > 0) m = Math.max(m, surf[x + 16 * (z - 1)]); if (z < 15) m = Math.max(m, surf[x + 16 * (z + 1)]);
      for (let y = s + 1; y <= Math.min(m, HT - 1); y++) qSky.push(ox + x, y, oz + z);
    }
  }
  const top = Math.min(HT - 1, c.maxY + 1);
  for (let y = 0; y <= top; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const i = x + 16 * z + 256 * y, e = EMIT[blocks[i]];
    if (e > 0) { blight[i] = e; qBlock.push(ox + x, y, oz + z); }
  }
  spread(dim, 1, qBlock);
  spread(dim, 0, qSky);
  c.lit = true;
  // exchange light with already-lit neighbours along the 4 borders
  const nq = [[], []];
  const sides = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [sx, sz] of sides) {
    const n = dim.chunk(c.cx + sx, c.cz + sz);
    if (!n || !n.lit) continue;
    for (let y = 0; y < HT; y++) for (let t = 0; t < 16; t++) {
      const lx = sx === -1 ? 0 : sx === 1 ? 15 : t, lz = sz === -1 ? 0 : sz === 1 ? 15 : t;
      const mx = ox + lx, mz = oz + lz, ex = mx + sx, ez = mz + sz;
      const a = lx + 16 * lz + 256 * y;
      const b = ((ex) & 15) + 16 * ((ez) & 15) + 256 * y;
      if (blight[a] > 1) nq[1].push(mx, y, mz);
      if (n.blight[b] > 1) nq[1].push(ex, y, ez);
      if (sky[a] > 1) nq[0].push(mx, y, mz);
      if (n.sky[b] > 1) nq[0].push(ex, y, ez);
    }
  }
  spread(dim, 1, nq[1]);
  spread(dim, 0, nq[0]);
}
