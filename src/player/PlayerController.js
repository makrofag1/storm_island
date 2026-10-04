// Translates keyboard/mouse input into the player's Character intent, and drives build/edit modes,
// interaction, slot selection and aim point computation.
import { yawDirX, yawDirZ, clamp, yawTo, wrapAngle } from '../core/math.js';
import { makeHit } from '../world/Physics.js';
import { WEAPONS } from '../combat/Items.js';
import { PIECES } from '../build/grid.js';
import { tileBounds } from '../build/grid.js';
import { tryPickup, autoPickup, openChest, findInteractable } from './Interactions.js';
import { itemName } from '../combat/Items.js';
import { RARITIES } from '../core/config.js';

const hit = makeHit();
const losHit = makeHit();
const MAT_ORDER = ['wood', 'brick', 'metal'];

export class PlayerController {
  constructor(match, ch) {
    this.match = match;
    this.ch = ch;
    this.input = match.game.input;
    this.settings = match.game.settings;
    this.buildMode = false;
    this.piece = 'wall';
    this.material = 'wood';
    this.rot = 0;
    this.editPiece = null;
    this.editHover = null;
    this.buildCd = 0;
    this.prompt = null;
    this.target = null;
    this.recoilRecover = 0;
    this.lastBuildKey = null;
    this.autoFireT = 0; this.autoFiring = false;
    this.assistTarget = null; this.assistCheckT = 0;
    ch.aimPoint = { x: 0, y: 0, z: 0 };
  }

  /** Per render frame: mouse look. */
  look(dt) {
    const [dx, dy] = this.input.consumeMouse(dt);
    const ch = this.ch;
    if (!ch.alive) return;
    const ads = ch.intent.aim && ch.mode === 'ground';
    const fov = this.match.game.camera.fov;
    let sens = 0.0022 * this.settings.get('sensitivity') * (ads ? this.settings.get('adsSensitivity') * (fov / this.settings.get('fov')) : 1);
    const assist = this.aimAssist(dt, Math.hypot(dx, dy) > 0.5 || Math.hypot(this.input.axis.x, this.input.axis.y) > 0.1, ads);
    sens *= assist; // friction: the crosshair slows down while it is over a target
    ch.yaw -= dx * sens;
    ch.pitch -= dy * sens * (this.settings.get('invertY') ? -1 : 1);
    if (this.recoilRecover > 0) {
      const r = Math.min(this.recoilRecover, dt * 0.35);
      ch.pitch -= r; this.recoilRecover -= r;
    }
    ch.pitch = clamp(ch.pitch, -1.45, 1.45);
  }

