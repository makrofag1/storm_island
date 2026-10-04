// Procedural island heightmap. Pure data (no three.js) so it can be unit-tested in node.
import { Simplex2 } from '../core/noise.js';
import { WORLD_SIZE, HALF, HM_RES } from '../core/config.js';
import { clamp, smoothstep, lerp } from '../core/math.js';
import { DEFAULT_MAP } from './MapOptions.js';

export class Heightmap {
  constructor(rng, map = DEFAULT_MAP) {
    this.map = map;
    this.theme = map.themeId || 'summer';
    this.res = HM_RES;
    this.n = Math.round(WORLD_SIZE / HM_RES) + 1;
    this.data = new Float32Array(this.n * this.n);
    this.rng = rng.fork('heightmap');
    this.noise = new Simplex2(this.rng);
    this.maxH = 0;
    this.minH = 0;
    const r = this.rng;
    const a1 = r.range(0, Math.PI * 2);
    const md = r.range(0.32, 0.42) * HALF;
    this.mountain = { x: Math.cos(a1) * md, z: Math.sin(a1) * md, r: 175 };
    const a2 = a1 + Math.PI + r.range(-0.9, 0.9);
    const ld = r.range(0.22, 0.34) * HALF;
    this.lake = { x: Math.cos(a2) * ld, z: Math.sin(a2) * ld, r: 62 };
    // 'mountains' terrain: a second, smaller peak away from the first one and the lake
    const a3 = a1 + r.range(1.6, 2.4) * (r.chance(0.5) ? 1 : -1);
    const pd = r.range(0.3, 0.42) * HALF;
    this.peak2 = map.extraPeak ? { x: Math.cos(a3) * pd, z: Math.sin(a3) * pd, r: 120 } : null;
    this.generate();
  }

  baseHeight(x, z) {
    const s = this.noise;
    const mp = this.map;
    const u = x / HALF, v = z / HALF;
    const rr = Math.hypot(u, v) / mp.landScale;
    const warp = s.fbm(u * 2.1 + 5.3, v * 2.1 - 3.1, 3) * 0.17;
    const d = rr + warp;
    const mask = 1 - smoothstep(0.6, 0.93, d); // 1 inland, 0 open ocean
    const hills = (s.fbm(x * 0.0038, z * 0.0038, 5) * 12 + s.ridged(x * 0.0021 + 11, z * 0.0021 - 7, 4) * 14) * mp.hillAmp;
    const base = Math.max(1.5, 7 + hills);
    let h = base * smoothstep(0.22, 0.85, mask) + 1.8 * smoothstep(0.0, 0.22, mask) - 14 * (1 - smoothstep(0.0, 0.22, mask));

    const m = this.mountain;
    const md = Math.hypot(x - m.x, z - m.z);
    const mt = Math.exp(-(md / m.r) * (md / m.r));
    if (mt > 0.001) {
      const rugged = s.ridged(x * 0.012, z * 0.012, 4);
      h += mt * (88 + 34 * rugged) * smoothstep(0.3, 0.7, mask) * mp.mountainAmp;
    }
    const p2 = this.peak2;
    if (p2) {
      const pd = Math.hypot(x - p2.x, z - p2.z);
      const pt = Math.exp(-(pd / p2.r) * (pd / p2.r));
      if (pt > 0.001) h += pt * (58 + 26 * s.ridged(x * 0.014 + 3, z * 0.014, 4)) * smoothstep(0.3, 0.7, mask);
    }
    if (mp.lake) {
      const l = this.lake;
      const ldist = Math.hypot(x - l.x, z - l.z);
      const lt = smoothstep(l.r * 1.6, l.r * 0.55, ldist + s.noise(x * 0.03, z * 0.03) * 10);
      if (lt > 0) h = lerp(h, -5, lt);
    }
    if (mp.islands) {
      // archipelago: meandering sea channels (an iso-line of low-frequency noise) split the island;
      // swimmable, and kept away from the big mountain so its slopes stay intact
      const c = Math.abs(s.noise(x * 0.0029 + 31.7, z * 0.0029 - 17.3));
      const md = Math.hypot(x - m.x, z - m.z);
      const cut = (1 - smoothstep(0.03, 0.075, c)) * smoothstep(m.r * 0.9, m.r * 1.4, md) * smoothstep(0.15, 0.4, mask);
      if (cut > 0) h = lerp(h, -4.5, cut);
    }
    return h;
  }

