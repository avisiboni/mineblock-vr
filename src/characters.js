// ============================================================================
// Mineblock — voxel characters (player + mobs), skins and animation
// ----------------------------------------------------------------------------
// Characters are built from textured boxes, Minecraft-style. Skins are painted
// procedurally on a 64x64 canvas using the standard skin layout, so a real
// 64x64 skin PNG can be dropped in later for the player.
//
// Public API
//   makeSkin(kind)                    -> 64x64 canvas
//   buildCharacter(THREE, kind, skinCanvas?) -> rig { group, parts, kind, def }
//   animateCharacter(rig, time, state) -> updates part rotations each frame
//   CHARACTERS                        -> gameplay metadata per kind
//
// Conventions: 1 model pixel = 1/16 block. Model faces +z ("front"). The
// group origin is at the feet. rig.group.scale is set so the player is 1.8 m.
// Move/rotate rig.group; the animation only touches rig.root and rig.parts.
// ============================================================================

const SKIN_SIZE = 64;

// ------------------------------------------------------------ rig layouts
// part: size [w,h,d] px, uv [u,v] px, pivot [x,y,z] px, offset [x,y,z] px from
// pivot to box centre. Rotations happen around the pivot.
const HUMANOID = {
  head: { size: [8, 8, 8], uv: [0, 0], pivot: [0, 24, 0], offset: [0, 4, 0] },
  body: { size: [8, 12, 4], uv: [16, 16], pivot: [0, 24, 0], offset: [0, -6, 0] },
  armR: { size: [4, 12, 4], uv: [40, 16], pivot: [-6, 22, 0], offset: [0, -4, 0] },
  armL: { size: [4, 12, 4], uv: [32, 48], pivot: [6, 22, 0], offset: [0, -4, 0] },
  legR: { size: [4, 12, 4], uv: [0, 16], pivot: [-2, 12, 0], offset: [0, -6, 0] },
  legL: { size: [4, 12, 4], uv: [16, 48], pivot: [2, 12, 0], offset: [0, -6, 0] },
};
const QUADRUPED = {
  head: { size: [8, 8, 8], uv: [0, 0], pivot: [0, 12, 8], offset: [0, 0, 4] },
  snout: { size: [4, 3, 1], uv: [32, 0], pivot: [0, 12, 8], offset: [0, -1, 8.5], follow: 'head' },
  body: { size: [10, 8, 16], uv: [0, 16], pivot: [0, 10, 0], offset: [0, 0, 0] },
  legFR: { size: [4, 6, 4], uv: [0, 40], pivot: [-3, 6, 5], offset: [0, -3, 0] },
  legFL: { size: [4, 6, 4], uv: [0, 40], pivot: [3, 6, 5], offset: [0, -3, 0] },
  legBR: { size: [4, 6, 4], uv: [0, 40], pivot: [-3, 6, -5], offset: [0, -3, 0] },
  legBL: { size: [4, 6, 4], uv: [0, 40], pivot: [3, 6, -5], offset: [0, -3, 0] },
};
const WISP = {
  body: { size: [16, 16, 16], uv: [0, 0], pivot: [0, 24, 0], offset: [0, 0, 0] },
  ...Object.fromEntries([-5, 0, 5].flatMap((x) => [-5, 0, 5].map((z) => [
    `tent_${x}_${z}`, { size: [2, 9, 2], uv: [0, 32], pivot: [x, 16, z], offset: [0, -4.5, 0] },
  ]))),
};

