// VR gameplay glue for one match: first-person rig placement, room-scale walking with collisions,
// physical crouching, controller -> game input mapping, turning / teleport, weapon held in the hand
// (shots leave its muzzle), grabbing loot, pickaxe swings and grenade throws driven by real hand
// motion, haptics, wrist HUD and comfort vignette.
import * as THREE from 'three';
import { moveHorizontal } from '../player/Motor.js';
import { WEAPONS, CONSUMABLES } from '../combat/Items.js';
import { RARITIES, CHAR_HEIGHT, CROUCH_HEIGHT } from '../core/config.js';
import { yawTo, clamp, wrapAngle } from '../core/math.js';
import { makeHit } from '../world/Physics.js';
import { tryPickup, openChest } from '../player/Interactions.js';
import { mapActions, emptyPad, snapTurn, smoothTurn, rigOrigin, localToWorldXZ, physicalCrouch } from './xrLogic.js';
import { XRHud } from './XRHud.js';
import { Vignette, TeleportArc } from './XRComfort.js';
import { XRHints } from './XRHints.js';
import { makeHeldItem, disposeHeldItem } from './XRWeapons.js';
import { XRGlider } from './XRGlider.js';

const STAND_EYE = CHAR_HEIGHT - 0.22;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const near = [];
const camHit = makeHit();

function gloveGeometry(mirror) {
  const parts = [];
  const add = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(mirror ? -x : x, y, z); parts.push(g); };
  add(0.075, 0.03, 0.09, 0, 0, 0.02);                       // palm
  for (let i = 0; i < 4; i++) add(0.016, 0.022, 0.05, -0.027 + i * 0.018, 0.01, -0.045); // fingers (curled forward)
  add(0.02, 0.022, 0.045, 0.045, 0.01, 0.0);                // thumb
  add(0.07, 0.04, 0.05, 0, 0, 0.085);                       // cuff
  const merged = new THREE.BufferGeometry();
  // tiny manual merge (BufferGeometryUtils is not vendored): concatenate non-indexed copies
  const pos = [], nrm = [];
  for (const g of parts) { const ng = g.toNonIndexed(); pos.push(...ng.attributes.position.array); nrm.push(...ng.attributes.normal.array); }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return merged;
}