  /**
   * Touch aim assist (phones/tablets only — fingers can't track as precisely as a mouse):
   * - friction: look speed drops while an enemy is near the crosshair
   * - magnetism: while you move or look, the crosshair is gently pulled along with that enemy, so a
   *   strafing bot doesn't slip out of the crosshair while your thumb travels to FIRE
   * - ADS snap: pressing AIM snaps most of the way onto an enemy close to the crosshair
   * Only visible enemies count (line of sight checked a few times per second). Returns the look-speed
   * multiplier.
   */
  aimAssist(dt, active, ads) {
    const ch = this.ch, m = this.match, inp = this.input;
    if (!inp.touchMode || !this.settings.get('touchAimAssist') || ch.mode !== 'ground' || this.buildMode || this.editPiece) { this.assistTarget = null; this.assistPrev = null; return 1; }
    const cur = ch.inv.current();
    if (!cur || cur.kind !== 'weapon') { this.assistTarget = null; this.assistPrev = null; return 1; }
    const cam = m.cameraRig;
    const camYaw = yawTo(cam.dir.x, cam.dir.z), camPitch = Math.asin(clamp(cam.dir.y, -1, 1));
    const range = Math.min(WEAPONS[cur.type].range, 130);
    const errOf = (o) => {
      const tx = o.pos.x, ty = o.pos.y + o.height * 0.62, tz = o.pos.z;
      const dx = tx - cam.pos.x, dy = ty - cam.pos.y, dz = tz - cam.pos.z, hd = Math.hypot(dx, dz);
      const ay = yawTo(dx, dz), ap = Math.atan2(dy, hd);
      return { ey: wrapAngle(ay - camYaw), ep: ap - camPitch, ay, ap, d: hd, tx, ty, tz };
    };
    // (re)pick the target a few times per second: smallest angle within a distance-scaled cone
    this.assistCheckT -= dt;
    if (this.assistCheckT <= 0 || (this.assistTarget && !this.assistTarget.alive)) {
      this.assistCheckT = 0.15;
      let best = null, bestA = Infinity;
      for (const o of m.chars) {
        if (o === ch || !o.alive || !o.hittable || o.mode !== 'ground') continue;
        const e = errOf(o);
        if (e.d > range || e.d < 1) continue;
        const cone = Math.atan2(ads ? 3.2 : 2.2, e.d) + (ads ? 0.06 : 0.035);
        const a = Math.hypot(e.ey, e.ep);
        if (a < cone && a < bestA) { bestA = a; best = o; }
      }
      if (best) {
        const e = errOf(best);
        // anything solid between the camera and the target (other than the target itself) blocks it
        const dl = Math.hypot(e.tx - cam.pos.x, e.ty - cam.pos.y, e.tz - cam.pos.z);
        m.physics.raycast(cam.pos.x, cam.pos.y, cam.pos.z, (e.tx - cam.pos.x) / dl, (e.ty - cam.pos.y) / dl, (e.tz - cam.pos.z) / dl, dl, { chars: false }, losHit);
        if (losHit.hit && losHit.t < dl - 0.6) best = null;
      }
      // ADS snap when aiming starts
      if (best && ads && !this.wasAds) { const e = errOf(best); ch.yaw += e.ey * 0.7; ch.pitch += e.ep * 0.7; }
      this.assistTarget = best;
    }
    this.wasAds = ads;
    const t = this.assistTarget;
    if (!t) { this.assistPrev = null; return 1; }
    const e = errOf(t);
    const prev = this.assistPrev && this.assistPrev.t === t ? this.assistPrev : null;
    if (active) {
      // rotational assist: follow most of the target's angular motion (its strafing and your own
      // movement), plus a gentle pull toward its centre
      if (prev) { ch.yaw += wrapAngle(e.ay - prev.ay) * 0.6; ch.pitch += (e.ap - prev.ap) * 0.5; }
      const k = Math.min(1, dt * (ads ? 3.5 : 2.2));
      ch.yaw += e.ey * k;
      ch.pitch += e.ep * k * 0.8;
    }
    this.assistPrev = { t, ay: e.ay, ap: e.ap };
    return ads ? 0.5 : 0.6;
  }

  addRecoil(amount) {
    const ch = this.ch;
    const k = ch.intent.aim ? 0.6 : 1;
    ch.pitch += amount * k;
    ch.yaw += (Math.random() - 0.5) * amount * 0.4 * k;
    this.recoilRecover += amount * k * 0.65;
  }

