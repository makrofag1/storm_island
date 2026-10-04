// Static, destructible map structures (buildings, cars, containers...) built from instanced shapes.
import * as THREE from 'three';
import { makeCollider, C_BOX, C_RAMP, C_ROOF } from './Colliders.js';
import { InstancedShapes, makePatternMaterial, unitBoxGeometry, stairsGeometry, roofGeometry, PAT } from './InstancedShapes.js';

export const MAT_HP = { wood: 180, brick: 300, metal: 420 };

/** Shared instanced batches for everything box/stairs/roof shaped (map structures AND player builds). */
export class ShapeBatches {
  constructor(scene, shadows) {
    this.material = makePatternMaterial();
    this.box = new InstancedShapes(unitBoxGeometry(), this.material, 20000, { castShadow: shadows });
    this.stairs = new InstancedShapes(stairsGeometry(7), this.material, 4000, { castShadow: shadows });
    this.roof = new InstancedShapes(roofGeometry(), this.material, 3000, { castShadow: shadows });
    for (const b of [this.box, this.stairs, this.roof]) scene.add(b.mesh);
  }
  flush() { this.box.flush(); this.stairs.flush(); this.roof.flush(); }
  dispose() {
    for (const b of [this.box, this.stairs, this.roof]) { b.mesh.removeFromParent(); b.dispose(); }
    this.material.dispose();
  }
}

/** Rotation for a stair dir (0:+x 1:+z 2:-x 3:-z), given geometry rises toward +X. */
export const DIR_ROT = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

export class Structures {
  constructor(hash, shapes, events) {
    this.hash = hash;
    this.shapes = shapes;
    this.events = events;
    this.parts = [];
  }

  _part(shape, idx, collider, color, pat, mat, hp) {
    const part = {
      kind: 'struct', shape, idx, collider, color, pat, mat,
      hp: hp ?? (mat ? MAT_HP[mat] : Infinity), maxHp: hp ?? (mat ? MAT_HP[mat] : Infinity),
      breakable: !!mat, alive: true,
    };
    if (collider) { collider.owner = part; this.hash.insert(collider); }
    this.parts.push(part);
    return part;
  }

  addBox(minX, minY, minZ, maxX, maxY, maxZ, color, pat = PAT.PLAIN, mat = null, hp, opts = {}) {
    const b = this.shapes.box;
    const idx = b.alloc();
    if (idx < 0) return null;
    b.setBox(idx, minX, minY, minZ, maxX, maxY, maxZ);
    b.setColor(idx, color);
    b.setPat(idx, pat);
    const col = opts.noCollide ? null : makeCollider(C_BOX, minX, minY, minZ, maxX, maxY, maxZ);
    return this._part('box', idx, col, color, pat, mat, hp);
  }

  /** Stairs footprint given by its low-end center (x,z), rising toward dir over `len`. */
  addStairs(cx, cz, y0, dir, len, width, rise, color, pat = PAT.WOOD, mat = 'wood') {
    const s = this.shapes.stairs;
    const idx = s.alloc();
    if (idx < 0) return null;
    // footprint center
    const dx = [1, 0, -1, 0][dir], dz = [0, 1, 0, -1][dir];
    const mx = cx + dx * len / 2, mz = cz + dz * len / 2;
    s.setTRS(idx, mx, y0, mz, DIR_ROT[dir], len, rise, width);
    s.setColor(idx, color);
    s.setPat(idx, pat);
    const hx = dx !== 0 ? len / 2 : width / 2, hz = dz !== 0 ? len / 2 : width / 2;
    const col = makeCollider(C_RAMP, mx - hx, y0, mz - hz, mx + hx, y0 + rise, mz + hz, null, dir);
    return this._part('stairs', idx, col, color, pat, mat);
  }

  addRoof(minX, minZ, maxX, maxZ, y0, height, color, pat = PAT.ROOF, mat = 'wood', collide = true) {
    const r = this.shapes.roof;
    const idx = r.alloc();
    if (idx < 0) return null;
    r.setTRS(idx, (minX + maxX) / 2, y0, (minZ + maxZ) / 2, 0, maxX - minX, height, maxZ - minZ);
    r.setColor(idx, color);
    r.setPat(idx, pat);
    const col = collide ? makeCollider(C_ROOF, minX, y0, minZ, maxX, y0 + height, maxZ) : null;
    return this._part('roof', idx, col, color, pat, mat);
  }

  batchFor(part) { return part.shape === 'box' ? this.shapes.box : part.shape === 'stairs' ? this.shapes.stairs : this.shapes.roof; }

  /** Apply damage. Returns true if destroyed. */
  damage(part, amount) {
    if (!part.alive || !part.breakable) return false;
    part.hp -= amount;
    const batch = this.batchFor(part);
    if (part.hp <= 0) {
      this.destroy(part);
      return true;
    }
    batch.setPat(part.idx, part.pat + Math.min(1, 1 - part.hp / part.maxHp) * 0.9);
    return false;
  }

  destroy(part) {
    if (!part.alive) return;
    part.alive = false;
    const batch = this.batchFor(part);
    batch.release(part.idx);
    const c = part.collider;
    if (c) {
      this.hash.remove(c);
      this.events.emit('structDestroyed', { part, x: (c.minX + c.maxX) / 2, y: (c.minY + c.maxY) / 2, z: (c.minZ + c.maxZ) / 2, collider: c });
      this.events.emit('navDirty', { minX: c.minX, minZ: c.minZ, maxX: c.maxX, maxZ: c.maxZ });
    }
  }
}

/** Collects static decorative geometry (vertex colored) and merges it into one mesh. */
export class DecorBatch {
  constructor() { this.geos = []; }
  add(geo, color, x, y, z, rotY = 0, sx = 1, sy = 1, sz = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(m);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (g.attributes.uv) g.deleteAttribute('uv');
    this.geos.push(g);
  }
  build(scene, shadows) {
    if (!this.geos.length) return null;
    let total = 0;
    for (const g of this.geos) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let o = 0;
    for (const g of this.geos) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      col.set(g.attributes.color.array, o * 3);
      o += g.attributes.position.count;
      g.dispose();
    }
    this.geos = [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.mesh.castShadow = shadows; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    return this.mesh;
  }
  dispose() {
    if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.removeFromParent(); }
  }
}
