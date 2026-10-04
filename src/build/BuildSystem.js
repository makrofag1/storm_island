// Building: placement on the grid, materials, HP growth while building, damage/destruction,
// support graph collapse, and 3x3 tile editing. Also the ghost preview for the player.
import * as THREE from 'three';
import { makeCollider, C_BOX, C_RAMP, C_ROOF } from '../world/Colliders.js';
import { DIR_ROT } from '../world/Structures.js';
import { stairsGeometry, roofGeometry } from '../world/InstancedShapes.js';
import { CELL, LEVEL_H, BUILD_COST } from '../core/config.js';
import { yawDirX, yawDirZ } from '../core/math.js';
import {
  BUILD_MATS, pieceKey, pieceBounds, tileBounds, boundsOverlap, dirFromVector, wallSlotFacing, levelAt, FULL_MASK, ROOF_H,
} from './grid.js';

const tmpList = [];
let nextPieceId = 1;

export class BuildSystem {
  constructor(ctx) {
    this.ctx = ctx; // { hash, shapes, hm, events, chars, time(), scene }
    this.pieces = new Map();   // key -> piece
    this.growing = new Set();
    this.ghost = new Ghost(ctx.scene);
    this.stats = { placed: 0, destroyed: 0 };
  }

  get count() { return this.pieces.size; }

  /** Validate a placement. Returns {ok, reason, bounds, grounded}. */
  validate(owner, type, ix, iz, L, extra, material) {
    const axis = type === 'wall' ? extra : null;
    const key = pieceKey(type, ix, iz, L, axis);
    const b = pieceBounds(type, ix, iz, L, axis);
    if (this.pieces.has(key)) return { ok: false, reason: 'occupied', bounds: b, key };
    if (material && owner && owner.inv.mats[material] < BUILD_COST) return { ok: false, reason: 'mats', bounds: b, key };
    if (L < -2 || L > 60) return { ok: false, reason: 'height', bounds: b, key };
    // terrain contact / fully buried
    const hm = this.ctx.hm;
    let maxT = -Infinity, minT = Infinity;
    const samples = type === 'wall' ? 5 : 3;
    for (let a = 0; a < samples; a++) for (let c = 0; c < samples; c++) {
      const x = b.minX + (b.maxX - b.minX) * (a + 0.5) / samples;
      const z = b.minZ + (b.maxZ - b.minZ) * (c + 0.5) / samples;
      const h = hm.height(x, z);
      if (h > maxT) maxT = h;
      if (h < minT) minT = h;
    }
    if (minT > b.maxY - 0.15) return { ok: false, reason: 'buried', bounds: b, key };
    let grounded = maxT >= b.minY - (type === 'wall' ? 1.1 : 0.6);
    // overlap with static world / neighbors
    const list = this.ctx.hash.query(b.minX - 0.25, b.minZ - 0.25, b.maxX + 0.25, b.maxZ + 0.25, tmpList);
    let attached = false;
    const shrink = { minX: b.minX + 0.35, minY: b.minY + 0.35, minZ: b.minZ + 0.35, maxX: b.maxX - 0.35, maxY: b.maxY - 0.35, maxZ: b.maxZ - 0.35 };
    if (type === 'wall') { if (axis === 'x') { shrink.minZ = b.minZ + 0.05; shrink.maxZ = b.maxZ - 0.05; } else { shrink.minX = b.minX + 0.05; shrink.maxX = b.maxX - 0.05; } }
    if (type === 'floor') { shrink.minY = b.minY + 0.05; shrink.maxY = b.maxY - 0.05; }
    for (const c of list) {
      const o = c.owner;
      if (!o) continue;
      if (o.kind === 'build') {
        if (boundsOverlap(b, c, 0.2)) attached = true;
        continue;
      }
      if (boundsOverlap(shrink, c, 0)) return { ok: false, reason: 'blocked', bounds: b, key };
      if (o.kind === 'struct' && boundsOverlap(b, c, 0.2)) grounded = true;
    }
    if (!grounded && !attached) return { ok: false, reason: 'support', bounds: b, key };
    return { ok: true, bounds: b, grounded, key };
  }