  tick(dt) {
    const ch = this.ch, inp = this.input, it = ch.intent, m = this.match;
    if (!ch.alive) { it.mx = it.mz = 0; it.fire = it.aim = false; return; }
    if (m.mapOpen) {
      it.mx = it.mz = 0; it.fire = it.firePressed = it.aim = it.jump = false;
      if (inp.pressed('map') || inp.pressed('mapAlt')) m.toggleMap(false);
      return;
    }
    // movement
    let f = (inp.key('forward') ? 1 : 0) - (inp.key('back') ? 1 : 0);
    let s = (inp.key('right') ? 1 : 0) - (inp.key('left') ? 1 : 0);
    const ax = inp.axis;
    if (Math.abs(ax.x) + Math.abs(ax.y) > 0.05) { f = ax.y; s = ax.x; } // touch joystick (analog)
    const fx = yawDirX(ch.yaw), fz = yawDirZ(ch.yaw);
    const rx = -fz, rz = fx;
    let mx = fx * f + rx * s, mz = fz * f + rz * s;
    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    it.mx = mx; it.mz = mz;
    it.sprint = inp.key('sprint') || ax.sprint;
    it.jump = inp.key('jump');
    it.crouch = inp.key('crouch');
    it.dive = (ch.mode === 'freefall' || ch.mode === 'glide') && f > 0 && ch.pitch < -0.35;
    it.slow = (ch.mode === 'freefall' || ch.mode === 'glide') && f < 0;
    if (ch.mode === 'freefall' || ch.mode === 'glide') it.jump = inp.pressed('jump');
    if (inp.pressed('shoulder')) m.cameraRig.shoulder *= -1;
    if (inp.pressed('emote') && ch.mode === 'ground' && ch.grounded) { ch.emoting = !ch.emoting; ch.anim.emoteT = 0; if (ch.emoting) m.events.emit('emote', { ch }); }
    if (inp.pressed('map') || inp.pressed('mapAlt')) { m.toggleMap(true); return; }

    this.buildCd -= dt;
    const wheel = inp.consumeWheel();
    // build-mode hotkeys
    const quick = { wall: 'wall', floor: 'floor', stairs: 'stairs', roof: 'roof' };
    for (const k in quick) if (inp.pressed(k)) { this.enterBuild(quick[k]); }
    if (inp.pressed('build')) { if (this.buildMode) this.exitBuild(); else this.enterBuild(this.piece); }
    if (inp.pressed('edit')) this.toggleEdit();

    if (this.editPiece) this.tickEdit(it);
    else if (this.buildMode) this.tickBuild(it, wheel);
    else this.tickCombat(it, wheel);

    // aim point from the camera ray
    const cam = m.cameraRig;
    m.physics.raycast(cam.pos.x, cam.pos.y, cam.pos.z, cam.dir.x, cam.dir.y, cam.dir.z, 1000, { chars: true, ignore: ch }, hit);
    // ignore hits behind the player (between camera and character)
    const toCh = (ch.pos.x - cam.pos.x) * cam.dir.x + (ch.eyeY - cam.pos.y) * cam.dir.y + (ch.pos.z - cam.pos.z) * cam.dir.z;
    if (hit.hit && hit.t < toCh - 0.2) {
      m.physics.raycast(cam.pos.x + cam.dir.x * toCh, cam.pos.y + cam.dir.y * toCh, cam.pos.z + cam.dir.z * toCh, cam.dir.x, cam.dir.y, cam.dir.z, 1000, { chars: true, ignore: ch }, hit);
    }
    ch.aimPoint.x = hit.x; ch.aimPoint.y = hit.y; ch.aimPoint.z = hit.z;
    this.aimHit = hit.hit ? hit.kind : null;
    this.aimChar = hit.kind === 'char' ? hit.char : null;

    // interaction
    autoPickup(m, ch);
    this.prompt = null;
    if (ch.mode === 'ground') {
      const target = findInteractable(m, ch, cam.dir.x, cam.dir.y, cam.dir.z);
      if (target) {
        if (target.kind === 'chest') this.prompt = { text: target.ref.kind === 'chest' ? 'Open Chest' : 'Open Ammo Box', color: '#ffd76a' };
        else {
          const item = target.ref.item;
          const full = ch.inv.firstEmpty() < 0 && item.kind === 'weapon';
          this.prompt = { text: (full ? (ch.inv.sel === 0 ? 'Inventory full — select a slot to swap: ' : 'Swap for ') : 'Pick up ') + (item.kind === 'weapon' ? RARITIES[item.rarity].name + ' ' : '') + itemName(item) + (item.count > 1 ? ' x' + item.count : ''), color: item.kind === 'weapon' ? RARITIES[item.rarity].color : '#ffffff' };
        }
        if (inp.pressed('interact')) {
          if (target.kind === 'chest') openChest(m, ch, target.ref);
          else if (!tryPickup(m, ch, target.ref)) m.hud.toast('Inventory full', '#ff7070');
        }
      }
    }
  }

