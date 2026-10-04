// The Sky Bus (flying bus): random straight route across the island; passengers jump whenever they like.
import { HALF } from '../core/config.js';
import { busModel } from '../world/Models.js';

export const BUS_ALT = 215;
export const BUS_SPEED = 32;

export class SkyBus {
  constructor(scene, rng) {
    const a = rng.range(0, Math.PI * 2);
    const off = rng.range(-220, 220);
    const dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz, pz = dx;
    const L = HALF * 1.05;
    this.start = { x: -dx * L + px * off, z: -dz * L + pz * off };
    this.end = { x: dx * L + px * off, z: dz * L + pz * off };
    this.dir = { x: dx, z: dz };
    this.length = Math.hypot(this.end.x - this.start.x, this.end.z - this.start.z);
    this.duration = this.length / BUS_SPEED;
    this.t = 0;
    this.pos = { x: this.start.x, y: BUS_ALT, z: this.start.z };
    this.prev = { ...this.pos };
    this.yaw = Math.atan2(-dx, -dz);
    this.mesh = busModel();
    this.mesh.rotation.y = this.yaw;
    scene.add(this.mesh);
    this.active = true;
    this.doorsOpenAt = 2.5;
  }
  get progress() { return this.t / this.duration; }
  get canJump() { return this.t > this.doorsOpenAt; }
  update(dt) {
    if (!this.active) return;
    this.prev.x = this.pos.x; this.prev.z = this.pos.z;
    this.t += dt;
    const k = Math.min(1, this.t / this.duration);
    this.pos.x = this.start.x + (this.end.x - this.start.x) * k;
    this.pos.z = this.start.z + (this.end.z - this.start.z) * k;
    this.pos.y = BUS_ALT + Math.sin(this.t * 0.8) * 1.2;
    if (k >= 1) this.active = false;
  }
  /** Distance along the route to the point closest to (x,z), as time in seconds. */
  timeClosestTo(x, z) {
    const vx = this.end.x - this.start.x, vz = this.end.z - this.start.z;
    const t = ((x - this.start.x) * vx + (z - this.start.z) * vz) / (vx * vx + vz * vz);
    return Math.max(0, Math.min(1, t)) * this.duration;
  }
  render(alpha, time) {
    const m = this.mesh;
    m.visible = this.active || this.t < this.duration + 6;
    if (!m.visible) return;
    const x = this.prev.x + (this.pos.x - this.prev.x) * alpha, z = this.prev.z + (this.pos.z - this.prev.z) * alpha;
    if (!this.active) { this.pos.x += this.dir.x * BUS_SPEED * 0.016; this.pos.z += this.dir.z * BUS_SPEED * 0.016; this.prev.x = this.pos.x; this.prev.z = this.pos.z; }
    m.position.set(x, this.pos.y, z);
    m.rotation.z = Math.sin(time * 0.7) * 0.03;
    for (const c of m.children) if (c.userData.spin) c.rotation.z += 0.6;
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.userData.dispose();
  }
}
