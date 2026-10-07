// ============================================================================
// Mineblock — world generation (pure, no THREE / DOM)
// ----------------------------------------------------------------------------
//   new Generator(seed)            -> terrain/biome/nether generators
//   gen.generateChunk(chunk, dimensionName)
// Chunk = { cx, cz, blocks: Uint8Array(16*128*16) }  index = x + 16*z + 256*y
// Everything is a pure function of (seed, coordinates) so neighbours agree
// without needing each other (trees and ores are clipped to the chunk).
// ============================================================================
import { Noise, mulberry32, hash3 } from './noise.js';
import { BLOCK_ID } from './blocks.js';

export const CH = 16, HT = 128, SEA = 62;
const B = BLOCK_ID;
const { air, stone, dirt, grass, snow_grass, snow, sand, gravel, bedrock, oak_log, oak_leaves, water, ice, lava } = B;

export class Generator {
  constructor(seed) {
    this.seed = seed | 0;
    this.nCont = new Noise(seed + 1);
    this.nHill = new Noise(seed + 2);
    this.nDetail = new Noise(seed + 3);
    this.nTemp = new Noise(seed + 4);
    this.nHum = new Noise(seed + 5);
    this.nCave1 = new Noise(seed + 6);
    this.nCave2 = new Noise(seed + 7);
    this.nMisc = new Noise(seed + 8);
    this.nNether1 = new Noise(seed + 9);
    this.nNether2 = new Noise(seed + 10);
    this.nNether3 = new Noise(seed + 11);
  }

  // ---------------- overworld column info (pure function of x,z)
  columnInfo(x, z) {
    const cont = this.nCont.fbm2(x * 0.0035, z * 0.0035, 3);
    const hills = this.nHill.fbm2(x * 0.012, z * 0.012, 3);
    const detail = this.nDetail.noise2(x * 0.06, z * 0.06);
    let h = 67 + cont * 24 + hills * 9 + detail * 1.5;
    h = Math.max(4, Math.min(118, Math.floor(h)));
    const temp = this.nTemp.fbm2(x * 0.0028 + 100, z * 0.0028, 2);
    const hum = this.nHum.fbm2(x * 0.0035 - 200, z * 0.0035, 2);
    let biome = 'plains';
    if (temp < -0.2) biome = 'snow';
    else if (temp > 0.16 && hum < 0.05) biome = 'desert';
    else if (hum > 0.12) biome = 'forest';
    return { h, biome, detail, hum };
  }

  generateChunk(chunk, dimension = 'overworld') {
    if (dimension === 'nether') return this.generateNether(chunk);
    return this.generateOverworld(chunk);
  }

  generateOverworld(chunk) {
    const { cx, cz, blocks } = chunk;
    const ox = cx * CH, oz = cz * CH;
    // column info for chunk + 2-block margin (for trees)
    const M = 3, S = CH + 2 * M;
    const info = new Array(S * S);
    for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) info[x + z * S] = this.columnInfo(ox + x - M, oz + z - M);
    const at = (lx, lz) => info[(lx + M) + (lz + M) * S];
    let maxY = SEA + 1;

