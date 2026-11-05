// ============================================================================
// Mineblock — chunk meshing with baked smooth lighting + ambient occlusion
// ----------------------------------------------------------------------------
// Each chunk becomes a few THREE.Mesh objects (opaque / cutout / blend plus one
// per animated block type). Vertex colours carry  r = sky light, g = block
// light, b = directional shade * AO.  A tiny shader patch turns that into
//   colour = max(sky * uDay, block, uMin) * shade
// so the day/night cycle is a uniform change and never needs a remesh.
//
//   makeMaterials(atlas)        -> shared materials (+ animated textures)
//   updateAnimated(t)           -> call every frame
//   meshChunk(dim, chunk, atlas, mats) -> THREE.Mesh[]   (positioned at chunk origin)
// ============================================================================
import * as THREE from 'three';
import { BLOCKS, BLOCK_LIST, BLOCK_ID, faceTile } from './blocks.js';
import { FACE_VERTS, FACE_DIR, FACE_SHADE, FACE_NAMES, passFor } from './blockmesh.js';
import { animatedTexture } from './textures.js';
import { OPAQUE, LIQUID, EMIT, HEIGHT } from './tables.js';
import { CH, HT } from './worldgen.js';
import { D6, OPP, doorBox } from './redstone.js';

export const LIGHT = { uDay: { value: 1 }, uMin: { value: 0.04 } };
export const ANIMATED_KEYS = ['water', 'lava', 'nether_portal', 'magma', 'end_portal'];

function patch(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDay = LIGHT.uDay; shader.uniforms.uMin = LIGHT.uMin;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uDay;\nuniform float uMin;')
      .replace('#include <color_vertex>', '#ifdef USE_COLOR\nvColor = vec3(max(max(color.r * uDay, color.g), uMin) * color.b);\n#endif');
  };
  mat.customProgramCacheKey = () => 'mineblock-baked-light';
  return mat;
}
function tex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeMaterials(atlas) {
  const map = tex(atlas.canvas);
  const base = { map, vertexColors: true };
  const mats = {
    texture: map,
    opaque: patch(new THREE.MeshBasicMaterial({ ...base })),
    cutout: patch(new THREE.MeshBasicMaterial({ ...base, alphaTest: 0.5, side: THREE.DoubleSide })),
    blend: patch(new THREE.MeshBasicMaterial({ ...base, transparent: true, depthWrite: false })),
    animated: {}, anims: [],
  };
  for (const key of ANIMATED_KEYS) {
    const anim = animatedTexture(key); const t = tex(anim.canvas);
    const transparent = key === 'water' || key === 'nether_portal';
    const m = patch(new THREE.MeshBasicMaterial({ map: t, vertexColors: true, transparent, depthWrite: !transparent, side: key === 'nether_portal' || key === 'end_portal' ? THREE.DoubleSide : THREE.FrontSide }));
    mats.animated[key] = m; mats.anims.push({ anim, tex: t });
  }
  return mats;
}
export function updateAnimated(mats, t) { for (const a of mats.anims) if (a.anim.update(t)) a.tex.needsUpdate = true; }

// --------------------------------------------------------- per-id tables
const FULL = { u0: 0, v0: 0, u1: 1, v1: 1 };
let T = null;
function initTables(atlas) {
  const n = BLOCK_LIST.length;
  T = { uv: [], pass: new Array(n), anim: new Array(n), cross: new Uint8Array(n), front: new Uint8Array(n), frontFaces: [], model: new Array(n).fill(null), dir: [] };
  BLOCK_LIST.forEach((key, id) => {
    const b = BLOCKS[key];
    T.cross[id] = b.model === 'cross' ? 1 : 0;
    if (b.model && b.model !== 'cross') T.model[id] = b.model;
    if (b.model === 'directional') T.dir[id] = { front: atlas.uv(b.faces.front), back: atlas.uv(b.faces.back), side: atlas.uv(b.faces.side), inner: atlas.uv('piston_inner'), backLit: atlas.uv('observer_back_lit') };
    T.anim[id] = ANIMATED_KEYS.includes(key) ? key : null;
    T.pass[id] = key === 'air' ? null : (T.anim[id] ? 'anim' : passFor(b));
    if (!b.faces) { T.uv[id] = null; return; }
    const faces = [];
    for (let f = 0; f < 6; f++) faces.push(T.anim[id] ? FULL : atlas.uv(faceTile(b, FACE_NAMES[f])));
    T.uv[id] = faces;
    if (typeof b.faces === 'object' && b.faces.north) T.front[id] = 1;
  });
  T.atlas = atlas;
  T.tiles = Object.fromEntries(['redstone_wire', 'redstone_wire_on', 'cobblestone', 'oak_planks', 'piston_top', 'piston_top_sticky', 'piston_side', 'door_lower', 'door_upper'].map((k) => [k, atlas.uv(k)]));
}

