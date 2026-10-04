// Trees, rocks and bushes: instanced rendering + destructible colliders (harvestable).
import * as THREE from 'three';
import { makeCollider, C_BOX } from './Colliders.js';
import { mergeGeometries, colorize } from './InstancedShapes.js';
import { HALF } from '../core/config.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function treeGeos(theme) {
  // pine
  const pineTrunk = new THREE.CylinderGeometry(0.18, 0.3, 2.4, 6); pineTrunk.translate(0, 1.2, 0);
  const cones = [];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.ConeGeometry(2.4 - i * 0.6, 3.2 - i * 0.4, 7);
    c.translate(0, 3.2 + i * 1.9, 0);
    cones.push(c);
  }
  const pineLeaves = mergeGeometries(cones);
  // round
  const roundTrunk = new THREE.CylinderGeometry(0.22, 0.35, 3.6, 6); roundTrunk.translate(0, 1.8, 0);
  const b1 = new THREE.IcosahedronGeometry(2.5, 0); b1.translate(0, 5.0, 0);
  const b2 = new THREE.IcosahedronGeometry(1.7, 0); b2.translate(1.2, 6.2, 0.6);
  const b3 = new THREE.IcosahedronGeometry(1.6, 0); b3.translate(-1.1, 5.6, -0.8);
  const roundLeaves = mergeGeometries([b1, b2, b3]);
  // birch
  const birchTrunk = new THREE.CylinderGeometry(0.14, 0.2, 6, 6); birchTrunk.translate(0, 3, 0);
  const c1 = new THREE.IcosahedronGeometry(1.4, 0); c1.translate(0, 6.2, 0);
  const c2 = new THREE.IcosahedronGeometry(1.1, 0); c2.translate(0.6, 5.0, 0.3);
  const c3 = new THREE.IcosahedronGeometry(1.0, 0); c3.translate(-0.5, 7.2, -0.2);
  const birchLeaves = mergeGeometries([c1, c2, c3]);
  const L = theme ? theme.leaves : [[0x2f6b3a, 0x3a7d44, 0x2a5e36], [0x5fae3e, 0x6fbf4a, 0x4f9c38, 0x86c05a], [0x9fd05a, 0xb5d86a, 0xe0c050]];
  const T = theme ? theme.trunks : [0x6b4a2f, 0x7a5434, 0xe8e4da];
  return [
    { trunk: pineTrunk, leaves: pineLeaves, trunkColor: T[0], leafColors: L[0], hp: 220, height: 8.5 },
    { trunk: roundTrunk, leaves: roundLeaves, trunkColor: T[1], leafColors: L[1], hp: 260, height: 7.5 },
    { trunk: birchTrunk, leaves: birchLeaves, trunkColor: T[2], leafColors: L[2], hp: 170, height: 7.5 },
  ];
}

