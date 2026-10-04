// Pure build-grid helpers (unit tested). Grid: 4 m cells in XZ, 3 m levels in Y.
import { CELL, LEVEL_H } from '../core/config.js';

export const BUILD_MATS = {
  wood: { hp: 150, time: 3.0, start: 0.3, color: 0xc89a5e, pat: 1 },
  brick: { hp: 300, time: 6.0, start: 0.25, color: 0xb3664c, pat: 2 },
  metal: { hp: 450, time: 9.0, start: 0.2, color: 0xa3b5c0, pat: 3 },
};
export const PIECES = ['wall', 'floor', 'stairs', 'roof'];
export const WALL_T = 0.3;
export const FLOOR_T = 0.25;
export const ROOF_H = 1.6;
export const FULL_MASK = 511;

export const cellOf = (v) => Math.floor(v / CELL);
export const levelBase = (L) => L * LEVEL_H;

export function pieceKey(type, ix, iz, L, axis) {
  if (type === 'wall') return `w:${axis}:${ix}:${iz}:${L}`;
  if (type === 'floor') return `f:${ix}:${iz}:${L}`;
  return `c:${ix}:${iz}:${L}`; // stairs / roof share the center slot
}

/** Axis aligned bounds of a piece slot. */
export function pieceBounds(type, ix, iz, L, axis) {
  const x0 = ix * CELL, z0 = iz * CELL, y0 = L * LEVEL_H;
  if (type === 'wall') {
    if (axis === 'x') return { minX: x0, minY: y0, minZ: z0 - WALL_T / 2, maxX: x0 + CELL, maxY: y0 + LEVEL_H, maxZ: z0 + WALL_T / 2 };
    return { minX: x0 - WALL_T / 2, minY: y0, minZ: z0, maxX: x0 + WALL_T / 2, maxY: y0 + LEVEL_H, maxZ: z0 + CELL };
  }
  if (type === 'floor') return { minX: x0, minY: y0 - FLOOR_T, minZ: z0, maxX: x0 + CELL, maxY: y0, maxZ: z0 + CELL };
  if (type === 'stairs') return { minX: x0, minY: y0, minZ: z0, maxX: x0 + CELL, maxY: y0 + LEVEL_H, maxZ: z0 + CELL };
  return { minX: x0, minY: y0, minZ: z0, maxX: x0 + CELL, maxY: y0 + ROOF_H, maxZ: z0 + CELL };
}

/** Bounds of edit tile (i,j) of a wall/floor (3x3 tiles). */
export function tileBounds(type, ix, iz, L, axis, i, j) {
  const b = pieceBounds(type, ix, iz, L, axis);
  const s = CELL / 3;
  if (type === 'wall') {
    const ty = LEVEL_H / 3;
    if (axis === 'x') return { minX: b.minX + i * s, maxX: b.minX + (i + 1) * s, minY: b.minY + j * ty, maxY: b.minY + (j + 1) * ty, minZ: b.minZ, maxZ: b.maxZ };
    return { minZ: b.minZ + i * s, maxZ: b.minZ + (i + 1) * s, minY: b.minY + j * ty, maxY: b.minY + (j + 1) * ty, minX: b.minX, maxX: b.maxX };
  }
  return { minX: b.minX + i * s, maxX: b.minX + (i + 1) * s, minZ: b.minZ + j * s, maxZ: b.minZ + (j + 1) * s, minY: b.minY, maxY: b.maxY };
}

export function boundsOverlap(a, b, pad = 0) {
  return a.minX < b.maxX + pad && a.maxX > b.minX - pad && a.minY < b.maxY + pad && a.maxY > b.minY - pad && a.minZ < b.maxZ + pad && a.maxZ > b.minZ - pad;
}

/** Direction index (0:+x 1:+z 2:-x 3:-z) closest to a yaw-forward vector. */
export function dirFromVector(fx, fz) {
  if (Math.abs(fx) >= Math.abs(fz)) return fx >= 0 ? 0 : 2;
  return fz >= 0 ? 1 : 3;
}

/** Wall slot on the edge of cell (ix,iz) facing dir. */
export function wallSlotFacing(ix, iz, dir) {
  switch (dir) {
    case 0: return { ix: ix + 1, iz, axis: 'z' };
    case 2: return { ix, iz, axis: 'z' };
    case 1: return { ix, iz: iz + 1, axis: 'x' };
    default: return { ix, iz, axis: 'x' };
  }
}

/** Level index for a height (the level whose base is at or just below y). */
export function levelAt(y, bias = 0.3) { return Math.floor((y + bias) / LEVEL_H); }
