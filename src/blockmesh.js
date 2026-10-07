// ============================================================================
// Mineblock — voxel meshing helpers
// ----------------------------------------------------------------------------
// The exact same code path is used by the design showcase and (later) by the
// chunk renderer. Faces are emitted only where a block touches air or a
// transparent block, with per-face shading baked into vertex colours.
//
//   makeAtlasMaterials(THREE, atlas)  -> { opaque, cutout, blend }
//   pushQuad(buf, x, y, z, face, tile, light)
//   meshVoxels(THREE, atlas, getBlock, bounds) -> { opaque, cutout, blend } meshes
//   blockGeometry(THREE, atlas, key)  -> BoxGeometry for a single block (icons/held)
// ============================================================================
import { BLOCKS, BLOCK_LIST, faceTile } from './blocks.js';

export const FACE = { top: 0, bottom: 1, north: 2, south: 3, east: 4, west: 5 };
export const FACE_NAMES = ['top', 'bottom', 'north', 'south', 'east', 'west'];
export const FACE_DIR = [[0, 1, 0], [0, -1, 0], [0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0]];
// Directional shading like Minecraft: top brightest, bottom darkest.
export const FACE_SHADE = [1.0, 0.5, 0.8, 0.8, 0.6, 0.6];

// Vertex positions per face (unit cube with corner at 0,0,0). Order: BL, BR, TR, TL
// as seen from outside the block, so UVs map straight to (u0,v0),(u1,v0),(u1,v1),(u0,v1).
export const FACE_VERTS = [
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], // top    (+y)
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], // bottom (-y)
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], // north  (-z)
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], // south  (+z)
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], // east   (+x)
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], // west   (-x)
];

export function makeBuffer() { return { pos: [], nrm: [], uv: [], col: [], idx: [], n: 0 }; }

// light: 0..1 multiplier (combine sky + block light before calling).
export function pushQuad(buf, x, y, z, face, tile, light = 1, inset = 0) {
  const verts = FACE_VERTS[face], nrm = FACE_DIR[face], s = FACE_SHADE[face] * light;
  const uvs = [[tile.u0, tile.v0], [tile.u1, tile.v0], [tile.u1, tile.v1], [tile.u0, tile.v1]];
  for (let i = 0; i < 4; i++) {
    const v = verts[i];
    let vx = v[0], vy = v[1], vz = v[2];
    if (inset) { // shrink toward centre (used for water surface lowering)
      if (nrm[1] === 1) vy -= inset;
    }
    buf.pos.push(x + vx, y + vy, z + vz);
    buf.nrm.push(nrm[0], nrm[1], nrm[2]);
    buf.uv.push(uvs[i][0], uvs[i][1]);
    buf.col.push(s, s, s);
  }
  const n = buf.n;
  buf.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  buf.n += 4;
}

// Cross-shaped model (torch, plants): two diagonal quads.
export function pushCross(buf, x, y, z, tile, light = 1) {
  const s = 0.9 * light;
  const quads = [
    [[0.15, 0, 0.15], [0.85, 0, 0.85], [0.85, 1, 0.85], [0.15, 1, 0.15]],
    [[0.85, 0, 0.15], [0.15, 0, 0.85], [0.15, 1, 0.85], [0.85, 1, 0.15]],
  ];
  quads.forEach((verts) => {
    for (let pass = 0; pass < 2; pass++) { // both sides
      for (let i = 0; i < 4; i++) {
        const v = verts[pass ? 3 - i : i];
        const uv = [[tile.u0, tile.v0], [tile.u1, tile.v0], [tile.u1, tile.v1], [tile.u0, tile.v1]][pass ? 3 - i : i];
        buf.pos.push(x + v[0], y + v[1], z + v[2]); buf.nrm.push(0, 1, 0); buf.uv.push(uv[0], uv[1]); buf.col.push(s, s, s);
      }
      const n = buf.n; buf.idx.push(n, n + 1, n + 2, n, n + 2, n + 3); buf.n += 4;
    }
  });
}

export function bufferToGeometry(THREE, buf) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
  g.setIndex(buf.idx);
  return g;
}

