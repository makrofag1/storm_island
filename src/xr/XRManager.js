// WebXR session management (Meta Quest 3 & other immersive-vr headsets): support detection, the
// play-space rig the camera and controllers hang from, per-frame controller polling and haptics.
// `?vrsim=1` runs the same VR code paths on a flat screen (head = mouse look, hands in front of the
// camera, controller buttons on the keyboard) so the VR gameplay can be tested without a headset.
import * as THREE from 'three';
import { readPad, emptyPad, handVelocity } from './xrLogic.js';

const SIM = typeof location !== 'undefined' && new URLSearchParams(location.search).get('vrsim') === '1';
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

function makeHandState(i) {
  return {
    index: i, connected: false, handedness: i === 0 ? 'left' : 'right', source: null, isHand: false,
    ray: null, grip: null, hand: null, pad: emptyPad(), prev: emptyPad(), hist: [], vel: { x: 0, y: 0, z: 0, speed: 0 },
  };
}

export class XRManager {
  constructor(game) {
    this.game = game;
    const r = game.renderer;
    r.xr.enabled = true;
    r.xr.setReferenceSpaceType('local-floor');
    this.supported = false;
    this.reason = typeof navigator !== 'undefined' && navigator.xr ? 'checking' : (typeof window !== 'undefined' && !window.isSecureContext ? 'insecure' : 'no-webxr');
    this.session = null;
    this.presenting = false;
    this.sim = SIM;
    this.simActive = false;
    this.rig = new THREE.Group();
    this.rig.name = 'xr-rig';
    this.rig.visible = false;
    game.scene.add(this.rig);
    this.rigYaw = 0;
    this.slots = [makeHandState(0), makeHandState(1)];
    this.listeners = { start: [], end: [], select: [] };
    for (let i = 0; i < 2; i++) {
      const s = this.slots[i];
      s.ray = r.xr.getController(i);
      s.grip = r.xr.getControllerGrip(i);
      s.hand = r.xr.getHand(i);
      this.rig.add(s.ray, s.grip, s.hand);
      s.ray.addEventListener('connected', (e) => {
        s.connected = true; s.source = e.data; s.handedness = e.data.handedness || s.handedness; s.isHand = !!e.data.hand;
        s.hist.length = 0;
      });
      s.ray.addEventListener('disconnected', () => { s.connected = false; s.source = null; s.isHand = false; s.pad = emptyPad(); s.prev = emptyPad(); });
      s.ray.addEventListener('select', () => this.emit('select', s));
    }
    this.headLocal = new THREE.Vector3();
    this.headYaw = 0; this.headPitch = 0;
    if (this.sim) this.initSim();
    if (navigator.xr && navigator.xr.isSessionSupported) {
      navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
        this.supported = ok; this.reason = ok ? 'ok' : 'unsupported';
        this.game.menus && this.game.menus.updateVrUi();
      }).catch(() => { this.reason = 'blocked'; this.game.menus && this.game.menus.updateVrUi(); });
      navigator.xr.addEventListener && navigator.xr.addEventListener('devicechange', () => {
        navigator.xr.isSessionSupported('immersive-vr').then((ok) => { this.supported = ok; this.game.menus && this.game.menus.updateVrUi(); }).catch(() => {});
      });
    }
  }

  /** True while VR gameplay rules apply (real headset or the flat-screen simulator). */
  get active() { return this.presenting || this.simActive; }

  on(ev, fn) { this.listeners[ev].push(fn); }
  emit(ev, a) { for (const fn of this.listeners[ev]) fn(a); }

  /** Main (dominant) and off hand slots, by the player's handedness setting. */
  hands() {
    const dom = this.game.settings.get('vrHand') === 'left' ? 'left' : 'right';
    let main = this.slots.find((s) => s.connected && s.handedness === dom);
    let off = this.slots.find((s) => s.connected && s.handedness !== dom && s !== main);
    return { main: main || null, off: off || null };
  }
  hasControllers() { return this.slots.some((s) => s.connected && !s.isHand); }

  /** Must run from a user gesture (click). Resolves true when the headset session started. */
  async start() {
    if (this.simActive) { this.stopSim(); }
    if (this.sim && (!navigator.xr || !this.supported)) { this.startSim(); return true; }
    if (!navigator.xr) return false;
    let session;
    try {
      session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    } catch (e) {
      console.warn('[Storm Island] VR session refused:', e && e.message);
      if (this.sim) { this.startSim(); return true; }
      return false;
    }
    const r = this.game.renderer;
    r.xr.setFramebufferScaleFactor(this.game.settings.get('vrQuality') === 'performance' ? 0.85 : 1.0);
    await r.xr.setSession(session);
    this.session = session;
    this.presenting = true;
    r.xr.setFoveation(1);
    try {
      const rates = session.supportedFrameRates;
      if (rates && session.updateTargetFrameRate) {
        const want = this.game.settings.get('vrQuality') === 'performance' ? 72 : 90;
        const rate = Array.from(rates).includes(want) ? want : Math.max(...Array.from(rates).filter((f) => f <= 90));
        if (rate > 0) session.updateTargetFrameRate(rate).catch(() => {});
      }
    } catch { /* optional API */ }
    session.addEventListener('end', () => this.onEnd());
    session.addEventListener('visibilitychange', () => { if (session.visibilityState !== 'visible') this.game.onVrBlur(); });
    this.attachCamera();
    console.info('[Storm Island] VR session started' + (session.frameRate ? ` @ ${session.frameRate} Hz` : ''));
    this.emit('start');
    return true;
  }

  end() {
    if (this.session) this.session.end().catch(() => this.onEnd());
    else if (this.simActive) this.stopSim();
  }

  onEnd() {
    if (!this.presenting) return;
    this.presenting = false;
    this.session = null;
    this.detachCamera();
    for (const s of this.slots) { s.connected = false; s.source = null; s.pad = emptyPad(); s.prev = emptyPad(); }
    console.info('[Storm Island] VR session ended');
    this.emit('end');
  }

  attachCamera() {
    const cam = this.game.camera;
    this.rig.visible = true;
    this.rig.add(cam);
    cam.position.set(0, 1.6, 0);
    cam.rotation.set(0, 0, 0);
    // close-up things in VR (rear sight at your eye, gloves, wrist) must not be clipped
    cam.near = 0.05; cam.updateProjectionMatrix();
  }
  detachCamera() {
    const cam = this.game.camera;
    this.rig.remove(cam);
    this.rig.visible = false;
    cam.position.set(0, 0, 0);
    cam.rotation.set(0, 0, 0, 'YXZ');
    cam.scale.set(1, 1, 1);
    cam.fov = this.game.settings.get('fov');
    cam.zoom = 1;
    cam.near = 0.15;
    this.game.resize();
  }

  /**
   * Per render frame, before the match renders: read the controllers into pads (with previous frame
   * for edge detection), update hand velocities and the head pose in play space.
   */
  poll(dt) {
    if (!this.active) return;
    const now = performance.now() / 1000;
    if (this.simActive) this.pollSim(dt);
    else {
      for (const s of this.slots) {
        s.prev = s.pad;
        s.pad = s.connected && s.source && s.source.gamepad && !s.isHand ? readPad(s.source.gamepad) : emptyPad();
      }
      // three.js has already written this frame's eye poses (play space) before calling our loop:
      // the head is the midpoint between the eyes
      const cams = this.game.renderer.xr.getCamera().cameras;
      let q = this.game.camera.quaternion;
      if (cams.length >= 2) { this.headLocal.copy(cams[0].position).add(cams[1].position).multiplyScalar(0.5); q = cams[0].quaternion; }
      else if (cams.length === 1) { this.headLocal.copy(cams[0].position); q = cams[0].quaternion; }
      else this.headLocal.copy(this.game.camera.position);
      _e.setFromQuaternion(q, 'YXZ');
      this.headYaw = _e.y; this.headPitch = _e.x;
    }
    if (this.presenting) this.updateHandJoints();
    for (const s of this.slots) {
      if (!s.connected) { s.hist.length = 0; continue; }
      const p = s.grip.position;
      s.hist.push({ t: now, x: p.x, y: p.y, z: p.z });
      while (s.hist.length > 2 && now - s.hist[0].t > 0.09) s.hist.shift();
      const v = handVelocity(s.hist);
      // play space -> world (rig yaw)
      const c = Math.cos(this.rigYaw), sn = Math.sin(this.rigYaw);
      s.vel.x = v.x * c + v.z * sn; s.vel.y = v.y; s.vel.z = -v.x * sn + v.z * c; s.vel.speed = v.speed;
    }
  }

  /** Hand tracking (no controllers): small spheres on the tracked joints so you can see your fingers. */
  updateHandJoints() {
    for (const s of this.slots) {
      const joints = s.hand && s.hand.joints;
      if (!joints) continue;
      for (const name in joints) {
        const j = joints[name];
        if (j.userData.dot) continue;
        if (!this.jointGeo) { this.jointGeo = new THREE.SphereGeometry(0.008, 8, 6); this.jointMat = new THREE.MeshLambertMaterial({ color: 0xe8c4a8 }); }
        const d = new THREE.Mesh(this.jointGeo, this.jointMat);
        if (name.endsWith('tip')) d.scale.setScalar(0.8);
        if (name === 'wrist') d.scale.setScalar(2);
        j.add(d); j.userData.dot = d;
      }
    }
  }

  /** Short vibration on one hand slot (or both when slot is null). */
  pulse(slot, intensity, ms) {
    const list = slot ? [slot] : this.slots;
    for (const s of list) {
      const a = s && s.source && s.source.gamepad && s.source.gamepad.hapticActuators && s.source.gamepad.hapticActuators[0];
      if (a && a.pulse) { try { a.pulse(Math.min(1, intensity), ms); } catch { /* ignore */ } }
    }
  }

  /** World transform of a slot's aim ray (origin + forward) and grip. Call after the rig is placed. */
  rayWorld(slot, outPos, outDir) {
    slot.ray.updateWorldMatrix(true, false);
    outPos.setFromMatrixPosition(slot.ray.matrixWorld);
    outDir.set(0, 0, -1).applyQuaternion(_q.setFromRotationMatrix(_m.extractRotation(slot.ray.matrixWorld))).normalize();
  }

  // ---------- flat-screen simulator (?vrsim=1) ----------
  initSim() {
    this.simYaw = 0; this.simPitch = 0; this.simSwing = 0;
    console.info('[Storm Island] VR simulator available: press PLAY IN VR (keys: WASD move, mouse look/aim, LMB fire, RMB aim, Space A/jump, R B/reload, B X/build, P Y/pause, F grip, C stick-click, Shift sprint, M map, Q/E turn, wheel slots, H swing, G crouch)');
  }
  startSim() {
    this.simActive = true;
    this.simYaw = 0; this.simPitch = 0;
    // three.js keeps controller spaces hidden until a real pose arrives: show them for the simulator
    for (const s of this.slots) { s.connected = true; s.isHand = false; s.source = null; s.hist.length = 0; s.grip.visible = true; s.ray.visible = true; }
    this.slots[0].handedness = 'left'; this.slots[1].handedness = 'right';
    this.attachCamera();
    this.emit('start');
  }
  stopSim() {
    if (!this.simActive) return;
    this.simActive = false;
    for (const s of this.slots) { s.connected = false; s.pad = emptyPad(); s.prev = emptyPad(); s.grip.visible = false; s.ray.visible = false; }
    this.detachCamera();
    this.emit('end');
  }
  pollSim(dt) {
    const inp = this.game.input, d = inp.down;
    const [mdx, mdy] = inp.consumeMouse(dt);
    this.simYaw -= mdx * 0.0022; this.simPitch = Math.max(-1.4, Math.min(1.4, this.simPitch - mdy * 0.0022));
    const crouch = d.has('KeyG');
    this.headLocal.set(0, crouch ? 1.0 : 1.6, 0);
    this.headYaw = this.simYaw; this.headPitch = this.simPitch;
    const cam = this.game.camera;
    cam.position.copy(this.headLocal);
    cam.rotation.set(this.simPitch, this.simYaw, 0, 'YXZ');
    cam.updateMatrix();
    // hands: fixed offsets in front of the head, aiming where the head looks
    if (d.has('KeyH')) this.simSwing = Math.min(1, this.simSwing + dt * 9); else this.simSwing = Math.max(0, this.simSwing - dt * 4);
    const place = (s, ox, oy, oz) => {
      const o = new THREE.Vector3(ox, oy, oz).applyEuler(cam.rotation).add(this.headLocal);
      s.grip.position.copy(o); s.grip.quaternion.copy(cam.quaternion);
      s.ray.position.copy(o); s.ray.quaternion.copy(cam.quaternion);
      s.grip.updateMatrix(); s.ray.updateMatrix();
    };
    place(this.slots[1], 0.18, -0.22 + this.simSwing * 0.1, -0.32 - this.simSwing * 0.45);
    place(this.slots[0], -0.2, -0.3, -0.28);
    const k = (c) => d.has(c);
    const wheel = inp.consumeWheel();
    const left = { trigger: inp.rawMouse[2] ? 1 : 0, squeeze: k('KeyM') ? 1 : 0, stick: k('ShiftLeft'), b1: k('KeyB'), b2: k('KeyP'),
      sx: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0), sy: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0) };
    const right = { trigger: inp.rawMouse[0] ? 1 : 0, squeeze: k('KeyF') ? 1 : 0, stick: k('KeyC'), b1: k('Space'), b2: k('KeyR'),
      sx: (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0), sy: wheel ? (wheel > 0 ? 1 : -1) : 0 };
    for (const s of this.slots) s.prev = s.pad;
    this.slots[0].pad = left; this.slots[1].pad = right;
  }
}
