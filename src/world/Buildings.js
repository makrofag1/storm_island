// Procedural building generators. All buildings are axis aligned and built from destructible boxes,
// stairs (ramps) and roofs. Each generator registers loot / chest spots, with waypoint chains for
// upper floors so bots can navigate stairs.
import * as THREE from 'three';
import { PAT } from './InstancedShapes.js';

export const FH = 3.4;     // floor height
const T = 0.3;             // wall thickness
const DOOR_W = 3.2, DOOR_H = 2.7;
const WIN_W = 1.6, WIN_Y0 = 1.0, WIN_Y1 = 2.3;

export const STYLES = {
  woodTan: { wall: 0xc9a06a, pat: PAT.WOOD, mat: 'wood', roof: 0x8e3b2e, trim: 0xf2ead8 },
  woodWhite: { wall: 0xe9e3d2, pat: PAT.WOOD, mat: 'wood', roof: 0x3e4f66, trim: 0x8a6a4a },
  woodBlue: { wall: 0x7d9cc0, pat: PAT.WOOD, mat: 'wood', roof: 0x5b3a2a, trim: 0xf0f0f0 },
  woodGreen: { wall: 0x8bb07a, pat: PAT.WOOD, mat: 'wood', roof: 0x6d3b2b, trim: 0xf0e6d0 },
  woodRed: { wall: 0xb7462f, pat: PAT.WOOD, mat: 'wood', roof: 0x4a4f57, trim: 0xf3eee4 },
  brick: { wall: 0xb0614a, pat: PAT.BRICK, mat: 'brick', roof: 0x55606e, trim: 0xd8d0c0 },
  brickDark: { wall: 0x8d5a48, pat: PAT.BRICK, mat: 'brick', roof: 0x3c434c, trim: 0xcfc6b2 },
  concrete: { wall: 0xd6d1c4, pat: PAT.CONCRETE, mat: 'brick', roof: 0x7d8288, trim: 0x34d1e0 },
  concreteDark: { wall: 0x9aa0a6, pat: PAT.CONCRETE, mat: 'brick', roof: 0x5d6268, trim: 0xff4fa8 },
  metal: { wall: 0x8ea3ae, pat: PAT.METAL, mat: 'metal', roof: 0x6b7b85, trim: 0xe3b23c },
  metalRust: { wall: 0xc0784a, pat: PAT.METAL, mat: 'metal', roof: 0x7a5a44, trim: 0x444444 },
  snowCabin: { wall: 0x8a5a3c, pat: PAT.WOOD, mat: 'wood', roof: 0xf2f6fa, trim: 0xf2f6fa },
};

const V = (x, y, z) => ({ x, y, z });

/** Wall along an axis with rectangular openings. axis 'x': spans x in [a0,a1] at z=c. */
export function wall(S, axis, a0, a1, c, y0, h, openings, st, t = T) {
  const ops = openings.slice().sort((p, q) => p.a - q.a);
  const box = (s0, s1, yb, yt) => {
    if (s1 - s0 < 0.05 || yt - yb < 0.05) return;
    if (axis === 'x') S.addBox(s0, yb, c - t / 2, s1, yt, c + t / 2, st.wall, st.pat, st.mat);
    else S.addBox(c - t / 2, yb, s0, c + t / 2, yt, s1, st.wall, st.pat, st.mat);
  };
  let cur = a0;
  for (const o of ops) {
    const a = Math.max(o.a, cur), b = Math.min(o.b, a1);
    if (b <= a) continue;
    box(cur, a, y0, y0 + h);
    box(a, b, y0, y0 + o.y0);
    box(a, b, y0 + o.y1, y0 + h);
    cur = b;
  }
  box(cur, a1, y0, y0 + h);
}