// Cow and sheep reuse the quadruped animation (same leg names); horns/muzzle follow the head.
const COW = {
  head: { size: [8, 8, 6], uv: [0, 0], pivot: [0, 20, 8], offset: [0, 0, 3] },
  muzzle: { size: [6, 3, 1], uv: [36, 0], pivot: [0, 20, 8], offset: [0, -2, 6.5], follow: 'head' },
  hornL: { size: [1, 3, 1], uv: [28, 0], pivot: [0, 20, 8], offset: [4.5, 4.5, 2], follow: 'head' },
  hornR: { size: [1, 3, 1], uv: [28, 0], pivot: [0, 20, 8], offset: [-4.5, 4.5, 2], follow: 'head' },
  body: { size: [12, 10, 18], uv: [0, 16], pivot: [0, 17, 0], offset: [0, 0, 0] },
  legFR: { size: [4, 12, 4], uv: [0, 44], pivot: [-4, 12, 6], offset: [0, -6, 0] },
  legFL: { size: [4, 12, 4], uv: [0, 44], pivot: [4, 12, 6], offset: [0, -6, 0] },
  legBR: { size: [4, 12, 4], uv: [0, 44], pivot: [-4, 12, -6], offset: [0, -6, 0] },
  legBL: { size: [4, 12, 4], uv: [0, 44], pivot: [4, 12, -6], offset: [0, -6, 0] },
};
const SHEEP = {
  head: { size: [6, 6, 8], uv: [0, 0], pivot: [0, 18, 7], offset: [0, 1, 4] },
  body: { size: [10, 10, 16], uv: [0, 16], pivot: [0, 17, 0], offset: [0, 0, 0] },
  legFR: { size: [4, 12, 4], uv: [0, 44], pivot: [-3, 12, 5], offset: [0, -6, 0] },
  legFL: { size: [4, 12, 4], uv: [0, 44], pivot: [3, 12, 5], offset: [0, -6, 0] },
  legBR: { size: [4, 12, 4], uv: [0, 44], pivot: [-3, 12, -5], offset: [0, -6, 0] },
  legBL: { size: [4, 12, 4], uv: [0, 44], pivot: [3, 12, -5], offset: [0, -6, 0] },
};
const CHICKEN = {
  head: { size: [4, 6, 3], uv: [32, 0], pivot: [0, 9, 3], offset: [0, 3, 1] },
  beak: { size: [4, 2, 2], uv: [48, 0], pivot: [0, 9, 3], offset: [0, 4, 3.5], follow: 'head' },
  wattle: { size: [2, 2, 2], uv: [48, 6], pivot: [0, 9, 3], offset: [0, 2, 3], follow: 'head' },
  body: { size: [6, 6, 8], uv: [0, 0], pivot: [0, 8, 0], offset: [0, 0, 0] },
  wingL: { size: [1, 4, 6], uv: [0, 16], pivot: [3.5, 10, 0], offset: [0, -2, 0] },
  wingR: { size: [1, 4, 6], uv: [0, 16], pivot: [-3.5, 10, 0], offset: [0, -2, 0] },
  legL: { size: [2, 5, 2], uv: [16, 16], pivot: [1.5, 5, 0], offset: [0, -2.5, 0] },
  legR: { size: [2, 5, 2], uv: [16, 16], pivot: [-1.5, 5, 0], offset: [0, -2.5, 0] },
};
// Endermen: thin, very long limbs; humanoid animation
const ENDERMAN = {
  head: { size: [8, 8, 8], uv: [0, 0], pivot: [0, 40, 0], offset: [0, 4, 0] },
  body: { size: [8, 12, 4], uv: [16, 16], pivot: [0, 40, 0], offset: [0, -6, 0] },
  armR: { size: [2, 28, 2], uv: [40, 16], pivot: [-5, 39, 0], offset: [0, -13, 0] },
  armL: { size: [2, 28, 2], uv: [48, 16], pivot: [5, 39, 0], offset: [0, -13, 0] },
  legR: { size: [2, 28, 2], uv: [0, 32], pivot: [-2, 28, 0], offset: [0, -14, 0] },
  legL: { size: [2, 28, 2], uv: [8, 32], pivot: [2, 28, 0], offset: [0, -14, 0] },
};

