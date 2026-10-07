// ============================================================================
// Mineblock — procedural pixel-art texture atlas
// ----------------------------------------------------------------------------
// Every block face and item icon is painted at runtime as a 16x16 pixel tile
// and packed into one atlas canvas. No image files are needed, which keeps the
// game a single static site. All painters are deterministic (seeded RNG) so
// the atlas is identical on every load.
//
// Public API
//   buildAtlas()                -> { canvas, tiles, cols, rows, uv(name) }
//   paintTile(name, frame=0)    -> 16x16 canvas for one tile (used for icons)
//   animatedTexture(name, fps)  -> { canvas, update(timeSeconds) } for water,
//                                  lava and the nether portal
//   TILE_NAMES                  -> ordered list of every tile in the atlas
// ============================================================================

export const TILE = 16;
export const ATLAS_COLS = 16;

// ---------------------------------------------------------------- utilities
export function rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
export function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
export function shade(c, k) { return [cl(c[0] * k), cl(c[1] * k), cl(c[2] * k)]; }
export function mix(a, b, t) {
  return [cl(a[0] + (b[0] - a[0]) * t), cl(a[1] + (b[1] - a[1]) * t), cl(a[2] + (b[2] - a[2]) * t)];
}

// A tiny RGBA pixel buffer with pixel-art helpers.
export class Pixels {
  constructor(size = TILE) {
    this.size = size;
    this.data = new Uint8ClampedArray(size * size * 4);
  }
  set(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = a;
  }
  get(x, y) {
    const i = (y * this.size + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  alpha(x, y) { return this.data[(y * this.size + x) * 4 + 3]; }
  fill(c, a = 255) { for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) this.set(x, y, c, a); }
  // Fill with colour c, varying brightness by +-amt.
  noise(rand, c, amt, a = 255) {
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) this.set(x, y, shade(c, 1 + (rand() * 2 - 1) * amt), a);
  }
  // Multiply existing pixels by random factor (adds grain to any base).
  grain(rand, amt) {
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) {
        const a = this.alpha(x, y); if (!a) continue;
        this.set(x, y, shade(this.get(x, y), 1 + (rand() * 2 - 1) * amt), a);
      }
  }
  speckle(rand, c, count, a = 255) {
    for (let i = 0; i < count; i++) this.set((rand() * this.size) | 0, (rand() * this.size) | 0, c, a);
  }
  rect(x, y, w, h, c, a = 255) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c, a); }
  hline(x0, x1, y, c, a = 255) { for (let x = x0; x <= x1; x++) this.set(x, y, c, a); }
  vline(x, y0, y1, c, a = 255) { for (let y = y0; y <= y1; y++) this.set(x, y, c, a); }
  border(c) { this.hline(0, 15, 0, c); this.hline(0, 15, 15, c); this.vline(0, 0, 15, c); this.vline(15, 0, 15, c); }
  // Bevelled edge: light on top/left, dark on bottom/right.
  bevel(light, dark, inset = 0) {
    const n = 15 - inset;
    this.hline(inset, n, inset, light); this.vline(inset, inset, n, light);
    this.hline(inset, n, n, dark); this.vline(n, inset, n, dark);
  }
  // Paint pixels from a string map. legend maps a char to [colour, alpha?].
  map(rows, legend, ox = 0, oy = 0) {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]; if (ch === '.' || ch === ' ') continue;
        const e = legend[ch]; if (!e) continue;
        this.set(x + ox, y + oy, e[0], e[1] === undefined ? 255 : e[1]);
      }
    });
  }
  toCanvas() {
    const c = document.createElement('canvas');
    c.width = c.height = this.size;
    c.getContext('2d').putImageData(new ImageData(this.data, this.size, this.size), 0, 0);
    return c;
  }
}