  tickCombat(it, wheel) {
    const ch = this.ch, inp = this.input;
    const inv = ch.inv;
    if (inp.pressed('pickaxe') || inp.pressed('pickaxeAlt')) inv.sel = 0;
    for (let i = 1; i <= 5; i++) if (inp.pressed('slot' + i)) inv.sel = i;
    if (wheel) inv.sel = (inv.sel + (wheel > 0 ? 1 : -1) + 6) % 6;
    it.fire = inp.mouseDown[0];
    it.firePressed = inp.mousePressed[0];
    const cur = inv.current();
    // touch auto-fire: shoot while the crosshair rests on an enemy (after a short 70 ms settle)
    const tgt = this.aimChar;
    const canAuto = inp.touchMode && this.settings.get('touchAutoFire') && cur && cur.kind === 'weapon' && cur.mag > 0 && ch.reloadT <= 0 && ch.mode === 'ground'
      && tgt && tgt.alive && tgt.hittable && Math.hypot(tgt.pos.x - ch.pos.x, tgt.pos.z - ch.pos.z) <= WEAPONS[cur.type].range;
    this.autoFireT = canAuto ? this.autoFireT + 1 / 60 : 0;
    const auto = canAuto && this.autoFireT >= 0.07;
    // semi-automatic guns need a fresh "press" per shot: re-press whenever the gun is ready again
    if (auto) { it.fire = true; if (!this.autoFiring || (!WEAPONS[cur.type].auto && ch.fireCd <= 0)) it.firePressed = true; }
    this.autoFiring = auto;
    it.aim = inp.mouseDown[2] && !!cur && cur.kind === 'weapon';
    it.reload = inp.pressed('reload');
  }

  enterBuild(piece) {
    if (this.ch.mode !== 'ground') return;
    this.editPiece = null;
    this.match.build.ghost.hideEdit();
    this.buildMode = true;
    this.piece = piece;
    if (this.ch.inv.mats[this.material] < 10) {
      const alt = MAT_ORDER.find((mm) => this.ch.inv.mats[mm] >= 10);
      if (alt) this.material = alt;
    }
    this.match.events.emit('buildMode', { on: true });
  }
  exitBuild() {
    this.buildMode = false;
    this.match.build.ghost.hide();
    this.match.events.emit('buildMode', { on: false });
  }

  tickBuild(it, wheel) {
    const ch = this.ch, inp = this.input, b = this.match.build;
    it.fire = false; it.aim = false; it.reload = false; it.firePressed = false;
    if (ch.mode !== 'ground') { this.exitBuild(); return; }
    const keys = ['pickaxeAlt', 'slot1', 'slot2', 'slot3'];
    keys.forEach((k, i) => { if (inp.pressed(k)) this.piece = PIECES[i]; });
    if (inp.pressed('pickaxe')) { this.exitBuild(); ch.inv.sel = 0; return; }
    if (wheel) this.piece = PIECES[(PIECES.indexOf(this.piece) + (wheel > 0 ? 1 : -1) + 4) % 4];
    if (inp.mousePressed[2]) {
      const i = MAT_ORDER.indexOf(this.material);
      this.material = MAT_ORDER[(i + 1) % 3];
      this.match.events.emit('matSwitch', { mat: this.material });
    }
    if (inp.pressed('rotate')) this.rot = (this.rot + 1) % 4;
    const t = b.targetFor(ch, this.piece, this.piece === 'stairs' ? this.rot : 0);
    const v = b.validate(ch, t.type, t.ix, t.iz, t.L, t.extra, this.material);
    this.target = t;
    b.ghost.show(t, v.ok);
    if (inp.mouseDown[0] && this.buildCd <= 0) {
      if (v.ok) {
        b.place(ch, t.type, t.ix, t.iz, t.L, t.extra, this.material);
        this.buildCd = 0.12;
      } else if (inp.mousePressed[0]) {
        this.match.hud.toast(v.reason === 'mats' ? 'Not enough ' + this.material : v.reason === 'support' ? 'Needs support' : 'Can\'t build there', '#ff7070');
        this.buildCd = 0.25;
      }
    }
  }

