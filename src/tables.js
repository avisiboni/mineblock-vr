// Per-block-id lookup tables shared by world, light, physics and the mesher.
import { BLOCKS, BLOCK_LIST } from './blocks.js';
const N = BLOCK_LIST.length;
export const SOLID = new Uint8Array(N);   // blocks movement
export const OPAQUE = new Uint8Array(N);  // blocks light + hides neighbour faces
export const LIQUID = new Uint8Array(N);
export const EMIT = new Uint8Array(N);    // block light emitted 0..15
BLOCK_LIST.forEach((k, i) => {
  const b = BLOCKS[k];
  SOLID[i] = b.solid ? 1 : 0;
  OPAQUE[i] = b.solid && !b.transparent ? 1 : 0;
  LIQUID[i] = b.liquid ? 1 : 0;
  EMIT[i] = b.light | 0;
});