/** Horizontal slab [x0,x1]x[z0,z1] with top at y, minus optional holes (non-overlapping list). */
export function slab(S, x0, z0, x1, z1, y, thick, color, pat, mat, holes = []) {
  if (!holes.length) { S.addBox(x0, y - thick, z0, x1, y, z1, color, pat, mat); return; }
  const h = holes[0];
  const hx0 = Math.max(x0, h.x0), hx1 = Math.min(x1, h.x1), hz0 = Math.max(z0, h.z0), hz1 = Math.min(z1, h.z1);
  const rest = holes.slice(1);
  if (hx0 - x0 > 0.05) slab(S, x0, z0, hx0, z1, y, thick, color, pat, mat, rest.filter((r) => r.x0 < hx0));
  if (x1 - hx1 > 0.05) slab(S, hx1, z0, x1, z1, y, thick, color, pat, mat, rest.filter((r) => r.x1 > hx1));
  if (hz0 - z0 > 0.05) slab(S, hx0, z0, hx1, hz0, y, thick, color, pat, mat, rest.filter((r) => r.z0 < hz0 && r.x1 > hx0 && r.x0 < hx1));
  if (z1 - hz1 > 0.05) slab(S, hx0, hz1, hx1, z1, y, thick, color, pat, mat, rest.filter((r) => r.z1 > hz1 && r.x1 > hx0 && r.x0 < hx1));
}

function windowOpenings(a0, a1, skipCenters = []) {
  const ops = [];
  for (let a = a0 + 2; a <= a1 - 2 + 0.01; a += 4) {
    if (skipCenters.some((s) => Math.abs(s - a) < 2.6)) continue;
    ops.push({ a: a - WIN_W / 2, b: a + WIN_W / 2, y0: WIN_Y0, y1: WIN_Y1 });
  }
  return ops;
}

function foundation(S, bx, bz, w, d, g) {
  S.addBox(bx - 0.3, g - 3, bz - 0.3, bx + w + 0.3, g + 0.2, bz + d + 0.3, 0x9a968c, PAT.CONCRETE, null);
}

function register(W, kind, x, y, z, chain) {
  const spot = { x, y, z, chain: chain || null, poi: W.poi };
  if (kind === 'chest') W.chests.push(spot);
  else if (kind === 'ammo') W.ammo.push(spot);
  else W.loot.push(spot);
  return spot;
}

/** Random interior point avoiding rectangles. */
function interiorPoint(rng, x0, z0, x1, z1, avoid) {
  for (let i = 0; i < 20; i++) {
    const x = rng.range(x0, x1), z = rng.range(z0, z1);
    if (!avoid.some((r) => x > r.x0 - 0.6 && x < r.x1 + 0.6 && z > r.z0 - 0.6 && z < r.z1 + 0.6)) return [x, z];
  }
  return [(x0 + x1) / 2, (z0 + z1) / 2];
}

function addBuildingRecord(W, bx, bz, w, d, g, h, color) {
  W.buildings.push({ minX: bx, minZ: bz, maxX: bx + w, maxZ: bz + d, g, h, color });
}

/**
 * House with 1-2 floors. doorSide 0 = door at minZ, 2 = door at maxZ.
 */