// type: which animation drives the rig. rigH: model height in blocks (px / 16) before scaling to `height`.
export const CHARACTERS = {
  player: { rig: HUMANOID, type: 'humanoid', rigH: 2, skin: 'player', height: 1.8, width: 0.6, eyeHeight: 1.62, speed: 4.3, hostile: false },
  zombie: { rig: HUMANOID, type: 'humanoid', rigH: 2, skin: 'zombie', height: 1.8, width: 0.6, eyeHeight: 1.62, speed: 2.3, hostile: true, hp: 20, damage: 3, dimension: 'overworld', spawnLight: 'dark' },
  piglin: { rig: HUMANOID, type: 'humanoid', rigH: 2, skin: 'piglin', height: 1.8, width: 0.6, eyeHeight: 1.62, speed: 3.5, hostile: true, hp: 16, damage: 5, dimension: 'nether' },
  pig: { rig: QUADRUPED, type: 'quadruped', rigH: 1, skin: 'pig', height: 0.9, width: 0.9, eyeHeight: 0.7, speed: 1.8, hostile: false, hp: 10, dimension: 'overworld', spawnLight: 'bright' },
  wisp: { rig: WISP, type: 'wisp', rigH: 2, skin: 'wisp', height: 1.0, width: 1.0, eyeHeight: 0.5, speed: 1.5, hostile: true, hp: 10, damage: 6, dimension: 'nether', flies: true },
  cow: { rig: COW, type: 'quadruped', rigH: 1.5, skin: 'cow', height: 1.4, width: 0.9, eyeHeight: 1.2, speed: 1.6, hostile: false, hp: 10, dimension: 'overworld', spawnLight: 'bright' },
  sheep: { rig: SHEEP, type: 'quadruped', rigH: 1.4, skin: 'sheep', height: 1.3, width: 0.9, eyeHeight: 1.1, speed: 1.6, hostile: false, hp: 8, dimension: 'overworld', spawnLight: 'bright' },
  chicken: { rig: CHICKEN, type: 'chicken', rigH: 0.95, skin: 'chicken', height: 0.7, width: 0.45, eyeHeight: 0.6, speed: 1.4, hostile: false, hp: 4, dimension: 'overworld', spawnLight: 'bright' },
  // neutral: only attacks after being hit
  enderman: { rig: ENDERMAN, type: 'humanoid', rigH: 3, skin: 'enderman', height: 2.9, width: 0.6, eyeHeight: 2.55, speed: 3.2, hostile: false, neutral: true, hp: 40, damage: 5, dimension: 'end' },
};

