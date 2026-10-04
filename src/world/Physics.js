// Raycasts and ground queries against heightmap + colliders + characters. Pure (no three.js).
import { C_BOX, surfaceY } from './Colliders.js';
import { HALF, WATER_FLOAT_Y } from '../core/config.js';

const tmpList = [];

export function makeHit() {
  return { hit: false, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, kind: 'none', collider: null, char: null, head: false };
}

export class Physics {
  constructor(hm, hash) {
    this.hm = hm;
    this.hash = hash;
    this.chars = [];    // characters considered by raycasts (set by match)
    this.stats = { rays: 0 };
  }

  /** Highest walkable surface at (x,z) not above maxY. Returns {y, collider, water}. */
  groundAt(x, z, maxY, out, pad = 0.2) {
    let y = this.hm.height(x, z);
    let col = null;
    let water = false;
    if (y < WATER_FLOAT_Y && maxY >= WATER_FLOAT_Y - 0.05) { y = WATER_FLOAT_Y; water = true; }
    const list = this.hash.query(x - pad, z - pad, x + pad, z + pad, tmpList);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (x < c.minX - pad || x > c.maxX + pad || z < c.minZ - pad || z > c.maxZ + pad) continue;
      const s = surfaceY(c, x, z);
      if (s <= maxY && s > y) { y = s; col = c; water = false; }
    }
    out.y = y; out.collider = col; out.water = water;
    return out;
  }

  /**
   * Cast a ray. opts: { chars: bool, ignore: character, maxChars, colliders: bool (default true), terrain: bool (default true) }
   * Direction must be normalized. Result written to `out`.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, opts, out) {
    this.stats.rays++;
    out.hit = false; out.t = maxDist; out.kind = 'none'; out.collider = null; out.char = null; out.head = false;
    let best = maxDist;
    if (!opts || opts.terrain !== false) {
      const t = this.rayTerrain(ox, oy, oz, dx, dy, dz, best);
      if (t >= 0 && t < best) {
        best = t; out.hit = true; out.kind = 'terrain';
        const px = ox + dx * t, pz = oz + dz * t;
        const n = this.hm.normal(px, pz, tmpN);
        out.nx = n.x; out.ny = n.y; out.nz = n.z;
      }
    }
    if (!opts || opts.colliders !== false) {
      const r = this.rayColliders(ox, oy, oz, dx, dy, dz, best);
      if (r) { best = r.t; out.hit = true; out.kind = 'collider'; out.collider = r.c; out.nx = r.nx; out.ny = r.ny; out.nz = r.nz; }
    }
    if (opts && opts.chars) {
      const chars = this.chars;
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (!ch.alive || ch === opts.ignore || !ch.hittable) continue;
        const r = rayCharacter(ox, oy, oz, dx, dy, dz, best, ch);
        if (r >= 0 && r < best) {
          best = r; out.hit = true; out.kind = 'char'; out.char = ch; out.collider = null;
          out.head = rayCharHead;
          out.nx = -dx; out.ny = -dy; out.nz = -dz;
        }
      }
    }
    out.t = best;
    out.x = ox + dx * best; out.y = oy + dy * best; out.z = oz + dz * best;
    return out;
  }

  /** True if segment a->b is unobstructed by terrain/colliders. */
  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return true;
    const h = this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.3, null, losHit);
    return !h.hit;
  }

  rayTerrain(ox, oy, oz, dx, dy, dz, maxDist) {
    const hm = this.hm;
    let t = 0;
    const top = hm.maxH + 0.5;
    if (oy > top) {
      if (dy >= 0) return -1;
      t = (oy - top) / -dy;
      if (t > maxDist) return -1;
    }
    const step = maxDist > 200 ? 2.0 : 1.0;
    let prevT = t;
    let prevD = (oy + dy * t) - hm.height(ox + dx * t, oz + dz * t);
    if (prevD < 0) return t;
    while (t < maxDist) {
      t = Math.min(t + step, maxDist);
      const x = ox + dx * t, z = oz + dz * t;
      if (x < -HALF - 50 || x > HALF + 50 || z < -HALF - 50 || z > HALF + 50) return -1;
      const y = oy + dy * t;
      const d = y - hm.height(x, z);
      if (d < 0) {
        let a = prevT, b = t;
        for (let k = 0; k < 6; k++) {
          const m = (a + b) * 0.5;
          const dm = (oy + dy * m) - hm.height(ox + dx * m, oz + dz * m);
          if (dm < 0) b = m; else a = m;
        }
        return a;
      }
      if (y > top && dy >= 0) return -1;
      prevT = t; prevD = d;
    }
    return -1;
  }

  rayColliders(ox, oy, oz, dx, dy, dz, maxDist) {
    const hash = this.hash;
    const cs = hash.cs;
    const st = ++hash.stamp;
    let ix = hash.ci(ox), iz = hash.ci(oz);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const cellMinX = (ix - 1) * cs - HALF, cellMinZ = (iz - 1) * cs - HALF;
    const tDeltaX = Math.abs(dx) > 1e-9 ? cs / Math.abs(dx) : Infinity;
    const tDeltaZ = Math.abs(dz) > 1e-9 ? cs / Math.abs(dz) : Infinity;
    let tMaxX = Math.abs(dx) > 1e-9 ? ((dx > 0 ? cellMinX + cs - ox : ox - cellMinX) / Math.abs(dx)) : Infinity;
    let tMaxZ = Math.abs(dz) > 1e-9 ? ((dz > 0 ? cellMinZ + cs - oz : oz - cellMinZ) / Math.abs(dz)) : Infinity;
    let best = maxDist, bestC = null;
    let tEnterCell = 0;
    const res = rcRes;
    for (let guard = 0; guard < 600; guard++) {
      if (ix < 0 || iz < 0 || ix >= hash.n || iz >= hash.n) break;
      const cell = hash.cells[iz * hash.n + ix];
      if (cell) {
        for (let m = 0; m < cell.length; m++) {
          const c = cell[m];
          if (c.q === st) continue;
          c.q = st;
          if (c.noRay) continue;
          const t = rayCollider(ox, oy, oz, dx, dy, dz, best, c);
          if (t >= 0 && t < best) { best = t; bestC = c; res.nx = rcN.x; res.ny = rcN.y; res.nz = rcN.z; }
        }
      }
      if (tEnterCell > best) break;
      if (tMaxX < tMaxZ) { tEnterCell = tMaxX; tMaxX += tDeltaX; ix += stepX; }
      else { tEnterCell = tMaxZ; tMaxZ += tDeltaZ; iz += stepZ; }
      if (tEnterCell > best || tEnterCell === Infinity) break;
    }
    if (!bestC) return null;
    res.t = best; res.c = bestC;
    return res;
  }
}

