// Pooled visual effects: debris cubes, additive glow particles (muzzle flash, sparks, smoke, explosions),
// bullet tracers, impact decals, projectile meshes, weak-spot marker and the storm wall.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export const SURFACE_COLORS = {
  wood: [0xb07a45, 0x8a5a32, 0xd9a86a], stone: [0x9a9a96, 0x7d7d79, 0xb8b4aa], metal: [0xcfd8de, 0x9aa8b0, 0xffe7a0],
  dirt: [0x7a6040, 0x5f4a30, 0x8f7a55], flesh: [0x7ad0ff, 0xbde8ff, 0x4aa8ff], snow: [0xffffff, 0xe0ecf5, 0xcfe0ee], leaf: [0x4f9a3a, 0x6cb04c, 0x3a7d2a],
};

export class Effects {
  constructor(scene, maxParticles) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    // debris cubes
    this.maxDebris = Math.max(200, Math.floor(maxParticles * 0.6));
    this.debrisMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.debrisMat, this.maxDebris);
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debrisMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxDebris * 3).fill(1), 3);
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.count = 0;
    this.group.add(this.debrisMesh);
    this.debris = [];
    // glow points
    this.maxGlow = maxParticles;
    this.gPos = new Float32Array(this.maxGlow * 3);
    this.gCol = new Float32Array(this.maxGlow * 3);
    this.gSize = new Float32Array(this.maxGlow);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(this.gPos, 3).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('color', new THREE.BufferAttribute(this.gCol, 3).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('size', new THREE.BufferAttribute(this.gSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.glowGeo = gg;
    this.glowMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 700 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(256.0, size * uScale / max(0.5, -mv.z)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)); gl_FragColor = vec4(vC * a, 1.0); }`,
    });
    this.glowPts = new THREE.Points(gg, this.glowMat);
    this.glowPts.frustumCulled = false;
    this.group.add(this.glowPts);
    this.glows = [];
    // smoke (normal blending, soft gray)
    this.maxSmoke = Math.floor(maxParticles * 0.3);
    this.sPos = new Float32Array(this.maxSmoke * 3);
    this.sCol = new Float32Array(this.maxSmoke * 4);
    this.sSize = new Float32Array(this.maxSmoke);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sCol, 4).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('size', new THREE.BufferAttribute(this.sSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.smokeGeo = sg;
    this.smokeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 700 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(300.0, size * uScale / max(0.5, -mv.z)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(d)); gl_FragColor = vec4(vC.rgb, vC.a * a); }`,
    });
    this.smokePts = new THREE.Points(sg, this.smokeMat);
    this.smokePts.frustumCulled = false;
    this.group.add(this.smokePts);
    this.smokes = [];
    // tracers
    this.maxTracers = 160;
    this.tPos = new Float32Array(this.maxTracers * 6);
    this.tCol = new Float32Array(this.maxTracers * 6);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeo = tg;
    this.tracerMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracerLines = new THREE.LineSegments(tg, this.tracerMat);
    this.tracerLines.frustumCulled = false;
    this.group.add(this.tracerLines);
    this.tracers = [];
    // decals (bullet holes)
    this.maxDecals = 200;
    const dg = new THREE.CircleGeometry(0.07, 6);
    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.decalMesh = new THREE.InstancedMesh(dg, this.decalMat, this.maxDecals);
    this.decalMesh.frustumCulled = false;
    this.decalMesh.count = 0;
    this.group.add(this.decalMesh);
    this.decalIdx = 0;
    this.decalCount = 0;
    // projectiles
    const rocketGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.7, 6); rocketGeo.rotateX(Math.PI / 2);
    this.rocketMesh = new THREE.InstancedMesh(rocketGeo, new THREE.MeshLambertMaterial({ color: 0x7a8a50, emissive: 0x222200 }), 32);
    this.grenadeMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.14, 1), new THREE.MeshLambertMaterial({ color: 0x5f7a3a }), 32);
    for (const im of [this.rocketMesh, this.grenadeMesh]) { im.frustumCulled = false; im.count = 0; this.group.add(im); }
    // weak spot marker
    this.weakSpot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0x5ad8ff, transparent: true, opacity: 0.9, depthTest: false }));
    this.weakSpot.renderOrder = 10;
    this.weakSpot.visible = false;
    this.group.add(this.weakSpot);
    this.time = 0;
  }

  setPixelScale(h) { this.glowMat.uniforms.uScale.value = h * 0.9; this.smokeMat.uniforms.uScale.value = h * 0.9; }

  debrisBurst(x, y, z, surface, count, speed = 4, size = 0.15) {
    const cols = SURFACE_COLORS[surface] || SURFACE_COLORS.stone;
    for (let i = 0; i < count; i++) {
      if (this.debris.length >= this.maxDebris) this.debris.shift();
      this.debris.push({
        x, y, z, vx: (Math.random() - 0.5) * speed, vy: Math.random() * speed * 0.9 + 1, vz: (Math.random() - 0.5) * speed,
        life: 0.6 + Math.random() * 0.8, size: size * (0.5 + Math.random()), color: cols[i % cols.length], rx: Math.random() * 6, ry: Math.random() * 6, spin: (Math.random() - 0.5) * 12,
      });
    }
  }

  glow(x, y, z, color, size, life, vx = 0, vy = 0, vz = 0, grav = 0) {
    if (this.glows.length >= this.maxGlow) this.glows.shift();
    _c.set(color);
    this.glows.push({ x, y, z, vx, vy, vz, r: _c.r, g: _c.g, b: _c.b, size, life, max: life, grav });
  }

  smoke(x, y, z, size, life, gray = 0.55, alpha = 0.5, vy = 1.2) {
    if (this.smokes.length >= this.maxSmoke) this.smokes.shift();
    this.smokes.push({ x, y, z, vx: (Math.random() - 0.5) * 0.6, vy, vz: (Math.random() - 0.5) * 0.6, size, life, max: life, gray, alpha });
  }

  muzzleFlash(x, y, z, dx, dy, dz, big = false) {
    this.glow(x, y, z, 0xffd27a, big ? 1.4 : 0.8, 0.05);
    this.glow(x + dx * 0.25, y + dy * 0.25, z + dz * 0.25, 0xffa040, big ? 0.9 : 0.5, 0.06);
    if (Math.random() < 0.5) this.smoke(x + dx * 0.3, y + dy * 0.3, z + dz * 0.3, 0.5, 0.5, 0.7, 0.18, 0.6);
  }

  impact(e) {
    const s = e.surface;
    if (s === 'flesh') {
      for (let i = 0; i < 6; i++) this.glow(e.x, e.y, e.z, 0x8fe0ff, 0.25, 0.25, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 6);
      return;
    }
    this.debrisBurst(e.x + e.nx * 0.05, e.y + e.ny * 0.05, e.z + e.nz * 0.05, s === 'dirt' ? 'dirt' : s, e.pickaxe ? 7 : 3, e.pickaxe ? 4 : 3, e.pickaxe ? 0.13 : 0.07);
    if (s === 'metal' || e.crit) for (let i = 0; i < (e.crit ? 10 : 4); i++) this.glow(e.x, e.y, e.z, e.crit ? 0x7ae0ff : 0xffe08a, 0.18, 0.2, e.nx * 3 + (Math.random() - 0.5) * 5, e.ny * 3 + Math.random() * 3, e.nz * 3 + (Math.random() - 0.5) * 5, 10);
    if (!e.pickaxe) this.smoke(e.x, e.y, e.z, 0.4, 0.6, s === 'dirt' ? 0.45 : 0.7, 0.35, 0.5);
    if (e.decal && this.maxDecals) this.decal(e.x, e.y, e.z, e.nx, e.ny, e.nz);
  }

  decal(x, y, z, nx, ny, nz) {
    _p.set(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02);
    _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(nx, ny, nz));
    _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    this.decalMesh.setMatrixAt(this.decalIdx, _m);
    this.decalIdx = (this.decalIdx + 1) % this.maxDecals;
    this.decalCount = Math.min(this.maxDecals, this.decalCount + 1);
    this.decalMesh.count = this.decalCount;
    this.decalMesh.instanceMatrix.needsUpdate = true;
  }

  tracer(x0, y0, z0, x1, y1, z1, color = 0xfff2b0, life = 0.07) {
    if (this.tracers.length >= this.maxTracers) this.tracers.shift();
    _c.set(color);
    this.tracers.push({ x0, y0, z0, x1, y1, z1, r: _c.r, g: _c.g, b: _c.b, life, max: life });
  }

  explosion(x, y, z, radius) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, sp = Math.random() * radius * 2.2;
      const k = Math.sqrt(1 - u * u);
      this.glow(x, y, z, i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0xffb030 : 0xff6a20, 1.2 + Math.random() * 1.5, 0.35 + Math.random() * 0.3, Math.cos(a) * k * sp, u * sp + 2, Math.sin(a) * k * sp, 3);
    }
    for (let i = 0; i < 12; i++) this.smoke(x + (Math.random() - 0.5) * radius, y + Math.random() * radius * 0.5, z + (Math.random() - 0.5) * radius, 2.5 + Math.random() * 2, 1.6 + Math.random(), 0.35, 0.6, 1.5);
    this.debrisBurst(x, y, z, 'dirt', 12, 9, 0.18);
  }

  poof(x, y, z, color = 0x7ad8ff) {
    for (let i = 0; i < 24; i++) this.glow(x + (Math.random() - 0.5) * 0.8, y + Math.random() * 1.8, z + (Math.random() - 0.5) * 0.8, i % 2 ? color : 0xffffff, 0.35, 0.8, (Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 1.5, -1);
  }

  showWeakSpot(ws, visible) {
    this.weakSpot.visible = visible && !!ws;
    if (ws && visible) {
      this.weakSpot.position.set(ws.x, ws.y, ws.z);
      const s = 1 + Math.sin(this.time * 10) * 0.15;
      this.weakSpot.scale.setScalar(s);
    }
  }

  update(dt, projectiles) {
    this.time += dt;
    // debris
    let n = 0;
    const dm = this.debrisMesh;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) { this.debris.splice(i, 1); continue; }
      d.vy -= 18 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      d.rx += d.spin * dt; d.ry += d.spin * dt * 0.7;
      const s = d.size * Math.min(1, d.life * 2.5);
      _p.set(d.x, d.y, d.z); _q.setFromEuler(_e.set(d.rx, d.ry, 0)); _s.set(s, s, s);
      _m.compose(_p, _q, _s);
      dm.setMatrixAt(n, _m); _c.set(d.color); dm.setColorAt(n, _c);
      n++;
    }
    dm.count = n;
    if (n) { dm.instanceMatrix.needsUpdate = true; dm.instanceColor.needsUpdate = true; }
    // glows
    let g = 0;
    for (let i = this.glows.length - 1; i >= 0; i--) {
      const p = this.glows[i];
      p.life -= dt;
      if (p.life <= 0) { this.glows.splice(i, 1); continue; }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = p.life / p.max;
      this.gPos[g * 3] = p.x; this.gPos[g * 3 + 1] = p.y; this.gPos[g * 3 + 2] = p.z;
      this.gCol[g * 3] = p.r * k; this.gCol[g * 3 + 1] = p.g * k; this.gCol[g * 3 + 2] = p.b * k;
      this.gSize[g] = p.size * (0.6 + 0.4 * k);
      g++;
    }
    this.glowGeo.setDrawRange(0, g);
    for (const k of ['position', 'color', 'size']) this.glowGeo.attributes[k].needsUpdate = true;
    // smoke
    let sm = 0;
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const p = this.smokes[i];
      p.life -= dt;
      if (p.life <= 0) { this.smokes.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = p.life / p.max;
      this.sPos[sm * 3] = p.x; this.sPos[sm * 3 + 1] = p.y; this.sPos[sm * 3 + 2] = p.z;
      this.sCol[sm * 4] = p.gray; this.sCol[sm * 4 + 1] = p.gray; this.sCol[sm * 4 + 2] = p.gray; this.sCol[sm * 4 + 3] = p.alpha * k;
      this.sSize[sm] = p.size * (1.6 - k * 0.6);
      sm++;
    }
    this.smokeGeo.setDrawRange(0, sm);
    for (const k of ['position', 'color', 'size']) this.smokeGeo.attributes[k].needsUpdate = true;
    // tracers
    let t = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      if (tr.life <= 0) { this.tracers.splice(i, 1); continue; }
      const k = tr.life / tr.max;
      // draw a short streak moving from start to end
      const a = Math.max(0, 1 - k * 1.2), b = Math.min(1, a + 0.35);
      const o = t * 6;
      this.tPos[o] = tr.x0 + (tr.x1 - tr.x0) * a; this.tPos[o + 1] = tr.y0 + (tr.y1 - tr.y0) * a; this.tPos[o + 2] = tr.z0 + (tr.z1 - tr.z0) * a;
      this.tPos[o + 3] = tr.x0 + (tr.x1 - tr.x0) * b; this.tPos[o + 4] = tr.y0 + (tr.y1 - tr.y0) * b; this.tPos[o + 5] = tr.z0 + (tr.z1 - tr.z0) * b;
      this.tCol[o] = tr.r * k * 0.5; this.tCol[o + 1] = tr.g * k * 0.5; this.tCol[o + 2] = tr.b * k * 0.5;
      this.tCol[o + 3] = tr.r * k; this.tCol[o + 4] = tr.g * k; this.tCol[o + 5] = tr.b * k;
      t++;
    }
    this.tracerGeo.setDrawRange(0, t * 2);
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.attributes.color.needsUpdate = true;
    // projectiles
    let r = 0, gr = 0;
    for (const p of projectiles) {
      if (p.type === 'rocket') {
        _p.set(p.x, p.y, p.z);
        _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(p.vx, p.vy, p.vz).normalize());
        _s.set(1, 1, 1); _m.compose(_p, _q, _s);
        this.rocketMesh.setMatrixAt(r++, _m);
        this.glow(p.x, p.y, p.z, 0xffa040, 0.7, 0.08);
        if (Math.random() < 0.7) this.smoke(p.x, p.y, p.z, 0.8, 1.0, 0.75, 0.45, 0.3);
      } else if (p.type === 'grenade') {
        _p.set(p.x, p.y, p.z); _q.identity(); _s.set(1, 1, 1); _m.compose(_p, _q, _s);
        this.grenadeMesh.setMatrixAt(gr++, _m);
        if (Math.sin(this.time * 20) > 0.6) this.glow(p.x, p.y + 0.15, p.z, 0xff3030, 0.3, 0.05);
      }
    }
    this.rocketMesh.count = r; this.grenadeMesh.count = gr;
    if (r) this.rocketMesh.instanceMatrix.needsUpdate = true;
    if (gr) this.grenadeMesh.instanceMatrix.needsUpdate = true;
  }

  counts() { return { debris: this.debris.length, glows: this.glows.length, smoke: this.smokes.length, tracers: this.tracers.length }; }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.group.removeFromParent();
  }
}