  generate() {
    const n = this.n;
    let mx = -Infinity, mn = Infinity;
    for (let j = 0; j < n; j++) {
      const z = -HALF + j * this.res;
      for (let i = 0; i < n; i++) {
        const x = -HALF + i * this.res;
        const h = this.baseHeight(x, z);
        this.data[j * n + i] = h;
        if (h > mx) mx = h;
        if (h < mn) mn = h;
      }
    }
    this.maxH = mx; this.minH = mn;
  }

  /** Blend terrain toward targetH inside radius r (with soft falloff band). */
  flatten(cx, cz, r, targetH, falloff = 28) {
    const n = this.n, res = this.res;
    const R = r + falloff;
    const i0 = clamp(Math.floor((cx - R + HALF) / res), 0, n - 1), i1 = clamp(Math.ceil((cx + R + HALF) / res), 0, n - 1);
    const j0 = clamp(Math.floor((cz - R + HALF) / res), 0, n - 1), j1 = clamp(Math.ceil((cz + R + HALF) / res), 0, n - 1);
    for (let j = j0; j <= j1; j++) {
      const z = -HALF + j * res;
      for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * res;
        const d = Math.hypot(x - cx, z - cz);
        if (d > R) continue;
        const t = smoothstep(R, r, d);
        const k = j * n + i;
        this.data[k] = lerp(this.data[k], targetH, t);
      }
    }
  }

  /** Flatten an axis aligned rectangle exactly (for building pads). */
  flattenRect(minX, minZ, maxX, maxZ, targetH, falloff = 6) {
    const n = this.n, res = this.res;
    const i0 = clamp(Math.floor((minX - falloff + HALF) / res), 0, n - 1), i1 = clamp(Math.ceil((maxX + falloff + HALF) / res), 0, n - 1);
    const j0 = clamp(Math.floor((minZ - falloff + HALF) / res), 0, n - 1), j1 = clamp(Math.ceil((maxZ + falloff + HALF) / res), 0, n - 1);
    for (let j = j0; j <= j1; j++) {
      const z = -HALF + j * res;
      for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * res;
        const dx = Math.max(minX - x, 0, x - maxX), dz = Math.max(minZ - z, 0, z - maxZ);
        const d = Math.hypot(dx, dz);
        const t = d <= 0 ? 1 : smoothstep(falloff, 0, d);
        const k = j * n + i;
        this.data[k] = lerp(this.data[k], targetH, t);
      }
    }
  }

  recomputeBounds() {
    let mx = -Infinity, mn = Infinity;
    for (let k = 0; k < this.data.length; k++) { const h = this.data[k]; if (h > mx) mx = h; if (h < mn) mn = h; }
    this.maxH = mx; this.minH = mn;
  }

  sample(i, j) {
    const n = this.n;
    i = i < 0 ? 0 : i >= n ? n - 1 : i;
    j = j < 0 ? 0 : j >= n ? n - 1 : j;
    return this.data[j * n + i];
  }

  height(x, z) {
    const n = this.n;
    let fx = (x + HALF) / this.res, fz = (z + HALF) / this.res;
    if (fx < 0) fx = 0; else if (fx > n - 1.0001) fx = n - 1.0001;
    if (fz < 0) fz = 0; else if (fz > n - 1.0001) fz = n - 1.0001;
    const i = fx | 0, j = fz | 0;
    const tx = fx - i, tz = fz - j;
    const k = j * n + i;
    const d = this.data;
    const a = d[k] + (d[k + 1] - d[k]) * tx;
    const b = d[k + n] + (d[k + n + 1] - d[k + n]) * tx;
    return a + (b - a) * tz;
  }

  /** Writes unit normal into out {x,y,z}. */
  normal(x, z, out) {
    const e = this.res;
    const hl = this.height(x - e, z), hr = this.height(x + e, z);
    const hd = this.height(x, z - e), hu = this.height(x, z + e);
    let nx = hl - hr, ny = 2 * e, nz = hd - hu;
    const len = Math.hypot(nx, ny, nz);
    out.x = nx / len; out.y = ny / len; out.z = nz / len;
    return out;
  }

  isLand(x, z) { return this.height(x, z) > 0.6; }

  /** Biome color (RGB 0..1) for a terrain point. */
  colorAt(x, z, h, ny, out) {
    const s = this.noise;
    const n1 = s.noise(x * 0.02, z * 0.02) * 0.5 + 0.5;
    const n2 = s.noise(x * 0.11 + 40, z * 0.11) * 0.5 + 0.5;
    if (this.theme !== 'summer') return this.themedColor(x, z, h, ny, n1, n2, out);
    let r, g, b;
    if (h < 0.4) { r = 0.78; g = 0.72; b = 0.5; }                         // wet sand / lake bed
    else if (h < 2.6) { r = 0.93; g = 0.85; b = 0.6; }                    // beach
    else {
      // meadow vs forest green
      const f = smoothstep(0.35, 0.7, n1);
      r = lerp(0.42, 0.26, f); g = lerp(0.72, 0.55, f); b = lerp(0.3, 0.22, f);
      r += (n2 - 0.5) * 0.06; g += (n2 - 0.5) * 0.08;
      const dryness = smoothstep(30, 55, h);
      r = lerp(r, 0.55, dryness * 0.5); g = lerp(g, 0.6, dryness * 0.4); b = lerp(b, 0.35, dryness * 0.4);
    }
    if (ny < 0.78 && h > 1) {                                             // rock on steep slopes
      const t = smoothstep(0.78, 0.6, ny);
      r = lerp(r, 0.5, t); g = lerp(g, 0.47, t); b = lerp(b, 0.44, t);
    }
    const snowLine = 78 + (n1 - 0.5) * 14;
    if (h > snowLine && ny > 0.55) {
      const t = smoothstep(snowLine, snowLine + 6, h);
      r = lerp(r, 0.95, t); g = lerp(g, 0.97, t); b = lerp(b, 1.0, t);
    }
    out[0] = r; out[1] = g; out[2] = b;
    return out;
  }

  /** Terrain colours for the autumn / winter / desert themes. */
  themedColor(x, z, h, ny, n1, n2, out) {
    let r, g, b;
    const steep = ny < 0.78 && h > 1 ? smoothstep(0.78, 0.6, ny) : 0;
    if (this.theme === 'winter') {
      if (h < 0.4) { r = 0.62; g = 0.66; b = 0.68; }                      // icy shore
      else if (h < 2.6) { r = 0.8; g = 0.82; b = 0.82; }                  // frozen beach
      else { const v = 0.9 + (n2 - 0.5) * 0.06 - smoothstep(0.35, 0.7, n1) * 0.05; r = v; g = v + 0.02; b = v + 0.06; }
      r = lerp(r, 0.52, steep); g = lerp(g, 0.54, steep); b = lerp(b, 0.58, steep);
    } else if (this.theme === 'desert') {
      if (h < 0.4) { r = 0.72; g = 0.62; b = 0.44; }
      else { const dune = smoothstep(0.3, 0.75, n1); r = lerp(0.92, 0.84, dune); g = lerp(0.8, 0.68, dune); b = lerp(0.56, 0.44, dune); r += (n2 - 0.5) * 0.05; g += (n2 - 0.5) * 0.04; }
      r = lerp(r, 0.7, steep); g = lerp(g, 0.46, steep); b = lerp(b, 0.34, steep);  // red rock
    } else {                                                              // autumn
      if (h < 0.4) { r = 0.74; g = 0.68; b = 0.5; }
      else if (h < 2.6) { r = 0.88; g = 0.8; b = 0.58; }
      else { const f = smoothstep(0.35, 0.7, n1); r = lerp(0.66, 0.5, f); g = lerp(0.62, 0.44, f); b = lerp(0.3, 0.22, f); r += (n2 - 0.5) * 0.08; g += (n2 - 0.5) * 0.06; }
      r = lerp(r, 0.5, steep); g = lerp(g, 0.46, steep); b = lerp(b, 0.42, steep);
    }
    if (this.theme !== 'desert') {
      const snowLine = (this.theme === 'winter' ? 40 : 78) + (n1 - 0.5) * 14;
      if (h > snowLine && ny > 0.55) { const t = smoothstep(snowLine, snowLine + 6, h); r = lerp(r, 0.95, t); g = lerp(g, 0.97, t); b = lerp(b, 1.0, t); }
    }
    out[0] = r; out[1] = g; out[2] = b;
    return out;
  }

  /** Surface type for footsteps / particles. */
  surfaceAt(x, z) {
    const h = this.height(x, z);
    if (this.theme === 'desert') return 'sand';
    if (h < 2.6) return 'sand';
    if (h > 80 || (this.theme === 'winter' && h > 2.6)) return 'snow';
    return 'grass';
  }
}
