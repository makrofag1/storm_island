// Simplified collision primitives + XZ spatial hash. Pure data, no three.js.
import { WORLD_SIZE, HALF } from '../core/config.js';

export const C_BOX = 0;   // axis aligned box
export const C_RAMP = 1;  // wedge rising toward `dir` (0:+x 1:+z 2:-x 3:-z)
export const C_ROOF = 2;  // pyramid (peak in the center)

let nextId = 1;

export function makeCollider(type, minX, minY, minZ, maxX, maxY, maxZ, owner = null, dir = 0) {
  return { id: nextId++, type, minX, minY, minZ, maxX, maxY, maxZ, dir, owner, q: 0, alive: true, cells: null };
}

/** Height of the walkable surface of collider c at (x,z) (clamped into its footprint). */
export function surfaceY(c, x, z) {
  if (c.type === C_BOX) return c.maxY;
  const cx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x;
  const cz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
  let t;
  if (c.type === C_RAMP) {
    switch (c.dir) {
      case 0: t = (cx - c.minX) / (c.maxX - c.minX); break;
      case 1: t = (cz - c.minZ) / (c.maxZ - c.minZ); break;
      case 2: t = (c.maxX - cx) / (c.maxX - c.minX); break;
      default: t = (c.maxZ - cz) / (c.maxZ - c.minZ); break;
    }
  } else {
    const hx = (c.maxX - c.minX) / 2, hz = (c.maxZ - c.minZ) / 2;
    t = 1 - Math.max(Math.abs(cx - (c.minX + hx)) / hx, Math.abs(cz - (c.minZ + hz)) / hz);
  }
  return c.minY + t * (c.maxY - c.minY);
}

export class SpatialHash {
  constructor(cellSize = 8) {
    this.cs = cellSize;
    this.n = Math.ceil(WORLD_SIZE / cellSize) + 2;
    this.cells = new Array(this.n * this.n);
    this.stamp = 1;
    this.count = 0;
  }
  ci(v) {
    let i = Math.floor((v + HALF) / this.cs) + 1;
    return i < 0 ? 0 : i >= this.n ? this.n - 1 : i;
  }
  insert(c) {
    const i0 = this.ci(c.minX), i1 = this.ci(c.maxX), j0 = this.ci(c.minZ), j1 = this.ci(c.maxZ);
    c.cells = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * this.n + i;
      let cell = this.cells[k];
      if (!cell) cell = this.cells[k] = [];
      cell.push(c);
      c.cells.push(k);
    }
    c.alive = true;
    this.count++;
    return c;
  }
  remove(c) {
    if (!c.cells) return;
    for (const k of c.cells) {
      const cell = this.cells[k];
      const idx = cell.indexOf(c);
      if (idx >= 0) { cell[idx] = cell[cell.length - 1]; cell.pop(); }
    }
    c.cells = null;
    c.alive = false;
    this.count--;
  }
  /** Colliders overlapping the XZ rectangle. `out` is reused. */
  query(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const st = ++this.stamp;
    const i0 = this.ci(minX), i1 = this.ci(maxX), j0 = this.ci(minZ), j1 = this.ci(maxZ);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cell = this.cells[j * this.n + i];
      if (!cell) continue;
      for (let m = 0; m < cell.length; m++) {
        const c = cell[m];
        if (c.q === st) continue;
        c.q = st;
        if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
        out.push(c);
      }
    }
    return out;
  }
  clear() { this.cells = new Array(this.n * this.n); this.count = 0; }
}
