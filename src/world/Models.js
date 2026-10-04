// Procedural low-poly model geometries (weapons, items, character parts, bus). All vertex-colored
// so a per-instance color can tint the "accent" (white) parts.
import * as THREE from 'three';
import { mergeGeometries, colorize } from './InstancedShapes.js';

const DARK = 0x3b3d42, MID = 0x6a6d72, WHITE = 0xffffff, WOOD = 0x8a5a32;

function box(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return colorize(g, color);
}
function cyl(r, len, x, y, z, color, seg = 8, axis = 'z') {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return colorize(g, color);
}

/** Weapon geometry, forward = -Z, origin at the grip. */
export function weaponGeometry(type) {
  const p = [];
  switch (type) {
    case 'ar':
      p.push(box(0.1, 0.15, 0.62, 0, 0.04, -0.2, DARK), box(0.105, 0.05, 0.4, 0, 0.06, -0.25, WHITE));
      p.push(cyl(0.025, 0.36, 0, 0.07, -0.68, MID), box(0.07, 0.2, 0.1, 0, -0.1, -0.22, DARK));
      p.push(box(0.08, 0.13, 0.26, 0, 0.02, 0.22, WHITE), box(0.05, 0.06, 0.12, 0, 0.15, -0.15, MID), box(0.06, 0.14, 0.07, 0, -0.08, 0.0, DARK));
      break;
    case 'shotgun':
      p.push(box(0.1, 0.13, 0.5, 0, 0.04, -0.15, DARK), cyl(0.035, 0.6, 0, 0.07, -0.65, MID));
      p.push(box(0.09, 0.08, 0.22, 0, -0.02, -0.55, WHITE), box(0.08, 0.14, 0.3, 0, 0.0, 0.24, WOOD), box(0.06, 0.13, 0.07, 0, -0.08, 0.0, DARK));
      break;
    case 'smg':
      p.push(box(0.1, 0.15, 0.42, 0, 0.04, -0.12, DARK), box(0.104, 0.05, 0.3, 0, 0.07, -0.14, WHITE));
      p.push(cyl(0.022, 0.16, 0, 0.06, -0.41, MID), box(0.06, 0.28, 0.07, 0, -0.14, -0.12, DARK), box(0.06, 0.13, 0.07, 0, -0.08, 0.02, DARK));
      break;
    case 'sniper':
      p.push(box(0.09, 0.13, 0.7, 0, 0.03, -0.18, DARK), cyl(0.022, 0.6, 0, 0.06, -0.82, MID));
      p.push(cyl(0.045, 0.34, 0, 0.18, -0.2, WHITE), box(0.08, 0.15, 0.32, 0, 0.0, 0.3, WHITE), box(0.06, 0.12, 0.07, 0, -0.08, 0.02, DARK));
      break;
    case 'pistol':
      p.push(box(0.07, 0.1, 0.28, 0, 0.06, -0.1, WHITE), box(0.06, 0.16, 0.08, 0, -0.04, 0.0, DARK));
      break;
    case 'rocket':
      p.push(cyl(0.11, 1.15, 0, 0.12, -0.2, DARK, 10), cyl(0.115, 0.1, 0, 0.12, -0.7, WHITE, 10), cyl(0.115, 0.1, 0, 0.12, 0.3, WHITE, 10));
      p.push(box(0.06, 0.16, 0.08, 0, -0.04, 0.0, DARK), box(0.06, 0.08, 0.14, 0, 0.27, -0.1, MID));
      break;
    case 'pickaxe':
      p.push(cyl(0.03, 0.85, 0, 0.3, 0, WOOD, 6, 'y'), box(0.06, 0.08, 0.62, 0, 0.72, -0.05, WHITE), box(0.07, 0.1, 0.12, 0, 0.72, 0.0, MID));
      break;
    default:
      p.push(box(0.1, 0.1, 0.3, 0, 0, 0, WHITE));
  }
  return mergeGeometries(p);
}

