// 2 m navigation grid built from the heightmap + colliders, with A* (binary heap, octile heuristic),
// partial paths, corner-cutting prevention and line-of-sight path smoothing. Pure (no three.js).
import { WORLD_SIZE, HALF } from '../core/config.js';
import { C_BOX } from '../world/Colliders.js';

const tmpList = [];
const SQ2 = Math.SQRT2;
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]];

export class NavGrid {
  constructor(hm, hash, opts = {}) {
    this.hm = hm;
    this.hash = hash;
    this.cs = opts.cell || 2;
    this.n = Math.round((opts.size || WORLD_SIZE) / this.cs);
    this.half = (opts.size || WORLD_SIZE) / 2;
    const N = this.n * this.n;
    this.base = new Uint8Array(N);   // 0 = blocked, otherwise traversal cost
    this.block = new Uint8Array(N);  // 1 = blocked by a collider
    this.g = new Float32Array(N);
    this.f = new Float32Array(N);
    this.parent = new Int32Array(N);
    this.seen = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.stamp = 0;
    this.heap = new Int32Array(1 << 18);
    this.version = 0;
    if (hm) this.buildBase();
    if (hash) this.rasterizeAll();
  }

  idx(x, z) {
    let i = Math.floor((x + this.half) / this.cs), j = Math.floor((z + this.half) / this.cs);
    if (i < 0) i = 0; else if (i >= this.n) i = this.n - 1;
    if (j < 0) j = 0; else if (j >= this.n) j = this.n - 1;
    return j * this.n + i;
  }
  cx(k) { return -this.half + ((k % this.n) + 0.5) * this.cs; }
  cz(k) { return -this.half + (Math.floor(k / this.n) + 0.5) * this.cs; }

  buildBase() {
    const n = this.n, cs = this.cs, hm = this.hm;
    for (let j = 0; j < n; j++) {
      const z = -this.half + (j + 0.5) * cs;
      for (let i = 0; i < n; i++) {
        const x = -this.half + (i + 0.5) * cs;
        const k = j * n + i;
        if (i < 6 || j < 6 || i >= n - 6 || j >= n - 6) { this.base[k] = 0; continue; }
        const h = hm.height(x, z);
        const hx1 = hm.height(x + cs, z), hx0 = hm.height(x - cs, z), hz1 = hm.height(x, z + cs), hz0 = hm.height(x, z - cs);
        const s = Math.max(Math.abs(hx1 - h), Math.abs(hx0 - h), Math.abs(hz1 - h), Math.abs(hz0 - h)) / cs;
        // combined gradient (a diagonal slope is steeper than either axis shows): characters slide
        // back on terrain steeper than ~1.0 (Motor: normal.y < 0.7), so such cells are not walkable —
        // bots used to walk into them forever (e.g. stuck on a mountainside in the storm)
        const g = Math.hypot(hx1 - hx0, hz1 - hz0) / (2 * cs);
        let c = 1;
        if (h < -1.3) c = 5;            // swimming
        else if (s > 0.85 || g > 0.93) c = 0; // cliff
        else if (s > 0.5 || g > 0.6) c = 3;
        this.base[k] = c;
      }
    }
  }