export function house(W, bx, bz, w, d, g, rng, { floors = 1, style = STYLES.woodTan, doorSide = 0, roof = 'pyramid', chestChance = 0.55 } = {}) {
  const S = W.S;
  foundation(S, bx, bz, w, d, g);
  const y0 = g + 0.2;
  const front = doorSide === 0 ? bz : bz + d;           // z of door wall
  const back = doorSide === 0 ? bz + d : bz;
  const inward = doorSide === 0 ? 1 : -1;
  const doorX = bx + w / 2 + 1;
  // stairs lane against back wall
  const laneW = 1.8;
  const laneZ0 = doorSide === 0 ? back - T / 2 - laneW : back + T / 2;
  const laneZ1 = laneZ0 + laneW;
  const laneZc = (laneZ0 + laneZ1) / 2;
  const sx = bx + 1.2, sLen = 4.4;
  const stairRect = { x0: sx - 0.6, z0: laneZ0, x1: sx + sLen, z1: laneZ1 };

  for (let f = 0; f < floors; f++) {
    const yb = y0 + f * FH;
    const doorOps = f === 0 ? [{ a: doorX - DOOR_W / 2, b: doorX + DOOR_W / 2, y0: 0, y1: DOOR_H }] : [];
    const frontOps = doorOps.concat(windowOpenings(bx, bx + w, f === 0 ? [doorX] : []));
    const backOps = (floors > 1 && f === 0) ? [] : windowOpenings(bx, bx + w);
    wall(S, 'x', bx, bx + w, front, yb, FH, frontOps, style);
    wall(S, 'x', bx, bx + w, back, yb, FH, backOps, style);
    // side walls (x = bx and x = bx+w), may have side door on ground floor
    const sideDoor = f === 0 && d >= 12 && rng.chance(0.5);
    const sideDoorZ = bz + d / 2 + 1;
    wall(S, 'z', bz + T / 2, bz + d - T / 2, bx, yb, FH, windowOpenings(bz, bz + d), style);
    wall(S, 'z', bz + T / 2, bz + d - T / 2, bx + w, yb, FH,
      sideDoor ? [{ a: sideDoorZ - DOOR_W / 2, b: sideDoorZ + DOOR_W / 2, y0: 0, y1: DOOR_H }] : windowOpenings(bz, bz + d), style);
    if (f > 0) {
      const hole = { x0: sx - 0.3, z0: laneZ0 - 0.1, x1: sx + sLen, z1: laneZ1 + 0.1 };
      slab(S, bx + T / 2, bz + T / 2, bx + w - T / 2, bz + d - T / 2, yb, 0.25, 0xa58a65, PAT.WOOD, 'wood', [hole]);
    }
  }
  if (floors > 1) S.addStairs(sx, laneZc, y0, 0, sLen, laneW, FH, 0x9c7a52, PAT.WOOD, 'wood');

  const top = y0 + floors * FH;
  slab(S, bx - 0.3, bz - 0.3, bx + w + 0.3, bz + d + 0.3, top + 0.3, 0.3, style.trim, PAT.PLAIN, style.mat);
  if (roof === 'pyramid') S.addRoof(bx - 0.5, bz - 0.5, bx + w + 0.5, bz + d + 0.5, top + 0.3, Math.min(w, d) * 0.32, style.roof, PAT.ROOF, 'wood');
  else {
    // parapet
    for (const [a0, a1, c, ax] of [[bx, bx + w, bz, 'x'], [bx, bx + w, bz + d, 'x'], [bz, bz + d, bx, 'z'], [bz, bz + d, bx + w, 'z']]) {
      wall(S, ax, a0, a1, c, top + 0.3, 0.9, [], style, 0.25);
    }
  }

  // loot
  const out = V(doorX, g, front - inward * 1.6);
  const inn = V(doorX, y0, front + inward * 1.6);
  const avoid = [stairRect];
  const pts = [];
  const nGround = rng.int(1, 2);
  for (let i = 0; i < nGround; i++) {
    const [x, z] = interiorPoint(rng, bx + 1, bz + 1, bx + w - 1, bz + d - 1, avoid);
    pts.push(register(W, 'loot', x, y0, z, null));
  }
  let upChain = null;
  if (floors > 1) {
    upChain = [out, inn, V(sx - 0.5, y0, laneZc), V(sx + sLen + 1.0, y0 + FH, laneZc)];
    const n = rng.int(1, 2);
    for (let i = 0; i < n; i++) {
      const [x, z] = interiorPoint(rng, bx + 1, bz + 1, bx + w - 1, bz + d - 1, [{ x0: sx - 1, z0: laneZ0 - 0.5, x1: sx + sLen + 0.2, z1: laneZ1 + 0.5 }]);
      pts.push(register(W, 'loot', x, y0 + FH, z, upChain));
    }
  }
  if (rng.chance(chestChance)) {
    const upper = floors > 1 && rng.chance(0.5);
    const yy = upper ? y0 + FH : y0;
    const [x, z] = interiorPoint(rng, bx + 1.2, bz + 1.2, bx + w - 1.2, bz + d - 1.2, upper ? [{ x0: sx - 1, z0: laneZ0 - 0.5, x1: sx + sLen + 0.2, z1: laneZ1 + 0.5 }] : avoid);
    register(W, 'chest', x, yy, z, upper ? upChain : null);
  }
  addBuildingRecord(W, bx, bz, w, d, g, floors * FH + 3, style.roof);
}

/** Decorative band around a footprint, outside the wall faces (walls are T thick, centred on the edge). */
function trimRing(S, bx, bz, w, d, y0, y1, color) {
  const o = T / 2, e = o + 0.12;
  const nc = { noCollide: true };
  S.addBox(bx - e, y0, bz - e, bx + w + e, y1, bz - o - 0.005, color, PAT.PLAIN, null, undefined, nc);
  S.addBox(bx - e, y0, bz + d + o + 0.005, bx + w + e, y1, bz + d + e, color, PAT.PLAIN, null, undefined, nc);
  S.addBox(bx - e, y0, bz - o, bx - o - 0.005, y1, bz + d + o, color, PAT.PLAIN, null, undefined, nc);
  S.addBox(bx + w + o + 0.005, y0, bz - o, bx + w + e, y1, bz + d + o, color, PAT.PLAIN, null, undefined, nc);
}