export function ammoGeometry() {
  return mergeGeometries([box(0.42, 0.26, 0.3, 0, 0.13, 0, WHITE), box(0.44, 0.06, 0.32, 0, 0.27, 0, DARK)]);
}
export function consumableGeometry(type) {
  if (type === 'grenade') {
    const g = colorize(new THREE.IcosahedronGeometry(0.16, 1), WHITE); g.translate(0, 0.16, 0);
    return mergeGeometries([g, box(0.06, 0.08, 0.06, 0, 0.34, 0, DARK)]);
  }
  if (type === 'smallshield' || type === 'bigshield') {
    const s = type === 'bigshield' ? 1.3 : 0.9;
    const b = colorize(new THREE.CylinderGeometry(0.12 * s, 0.14 * s, 0.32 * s, 8), WHITE); b.translate(0, 0.16 * s, 0);
    return mergeGeometries([b, cyl(0.05 * s, 0.1 * s, 0, 0.37 * s, 0, MID, 6, 'y')]);
  }
  if (type === 'medkit') return mergeGeometries([box(0.5, 0.3, 0.36, 0, 0.15, 0, WHITE), box(0.3, 0.02, 0.08, 0, 0.31, 0, 0xffffff), box(0.08, 0.02, 0.3, 0, 0.31, 0, 0xffffff)]);
  return mergeGeometries([cyl(0.12, 0.26, 0, 0.12, 0, WHITE, 8, 'x')]); // bandage roll
}
export function materialGeometry() {
  return mergeGeometries([box(0.4, 0.25, 0.4, 0, 0.125, 0, WHITE), box(0.3, 0.2, 0.3, 0.05, 0.35, 0.02, WHITE)]);
}
export function chestGeometries() {
  const body = mergeGeometries([
    box(1.0, 0.55, 0.62, 0, 0.275, 0, 0xc98a2e), box(1.04, 0.08, 0.66, 0, 0.05, 0, 0xffd76a), box(0.12, 0.2, 0.08, 0, 0.45, -0.34, 0xffe9a0),
  ]);
  // lid pivots at back top edge (z = +0.31, y = 0.55)
  const lid = mergeGeometries([box(1.02, 0.25, 0.64, 0, 0.125, -0.32, 0xd99b38), box(1.06, 0.06, 0.68, 0, 0.24, -0.32, 0xffd76a)]);
  return { body, lid };
}
export function ammoBoxGeometry() {
  return mergeGeometries([box(0.9, 0.45, 0.5, 0, 0.225, 0, 0x5c6b3a), box(0.94, 0.08, 0.54, 0, 0.47, 0, 0x3e4a26), box(0.3, 0.12, 0.02, 0, 0.25, -0.26, 0xe6d36a)]);
}