    // --- caves: sampled on a coarse lattice and trilinearly interpolated
    const GX = 5, GY = 33, GZ = 5;
    const f1 = new Float32Array(GX * GY * GZ), f2 = new Float32Array(GX * GY * GZ);
    for (let gz = 0; gz < GZ; gz++) for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
      const wx = ox + gx * 4, wy = gy * 4, wz = oz + gz * 4, i = gx + GX * (gy + GY * gz);
      f1[i] = this.nCave1.noise3(wx * 0.022, wy * 0.035, wz * 0.022);
      f2[i] = this.nCave2.noise3(wx * 0.022 + 50, wy * 0.035, wz * 0.022 + 50);
    }
    const lerp3 = (F, lx, y, lz) => {
      const fx = lx / 4, fy = y / 4, fz = lz / 4;
      const x0 = Math.min(3, fx | 0), y0 = Math.min(31, fy | 0), z0 = Math.min(3, fz | 0);
      const tx = fx - x0, ty = fy - y0, tz = fz - z0;
      const g = (a, b, c) => F[(x0 + a) + GX * ((y0 + b) + GY * (z0 + c))];
      const l = (a, b, t) => a + (b - a) * t;
      return l(l(l(g(0, 0, 0), g(1, 0, 0), tx), l(g(0, 1, 0), g(1, 1, 0), tx), ty), l(l(g(0, 0, 1), g(1, 0, 1), tx), l(g(0, 1, 1), g(1, 1, 1), tx), ty), tz);
    };

    for (let lz = 0; lz < CH; lz++) for (let lx = 0; lx < CH; lx++) {
      const { h, biome, detail } = at(lx, lz);
      const wx = ox + lx, wz = oz + lz;
      const beach = h <= SEA + 2 && h >= SEA - 3 && biome !== 'snow';
      const ocean = h < SEA - 3;
      const top = biome === 'desert' || beach ? sand : biome === 'snow' ? snow_grass : grass;
      for (let y = 0; y <= h; y++) {
        let id = stone;
        if (y === 0) id = bedrock;
        else if (y <= 3 && this.nMisc.noise3(wx * 0.9, y * 0.9, wz * 0.9) > 0.1) id = bedrock;
        else if (y === h) id = ocean ? (this.nMisc.noise2(wx * 0.1, wz * 0.1) > 0.3 ? gravel : sand) : (h < SEA ? (beach ? sand : dirt) : top);
        else if (y >= h - 3) id = ocean ? sand : (beach || biome === 'desert' ? sand : dirt);
        // caves (never near the surface of water, never right at the floor)
        if (id === stone && y > 5 && y < h - 4) {
          const a = lerp3(f1, lx, y, lz), b = lerp3(f2, lx, y, lz);
          if (Math.abs(a) < 0.085 && Math.abs(b) < 0.085) id = air;
        }
        blocks[lx + 16 * lz + 256 * y] = id;
      }
      // water
      for (let y = h + 1; y <= SEA; y++) blocks[lx + 16 * lz + 256 * y] = (biome === 'snow' && y === SEA) ? ice : water;
      if (biome === 'snow' && h >= SEA && detail > 0.2 && h + 1 < HT) blocks[lx + 16 * lz + 256 * (h + 1)] = snow;
      maxY = Math.max(maxY, h + 2);
    }

    // --- ores: random-walk blobs clipped to this chunk
    const rnd = mulberry32(this.seed ^ Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663));
    const centreBiome = at(8, 8).biome;
    const ORES = [
      [B.coal_ore, 20, 5, 100, 7], [B.iron_ore, 16, 5, 60, 5], [B.gold_ore, 4, 5, 32, 4],
      [B.lapis_ore, 3, 5, 30, 4], [B.redstone_ore, 8, 5, 16, 5], [B.diamond_ore, 2, 5, 14, 4],
      [B.emerald_ore, centreBiome === 'snow' ? 2 : 0, 5, 30, 1],
      [gravel, 6, 5, 100, 10], [dirt, 6, 5, 100, 10],
    ];
    for (const [id, count, y0, y1, size] of ORES) {
      for (let n = 0; n < count; n++) {
        let x = (rnd() * 16) | 0, z = (rnd() * 16) | 0, y = y0 + ((rnd() * (y1 - y0)) | 0);
        const s = Math.max(1, (size * (0.6 + rnd() * 0.8)) | 0);
        for (let i = 0; i < s; i++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < HT) { const k = x + 16 * z + 256 * y; if (blocks[k] === stone) blocks[k] = id; }
          x += ((rnd() * 3) | 0) - 1; y += ((rnd() * 3) | 0) - 1; z += ((rnd() * 3) | 0) - 1;
        }
      }
    }

    // --- trees: candidate origins from chunk + margin, deterministic by position
    for (let lz = -2; lz < CH + 2; lz++) for (let lx = -2; lx < CH + 2; lx++) {
      const inf = at(lx, lz);
      if (inf.biome === 'desert' || inf.h <= SEA + 1) continue;
      const wx = ox + lx, wz = oz + lz;
      const density = inf.biome === 'forest' ? 0.022 : inf.biome === 'snow' ? 0.006 : 0.004;
      if (hash3(this.seed, wx, 7, wz) > density) continue;
      const th = 4 + ((hash3(this.seed, wx, 11, wz) * 3) | 0);
      const base = inf.h + (inf.biome === 'snow' && inf.detail > 0.2 ? 1 : 0);
      const topY = base + th;
      if (topY + 2 >= HT) continue;
      const put = (x, y, z, id, onlyAir) => {
        if (x < 0 || x >= 16 || z < 0 || z >= 16) return;
        const k = x + 16 * z + 256 * y;
        if (onlyAir && blocks[k] !== air) return;
        blocks[k] = id;
      };
      for (let dy = -2; dy <= 1; dy++) {
        const r = dy <= -1 ? 2 : 1, y = topY + dy;
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 && hash3(this.seed, wx + dx, y, wz + dz) < 0.5) continue;
          if (dy === 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
          put(lx + dx, y, lz + dz, oak_leaves, true);
        }
      }
      for (let y = base + 1; y <= topY; y++) put(lx, y, lz, oak_log, false);
      maxY = Math.max(maxY, topY + 2);
    }
    chunk.maxY = Math.min(HT - 1, maxY + 1);
  }

  // ---------------- Nether
  generateNether(chunk) {
    const { cx, cz, blocks } = chunk;
    const ox = cx * CH, oz = cz * CH;
    const GX = 5, GY = 33, GZ = 5;
    const dens = new Float32Array(GX * GY * GZ);
    for (let gz = 0; gz < GZ; gz++) for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
      const wx = ox + gx * 4, wy = gy * 4, wz = oz + gz * 4;
      // density > 0 = rock. Solid near floor and ceiling, open cavern in between.
      const edge = Math.pow(Math.abs(wy - 64) / 62, 3) * 1.4;
      const n = this.nNether1.noise3(wx * 0.018, wy * 0.03, wz * 0.018) * 0.9 + this.nNether2.noise3(wx * 0.06, wy * 0.08, wz * 0.06) * 0.25;
      dens[gx + GX * (gy + GY * gz)] = n + edge - 0.12;
    }
    const lerp3 = (lx, y, lz) => {
      const fx = lx / 4, fy = y / 4, fz = lz / 4;
      const x0 = Math.min(3, fx | 0), y0 = Math.min(31, fy | 0), z0 = Math.min(3, fz | 0);
      const tx = fx - x0, ty = fy - y0, tz = fz - z0;
      const g = (a, b, c) => dens[(x0 + a) + GX * ((y0 + b) + GY * (z0 + c))];
      const l = (a, b, t) => a + (b - a) * t;
      return l(l(l(g(0, 0, 0), g(1, 0, 0), tx), l(g(0, 1, 0), g(1, 1, 0), tx), ty), l(l(g(0, 0, 1), g(1, 0, 1), tx), l(g(0, 1, 1), g(1, 1, 1), tx), ty), tz);
    };
    const LAVA = 30;
    for (let lz = 0; lz < CH; lz++) for (let lx = 0; lx < CH; lx++) {
      for (let y = 0; y < HT; y++) {
        let id;
        if (y === 0 || y === HT - 1) id = bedrock;
        else if ((y <= 3 || y >= HT - 4) && this.nMisc.noise3((ox + lx) * 0.8, y * 0.8, (oz + lz) * 0.8) > 0.1) id = bedrock;
        else id = lerp3(lx, y, lz) > 0 ? B.netherrack : (y <= LAVA ? lava : air);
        blocks[lx + 16 * lz + 256 * y] = id;
      }
    }
    // surface pass: soul sand patches, magma on lava shores
    for (let lz = 0; lz < CH; lz++) for (let lx = 0; lx < CH; lx++) {
      const wx = ox + lx, wz = oz + lz;
      const soul = this.nNether3.noise2(wx * 0.045, wz * 0.045) > 0.35;
      for (let y = 2; y < HT - 2; y++) {
        const k = lx + 16 * lz + 256 * y;
        if (blocks[k] !== B.netherrack) continue;
        const above = blocks[k + 256];
        if (above === air && soul) { blocks[k] = B.soul_sand; if (this.nNether3.noise3(wx * 0.2, y, wz * 0.2) > 0.2 && blocks[k - 256] === B.netherrack) blocks[k - 256] = B.soul_sand; }
        else if ((above === lava || (y >= LAVA - 1 && y <= LAVA + 1 && above === air)) && this.nNether3.noise3(wx * 0.15, y * 0.15, wz * 0.15) > 0.25) blocks[k] = B.magma;
      }
    }
    const rnd = mulberry32(this.seed ^ 0x5bd1e995 ^ Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663));
    const blob = (id, count, y0, y1, size, host = B.netherrack) => {
      for (let n = 0; n < count; n++) {
        let x = (rnd() * 16) | 0, z = (rnd() * 16) | 0, y = y0 + ((rnd() * (y1 - y0)) | 0);
        for (let i = 0, s = (size * (0.6 + rnd())) | 0; i < s; i++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < HT) { const k = x + 16 * z + 256 * y; if (blocks[k] === host) blocks[k] = id; }
          x += ((rnd() * 3) | 0) - 1; y += ((rnd() * 3) | 0) - 1; z += ((rnd() * 3) | 0) - 1;
        }
      }
    };
    blob(B.nether_quartz_ore, 12, 10, 117, 6);
    blob(B.nether_gold_ore, 8, 10, 117, 5);
    blob(B.gravel, 2, 10, 100, 8);
    // glowstone clusters hanging under ceilings (1 per ~3 chunks)
    if (rnd() < 0.5) {
      for (let tries = 0; tries < 12; tries++) {
        const lx = 2 + ((rnd() * 12) | 0), lz = 2 + ((rnd() * 12) | 0);
        let y = 118; while (y > 70 && blocks[lx + 16 * lz + 256 * y] !== B.netherrack) y--;
        // find a rock ceiling with air right below it
        let found = -1;
        for (let yy = 119; yy > 60; yy--) { const k = lx + 16 * lz + 256 * yy; if (blocks[k] === B.netherrack && blocks[k - 256] === air) { found = yy; break; } }
        if (found < 0) continue;
        for (let i = 0; i < 8; i++) {
          const x = lx + ((rnd() * 5) | 0) - 2, z = lz + ((rnd() * 5) | 0) - 2, y2 = found - ((rnd() * 4) | 0);
          if (x < 0 || x > 15 || z < 0 || z > 15) continue;
          const k = x + 16 * z + 256 * y2;
          if (blocks[k] === air || blocks[k] === B.netherrack) blocks[k] = B.glowstone;
        }
        break;
      }
    }
    // ancient debris: fully enclosed single blocks
    for (let n = 0, placed = 0; n < 40 && placed < 2; n++) {
      const x = 1 + ((rnd() * 14) | 0), z = 1 + ((rnd() * 14) | 0), y = 8 + ((rnd() * 15) | 0), k = x + 16 * z + 256 * y;
      if (blocks[k] !== B.netherrack) continue;
      if ([1, -1, 16, -16, 256, -256].every((d) => blocks[k + d] === B.netherrack)) { blocks[k] = B.ancient_debris; placed++; }
    }
    // nether-brick ruin (1 in 40 chunks), kept fully inside the chunk
    if (hash3(this.seed, cx, 99, cz) < 0.025) {
      let fy = -1;
      for (let y = 90; y > 35; y--) { const k = 8 + 16 * 8 + 256 * y; if (blocks[k] === B.netherrack && blocks[k + 256] === air && blocks[k + 512] === air) { fy = y; break; } }
      if (fy > 0) for (let x = 4; x < 11; x++) for (let z = 4; z < 11; z++) for (let y = fy; y < fy + 5; y++) {
        const wall = x === 4 || x === 10 || z === 4 || z === 10;
        const k = x + 16 * z + 256 * y;
        if (y === fy) blocks[k] = B.nether_bricks;
        else if (wall && !(z === 4 && x >= 7 && x <= 8 && y < fy + 3)) { if (y < fy + 3 || (x + z) % 2 === 0) blocks[k] = B.nether_bricks; else blocks[k] = air; }
        else blocks[k] = air;
      }
    }
    chunk.maxY = HT - 1;
  }
}