// ---------------------------------------------------------- padded cache
const PW = 18, PA = PW * PW;
const cId = new Uint8Array(PA * (HT + 3)), cSky = new Uint8Array(PA * (HT + 3)), cBlk = new Uint8Array(PA * (HT + 3));
function fillCache(dim, c, top) {
  const H = top + 3;
  cId.fill(0, 0, PA * H); cSky.fill(dim.sky ? 15 : 0, 0, PA * H); cBlk.fill(0, 0, PA * H);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const nc = dim.chunk(c.cx + dx, c.cz + dz);
    const x0 = dx === -1 ? 15 : 0, x1 = dx === 1 ? 0 : dx === -1 ? 15 : 15;
    const z0 = dz === -1 ? 15 : 0, z1 = dz === 1 ? 0 : dz === -1 ? 15 : 15;
    const px0 = dx === -1 ? 0 : dx === 0 ? 1 : 17, pz0 = dz === -1 ? 0 : dz === 0 ? 1 : 17;
    for (let y = 0; y <= top; y++) {
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const pi = ((y + 1) * PW + (pz0 + z - z0)) * PW + (px0 + x - x0);
        if (!nc) { cId[pi] = 1; cSky[pi] = 0; continue; }          // unloaded neighbour = stone (culls border faces)
        const si = x + 16 * z + 256 * y;
        cId[pi] = nc.blocks[si]; cSky[pi] = nc.sky[si]; cBlk[pi] = nc.blight[si];
      }
    }
  }
  // floor row (y=-1) is bedrock
  for (let i = 0; i < PA; i++) cId[i] = BLOCK_ID.bedrock;
}

// ------------------------------------------------------------- buffers
const newBuf = () => ({ pos: [], uv: [], col: [], idx: [], n: 0 });
const curve = (l) => (l <= 0 ? 0.03 : Math.pow(l / 15, 1.6) * 0.97 + 0.03);
const CURVE = Array.from({ length: 16 }, (_, i) => curve(i));
const AO = [0.45, 0.65, 0.82, 1.0];
const STRIDE = [1, PA, PW];     // x, y, z strides in the padded cache
const FACE_AXIS = [1, 1, 2, 2, 0, 0];
const OFF = [PA, -PA, -PW, PW, 1, -1]; // top,bottom,north(-z),south(+z),east,west
const TANG = [[0, 2], [0, 2], [0, 1], [0, 1], [1, 2], [1, 2]]; // tangent axes per face

function quad(buf, x, y, z, f, uv, ci, topH, emit, rot = 0) {
  const verts = FACE_VERTS[f];
  const front = ci + OFF[f];
  const [a1, a2] = TANG[f];
  const ao = [0, 0, 0, 0];
  const base = buf.n;
  const us = [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]];
  const shade = FACE_SHADE[f];
  for (let v = 0; v < 4; v++) {
    const vt = verts[v];
    const s1 = front + (vt[a1] ? STRIDE[a1] : -STRIDE[a1]);
    const s2 = front + (vt[a2] ? STRIDE[a2] : -STRIDE[a2]);
    const cc = front + (vt[a1] ? STRIDE[a1] : -STRIDE[a1]) + (vt[a2] ? STRIDE[a2] : -STRIDE[a2]);
    const o1 = OPAQUE[cId[s1]], o2 = OPAQUE[cId[s2]], oc = OPAQUE[cId[cc]];
    const a = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
    ao[v] = a;
    let sk = cSky[front], bl = cBlk[front], cnt = 1;
    if (!o1) { sk += cSky[s1]; bl += cBlk[s1]; cnt++; }
    if (!o2) { sk += cSky[s2]; bl += cBlk[s2]; cnt++; }
    if (!oc && !(o1 && o2)) { sk += cSky[cc]; bl += cBlk[cc]; cnt++; }
    const r = curve(sk / cnt), g = Math.max(curve(bl / cnt), emit ? CURVE[emit] : 0);
    const vy = vt[1] ? topH : 0;
    buf.pos.push(x + vt[0], y + vy, z + vt[2]);
    // lowered side faces show the bottom part of their tile instead of squashing it
    const uu = us[(v + rot) & 3];
    buf.uv.push(uu[0], f >= 2 && vt[1] && topH < 1 ? uv.v0 + (uv.v1 - uv.v0) * topH : uu[1]);
    buf.col.push(r, g, shade * AO[a]);
  }
  const n = base;
  if (ao[0] + ao[2] > ao[1] + ao[3]) buf.idx.push(n + 1, n + 2, n + 3, n + 1, n + 3, n);
  else buf.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  buf.n += 4;
}

