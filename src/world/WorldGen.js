// Island layout: named POIs, building placement, scattered camps and prop (tree/rock/bush) placement data.
import * as THREE from 'three';
import { HALF } from '../core/config.js';
import { clamp } from '../core/math.js';
import * as B from './Buildings.js';
import { STYLES } from './Buildings.js';
import { DEFAULT_MAP } from './MapOptions.js';

export const POI_DEFS = [
  { name: 'Rusty Docks', type: 'docks', r: 62 },
  { name: 'Pine Hollow', type: 'village', r: 70 },
  { name: 'Neon Heights', type: 'city', r: 66 },
  { name: 'Salvage Yard', type: 'junk', r: 58 },
  { name: 'Frost Peak', type: 'frost', r: 42 },
  { name: 'Sunny Acres', type: 'farm', r: 66 },
  { name: 'Mossy Mill', type: 'mill', r: 58 },
  { name: 'Crater Camp', type: 'camp', r: 52 },
  { name: 'Lakeside Lodge', type: 'lodge', r: 50 },
  { name: 'Copper Quarry', type: 'quarry', r: 56 },
];

const snap4 = (v) => Math.round(v / 4) * 4;
const tmpN = { x: 0, y: 1, z: 0 };

export class WorldGen {
  constructor(hm, structures, decor, rng, map = DEFAULT_MAP) {
    this.map = map;
    this.hm = hm;
    this.S = structures;
    this.decor = decor;
    this.rng = rng.fork('worldgen');
    this.pois = [];
    this.loot = []; this.chests = []; this.ammo = [];
    this.buildings = [];
    this.occupied = [];   // rects to keep props away
    this.sites = [];
  }

  ctx(poi) {
    return { S: this.S, decor: this.decor, loot: this.loot, chests: this.chests, ammo: this.ammo, buildings: this.buildings, poi };
  }