// ------------------------------------------------------------------ palette
export const C = {
  stone: hex('#7d7d7d'), stoneDark: hex('#5f5f5f'), stoneLight: hex('#9a9a9a'),
  dirt: hex('#866043'), dirtDark: hex('#6a4a32'), dirtLight: hex('#9c7452'),
  grass: hex('#5d9b3a'), grassDark: hex('#4a7f2c'), grassLight: hex('#74b84b'),
  snow: hex('#f2f6fa'), snowShade: hex('#dfe7ef'),
  sand: hex('#dbd0a0'), sandDark: hex('#c4b98a'),
  gravel: hex('#8a8583'), wood: hex('#6b4d2e'), woodLight: hex('#7f5d39'), woodDark: hex('#553b22'),
  logTop: hex('#b08e5a'), logRing: hex('#8c6d42'), planks: hex('#a5804e'), planksDark: hex('#7d5f38'), planksLight: hex('#b58f5d'),
  leaves: hex('#3f8f2a'), leavesDark: hex('#2d6c1e'),
  water: hex('#3f76e4'), waterLight: hex('#5b8ff0'), waterDark: hex('#2f5fc4'),
  ice: hex('#a5c8f5'), iceLight: hex('#cbe2ff'), iceDark: hex('#8ab3ea'),
  glass: hex('#ffffff'),
  bedrock: hex('#565656'),
  coal: hex('#2b2b2b'), coalLight: hex('#444444'),
  iron: hex('#d8af93'), ironBlock: hex('#e6e6e6'), ironDark: hex('#a8a8a8'),
  gold: hex('#fcee4b'), goldBlock: hex('#f8d93a'), goldDark: hex('#c9a71a'),
  diamond: hex('#5decf5'), diamondBlock: hex('#6df0f8'), diamondDark: hex('#3fb9c4'),
  lapis: hex('#2a4fd8'), lapisBlock: hex('#2f5fd6'), lapisDark: hex('#1d3a99'), lapisLight: hex('#4f7ff0'),
  redstone: hex('#ff2a2a'), emerald: hex('#17dd62'), emeraldDark: hex('#0f9a44'),
  netherite: hex('#4a4145'), netheriteDark: hex('#2d272a'), netheriteLight: hex('#6a5d63'),
  netherrack: hex('#7a3535'), netherrackDark: hex('#5c2626'), netherrackLight: hex('#964444'),
  soulsand: hex('#5a4a3b'), soulsandDark: hex('#3e3229'),
  glowstone: hex('#e9c77a'), glowstoneBright: hex('#fff2b0'), glowstoneDark: hex('#b48c48'),
  netherbrick: hex('#2e1618'), netherbrickLight: hex('#4a2426'),
  magma: hex('#3b2a26'), magmaGlow: hex('#ff7a1a'), magmaBright: hex('#ffd24a'),
  debris: hex('#5e4a3f'), debrisDark: hex('#3f3129'), debrisLight: hex('#7a6152'),
  quartz: hex('#f2ece4'),
  lava: hex('#d84f1a'), lavaBright: hex('#ffd83a'), lavaDark: hex('#a32d0d'),
  obsidian: hex('#14101f'), obsidianLight: hex('#2c2340'), obsidianPurple: hex('#4b3a6b'),
  portal: hex('#8b2fd8'), portalLight: hex('#c777ff'), portalDark: hex('#4a0f80'),
  black: hex('#000000'), white: hex('#ffffff'), stick: hex('#8b5a2b'),
  torchFlame: hex('#ffcc33'), torchCore: hex('#ff8a1a'),
};

// Tool / ingot material palettes  [dark, mid, light]
export const MATERIALS = {
  wood:      [hex('#5e3d1f'), hex('#8b5a2b'), hex('#b07a45')],
  stone:     [hex('#5f5f5f'), hex('#8a8a8a'), hex('#b0b0b0')],
  iron:      [hex('#9a9a9a'), hex('#d8d8d8'), hex('#ffffff')],
  gold:      [hex('#b8860b'), hex('#f7d23e'), hex('#fff59a')],
  diamond:   [hex('#2ea7ad'), hex('#4fe3e8'), hex('#bafcff')],
  netherite: [hex('#2d272a'), hex('#4d4448'), hex('#736870')],
  lapis:     [hex('#1d3a99'), hex('#2f5fd6'), hex('#6f95f5')],
  emerald:   [hex('#0f9a44'), hex('#17dd62'), hex('#8dffb8')],
  redstone:  [hex('#8a0000'), hex('#ff2a2a'), hex('#ff8a8a')],
  coal:      [hex('#111111'), hex('#2b2b2b'), hex('#555555')],
};