export class Props {
  constructor(scene, hash, events, data, shadows, theme = null) {
    this.hash = hash;
    this.events = events;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.types = treeGeos(theme);
    this.trees = data.trees;
    this.rocks = data.rocks;
    this.bushes = data.bushes;
    this.wobbling = new Set();
    this.mats = [];
    const mkMat = () => { const m = new THREE.MeshLambertMaterial({ flatShading: true }); this.mats.push(m); return m; };

    // Props are split into spatial regions so frustum culling (main + shadow pass) and distance
    // culling work per region instead of drawing every instance on the island.
    const REG = 4, RS = (HALF * 2) / REG;
    const regionOf = (x, z) => Math.min(REG - 1, Math.max(0, Math.floor((x + HALF) / RS))) + REG * Math.min(REG - 1, Math.max(0, Math.floor((z + HALF) / RS)));
    this.regions = [];
    for (let k = 0; k < REG * REG; k++) {
      const rx = k % REG, rz = Math.floor(k / REG);
      this.regions.push({ minX: -HALF + rx * RS, minZ: -HALF + rz * RS, maxX: -HALF + (rx + 1) * RS, maxZ: -HALF + (rz + 1) * RS, meshes: [] });
    }
    const groupBy = (list, keyFn) => { const m = new Map(); for (const o of list) { const k = keyFn(o); if (!m.has(k)) m.set(k, []); m.get(k).push(o); } return m; };
    const finish = (im, reg) => {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.frustumCulled = true;
      this.group.add(im);
      this.regions[reg].meshes.push(im);
    };

    // Trees
    for (const [key, list] of groupBy(this.trees, (t) => regionOf(t.x, t.z) * 3 + t.type)) {
      const reg = Math.floor(key / 3), def = this.types[key % 3];
      const trunk = new THREE.InstancedMesh(def.trunk, mkMat(), list.length);
      const leaves = new THREE.InstancedMesh(def.leaves, mkMat(), list.length);
      for (const im of [trunk, leaves]) { im.castShadow = shadows; im.receiveShadow = true; }
      list.forEach((t, i) => {
        t.idx = i; t.alive = true; t.mesh = { trunk, leaves };
        t.maxHp = t.hp = Math.round(def.hp * t.scale);
        this.setTreeMatrix(t, 0);
        _c.set(def.trunkColor); trunk.setColorAt(i, _c);
        _c.set(def.leafColors[i % def.leafColors.length]); leaves.setColorAt(i, _c);
        const r = 0.42 * t.scale;
        t.collider = makeCollider(C_BOX, t.x - r, t.y - 0.5, t.z - r, t.x + r, t.y + def.height * t.scale * 0.8, t.z + r, { kind: 'tree', ref: t });
        hash.insert(t.collider);
      });
      finish(trunk, reg); finish(leaves, reg);
    }

    // Rocks
    this.rockGeo = new THREE.DodecahedronGeometry(0.6, 0);
    let ri = 0;
    for (const [reg, list] of groupBy(this.rocks, (r) => regionOf(r.x, r.z))) {
      const im = new THREE.InstancedMesh(this.rockGeo, mkMat(), list.length);
      im.castShadow = shadows; im.receiveShadow = true;
      list.forEach((r, i) => {
        r.idx = i; r.alive = true; r.mesh = im;
        r.maxHp = r.hp = Math.round(120 + r.sx * r.sy * r.sz * 9);
        _p.set(r.x, r.y - r.sy * 0.18, r.z); _q.setFromEuler(_e.set(0.1, r.rot, 0.05)); _s.set(r.sx, r.sy, r.sz);
        _m.compose(_p, _q, _s); im.setMatrixAt(i, _m);
        const g = 0.5 + ((ri++ * 37) % 10) / 60;
        _c.setRGB(g, g * 0.97, g * 0.93); im.setColorAt(i, _c);
        const hx = Math.max(r.sx, r.sz) * 0.42;
        r.collider = makeCollider(C_BOX, r.x - hx, r.y - 1, r.z - hx, r.x + hx, r.y + r.sy * 0.45, r.z + hx, { kind: 'rock', ref: r });
        hash.insert(r.collider);
      });
      finish(im, reg);
    }

    // Bushes (no collision)
    this.bushGeo = new THREE.IcosahedronGeometry(0.8, 0); this.bushGeo.translate(0, 0.45, 0);
    const bushColors = theme ? theme.bushes : [0x4f9a3a, 0x5aa845, 0x3f8a34, 0x6cb04c];
    let bi = 0;
    for (const [reg, list] of groupBy(this.bushes, (b) => regionOf(b.x, b.z))) {
      const im = new THREE.InstancedMesh(this.bushGeo, mkMat(), list.length);
      im.castShadow = false; im.receiveShadow = true;
      list.forEach((b, i) => {
        _p.set(b.x, b.y - 0.15, b.z); _q.setFromEuler(_e.set(0, bi * 1.7, 0)); _s.set(b.s * 1.2, b.s * 0.85, b.s * 1.1);
        _m.compose(_p, _q, _s); im.setMatrixAt(i, _m);
        _c.set(bushColors[bi++ % bushColors.length]); im.setColorAt(i, _c);
      });
      finish(im, reg);
    }
  }

  /** Hide whole regions beyond the draw distance. */
  cull(cx, cz, maxDist) {
    for (const r of this.regions) {
      const dx = Math.max(r.minX - cx, 0, cx - r.maxX), dz = Math.max(r.minZ - cz, 0, cz - r.maxZ);
      const vis = dx * dx + dz * dz < maxDist * maxDist;
      for (const im of r.meshes) im.visible = vis;
    }
  }

  setTreeMatrix(t, tilt) {
    _p.set(t.x, t.y - 0.2, t.z);
    _q.setFromEuler(_e.set(tilt, t.rot, tilt * 0.6));
    _s.set(t.scale, t.scale, t.scale);
    _m.compose(_p, _q, _s);
    t.mesh.trunk.setMatrixAt(t.idx, _m);
    t.mesh.leaves.setMatrixAt(t.idx, _m);
    t.mesh.trunk.instanceMatrix.needsUpdate = true;
    t.mesh.leaves.instanceMatrix.needsUpdate = true;
  }

  /** Damage a tree or rock. Returns true if destroyed. */
  damage(owner, amount) {
    const obj = owner.ref;
    if (!obj.alive) return false;
    obj.hp -= amount;
    if (owner.kind === 'tree') {
      obj.wobble = 0.35;
      this.wobbling.add(obj);
    }
    if (obj.hp <= 0) { this.destroy(owner); return true; }
    return false;
  }

