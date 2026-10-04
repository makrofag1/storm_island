// Deterministic seeded RNG (mulberry32) + helpers. Pure, no DOM / three deps.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class RNG {
  constructor(seed = 1) {
    this.seed = typeof seed === 'number' ? (seed >>> 0) : hashString(seed);
    this.s = this.seed || 0x9e3779b9;
  }
  next() {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  /** Returns an index chosen proportionally to weights. */
  weighted(weights) {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  /** Independent child stream, stable for a given label. */
  fork(label) { return new RNG((hashString(label) ^ Math.imul(this.seed, 2654435761)) >>> 0); }
}

/** Turn a user seed string (may be empty) into a numeric seed. */
export function resolveSeed(input) {
  const s = String(input ?? '').trim();
  if (!s) return (Math.random() * 0xffffffff) >>> 0;
  if (/^\d+$/.test(s)) return Number(s) >>> 0;
  return hashString(s);
}