/** Multi-storey tower with switchback stairwell and accessible roof. w must be >= 12. */
export function tower(W, bx, bz, w, d, g, rng, { floors = 3, style = STYLES.concrete, doorSide = 0, chestChance = 0.8 } = {}) {
  const S = W.S;
  foundation(S, bx, bz, w, d, g);
  const y0 = g + 0.2;
  const front = doorSide === 0 ? bz : bz + d;
  const back = doorSide === 0 ? bz + d : bz;
  const inward = doorSide === 0 ? 1 : -1;
  const doorX = bx + w / 2 + 1;
  const a = bx + 4;                 // ramp x range [a, a+4]
  const laneW = 1.9;
  // lanes against back wall
  const zB0 = doorSide === 0 ? back - T / 2 - laneW : back + T / 2;
  const zA0 = doorSide === 0 ? zB0 - laneW : zB0 + laneW;
  const lanes = [{ z0: zA0, z1: zA0 + laneW }, { z0: zB0, z1: zB0 + laneW }];
  const rampOf = (L) => {
    const lane = lanes[L % 2];
    const zc = (lane.z0 + lane.z1) / 2;
    const up = L % 2 === 0;
    return {
      lane, zc, dir: up ? 0 : 2, lowX: up ? a : a + 4, y: y0 + L * FH,
      bottom: V(up ? a - 0.7 : a + 4.7, y0 + L * FH, zc),
      top: V(up ? a + 5 : a - 1, y0 + (L + 1) * FH, zc),
    };
  };
  const stairZone = { x0: a - 2, z0: Math.min(zA0, zB0), x1: a + 6, z1: Math.max(zA0, zB0) + laneW };

  for (let f = 0; f < floors; f++) {
    const yb = y0 + f * FH;
    const doorOps = f === 0 ? [{ a: doorX - DOOR_W / 2, b: doorX + DOOR_W / 2, y0: 0, y1: DOOR_H }] : [];
    wall(S, 'x', bx, bx + w, front, yb, FH, doorOps.concat(windowOpenings(bx, bx + w, f === 0 ? [doorX] : [])), style);
    wall(S, 'x', bx, bx + w, back, yb, FH, windowOpenings(bx, bx + w, [a + 2]), style);
    wall(S, 'z', bz + T / 2, bz + d - T / 2, bx, yb, FH, windowOpenings(bz, bz + d), style);
    wall(S, 'z', bz + T / 2, bz + d - T / 2, bx + w, yb, FH, windowOpenings(bz, bz + d), style);
    // neon trim band: a thin ring on the OUTSIDE of the walls (a full slab here would share its top
    // face with the floor above and z-fight all over the floor)
    trimRing(S, bx, bz, w, d, yb + FH - 0.25, yb + FH - 0.02, style.trim);
    const r = rampOf(f);
    S.addStairs(r.lowX, r.zc, r.y, r.dir, 4, laneW, FH, 0x8c8f94, PAT.CONCRETE, 'brick');
  }
  for (let m = 1; m <= floors; m++) {
    const r = rampOf(m - 1);
    const hole = { x0: a - 0.2, z0: r.lane.z0 - 0.05, x1: a + 4.2, z1: r.lane.z1 + 0.05 };
    const isRoof = m === floors;
    const x0 = isRoof ? bx - 0.2 : bx + T / 2, x1 = isRoof ? bx + w + 0.2 : bx + w - T / 2;
    const z0 = isRoof ? bz - 0.2 : bz + T / 2, z1 = isRoof ? bz + d + 0.2 : bz + d - T / 2;
    slab(S, x0, z0, x1, z1, y0 + m * FH, 0.3, isRoof ? style.roof : 0xb9b4a8, PAT.CONCRETE, 'brick', [hole]);
  }
  const roofY = y0 + floors * FH;
  for (const [a0, a1, c, ax] of [[bx, bx + w, bz, 'x'], [bx, bx + w, bz + d, 'x'], [bz, bz + d, bx, 'z'], [bz, bz + d, bx + w, 'z']]) {
    wall(S, ax, a0, a1, c, roofY, 1.0, [], style, 0.3);
  }
  // loot + chains
  const out = V(doorX, g, front - inward * 1.6);
  const inn = V(doorX, y0, front + inward * 1.6);
  const chainFor = (m) => {
    const c = [out, inn];
    for (let L = 0; L < m; L++) { const r = rampOf(L); c.push(r.bottom, r.top); }
    return c;
  };
  const chestFloor = rng.int(0, floors);
  for (let m = 0; m <= floors; m++) {
    const yy = y0 + m * FH;
    const chain = m === 0 ? null : chainFor(m);
    const n = m === floors ? 1 : rng.int(1, 2);
    for (let i = 0; i < n; i++) {
      const [x, z] = interiorPoint(rng, bx + 1, bz + 1, bx + w - 1, bz + d - 1, [stairZone]);
      register(W, 'loot', x, yy, z, chain);
    }
    if (m === chestFloor && rng.chance(chestChance)) {
      const [x, z] = interiorPoint(rng, bx + 1.2, bz + 1.2, bx + w - 1.2, bz + d - 1.2, [stairZone]);
      register(W, 'chest', x, yy, z, chain);
    }
  }
  addBuildingRecord(W, bx, bz, w, d, g, floors * FH + 1, style.roof);
}