// ------------------------------------------------------------- block tiles
const ORE_SPOTS = [
  [2, 2], [3, 2], [2, 3], [3, 3], [4, 3],
  [10, 1], [11, 1], [11, 2], [12, 2],
  [6, 7], [7, 7], [7, 8], [8, 8], [6, 8],
  [12, 10], [13, 10], [13, 11], [12, 11], [14, 11],
  [2, 12], [3, 12], [3, 13], [4, 13], [2, 13],
  [8, 13], [9, 13], [9, 14], [8, 14],
];

function stone(px, rand) {
  px.noise(rand, C.stone, 0.10);
  px.speckle(rand, C.stoneDark, 14);
  px.speckle(rand, C.stoneLight, 8);
}
function ore(px, rand, base, mat) {
  base(px, rand);
  ORE_SPOTS.forEach(([x, y], i) => px.set(x, y, i % 3 === 0 ? mat[2] : i % 3 === 1 ? mat[1] : mat[0]));
}
function dirt(px, rand) {
  px.noise(rand, C.dirt, 0.12);
  px.speckle(rand, C.dirtDark, 16);
  px.speckle(rand, C.dirtLight, 10);
}
function grassTop(px, rand) {
  px.noise(rand, C.grass, 0.10);
  px.speckle(rand, C.grassDark, 18);
  px.speckle(rand, C.grassLight, 10);
}
function grassSide(px, rand, top = C.grass, topDark = C.grassDark, topLight = C.grassLight) {
  dirt(px, rand);
  for (let x = 0; x < 16; x++) {
    const h = 2 + ((rand() * 3) | 0);
    for (let y = 0; y < h; y++) px.set(x, y, shade(top, 1 + (rand() * 2 - 1) * 0.1));
    if (rand() < 0.4) px.set(x, h, topDark);
  }
  px.speckle(rand, topLight, 4);
}
function snow(px, rand) { px.noise(rand, C.snow, 0.03); px.speckle(rand, C.snowShade, 10); }
function sand(px, rand) { px.noise(rand, C.sand, 0.06); px.speckle(rand, C.sandDark, 12); }
function gravel(px, rand) {
  px.noise(rand, C.gravel, 0.12);
  for (let i = 0; i < 9; i++) {
    const x = (rand() * 14) | 0, y = (rand() * 14) | 0, c = shade(C.gravel, 0.7 + rand() * 0.6);
    px.rect(x, y, 2, 2, c);
  }
}
function cobble(px, rand, base = C.stone, grout = C.stoneDark) {
  px.fill(grout);
  const cells = [[0, 0, 5, 4], [6, 0, 4, 4], [11, 0, 5, 4], [0, 5, 3, 5], [4, 5, 6, 5], [11, 5, 5, 5], [0, 11, 5, 5], [6, 11, 4, 5], [11, 11, 5, 5]];
  cells.forEach(([x, y, w, h]) => {
    const k = 0.85 + rand() * 0.3;
    px.rect(x, y, w, h, shade(base, k));
    px.hline(x, x + w - 1, y, shade(base, k * 1.12));
    px.vline(x + w - 1, y, y + h - 1, shade(base, k * 0.85));
  });
}
function bedrock(px, rand) { px.noise(rand, C.bedrock, 0.35); }
function logSide(px, rand) {
  for (let x = 0; x < 16; x++) {
    const c = [C.wood, C.woodLight, C.woodDark, C.wood][(x + ((rand() * 2) | 0)) % 4];
    px.vline(x, 0, 15, c);
  }
  px.grain(rand, 0.08);
}
function logTop(px, rand) {
  px.noise(rand, C.wood, 0.06);
  px.rect(2, 2, 12, 12, C.logTop);
  px.rect(3, 3, 10, 10, C.logRing); px.rect(4, 4, 8, 8, C.logTop);
  px.rect(5, 5, 6, 6, C.logRing); px.rect(6, 6, 4, 4, C.logTop);
  px.rect(7, 7, 2, 2, C.logRing);
  px.grain(rand, 0.05);
}
function planks(px, rand) {
  px.noise(rand, C.planks, 0.06);
  [0, 4, 8, 12].forEach((y, i) => {
    px.hline(0, 15, y + 3, C.planksDark);
    px.hline(0, 15, y, C.planksLight);
    const seam = (i * 5 + 3) % 16;
    px.vline(seam, y, y + 2, C.planksDark);
  });
}
function leaves(px, rand) {
  px.noise(rand, C.leaves, 0.18);
  px.speckle(rand, C.leavesDark, 30);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (rand() < 0.14) px.set(x, y, C.black, 0);
}
function water(px, rand, frame = 0) {
  px.noise(rand, C.water, 0.05, 190);
  for (let i = 0; i < 6; i++) {
    const y = (i * 3 + frame) % 16;
    const x0 = (i * 5 + frame * 2) % 16;
    px.set(x0, y, C.waterLight, 200); px.set((x0 + 1) % 16, y, C.waterLight, 200); px.set((x0 + 2) % 16, y, C.waterDark, 200);
  }
}
function ice(px, rand) {
  px.noise(rand, C.ice, 0.04, 235);
  px.speckle(rand, C.iceLight, 14, 235);
  // crack lines
  [[2, 1, 6, 5], [6, 5, 5, 10], [10, 3, 13, 8], [1, 12, 6, 14], [12, 9, 15, 13]].forEach(([x0, y0, x1, y1]) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) px.set(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), C.iceLight, 235);
  });
  px.bevel(C.iceLight, C.iceDark);
}
function glass(px) {
  px.fill(C.white, 0);
  px.border(mix(C.white, C.ice, 0.35));
  for (let i = 2; i < 7; i++) px.set(i, 8 - i + 1, C.white, 140);
  for (let i = 3; i < 6; i++) px.set(i + 3, 12 - i, C.white, 110);
}
function metalBlock(px, rand, mat) {
  px.noise(rand, mat[1], 0.03);
  px.bevel(mat[2], mat[0]);
  px.bevel(mix(mat[1], mat[2], 0.5), mix(mat[1], mat[0], 0.5), 1);
  px.rect(3, 3, 10, 10, mat[1]);
  px.bevel(mat[0], mat[2], 3);
}
function netherrack(px, rand) {
  px.noise(rand, C.netherrack, 0.14);
  px.speckle(rand, C.netherrackDark, 20);
  px.speckle(rand, C.netherrackLight, 12);
}
function soulsand(px, rand) {
  px.noise(rand, C.soulsand, 0.1);
  px.speckle(rand, C.soulsandDark, 16);
  // faint faces
  [[3, 4], [10, 3], [6, 11]].forEach(([x, y]) => { px.set(x, y, C.soulsandDark); px.set(x + 2, y, C.soulsandDark); px.hline(x, x + 2, y + 2, C.soulsandDark); });
}
function glowstone(px, rand) {
  px.noise(rand, C.glowstone, 0.08);
  px.speckle(rand, C.glowstoneDark, 20);
  for (let i = 0; i < 7; i++) { const x = (rand() * 14) | 0, y = (rand() * 14) | 0; px.rect(x, y, 2, 2, C.glowstoneBright); }
}
function netherBricks(px, rand) {
  px.fill(C.netherbrick);
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 4 : 0;
    for (let col = -1; col < 3; col++) {
      const x = col * 8 + off, y = row * 4;
      px.rect(x + 1, y + 1, 6, 2, shade(C.netherbrickLight, 0.9 + rand() * 0.25));
    }
  }
}
function magma(px, rand, frame = 0) {
  px.noise(rand, C.magma, 0.12);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = Math.sin((x + frame) * 0.9) + Math.cos((y - frame * 0.5) * 1.1);
    if (v > 1.2) px.set(x, y, C.magmaBright); else if (v > 0.7) px.set(x, y, C.magmaGlow);
  }
}
function ancientDebrisSide(px, rand) {
  px.noise(rand, C.debris, 0.1);
  px.speckle(rand, C.debrisDark, 18); px.speckle(rand, C.debrisLight, 10);
  px.rect(2, 3, 5, 3, C.debrisDark); px.rect(9, 8, 5, 4, C.debrisDark); px.rect(4, 11, 3, 3, C.debrisLight);
}
function ancientDebrisTop(px, rand) {
  px.noise(rand, C.debris, 0.08);
  px.rect(3, 3, 10, 10, C.debrisDark); px.rect(5, 5, 6, 6, C.debris); px.rect(7, 7, 2, 2, C.debrisLight);
}
function lava(px, rand, frame = 0) {
  px.noise(rand, C.lava, 0.08);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = Math.sin((x + frame * 0.7) * 0.8) * Math.cos((y + frame * 0.4) * 0.9);
    if (v > 0.55) px.set(x, y, C.lavaBright); else if (v < -0.55) px.set(x, y, C.lavaDark);
  }
}
function obsidian(px, rand) {
  px.noise(rand, C.obsidian, 0.15);
  px.speckle(rand, C.obsidianLight, 18);
  px.speckle(rand, C.obsidianPurple, 6);
}
function portal(px, rand, frame = 0) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = x - 7.5, dy = y - 7.5;
    const ang = Math.atan2(dy, dx), r = Math.sqrt(dx * dx + dy * dy);
    const v = Math.sin(ang * 3 + r * 0.9 - frame * 0.6);
    const c = v > 0.5 ? C.portalLight : v < -0.5 ? C.portalDark : C.portal;
    px.set(x, y, shade(c, 0.9 + rand() * 0.2), 210);
  }
}
function craftingTop(px, rand) {
  planks(px, rand);
  px.rect(2, 2, 12, 12, C.planksDark);
  px.rect(3, 3, 10, 10, C.planks);
  px.hline(3, 12, 6, C.planksDark); px.hline(3, 12, 9, C.planksDark);
  px.vline(6, 3, 12, C.planksDark); px.vline(9, 3, 12, C.planksDark);
}
function craftingSide(px, rand) {
  planks(px, rand);
  px.rect(0, 0, 16, 3, C.planksLight);
  px.hline(0, 15, 3, C.planksDark);
  // saw + hammer silhouettes
  px.rect(2, 6, 5, 2, C.stoneLight); px.rect(2, 8, 1, 5, C.stick);
  px.rect(10, 5, 3, 2, C.stoneDark); px.vline(11, 7, 12, C.stick);
}
function craftingFront(px, rand) {
  planks(px, rand);
  px.rect(0, 0, 16, 3, C.planksLight);
  px.hline(0, 15, 3, C.planksDark);
  px.rect(4, 6, 8, 8, C.planksDark); px.rect(5, 7, 6, 6, C.planksLight);
}
function furnaceFront(px, rand, lit = false, frame = 0) {
  cobble(px, rand);
  px.rect(4, 8, 8, 6, C.black);
  px.rect(3, 8, 10, 1, C.stoneDark);
  if (lit) {
    for (let x = 5; x < 11; x++) {
      const h = 2 + (((x * 7 + frame) % 3));
      for (let y = 13; y > 13 - h; y--) px.set(x, y, y === 13 - h + 1 ? C.lavaBright : C.magmaGlow);
    }
  }
}
function torch(px) {
  px.fill(C.black, 0);
  px.rect(7, 6, 2, 10, C.stick); px.vline(7, 6, 15, C.woodLight);
  px.rect(6, 3, 4, 3, C.torchCore); px.rect(7, 2, 2, 1, C.torchFlame); px.rect(7, 4, 2, 1, C.torchFlame);
}
function tnt(px, rand) {
  px.fill(hex('#db2b19'));
  px.rect(0, 5, 16, 6, C.white); px.rect(0, 6, 16, 4, hex('#e8e8e8'));
  px.rect(3, 7, 10, 2, hex('#333333'));
  px.speckle(rand, hex('#a51d10'), 14);
}
function bookshelf(px, rand) {
  planks(px, rand);
  px.rect(1, 1, 14, 6, C.woodDark); px.rect(1, 9, 14, 6, C.woodDark);
  const cols = [hex('#b33'), hex('#38a'), hex('#3a5'), hex('#dc3'), hex('#a4d')];
  for (let i = 0; i < 6; i++) { px.rect(2 + i * 2, 2, 2, 5, cols[(i * 3) % 5]); px.rect(2 + i * 2, 10, 2, 5, cols[(i * 2 + 1) % 5]); }
}
function crack(px, stage) {
  px.fill(C.black, 0);
  const rand = rng(777);
  const rays = [];
  for (let i = 0; i < 10; i++) {
    let x = 7.5, y = 7.5, a = (i / 10) * Math.PI * 2 + rand() * 0.6;
    const pts = [];
    for (let s = 0; s < 12; s++) { x += Math.cos(a); y += Math.sin(a); a += (rand() - 0.5) * 1.2; pts.push([Math.round(x), Math.round(y)]); }
    rays.push(pts);
  }
  const len = 1 + stage * 1.2;
  rays.forEach((pts, i) => {
    const n = Math.min(pts.length, Math.round(len + (i % 3)));
    for (let k = 0; k < n; k++) px.set(pts[k][0], pts[k][1], C.black, 150 + stage * 8);
  });
}

