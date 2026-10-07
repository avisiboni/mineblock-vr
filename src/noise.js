// ============================================================================
// Mineblock — seeded gradient noise (improved Perlin) + helpers. Pure, no DOM.
// ============================================================================
export function mulberry32(a) {
  a >>>= 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Deterministic integer hash -> [0,1)
export function hash3(seed, x, y, z) {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
export function seedFromString(s) {
  if (s === '' || s == null) return (Math.random() * 2 ** 31) | 0;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10) | 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

const GRAD = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export class Noise {
  constructor(seed) {
    const rnd = mulberry32(seed);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
    this.perm = new Uint8Array(512);
    this.pg = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { this.perm[i] = p[i & 255]; this.pg[i] = this.perm[i] % 12; }
  }
  // 3-D noise in roughly [-1, 1]
  noise3(x, y, z) {
    const P = this.perm, G = this.pg;
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = P[xi] + yi, AA = P[A] + zi, AB = P[A + 1] + zi, B = P[xi + 1] + yi, BA = P[B] + zi, BB = P[B + 1] + zi;
    const d = (h, a, b, c) => { const g = GRAD[G[h]]; return g[0] * a + g[1] * b + g[2] * c; };
    const l = (a, b, t) => a + t * (b - a);
    return l(
      l(l(d(AA, x, y, z), d(BA, x - 1, y, z), u), l(d(AB, x, y - 1, z), d(BB, x - 1, y - 1, z), u), v),
      l(l(d(AA + 1, x, y, z - 1), d(BA + 1, x - 1, y, z - 1), u), l(d(AB + 1, x, y - 1, z - 1), d(BB + 1, x - 1, y - 1, z - 1), u), v),
      w) * 1.15;
  }
  noise2(x, y) { return this.noise3(x, y, 0.5); }
  fbm2(x, y, oct = 4, lac = 2, gain = 0.5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * this.noise2(x * f, y * f); n += a; a *= gain; f *= lac; }
    return s / n;
  }
}