// ------------------------------------------------------------- skin paint
const hex = (h) => h;
function boxRegions(u, v, w, h, d) {
  return {
    top: [u + d, v, w, d], bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h], front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h],
  };
}
function fillRegions(ctx, regions, colors) {
  for (const k in regions) {
    const c = colors[k] ?? colors.all;
    if (!c) continue;
    const [x, y, w, h] = regions[k];
    ctx.fillStyle = c; ctx.fillRect(x, y, w, h);
  }
}
function px(ctx, x, y, c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
function grain(ctx, region, cols, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const [x0, y0, w, h] = region;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (rnd() < 0.18) px(ctx, x, y, cols[(rnd() * cols.length) | 0]);
}

function paintHumanoid(ctx, p) {
  const head = boxRegions(0, 0, 8, 8, 8);
  fillRegions(ctx, head, { all: p.skin, top: p.hair, back: p.hair });
  // hair band on the upper rows of sides + front
  ['right', 'left', 'front'].forEach((k) => { const [x, y, w] = head[k]; ctx.fillStyle = p.hair; ctx.fillRect(x, y, w, k === 'front' ? 2 : 3); });
  // eyes / mouth on front region (8..16, 8..16)
  px(ctx, 9, 12, '#ffffff'); px(ctx, 10, 12, p.eye); px(ctx, 13, 12, p.eye); px(ctx, 14, 12, '#ffffff');
  px(ctx, 11, 13, p.skinDark); px(ctx, 12, 13, p.skinDark);
  px(ctx, 11, 14, p.mouth); px(ctx, 12, 14, p.mouth);
  // body
  const body = boxRegions(16, 16, 8, 12, 4);
  fillRegions(ctx, body, { all: p.shirt, top: p.skin, bottom: p.pants });
  grain(ctx, [16, 20, 24, 12], [p.shirtDark], 7);
  // arms (skin or sleeve), legs
  const armR = boxRegions(40, 16, 4, 12, 4), armL = boxRegions(32, 48, 4, 12, 4);
  [armR, armL].forEach((r) => {
    fillRegions(ctx, r, { all: p.arm, top: p.shirt, bottom: p.skinDark });
    if (p.sleeve) ['right', 'left', 'front', 'back'].forEach((k) => { const [x, y, w] = r[k]; ctx.fillStyle = p.shirt; ctx.fillRect(x, y, w, 3); });
  });
  const legR = boxRegions(0, 16, 4, 12, 4), legL = boxRegions(16, 48, 4, 12, 4);
  [legR, legL].forEach((r) => {
    fillRegions(ctx, r, { all: p.pants, top: p.pants, bottom: p.shoe });
    ['right', 'left', 'front', 'back'].forEach((k) => { const [x, y, w, h] = r[k]; ctx.fillStyle = p.shoe; ctx.fillRect(x, y + h - 3, w, 3); ctx.fillStyle = p.pantsDark; ctx.fillRect(x, y + 5, w, 1); });
  });
}

const SKINS = {
  player: (ctx) => paintHumanoid(ctx, {
    skin: '#e0ac84', skinDark: '#c48f6a', hair: '#4a2f1a', eye: '#3b5dc9', mouth: '#9c5c4a',
    shirt: '#2fa6a0', shirtDark: '#26918b', arm: '#e0ac84', pants: '#3b4ba8', pantsDark: '#2f3c8a', shoe: '#3a2a1a', sleeve: false,
  }),
  zombie: (ctx) => paintHumanoid(ctx, {
    skin: '#5a8a4a', skinDark: '#48713b', hair: '#3e6b34', eye: '#101010', mouth: '#2b4a22',
    shirt: '#1c6b6b', shirtDark: '#155555', arm: '#5a8a4a', pants: '#2c3580', pantsDark: '#222a66', shoe: '#1d1d1d', sleeve: true,
  }),
  piglin: (ctx) => paintHumanoid(ctx, {
    skin: '#f0a5a5', skinDark: '#d98c8c', hair: '#f0a5a5', eye: '#111111', mouth: '#7a3a3a',
    shirt: '#7a5a2a', shirtDark: '#654a22', arm: '#f0a5a5', pants: '#4a3a2a', pantsDark: '#3a2d20', shoe: '#2a2018', sleeve: false,
  }),
  pig: (ctx) => {
    const pink = '#f0a5a5', dark = '#d98c8c', light = '#f7bcbc';
    fillRegions(ctx, boxRegions(0, 0, 8, 8, 8), { all: pink });
    // eyes on head front (8..16, 8..16)
    px(ctx, 9, 11, '#111'); px(ctx, 14, 11, '#111');
    fillRegions(ctx, boxRegions(32, 0, 4, 3, 1), { all: dark, front: '#e39a9a' });
    px(ctx, 34, 2, '#b86f6f'); px(ctx, 36, 2, '#b86f6f');
    fillRegions(ctx, boxRegions(0, 16, 10, 8, 16), { all: pink, top: light, bottom: dark });
    grain(ctx, [0, 16, 52, 24], [dark, light], 3);
    fillRegions(ctx, boxRegions(0, 40, 4, 6, 4), { all: pink, bottom: dark });
    ['right', 'left', 'front', 'back'].forEach((k) => { const [x, y, w, h] = boxRegions(0, 40, 4, 6, 4)[k]; ctx.fillStyle = dark; ctx.fillRect(x, y + h - 2, w, 2); });
  },
  cow: (ctx) => {
    const brown = '#4a3324', dark = '#36241a', white = '#e6e2dc';
    fillRegions(ctx, boxRegions(0, 0, 8, 8, 6), { all: brown, top: dark });
    // head front (6..14, 6..14): white blaze, eyes
    ctx.fillStyle = white; ctx.fillRect(9, 6, 2, 5);
    px(ctx, 7, 9, '#111'); px(ctx, 8, 9, white); px(ctx, 12, 9, white); px(ctx, 13, 9, '#111');
    fillRegions(ctx, boxRegions(36, 0, 6, 3, 1), { all: '#c9a48c', front: '#d8b49a' });
    px(ctx, 38, 2, '#5a3a2a'); px(ctx, 41, 2, '#5a3a2a');
    fillRegions(ctx, boxRegions(28, 0, 1, 3, 1), { all: '#d8d0b8' });
    fillRegions(ctx, boxRegions(0, 16, 12, 10, 18), { all: brown, top: brown, bottom: dark });
    let sd = 5; const rnd = () => ((sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    grain(ctx, [0, 16, 60, 28], [dark], 9);
    for (let i = 0; i < 16; i++) { ctx.fillStyle = white; ctx.fillRect(1 + ((rnd() * 54) | 0), 17 + ((rnd() * 24) | 0), 4 + ((rnd() * 5) | 0), 3 + ((rnd() * 4) | 0)); }
    fillRegions(ctx, boxRegions(0, 44, 4, 12, 4), { all: brown, bottom: '#2a2a2a' });
    ['right', 'left', 'front', 'back'].forEach((k) => { const [x, y, w, h] = boxRegions(0, 44, 4, 12, 4)[k]; ctx.fillStyle = white; ctx.fillRect(x, y + h - 4, w, 2); ctx.fillStyle = '#2a2a2a'; ctx.fillRect(x, y + h - 2, w, 2); });
  },
  sheep: (ctx) => {
    const wool = '#e8e8e8', woolDark = '#d2d2d2', face = '#d6b49a', faceDark = '#b8967c';
    fillRegions(ctx, boxRegions(0, 0, 6, 6, 8), { all: face, top: wool, back: wool });
    ['right', 'left'].forEach((k) => { const [x, y, w] = boxRegions(0, 0, 6, 6, 8)[k]; ctx.fillStyle = wool; ctx.fillRect(x, y, w, 2); });
    // head front (8..14, 8..14)
    ctx.fillStyle = wool; ctx.fillRect(8, 8, 6, 1);
    px(ctx, 8, 10, '#fff'); px(ctx, 9, 10, '#111'); px(ctx, 12, 10, '#111'); px(ctx, 13, 10, '#fff');
    ctx.fillStyle = faceDark; ctx.fillRect(10, 12, 2, 1); px(ctx, 10, 13, '#e8a0a0'); px(ctx, 11, 13, '#e8a0a0');
    fillRegions(ctx, boxRegions(0, 16, 10, 10, 16), { all: wool, bottom: woolDark });
    grain(ctx, [0, 16, 52, 26], [woolDark, '#f4f4f4'], 13);
    fillRegions(ctx, boxRegions(0, 44, 4, 12, 4), { all: face, top: wool });
    ['right', 'left', 'front', 'back'].forEach((k) => { const [x, y, w, h] = boxRegions(0, 44, 4, 12, 4)[k]; ctx.fillStyle = wool; ctx.fillRect(x, y, w, 5); ctx.fillStyle = faceDark; ctx.fillRect(x, y + h - 2, w, 2); });
  },
  chicken: (ctx) => {
    const white = '#f4f4f4', shade = '#dedede';
    fillRegions(ctx, boxRegions(0, 0, 6, 6, 8), { all: white, bottom: shade });
    grain(ctx, [0, 0, 28, 14], [shade], 21);
    fillRegions(ctx, boxRegions(32, 0, 4, 6, 3), { all: white });
    // head front (35..39, 3..9): eyes
    px(ctx, 35, 5, '#111'); px(ctx, 38, 5, '#111');
    fillRegions(ctx, boxRegions(48, 0, 4, 2, 2), { all: '#e8a020', top: '#f4c040' });
    fillRegions(ctx, boxRegions(48, 6, 2, 2, 2), { all: '#d02020' });
    fillRegions(ctx, boxRegions(0, 16, 1, 4, 6), { all: white, bottom: shade });
    fillRegions(ctx, boxRegions(16, 16, 2, 5, 2), { all: '#e8b030', bottom: '#c08820' });
  },
  enderman: (ctx) => {
    const black = '#161616', dark = '#0c0c0c';
    ctx.fillStyle = black; ctx.fillRect(0, 0, 64, 64);
    grain(ctx, [0, 0, 64, 64], [dark, '#222'], 17);
    // head front (8..16, 8..16): glowing purple eyes
    ctx.fillStyle = '#d97cf7'; ctx.fillRect(8, 12, 3, 1); ctx.fillRect(13, 12, 3, 1);
    px(ctx, 9, 12, '#f2c6ff'); px(ctx, 14, 12, '#f2c6ff');
  },
  wisp: (ctx) => {
    const body = boxRegions(0, 0, 16, 16, 16);
    fillRegions(ctx, body, { all: '#f4f4f4', bottom: '#d9d9d9', top: '#ffffff' });
    grain(ctx, [0, 0, 64, 32], ['#e6e6e6'], 11);
    // face on front (16..32, 16..32): closed eyes + frown
    ctx.fillStyle = '#222'; ctx.fillRect(19, 21, 3, 2); ctx.fillRect(26, 21, 3, 2);
    ctx.fillRect(21, 27, 6, 2); ctx.fillRect(20, 26, 1, 1); ctx.fillRect(27, 26, 1, 1);
    fillRegions(ctx, boxRegions(0, 32, 2, 9, 2), { all: '#ececec', bottom: '#cfcfcf' });
  },
};

export function makeSkin(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = SKIN_SIZE;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, SKIN_SIZE, SKIN_SIZE);
  (SKINS[kind] || SKINS.player)(ctx);
  return c;
}

// ------------------------------------------------------------ rig builder
// Face order in THREE.BoxGeometry: +x, -x, +y, -y, +z, -z
function applyBoxUV(THREE, geom, uv, size, texSize = SKIN_SIZE) {
  const [w, h, d] = size;
  const r = boxRegions(uv[0], uv[1], w, h, d);
  const order = [r.left, r.right, r.top, r.bottom, r.front, r.back];
  const attr = geom.attributes.uv;
  order.forEach(([x, y, rw, rh], face) => {
    const u0 = x / texSize, u1 = (x + rw) / texSize;
    const v0 = 1 - (y + rh) / texSize, v1 = 1 - y / texSize;
    const i = face * 4;
    attr.setXY(i, u0, v1); attr.setXY(i + 1, u1, v1); attr.setXY(i + 2, u0, v0); attr.setXY(i + 3, u1, v0);
  });
  attr.needsUpdate = true;
}

export function buildCharacter(THREE, kind, skinCanvas = makeSkin(CHARACTERS[kind].skin)) {
  const def = CHARACTERS[kind];
  const tex = new THREE.CanvasTexture(skinCanvas);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5 });
  const group = new THREE.Group();      // placed/rotated by the game
  const root = new THREE.Group();       // bobbed by the animation
  group.add(root);
  const parts = {};
  const S = 1 / 16;
  for (const name in def.rig) {
    const p = def.rig[name];
    const pivot = new THREE.Group();
    pivot.position.set(p.pivot[0] * S, p.pivot[1] * S, p.pivot[2] * S);
    const geom = new THREE.BoxGeometry(p.size[0] * S, p.size[1] * S, p.size[2] * S);
    applyBoxUV(THREE, geom, p.uv, p.size);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(p.offset[0] * S, p.offset[1] * S, p.offset[2] * S);
    mesh.castShadow = true;
    pivot.add(mesh);
    root.add(pivot);
    parts[name] = pivot;
  }
  // Scale the model (rigH blocks tall) to the gameplay height.
  const k = def.height / (def.rigH || 2);
  group.scale.setScalar(k);
  return { group, root, parts, kind, def, texture: tex, material: mat };
}