  destroy(owner) {
    const obj = owner.ref;
    if (!obj.alive) return;
    obj.alive = false;
    this.hash.remove(obj.collider);
    if (owner.kind === 'tree') {
      const tm = obj.mesh;
      tm.trunk.setMatrixAt(obj.idx, ZERO); tm.leaves.setMatrixAt(obj.idx, ZERO);
      tm.trunk.instanceMatrix.needsUpdate = true; tm.leaves.instanceMatrix.needsUpdate = true;
      this.wobbling.delete(obj);
      this.events.emit('propDestroyed', { kind: 'tree', x: obj.x, y: obj.y + 3 * obj.scale, z: obj.z, type: obj.type });
    } else {
      obj.mesh.setMatrixAt(obj.idx, ZERO);
      obj.mesh.instanceMatrix.needsUpdate = true;
      this.events.emit('propDestroyed', { kind: 'rock', x: obj.x, y: obj.y + obj.sy * 0.3, z: obj.z });
    }
    const c = obj.collider;
    this.events.emit('navDirty', { minX: c.minX, minZ: c.minZ, maxX: c.maxX, maxZ: c.maxZ });
  }

  update(dt) {
    if (!this.wobbling.size) return;
    for (const t of this.wobbling) {
      t.wobble -= dt;
      if (t.wobble <= 0 || !t.alive) { this.wobbling.delete(t); if (t.alive) this.setTreeMatrix(t, 0); continue; }
      this.setTreeMatrix(t, Math.sin(t.wobble * 40) * 0.03 * (t.wobble / 0.35));
    }
  }

  dispose() {
    this.group.traverse((o) => { if (o.isInstancedMesh) { o.geometry.dispose(); o.dispose(); } });
    for (const m of this.mats) m.dispose();
    this.group.removeFromParent();
  }
}

/** Wrap-around instanced grass tufts around the camera (quality dependent). */
export class Grass {
  constructor(scene, hm, count, isBlocked = () => false, { range = 110, wind = false, colors = null } = {}) {
    this.hm = hm;
    this.count = count;
    this.isBlocked = isBlocked;
    this.range = range || 110;
    if (!count) return;
    const blade = new THREE.ConeGeometry(0.05, 0.42, 3); blade.translate(0, 0.21, 0);
    const b2 = blade.clone(); b2.rotateZ(0.35); b2.translate(0.07, 0, 0.03);
    const b3 = blade.clone(); b3.rotateZ(-0.3); b3.translate(-0.06, 0, -0.04);
    const geo = mergeGeometries([blade, b2, b3]);
    this.mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    if (wind) {
      // high quality: tufts sway in the wind (vertex shader, bends more toward the tip)
      this.windU = { value: 0 };
      this.mat.onBeforeCompile = (sh) => {
        sh.uniforms.uWind = this.windU;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uWind;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
  #ifdef USE_INSTANCING
    float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
    float k = transformed.y * transformed.y * 0.9;
    transformed.x += sin(uWind * 1.9 + ph) * k * 0.55;
    transformed.z += cos(uWind * 1.4 + ph * 1.3) * k * 0.35;
  #endif`);
      };
    }
    this.mesh = new THREE.InstancedMesh(geo, this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.offsets = new Float32Array(count * 3);
    let seed = 12345;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < count; i++) { this.offsets[i * 3] = rnd() * this.range; this.offsets[i * 3 + 1] = rnd() * this.range; this.offsets[i * 3 + 2] = rnd(); }
    const cols = colors || [0x5aa83e, 0x6ab84a, 0x4c9a34, 0x7cc05a];
    for (let i = 0; i < count; i++) { _c.set(cols[i % cols.length]); this.mesh.setColorAt(i, _c); }
    scene.add(this.mesh);
    this.lastX = 1e9; this.lastZ = 1e9;
  }
  update(cx, cz, time = 0) {
    if (!this.count) return;
    if (this.windU) this.windU.value = time;
    if (Math.abs(cx - this.lastX) < 3 && Math.abs(cz - this.lastZ) < 3) return;
    this.lastX = cx; this.lastZ = cz;
    const R = this.range, hm = this.hm;
    const ox = cx - R / 2, oz = cz - R / 2;
    const nrm = { x: 0, y: 1, z: 0 };
    for (let i = 0; i < this.count; i++) {
      const fx = this.offsets[i * 3], fz = this.offsets[i * 3 + 1];
      const x = ox + ((fx - ox) % R + R) % R, z = oz + ((fz - oz) % R + R) % R;
      const h = hm.height(x, z);
      let show = h > 3 && h < 74;
      if (show) { hm.normal(x, z, nrm); show = nrm.y > 0.82 && !this.isBlocked(x, z); }
      if (!show) { this.mesh.setMatrixAt(i, ZERO); continue; }
      const s = 0.6 + this.offsets[i * 3 + 2] * 0.7;
      _p.set(x, h - 0.05, z); _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.offsets[i * 3 + 2] * 6.28); _s.set(s, s, s);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    if (!this.count) return;
    this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.dispose(); this.mesh.removeFromParent();
  }
}

export { colorize };