/** Warehouse / barn: tall single volume, big doors, interior loft platform reached by stairs. */
export function warehouse(W, bx, bz, w, d, g, rng, { style = STYLES.metal, doorSide = 0, height = 7, barn = false, chestChance = 0.8 } = {}) {
  const S = W.S;
  foundation(S, bx, bz, w, d, g);
  const y0 = g + 0.2;
  const front = doorSide === 0 ? bz : bz + d;
  const back = doorSide === 0 ? bz + d : bz;
  const inward = doorSide === 0 ? 1 : -1;
  const doorX = bx + w / 2 + 1;
  const bigW = barn ? 5 : 6, bigH = barn ? 4.6 : 5;
  wall(S, 'x', bx, bx + w, front, y0, height, [{ a: doorX - bigW / 2, b: doorX + bigW / 2, y0: 0, y1: bigH }], style);
  wall(S, 'x', bx, bx + w, back, y0, height, barn ? [{ a: doorX - bigW / 2, b: doorX + bigW / 2, y0: 0, y1: bigH }] : [{ a: doorX - 1.6, b: doorX + 1.6, y0: 0, y1: DOOR_H }], style);
  const sideDoorZ = bz + d / 2 + 1;
  wall(S, 'z', bz + T / 2, bz + d - T / 2, bx, y0, height, [{ a: sideDoorZ - 1.6, b: sideDoorZ + 1.6, y0: 0, y1: DOOR_H }, { a: bz + 2, b: bz + 3.6, y0: 3.8, y1: 5.0 }], style);
  wall(S, 'z', bz + T / 2, bz + d - T / 2, bx + w, y0, height, [{ a: bz + d - 3.6, b: bz + d - 2, y0: 3.8, y1: 5.0 }], style);
  // loft along the back wall
  const loftY = y0 + FH;
  const lz0 = doorSide === 0 ? back - T / 2 - 3.2 : back + T / 2;
  const lz1 = lz0 + 3.2;
  const sx = bx + 1.6, sLen = 4.6;
  S.addBox(sx + sLen, loftY - 0.3, lz0, bx + w - T / 2, loftY, lz1, barn ? 0xa07c52 : 0x7c8b93, barn ? PAT.WOOD : PAT.METAL, barn ? 'wood' : 'metal');
  const lzc = (lz0 + lz1) / 2;
  S.addStairs(sx, lzc, y0, 0, sLen, 1.9, FH, barn ? 0x9c7a52 : 0x7d8a92, barn ? PAT.WOOD : PAT.METAL, barn ? 'wood' : 'metal');
  // posts under loft
  for (let x = sx + sLen + 3; x < bx + w - 1; x += 4) {
    const pz = doorSide === 0 ? lz0 + 0.2 : lz1 - 0.2;
    S.addBox(x - 0.15, y0, pz - 0.15, x + 0.15, loftY - 0.3, pz + 0.15, 0x6b5a48, PAT.WOOD, 'wood');
  }
  // roof
  const top = y0 + height;
  if (barn) {
    slab(S, bx - 0.3, bz - 0.3, bx + w + 0.3, bz + d + 0.3, top + 0.25, 0.25, style.trim, PAT.PLAIN, 'wood');
    S.addRoof(bx - 0.6, bz - 0.6, bx + w + 0.6, bz + d + 0.6, top + 0.25, Math.min(w, d) * 0.36, style.roof, PAT.ROOF, 'wood');
  } else {
    slab(S, bx - 0.3, bz - 0.3, bx + w + 0.3, bz + d + 0.3, top + 0.3, 0.3, style.roof, PAT.METAL, 'metal');
  }
  // interior crates / shelves (keep the central aisle free)
  const crateZone = { x0: bx + 1, z0: doorSide === 0 ? bz + 4 : bz + 4, x1: bx + w - 1, z1: doorSide === 0 ? lz0 - 1.5 : bz + d - 4 };
  const avoid = [{ x0: doorX - 2.4, z0: bz, x1: doorX + 2.4, z1: bz + d }, { x0: sx - 1.2, z0: lz0, x1: sx + sLen, z1: lz1 }];
  const ncr = rng.int(2, 5);
  for (let i = 0; i < ncr; i++) {
    const [x, z] = interiorPoint(rng, crateZone.x0 + 1, crateZone.z0, crateZone.x1 - 1, Math.max(crateZone.z0 + 0.1, crateZone.z1), avoid);
    const s = rng.pick([1.2, 1.5]);
    S.addBox(x - s / 2, y0, z - s / 2, x + s / 2, y0 + s, z + s / 2, 0xb08850, PAT.WOOD, 'wood', 120);
    avoid.push({ x0: x - s / 2, z0: z - s / 2, x1: x + s / 2, z1: z + s / 2 });
  }
  const out = V(doorX, g, front - inward * 2);
  const inn = V(doorX, y0, front + inward * 2);
  const loftChain = [out, inn, V(sx - 0.6, y0, lzc), V(sx + sLen + 1.0, loftY, lzc)];
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) {
    const [x, z] = interiorPoint(rng, bx + 1.2, bz + 1.2, bx + w - 1.2, bz + d - 1.2, avoid);
    register(W, 'loot', x, y0, z, null);
  }
  register(W, 'loot', rng.range(sx + sLen + 1, bx + w - 1.5), loftY, lzc, loftChain);
  if (rng.chance(chestChance)) {
    if (rng.chance(0.5)) register(W, 'chest', bx + w - 1.5, loftY, lzc, loftChain);
    else { const [x, z] = interiorPoint(rng, bx + 1.2, bz + 1.2, bx + w - 1.2, bz + d - 1.2, avoid); register(W, 'chest', x, y0, z, null); }
  }
  if (rng.chance(0.6)) { const [x, z] = interiorPoint(rng, bx + 1.2, bz + 1.2, bx + w - 1.2, bz + d - 1.2, avoid); register(W, 'ammo', x, y0, z, null); }
  addBuildingRecord(W, bx, bz, w, d, g, height + 1, style.roof);
}