function cross(buf, x, y, z, uv, ci, emit) {
  const r = CURVE[cSky[ci]], g = Math.max(CURVE[cBlk[ci]], emit ? CURVE[emit] : 0), b = 0.95;
  const Q = [
    [[0.15, 0, 0.15], [0.85, 0, 0.85], [0.85, 1, 0.85], [0.15, 1, 0.15]],
    [[0.85, 0, 0.15], [0.15, 0, 0.85], [0.15, 1, 0.85], [0.85, 1, 0.15]],
  ];
  const us = [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]];
  for (const q of Q) for (let i = 0; i < 4; i++) { buf.pos.push(x + q[i][0], y + q[i][1], z + q[i][2]); buf.uv.push(us[i][0], us[i][1]); buf.col.push(r, g, b); }
  const n = buf.n; buf.idx.push(n, n + 1, n + 2, n, n + 2, n + 3, n + 4, n + 5, n + 6, n + 4, n + 6, n + 7); buf.n += 8;
}

// End portal: a flat, always-bright surface 3/4 of the way up the block
function endPortalQuad(buf, x, y, z) {
  const v = [[0, 0.75, 1], [1, 0.75, 1], [1, 0.75, 0], [0, 0.75, 0]];
  const us = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let i = 0; i < 4; i++) { buf.pos.push(x + v[i][0], y + v[i][1], z + v[i][2]); buf.uv.push(us[i][0], us[i][1]); buf.col.push(0, 1, 1); }
  const n = buf.n; buf.idx.push(n, n + 1, n + 2, n, n + 2, n + 3); buf.n += 4;
}

function portalQuad(buf, x, y, z, axis, ci) {
  const g = CURVE[11];
  const v = axis === 0 ? [[0, 0, 0.5], [1, 0, 0.5], [1, 1, 0.5], [0, 1, 0.5]] : [[0.5, 0, 0], [0.5, 0, 1], [0.5, 1, 1], [0.5, 1, 0]];
  const us = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let i = 0; i < 4; i++) { buf.pos.push(x + v[i][0], y + v[i][1], z + v[i][2]); buf.uv.push(us[i][0], us[i][1]); buf.col.push(0, g, 1); }
  const n = buf.n; buf.idx.push(n, n + 1, n + 2, n, n + 2, n + 3); buf.n += 4;
}