// ------------------------------------------------------------- item tiles
const PICKAXE = [
  '................',
  '......mmmmmm....',
  '.....mMMMMMmm...',
  '....mM.....dmm..',
  '....mM......dm..',
  '....md....h..d..',
  '....d....h......',
  '........h.......',
  '.......h........',
  '......h.........',
  '.....h..........',
  '....h...........',
  '...h............',
  '..h.............',
  '.h..............',
  '................',
];
const AXE = [
  '................',
  '.......mmm......',
  '......mMMmm.....',
  '.....mMMMMm.....',
  '.....mMMMMmd....',
  '.....mMMMdd.....',
  '......mmdh......',
  '........h.......',
  '.......h........',
  '......h.........',
  '.....h..........',
  '....h...........',
  '...h............',
  '..h.............',
  '.h..............',
  '................',
];
const SHOVEL = [
  '................',
  '..........mmm...',
  '.........mMMMm..',
  '.........mMMMm..',
  '.........mMMMd..',
  '.........mMMd...',
  '.........hdd....',
  '........h.......',
  '.......h........',
  '......h.........',
  '.....h..........',
  '....h...........',
  '...h............',
  '..h.............',
  '.h..............',
  '................',
];
const SWORD = [
  '..............MM',
  '.............MMm',
  '............MMm.',
  '...........MMm..',
  '..........MMm...',
  '.........MMm....',
  '........MMm.....',
  '..dd...MMm......',
  '...dd.MMm.......',
  '....ddMm........',
  '....hhdd........',
  '...h.hddd.......',
  '..h.............',
  '.h..............',
  '................',
  '................',
];
const INGOT = [
  '................',
  '................',
  '................',
  '................',
  '.....LLLLLLLL...',
  '....LMMMMMMMMd..',
  '...LMMMMMMMMMd..',
  '..LMMMMMMMMMMd..',
  '..dMMMMMMMMMd...',
  '..dddddddddd....',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];
