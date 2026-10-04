// Ground loot, chests and ammo boxes: simulation data + instanced rendering.
import * as THREE from 'three';
import { RARITIES } from '../core/config.js';
import { CONSUMABLES, rollLoot } from '../combat/Items.js';
import { weaponGeometry, ammoGeometry, consumableGeometry, materialGeometry, chestGeometries, ammoBoxGeometry } from './Models.js';
import { makeHit } from './Physics.js';

export const AMMO_COLORS = { light: 0x9ecbff, medium: 0x7fd27f, heavy: 0xe06a6a, shells: 0xf0a040, rockets: 0xc070ff };
export const MAT_COLORS = { wood: 0xc08a4a, brick: 0xb8644c, metal: 0xa9bac4 };
const WEAPON_TYPES = ['ar', 'shotgun', 'smg', 'sniper', 'pistol', 'rocket'];
const CONS_TYPES = ['bandage', 'medkit', 'smallshield', 'bigshield', 'grenade'];
const VIEW_DIST = 85;
const BUCKET = 16;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _ax = new THREE.Vector3(0, 1, 0);
const _lidAx = new THREE.Vector3(1, 0, 0);
const _q2 = new THREE.Quaternion();
const tmpG = { y: 0 };
const wallHit = makeHit();
const RAY_OPTS = { terrain: false };
const _tilt = new THREE.Quaternion(), _tiltAx = new THREE.Vector3();
const GRAV = 20, BOUNCE = 0.32, WALL_BOUNCE = 0.45;

let nextLootId = 1;

