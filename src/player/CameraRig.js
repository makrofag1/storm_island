// Over-the-shoulder third-person camera with collision, ADS zoom, shoulder swap, recoil and shake.
import * as THREE from 'three';
import { lerp } from '../core/math.js';
import { makeHit } from '../world/Physics.js';

const hit = makeHit();

export class CameraRig {
  constructor(camera, physics, settings) {
    this.camera = camera;
    this.physics = physics;
    this.settings = settings;
    this.baseFov = settings.get('fov');
    this.adsT = 0;
    this.shoulder = 1;
    this.shoulderT = 1;
    this.dist = 3.2;
    this.shake = 0;
    this.pos = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, -1);
    this.curBack = 3;
    this.adsFov = 60;
    this.scoped = false;
  }

  addShake(a) { this.shake = Math.min(1.2, this.shake + a); }

  /**
   * Update camera from an interpolated target. opts: {x,y,z,yaw,pitch,height,mode,ads,adsFov,scope}
   */
  update(dt, o) {
    const cam = this.camera;
    this.adsT = lerp(this.adsT, o.ads ? 1 : 0, 1 - Math.exp(-dt * 16));
    this.shoulderT = lerp(this.shoulderT, this.shoulder, 1 - Math.exp(-dt * 10));
    this.scoped = o.scope && this.adsT > 0.85;
    let back, right, up;
    if (o.mode === 'freefall' || o.mode === 'glide') { back = 7.5; right = 0; up = 1.4; }
    else if (o.mode === 'spectate') { back = 4.2; right = 0.4; up = 0.5; }
    else if (o.mode === 'dead') { back = 6; right = 0; up = 1.5; }
    else { back = lerp(3.1, 1.25, this.adsT); right = lerp(0.62, 0.5, this.adsT) * this.shoulderT; up = lerp(0.28, 0.12, this.adsT); }
    this.curBack = lerp(this.curBack, back, 1 - Math.exp(-dt * 6));
    back = this.curBack;
    const yaw = o.yaw, pitch = o.pitch;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fx = -Math.sin(yaw) * cp, fy = sp, fz = -Math.cos(yaw) * cp;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    // camera up vector (perpendicular to forward & right)
    const ux = -Math.sin(yaw) * -sp, uy = cp, uz = -Math.cos(yaw) * -sp;
    const px = o.x, py = o.y + o.height - 0.12, pz = o.z;
    // shoulder pivot (collision-checked from the head)
    let sx = px + rx * right + ux * up, sy = py + uy * up, sz = pz + rz * right + uz * up;
    const shoulderLen = Math.hypot(sx - px, sy - py, sz - pz);
    if (shoulderLen > 0.01) {
      this.physics.raycast(px, py, pz, (sx - px) / shoulderLen, (sy - py) / shoulderLen, (sz - pz) / shoulderLen, shoulderLen + 0.2, null, hit);
      if (hit.hit) { const k = Math.max(0, hit.t - 0.2) / shoulderLen; sx = px + (sx - px) * k; sy = py + (sy - py) * k; sz = pz + (sz - pz) * k; }
    }
    let d = back;
    this.physics.raycast(sx, sy, sz, -fx, -fy, -fz, back + 0.32, null, hit);
    if (hit.hit) d = Math.max(0.15, hit.t - 0.32);
    let cx = sx - fx * d, cy = sy - fy * d, cz = sz - fz * d;
    if (this.shake > 0.001) {
      const s = this.shake * 0.12;
      cx += (Math.random() - 0.5) * s; cy += (Math.random() - 0.5) * s; cz += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-dt * 9);
    }
    const ground = this.physics.hm.height(cx, cz);
    if (cy < ground + 0.3) cy = ground + 0.3;
    cam.position.set(cx, cy, cz);
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    const fovT = o.adsFov ?? 60;
    const targetFov = lerp(this.baseFov, Math.min(this.baseFov, fovT), this.adsT) * (o.mode === 'freefall' ? 1.08 : 1);
    if (Math.abs(cam.fov - targetFov) > 0.05) { cam.fov = lerp(cam.fov, targetFov, 1 - Math.exp(-dt * 18)); cam.updateProjectionMatrix(); }
    this.pos.set(cx, cy, cz);
    this.dir.set(fx, fy, fz);
  }

  /** Simple chase camera (bus / overview). */
  chase(dt, target, yaw, pitch, dist) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fx = -Math.sin(yaw) * cp, fy = sp, fz = -Math.cos(yaw) * cp;
    this.camera.position.set(target.x - fx * dist, target.y - fy * dist + 3, target.z - fz * dist);
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    if (Math.abs(this.camera.fov - this.baseFov) > 0.05) { this.camera.fov = this.baseFov; this.camera.updateProjectionMatrix(); }
    this.pos.copy(this.camera.position);
    this.dir.set(fx, fy, fz);
  }
}