  /** Place a piece if valid. Returns the piece or null. */
  place(owner, type, ix, iz, L, extra, material) {
    const v = this.validate(owner, type, ix, iz, L, extra, material);
    if (!v.ok) return null;
    const m = BUILD_MATS[material];
    if (owner) owner.inv.mats[material] -= BUILD_COST;
    const piece = {
      kind: 'build', id: nextPieceId++, type, ix, iz, L,
      axis: type === 'wall' ? extra : null, dir: type === 'stairs' ? extra : 0,
      material, maxHp: m.hp, hp: m.hp * m.start, built: false, buildT: 0,
      owner, key: v.key, grounded: v.grounded, mask: FULL_MASK, alive: true,
      inst: [], colliders: [], bounds: v.bounds,
    };
    this.pieces.set(v.key, piece);
    this.growing.add(piece);
    this.realize(piece);
    this.stats.placed++;
    this.ctx.events.emit('built', { piece, owner, x: (v.bounds.minX + v.bounds.maxX) / 2, y: (v.bounds.minY + v.bounds.maxY) / 2, z: (v.bounds.minZ + v.bounds.maxZ) / 2 });
    this.ctx.events.emit('navDirty', { minX: v.bounds.minX, minZ: v.bounds.minZ, maxX: v.bounds.maxX, maxZ: v.bounds.maxZ });
    return piece;
  }