// ------------------------------------------------------- custom models
// uv rotation so a side texture's "up" points along direction d (pistons, observers)
const ROTK = FACE_VERTS.map((fv) => D6.map((d) => {
  for (let k = 0; k < 4; k++) {
    const tl = fv[(3 - k + 4) & 3], bl = fv[(4 - k) & 3];
    if (tl[0] - bl[0] === d[0] && tl[1] - bl[1] === d[1] && tl[2] - bl[2] === d[2]) return k;
  }
  return 0;
}));
// per face: which axis the texture's u / v run along, and their sign
const FACE_UV = FACE_VERTS.map((fv) => {
  const ax = (a, b) => [0, 1, 2].find((i) => a[i] !== b[i]);
  const au = ax(fv[1], fv[0]), av = ax(fv[3], fv[0]);
  return [au, fv[1][au] - fv[0][au], av, fv[3][av] - fv[0][av]];
});
// Map a model built "standing on the floor" so its floor side faces direction s (0..5).
const MAPS = [
  (p) => [p[0], 1 - p[1], p[2]], (p) => p,
  (p) => [p[0], p[2], p[1]], (p) => [p[0], p[2], 1 - p[1]],
  (p) => [1 - p[1], p[2], p[0]], (p) => [p[1], p[2], p[0]],
];
// A textured box in the cell. lo/hi in 0..1 (model space); tile(f) -> atlas uv; pre(p) optional
// model-space transform (e.g. a tilted lever stick); map(p) model -> cell space.
function box(buf, x, y, z, lo, hi, tile, ci, emit, map = MAPS[1], pre = null, mask = 63) {
  const r = CURVE[cSky[ci]], g = Math.max(CURVE[cBlk[ci]], emit ? CURVE[emit] : 0);
  for (let f = 0; f < 6; f++) {
    if (!(mask & (1 << f))) continue;
    const uv = tile(f); if (!uv) continue;
    const fv = FACE_VERTS[f], [au, su, av, sv] = FACE_UV[f], base = buf.n;
    for (let v = 0; v < 4; v++) {
      const c = fv[v];
      let p = [c[0] ? hi[0] : lo[0], c[1] ? hi[1] : lo[1], c[2] ? hi[2] : lo[2]];
      const fu = su > 0 ? p[au] : 1 - p[au], fvv = sv > 0 ? p[av] : 1 - p[av];
      if (pre) p = pre(p);
      p = map(p);
      buf.pos.push(x + p[0], y + p[1], z + p[2]);
      buf.uv.push(uv.u0 + (uv.u1 - uv.u0) * Math.min(1, Math.max(0, fu)), uv.v0 + (uv.v1 - uv.v0) * Math.min(1, Math.max(0, fvv)));
      buf.col.push(r, g, FACE_SHADE[f]);
    }
    buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3); buf.n += 4;
  }
}
const WIRE_ID = BLOCK_ID.redstone_wire;
const WIRE_LINKS = new Set(['redstone_wire', 'lever', 'redstone_block', 'observer', 'piston', 'sticky_piston', 'redstone_lamp', 'redstone_lamp_lit', 'tnt', 'door_lower'].map((k) => BLOCK_ID[k]));
const HOR = [2, 3, 4, 5];
function wireModel(buf, x, y, z, ci, power) {
  const tile = power > 0 ? T.tiles.redstone_wire_on : T.tiles.redstone_wire;
  const conn = [];
  const upFree = !OPAQUE[cId[ci + PA]];
  for (const i of HOR) {
    const n = ci + OFF[i];
    conn[i] = WIRE_LINKS.has(cId[n]) || (!OPAQUE[cId[n]] && cId[n - PA] === WIRE_ID) || (upFree && OPAQUE[cId[n]] && cId[n + PA] === WIRE_ID);
  }
  const cnt = HOR.filter((i) => conn[i]).length;
  if (cnt === 0) HOR.forEach((i) => (conn[i] = true));                         // lone dust: a cross
  else if (cnt === 1) HOR.forEach((i) => { if (conn[OPP[i]]) conn[i] = true; }); // one link: a straight line
  const a = 0.34, b = 0.66, h = 1 / 32, emit = power > 0 ? Math.min(15, 5 + Math.round(power * 0.6)) : 0, t = () => tile;
  box(buf, x, y, z, [a, 0, a], [b, h, b], t, ci, emit, MAPS[1], null, 1);
  if (conn[2]) box(buf, x, y, z, [a, 0, 0], [b, h, a], t, ci, emit, MAPS[1], null, 1);
  if (conn[3]) box(buf, x, y, z, [a, 0, b], [b, h, 1], t, ci, emit, MAPS[1], null, 1);
  if (conn[4]) box(buf, x, y, z, [b, 0, a], [1, h, b], t, ci, emit, MAPS[1], null, 1);
  if (conn[5]) box(buf, x, y, z, [0, 0, a], [a, h, b], t, ci, emit, MAPS[1], null, 1);
}
function leverModel(buf, x, y, z, ci, m) {
  const map0 = MAPS[m & 7], swap = (m & 16) && (m & 7) < 2;
  const map = swap ? (p) => map0([p[2], p[1], p[0]]) : map0;
  const cob = () => T.tiles.cobblestone, wood = () => T.tiles.oak_planks;
  box(buf, x, y, z, [5 / 16, 0, 4 / 16], [11 / 16, 3 / 16, 12 / 16], cob, ci, 0, map);
  const ang = m & 8 ? 0.65 : -0.65, c = Math.cos(ang), s = Math.sin(ang), py = 2 / 16;
  const tilt = (p) => { const dy = p[1] - py, dz = p[2] - 0.5; return [p[0], py + dy * c - dz * s, 0.5 + dy * s + dz * c]; };
  box(buf, x, y, z, [7 / 16, py, 7 / 16], [9 / 16, py + 10 / 16, 9 / 16], wood, ci, 0, map, tilt);
}
function headModel(buf, x, y, z, ci, m) {
  const map = MAPS[OPP[m & 7]], front = m & 8 ? T.tiles.piston_top_sticky : T.tiles.piston_top, side = T.tiles.piston_side;
  box(buf, x, y, z, [0, 12 / 16, 0], [1, 1, 1], (f) => (f === 0 ? front : side), ci, 0, map);
  box(buf, x, y, z, [6 / 16, -4 / 16, 6 / 16], [10 / 16, 12 / 16, 10 / 16], () => side, ci, 0, map, null, 0b111100);
}
function doorModel(buf, x, y, z, ci, m, upper) {
  const d = doorBox(m), tile = upper ? T.tiles.door_upper : T.tiles.door_lower;
  box(buf, x, y, z, [d[0], 0, d[1]], [d[2], 1, d[3]], () => tile, ci, 0);
}