  rasterizeAll() {
    const seen = new Set();
    for (const cell of this.hash.cells) {
      if (!cell) continue;
      for (const c of cell) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        this.markCollider(c);
      }
    }
  }

  blocksCell(c, cx, cz) {
    const ground = this.hm.height(cx, cz);
    if (c.minY > ground + 1.7) return false;
    if (c.type === C_BOX) return c.maxY > ground + 0.5;
    return true; // ramps / roofs are handled by waypoint chains
  }

  markCollider(c) {
    const pad = 0.3, cs = this.cs, n = this.n;
    const i0 = Math.max(0, Math.floor((c.minX - pad + this.half) / cs)), i1 = Math.min(n - 1, Math.floor((c.maxX + pad + this.half) / cs));
    const j0 = Math.max(0, Math.floor((c.minZ - pad + this.half) / cs)), j1 = Math.min(n - 1, Math.floor((c.maxZ + pad + this.half) / cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i;
      if (this.block[k]) continue;
      if (this.blocksCell(c, -this.half + (i + 0.5) * cs, -this.half + (j + 0.5) * cs)) this.block[k] = 1;
    }
  }

  /** Recompute collider blocking in a region (after building / destruction). */
  updateRegion(minX, minZ, maxX, maxZ) {
    const cs = this.cs, n = this.n, pad = 0.3;
    const i0 = Math.max(0, Math.floor((minX - pad + this.half) / cs)), i1 = Math.min(n - 1, Math.floor((maxX + pad + this.half) / cs));
    const j0 = Math.max(0, Math.floor((minZ - pad + this.half) / cs)), j1 = Math.min(n - 1, Math.floor((maxZ + pad + this.half) / cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i;
      const x0 = -this.half + i * cs, z0 = -this.half + j * cs;
      const cx = x0 + cs / 2, cz = z0 + cs / 2;
      let b = 0;
      const list = this.hash.query(x0 - pad, z0 - pad, x0 + cs + pad, z0 + cs + pad, tmpList);
      for (const c of list) if (this.blocksCell(c, cx, cz)) { b = 1; break; }
      this.block[k] = b;
    }
    this.version++;
  }

  walkable(k) { return this.base[k] > 0 && this.block[k] === 0; }
  walkableAt(x, z) { return this.walkable(this.idx(x, z)); }

  nearestWalkable(k, radius = 4) {
    if (this.walkable(k)) return k;
    const n = this.n, i0 = k % n, j0 = Math.floor(k / n);
    for (let r = 1; r <= radius; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const kk = j * n + i;
        if (this.walkable(kk)) return kk;
      }
    }
    return -1;
  }

  /**
   * A* from (sx,sz) to (gx,gz). Returns { points: [{x,z}], complete: bool, expanded } or null.
   * Synchronous convenience wrapper around the resumable search below.
   */
  findPath(sx, sz, gx, gz, maxNodes = 30000) {
    const s = this.beginPath(sx, sz, gx, gz, maxNodes);
    if (!s || s.result) return s ? s.result : null;
    return this.continuePath(s, Infinity);
  }

  /**
   * Start a resumable A* search. Returns null (no path possible), an object with `.result`
   * (trivial case), or a search state to feed to continuePath(). Only ONE search may be active at
   * a time because the scratch arrays are shared.
   */
  beginPath(sx, sz, gx, gz, maxNodes = 30000) {
    const n = this.n;
    const s = this.nearestWalkable(this.idx(sx, sz), 3);
    const goal = this.nearestWalkable(this.idx(gx, gz), 6);
    if (s < 0 || goal < 0) return null;
    if (s === goal) return { result: { points: [{ x: gx, z: gz }], complete: true, expanded: 0 } };
    const st = ++this.stamp;
    const search = { st, s, goal, gx, gz, gi: goal % n, gj: Math.floor(goal / n), size: 0, best: s, bestH: 0, expanded: 0, maxNodes, version: this.version };
    this.g[s] = 0; this.parent[s] = -1; this.seen[s] = st;
    this.f[s] = this.heur(search, s);
    search.bestH = this.f[s];
    this.heapPush(search, s);
    return search;
  }

  heur(search, k) {
    const n = this.n;
    const dx = Math.abs((k % n) - search.gi), dz = Math.abs(Math.floor(k / n) - search.gj);
    return 1.45 * (dx + dz + (SQ2 - 2) * Math.min(dx, dz));
  }
  heapPush(search, k) {
    const heap = this.heap, f = this.f;
    if (search.size >= heap.length) return;
    let i = search.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[heap[p]] <= f[k]) break;
      heap[i] = heap[p]; i = p;
    }
    heap[i] = k;
  }
  heapPop(search) {
    const heap = this.heap, f = this.f;
    const top = heap[0];
    const last = heap[--search.size];
    let i = 0;
    const size = search.size;
    while (true) {
      let l = 2 * i + 1;
      if (l >= size) break;
      const r = l + 1;
      if (r < size && f[heap[r]] < f[heap[l]]) l = r;
      if (f[heap[l]] >= f[last]) break;
      heap[i] = heap[l]; i = l;
    }
    heap[i] = last;
    return top;
  }

  /** Expand up to `budget` nodes. Returns the result when finished, or null to continue later. */
  continuePath(search, budget) {
    const n = this.n, st = search.st;
    const g = this.g, f = this.f, parent = this.parent, seen = this.seen, closed = this.closed;
    let found = false, steps = 0;
    while (search.size > 0) {
      if (steps++ >= budget) return null;
      const cur = this.heapPop(search);
      if (closed[cur] === st) continue;
      closed[cur] = st;
      if (cur === search.goal) { found = true; break; }
      if (++search.expanded > search.maxNodes) break;
      const h = f[cur] - g[cur];
      if (h < search.bestH) { search.bestH = h; search.best = cur; }
      const ci = cur % n, cj = Math.floor(cur / n);
      for (let q = 0; q < 8; q++) {
        const ni = ci + NB[q][0], nj = cj + NB[q][1];
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nk = nj * n + ni;
        if (!this.walkable(nk) || closed[nk] === st) continue;
        if (q >= 4 && (!this.walkable(cj * n + ni) || !this.walkable(nj * n + ci))) continue;
        const ng = g[cur] + NB[q][2] * (this.base[cur] + this.base[nk]) * 0.5;
        if (seen[nk] !== st || ng < g[nk]) {
          seen[nk] = st;
          g[nk] = ng; f[nk] = ng + this.heur(search, nk); parent[nk] = cur;
          this.heapPush(search, nk);
        }
      }
    }
    const end = found ? search.goal : search.best;
    const cells = [];
    for (let k = end; k !== -1; k = parent[k]) { cells.push(k); if (cells.length > 5000) break; }
    cells.reverse();
    const pts = this.smooth(cells);
    if (found) pts[pts.length - 1] = { x: search.gx, z: search.gz };
    return { points: pts, complete: found, expanded: search.expanded };
  }

  /** Grid line-of-sight (supercover) between two cells. */
  clearLine(a, b) {
    const n = this.n;
    let x0 = a % n, y0 = Math.floor(a / n);
    const x1 = b % n, y1 = Math.floor(b / n);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (let guard = 0; guard < 400; guard++) {
      const k = y0 * n + x0;
      if (!this.walkable(k) || this.base[k] > 2) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy && e2 < dx) {
        // diagonal step: both side cells must be clear
        if (!this.walkable(y0 * n + x0 + sx) || !this.walkable((y0 + sy) * n + x0)) return false;
      }
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
    return false;
  }

  smooth(cells) {
    if (cells.length <= 2) return cells.map((k) => ({ x: this.cx(k), z: this.cz(k) }));
    const out = [];
    let anchor = 0;
    out.push(cells[0]);
    while (anchor < cells.length - 1) {
      // exponential back-off: try far shortcuts first (≤ ~6 line checks per waypoint)
      let far = anchor + 1;
      for (let step = 48; step >= 2; step >>= 1) {
        const j = Math.min(cells.length - 1, anchor + step);
        if (j <= anchor + 1) continue;
        if (this.clearLine(cells[anchor], cells[j])) { far = j; break; }
      }
      out.push(cells[far]);
      anchor = far;
    }
    return out.slice(1).map((k) => ({ x: this.cx(k), z: this.cz(k) }));
  }
}