/** Open-ended shipping container (axis 'x' = long along x). Opening on +long end. */
export function container(W, x, z, g, axis, color, rng, stackY = 0) {
  const S = W.S;
  const L = 6, Wd = 2.4, H = 2.6, t = 0.15;
  const st = { wall: color, pat: PAT.METAL, mat: 'metal' };
  const y0 = g + stackY;
  if (axis === 'x') {
    const x0 = x - L / 2, z0 = z - Wd / 2;
    S.addBox(x0, y0, z0, x0 + L, y0 + 0.15, z0 + Wd, color, PAT.METAL, 'metal');
    S.addBox(x0, y0, z0, x0 + L, y0 + H, z0 + t, color, PAT.METAL, 'metal');
    S.addBox(x0, y0, z0 + Wd - t, x0 + L, y0 + H, z0 + Wd, color, PAT.METAL, 'metal');
    S.addBox(x0, y0, z0 + t, x0 + t, y0 + H, z0 + Wd - t, color, PAT.METAL, 'metal');
    S.addBox(x0, y0 + H - 0.15, z0, x0 + L, y0 + H, z0 + Wd, color, PAT.METAL, 'metal');
    if (stackY === 0 && rng.chance(0.45)) register(W, 'loot', x - 1, y0 + 0.15, z, null);
  } else {
    const x0 = x - Wd / 2, z0 = z - L / 2;
    S.addBox(x0, y0, z0, x0 + Wd, y0 + 0.15, z0 + L, color, PAT.METAL, 'metal');
    S.addBox(x0, y0, z0, x0 + t, y0 + H, z0 + L, color, PAT.METAL, 'metal');
    S.addBox(x0 + Wd - t, y0, z0, x0 + Wd, y0 + H, z0 + L, color, PAT.METAL, 'metal');
    S.addBox(x0 + t, y0, z0, x0 + Wd - t, y0 + H, z0 + t, color, PAT.METAL, 'metal');
    S.addBox(x0, y0 + H - 0.15, z0, x0 + Wd, y0 + H, z0 + L, color, PAT.METAL, 'metal');
    if (stackY === 0 && rng.chance(0.45)) register(W, 'loot', x, y0 + 0.15, z - 1, null);
  }
}