const GEM = [
  '................',
  '................',
  '......LLLL......',
  '.....LLMMML.....',
  '....LLMMMMML....',
  '...LMMMMMMMMd...',
  '...dMMMMMMMMd...',
  '....dMMMMMMd....',
  '.....dMMMMd.....',
  '......dMMd......',
  '.......dd.......',
  '................',
  '................',
  '................',
  '................',
  '................',
];
const LUMP = [
  '................',
  '................',
  '................',
  '.....MMMM.......',
  '....MLLMMM......',
  '...MMLMMMMM.....',
  '...MMMMMMMMd....',
  '....MMMMMMMd....',
  '....dMMMMMdd....',
  '.....ddddd......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];
const STICK = [
  '................',
  '..............h.',
  '.............hH.',
  '............hH..',
  '...........hH...',
  '..........hH....',
  '.........hH.....',
  '........hH......',
  '.......hH.......',
  '......hH........',
  '.....hH.........',
  '....hH..........',
  '...hH...........',
  '..hH............',
  '.hH.............',
  '................',
];
const FLINT_STEEL = [
  '................',
  '................',
  '.....sss........',
  '....s...s.......',
  '...s.....s......',
  '...s.....s......',
  '....s...s.......',
  '.....sss.f......',
  '........fff.....',
  '.......fffff....',
  '.......fffff....',
  '........fff.....',
  '................',
  '................',
  '................',
  '................',
];
const ROD = [
  '................',
  '..............ss',
  '.............ss.',
  '............ss..',
  '...........ss...',
  '..........ss....',
  '.........ss.....',
  '........ss......',
  '.......ss.......',
  '......ss........',
  '.....ss.........',
  '....ss..........',
  '...ss...........',
  '..ss............',
  '.ss.............',
  '................',
];

const PORK = [
  '................',
  '................',
  '.....cccccc.....',
  '....cRRRRRRc....',
  '...cRRRrrRRRc...',
  '..cRRRRRRRRRRc..',
  '..cRRrRRRRrRRc..',
  '..cRRRRRRRRRc...',
  '...cRRRRRRRc.b..',
  '....ccccccc.bw..',
  '.............b..',
  '................',
  '................',
  '................',
  '................',
  '................',
];
function food(px, R, r, c) { px.fill(C.black, 0); px.map(PORK, { R: [R], r: [r], c: [c], b: [hex('#e8e0c8')], w: [C.white] }); }
function toolLegend(mat) {
  return { m: [mat[1]], M: [mat[2]], d: [mat[0]], h: [C.stick], H: [hex('#5e3d1f')] };
}
function tool(px, shape, matName) { px.fill(C.black, 0); px.map(shape, toolLegend(MATERIALS[matName])); }
function ingot(px, matName) { const m = MATERIALS[matName]; px.fill(C.black, 0); px.map(INGOT, { L: [m[2]], M: [m[1]], d: [m[0]] }); }
function gem(px, matName) { const m = MATERIALS[matName]; px.fill(C.black, 0); px.map(GEM, { L: [m[2]], M: [m[1]], d: [m[0]] }); }
function lump(px, matName) { const m = MATERIALS[matName]; px.fill(C.black, 0); px.map(LUMP, { L: [m[2]], M: [m[1]], d: [m[0]] }); }

// ------------------------------------------------------------ tile registry
// name -> painter(px, rand, frame). Order here = index order in the atlas.
export const PAINTERS = {
  // natural
  stone, dirt, grass_top: grassTop, grass_side: grassSide,
  snow, snow_grass_side: (px, r) => grassSide(px, r, C.snow, C.snowShade, C.white),
  sand, gravel, cobblestone: (px, r) => cobble(px, r), bedrock,
  oak_log_side: logSide, oak_log_top: logTop, oak_planks: planks, oak_leaves: leaves,
  water: (px, r, f) => water(px, r, f), ice, glass,
  // ores
  coal_ore: (px, r) => ore(px, r, stone, MATERIALS.coal),
  iron_ore: (px, r) => ore(px, r, stone, [C.ironDark, C.iron, C.ironBlock]),
  gold_ore: (px, r) => ore(px, r, stone, MATERIALS.gold),
  diamond_ore: (px, r) => ore(px, r, stone, MATERIALS.diamond),
  lapis_ore: (px, r) => ore(px, r, stone, MATERIALS.lapis),
  redstone_ore: (px, r) => ore(px, r, stone, MATERIALS.redstone),
  emerald_ore: (px, r) => ore(px, r, stone, MATERIALS.emerald),
  nether_quartz_ore: (px, r) => ore(px, r, netherrack, [C.stoneLight, C.quartz, C.white]),
  nether_gold_ore: (px, r) => ore(px, r, netherrack, MATERIALS.gold),
  // mineral blocks
  iron_block: (px, r) => metalBlock(px, r, MATERIALS.iron),
  gold_block: (px, r) => metalBlock(px, r, MATERIALS.gold),
  diamond_block: (px, r) => metalBlock(px, r, MATERIALS.diamond),
  lapis_block: (px, r) => metalBlock(px, r, MATERIALS.lapis),
  emerald_block: (px, r) => metalBlock(px, r, MATERIALS.emerald),
  netherite_block: (px, r) => metalBlock(px, r, MATERIALS.netherite),
  coal_block: (px, r) => metalBlock(px, r, MATERIALS.coal),
  // nether
  netherrack, soul_sand: soulsand, glowstone, nether_bricks: netherBricks,
  magma: (px, r, f) => magma(px, r, f),
  ancient_debris_side: ancientDebrisSide, ancient_debris_top: ancientDebrisTop,
  lava: (px, r, f) => lava(px, r, f),
  obsidian, nether_portal: (px, r, f) => portal(px, r, f),
  // utility
  crafting_table_top: craftingTop, crafting_table_side: craftingSide, crafting_table_front: craftingFront,
  furnace_front: (px, r) => furnaceFront(px, r, false),
  furnace_front_lit: (px, r, f) => furnaceFront(px, r, true, f),
  torch, tnt, bookshelf,
  // break overlay
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`destroy_stage_${i}`, (px) => crack(px, i)])),
  // items
  stick: (px) => { px.fill(C.black, 0); px.map(STICK, { h: [MATERIALS.wood[2]], H: [MATERIALS.wood[1]] }); },
  coal: (px) => lump(px, 'coal'),
  iron_ingot: (px) => ingot(px, 'iron'), gold_ingot: (px) => ingot(px, 'gold'), netherite_ingot: (px) => ingot(px, 'netherite'),
  netherite_scrap: (px) => lump(px, 'netherite'),
  diamond: (px) => gem(px, 'diamond'), emerald: (px) => gem(px, 'emerald'), lapis_lazuli: (px) => lump(px, 'lapis'),
  redstone_dust: (px) => lump(px, 'redstone'), quartz: (px) => gem(px, 'iron'),
  flint_and_steel: (px) => { px.fill(C.black, 0); px.map(FLINT_STEEL, { s: [MATERIALS.iron[1]], f: [C.stoneDark] }); },
  blaze_rod: (px) => { px.fill(C.black, 0); px.map(ROD, { s: [C.torchFlame] }); },
  porkchop: (px) => food(px, hex('#ef9a9a'), hex('#d97a7a'), hex('#b85555')),
  cooked_porkchop: (px) => food(px, hex('#b9743a'), hex('#9a5a28'), hex('#6b3c1a')),
  snowball: (px) => { px.fill(C.black, 0); px.rect(5, 5, 6, 6, C.snow); px.rect(4, 6, 8, 4, C.snow); px.rect(6, 4, 4, 8, C.snow); px.set(6, 6, C.white); px.set(9, 9, C.snowShade); },
  ...Object.fromEntries(['wood', 'stone', 'iron', 'gold', 'diamond', 'netherite'].flatMap((m) => [
    [`${m}_pickaxe`, (px) => tool(px, PICKAXE, m)],
    [`${m}_axe`, (px) => tool(px, AXE, m)],
    [`${m}_shovel`, (px) => tool(px, SHOVEL, m)],
    [`${m}_sword`, (px) => tool(px, SWORD, m)],
  ])),
};