export class XRPlayer {
  constructor(match) {
    this.match = match;
    this.game = match.game;
    this.xr = match.game.xr;
    this.input = match.game.input;
    this.settings = match.game.settings;
    this.aimPos = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.headWorld = new THREE.Vector3();
    this.moveYaw = 0;
    this.headPitchWorld = 0;
    this.prevHead = null;
    this.crouchToggle = false; this.physCrouch = false; this.sprintOn = false;
    this.swingHold = 0; this.swingWas = false; this.throwArmed = false;
    this.recoil = 0; this.hitFlash = 0; this.turnRate = 0; this.tpCd = 0;
    this.actions = mapActions(emptyPad(), emptyPad(), emptyPad(), emptyPad());
    this.aimY = 0.05; this.aimZ = -0.1; this.physAds = false; this.adsWas = false;
    this.spectatePos = null;
    this.specTarget = null; this.specYaw = 0; this.specTurn = 0;
    const P = match.player;
    P.aimOrigin = { x: P.pos.x, y: P.eyeY, z: P.pos.z };
    this.xr.rigYaw = P.yaw;

    this.hud = new XRHud(match, this.xr);
    match.hud.xr = this.hud;
    this.vignette = new Vignette(this.game.camera);
    this.arc = new TeleportArc(match.scene);
    this.hints = new XRHints(this.xr);

    // gloves on both grips (hidden for tracked hands, which draw their joints instead)
    this.gloveMat = new THREE.MeshLambertMaterial({ color: 0x2f3542 });
    this.gloves = this.xr.slots.map((s, i) => {
      const g = new THREE.Mesh(gloveGeometry(i === 0), this.gloveMat);
      s.grip.add(g);
      return g;
    });
    // item in the dominant hand (position = grip, orientation = aim ray, so what you see is where you shoot)
    this.held = new THREE.Group();
    this.xr.rig.add(this.held);
    this.heldItems = {};
    this.heldItem = null;
    this.glider = new XRGlider(match.scene, P.skin.glider);
    // aim laser + dot
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.laser = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, fog: false, depthWrite: false }));
    this.laser.frustumCulled = false; this.laser.visible = false;
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, depthTest: false, transparent: true }));
    this.dot.renderOrder = 970; this.dot.visible = false;
    match.scene.add(this.laser, this.dot);

    // haptics
    const ev = match.events;
    ev.on('shot', (e) => { if (e.ch === P) { const big = e.weapon === 'shotgun' || e.weapon === 'sniper' || e.weapon === 'rocket'; this.pulseMain(big ? 0.9 : 0.45, big ? 70 : 30); } });
    ev.on('damage', (e) => {
      if (e.attacker === P && e.target !== P) { this.pulseMain(e.head ? 0.6 : 0.3, 20); this.hitFlash = 0.15; this.hitHead = e.head; }
      if (e.target === P && e.cause !== 'storm') { this.xr.pulse(null, 0.7, 80); this.vignette.hurt(); }
    });
    ev.on('built', (e) => { if (e.owner === P) this.pulseMain(0.2, 12); });
    ev.on('harvest', (e) => { if (e.ch === P) this.pulseMain(0.35, 25); });
    ev.on('pickup', (e) => { if (e.ch === P) this.pulseMain(0.25, 15); });
    ev.on('death', (e) => { if (e.target === P) this.xr.pulse(null, 1, 200); });
  }

  pulseMain(a, ms) { const { main } = this.xr.hands(); if (main) this.xr.pulse(main, a, ms); }

  dispose() {
    const P = this.match.player;
    P.aimOrigin = null; P.moveYaw = undefined; P.throwVel = null;
    this.hud.dispose();
    this.match.hud.xr = null;
    this.vignette.dispose();
    this.arc.dispose();
    this.hints.dispose();
    for (const g of this.gloves) g.removeFromParent();
    this.gloveMat.dispose();
    this.held.removeFromParent();
    for (const k in this.heldItems) disposeHeldItem(this.heldItems[k]);
    this.glider.dispose();
    this.laser.removeFromParent(); this.dot.removeFromParent();
    this.laser.geometry.dispose(); this.laser.material.dispose(); this.dot.geometry.dispose(); this.dot.material.dispose();
    this.releaseInput();
  }

  releaseInput() {
    const inp = this.input;
    for (const a of ['jump', 'crouch']) inp.release(a);
    inp.axis.x = 0; inp.axis.y = 0; inp.axis.sprint = false;
    inp.mouseDown[0] = false; inp.mouseDown[2] = false;
  }

  /** VR got switched off mid-match (headset removed / session ended): hand control back to mouse & keys. */
  deactivate() {
    const P = this.match.player;
    P.aimOrigin = null; P.moveYaw = undefined;
    this.releaseInput();
    this.arc.hide();
    this.laser.visible = false; this.dot.visible = false;
  }

  // ---------- per frame, before the simulation ticks ----------
  preTick(dt) {
    const m = this.match, P = m.player, xr = this.xr, inp = this.input, ctrl = m.controller, s = this.settings;
    const { main, off } = xr.hands();
    const E = emptyPad();
    const A = mapActions(main ? main.pad : E, off ? off.pad : E, main ? main.prev : E, off ? off.prev : E);
    this.actions = A;
    if (A.pausePressed) { this.game.setPaused(true); return; }
    this.calibrate(dt);
    if (!P.aimOrigin) P.aimOrigin = { x: P.pos.x, y: P.eyeY, z: P.pos.z };

    this.turnRate = 0;
    if (!P.alive) {
      // spectating: the camera turns with the watched player by itself; trigger / A = next player
      this.releaseInput();
      if (A.firePressed || A.jumpPressed) m.nextSpectateTarget();
      this.prevHead = null;
      return;
    }
    // turning
    if (s.get('vrTurn') === 'smooth') { const d = smoothTurn(A.turnX, s.get('vrTurnSpeed'), dt); xr.rigYaw += d; this.turnRate = Math.abs(d) / Math.max(1e-3, dt); }
    else xr.rigYaw += snapTurn(A.turnFlick, s.get('vrSnapAngle'));

    // room-scale: real steps move the character (blocked by walls like stick movement)
    const h = xr.headLocal;
    if (this.prevHead && P.mode === 'ground') {
      const [dx, dz] = localToWorldXZ(h.x - this.prevHead.x, h.z - this.prevHead.z, xr.rigYaw);
      if (dx * dx + dz * dz < 0.25) {
        const ox = P.pos.x, oz = P.pos.z;
        moveHorizontal(P, dx, dz, m.physics);
        P.prev.x += P.pos.x - ox; P.prev.z += P.pos.z - oz;
      }
    }
    this.prevHead = this.prevHead || new THREE.Vector3();
    this.prevHead.copy(h);

    const building = !!(ctrl.buildMode || ctrl.editPiece);
    // crouch: physical (head height) or toggled with the stick click
    this.physCrouch = !s.get('vrSeated') && physicalCrouch(h.y, xr.calib, this.physCrouch);
    if (A.crouchPressed && !building) this.crouchToggle = !this.crouchToggle;
    if (A.jumpPressed) this.crouchToggle = false;
    this.hold('crouch', this.crouchToggle || this.physCrouch);
    // sprint toggle (off-hand stick click), ends when you stop
    if (A.sprintPressed) this.sprintOn = !this.sprintOn;
    if (Math.hypot(A.moveX, A.moveY) < 0.2) this.sprintOn = false;
    // movement: stick or teleport (teleport only on the ground; skydiving always uses the stick)
    const teleport = s.get('vrMove') === 'teleport' && P.mode === 'ground';
    if (teleport) { inp.axis.x = 0; inp.axis.y = 0; this.teleport(dt, A, off || main); }
    else { inp.axis.x = A.moveX; inp.axis.y = A.moveY; this.arc.hide(); }
    inp.axis.sprint = this.sprintOn && !teleport;
    // buttons
    if (A.jumpPressed) inp.press('jump');
    if (!A.jump) inp.release('jump');
    if (A.buildPressed) inp.tap('build');
    if (A.reloadPressed) inp.tap(building ? 'rotate' : 'reload');
    if (A.crouchPressed && building) inp.tap('edit');
    if (A.slotStep) inp.wheel += A.slotStep;
    if (A.grabPressed && main) this.grab(main);

    // trigger: fire / swing / use; grenades are thrown on release with the real hand velocity
    const cur = P.inv.current();
    const throwable = !building && cur && cur.kind === 'consumable' && CONSUMABLES[cur.type] && CONSUMABLES[cur.type].throwable;
    let fire = A.fire, firePressed = A.firePressed;
    if (throwable) {
      if (A.firePressed) this.throwArmed = true;
      fire = false; firePressed = false;
      if (this.throwArmed && A.fireReleased) {
        this.throwArmed = false; fire = true; firePressed = true;
        const v = main ? main.vel : null;
        if (v && v.speed > 2.2) {
          let vx = v.x * 1.6 + P.vel.x, vy = v.y * 1.6 + 1.5, vz = v.z * 1.6 + P.vel.z;
          const l = Math.hypot(vx, vy, vz);
          if (l > 30) { vx *= 30 / l; vy *= 30 / l; vz *= 30 / l; }
          P.throwVel = { x: vx, y: vy, z: vz };
        }
      }
    } else this.throwArmed = false;
    // physical pickaxe swing: a fast hand movement hits like a click
    if (P.inv.sel === 0 && !building && main && main.vel.speed > 2.6 && P.swingCd <= 0 && P.mode === 'ground') this.swingHold = 0.06;
    this.swingHold -= dt;
    const swinging = this.swingHold > 0;
    if (swinging) { fire = true; if (!this.swingWas) firePressed = true; }
    this.swingWas = swinging;
    if (!fire && inp.mouseDown[0]) inp.mouseReleased[0] = true;
    inp.mouseDown[0] = fire;
    if (firePressed) inp.mousePressed[0] = true;
    // aiming: left trigger, or physically bringing the sights up to your eye
    const ads = A.aim || (this.physAds && !building);
    inp.mouseDown[2] = ads;
    if ((A.aimPressed || (ads && !this.adsWas)) && (!building || A.aimPressed)) inp.mousePressed[2] = true;
    this.adsWas = ads;

    // aim ray for this tick (rig at the current, non-interpolated position)
    this.placeRig(P.pos.x, P.pos.y, P.pos.z);
    this.computeAim(main, off);
  }

  hold(action, on) {
    const inp = this.input;
    if (on && !inp.virt.has(action)) inp.press(action);
    else if (!on && inp.virt.has(action)) inp.release(action);
  }

  calibrate(dt) {
    const xr = this.xr, y = xr.headLocal.y;
    if (y < 0.5) return;
    if (!xr.calib || xr.calibT < 1.2) {
      xr.calibT = (xr.calibT || 0) + dt;
      xr.calibSum = (xr.calibSum || 0) + y * dt;
      xr.calib = xr.calibSum / xr.calibT;
    }
  }

  /** Eye height correction: standing players of any size (or seated ones) see from the character's eyes. */
  viewOffset() {
    const P = this.match.player, xr = this.xr;
    const c = xr.calib > 0.5 ? xr.calib : 1.6;
    let off = STAND_EYE - c;
    if (P.crouching && !this.physCrouch) off -= CHAR_HEIGHT - CROUCH_HEIGHT;
    return off;
  }

  placeRig(x, y, z) {
    const xr = this.xr, h = xr.headLocal;
    const [ox, oz] = rigOrigin(x, z, h.x, h.z, xr.rigYaw);
    xr.rig.position.set(ox, y + this.viewOffset(), oz);
    xr.rig.rotation.set(0, xr.rigYaw, 0);
    xr.rig.updateMatrixWorld(true);
  }

  computeAim(main, off) {
    const P = this.match.player, xr = this.xr;
    if (main) {
      main.ray.updateWorldMatrix(true, false);
      main.grip.updateWorldMatrix(true, false);
      _q.setFromRotationMatrix(_m.extractRotation(main.ray.matrixWorld));
      this.aimDir.set(0, 0, -1).applyQuaternion(_q).normalize();
      this.aimPos.setFromMatrixPosition(main.grip.matrixWorld);
      // muzzle of the held gun (same offset the held model uses)
      // shots leave from the front sight on the sight line (pickaxe / items: in front of the hand)
      _v.set(0, this.aimY, this.aimZ).applyQuaternion(_q);
      this.aimPos.add(_v);
    } else {
      const cam = this.game.camera;
      this.headDir(this.aimDir);
      this.aimPos.copy(xr.headLocal).applyMatrix4(xr.rig.matrixWorld);
    }
    P.aimOrigin.x = this.aimPos.x; P.aimOrigin.y = this.aimPos.y; P.aimOrigin.z = this.aimPos.z;
    P.yaw = yawTo(this.aimDir.x, this.aimDir.z);
    P.pitch = clamp(Math.asin(clamp(this.aimDir.y, -1, 1)), -1.45, 1.45);
    let my = xr.rigYaw + xr.headYaw;
    if (this.settings.get('vrMoveDir') === 'controller' && off) {
      off.ray.updateWorldMatrix(true, false);
      _v.set(0, 0, -1).applyQuaternion(_q.setFromRotationMatrix(_m.extractRotation(off.ray.matrixWorld)));
      if (Math.hypot(_v.x, _v.z) > 0.2) my = yawTo(_v.x, _v.z);
    }
    this.moveYaw = my;
    P.moveYaw = my;
    this.headPitchWorld = xr.headPitch;
  }

  /** World-space view direction of the head. */
  headDir(out) {
    const xr = this.xr, y = xr.rigYaw + xr.headYaw, p = xr.headPitch, cp = Math.cos(p);
    return out.set(-Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp);
  }

  teleport(dt, A, slot) {
    const m = this.match, P = m.player;
    this.tpCd -= dt;
    if (!slot) { this.arc.hide(); return; }
    if (A.moveY > 0.6 && this.tpCd <= 0) {
      slot.ray.updateWorldMatrix(true, false);
      _q.setFromRotationMatrix(_m.extractRotation(slot.ray.matrixWorld));
      _v.set(0, 0, -1).applyQuaternion(_q);
      const o = new THREE.Vector3().setFromMatrixPosition(slot.ray.matrixWorld);
      const t = this.arc.aim(m.physics, o.x, o.y, o.z, _v.x, _v.y, _v.z, P.pos.x, P.pos.z);
      this.tpTarget = t && t.y - P.pos.y < 2.6 ? t : null; // no teleporting up onto roofs
      if (t && !this.tpTarget) this.arc.line.material.color.set(0xff6a5a);
      this.tpAiming = true;
    } else if (this.tpAiming && A.moveY < 0.3) {
      this.tpAiming = false;
      const t = this.tpTarget;
      this.arc.hide();
      if (t) {
        P.pos.x = t.x; P.pos.y = t.y + 0.05; P.pos.z = t.z;
        P.vel.x = 0; P.vel.y = 0; P.vel.z = 0;
        P.savePrev();
        this.tpCd = 0.6;
        this.pulseMain(0.2, 15);
        this.vignette.amt = 0.9; // quick blink hides the jump
      }
    } else if (!this.tpAiming) this.arc.hide();
  }

  grab(slot) {
    const m = this.match, P = m.player;
    slot.grip.updateWorldMatrix(true, false);
    const gp = new THREE.Vector3().setFromMatrixPosition(slot.grip.matrixWorld);
    let best = null, bd = 0.55;
    for (const it of m.world.loot.query(gp.x, gp.z, 0.8, near)) {
      if (!it.alive) continue;
      const d = Math.hypot(it.x - gp.x, it.y + 0.15 - gp.y, it.z - gp.z);
      if (d < bd) { bd = d; best = it; }
    }
    if (best) { if (!tryPickup(m, P, best)) m.hud.toast('Inventory full', '#ff7070'); return; }
    for (const c of m.world.loot.chests) {
      if (!c.alive || c.opened) continue;
      if (Math.hypot(c.x - gp.x, c.y + 0.4 - gp.y, c.z - gp.z) < 0.85) { openChest(m, P, c); this.pulseMain(0.4, 30); return; }
    }
    this.input.tap('interact'); // whatever the controller points at (same reach as the E key)
  }

  onRecoil(amount) { this.recoil = Math.min(1, this.recoil + amount * 6); }

  // ---------- per render frame ----------
  update(alpha, dt) {
    const m = this.match, P = m.player, xr = this.xr, cam = this.game.camera;
    const lerp = (a, b) => a + (b - a) * alpha;
    if (P.alive && P.mode === 'bus') {
      // riding on the bus roof (rear half), facing the direction of travel
      const b = m.bus;
      if (!this.busAligned) { this.busAligned = true; xr.rigYaw = b.yaw - xr.headYaw; }
      this.placeRig(lerp(b.prev.x, b.pos.x) - b.dir.x * 2.6, b.pos.y + 1.75, lerp(b.prev.z, b.pos.z) - b.dir.z * 2.6);
    } else if (P.alive) {
      this.placeRig(lerp(P.prev.x, P.pos.x), lerp(P.prev.y, P.pos.y), lerp(P.prev.z, P.pos.z));
      this.specTarget = null; this.specTurn = 0;
    } else this.spectate(alpha, dt);
    // head pose of this frame (the camera object itself only gets it during rendering)
    this.headWorld.copy(xr.headLocal).applyMatrix4(xr.rig.matrixWorld);
    m.cameraRig.pos.copy(this.headWorld);
    this.headDir(m.cameraRig.dir);

    const { main, off } = xr.hands();
    for (let i = 0; i < 2; i++) this.gloves[i].visible = xr.slots[i].connected && !xr.slots[i].isHand && P.alive;
    this.updateHeld(main, dt);
    this.updateLaser(dt);
    this.hud.update(dt, off, this.actions.mapHeld && !this.game.paused);
    this.hints.update(dt, this.hintContext(), main, this.settings.get('vrHints'));
    this.updateGlider(dt);
    // comfort vignette: artificial motion only (room-scale walking never darkens the view)
    const vs = { off: 0, low: 0.6, strong: 1.2 }[this.settings.get('vrVignette')] ?? 0.6;
    let target = 0;
    if (P.alive && !this.game.paused) {
      if (P.mode === 'ground' && Math.hypot(this.input.axis.x, this.input.axis.y) > 0.05) target = Math.min(1, Math.hypot(P.vel.x, P.vel.z) / 8) * 0.55;
      else if (P.mode === 'freefall') target = 0.4;
      else if (P.mode === 'glide') target = 0.25;
      target += Math.min(1, this.turnRate / 2) * 0.5;
    } else if (!P.alive && !this.game.paused) {
      // spectator camera: moves and turns on its own -> same comfort vignette
      const t = this.specTarget;
      if (t && t !== P) target = Math.min(1, Math.hypot(t.vel.x, t.vel.z) / 8) * 0.35 + Math.min(1, this.specTurn / 2) * 0.5;
    }
    this.vignette.update(dt, Math.min(1, target * vs));
    this.perfGovernor(dt);
  }

  /** Glider canopy above your head while gliding, lines to your hands. */
  updateGlider(dt) {
    const P = this.match.player, xr = this.xr;
    const gliding = P.alive && P.mode === 'glide';
    const sp = Math.hypot(P.vel.x, P.vel.z);
    const heading = sp > 1 ? yawTo(P.vel.x, P.vel.z) : (P.moveYaw ?? xr.rigYaw + xr.headYaw);
    const hand = (side) => {
      const s = xr.slots.find((q) => q.connected && !q.isHand && q.handedness === side);
      return s ? s.grip.getWorldPosition(new THREE.Vector3()) : null;
    };
    this.glider.update(dt, gliding, this.headWorld, heading, { x: this.input.axis.x, y: this.input.axis.y }, [hand('left'), hand('right')]);
  }

  /** Game situation for the controller button hints. */
  hintContext() {
    const m = this.match, P = m.player, ctrl = m.controller, s = this.settings;
    const cur = P.inv.current();
    let item = 'gun';
    if (P.inv.sel === 0) item = 'pickaxe';
    else if (cur && cur.kind === 'consumable') item = CONSUMABLES[cur.type] && CONSUMABLES[cur.type].throwable ? 'grenade' : 'heal';
    return { mode: P.mode, alive: P.alive, building: !!ctrl.buildMode, editing: !!ctrl.editPiece, phase: m.phase, paused: this.game.paused,
      teleport: s.get('vrMove') === 'teleport', smoothTurn: s.get('vrTurn') === 'smooth', item };
  }

  /**
   * After death: third-person chase view behind the watched player (your killer first), turning with
   * them like the flat-screen spectator camera. The camera is pulled in when a wall is behind them.
   */
  spectate(alpha, dt) {
    const m = this.match, P = m.player, xr = this.xr;
    const lerp = (a, b) => a + (b - a) * alpha;
    const t = m.spectateTarget && m.spectateTarget.visible !== false ? m.spectateTarget : P;
    const tx = lerp(t.prev.x, t.pos.x), ty = lerp(t.prev.y, t.pos.y), tz = lerp(t.prev.z, t.pos.z);
    if (t !== this.specTarget) {
      this.specTarget = t;
      this.specYaw = t === P ? xr.rigYaw + xr.headYaw : t.yaw;
      this.spectatePos = null;
      // your current head direction becomes "behind the target"; looking around stays free afterwards
      this.specHeadRef = xr.headYaw;
      xr.rigYaw = this.specYaw - this.specHeadRef;
    }
    if (t !== P && !this.game.paused) this.specYaw += wrapAngle(t.yaw - this.specYaw) * Math.min(1, dt * 3);
    const back = t === P ? 5 : 4.2, up = t === P ? 2.2 : 1.1;
    const fx = -Math.sin(this.specYaw), fz = -Math.cos(this.specYaw);
    const hx = tx, hy = ty + (t.height || 1.8), hz = tz;
    let dx = -fx * back, dy = up, dz = -fz * back;
    const L = Math.hypot(dx, dy, dz);
    m.physics.raycast(hx, hy, hz, dx / L, dy / L, dz / L, L + 0.3, null, camHit);
    const k = camHit.hit ? Math.max(0.35, camHit.t - 0.3) / L : 1;
    const want = _v.set(hx + dx * k, hy + dy * k, hz + dz * k);
    if (!this.spectatePos) this.spectatePos = want.clone();
    else this.spectatePos.lerp(want, Math.min(1, dt * 5));
    // turn the play space with the target (the view axis follows its heading)
    if (!this.game.paused) {
      const before = xr.rigYaw;
      xr.rigYaw += wrapAngle(this.specYaw - this.specHeadRef - xr.rigYaw) * Math.min(1, dt * 6);
      this.specTurn = Math.abs(wrapAngle(xr.rigYaw - before)) / Math.max(1e-3, dt);
    }
    // eyes exactly at the camera point, whatever your real height
    this.placeRig(this.spectatePos.x, this.spectatePos.y - this.viewOffset() - (xr.headLocal.y > 0.5 ? xr.headLocal.y : 1.6), this.spectatePos.z);
  }

  /**
   * Headset frame-rate guard: when frames stay slower than ~60 fps for 2 s, drop the most expensive
   * extras (first shadows, then grass + far fog) — a stuttering headset is worse than a plainer one.
   */
  perfGovernor(dt) {
    if (!this.xr.presenting || this.game.paused) return;
    this.perfAvg = (this.perfAvg || 1 / 72) * 0.95 + dt * 0.05;
    this.perfT = (this.perfT || 0) + dt;
    if (this.perfAvg < 1 / 58) { this.perfSlow = 0; return; }
    this.perfSlow = (this.perfSlow || 0) + dt;
    if (this.perfSlow < 2 || this.perfT < 6) return;
    this.perfSlow = 0; this.perfT = 0;
    const g = this.game, w = this.match.world;
    if (g.renderer.shadowMap.enabled) {
      g.renderer.shadowMap.enabled = false; g.sun.castShadow = false;
      console.info('[Storm Island] VR: frame rate low, shadows turned off');
    } else if (w.grass && w.grass.mesh && w.grass.mesh.visible) {
      w.grass.mesh.visible = false;
      g.quality = { ...g.quality, drawDist: Math.max(200, g.quality.drawDist * 0.8), particles: Math.round(g.quality.particles * 0.6) };
      console.info('[Storm Island] VR: frame rate low, grass hidden and view distance reduced');
    }
  }

  updateHeld(main, dt) {
    const P = this.match.player, ctrl = this.match.controller;
    this.recoil = Math.max(0, this.recoil - dt * 8);
    const cur = P.inv.current();
    let key = null, color = 0xffffff;
    if (P.alive && P.mode === 'ground' && main && !ctrl.buildMode && !ctrl.editPiece) {
      if (P.inv.sel === 0) { key = 'pickaxe'; color = 0xcfd8e2; }
      else if (cur && cur.kind === 'weapon') { key = cur.type; color = RARITIES[cur.rarity].hex; }
      else if (cur && cur.kind === 'consumable') key = 'c_' + cur.type;
    }
    this.held.visible = !!key;
    if (!key) { this.heldItem = null; this.aimY = 0.05; this.aimZ = -0.1; this.physAds = false; return; }
    let item = this.heldItems[key];
    if (!item) { item = makeHeldItem(key); this.heldItems[key] = item; this.held.add(item.root); }
    if (this.heldItem !== item) {
      for (const k in this.heldItems) this.heldItems[k].root.visible = k === key;
      this.heldItem = item;
      this.aimY = item.aimY; this.aimZ = item.aimZ;
    }
    item.mesh.material.color.set(color);
    this.held.position.copy(main.grip.position);
    this.held.quaternion.copy(main.ray.quaternion);
    if (this.recoil > 0) { this.held.translateZ(this.recoil * 0.05); this.held.rotateX(this.recoil * 0.2); }
    // aiming down the sights: your eye is on the sight line, behind the rear sight (cheek on the stock),
    // and you look along the barrel. (Tested on a Quest 3: a plain "rear sight within 20 cm" check never
    // fired for the rifle, whose rear sight sits 10 cm in front of the grip.)
    this.physAds = false;
    if (item.sight) {
      this.held.updateMatrixWorld(true);
      const eye = this.held.worldToLocal(_v.copy(this.headWorld));
      const offLine = Math.hypot(eye.x, eye.y - item.sight.y);
      const behind = eye.z - item.sight.rear;
      const view = this.headDir(_v2);
      this.physAds = offLine < 0.07 && behind > -0.02 && behind < 0.5 && view.dot(this.aimDir) > 0.94;
    }
  }

  /** Before the main render: the sniper scope draws its zoomed view (only while it is in use). */
  preRender() {
    const item = this.heldItem, P = this.match.player;
    if (!item || !item.scope || !this.held.visible || this.game.paused) return;
    if (!(this.physAds || this.actions.aim)) return;
    this.held.updateMatrixWorld(true);
    const front = _v.set(0, item.sight.y, item.sight.front - 0.02).applyMatrix4(this.held.matrixWorld);
    item.scope.render(this.game.renderer, this.match.scene, front, this.aimDir,
      [this.xr.rig, this.laser, this.dot, this.arc.line, this.arc.marker, this.glider.root, this.glider.lines]);
  }

  updateLaser(dt) {
    const P = this.match.player, ctrl = this.match.controller;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    const cur = P.inv.current();
    const gun = cur && cur.kind === 'weapon' && P.inv.sel !== 0;
    const show = P.alive && P.mode === 'ground' && !this.game.paused && (ctrl.buildMode || ctrl.editPiece || gun);
    this.laser.visible = show; this.dot.visible = show;
    if (!show) return;
    const a = P.aimOrigin, b = P.aimPoint;
    const pos = this.laser.geometry.attributes.position;
    pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, b.x, b.y, b.z); pos.needsUpdate = true;
    const enemy = !!ctrl.aimChar;
    const col = this.hitFlash > 0 ? (this.hitHead ? 0xffd23f : 0xffffff) : enemy ? 0xff4a3a : (ctrl.buildMode || ctrl.editPiece) ? 0x7fc8ff : 0xffffff;
    this.laser.material.color.set(col);
    this.laser.material.opacity = enemy ? 0.55 : 0.3;
    this.dot.material.color.set(col);
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    this.dot.position.set(b.x, b.y, b.z);
    this.dot.scale.setScalar((1 + d * 0.04) * (this.hitFlash > 0 ? 1.8 : 1));
  }
}