const CAR_COLORS = [0xd94b3d, 0x3d7dd9, 0xf0c03a, 0x52b36b, 0xeeeeee, 0x333a44, 0x9a5fd0];
const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
wheelGeo.rotateX(Math.PI / 2);

export function car(W, x, z, g, axis, rng, wrecked = false) {
  const S = W.S;
  const color = wrecked ? rng.pick([0x8a6a52, 0x7a6f66, 0x9b5d3c]) : rng.pick(CAR_COLORS);
  const L = 4.2, Wd = 1.9;
  const [hx, hz] = axis === 'x' ? [L / 2, Wd / 2] : [Wd / 2, L / 2];
  S.addBox(x - hx, g + 0.35, z - hz, x + hx, g + 1.25, z + hz, color, PAT.PLAIN, 'metal', 260);
  const [cx, cz] = axis === 'x' ? [1.15, 0.8] : [0.8, 1.15];
  S.addBox(x - cx, g + 1.25, z - cz, x + cx, g + 2.0, z + cz, wrecked ? color : 0x9fc6dd, wrecked ? PAT.PLAIN : PAT.GLASS, 'metal', 160);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wx = axis === 'x' ? x + sx * 1.4 : x + sz * 0.95;
    const wz = axis === 'x' ? z + sz * 0.95 : z + sx * 1.4;
    W.decor.add(wheelGeo, 0x222222, wx, g + 0.38, wz, axis === 'x' ? 0 : Math.PI / 2);
  }
}

export function watchtower(W, x, z, g, rng, dirSide = 0) {
  const S = W.S;
  const H = 6, s = 4;
  const x0 = x - s / 2, z0 = z - s / 2;
  for (const [px, pz] of [[x0, z0], [x0 + s, z0], [x0, z0 + s], [x0 + s, z0 + s]]) {
    S.addBox(px - 0.2, g - 0.5, pz - 0.2, px + 0.2, g + H, pz + 0.2, 0x7a5a3a, PAT.WOOD, 'wood', 200);
  }
  S.addBox(x0 - 0.3, g + H - 0.3, z0 - 0.3, x0 + s + 0.3, g + H, z0 + s + 0.3, 0xa07c52, PAT.WOOD, 'wood');
  const st = { wall: 0x9b7650, pat: PAT.WOOD, mat: 'wood' };
  wall(S, 'x', x0 - 0.3, x0 + s + 0.3, z0 - 0.3, g + H, 1.1, [], st, 0.2);
  wall(S, 'x', x0 - 0.3, x0 + s + 0.3, z0 + s + 0.3, g + H, 1.1, [], st, 0.2);
  wall(S, 'z', z0, z0 + s, x0 + s + 0.3, g + H, 1.1, [], st, 0.2);
  wall(S, 'z', z0, z0 + s, x0 - 0.3, g + H, 1.1, [{ a: z - 1.0, b: z + 1.0, y0: 0, y1: 1.2 }], st, 0.2);
  S.addRoof(x0 - 0.6, z0 - 0.6, x0 + s + 0.6, z0 + s + 0.6, g + H + 2.6, 1.6, 0x6d3b2b, PAT.ROOF, 'wood');
  for (const [px, pz] of [[x0, z0], [x0 + s, z0], [x0, z0 + s], [x0 + s, z0 + s]]) {
    S.addBox(px - 0.12, g + H, pz - 0.12, px + 0.12, g + H + 2.6, pz + 0.12, 0x7a5a3a, PAT.WOOD, 'wood', 120);
  }
  // ramp from -x side rising toward +x up to platform edge
  const rampLen = 8;
  S.addStairs(x0 - 0.3 - rampLen, z, g, 0, rampLen, 1.6, H, 0x9c7a52, PAT.WOOD, 'wood');
  const chain = [V(x0 - rampLen - 1.2, g, z), V(x0 + 0.8, g + H, z)];
  register(W, rng.chance(0.4) ? 'chest' : 'loot', x + 0.6, g + H, z, chain);
  W.buildings.push({ minX: x0 - rampLen, minZ: z0, maxX: x0 + s, maxZ: z0 + s, g, h: H + 4, color: 0x6d3b2b });
}

