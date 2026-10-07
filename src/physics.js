// ============================================================================
// Mineblock — axis-separated AABB collision shared by player, mobs, items
// ----------------------------------------------------------------------------
// Entity shape: { x, y, z, w, h }  (x,z = centre, y = feet).  Solid cells are
// those with SOLID[id]; unloaded chunks read as stone so nothing falls out.
// ============================================================================
import { SOLID, LIQUID } from './tables.js';
import { BLOCK_ID } from './blocks.js';

const EPS = 1e-4;

// Move e along one axis (0=x,1=y,2=z) by a; returns the distance actually moved.
function sweep(dim, e, axis, a) {
  if (a === 0) return 0;
  const hw = e.w / 2;
  const min = [e.x - hw, e.y, e.z - hw], max = [e.x + hw, e.y + e.h, e.z + hw];
  const lo = [0, 0, 0], hi = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    lo[i] = Math.floor(min[i] + EPS); hi[i] = Math.floor(max[i] - EPS);
  }
  if (a > 0) hi[axis] = Math.floor(max[axis] + a - EPS); else lo[axis] = Math.floor(min[axis] + a + EPS);
  let limit = Math.abs(a);
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
    if (!SOLID[dim.getId(x, y, z)]) continue;
    const c = [x, y, z][axis];
    const dist = a > 0 ? c - max[axis] : min[axis] - (c + 1);
    if (dist < -EPS) continue;           // behind us / already overlapping
    if (dist < limit) limit = dist;
  }
  const moved = Math.max(0, limit - (limit < Math.abs(a) ? EPS : 0)) * Math.sign(a);
  if (axis === 0) e.x += moved; else if (axis === 1) e.y += moved; else e.z += moved;
  return moved;
}

// Applies dx,dy,dz with collision. Sets e.hitX/hitY/hitZ. Order: y, x, z.
export function moveBox(dim, e, dx, dy, dz) {
  const my = sweep(dim, e, 1, dy); e.hitY = Math.abs(my - dy) > 1e-6;
  const mx = sweep(dim, e, 0, dx); e.hitX = Math.abs(mx - dx) > 1e-6;
  const mz = sweep(dim, e, 2, dz); e.hitZ = Math.abs(mz - dz) > 1e-6;
  e.onGround = dy < 0 && e.hitY;
  return e;
}

// Is any cell overlapping the box (shrunk a little) of the given id?
export function touches(dim, e, id, shrink = 0.05) {
  const hw = e.w / 2 - shrink;
  for (let x = Math.floor(e.x - hw); x <= Math.floor(e.x + hw); x++)
    for (let y = Math.floor(e.y + shrink); y <= Math.floor(e.y + e.h - shrink); y++)
      for (let z = Math.floor(e.z - hw); z <= Math.floor(e.z + hw); z++)
        if (dim.getId(x, y, z) === id) return true;
  return false;
}
export function touchesLiquid(dim, e, shrink = 0.05) {
  const hw = e.w / 2 - shrink;
  for (let x = Math.floor(e.x - hw); x <= Math.floor(e.x + hw); x++)
    for (let y = Math.floor(e.y + shrink); y <= Math.floor(e.y + e.h - shrink); y++)
      for (let z = Math.floor(e.z - hw); z <= Math.floor(e.z + hw); z++)
        if (LIQUID[dim.getId(x, y, z)]) return dim.getId(x, y, z);
  return 0;
}
// Would the box overlap any solid block?
export function collides(dim, e, shrink = 0.0) {
  const hw = e.w / 2 - shrink;
  for (let x = Math.floor(e.x - hw); x <= Math.floor(e.x + hw - 1e-6); x++)
    for (let y = Math.floor(e.y + shrink); y <= Math.floor(e.y + e.h - shrink - 1e-6); y++)
      for (let z = Math.floor(e.z - hw); z <= Math.floor(e.z + hw - 1e-6); z++)
        if (SOLID[dim.getId(x, y, z)]) return true;
  return false;
}
export const WATER = BLOCK_ID.water, LAVA = BLOCK_ID.lava, PORTAL = BLOCK_ID.nether_portal, MAGMA = BLOCK_ID.magma;

// DDA voxel raycast. hit(id,x,y,z) decides what stops the ray.
const FACE_NAMES_FROM_STEP = { x: ['west', 'east'], y: ['bottom', 'top'], z: ['north', 'south'] };
export function raycast(dim, ox, oy, oz, dx, dy, dz, maxDist, hit) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity, tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = dx > 0 ? (x + 1 - ox) * tdx : dx < 0 ? (ox - x) * tdx : Infinity;
  let tmy = dy > 0 ? (y + 1 - oy) * tdy : dy < 0 ? (oy - y) * tdy : Infinity;
  let tmz = dz > 0 ? (z + 1 - oz) * tdz : dz < 0 ? (oz - z) * tdz : Infinity;
  let face = null, t = 0;
  for (let i = 0; i < 400 && t <= maxDist; i++) {
    const id = dim.getId(x, y, z);
    if (id !== 0 && hit(id, x, y, z)) {
      const nrm = face ? { top: [0, 1, 0], bottom: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] }[face] : [0, 0, 0];
      return { x, y, z, id, face, t, px: x + nrm[0], py: y + nrm[1], pz: z + nrm[2] };
    }
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; face = sx > 0 ? 'west' : 'east'; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; face = sy > 0 ? 'bottom' : 'top'; }
    else { z += sz; t = tmz; tmz += tdz; face = sz > 0 ? 'north' : 'south'; }
  }
  return null;
}