export const TILE_NAMES = Object.keys(PAINTERS);
export const ANIMATED_TILES = { water: 8, lava: 6, nether_portal: 12, magma: 6, furnace_front_lit: 8 }; // name -> fps

// Deterministic seed per tile so each texture is stable.
function seedFor(name) { let h = 2166136261; for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function paintPixels(name, frame = 0) {
  const p = PAINTERS[name];
  if (!p) throw new Error(`Unknown tile: ${name}`);
  const px = new Pixels();
  p(px, rng(seedFor(name)), frame);
  return px;
}
export function paintTile(name, frame = 0) { return paintPixels(name, frame).toCanvas(); }

export function buildAtlas() {
  const cols = ATLAS_COLS;
  const rows = Math.ceil(TILE_NAMES.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * TILE; canvas.height = rows * TILE;
  const ctx = canvas.getContext('2d');
  const tiles = {};
  TILE_NAMES.forEach((name, i) => {
    const x = (i % cols) * TILE, y = Math.floor(i / cols) * TILE;
    ctx.putImageData(new ImageData(paintPixels(name).data, TILE, TILE), x, y);
    tiles[name] = {
      index: i, x, y,
      // UV in texture space with v flipped for WebGL (0 = bottom).
      u0: x / canvas.width, u1: (x + TILE) / canvas.width,
      v0: 1 - (y + TILE) / canvas.height, v1: 1 - y / canvas.height,
    };
  });
  return { canvas, tiles, cols, rows, uv: (name) => tiles[name] };
}

// A standalone texture whose frames are repainted over time. Use for water,
// lava and portal blocks (put them in their own mesh with this texture).
export function animatedTexture(name, fps = ANIMATED_TILES[name] || 8) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  const frames = [];
  for (let f = 0; f < 16; f++) frames.push(new ImageData(paintPixels(name, f).data, TILE, TILE));
  let last = -1;
  return {
    canvas,
    update(t) {
      const f = Math.floor(t * fps) % frames.length;
      if (f === last) return false;
      last = f; ctx.putImageData(frames[f], 0, 0); return true;
    },
  };
}
