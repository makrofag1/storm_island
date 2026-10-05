// Headset test mode (?vrtest=1): fixed scenarios + reports in the console (the dev server relays them
// to its terminal), used to verify VR features on a real Quest:
// - god mode (bots can't hurt you) so a test run isn't cut short
// - glider: logs mode changes, canopy opening and banking while gliding
// - after landing: a rifle, sniper and pistol, plus 4 frozen target bots straight ahead at 25 / 90 /
//   250 / 330 m -> character visibility is checked against the real headset view frustum every 3 s
// - aiming: logs aim-down-sights on/off (physical = gun at the eye, or trigger), scope use, hits
import * as THREE from 'three';
import { makeWeapon } from '../combat/Items.js';

const _f = new THREE.Frustum();
const _m = new THREE.Matrix4();
const _s = new THREE.Sphere();

export class VrTests {
  constructor(game) {
    this.game = game;
    this.match = null;
    this.s = {};
    setInterval(() => { try { this.tick(); } catch (e) { console.warn('[vrtest] ' + (e && e.stack || e)); } }, 250);
    this.log('test mode armed — press PLAY IN VR');
  }

  log(...a) { console.info('[vrtest] ' + a.join(' ')); }

  tick() {
    const g = this.game, m = g.match;
    if (m !== this.match) { this.match = m; this.s = {}; if (m) this.hook(m); }
    if (!m || !m.begun) return;
    const P = m.player, X = m.xrPlayer, s = this.s;
    if (!s.began) { s.began = true; this.log(`match: vr=${g.xr.active} presenting=${g.xr.presenting} bots=${m.bots.length} quality drawDist=${g.quality.drawDist} charDist=${g.quality.charDist}`); }
    if (P.alive && P.mode !== 'bus') P.hittable = false; // god mode
    if (P.mode !== s.mode) {
      const alt = Math.max(0, P.pos.y - Math.max(0, m.world.hm.height(P.pos.x, P.pos.z)));
      this.log(`mode ${s.mode || '-'} -> ${P.mode} (alt ${alt.toFixed(0)} m)`);
      s.mode = P.mode; s.glideT = 0;
    }
    if (X && (P.mode === 'glide' || (X.glider.open > 0 && X.glider.open < 1))) {
      s.glideT = (s.glideT || 0) + 0.25;
      if (s.glideT >= 1) {
        s.glideT = 0;
        const gl = X.glider;
        this.log(`glider open=${gl.open.toFixed(2)} visible=${gl.root.visible} lines=${gl.lines.visible} roll=${gl.roll.toFixed(2)} canopyAboveHead=${(gl.root.position.y - X.headWorld.y).toFixed(2)} m`);
      }
    }
    if (X && P.alive && P.mode === 'ground' && !s.setup) this.setup(m);
    if (s.setup && X) {
      // aiming
      const ads = P.intent.aim, phys = X.physAds;
      const key = `${ads}|${phys}|${X.heldItem && X.heldItem.key}`;
      if (key !== s.adsKey) {
        s.adsKey = key;
        if (X.heldItem && X.heldItem.sight) this.log(`ADS ${ads ? 'ON' : 'off'} (${phys ? 'gun at the eye' : ads ? 'trigger' : '-'}) weapon=${X.heldItem.key}${X.heldItem.scope ? ' scope' : ''}`);
      }
      s.visT = (s.visT || 0) + 0.25;
      if (s.visT >= 3) { s.visT = 0; this.report(m); }
    }
  }

  hook(m) {
    const P = m.player;
    m.events.on('damage', (e) => { if (e.attacker === P) this.log(`hit ${e.target.name}${e.head ? ' (head)' : ''} -${Math.round(e.amount)} with ${e.weapon}${this.game.match.xrPlayer && this.game.match.xrPlayer.physAds ? ' [aiming down sights]' : ''}`); });
    m.events.on('death', (e) => { if (e.attacker === P) this.log(`eliminated ${e.target.name}`); if (e.target === P) this.log('player died (should not happen in god mode)'); });
  }

  setup(m) {
    const s = this.s, P = m.player, X = m.xrPlayer, xr = this.game.xr;
    s.setup = true;
    P.inv.slots = [makeWeapon('ar', 2), makeWeapon('sniper', 4), makeWeapon('pistol', 1), { kind: 'consumable', type: 'grenade', count: 6 }, null];
    P.inv.ammo.medium = 600; P.inv.ammo.heavy = 60; P.inv.ammo.light = 300;
    P.inv.mats.wood = 300;
    P.inv.sel = 1;
    // frozen targets straight ahead of where you look
    const yaw = xr.rigYaw + xr.headYaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const dists = [25, 90, 250, 330];
    const bots = m.bots.filter((b) => b.ch.alive).slice(0, dists.length);
    s.targets = [];
    bots.forEach((b, i) => {
      const ch = b.ch, d = dists[i], side = (i % 2 ? 1 : -1) * (2 + i);
      b.update = () => { ch.intent.mx = ch.intent.mz = 0; ch.intent.fire = false; };
      ch.mode = 'ground'; ch.visible = true; ch.hittable = true;
      ch.pos.x = P.pos.x + fx * d - fz * side; ch.pos.z = P.pos.z + fz * d + fx * side;
      ch.pos.y = Math.max(0, m.world.hm.height(ch.pos.x, ch.pos.z)) + 0.05;
      ch.vel.x = ch.vel.y = ch.vel.z = 0; ch.yaw = yaw + Math.PI; ch.prevYaw = ch.yaw;
      ch.savePrev();
      s.targets.push({ ch, d });
    });
    this.log(`setup: AR / sniper / pistol given; ${s.targets.length} frozen targets ahead at ${dists.join(', ')} m. Look straight ahead.`);
  }

  /** Characters that the headset really sees (XR camera frustum, within charDist) vs. characters drawn. */
  report(m) {
    const g = this.game, P = m.player, X = m.xrPlayer;
    const cam = g.renderer.xr.isPresenting ? g.renderer.xr.getCamera() : g.camera;
    _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _f.setFromProjectionMatrix(_m);
    const cp = X.headWorld, maxD = m.quality.charDist;
    let expected = 0;
    for (const ch of m.chars) {
      if (ch === P || !ch.visible) continue;
      if (Math.hypot(ch.pos.x - cp.x, ch.pos.z - cp.z) > maxD) continue;
      _s.center.set(ch.pos.x, ch.pos.y + 1, ch.pos.z); _s.radius = 1.6;
      if (_f.intersectsSphere(_s)) expected++;
    }
    const drawn = m.charView.meshes.head.count;
    const tg = this.s.targets.map((t) => {
      _s.center.set(t.ch.pos.x, t.ch.pos.y + 1, t.ch.pos.z);
      return `${t.d}m:${t.ch.alive ? (_f.intersectsSphere(_s) ? 'in view' : 'off view') : 'dead'}`;
    }).join(' ');
    this.log(`visibility: in headset view ${expected}, drawn ${drawn} ${drawn >= expected ? 'OK' : 'MISSING ' + (expected - drawn)} | targets ${tg} | stats shots ${P.stats.shots} hits ${P.stats.hits}`);
  }
}
