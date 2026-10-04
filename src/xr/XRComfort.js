// VR comfort helpers: a tunnelling vignette that narrows the view during artificial motion (stick
// locomotion, smooth turning, skydiving) and the teleport arc with its landing marker.
import * as THREE from 'three';
import { makeHit } from '../world/Physics.js';
import { validTeleport, TELEPORT_MAX } from './xrLogic.js';

const hit = makeHit();
const ARC_PTS = 40;

export class Vignette {
  constructor(camera) {
    this.uniforms = { uAmt: { value: 0 }, uColor: { value: new THREE.Color(0x000000) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      // angle from the view axis: clear in the middle, dark towards the edge; uAmt widens the dark ring
      fragmentShader: `uniform float uAmt; uniform vec3 uColor; varying vec3 vP;
        void main(){ float a = acos(clamp(-normalize(vP).z, -1.0, 1.0));
          float inner = mix(1.4, 0.42, uAmt), outer = inner + 0.32;
          float k = smoothstep(inner, outer, a) * min(1.0, uAmt * 1.6);
          gl_FragColor = vec4(uColor, k); }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 24, 16), mat);
    this.mesh.renderOrder = 980;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    camera.add(this.mesh);
    this.amt = 0;
    this.flash = 0;
  }
  update(dt, target) {
    this.amt += (target - this.amt) * Math.min(1, dt * (target > this.amt ? 10 : 4));
    this.flash = Math.max(0, this.flash - dt * 2.5);
    const a = Math.max(this.amt, this.flash * 0.7);
    this.uniforms.uAmt.value = a;
    this.uniforms.uColor.value.setRGB(this.flash * 0.55, 0, 0);
    this.mesh.visible = a > 0.01;
  }
  hurt() { this.flash = 1; }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

export class TeleportArc {
  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_PTS * 3), 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.9, fog: false }));
    this.line.frustumCulled = false; this.line.visible = false;
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 28), new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, fog: false }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false;
    scene.add(this.line, this.marker);
    this.target = null;
  }

  /** Simulate a ballistic arc from the hand; returns the landing point or null (invalid). */
  aim(physics, ox, oy, oz, dx, dy, dz, fromX, fromZ) {
    const pos = this.line.geometry.attributes.position;
    const v = 9.5, g = 9.8, step = 0.05;
    let x = ox, y = oy, z = oz, vx = dx * v, vy = dy * v, vz = dz * v;
    let n = 0, land = null;
    for (; n < ARC_PTS; n++) {
      pos.setXYZ(n, x, y, z);
      const nx = x + vx * step, ny = y + vy * step, nz = z + vz * step;
      const sl = Math.hypot(nx - x, ny - y, nz - z);
      physics.raycast(x, y, z, (nx - x) / sl, (ny - y) / sl, (nz - z) / sl, sl, null, hit);
      if (hit.hit) { land = { x: hit.x, y: hit.y, z: hit.z, ok: validTeleport(fromX, fromZ, hit) }; n++; pos.setXYZ(Math.min(n, ARC_PTS - 1), hit.x, hit.y, hit.z); n++; break; }
      x = nx; y = ny; z = nz; vy -= g * step;
    }
    for (let i = n; i < ARC_PTS; i++) pos.setXYZ(i, x, y, z);
    pos.needsUpdate = true;
    this.line.geometry.setDrawRange(0, Math.min(n, ARC_PTS));
    this.line.visible = true;
    const ok = land && land.ok;
    this.line.material.color.set(ok ? 0x7fd4ff : 0xff6a5a);
    this.marker.visible = !!land;
    if (land) { this.marker.position.set(land.x, land.y + 0.04, land.z); this.marker.material.color.set(ok ? 0x7fd4ff : 0xff6a5a); }
    this.target = ok ? land : null;
    return this.target;
  }
  hide() { this.line.visible = false; this.marker.visible = false; this.target = null; }
  dispose() {
    this.line.removeFromParent(); this.marker.removeFromParent();
    this.line.geometry.dispose(); this.line.material.dispose(); this.marker.geometry.dispose(); this.marker.material.dispose();
  }
}

export { TELEPORT_MAX };