/** Character part geometries. Pivots: limbs hang down from origin. */
export function characterGeometries() {
  const head = colorize(new THREE.BoxGeometry(0.42, 0.42, 0.42), WHITE);
  const eyes = mergeGeometries([box(0.08, 0.1, 0.02, -0.09, 0.03, -0.215, 0x1a1a1a), box(0.08, 0.1, 0.02, 0.09, 0.03, -0.215, 0x1a1a1a), box(0.14, 0.03, 0.02, 0, -0.1, -0.215, 0x6b3a3a)]);
  const torso = colorize(new THREE.BoxGeometry(0.6, 0.62, 0.34), WHITE);
  const pelvis = colorize(new THREE.BoxGeometry(0.56, 0.26, 0.32), WHITE);
  const arm = colorize(new THREE.BoxGeometry(0.17, 0.62, 0.17).translate(0, -0.31, 0), WHITE);
  const hand = colorize(new THREE.BoxGeometry(0.15, 0.15, 0.15).translate(0, -0.66, 0), WHITE);
  const leg = colorize(new THREE.BoxGeometry(0.23, 0.82, 0.25).translate(0, -0.41, 0), WHITE);
  const backpack = mergeGeometries([box(0.44, 0.5, 0.2, 0, 0, 0, WHITE), box(0.36, 0.16, 0.06, 0, -0.08, 0.12, 0xdddddd)]);
  const hats = [
    mergeGeometries([box(0.46, 0.14, 0.46, 0, 0.27, 0, WHITE), box(0.42, 0.04, 0.22, 0, 0.21, -0.3, WHITE)]),   // cap
    mergeGeometries([box(0.47, 0.22, 0.47, 0, 0.25, 0, WHITE), box(0.14, 0.1, 0.14, 0, 0.41, 0, WHITE)]),        // beanie
    mergeGeometries([box(0.1, 0.22, 0.4, 0, 0.3, 0.02, WHITE)]),                                               // mohawk
    mergeGeometries([box(0.5, 0.06, 0.5, 0, 0.22, 0, WHITE), box(0.32, 0.18, 0.32, 0, 0.33, 0, WHITE)]),        // top hat-ish
  ];
  const glider = mergeGeometries([
    box(2.8, 0.08, 1.1, 0, 0, 0, WHITE), box(0.9, 0.1, 1.2, 0, 0.02, 0, 0xeeeeee),
    box(0.04, 1.6, 0.04, -0.6, -0.8, 0, DARK), box(0.04, 1.6, 0.04, 0.6, -0.8, 0, DARK),
  ]);
  return { head, eyes, torso, pelvis, arm, hand, leg, backpack, hats, glider };
}

/** The flying bus: a stylised blue coach with a hot-air balloon. Returns a Group. */
export function busModel() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const parts = [
    box(3.2, 3.0, 9.5, 0, 0, 0, 0x2f6fd6), box(3.25, 0.8, 9.55, 0, -1.2, 0, 0xf0f0f0),
    box(3.3, 0.9, 7.8, 0, 0.6, -0.4, 0x9fd4ff), box(3.0, 1.2, 0.1, 0, 0.6, -4.8, 0x9fd4ff),
    box(3.4, 0.25, 9.8, 0, 1.6, 0, 0xffcc33),
  ];
  for (const sx of [-1.6, 1.6]) for (const sz of [-3.2, 3.2]) parts.push(cyl(0.7, 0.5, sx, -1.6, sz, 0x222222, 10, 'x'));
  const body = new THREE.Mesh(mergeGeometries(parts), mat);
  g.add(body);
  const balloonGeo = colorize(new THREE.SphereGeometry(5.5, 14, 10), 0xff6b4a);
  balloonGeo.scale(1, 1.15, 1);
  balloonGeo.translate(0, 10.5, 0);
  const stripes = colorize(new THREE.CylinderGeometry(5.62, 5.62, 1.4, 14, 1, true), 0xffe24a);
  stripes.translate(0, 10.5, 0);
  const ropes = [];
  for (const sx of [-1.4, 1.4]) for (const sz of [-3.5, 3.5]) {
    const r = colorize(new THREE.CylinderGeometry(0.06, 0.06, 6.5, 4), 0x444444);
    r.translate(sx, 4.5, sz * 0.7);
    ropes.push(r);
  }
  const balloon = new THREE.Mesh(mergeGeometries([balloonGeo, stripes, ...ropes]), mat);
  g.add(balloon);
  for (const sx of [-2.3, 2.3]) {
    const prop = new THREE.Mesh(mergeGeometries([box(0.15, 2.6, 0.3, 0, 0, 0, 0x333333), box(0.3, 0.3, 0.6, 0, 0, 0.2, 0x888888)]), mat);
    prop.position.set(sx, 0, 4.9);
    prop.userData.spin = true;
    g.add(prop);
  }
  g.userData.dispose = () => { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); mat.dispose(); };
  return g;
}