// ---------------------------------------------------------------- animate
// state: { speed 0..1 (movement blend), mining bool, attack 0..1 (progress),
//          headYaw, headPitch (radians), sneaking bool, inAir bool }
export function animateCharacter(rig, t, state = {}) {
  const { speed = 0, mining = false, attack = 0, headYaw = 0, headPitch = 0, sneaking = false, inAir = false } = state;
  const p = rig.parts;
  const swing = Math.sin(t * 9) * Math.min(1, speed);
  const bob = Math.abs(Math.cos(t * 9)) * 0.02 * speed;
  const type = rig.def.type;
  if (type === 'humanoid') {
    const amp = 0.9;
    p.legL.rotation.x = swing * amp;
    p.legR.rotation.x = -swing * amp;
    p.armL.rotation.x = -swing * amp * 0.8;
    p.armR.rotation.x = swing * amp * 0.8;
    // idle: arms sway a little
    p.armL.rotation.z = 0.04 + Math.sin(t * 1.7) * 0.02;
    p.armR.rotation.z = -0.04 - Math.sin(t * 1.7) * 0.02;
    if (mining) {
      p.armR.rotation.x = -Math.PI * 0.55 + Math.sin(t * 22) * 0.5;
      p.armR.rotation.z = -0.15;
    }
    if (attack > 0) {
      const a = Math.sin(attack * Math.PI);
      p.armR.rotation.x = -a * 2.2; p.armR.rotation.y = -a * 0.4;
    }
    if (inAir) { p.armL.rotation.x = -2.6; p.armR.rotation.x = -2.6; }
    p.head.rotation.y = headYaw; p.head.rotation.x = headPitch;
    p.body.rotation.x = sneaking ? 0.5 : 0;
    p.head.position.y = (rig.def.rig.head.pivot[1] - (sneaking ? 2 : 0)) / 16;
    if (rig.kind === 'zombie') { p.armL.rotation.x = -Math.PI / 2 + Math.sin(t * 2) * 0.05; p.armR.rotation.x = -Math.PI / 2 - Math.sin(t * 2.3) * 0.05; }
    rig.root.position.y = bob;
  } else if (type === 'quadruped') {
    const amp = 0.8;
    p.legFL.rotation.x = swing * amp; p.legBR.rotation.x = swing * amp;
    p.legFR.rotation.x = -swing * amp; p.legBL.rotation.x = -swing * amp;
    p.head.rotation.y = headYaw * 0.6; p.head.rotation.x = headPitch * 0.5 + Math.sin(t * 1.3) * 0.05;
    rig.root.position.y = bob * 0.5;
  } else if (type === 'chicken') {
    p.legL.rotation.x = swing * 1.1; p.legR.rotation.x = -swing * 1.1;
    const flap = inAir ? Math.abs(Math.sin(t * 24)) * 1.2 : 0;
    p.wingL.rotation.z = -flap; p.wingR.rotation.z = flap;
    p.head.rotation.y = headYaw * 0.6; p.head.rotation.x = headPitch * 0.5 + (speed > 0.1 ? Math.sin(t * 18) * 0.15 : 0);
    rig.root.position.y = bob * 0.3;
  } else {
    rig.root.position.y = Math.sin(t * 1.4) * 0.15;
    for (const name in p) if (name.startsWith('tent_')) {
      const [, x, z] = name.split('_').map(Number);
      p[name].rotation.x = Math.sin(t * 2.2 + x * 0.4 + z * 0.7) * 0.25;
      p[name].rotation.z = Math.cos(t * 1.9 + z * 0.5) * 0.2;
    }
  }
  // horns, beaks, snouts: copy the head's rotation (they share its pivot)
  for (const name in rig.def.rig) if (rig.def.rig[name].follow) p[name].rotation.copy(p[rig.def.rig[name].follow].rotation);
}