/** Translucent purple storm wall (open cylinder) with animated bands. */
export class StormView {
  constructor(scene) {
    this.uniforms = { uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `varying vec2 vUv; varying vec3 vW; uniform float uTime;
        void main(){
          float bands = 0.5 + 0.5 * sin(vUv.y * 60.0 - uTime * 2.0 + sin(vUv.x * 80.0 + uTime) * 1.5);
          float swirl = 0.5 + 0.5 * sin(vUv.x * 300.0 + vUv.y * 40.0 + uTime * 1.3);
          float a = 0.32 + bands * 0.18 + swirl * 0.08;
          a *= smoothstep(1.0, 0.75, vUv.y);
          vec3 col = mix(vec3(0.42, 0.12, 0.75), vec3(0.75, 0.45, 1.0), bands * 0.6);
          gl_FragColor = vec4(col, a);
        }`,
    });
    const geo = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true);
    geo.translate(0, 0.5, 0);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }
  update(storm, t) {
    this.uniforms.uTime.value = t;
    const c = storm.cur;
    this.mesh.visible = c.r > 0.5 && c.r < 1000;
    this.mesh.position.set(c.x, -40, c.z);
    this.mesh.scale.set(Math.max(0.5, c.r), 700, Math.max(0.5, c.r));
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.removeFromParent(); }
}