  slopeOK(x, z, r = 20) {
    const hm = this.hm;
    const h0 = hm.height(x, z);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      if (Math.abs(hm.height(x + Math.cos(a) * r, z + Math.sin(a) * r) - h0) > r * 0.45) return false;
    }
    return true;
  }

  farFromPois(x, z, d) { return this.pois.every((p) => Math.hypot(p.x - x, p.z - z) > d + p.r); }

  placePois() {
    const hm = this.hm, rng = this.rng;
    const m = hm.mountain, lake = hm.lake;
    for (const def of POI_DEFS) {
      let pos = null;
      if (def.type === 'frost') {
        const dx = -m.x, dz = -m.z, dl = Math.hypot(dx, dz) || 1;
        pos = { x: m.x + dx / dl * 70, z: m.z + dz / dl * 70 };
      } else if (def.type === 'lodge') {
        const dx = -lake.x, dz = -lake.z, dl = Math.hypot(dx, dz) || 1;
        pos = { x: lake.x + dx / dl * (lake.r + 52), z: lake.z + dz / dl * (lake.r + 52) };
      } else if (def.type === 'docks') {
        for (let tries = 0; tries < 60 && !pos; tries++) {
          const a = rng.range(0, Math.PI * 2);
          if (Math.abs(Math.atan2(Math.sin(a - Math.atan2(m.z, m.x)), Math.cos(a - Math.atan2(m.z, m.x)))) < 0.9) continue;
          let rr = 200;
          while (rr < HALF && hm.height(Math.cos(a) * rr, Math.sin(a) * rr) > 1.2) rr += 4;
          const x = Math.cos(a) * (rr - 48), z = Math.sin(a) * (rr - 48);
          if (hm.height(x, z) > 1.5 && this.farFromPois(x, z, 150)) pos = { x, z, coastA: a, coastR: rr };
        }
      } else {
        for (let tries = 0; tries < 3000 && !pos; tries++) {
          const x = rng.range(-HALF * 0.62, HALF * 0.62), z = rng.range(-HALF * 0.62, HALF * 0.62);
          const h = hm.height(x, z);
          if (h < 3 || h > 42) continue;
          if (Math.hypot(x - m.x, z - m.z) < m.r * 1.35 + def.r) continue;
          if (Math.hypot(x - lake.x, z - lake.z) < lake.r * 1.7 + def.r) continue;
          const minD = tries < 2000 ? 175 : 110;
          if (!this.farFromPois(x, z, minD)) continue;
          if (!this.slopeOK(x, z, def.r * 0.8)) continue;
          let land = true;
          for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; if (hm.height(x + Math.cos(a) * (def.r + 25), z + Math.sin(a) * (def.r + 25)) < 1.5) land = false; }
          if (!land) continue;
          pos = { x, z };
        }
      }
      if (!pos) continue;
      pos.x = snap4(pos.x); pos.z = snap4(pos.z);
      let h = hm.height(pos.x, pos.z);
      // median of samples for flattening target
      const samples = [];
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; samples.push(hm.height(pos.x + Math.cos(a) * def.r * 0.6, pos.z + Math.sin(a) * def.r * 0.6)); }
      samples.push(h); samples.sort((p, q) => p - q);
      h = clamp(samples[samples.length >> 1], 2.6, 200);
      if (def.type === 'frost') h = Math.max(h, hm.height(pos.x, pos.z));
      h = Math.round(h * 2) / 2;
      const poi = { ...def, x: pos.x, z: pos.z, h, coastA: pos.coastA, coastR: pos.coastR };
      hm.flatten(poi.x, poi.z, poi.r, h, def.type === 'frost' ? 22 : 30);
      this.pois.push(poi);
    }
  }

  /** Try to place a footprint (w x d) inside the POI. Returns {bx,bz} or null. */
  plot(poi, w, d, margin = 5, tries = 60) {
    const rng = this.rng;
    for (let t = 0; t < tries; t++) {
      const a = rng.range(0, Math.PI * 2), rr = rng.range(0, poi.r - Math.max(w, d) * 0.6);
      const bx = snap4(poi.x + Math.cos(a) * rr - w / 2), bz = snap4(poi.z + Math.sin(a) * rr - d / 2);
      const rect = { x0: bx - margin, z0: bz - margin, x1: bx + w + margin, z1: bz + d + margin };
      let ok = true;
      for (const o of this.occupied) if (rect.x0 < o.x1 && rect.x1 > o.x0 && rect.z0 < o.z1 && rect.z1 > o.z0) { ok = false; break; }
      if (!ok) continue;
      if ([[bx, bz], [bx + w, bz], [bx, bz + d], [bx + w, bz + d]].some(([x, z]) => Math.hypot(x - poi.x, z - poi.z) > poi.r + 4)) continue;
      this.occupied.push({ x0: bx - 2, z0: bz - 2, x1: bx + w + 2, z1: bz + d + 2 });
      this.hm.flattenRect(bx - 1, bz - 1, bx + w + 1, bz + d + 1, poi.h, 5);
      return { bx, bz };
    }
    return null;
  }

  doorToward(poi, bz, d) { return poi.z < bz + d / 2 ? 0 : 2; }

  buildPoi(poi) {
    const rng = this.rng, W = this.ctx(poi), g = poi.h;
    const n = (k) => Math.max(1, Math.round(k * this.map.townMul)); // Settings → Map → Buildings
    const put = (w, d, fn, margin = 5) => {
      const p = this.plot(poi, w, d, margin);
      if (p) fn(p.bx, p.bz, this.doorToward(poi, p.bz, d));
      return p;
    };
    const woodStyles = [STYLES.woodTan, STYLES.woodWhite, STYLES.woodBlue, STYLES.woodGreen];
    switch (poi.type) {
      case 'village': {
        for (let i = 0; i < n(7); i++) {
          const big = rng.chance(0.5);
          const w = big ? 12 : 8, d = big ? 8 : 12;
          put(w, d, (bx, bz, ds) => B.house(W, bx, bz, w, d, g, rng, { floors: rng.chance(0.55) ? 2 : 1, style: rng.pick(woodStyles), doorSide: ds }));
        }
        put(8, 8, (bx, bz) => B.watchtower(W, bx + 4, bz + 4, g, rng), 4);
        break;
      }
      case 'city': {
        for (let i = 0; i < n(4); i++) {
          const w = rng.pick([12, 16]), d = 12;
          put(w, d, (bx, bz, ds) => B.tower(W, bx, bz, w, d, g, rng, { floors: rng.int(3, 5), style: rng.pick([STYLES.concrete, STYLES.concreteDark, STYLES.brick]), doorSide: ds }), 6);
        }
        for (let i = 0; i < n(2); i++) put(12, 8, (bx, bz, ds) => B.house(W, bx, bz, 12, 8, g, rng, { floors: 2, style: STYLES.brickDark, doorSide: ds, roof: 'flat' }));
        // parking lot with cars
        const lot = this.plot(poi, 20, 12, 3);
        if (lot) {
          this.decor.add(boxGeo(), 0x4a4d52, lot.bx + 10, g + 0.03, lot.bz + 6, 0, 20, 0.06, 12);
          for (let i = 0; i < n(4); i++) if (rng.chance(0.7)) B.car(W, lot.bx + 3 + i * 4.6, lot.bz + 3, g, 'z', rng);
          for (let i = 0; i < n(4); i++) if (rng.chance(0.5)) B.car(W, lot.bx + 3 + i * 4.6, lot.bz + 9.5, g, 'z', rng);
        }
        break;
      }
      case 'docks': {
        for (let i = 0; i < n(3); i++) {
          const d = rng.pick([16, 20]);
          put(16, d, (bx, bz, ds) => B.warehouse(W, bx, bz, 16, d, g, rng, { style: rng.pick([STYLES.metal, STYLES.metalRust]), doorSide: ds }), 6);
        }
        const colors = [0xc0392b, 0x2e6ca4, 0x3f8f4a, 0xe67e22, 0x7f8c8d];
        for (let i = 0; i < n(4); i++) {
          const p = this.plot(poi, 8, 8, 2);
          if (!p) continue;
          const axis = rng.chance(0.5) ? 'x' : 'z';
          B.container(W, p.bx + 4, p.bz + 4, g, axis, rng.pick(colors), rng);
          if (rng.chance(0.4)) B.container(W, p.bx + 4, p.bz + 4, g, axis, rng.pick(colors), rng, 2.6);
        }
        if (poi.coastA !== undefined) {
          const dx = Math.cos(poi.coastA), dz = Math.sin(poi.coastA);
          const axisX = Math.abs(dx) > Math.abs(dz);
          const ux = axisX ? Math.sign(dx) : 0, uz = axisX ? 0 : Math.sign(dz);
          const sx = snap4(poi.x + dx * (poi.r - 10)), sz = snap4(poi.z + dz * (poi.r - 10));
          B.pier(W, sx, sz, ux, uz, 44, g + 0.2);
          this.loot.push({ x: sx + ux * 40, y: g + 0.2, z: sz + uz * 40, chain: null, poi });
          this.chests.push({ x: sx + ux * 30 + uz * 1.2, y: g + 0.2, z: sz + uz * 30 + ux * 1.2, chain: null, poi });
        }
        break;
      }
      case 'junk': {
        for (let i = 0; i < n(2); i++) put(8, 8, (bx, bz, ds) => B.house(W, bx, bz, 8, 8, g, rng, { style: STYLES.metalRust, doorSide: ds, roof: 'flat' }));
        put(16, 16, (bx, bz, ds) => B.warehouse(W, bx, bz, 16, 16, g, rng, { style: STYLES.metalRust, doorSide: ds }), 6);
        for (let i = 0; i < n(10); i++) {
          const p = this.plot(poi, 6, 6, 1);
          if (!p) continue;
          const axis = rng.chance(0.5) ? 'x' : 'z';
          B.car(W, p.bx + 3, p.bz + 3, g, axis, rng, true);
          if (rng.chance(0.5)) {
            // stacked wreck
            this.S.addBox(p.bx + 1.2, g + 2.0, p.bz + 1.8, p.bx + 4.8, g + 3.0, p.bz + 4.2, rng.pick([0x8a6a52, 0x6f7b80]), 0, 'metal', 220);
          }
          if (rng.chance(0.3)) this.ammo.push({ x: p.bx + 5.4, y: g, z: p.bz + 0.6, chain: null, poi });
        }
        const colors = [0x7f8c8d, 0xa0522d, 0x556b2f];
        for (let i = 0; i < n(3); i++) { const p = this.plot(poi, 8, 8, 1); if (p) B.container(W, p.bx + 4, p.bz + 4, g, rng.chance(0.5) ? 'x' : 'z', rng.pick(colors), rng); }
        break;
      }
      case 'frost': {
        for (let i = 0; i < n(4); i++) put(8, 8, (bx, bz, ds) => B.house(W, bx, bz, 8, 8, g, rng, { floors: rng.chance(0.4) ? 2 : 1, style: STYLES.snowCabin, doorSide: ds, chestChance: 0.7 }), 4);
        put(8, 8, (bx, bz) => B.watchtower(W, bx + 4, bz + 4, g, rng), 3);
        break;
      }
      case 'farm': {
        put(12, 16, (bx, bz, ds) => B.warehouse(W, bx, bz, 12, 16, g, rng, { style: STYLES.woodRed, doorSide: ds, barn: true, height: 6.5 }), 6);
        put(12, 8, (bx, bz, ds) => B.house(W, bx, bz, 12, 8, g, rng, { floors: 2, style: STYLES.woodWhite, doorSide: ds }));
        put(8, 8, (bx, bz, ds) => B.house(W, bx, bz, 8, 8, g, rng, { style: STYLES.woodRed, doorSide: ds }));
        for (let i = 0; i < n(2); i++) { const p = this.plot(poi, 6, 6, 2); if (p) B.silo(W, p.bx + 3, p.bz + 3, g); }
        // crop fields
        for (let i = 0; i < n(3); i++) {
          const p = this.plot(poi, 16, 12, 2);
          if (!p) continue;
          const crop = rng.pick([0x8fbf3f, 0xe0c35a, 0x6aa84f]);
          for (let r = 0; r < 6; r++) this.decor.add(boxGeo(), crop, p.bx + 8, g + 0.35, p.bz + 1 + r * 2, 0, 15, 0.7, 0.8);
          B.fence(W, p.bx, p.bz, p.bx + 16, p.bz, g);
          B.fence(W, p.bx, p.bz + 12, p.bx + 16, p.bz + 12, g);
        }
        for (let i = 0; i < n(5); i++) { const p = this.plot(poi, 3, 3, 1); if (p) this.S.addBox(p.bx, g, p.bz, p.bx + 1.8, g + 1.4, p.bz + 2.6, 0xe0c060, 6, 'wood', 100); }
        break;
      }
      case 'mill': {
        put(16, 24, (bx, bz, ds) => {
          B.warehouse(W, bx, bz, 16, 24, g, rng, { style: STYLES.brick, doorSide: ds, height: 8 });
          this.S.addBox(bx + 12, g, bz + 2, bx + 15, g + 22, bz + 5, 0x8d5a48, 2, 'brick', 600);
        }, 6);
        for (let i = 0; i < n(3); i++) put(8, 12, (bx, bz, ds) => B.house(W, bx, bz, 8, 12, g, rng, { floors: rng.chance(0.5) ? 2 : 1, style: rng.pick([STYLES.brick, STYLES.woodGreen]), doorSide: ds }));
        for (let i = 0; i < n(6); i++) { const p = this.plot(poi, 3, 3, 1); if (p) { B.crate(W, p.bx + 1.5, p.bz + 1.5, g); if (rng.chance(0.4)) B.crate(W, p.bx + 1.5, p.bz + 1.5, g + 1.3, 1.0); } }
        break;
      }
      case 'camp': {
        for (let i = 0; i < n(6); i++) { const p = this.plot(poi, 6, 6, 2); if (p) B.tent(W, p.bx + 3, p.bz + 3, g, rng); }
        for (let i = 0; i < n(2); i++) put(8, 8, (bx, bz) => B.watchtower(W, bx + 4, bz + 4, g, rng), 3);
        put(8, 8, (bx, bz, ds) => B.house(W, bx, bz, 8, 8, g, rng, { style: STYLES.woodTan, doorSide: ds }));
        B.campfire(W, poi.x, poi.z, g);
        for (let i = 0; i < n(8); i++) { const p = this.plot(poi, 3, 3, 1); if (p) B.crate(W, p.bx + 1.5, p.bz + 1.5, g); }
        this.ammo.push({ x: poi.x + 3, y: g, z: poi.z + 2, chain: null, poi });
        break;
      }
      case 'lodge': {
        put(16, 12, (bx, bz, ds) => B.house(W, bx, bz, 16, 12, g, rng, { floors: 2, style: STYLES.woodTan, doorSide: ds, chestChance: 1 }), 6);
        for (let i = 0; i < n(3); i++) put(8, 8, (bx, bz, ds) => B.house(W, bx, bz, 8, 8, g, rng, { style: rng.pick(woodStyles), doorSide: ds }));
        put(8, 8, (bx, bz) => B.watchtower(W, bx + 4, bz + 4, g, rng), 3);
        break;
      }
      case 'quarry': {
        put(16, 16, (bx, bz, ds) => B.warehouse(W, bx, bz, 16, 16, g, rng, { style: STYLES.metal, doorSide: ds }), 6);
        for (let i = 0; i < n(3); i++) put(8, 8, (bx, bz, ds) => B.house(W, bx, bz, 8, 8, g, rng, { style: STYLES.metal, doorSide: ds, roof: 'flat' }));
        put(12, 12, (bx, bz, ds) => B.tower(W, bx, bz, 12, 12, g, rng, { floors: 2, style: STYLES.brickDark, doorSide: ds }), 6);
        for (let i = 0; i < n(4); i++) { const p = this.plot(poi, 6, 6, 1); if (p) B.car(W, p.bx + 3, p.bz + 3, g, rng.chance(0.5) ? 'x' : 'z', rng, rng.chance(0.4)); }
        break;
      }
    }
    // a few outdoor loot spots in every POI
    for (let i = 0; i < n(4); i++) {
      const a = rng.range(0, Math.PI * 2), rr = rng.range(5, poi.r * 0.9);
      const x = poi.x + Math.cos(a) * rr, z = poi.z + Math.sin(a) * rr;
      if (this.occupied.some((o) => x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1)) continue;
      this.loot.push({ x, y: this.hm.height(x, z), z, chain: null, poi });
    }
  }

  placeSites() {
    const rng = this.rng, hm = this.hm;
    let made = 0;
    for (let tries = 0; tries < 4000 && made < this.map.siteCount; tries++) {
      const x = snap4(rng.range(-HALF * 0.75, HALF * 0.75)), z = snap4(rng.range(-HALF * 0.75, HALF * 0.75));
      const h = hm.height(x, z);
      if (h < 3.5 || h > 70) continue;
      if (!this.farFromPois(x, z, 60)) continue;
      if (this.sites.some((s) => Math.hypot(s.x - x, s.z - z) < (this.map.siteCount > 20 ? 75 : 110))) continue;
      if (!this.slopeOK(x, z, 12)) continue;
      const g = Math.round(h * 2) / 2;
      hm.flatten(x, z, 12, g, 10);
      const site = { name: null, x, z, r: 14, h: g, type: 'site' };
      this.sites.push(site);
      const W = this.ctx(site);
      const kind = rng.int(0, 3);
      if (kind === 0) {
        B.house(W, x - 4, z - 4, 8, 8, g, rng, { style: rng.pick([STYLES.woodTan, STYLES.woodGreen, STYLES.woodWhite]), doorSide: rng.chance(0.5) ? 0 : 2, chestChance: 0.7 });
        this.occupied.push({ x0: x - 6, z0: z - 6, x1: x + 6, z1: z + 6 });
      } else if (kind === 1) {
        B.tent(W, x - 3, z, g, rng); B.tent(W, x + 3, z + 2, g, rng); B.campfire(W, x, z - 3, g);
        B.crate(W, x + 4, z - 4, g);
        this.chests.push({ x: x - 1, y: g, z: z + 4, chain: null, poi: site });
        this.occupied.push({ x0: x - 7, z0: z - 7, x1: x + 7, z1: z + 7 });
      } else if (kind === 2) {
        B.watchtower(W, x, z, g, rng);
        this.occupied.push({ x0: x - 12, z0: z - 4, x1: x + 4, z1: z + 4 });
      } else {
        B.car(W, x - 2, z, g, 'x', rng, true); B.car(W, x + 2.5, z + 3, g, 'z', rng, true);
        B.crate(W, x + 3, z - 3, g);
        this.ammo.push({ x: x - 3, y: g, z: z + 3, chain: null, poi: site });
        this.loot.push({ x: x + 1, y: g, z: z - 2, chain: null, poi: site });
        this.occupied.push({ x0: x - 6, z0: z - 6, x1: x + 6, z1: z + 6 });
      }
    }
  }

  generate() {
    // winter: every roof gets a snow cover (styles are shared module data -> restore afterwards)
    const snow = this.map.theme && this.map.theme.snowRoofs;
    const saved = snow ? Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v.roof])) : null;
    if (snow) for (const st of Object.values(STYLES)) st.roof = 0xf2f6fa;
    try {
      this.placePois();
      for (const p of this.pois) this.buildPoi(p);
      this.placeSites();
    } finally {
      if (saved) for (const [k, v] of Object.entries(saved)) STYLES[k].roof = v;
    }
    this.hm.recomputeBounds();
  }

  /** Prop placement (after terrain is final). Returns arrays of plain data. */
  propPlacement() {
    const rng = this.rng.fork('props'), hm = this.hm, s = hm.noise;
    const trees = [], rocks = [], bushes = [];
    const blocked = (x, z, pad) => {
      for (const o of this.occupied) if (x > o.x0 - pad && x < o.x1 + pad && z > o.z0 - pad && z < o.z1 + pad) return true;
      return false;
    };
    const inPoi = (x, z, pad = 0) => this.pois.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + pad);
    const pineHollow = this.pois.find((p) => p.type === 'village');
    for (let gz = -HALF + 6; gz < HALF - 6; gz += 8) {
      for (let gx = -HALF + 6; gx < HALF - 6; gx += 8) {
        const x = gx + rng.range(-3.5, 3.5), z = gz + rng.range(-3.5, 3.5);
        const h = hm.height(x, z);
        if (h < 3.2) continue;
        hm.normal(x, z, tmpN);
        if (tmpN.y < 0.8) continue;
        const forest = s.fbm(x * 0.006 + 100, z * 0.006 - 50, 3);
        let p = forest > 0.15 ? 0.55 : forest > -0.05 ? 0.12 : 0.025;
        if (h > 75) p *= 0.4;
        const inHollow = pineHollow && Math.hypot(pineHollow.x - x, pineHollow.z - z) < pineHollow.r;
        if (inPoi(x, z, 8) && !inHollow) continue;
        if (inHollow) p = 0.3;
        p *= this.map.forestMul;
        if (!rng.chance(p)) continue;
        if (blocked(x, z, 3)) continue;
        const type = h > 55 || inHollow ? 0 : rng.weighted(this.map.theme ? this.map.theme.treeWeights : [0.45, 0.4, 0.15]);
        trees.push({ x, z, y: h, type, scale: rng.range(0.8, 1.35), rot: rng.range(0, Math.PI * 2) });
      }
    }
    const nRocks = Math.round(900 * (this.map.theme ? this.map.theme.rockMul : 1));
    for (let i = 0; i < nRocks; i++) {
      const x = rng.range(-HALF * 0.9, HALF * 0.9), z = rng.range(-HALF * 0.9, HALF * 0.9);
      const h = hm.height(x, z);
      if (h < 1) continue;
      if (inPoi(x, z, 4) || blocked(x, z, 3)) continue;
      hm.normal(x, z, tmpN);
      const mountain = Math.hypot(x - hm.mountain.x, z - hm.mountain.z) < hm.mountain.r * 1.3;
      if (!mountain && tmpN.y > 0.9 && !rng.chance(0.45)) continue;
      const big = rng.chance(0.3);
      rocks.push({ x, z, y: h, sx: big ? rng.range(3, 5.5) : rng.range(1.4, 2.8), sy: big ? rng.range(2.2, 4) : rng.range(0.9, 1.9), sz: big ? rng.range(3, 5.5) : rng.range(1.4, 2.8), rot: rng.range(0, Math.PI * 2) });
    }
    const nBushes = Math.round(2600 * Math.min(1.6, this.map.forestMul));
    for (let i = 0; i < nBushes; i++) {
      const x = rng.range(-HALF * 0.9, HALF * 0.9), z = rng.range(-HALF * 0.9, HALF * 0.9);
      const h = hm.height(x, z);
      if (h < 3 || h > 75) continue;
      if (blocked(x, z, 1.5)) continue;
      bushes.push({ x, z, y: h, s: rng.range(0.7, 1.5) });
    }
    return { trees, rocks, bushes };
  }
}

let _box = null;
function boxGeo() { if (!_box) _box = new THREE.BoxGeometry(1, 1, 1); return _box; }