const tmpN = { x: 0, y: 1, z: 0 };
const losHit = makeHit();
const rcRes = { t: 0, c: null, nx: 0, ny: 0, nz: 0 };
const rcN = { x: 0, y: 0, z: 0 };
let rayCharHead = false;

/** Ray vs collider. Returns t or -1. Sets rcN normal. */
function rayCollider(ox, oy, oz, dx, dy, dz, maxDist, c) {
  // slab test
  let tmin = 0, tmax = maxDist, axis = -1, sgn = 0;
  // X
  if (Math.abs(dx) < 1e-9) { if (ox < c.minX || ox > c.maxX) return -1; }
  else {
    let t1 = (c.minX - ox) / dx, t2 = (c.maxX - ox) / dx, s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 0; sgn = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < c.minY || oy > c.maxY) return -1; }
  else {
    let t1 = (c.minY - oy) / dy, t2 = (c.maxY - oy) / dy, s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 1; sgn = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < c.minZ || oz > c.maxZ) return -1; }
  else {
    let t1 = (c.minZ - oz) / dz, t2 = (c.maxZ - oz) / dz, s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 2; sgn = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (c.type === C_BOX) {
    if (axis < 0) { rcN.x = -dx; rcN.y = -dy; rcN.z = -dz; return tmin; } // origin inside
    rcN.x = axis === 0 ? sgn : 0; rcN.y = axis === 1 ? sgn : 0; rcN.z = axis === 2 ? sgn : 0;
    // sgn: -1 when entering through min face (normal points -), +1 when entering via max face
    return tmin;
  }
  // Wedge / pyramid: solid region is below the surface. Find first t with y <= surface.
  const f = (t) => (oy + dy * t) - surfaceY(c, ox + dx * t, oz + dz * t);
  if (f(tmin) <= 0) {
    rcN.x = axis === 0 ? sgn : 0; rcN.y = axis === 1 ? sgn : 0; rcN.z = axis === 2 ? sgn : 0;
    if (axis < 0) { rcN.x = 0; rcN.y = 1; rcN.z = 0; }
    return tmin;
  }
  const N = 8;
  let a = tmin;
  for (let k = 1; k <= N; k++) {
    const b = tmin + (tmax - tmin) * (k / N);
    if (f(b) <= 0) {
      let lo = a, hi = b;
      for (let it = 0; it < 6; it++) { const m = (lo + hi) / 2; if (f(m) <= 0) hi = m; else lo = m; }
      rcN.x = 0; rcN.y = 1; rcN.z = 0;
      return hi;
    }
    a = b;
  }
  return -1;
}

/** Ray vs character (vertical cylinder body + head sphere). Returns t or -1, sets rayCharHead. */
function rayCharacter(ox, oy, oz, dx, dy, dz, maxDist, ch) {
  const p = ch.pos;
  const h = ch.height;
  // quick reject by distance from ray to character center
  const cx = p.x - ox, cy = p.y + h * 0.5 - oy, cz = p.z - oz;
  const proj = cx * dx + cy * dy + cz * dz;
  if (proj < -1.5 || proj > maxDist + 1.5) return -1;
  const qx = cx - dx * proj, qy = cy - dy * proj, qz = cz - dz * proj;
  if (qx * qx + qy * qy + qz * qz > 2.0 * 2.0) return -1;

  let best = -1;
  rayCharHead = false;
  // head sphere
  const hr = 0.27;
  const hx = p.x - ox, hy = p.y + h - 0.24 - oy, hz = p.z - oz;
  const b = hx * dx + hy * dy + hz * dz;
  const c2 = hx * hx + hy * hy + hz * hz - hr * hr;
  const disc = b * b - c2;
  if (disc >= 0) {
    const t = b - Math.sqrt(disc);
    if (t >= 0 && t <= maxDist) { best = t; rayCharHead = true; }
  }
  // body cylinder
  const r = 0.45;
  const y0 = p.y, y1 = p.y + h - 0.46;
  const ax = ox - p.x, az = oz - p.z;
  const A = dx * dx + dz * dz;
  if (A > 1e-9) {
    const B = 2 * (ax * dx + az * dz);
    const C = ax * ax + az * az - r * r;
    const D = B * B - 4 * A * C;
    if (D >= 0) {
      const t = (-B - Math.sqrt(D)) / (2 * A);
      if (t >= 0 && t <= maxDist) {
        const y = oy + dy * t;
        if (y >= y0 && y <= y1 && (best < 0 || t < best)) { best = t; rayCharHead = false; }
      }
    }
  }
  return best;
}
