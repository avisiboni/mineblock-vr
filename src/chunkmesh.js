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
import { OPAQUE, LIQUID, EMIT } from './tables.js';
import { CH, HT } from './worldgen.js';

export const LIGHT = { uDay: { value: 1 }, uMin: { value: 0.04 } };
export const ANIMATED_KEYS = ['water', 'lava', 'nether_portal', 'magma'];

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
    const m = patch(new THREE.MeshBasicMaterial({ map: t, vertexColors: true, transparent, depthWrite: !transparent, side: key === 'nether_portal' ? THREE.DoubleSide : THREE.FrontSide }));
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
  T = { uv: [], pass: new Array(n), anim: new Array(n), cross: new Uint8Array(n), front: new Uint8Array(n), frontFaces: [] };
  BLOCK_LIST.forEach((key, id) => {
    const b = BLOCKS[key];
    T.cross[id] = b.model === 'cross' ? 1 : 0;
    T.anim[id] = ANIMATED_KEYS.includes(key) ? key : null;
    T.pass[id] = key === 'air' ? null : (T.anim[id] ? 'anim' : passFor(b));
    if (!b.faces) { T.uv[id] = null; return; }
    const faces = [];
    for (let f = 0; f < 6; f++) faces.push(T.anim[id] ? FULL : atlas.uv(faceTile(b, FACE_NAMES[f])));
    T.uv[id] = faces;
    if (typeof b.faces === 'object' && b.faces.north) T.front[id] = 1;
  });
  T.atlas = atlas;
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

function quad(buf, x, y, z, f, uv, ci, lowerTop, emit) {
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
    const vy = vt[1] && lowerTop ? 0.875 : vt[1];
    buf.pos.push(x + vt[0], y + vy, z + vt[2]);
    buf.uv.push(us[v][0], us[v][1]);
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

function portalQuad(buf, x, y, z, axis, ci) {
  const g = CURVE[11];
  const v = axis === 0 ? [[0, 0, 0.5], [1, 0, 0.5], [1, 1, 0.5], [0, 1, 0.5]] : [[0.5, 0, 0], [0.5, 0, 1], [0.5, 1, 1], [0.5, 1, 0]];
  const us = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let i = 0; i < 4; i++) { buf.pos.push(x + v[i][0], y + v[i][1], z + v[i][2]); buf.uv.push(us[i][0], us[i][1]); buf.col.push(0, g, 1); }
  const n = buf.n; buf.idx.push(n, n + 1, n + 2, n, n + 2, n + 3); buf.n += 4;
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
    const uvs = T.uv[id]; if (!uvs) continue;
    const liquid = LIQUID[id];
    const lowerTop = liquid && cId[ci + PA] !== id;
    let rot = 0;
    if (T.front[id]) rot = c.meta.get(x + 16 * z + 256 * y) ?? 0;
    for (let f = 0; f < 6; f++) {
      const nid = cId[ci + OFF[f]];
      if (nid === id) { if (!(f === 0 && lowerTop)) continue; }
      else if (OPAQUE[nid]) continue;
      let uf = uvs[f];
      if (rot && f >= 2) { const hi = HORIZ.indexOf(f); uf = uvs[HORIZ[(hi - rot + 4) % 4]]; }
      quad(buf, x, y, z, f, uf, ci, lowerTop, emit);
    }
  }
  const out = [];
  const order = { opaque: 0, cutout: 1, blend: 3, water: 3, nether_portal: 3, lava: 0, magma: 0 };
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