export class Loot {
  constructor(scene, physics, events, rng) {
    this.physics = physics;
    this.events = events;
    this.rng = rng;
    this.items = [];
    this.buckets = new Map();
    this.chests = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.mat.emissive = new THREE.Color(0x222222);
    this.meshes = {};
    const mk = (key, geo, max) => {
      const im = new THREE.InstancedMesh(geo, this.mat, max);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false; im.count = 0; im.castShadow = false;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
      this.group.add(im);
      this.meshes[key] = im;
    };
    for (const t of WEAPON_TYPES) mk('w_' + t, weaponGeometry(t), 300);
    for (const t of CONS_TYPES) mk('c_' + t, consumableGeometry(t), 200);
    mk('ammo', ammoGeometry(), 400);
    mk('mat', materialGeometry(), 300);
    const cg = chestGeometries();
    mk('chestBody', cg.body, 400);
    mk('chestLid', cg.lid, 400);
    mk('ammoBox', ammoBoxGeometry(), 200);
    for (const k of ['chestBody', 'chestLid', 'ammoBox']) this.meshes[k].castShadow = true;

    // glow sprites (rarity halos, chest shimmer)
    const MAXG = 900;
    this.glowPos = new Float32Array(MAXG * 3);
    this.glowCol = new Float32Array(MAXG * 3);
    this.glowSize = new Float32Array(MAXG);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(this.glowPos, 3).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('color', new THREE.BufferAttribute(this.glowCol, 3).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('size', new THREE.BufferAttribute(this.glowSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.glowGeo = gg;
    this.glowMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)); gl_FragColor = vec4(vC * a * a, 1.0); }`,
    });
    this.glow = new THREE.Points(gg, this.glowMat);
    this.glow.frustumCulled = false;
    this.group.add(this.glow);
    this.maxGlow = MAXG;
    this.time = 0;
    // something under a resting item / chest was destroyed (floor, build piece, crate...): let it fall
    events.on('navDirty', (b) => this.wake(b.minX, b.minZ, b.maxX, b.maxZ));
  }

  /** Re-check support for items and chests inside a rectangle; unsupported ones start falling. */
  wake(minX, minZ, maxX, maxZ) {
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const r = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 0.8;
    for (const it of this.query(cx, cz, r, this._wake || (this._wake = []))) {
      if (!it.resting) continue;
      this.physics.groundAt(it.x, it.z, it.y + 0.3, tmpG, 0.05);
      if (tmpG.y < it.y - 0.06) { it.resting = false; it.vx = it.vz = 0; it.vy = 0; }
    }
    for (const c of this.chests) {
      if (!c.alive || c.falling || c.x < minX - 1 || c.x > maxX + 1 || c.z < minZ - 1 || c.z > maxZ + 1) continue;
      this.physics.groundAt(c.x, c.z, c.y + 0.3, tmpG, 0.05);
      if (tmpG.y < c.y - 0.06) { c.falling = true; c.vy = 0; c.chain = null; }
    }
  }

  bucketKey(x, z) { return (Math.floor(x / BUCKET) + 200) * 1000 + (Math.floor(z / BUCKET) + 200); }
  addToBucket(it) {
    const k = this.bucketKey(it.x, it.z);
    it.bucket = k;
    let b = this.buckets.get(k);
    if (!b) { b = []; this.buckets.set(k, b); }
    b.push(it);
  }
  removeFromBucket(it) {
    const b = this.buckets.get(it.bucket);
    if (!b) return;
    const i = b.indexOf(it);
    if (i >= 0) { b[i] = b[b.length - 1]; b.pop(); }
  }

  /** Spawn an item at a position; optional velocity for a pop-out arc. */
  spawn(item, x, y, z, vx = 0, vy = 0, vz = 0) {
    const it = { id: nextLootId++, item, x, y, z, vx, vy, vz, resting: vx === 0 && vy === 0 && vz === 0, alive: true, t: 0, phase: Math.random() * 6.28, spin: 0, spinAx: Math.random() * 6.28 };
    this.items.push(it);
    this.addToBucket(it);
    return it;
  }

  spawnBurst(items, x, y, z, speed = 3.2) {
    items.forEach((item, i) => {
      const a = (i / items.length) * Math.PI * 2 + this.rng.range(-0.3, 0.3);
      const s = speed * this.rng.range(0.6, 1.0);
      this.spawn(item, x, y + 0.3, z, Math.cos(a) * s, 4.5, Math.sin(a) * s);
    });
  }

  remove(it) {
    if (!it.alive) return;
    it.alive = false;
    this.removeFromBucket(it);
  }

  /** Items within radius of (x,z). out reused. */
  query(x, z, r, out = []) {
    out.length = 0;
    const b0x = Math.floor((x - r) / BUCKET), b1x = Math.floor((x + r) / BUCKET);
    const b0z = Math.floor((z - r) / BUCKET), b1z = Math.floor((z + r) / BUCKET);
    for (let bx = b0x; bx <= b1x; bx++) for (let bz = b0z; bz <= b1z; bz++) {
      const b = this.buckets.get((bx + 200) * 1000 + (bz + 200));
      if (!b) continue;
      for (const it of b) if (it.alive && (it.x - x) ** 2 + (it.z - z) ** 2 <= r * r) out.push(it);
    }
    return out;
  }

  addChest(spot, kind = 'chest') {
    const c = { kind, x: spot.x, y: spot.y, z: spot.z, opened: false, openT: 0, chain: spot.chain, poi: spot.poi, rot: Math.round(this.rng.range(0, 3)) * Math.PI / 2, alive: true, claimedBy: null };
    this.chests.push(c);
    return c;
  }

  openChest(c) {
    if (c.opened) return false;
    c.opened = true;
    c.openT = 0;
    const items = rollLoot(this.rng, c.kind === 'chest' ? 'chest' : 'ammobox');
    this.spawnBurst(items, c.x, c.y + 0.5, c.z);
    this.events.emit('chestOpened', { chest: c });
    return true;
  }

  /** Populate floor loot / chests from generated spots. */
  populate(world) {
    const rng = this.rng;
    for (const s of world.lootSpots) {
      if (!rng.chance(0.78)) continue;
      const items = rollLoot(rng, 'floor');
      items.forEach((item, i) => this.spawn(item, s.x + i * 0.55 - 0.25, s.y + 0.02, s.z + (i % 2) * 0.3));
    }
    for (const s of world.chestSpots) if (rng.chance(0.9)) this.addChest(s, 'chest');
    for (const s of world.ammoSpots) this.addChest(s, 'ammo');
  }

  update(dt) {
    this.time += dt;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.alive || it.resting) continue;
      it.t += dt;
      it.vy = Math.max(-40, it.vy - GRAV * dt);
      // walls: bounce off anything solid in the way instead of flying through it
      const hs = Math.hypot(it.vx, it.vz);
      if (hs > 0.05) {
        const ux = it.vx / hs, uz = it.vz / hs;
        this.physics.raycast(it.x, it.y + 0.2, it.z, ux, 0, uz, hs * dt + 0.18, RAY_OPTS, wallHit);
        if (wallHit.hit && Math.abs(wallHit.ny) < 0.7) {
          const dot = it.vx * wallHit.nx + it.vz * wallHit.nz;
          if (dot < 0) { it.vx -= (1 + WALL_BOUNCE) * dot * wallHit.nx; it.vz -= (1 + WALL_BOUNCE) * dot * wallHit.nz; }
        }
      }
      // airborne tumble, settles upright on landing
      it.spin += dt * (4 + hs * 2);
      const nx = it.x + it.vx * dt, nz = it.z + it.vz * dt, ny = it.y + it.vy * dt;
      this.physics.groundAt(nx, nz, Math.max(it.y, ny) + 0.3, tmpG, 0.05);
      it.x = nx; it.z = nz; it.y = ny;
      if (ny <= tmpG.y) {
        it.y = tmpG.y + 0.02;
        const impact = -it.vy;
        if (impact > 3.5 && !tmpG.water) { it.vy = impact * BOUNCE; it.vx *= 0.6; it.vz *= 0.6; }
        else {
          it.vy = 0; it.vx *= 0.3; it.vz *= 0.3;
          if (Math.abs(it.vx) + Math.abs(it.vz) < 0.3) { it.resting = true; it.spin = 0; this.removeFromBucket(it); this.addToBucket(it); }
        }
      }
    }
    for (const c of this.chests) {
      if (c.falling) {
        c.vy = Math.max(-40, c.vy - GRAV * dt);
        const ny = c.y + c.vy * dt;
        this.physics.groundAt(c.x, c.z, Math.max(c.y, ny) + 0.3, tmpG, 0.05);
        c.y = ny;
        if (ny <= tmpG.y) { c.y = tmpG.y; c.vy = 0; c.falling = false; }
      }
      if (c.opened && c.alive) { c.openT += dt; if (c.openT > 1.4) c.alive = false; }
    }
    // compact dead items occasionally
    if (this.items.length > 200 && Math.random() < 0.02) this.items = this.items.filter((it) => it.alive);
  }

  /** Rebuild instance buffers for things near the camera. */
  render(cam) {
    const cx = cam.x, cz = cam.z;
    const counts = {};
    for (const k in this.meshes) counts[k] = 0;
    let g = 0;
    const t = this.time;
    const addGlow = (x, y, z, col, size) => {
      if (g >= this.maxGlow) return;
      this.glowPos[g * 3] = x; this.glowPos[g * 3 + 1] = y; this.glowPos[g * 3 + 2] = z;
      _c.set(col); this.glowCol[g * 3] = _c.r; this.glowCol[g * 3 + 1] = _c.g; this.glowCol[g * 3 + 2] = _c.b;
      this.glowSize[g] = size; g++;
    };
    const near = this.query(cx, cz, VIEW_DIST, this._near || (this._near = []));
    for (const it of near) {
      const item = it.item;
      let key, color, scale = 1.25;
      if (item.kind === 'weapon') { key = 'w_' + item.type; color = RARITIES[item.rarity].hex; scale = 1.35; }
      else if (item.kind === 'consumable') { key = 'c_' + item.type; color = CONSUMABLES[item.type].color; }
      else if (item.kind === 'ammo') { key = 'ammo'; color = AMMO_COLORS[item.type]; }
      else { key = 'mat'; color = MAT_COLORS[item.type]; }
      const im = this.meshes[key];
      const n = counts[key];
      if (n >= im.instanceMatrix.count) continue;
      const bob = it.resting ? Math.sin(t * 2 + it.phase) * 0.06 : 0;
      _p.set(it.x, it.y + 0.25 + bob, it.z);
      _q.setFromAxisAngle(_ax, t * 0.9 + it.phase);
      if (it.spin) { _tiltAx.set(Math.cos(it.spinAx), 0, Math.sin(it.spinAx)); _q.multiply(_tilt.setFromAxisAngle(_tiltAx, it.spin)); }
      _s.set(scale, scale, scale);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(n, _m);
      _c.set(color); im.setColorAt(n, _c);
      counts[key] = n + 1;
      if (item.kind === 'weapon') addGlow(it.x, it.y + 0.3, it.z, RARITIES[item.rarity].hex, 1.6 + item.rarity * 0.35);
      else addGlow(it.x, it.y + 0.25, it.z, color, 0.7);
    }
    for (const c of this.chests) {
      if (!c.alive) continue;
      const dx = c.x - cx, dz = c.z - cz;
      if (dx * dx + dz * dz > VIEW_DIST * VIEW_DIST * 1.5) continue;
      const isChest = c.kind === 'chest';
      const bodyKey = isChest ? 'chestBody' : 'ammoBox';
      const im = this.meshes[bodyKey];
      const n = counts[bodyKey];
      const sink = c.opened ? Math.max(0, c.openT - 0.8) * 1.2 : 0;
      _p.set(c.x, c.y - sink, c.z); _q.setFromAxisAngle(_ax, c.rot); _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(n, _m); _c.set(0xffffff); im.setColorAt(n, _c);
      counts[bodyKey] = n + 1;
      if (isChest) {
        const lid = this.meshes.chestLid;
        const ln = counts.chestLid;
        const open = c.opened ? Math.min(1, c.openT * 4) * 1.9 : 0;
        // lid hinge at back edge (local z=+0.31, y=0.55)
        _q2.setFromAxisAngle(_lidAx, open);
        _q.setFromAxisAngle(_ax, c.rot);
        const hx = Math.sin(c.rot) * 0.31, hz = Math.cos(c.rot) * 0.31;
        _p.set(c.x + hx, c.y + 0.55 - sink, c.z + hz);
        _q.multiply(_q2);
        _m.compose(_p, _q, _s);
        lid.setMatrixAt(ln, _m); _c.set(0xffffff); lid.setColorAt(ln, _c);
        counts.chestLid = ln + 1;
        if (!c.opened) {
          const d2 = dx * dx + dz * dz;
          const pulse = 0.7 + 0.3 * Math.sin(t * 5 + c.x);
          addGlow(c.x, c.y + 0.6, c.z, 0xffcc44, (d2 < 400 ? 3.2 : 2.2) * pulse);
          if (d2 < 900) {
            const a = t * 3 + c.z;
            addGlow(c.x + Math.cos(a) * 0.6, c.y + 0.6 + Math.sin(a * 1.7) * 0.3, c.z + Math.sin(a) * 0.6, 0xfff0a0, 0.35);
          }
        }
      }
    }
    for (const k in this.meshes) {
      const im = this.meshes[k];
      im.count = counts[k];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.glowGeo.setDrawRange(0, g);
    this.glowGeo.attributes.position.needsUpdate = true;
    this.glowGeo.attributes.color.needsUpdate = true;
    this.glowGeo.attributes.size.needsUpdate = true;
  }

  setPixelScale(h) { this.glowMat.uniforms.uScale.value = h * 0.9; }

  dispose() {
    for (const k in this.meshes) { this.meshes[k].geometry.dispose(); this.meshes[k].dispose(); }
    this.mat.dispose(); this.glowGeo.dispose(); this.glowMat.dispose();
    this.group.removeFromParent();
  }
}
