// Instanced rendering of all characters with procedural animation (walk/run/crouch/jump/shoot/
// pickaxe swing/freefall/glide/emote/death). One InstancedMesh per body part => a handful of draw calls.
import * as THREE from 'three';
import { characterGeometries, weaponGeometry } from '../world/Models.js';
import { RARITIES } from '../core/config.js';
import { lerp, lerpAngle } from '../core/math.js';

const WEAPON_KEYS = ['ar', 'shotgun', 'smg', 'sniper', 'pistol', 'rocket', 'pickaxe'];
const M = THREE.Matrix4;
const _root = new M(), _torso = new M(), _tmp = new M(), _tmp2 = new M(), _part = new M(), _arm = new M();
const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 2);
const _frustum = new THREE.Frustum();
const _pm = new M();

function rx(m, a) { return m.makeRotationX(a); }

export class CharacterView {
  constructor(scene, maxChars, shadows) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    // characters take only part of the fog: a player far away must stay visible as a silhouette
    // (otherwise someone shooting from the edge of the fog looks invisible)
    this.mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `#ifdef USE_FOG
        float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor * 0.55 );
      #endif`);
    };
    const geos = characterGeometries();
    this.geos = geos;
    this.meshes = {};
    const mk = (key, geo, per) => {
      const im = new THREE.InstancedMesh(geo, this.mat, maxChars * per);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxChars * per * 3).fill(1), 3);
      im.frustumCulled = false; im.castShadow = shadows; im.receiveShadow = false; im.count = 0;
      this.group.add(im);
      this.meshes[key] = im;
    };
    mk('head', geos.head, 1); mk('eyes', geos.eyes, 1); mk('torso', geos.torso, 1); mk('pelvis', geos.pelvis, 1);
    mk('arm', geos.arm, 2); mk('hand', geos.hand, 2); mk('leg', geos.leg, 2); mk('pack', geos.backpack, 1);
    geos.hats.forEach((g, i) => mk('hat' + i, g, 1));
    mk('glider', geos.glider, 1);
    for (const w of WEAPON_KEYS) mk('w_' + w, weaponGeometry(w), 1);
    this.meshes.eyes.castShadow = false;
    this.counts = {};
    this.time = 0;
    this.zoom = null; // { pos, dir, cos, max }: a scope view — characters in this cone are drawn up to max
  }

  put(key, m, color) {
    const im = this.meshes[key];
    const n = this.counts[key];
    im.setMatrixAt(n, m);
    _c.set(color);
    im.setColorAt(n, _c);
    this.counts[key] = n + 1;
  }

  /**
   * view (VR): { pos, dir } of the head in world space. In VR the camera is a child of the play-space
   * rig — its position is local and its matrices are only refreshed while rendering — so culling uses
   * the head pose instead (distance + a wide view cone that covers both eyes and fast head turns).
   */
  render(chars, alpha, camera, maxDist, hideChar, dt, view = null) {
    this.time += dt;
    for (const k in this.meshes) this.counts[k] = 0;
    if (!view) {
      _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_pm);
    }
    const cp = view ? view.pos : camera.position;
    for (const ch of chars) {
      if (!ch.visible || ch === hideChar) continue;
      const x = lerp(ch.prev.x, ch.pos.x, alpha), y = lerp(ch.prev.y, ch.pos.y, alpha), z = lerp(ch.prev.z, ch.pos.z, alpha);
      const dx = x - cp.x, dz = z - cp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > maxDist * maxDist) {
        // beyond the normal range: still drawn inside a sniper scope's narrow view (up to its range)
        const zm = this.zoom;
        if (!zm || d2 > zm.max * zm.max) continue;
        const ex = x - zm.pos.x, ey = y + 1 - zm.pos.y, ez = z - zm.pos.z, el = Math.hypot(ex, ey, ez);
        if ((ex * zm.dir.x + ey * zm.dir.y + ez * zm.dir.z) / el < zm.cos) continue;
      } else if (view) {
        const dy = y + 1 - cp.y, d = Math.sqrt(d2 + dy * dy);
        if (d > 6 && (dx * view.dir.x + dy * view.dir.y + dz * view.dir.z) / d < 0.17) continue; // > ~80° off the view axis
      } else {
        _sphere.center.set(x, y + 1, z);
        _sphere.radius = ch.mode === 'glide' ? 3.5 : 1.6;
        if (!_frustum.intersectsSphere(_sphere)) continue;
      }
      this.pose(ch, x, y, z, lerpAngle(ch.prevYaw, ch.yaw, alpha), dt);
    }
    for (const k in this.meshes) {
      const im = this.meshes[k];
      im.count = this.counts[k];
      if (im.count) { im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
    }
  }

  pose(ch, x, y, z, yaw, dt) {
    const a = ch.anim;
    const s = ch.skin;
    const t = this.time;
    const speed = Math.hypot(ch.vel.x, ch.vel.z);
    a.speed = lerp(a.speed, ch.mode === 'ground' ? speed : 0, 1 - Math.exp(-dt * 10));
    a.phase += dt * (3 + a.speed * 1.35);
    const swing = Math.sin(a.phase) * Math.min(1, a.speed / 7.5) * 0.75;
    const aimPitch = ch.pitch || 0;
    const mode = ch.mode;
    const dead = !ch.alive;

    _root.makeTranslation(x, y, z);
    _tmp.makeRotationY(yaw); _root.multiply(_tmp);
    if (dead) {
      a.deathT = Math.min(1, a.deathT + dt * 1.8);
      const e = 1 - (1 - a.deathT) * (1 - a.deathT);
      _tmp.makeTranslation(0, 0.15 * e, 0); _root.multiply(_tmp);
      rx(_tmp, e * Math.PI * 0.48); _root.multiply(_tmp);
    }
    let bodyPitch = 0, legL = 0, legR = 0, pelvisY = 0.86, armLx = 0, armRx = 0, armLz = 0, armRz = 0, lean = 0;
    const cur = ch.inv.current();
    const holdingGun = cur && cur.kind === 'weapon';
    const crouch = ch.crouching && mode === 'ground';
    if (mode === 'freefall') {
      bodyPitch = ch.intent.dive ? -1.35 : -1.0;
      legL = 0.3 + Math.sin(t * 9) * 0.08; legR = 0.25 - Math.sin(t * 9) * 0.08;
      armLz = -1.3; armRz = 1.3; armLx = 0.3; armRx = 0.3;
    } else if (mode === 'glide') {
      armLx = Math.PI * 0.95; armRx = Math.PI * 0.95; armLz = 0.25; armRz = -0.25;
      legL = 0.15 + Math.sin(t * 2) * 0.1; legR = 0.1 - Math.sin(t * 2) * 0.1;
    } else {
      if (crouch) { pelvisY = 0.56; legL = legR = 0.95; legL += swing * 0.4; legR -= swing * 0.4; lean = 0.25; }
      else if (!ch.grounded) { legL = 0.5; legR = -0.2; }
      else { legL = swing; legR = -swing; }
      if (ch.sprinting) lean = 0.2;
      if (ch.emoting) {
        a.emoteT += dt;
        const e = a.emoteT * 7;
        armLx = Math.PI * 0.85 + Math.sin(e) * 0.5; armRx = Math.PI * 0.85 - Math.sin(e) * 0.5;
        armLz = 0.4; armRz = -0.4;
        legL = Math.max(0, Math.sin(e)) * 0.5; legR = Math.max(0, -Math.sin(e)) * 0.5;
        pelvisY += Math.abs(Math.sin(e)) * 0.08;
      } else if (ch.useT > 0) {
        armLx = 1.1 + Math.sin(t * 10) * 0.05; armRx = 1.2; armLz = -0.3; armRz = 0.3;
      } else if (ch.inv.sel === 0) {
        // pickaxe: swing animation on the right arm
        if (ch.swingAnim > 0) {
          const p = 1 - ch.swingAnim; // 0 -> 1
          armRx = p < 0.35 ? lerp(1.2, 2.7, p / 0.35) : lerp(2.7, 0.2, Math.min(1, (p - 0.35) / 0.4));
        } else armRx = ch.sprinting ? -swing * 0.9 : 0.45 - swing * 0.3;
        armLx = -swing * 0.8;
      } else if (holdingGun && !ch.sprinting) {
        const kick = a.fire * 0.25;
        armRx = Math.PI / 2 + aimPitch - kick; armLx = Math.PI / 2 + aimPitch * 0.9 - kick;
        armLz = -0.35; armRz = 0.05;
        if (ch.reloadT > 0) { armLx = 0.9 + Math.sin(t * 12) * 0.3; armLz = -0.5; }
      } else {
        armLx = -swing * 0.9; armRx = swing * 0.9;
      }
    }
    if (a.fire > 0) a.fire = Math.max(0, a.fire - dt * 8);
    if (a.hit > 0) a.hit = Math.max(0, a.hit - dt * 4);
    if (ch.swingAnim > 0) ch.swingAnim = Math.max(0, ch.swingAnim - dt * 2.4);
    if (bodyPitch !== 0) {
      _tmp.makeTranslation(0, 1.0, 0); _root.multiply(_tmp);
      rx(_tmp, bodyPitch); _root.multiply(_tmp);
      _tmp.makeTranslation(0, -1.0, 0); _root.multiply(_tmp);
    }
    const hitTint = a.hit > 0;
    // legs
    for (const [side, ang] of [[-1, legL], [1, legR]]) {
      _part.copy(_root);
      _tmp.makeTranslation(side * 0.14, pelvisY, crouch ? 0.05 : 0); _part.multiply(_tmp);
      rx(_tmp, ang); _part.multiply(_tmp);
      this.put('leg', _part, s.pants);
    }
    // pelvis
    _part.copy(_root); _tmp.makeTranslation(0, pelvisY + 0.02, 0); _part.multiply(_tmp);
    this.put('pelvis', _part, s.pants);
    // torso frame
    _torso.copy(_root);
    _tmp.makeTranslation(0, pelvisY + 0.13, 0); _torso.multiply(_tmp);
    rx(_tmp, -lean); _torso.multiply(_tmp);
    _part.copy(_torso); _tmp.makeTranslation(0, 0.31, 0); _part.multiply(_tmp);
    this.put('torso', _part, hitTint ? 0xffffff : s.shirt);
    _part.copy(_torso); _tmp.makeTranslation(0, 0.33, 0.27); _part.multiply(_tmp);
    this.put('pack', _part, s.pack);
    // head
    _part.copy(_torso); _tmp.makeTranslation(0, 0.84, 0); _part.multiply(_tmp);
    if (!dead && mode === 'ground') { rx(_tmp, aimPitch * 0.5 + lean * 0.5); _part.multiply(_tmp); }
    this.put('head', _part, s.skin);
    this.put('eyes', _part, 0xffffff);
    if (s.hat >= 0) this.put('hat' + s.hat, _part, s.hatColor);
    // arms
    for (const [side, ax, az] of [[-1, armLx, armLz], [1, armRx, armRz]]) {
      _arm.copy(_torso);
      _tmp.makeTranslation(side * 0.39, 0.56, 0); _arm.multiply(_tmp);
      if (az) { _tmp.makeRotationZ(az); _arm.multiply(_tmp); }
      rx(_tmp, ax); _arm.multiply(_tmp);
      this.put('arm', _arm, s.shirt);
      this.put('hand', _arm, s.skin);
      if (side === 1 && mode === 'ground' && !ch.emoting && ch.useT <= 0) {
        // weapon in right hand
        let key = null, color = 0xffffff;
        if (ch.inv.sel === 0) { key = 'w_pickaxe'; color = 0xcfd8e2; }
        else if (holdingGun) { key = 'w_' + cur.type; color = RARITIES[cur.rarity].hex; }
        if (key) {
          _part.copy(_arm);
          _tmp.makeTranslation(0, -0.66, 0); _part.multiply(_tmp);
          if (key === 'w_pickaxe') { rx(_tmp, -Math.PI / 2 + 0.3); _part.multiply(_tmp); }
          else {
            rx(_tmp, -Math.PI / 2); _part.multiply(_tmp);
            _tmp2.makeRotationY(-armRz - 0.0); _part.multiply(_tmp2);
          }
          this.put(key, _part, color);
        }
      }
    }
    if (mode === 'glide') {
      _part.copy(_root);
      _tmp.makeTranslation(0, 2.75, 0); _part.multiply(_tmp);
      _tmp.makeRotationZ(Math.sin(t * 1.5) * 0.05); _part.multiply(_tmp);
      this.put('glider', _part, s.glider);
    }
  }

  dispose() {
    for (const k in this.meshes) { this.meshes[k].geometry.dispose(); this.meshes[k].dispose(); }
    this.mat.dispose();
    this.group.removeFromParent();
  }
}