  toggleEdit() {
    const m = this.match, ch = this.ch;
    if (this.editPiece) { this.editPiece = null; m.build.ghost.hideEdit(); return; }
    if (ch.mode !== 'ground') return;
    const cam = m.cameraRig;
    m.physics.raycast(cam.pos.x, cam.pos.y, cam.pos.z, cam.dir.x, cam.dir.y, cam.dir.z, 9, null, hit);
    const o = hit.hit && hit.kind === 'collider' ? hit.collider.owner : null;
    if (o && o.kind === 'build' && o.owner === ch && (o.type === 'wall' || o.type === 'floor')) {
      this.editPiece = o;
      if (this.buildMode) { this.buildMode = false; m.build.ghost.hide(); }
    } else m.hud.toast('Aim at one of your walls or floors to edit', '#ffd76a');
  }

  tickEdit(it) {
    const ch = this.ch, inp = this.input, m = this.match, p = this.editPiece;
    it.fire = false; it.aim = false; it.firePressed = false; it.reload = false;
    if (!p.alive) { this.editPiece = null; m.build.ghost.hideEdit(); return; }
    // tile under the crosshair: intersect the camera ray with the piece plane
    const cam = m.cameraRig;
    let hover = null;
    const b = p.bounds;
    let t = -1;
    if (p.type === 'floor') { if (Math.abs(cam.dir.y) > 1e-4) t = (b.maxY - cam.pos.y) / cam.dir.y; }
    else if (p.axis === 'x') { if (Math.abs(cam.dir.z) > 1e-4) t = ((b.minZ + b.maxZ) / 2 - cam.pos.z) / cam.dir.z; }
    else if (Math.abs(cam.dir.x) > 1e-4) t = ((b.minX + b.maxX) / 2 - cam.pos.x) / cam.dir.x;
    if (t > 0 && t < 14) {
      const x = cam.pos.x + cam.dir.x * t, y = cam.pos.y + cam.dir.y * t, z = cam.pos.z + cam.dir.z * t;
      for (let j = 0; j < 3 && !hover; j++) for (let i = 0; i < 3; i++) {
        const tb = tileBounds(p.type, p.ix, p.iz, p.L, p.axis, i, j);
        const e = 0.05;
        if (x >= tb.minX - e && x <= tb.maxX + e && y >= tb.minY - e && y <= tb.maxY + e && z >= tb.minZ - e && z <= tb.maxZ + e) { hover = { i, j }; break; }
      }
    }
    this.editHover = hover;
    if (hover && inp.mousePressed[0]) m.build.toggleTile(p, hover.i, hover.j);
    if (inp.pressed('rotate')) m.build.resetEdit(p);
    if (inp.pressed('build')) { this.editPiece = null; m.build.ghost.hideEdit(); }
    if (this.editPiece) m.build.ghost.showEdit(p, hover);
    const dx = ch.pos.x - (b.minX + b.maxX) / 2, dz = ch.pos.z - (b.minZ + b.maxZ) / 2;
    if (dx * dx + dz * dz > 14 * 14) { this.editPiece = null; m.build.ghost.hideEdit(); }
  }

  /** Hotbar tap (touch) / click: slot 0 = pickaxe, 1..5 items; in build mode 0..3 = pieces. */
  selectSlot(i) {
    if (!this.ch.alive) return;
    if (this.editPiece) { this.editPiece = null; this.match.build.ghost.hideEdit(); }
    if (this.buildMode) {
      if (i < 4) { this.piece = PIECES[i]; return; }
      this.exitBuild();
    }
    this.ch.inv.sel = i;
  }

  cancelModes() {
    if (this.buildMode) this.exitBuild();
    if (this.editPiece) { this.editPiece = null; this.match.build.ghost.hideEdit(); }
  }

  adsInfo() {
    const cur = this.ch.inv.current();
    if (!cur || cur.kind !== 'weapon' || this.buildMode || this.editPiece) return { ads: false, fov: 60, scope: false };
    const def = WEAPONS[cur.type];
    return { ads: this.ch.intent.aim && this.ch.mode === 'ground', fov: def.fov, scope: !!def.scope };
  }
}