// horizontal face index order used to rotate 'front' faces: north, east, south, west
const HORIZ = [2, 4, 3, 5];

export function meshChunk(dim, c, atlas, mats) {
  if (!T || T.atlas !== atlas) initTables(atlas);
  const top = Math.min(HT - 1, c.maxY);
  fillCache(dim, c, top);
  const bufs = { opaque: newBuf(), cutout: newBuf(), blend: newBuf() };
  for (const k of ANIMATED_KEYS) bufs[k] = newBuf();
  for (let y = 0; y <= top; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const ci = ((y + 1) * PW + (z + 1)) * PW + (x + 1);
    const id = cId[ci];
    if (id === 0) continue;
    const pass = T.pass[id];
    const buf = pass === 'anim' ? bufs[T.anim[id]] : bufs[pass];
    const emit = EMIT[id];
    if (T.cross[id]) { cross(buf, x, y, z, T.uv[id][0], ci, emit); continue; }
    if (T.anim[id] === 'nether_portal') { portalQuad(buf, x, y, z, c.meta.get(x + 16 * z + 256 * y) ?? 0, ci); continue; }
    if (T.anim[id] === 'end_portal') { endPortalQuad(buf, x, y, z); continue; }
    const model = T.model[id];
    if (model && model !== 'directional') {
      const m = c.meta.get(x + 16 * z + 256 * y) ?? 0;
      if (model === 'wire') wireModel(buf, x, y, z, ci, m);
      else if (model === 'lever') leverModel(buf, x, y, z, ci, m);
      else if (model === 'head') headModel(buf, x, y, z, ci, m);
      else if (model === 'door') doorModel(buf, x, y, z, ci, m, BLOCK_LIST[id] === 'door_upper');
      continue;
    }
    if (model === 'directional') {
      const m = c.meta.get(x + 16 * z + 256 * y) ?? 0, fd = m & 7, td = T.dir[id], key = BLOCK_LIST[id];
      for (let f = 0; f < 6; f++) {
        const nid = cId[ci + OFF[f]];
        if (OPAQUE[nid]) continue;
        let uf, rot = 0;
        if (f === fd) uf = key === 'observer' ? td.front : (m & 8) ? td.inner : td.front;
        else if (f === OPP[fd]) uf = key === 'observer' && (m & 8) ? td.backLit : td.back;
        else { uf = td.side; rot = ROTK[f][fd]; }
        quad(buf, x, y, z, f, uf, ci, 1, emit, rot);
      }
      continue;
    }
    const uvs = T.uv[id]; if (!uvs) continue;
    const liquid = LIQUID[id];
    const lowerTop = liquid && cId[ci + PA] !== id;
    const topH = lowerTop ? 0.875 : HEIGHT[id];
    let rot = 0;
    if (T.front[id]) rot = c.meta.get(x + 16 * z + 256 * y) ?? 0;
    for (let f = 0; f < 6; f++) {
      const nid = cId[ci + OFF[f]];
      if (nid === id) { if (!(f === 0 && lowerTop)) continue; }
      else if (OPAQUE[nid] && !(f === 0 && topH < 1)) continue;
      let uf = uvs[f];
      if (rot && f >= 2) { const hi = HORIZ.indexOf(f); uf = uvs[HORIZ[(hi - rot + 4) % 4]]; }
      quad(buf, x, y, z, f, uf, ci, topH, emit);
    }
  }
  const out = [];
  const order = { opaque: 0, cutout: 1, blend: 3, water: 3, nether_portal: 3, lava: 0, magma: 0, end_portal: 0 };
  for (const k in bufs) {
    const b = bufs[k]; if (!b.n) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.setIndex(b.idx);
    const m = new THREE.Mesh(g, mats.animated[k] || mats[k]);
    m.position.set(c.cx * CH, 0, c.cz * CH);
    m.renderOrder = order[k] ?? 0;
    m.matrixAutoUpdate = false; m.updateMatrix();
    out.push(m);
  }
  return out;
}

export function disposeMeshes(list, parent) {
  for (const m of list) { parent?.remove(m); m.geometry.dispose(); }
  list.length = 0;
}