// First-person view model: just the right arm, positioned bottom-right of the
// camera. Attach to the camera and call animateArm() every frame.
export function buildFirstPersonArm(THREE, skinCanvas = makeSkin('player')) {
  const rig = buildCharacter(THREE, 'player', skinCanvas);
  const arm = rig.parts.armR;
  const holder = new THREE.Group();
  holder.add(arm);
  arm.position.set(0.35, -0.35, -0.55);
  arm.rotation.set(-0.3, 0.9, 0.2);
  return { group: holder, arm, rig };
}
export function animateArm(fp, t, { mining = false, swing = 0, speed = 0 } = {}) {
  const a = fp.arm;
  const base = { x: -0.3, y: 0.9, z: 0.2 };
  const walk = Math.sin(t * 9) * 0.02 * speed;
  a.position.set(0.35 + walk, -0.35 + Math.abs(Math.cos(t * 9)) * 0.02 * speed, -0.55);
  if (mining) {
    const s = Math.sin(t * 22);
    a.rotation.set(base.x - 0.9 - s * 0.5, base.y - 0.3, base.z + s * 0.2);
  } else if (swing > 0) {
    const s = Math.sin(swing * Math.PI);
    a.rotation.set(base.x - s * 1.4, base.y - s * 0.5, base.z + s * 0.4);
  } else {
    a.rotation.set(base.x + Math.sin(t * 1.5) * 0.01, base.y, base.z);
  }
}
