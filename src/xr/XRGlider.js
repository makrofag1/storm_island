// VR glider / parachute: an arched canopy above your head with lines down to your hands. It unfolds
// with a springy pop when deployed, sways and banks into turns while you glide, and folds away on
// landing. (On a flat screen the glider is part of the third-person character model instead.)
import * as THREE from 'three';

const CELLS = 7;
const R = 3.0;          // arc radius of the canopy
const SPAN = 1.75;      // total arc angle (rad)
const ABOVE = 2.7;      // canopy height above the head when fully open

const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

export class XRGlider {
  constructor(scene, color) {
    this.root = new THREE.Group();
    this.root.visible = false;
    this.canopy = new THREE.Group();
    this.root.add(this.canopy);
    const matA = new THREE.MeshLambertMaterial({ color });
    const matB = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });
    this.mats = [matA, matB];
    const geo = new THREE.BoxGeometry(2 * R * Math.sin(SPAN / CELLS / 2) * 1.04, 0.14, 1.35);
    this.geo = geo;
    this.cells = [];
    for (let i = 0; i < CELLS; i++) {
      const m = new THREE.Mesh(geo, i % 2 ? matB : matA);
      this.canopy.add(m);
      this.cells.push(m);
    }
    // suspension lines: from each cell's lower edge (front + back) to the left / right hand
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CELLS * 2 * 2 * 3), 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x30343c }));
    this.lines.frustumCulled = false;
    scene.add(this.root, this.lines);
    this.lines.visible = false;
    this.open = 0;          // 0 folded .. 1 open
    this.time = 0;
    this.roll = 0; this.pitch = 0;
    this.yaw = 0; this.prevHeading = null;
    this.fold = 0;          // arc fold (0 = bunched up, 1 = full arc)
  }

  dispose() {
    this.root.removeFromParent(); this.lines.removeFromParent();
    this.geo.dispose(); this.mats.forEach((m) => m.dispose());
    this.lines.geometry.dispose(); this.lines.material.dispose();
  }

  /**
   * gliding: player is in glide mode; head: world head position; heading: travel direction (yaw);
   * steer: off-hand stick {x, y}; hands: [left, right] world positions (null = shoulders).
   */
  update(dt, gliding, head, heading, steer, hands) {
    this.time += dt;
    const target = gliding ? 1 : 0;
    // open: ~0.65 s with an overshoot; close faster
    this.open = gliding ? Math.min(1, this.open + dt / 0.65) : Math.max(0, this.open - dt / 0.35);
    const vis = this.open > 0.001;
    this.root.visible = vis; this.lines.visible = vis;
    if (!vis) { this.prevHeading = null; return; }
    const k = gliding ? easeOutBack(this.open) : this.open;
    // heading follows travel smoothly; banking from the turn rate and stick
    if (this.prevHeading === null) { this.yaw = heading; this.prevHeading = heading; }
    let dh = heading - this.prevHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.prevHeading = heading;
    const turnRate = dh / Math.max(1e-3, dt);
    let dy = heading - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * 3);
    const wantRoll = Math.max(-0.5, Math.min(0.5, turnRate * 0.35 - steer.x * 0.3)); // bank into the turn (right turn = right side down)
    const wantPitch = -steer.y * 0.14;
    this.roll += (wantRoll - this.roll) * Math.min(1, dt * 3);
    this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 2.5);
    const t = this.time;
    // canopy transform: above the head, rising as it opens, gentle pendulum + flutter
    const up = 1.0 + (ABOVE - 1.0) * Math.min(1, k);
    this.root.position.set(head.x, head.y + up, head.z);
    this.root.rotation.set(0, 0, 0, 'YXZ');
    this.root.rotation.y = this.yaw;
    this.root.rotation.z = this.roll + Math.sin(t * 1.3) * 0.035 * target;
    this.root.rotation.x = this.pitch + Math.sin(t * 0.9 + 1) * 0.025 * target;
    const spread = Math.max(0.12, Math.min(1.08, k));       // arc opens from a bunch to the full span
    this.canopy.scale.set(1, 1, Math.max(0.2, Math.min(1.05, k)));
    for (let i = 0; i < CELLS; i++) {
      const a = ((i + 0.5) / CELLS - 0.5) * SPAN * spread;
      const c = this.cells[i];
      const flutter = Math.sin(t * 7 + i * 1.7) * 0.012 * target;
      c.position.set(Math.sin(a) * R * spread, (Math.cos(a) - 1) * R * spread * 0.9 + flutter, 0);
      c.rotation.set(0, 0, -a);
      c.scale.set(1, 1 + 0.15 * Math.sin(t * 5 + i) * target * 0.3, 1);
    }
    // lines from the cell edges to the hands (or shoulders)
    this.root.updateMatrixWorld(true);
    const pos = this.lines.geometry.attributes.position;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const shoulder = (side) => new THREE.Vector3(head.x + cy * 0.22 * side, head.y - 0.25, head.z - sy * 0.22 * side);
    const L = hands[0] || shoulder(-1), Rh = hands[1] || shoulder(1);
    const v = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < CELLS; i++) {
      const hand = i < CELLS / 2 ? L : Rh;
      for (const z of [-0.6, 0.6]) {
        v.set(0, -0.07, z).applyMatrix4(this.cells[i].matrixWorld);
        pos.setXYZ(n++, v.x, v.y, v.z);
        pos.setXYZ(n++, hand.x, hand.y, hand.z);
      }
    }
    pos.needsUpdate = true;
  }
}
