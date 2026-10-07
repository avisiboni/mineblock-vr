// ============================================================================
// Mineblock — furnace tile-entity logic (pure)
// ============================================================================
import { SMELTING } from './blocks.js';

export const FUEL = { coal: 80, oak_planks: 15, oak_log: 15, blaze_rod: 120, stick: 5 };
export const SMELT = { ...SMELTING, porkchop: 'cooked_porkchop' };
export const SMELT_TIME = 10;

export const newFurnace = () => ({ input: null, fuel: null, output: null, progress: 0, burn: 0, burnMax: 1 });

// Advance a furnace by dt seconds. Returns true while burning.
export function tickFurnace(te, dt) {
  if (te.burn > 0) te.burn = Math.max(0, te.burn - dt);
  const out = te.input && SMELT[te.input.item];
  const room = out && (!te.output || (te.output.item === out && te.output.count < 64));
  if (out && room) {
    if (te.burn <= 0 && te.fuel && FUEL[te.fuel.item]) {
      te.burn = te.burnMax = FUEL[te.fuel.item];
      te.fuel.count--; if (te.fuel.count <= 0) te.fuel = null;
    }
    if (te.burn > 0) {
      te.progress += dt;
      if (te.progress >= SMELT_TIME) {
        te.progress = 0;
        te.input.count--; if (te.input.count <= 0) te.input = null;
        if (te.output) te.output.count++; else te.output = { item: out, count: 1 };
      }
    } else te.progress = Math.max(0, te.progress - dt * 2);
  } else te.progress = Math.max(0, te.progress - dt * 2);
  return te.burn > 0;
}
