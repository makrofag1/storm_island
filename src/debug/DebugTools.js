// ?debug=1 test tools (God mode, loot, teleport, spawn bot, storm speed...) and nav-grid visualization.
import * as THREE from 'three';
import { makeWeapon } from '../combat/Items.js';
import { DEBUG } from '../core/config.js';

export class DebugTools {
  constructor(match) {
    this.match = match;
    this.open = false;
    this.teleportOnClick = false;
    if (!DEBUG) return;
    const el = document.createElement('div');
    el.className = 'debug-panel hidden';
    el.innerHTML = `<b>Debug tools (\` / F2)</b>
      <button data-a="god">God mode</button>
      <button data-a="loot">Give legendary loot + mats</button>
      <button data-a="tp">Teleport: click on map (M)</button>
      <button data-a="bot">Spawn bot in front of me</button>
      <button data-a="storm">Storm speed x8</button>
      <button data-a="skipstorm">Skip to next storm phase</button>
      <button data-a="killbots">Eliminate all bots but one</button>
      <button data-a="killme">Eliminate me</button>`;
    match.game.uiRoot.appendChild(el);
    this.el = el;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.action(b.dataset.a, b);
    });
  }
  toggle() {
    if (!this.el) return;
    this.open = !this.open;
    this.el.classList.toggle('hidden', !this.open);
    if (this.open) this.match.game.input.exitLock(); else this.match.game.input.requestLock();
  }
  action(a, btn) {
    const m = this.match, p = m.player;
    switch (a) {
      case 'god': p.god = !p.god; btn.classList.toggle('on', p.god); break;
      case 'loot':
        p.inv.slots = [makeWeapon('ar', 4), makeWeapon('shotgun', 4), makeWeapon('sniper', 4), { kind: 'consumable', type: 'bigshield', count: 3 }, { kind: 'consumable', type: 'medkit', count: 3 }];
        for (const k in p.inv.ammo) p.inv.ammo[k] = 200;
        p.inv.mats.wood = p.inv.mats.brick = p.inv.mats.metal = 999;
        p.shield = 100; p.health = 100;
        break;
      case 'tp': this.teleportOnClick = !this.teleportOnClick; btn.classList.toggle('on', this.teleportOnClick); break;
      case 'bot': {
        const b = m.bots.find((x) => !x.ch.alive) || m.bots.find((x) => x.ch.mode === 'bus');
        if (!b) break;
        const ch = b.ch;
        if (!ch.alive) { ch.alive = true; m.aliveCount++; ch.health = 100; ch.shield = 0; ch.anim.deathT = 0; }
        ch.mode = 'ground'; ch.hittable = true; ch.visible = true;
        ch.pos.x = p.pos.x - Math.sin(p.yaw) * 8; ch.pos.z = p.pos.z - Math.cos(p.yaw) * 8;
        ch.pos.y = m.world.hm.height(ch.pos.x, ch.pos.z) + 1; ch.vel.x = ch.vel.y = ch.vel.z = 0; ch.grounded = false;
        ch.inv.slots[0] = makeWeapon('ar', 1); ch.inv.ammo.medium = 60;
        ch.savePrev();
        b.state = 'wander';
        break;
      }
      case 'storm': m.storm.speed = m.storm.speed === 1 ? 8 : 1; btn.classList.toggle('on', m.storm.speed > 1); break;
      case 'skipstorm': m.storm.timer = 0.01; break;
      case 'killbots': {
        const alive = m.bots.filter((b) => b.ch.alive);
        alive.slice(1).forEach((b) => m.combat.applyDamage(b.ch, 999, { cause: 'storm', bypassShield: true }));
        break;
      }
      case 'killme': p.god = false; m.combat.applyDamage(p, 999, { cause: 'storm', bypassShield: true }); break;
    }
  }
  teleport(x, z) {
    const p = this.match.player;
    p.pos.x = x; p.pos.z = z; p.pos.y = this.match.world.hm.height(x, z) + 60;
    p.mode = p.mode === 'bus' ? 'freefall' : 'glide'; p.hittable = true; p.visible = true;
    p.vel.x = p.vel.y = p.vel.z = 0; p.grounded = false; p.savePrev();
    if (this.match.phase === 'bus') this.match.game.setState('match');
  }
  tick() { }
  dispose() { if (this.el) this.el.remove(); }
}

/** Shows blocked nav cells around the focus and the selected bots' paths (F3). */
export class NavDebugView {
  constructor(scene) {
    this.enabled = false;
    this.max = 6000;
    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, depthTest: false }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    scene.add(this.points);
    this.lineGeo = new THREE.BufferGeometry();
    this.linePos = new Float32Array(4000 * 3);
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(this.lineGeo, new THREE.LineBasicMaterial({ color: 0xff40ff, depthTest: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 21;
    scene.add(this.lines);
    this.t = 0;
  }
  update(nav, focus, bots) {
    this.t++;
    if (this.t % 10) return;
    const hm = nav.hm;
    let n = 0;
    const R = 34;
    for (let z = focus.pos.z - R; z <= focus.pos.z + R && n < this.max; z += nav.cs) {
      for (let x = focus.pos.x - R; x <= focus.pos.x + R && n < this.max; x += nav.cs) {
        const k = nav.idx(x, z);
        const cx = nav.cx(k), cz = nav.cz(k);
        const blocked = !nav.walkable(k);
        const cost = nav.base[k];
        if (!blocked && cost === 1) continue;
        this.pos[n * 3] = cx; this.pos[n * 3 + 1] = hm.height(cx, cz) + 0.3; this.pos[n * 3 + 2] = cz;
        if (blocked) { this.col[n * 3] = 1; this.col[n * 3 + 1] = 0.2; this.col[n * 3 + 2] = 0.2; }
        else { this.col[n * 3] = 1; this.col[n * 3 + 1] = 0.8; this.col[n * 3 + 2] = 0.2; }
        n++;
      }
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    let l = 0;
    for (const b of bots) {
      if (!b.path || !b.ch.alive) continue;
      if (Math.hypot(b.ch.pos.x - focus.pos.x, b.ch.pos.z - focus.pos.z) > 150) continue;
      let px = b.ch.pos.x, pz = b.ch.pos.z;
      for (let i = b.pathIdx; i < b.path.points.length && l < 1990; i++) {
        const p = b.path.points[i];
        this.linePos.set([px, hm.height(px, pz) + 0.5, pz, p.x, hm.height(p.x, p.z) + 0.5, p.z], l * 6);
        px = p.x; pz = p.z; l++;
      }
    }
    this.lineGeo.setDrawRange(0, l * 2);
    this.lineGeo.attributes.position.needsUpdate = true;
  }
  clear() { this.geo.setDrawRange(0, 0); this.lineGeo.setDrawRange(0, 0); }
  dispose() {
    this.geo.dispose(); this.points.material.dispose(); this.lineGeo.dispose(); this.lines.material.dispose();
    this.points.removeFromParent(); this.lines.removeFromParent();
  }
}