  /** (Re)create instances + colliders for a piece according to its edit mask. */
  realize(piece) {
    this.unrealize(piece);
    const shapes = this.ctx.shapes, hash = this.ctx.hash;
    const m = BUILD_MATS[piece.material];
    const add = (batch, idx, col) => { piece.inst.push([batch, idx]); if (col) { col.owner = piece; hash.insert(col); piece.colliders.push(col); } };
    const b = piece.bounds;
    if (piece.type === 'stairs') {
      const idx = shapes.stairs.alloc();
      if (idx < 0) return;
      const dx = [1, 0, -1, 0][piece.dir], dz = [0, 1, 0, -1][piece.dir];
      shapes.stairs.setTRS(idx, (b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2, DIR_ROT[piece.dir], CELL, LEVEL_H, CELL);
      add(shapes.stairs, idx, makeCollider(C_RAMP, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, null, piece.dir));
      void dx; void dz;
    } else if (piece.type === 'roof') {
      const idx = shapes.roof.alloc();
      if (idx < 0) return;
      shapes.roof.setTRS(idx, (b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2, 0, CELL, ROOF_H, CELL);
      add(shapes.roof, idx, makeCollider(C_ROOF, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ));
    } else if (piece.mask === FULL_MASK) {
      const idx = shapes.box.alloc();
      if (idx < 0) return;
      shapes.box.setBox(idx, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
      add(shapes.box, idx, makeCollider(C_BOX, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ));
    } else {
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
        if (!(piece.mask & (1 << (j * 3 + i)))) continue;
        const t = tileBounds(piece.type, piece.ix, piece.iz, piece.L, piece.axis, i, j);
        const idx = shapes.box.alloc();
        if (idx < 0) continue;
        shapes.box.setBox(idx, t.minX, t.minY, t.minZ, t.maxX, t.maxY, t.maxZ);
        add(shapes.box, idx, makeCollider(C_BOX, t.minX, t.minY, t.minZ, t.maxX, t.maxY, t.maxZ));
      }
    }
    this.refreshLook(piece);
  }

  unrealize(piece) {
    for (const [batch, idx] of piece.inst) batch.release(idx);
    for (const c of piece.colliders) this.ctx.hash.remove(c);
    piece.inst.length = 0; piece.colliders.length = 0;
  }

  refreshLook(piece) {
    const m = BUILD_MATS[piece.material];
    const c = new THREE.Color(m.color);
    if (!piece.built) {
      const k = 0.55 + 0.45 * Math.min(1, piece.buildT / m.time);
      c.lerp(new THREE.Color(0x9fdcff), 1 - k);
    }
    const dmg = Math.max(0, Math.min(1, 1 - piece.hp / piece.maxHp));
    const pat = m.pat + (piece.built ? dmg : 0) * 0.9;
    for (const [batch, idx] of piece.inst) { batch.setRGB(idx, c.r, c.g, c.b); batch.setPat(idx, pat); }
  }

  update(dt) {
    for (const p of this.growing) {
      if (!p.alive) { this.growing.delete(p); continue; }
      const m = BUILD_MATS[p.material];
      p.buildT += dt;
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * (1 - m.start) / m.time * dt);
      if (p.buildT >= m.time) { p.built = true; this.growing.delete(p); }
      this.refreshLook(p);
    }
  }

  damagePiece(piece, amount, attacker) {
    if (!piece.alive) return false;
    piece.hp -= amount;
    if (piece.hp <= 0) { this.destroyPiece(piece, true); return true; }
    this.refreshLook(piece);
    return false;
  }

  destroyPiece(piece, checkSupport) {
    if (!piece.alive) return;
    piece.alive = false;
    const b = piece.bounds;
    const neighbors = checkSupport ? this.neighbors(piece) : [];
    this.unrealize(piece);
    this.pieces.delete(piece.key);
    this.growing.delete(piece);
    this.stats.destroyed++;
    this.ctx.events.emit('buildDestroyed', { piece, x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2, material: piece.material, type: piece.type });
    this.ctx.events.emit('navDirty', { minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ });
    if (checkSupport) {
      for (const n of neighbors) if (n.alive) this.checkSupport(n);
    }
  }

  neighbors(piece) {
    const b = piece.bounds;
    const out = new Set();
    const list = this.ctx.hash.query(b.minX - 0.25, b.minZ - 0.25, b.maxX + 0.25, b.maxZ + 0.25, tmpList);
    for (const c of list) {
      const o = c.owner;
      if (!o || o.kind !== 'build' || o === piece || !o.alive) continue;
      if (boundsOverlap(b, o.bounds, 0.2)) out.add(o);
    }
    return [...out];
  }

  /** BFS from a piece; if no grounded piece is reachable, the whole component collapses. */
  checkSupport(start) {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const p = queue.shift();
      if (p.grounded) return;
      if (seen.size > 500) return;
      for (const n of this.neighbors(p)) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    for (const p of seen) this.destroyPiece(p, false);
  }

  /** Toggle edit tile (i,j) on a wall/floor piece. */
  toggleTile(piece, i, j) {
    if (!piece.alive || (piece.type !== 'wall' && piece.type !== 'floor')) return false;
    const bit = 1 << (j * 3 + i);
    const nm = piece.mask ^ bit;
    if (nm === 0) return false;
    piece.mask = nm;
    this.realize(piece);
    this.ctx.events.emit('edited', { piece });
    this.ctx.events.emit('navDirty', { minX: piece.bounds.minX, minZ: piece.bounds.minZ, maxX: piece.bounds.maxX, maxZ: piece.bounds.maxZ });
    return true;
  }
  resetEdit(piece) {
    if (piece.mask === FULL_MASK) return;
    piece.mask = FULL_MASK;
    this.realize(piece);
    this.ctx.events.emit('edited', { piece });
  }

  /** Slot the player would build into, given their position and view. */
  targetFor(ch, type, rot = 0) {
    const fx = yawDirX(ch.yaw), fz = yawDirZ(ch.yaw);
    const pitch = ch.pitch;
    const px = ch.pos.x, pz = ch.pos.z, feet = ch.pos.y;
    const onRamp = ch.groundCollider && ch.groundCollider.type !== C_BOX;
    const baseL = levelAt(feet, onRamp ? 1.3 : 0.3);
    const dir = (dirFromVector(fx, fz) + rot) % 4;
    const ix0 = Math.floor(px / CELL), iz0 = Math.floor(pz / CELL);
    if (type === 'wall') {
      const s = wallSlotFacing(ix0, iz0, dirFromVector(fx, fz));
      // walls: prefer showing more wall above uneven terrain (max ~2 m buried, ~1 m gap)
      const wallL = levelAt(feet, onRamp ? 1.3 : 1.0);
      return { type, ix: s.ix, iz: s.iz, L: wallL + (pitch > 0.5 ? 1 : 0), extra: s.axis };
    }
    if (type === 'floor') {
      const down = pitch < -0.75;
      const off = down ? 0 : 2.6;
      return { type, ix: Math.floor((px + fx * off) / CELL), iz: Math.floor((pz + fz * off) / CELL), L: baseL + (pitch > 0.35 ? 1 : 0), extra: null };
    }
    if (type === 'stairs') {
      const off = pitch < -0.85 ? 0 : 2.4;
      return { type, ix: Math.floor((px + fx * off) / CELL), iz: Math.floor((pz + fz * off) / CELL), L: baseL, extra: dir };
    }
    const off = pitch > 0.6 ? 0 : 2.4;
    return { type, ix: Math.floor((px + fx * off) / CELL), iz: Math.floor((pz + fz * off) / CELL), L: baseL + 1, extra: null };
  }

  /** Bot helper: wall between `ch` and point (tx,tz). */
  wallToward(ch, tx, tz, material) {
    const ix = Math.floor(ch.pos.x / CELL), iz = Math.floor(ch.pos.z / CELL);
    const s = wallSlotFacing(ix, iz, dirFromVector(tx - ch.pos.x, tz - ch.pos.z));
    return this.place(ch, 'wall', s.ix, s.iz, levelAt(ch.pos.y, 1.0), s.axis, material);
  }
  /** Bot helper: ramp in the cell ahead toward direction. */
  rampToward(ch, dx, dz, material) {
    const d = dirFromVector(dx, dz);
    const onRamp = ch.groundCollider && ch.groundCollider.type !== C_BOX;
    const L = levelAt(ch.pos.y, onRamp ? 1.3 : 0.3);
    const ix = Math.floor((ch.pos.x + [2.4, 0, -2.4, 0][d]) / CELL), iz = Math.floor((ch.pos.z + [0, 2.4, 0, -2.4][d]) / CELL);
    return this.place(ch, 'stairs', ix, iz, L, d, material);
  }
  /** Bot helper: four walls + roof around the bot's cell. Returns number placed. */
  boxUp(ch, material) {
    const ix = Math.floor(ch.pos.x / CELL), iz = Math.floor(ch.pos.z / CELL);
    const L = levelAt(ch.pos.y, 1.0);
    let n = 0;
    for (let d = 0; d < 4; d++) {
      const s = wallSlotFacing(ix, iz, d);
      if (this.pieces.has(pieceKey('wall', s.ix, s.iz, L, s.axis))) { n++; continue; }
      if (this.place(ch, 'wall', s.ix, s.iz, L, s.axis, material)) n++;
    }
    if (!this.pieces.has(pieceKey('roof', ix, iz, L + 1, null))) this.place(ch, 'roof', ix, iz, L + 1, null, material);
    return n;
  }

  bestMaterial(ch) {
    let best = null, n = -1;
    for (const m of ['wood', 'brick', 'metal']) if (ch.inv.mats[m] >= BUILD_COST && ch.inv.mats[m] > n) { n = ch.inv.mats[m]; best = m; }
    return best;
  }

  clear() {
    for (const p of [...this.pieces.values()]) this.destroyPiece(p, false);
    this.ghost.dispose();
  }
}

/** Translucent placement preview + edit grid overlay. */
class Ghost {
  constructor(scene) {
    this.scene = scene;
    this.okMat = new THREE.MeshBasicMaterial({ color: 0x5cf0ff, transparent: true, opacity: 0.38, depthWrite: false });
    this.badMat = new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.38, depthWrite: false });
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.geos = { box, stairs: stairsGeometry(7), roof: roofGeometry() };
    this.mesh = new THREE.Mesh(box, this.okMat);
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    // edit overlay
    this.edit = new THREE.Group();
    this.tileMats = { on: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }),
      off: new THREE.MeshBasicMaterial({ color: 0x2a6bff, transparent: true, opacity: 0.55, depthWrite: false }),
      hover: new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.6, depthWrite: false }) };
    this.tiles = [];
    for (let k = 0; k < 9; k++) {
      const t = new THREE.Mesh(box, this.tileMats.on);
      t.renderOrder = 6;
      this.edit.add(t); this.tiles.push(t);
    }
    this.edit.visible = false;
    scene.add(this.edit);
  }
  show(target, ok) {
    const b = pieceBounds(target.type, target.ix, target.iz, target.L, target.type === 'wall' ? target.extra : null);
    const m = this.mesh;
    m.visible = true;
    m.material = ok ? this.okMat : this.badMat;
    m.rotation.set(0, 0, 0);
    if (target.type === 'stairs') {
      m.geometry = this.geos.stairs;
      m.position.set((b.minX + b.maxX) / 2, b.minY + 0.02, (b.minZ + b.maxZ) / 2);
      m.rotation.y = DIR_ROT[target.extra];
      m.scale.set(CELL - 0.05, LEVEL_H, CELL - 0.05);
    } else if (target.type === 'roof') {
      m.geometry = this.geos.roof;
      m.position.set((b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2);
      m.scale.set(CELL, ROOF_H, CELL);
    } else {
      m.geometry = this.geos.box;
      m.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      m.scale.set(b.maxX - b.minX + 0.02, b.maxY - b.minY + 0.02, b.maxZ - b.minZ + 0.02);
    }
  }
  hide() { this.mesh.visible = false; }
  showEdit(piece, hover) {
    this.edit.visible = true;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const k = j * 3 + i;
      const t = tileBounds(piece.type, piece.ix, piece.iz, piece.L, piece.axis, i, j);
      const mesh = this.tiles[k];
      const pad = 0.06;
      mesh.position.set((t.minX + t.maxX) / 2, (t.minY + t.maxY) / 2, (t.minZ + t.maxZ) / 2);
      mesh.scale.set(t.maxX - t.minX - pad + (piece.type === 'wall' && piece.axis === 'z' ? 0.12 : 0), t.maxY - t.minY - (piece.type === 'wall' ? pad : -0.12), t.maxZ - t.minZ - pad + (piece.type === 'wall' && piece.axis === 'x' ? 0.12 : 0));
      const on = piece.mask & (1 << k);
      mesh.material = hover && hover.i === i && hover.j === j ? this.tileMats.hover : on ? this.tileMats.on : this.tileMats.off;
    }
  }
  hideEdit() { this.edit.visible = false; }
  dispose() {
    this.mesh.removeFromParent(); this.edit.removeFromParent();
    this.okMat.dispose(); this.badMat.dispose();
    for (const k in this.tileMats) this.tileMats[k].dispose();
    for (const k in this.geos) this.geos[k].dispose();
  }
}