export function tent(W, x, z, g, rng) {
  const color = rng.pick([0x3f8f4a, 0xd88a2a, 0x3a6fb5, 0xb33a3a]);
  W.S.addRoof(x - 2, z - 2, x + 2, z + 2, g, 2.6, color, PAT.STRIPES, 'wood');
  if (rng.chance(0.5)) register(W, 'loot', x + 2.8, g, z, null);
}

export function crate(W, x, z, g, s = 1.3) {
  W.S.addBox(x - s / 2, g, z - s / 2, x + s / 2, g + s, z + s / 2, 0xb08850, PAT.WOOD, 'wood', 120);
}

const siloGeo = new THREE.CylinderGeometry(2.4, 2.4, 12, 12);
const siloCap = new THREE.SphereGeometry(2.45, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const fireGeo = new THREE.ConeGeometry(0.5, 0.9, 5);

export function silo(W, x, z, g) {
  W.decor.add(siloGeo, 0xc9ccd0, x, g + 6, z);
  W.decor.add(siloCap, 0x8a3b2e, x, g + 12, z);
  W.S.addBox(x - 2.1, g, z - 2.1, x + 2.1, g + 13, z + 2.1, 0xc9ccd0, PAT.METAL, null, undefined).idx;
  // the collision box stays, its visual is shrunk to fit fully inside the cylinder (corners used to poke out)
  const p = W.S.parts[W.S.parts.length - 1];
  W.S.shapes.box.setBox(p.idx, x - 1.6, g, z - 1.6, x + 1.6, g + 11.9, z + 1.6);
}

export function campfire(W, x, z, g) {
  W.decor.add(fireGeo, 0xff8a2a, x, g + 0.45, z);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    W.decor.add(new THREE.BoxGeometry(0.3, 0.25, 0.3), 0x777777, x + Math.cos(a) * 0.8, g + 0.12, z + Math.sin(a) * 0.8);
  }
}

export function fence(W, x0, z0, x1, z1, g) {
  const S = W.S;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 4));
  for (let i = 0; i < n; i++) {
    const ax = x0 + (x1 - x0) * i / n, az = z0 + (z1 - z0) * i / n;
    const bx = x0 + (x1 - x0) * (i + 1) / n, bz = z0 + (z1 - z0) * (i + 1) / n;
    S.addBox(Math.min(ax, bx) - 0.08, g, Math.min(az, bz) - 0.08, Math.max(ax, bx) + 0.08, g + 1.1, Math.max(az, bz) + 0.08, 0xd9c7a4, PAT.WOOD, 'wood', 60);
  }
}

export function pier(W, x0, z0, dirX, dirZ, len, g) {
  const S = W.S;
  for (let i = 0; i < len; i += 4) {
    const cx = x0 + dirX * (i + 2), cz = z0 + dirZ * (i + 2);
    S.addBox(cx - 2, g - 0.3, cz - 2, cx + 2, g, cz + 2, 0x9a7650, PAT.WOOD, 'wood', 250);
    for (const sx of [-1.8, 1.8]) {
      const px = cx + (dirZ !== 0 ? sx : 0), pz = cz + (dirX !== 0 ? sx : 0);
      W.decor.add(new THREE.CylinderGeometry(0.18, 0.18, 8, 6), 0x5a4330, px, g - 4.2, pz);
    }
  }
}