export function makeAtlasTexture(THREE, atlas) {
  const tex = new THREE.CanvasTexture(atlas.canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Three render passes:
//   opaque: everything solid
//   cutout: leaves, glass, torches (alpha tested, no blending, double-sided)
//   blend:  water, ice, portal (alpha blended, no depth write)
export function makeAtlasMaterials(THREE, atlas) {
  const map = makeAtlasTexture(THREE, atlas);
  return {
    texture: map,
    opaque: new THREE.MeshLambertMaterial({ map, vertexColors: true }),
    cutout: new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
    blend: new THREE.MeshLambertMaterial({ map, vertexColors: true, transparent: true, depthWrite: false, opacity: 1 }),
  };
}

export function passFor(block) {
  if (block.liquid || block.key === 'ice' || block.key === 'nether_portal') return 'blend';
  if (block.transparent) return 'cutout';
  return 'opaque';
}

// Should face of `block` toward `neighbour` be drawn?
export function faceVisible(block, neighbour) {
  if (!neighbour || neighbour.key === 'air') return true;
  if (neighbour.key === block.key) return false;          // water next to water, glass next to glass
  if (neighbour.transparent || neighbour.liquid) return true;
  return false;
}

// getBlock(x,y,z) -> block key string ('air' outside the world).
// bounds: {x0,y0,z0,x1,y1,z1} exclusive upper. getLight(x,y,z) -> 0..1 optional.
// include(key) -> false to skip meshing a block (it still occludes neighbours);
// used to split animated blocks (water/lava/portal) into their own meshes.
export function meshVoxels(THREE, atlas, materials, getBlock, bounds, getLight = () => 1, include = () => true) {
  const bufs = { opaque: makeBuffer(), cutout: makeBuffer(), blend: makeBuffer() };
  for (let x = bounds.x0; x < bounds.x1; x++)
    for (let y = bounds.y0; y < bounds.y1; y++)
      for (let z = bounds.z0; z < bounds.z1; z++) {
        const key = getBlock(x, y, z);
        if (!key || key === 'air' || !include(key)) continue;
        const block = BLOCKS[key];
        const pass = passFor(block);
        const buf = bufs[pass];
        if (block.model === 'cross') { pushCross(buf, x, y, z, atlas.uv(faceTile(block, 'top')), getLight(x, y, z)); continue; }
        for (let f = 0; f < 6; f++) {
          const d = FACE_DIR[f];
          const nKey = getBlock(x + d[0], y + d[1], z + d[2]);
          if (!faceVisible(block, BLOCKS[nKey] || BLOCKS.air)) continue;
          const tile = atlas.uv(faceTile(block, FACE_NAMES[f]));
          const light = Math.max(block.light / 15, getLight(x + d[0], y + d[1], z + d[2]));
          const inset = block.liquid && f === 0 && (BLOCKS[getBlock(x, y + 1, z)] || BLOCKS.air).key !== key ? 0.125 : 0;
          pushQuad(buf, x, y, z, f, tile, light, inset);
        }
      }
  const out = {};
  for (const pass in bufs) {
    if (bufs[pass].n === 0) continue;
    const mesh = new THREE.Mesh(bufferToGeometry(THREE, bufs[pass]), materials[pass]);
    mesh.renderOrder = pass === 'blend' ? 2 : pass === 'cutout' ? 1 : 0;
    out[pass] = mesh;
  }
  return out;
}

// One block as a BoxGeometry (for the held-item view model or a dropped item).
export function blockGeometry(THREE, atlas, key, size = 1) {
  const block = BLOCKS[key];
  const g = new THREE.BoxGeometry(size, size, size);
  const order = ['east', 'west', 'top', 'bottom', 'south', 'north']; // three face order
  const attr = g.attributes.uv;
  order.forEach((face, i) => {
    const t = atlas.uv(faceTile(block, face));
    const j = i * 4;
    attr.setXY(j, t.u0, t.v1); attr.setXY(j + 1, t.u1, t.v1); attr.setXY(j + 2, t.u0, t.v0); attr.setXY(j + 3, t.u1, t.v0);
  });
  attr.needsUpdate = true;
  return g;
}
export { BLOCK_LIST };
