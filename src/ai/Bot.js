// Bot brain: utility-scored FSM (drop -> loot/gather -> rotate -> engage/fight -> retreat/heal -> build),
// fair perception (FOV + line of sight + hearing + memory), nav-grid pathing with indoor waypoint
// chains, stuck recovery, and the same Character intents/rules as the player.
import { WEAPONS, CONSUMABLES, itemScore } from '../combat/Items.js';
import { yawTo, approachAngle, wrapAngle, yawDirX, yawDirZ, clamp } from '../core/math.js';
import { tryPickup, autoPickup, openChest } from '../player/Interactions.js';
import { AUTO_GLIDE_ALT } from '../player/Motor.js';
import { makeHit } from '../world/Physics.js';
import { canUseConsumable } from '../combat/Damage.js';
import { HALF } from '../core/config.js';
import { assignPersona } from './Personality.js';

const hit = makeHit();
const tmpLoot = [];
const tmpCols = [];
const PREF_RANGE = { shotgun: 5, smg: 11, ar: 24, sniper: 70, pistol: 14, rocket: 30 };

export class Bot {
  constructor(match, ch, diff, rng, persona = null) {
    this.m = match;
    this.ch = ch;
    this.rng = rng;
    // personality (builder, sharpshooter, rusher...) tweaks the difficulty skills + behaviour weights
    const pa = assignPersona(diff, rng, persona);
    this.d = diff = pa.diff;
    this.p = pa.traits;
    ch.persona = pa.persona;
    ch.fireMul = diff.fireMul;
    ch.spreadMul = diff.spreadMul;
    ch.aimPoint = null;
    this.state = 'bus';
    this.stateT = 0;
    this.thinkT = rng.range(0, 0.3);
    this.percT = rng.range(0, 0.2);
    this.path = null; this.pathIdx = 0; this.goal = null; this.pathReq = null; this.pathFailT = 0;
    this.chain = null; this.chainIdx = 0; this.exitChain = null;
    this.target = null; this.seenT = -99; this.lastKnown = { x: 0, y: 0, z: 0 }; this.reactT = 0; this.acquiredT = 0;
    this.heard = null;
    this.lootTarget = null; this.lootGiveUpT = 0; this.ignoreLoot = new Set();
    this.gatherTarget = null;
    this.aimErrY = 0; this.aimErrP = 0; this.errT = 0;
    this.strafeDir = 1; this.strafeT = 0;
    this.burstT = 0; this.pauseLen = 0.2;
    this.grenadeCd = rng.range(2, 8); this.inCover = false; this.lastVel = { x: 0, z: 0 };
    this.stuckT = 0; this.stuckCheck = { x: 0, z: 0, t: 0 }; this.stuckLevel = 0; this.idleT = 0;
    this.pathFails = 0; this.vertT = 0; this.exposedT = 0; this.nadeT = 0; this.badCover = null;
    this.ignoreCols = new Set();
    this.buildCd = 0; this.jumpCd = 0;
    this.healDone = 0;
    this.rotateGoal = null; this.rotatePhase = -1;
    this.wanderGoal = null;
    this.lastDamageFrom = null;
    this.planDrop();
    const ev = match.events;
    ev.on('shot', (e) => this.hear(e.ch, e.x, e.z, 170 * diff.hearing, 'shot'));
    ev.on('footstep', (e) => { if (e.loud) this.hear(e.ch, e.ch.pos.x, e.ch.pos.z, 22 * diff.hearing, 'step'); });
    ev.on('built', (e) => { if (e.owner) this.hear(e.owner, e.x, e.z, 45 * diff.hearing, 'build'); });
    ev.on('swing', (e) => this.hear(e.ch, e.ch.pos.x, e.ch.pos.z, 28 * diff.hearing, 'swing'));
    ev.on('damage', (e) => { if (e.target === ch && e.attacker && e.attacker !== ch) this.onDamaged(e.attacker); });
  }

  planDrop() {
    // Landing spot first, jump time second: pick a random destination anywhere within glide reach of
    // the bus route (named POIs, small sites, lone buildings or open land), avoiding spots other bots
    // already picked, then jump when the bus passes closest to it. Spreads the lobby over the island.
    const m = this.m, bus = m.bus, rng = this.rng, w = m.world;
    const REACH = 240;
    const crowd = m.dropCrowd || (m.dropCrowd = new Map());
    const routeDist = (x, z) => {
      const k = bus.timeClosestTo(x, z) / bus.duration;
      return Math.hypot(bus.start.x + (bus.end.x - bus.start.x) * k - x, bus.start.z + (bus.end.z - bus.start.z) * k - z);
    };
    let tx = 0, tz = 0, key = null, found = false;
    for (let tries = 0; tries < 40 && !found; tries++) {
      const kind = rng.weighted([0.34, 0.24, 0.24, 0.18]);
      let r = 0;
      if (kind === 0 && w.pois.length) { const p = rng.pick(w.pois); key = 'poi:' + p.name; tx = p.x; tz = p.z; r = p.r * 0.7; }
      else if (kind === 1 && w.sites.length) { const p = rng.pick(w.sites); key = 'site:' + p.x + ',' + p.z; tx = p.x; tz = p.z; r = 8; }
      else if (kind === 2 && w.buildings.length) { const b = rng.pick(w.buildings); key = 'b:' + b.minX + ',' + b.minZ; tx = (b.minX + b.maxX) / 2; tz = (b.minZ + b.maxZ) / 2; r = 3; }
      else { const k = rng.range(0.08, 0.95); tx = bus.start.x + (bus.end.x - bus.start.x) * k + rng.range(-1, 1) * REACH * 0.9; tz = bus.start.z + (bus.end.z - bus.start.z) * k + rng.range(-1, 1) * REACH * 0.9; key = 'land:' + Math.round(tx / 60) + ',' + Math.round(tz / 60); }
      const a = rng.range(0, Math.PI * 2), rr = Math.sqrt(rng.next()) * r;
      tx += Math.cos(a) * rr; tz += Math.sin(a) * rr;
      if (!w.hm.isLand(tx, tz) || Math.abs(tx) > HALF * 0.95 || Math.abs(tz) > HALF * 0.95) continue;
      if (routeDist(tx, tz) > REACH) continue;
      // crowded spots are picked less often (big POIs tolerate a few more players)
      const n = crowd.get(key) || 0;
      const cap = key.startsWith('poi:') ? 0.35 : 0.9;
      if (n > 0 && !rng.chance(1 / (1 + n * cap))) continue;
      found = true;
    }
    if (!found) {
      // fallback: open land beside a random point of the route
      for (let i = 0; i < 30; i++) {
        const k = rng.range(0.1, 0.9);
        tx = bus.start.x + (bus.end.x - bus.start.x) * k + rng.range(-150, 150);
        tz = bus.start.z + (bus.end.z - bus.start.z) * k + rng.range(-150, 150);
        if (w.hm.isLand(tx, tz)) break;
      }
      key = 'fallback';
    }
    crowd.set(key, (crowd.get(key) || 0) + 1);
    this.dropTarget = { x: tx, z: tz };
    // jump around the closest point of the route (a little earlier for far-away targets), never all at once
    const tc = bus.timeClosestTo(tx, tz);
    this.jumpAt = clamp(tc - (routeDist(tx, tz) / REACH) * rng.range(0, 3) + rng.range(-2.5, 2.5), bus.doorsOpenAt + 0.4 + rng.range(0, 1.5), bus.duration - 1);
  }

  hear(src, x, z, radius, kind) {
    const ch = this.ch;
    if (!ch.alive || src === ch || ch.mode !== 'ground') return;
    const d = Math.hypot(x - ch.pos.x, z - ch.pos.z);
    if (d > radius) return;
    const err = d * 0.08;
    this.heard = { x: x + this.rng.range(-err, err), z: z + this.rng.range(-err, err), t: this.m.time, src, kind };
  }

  onDamaged(attacker) {
    this.lastDamageFrom = attacker;
    this.lastDamageT = this.m.time;
    const err = Math.hypot(attacker.pos.x - this.ch.pos.x, attacker.pos.z - this.ch.pos.z) * 0.05;
    this.heard = { x: attacker.pos.x + this.rng.range(-err, err), z: attacker.pos.z + this.rng.range(-err, err), t: this.m.time, src: attacker, kind: 'hit' };
    if (!this.target || !this.canSeeRecently()) {
      this.target = attacker;
      this.lastKnown.x = this.heard.x; this.lastKnown.y = attacker.pos.y; this.lastKnown.z = this.heard.z;
      this.seenT = Math.max(this.seenT, this.m.time - this.d.memory * 0.5);
    }
  }

  canSeeRecently() { return this.target && this.m.time - this.seenT < 0.6; }

  // ------------------------------------------------------------------
  update(dt, focus) {
    const ch = this.ch, m = this.m;
    const it = ch.intent;
    if (!ch.alive) { this.state = 'dead'; it.mx = it.mz = 0; it.fire = false; return; }
    const t0 = performance.now();
    this.stateT += dt;
    if (ch.mode === 'bus') { this.state = 'bus'; if (m.bus.t >= this.jumpAt) m.eject(ch); return; }
    if (ch.mode === 'freefall' || ch.mode === 'glide') { this.state = 'drop'; this.steerDrop(); return; }
    // LOD: think rate depends on distance to the focus character
    const dFocus = focus ? Math.hypot(focus.pos.x - ch.pos.x, focus.pos.z - ch.pos.z) : 0;
    // big lobbies (up to 100 players): far-away bots think a bit less often to keep the frame budget
    const crowd = m.bots.length > 60 ? 1.4 : 1;
    const interval = dFocus < 90 ? 0.08 : dFocus < 260 ? 0.22 * crowd : 0.45 * crowd;
    this.buildCd -= dt; this.jumpCd -= dt; this.grenadeCd -= dt;
    this.percT -= dt;
    if (this.percT <= 0) { this.percT = interval; this.perceive(); }
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = interval * 1.5; this.decide(); }
    it.mx = 0; it.mz = 0; it.fire = false; it.firePressed = false; it.aim = false; it.jump = false; it.crouch = false; it.sprint = false; it.reload = false;
    autoPickup(m, ch);
    if (this.breakT > 0) {
      const c = this.breakTarget;
      this.breakT -= dt;
      if (c && c.alive) {
        ch.inv.sel = 0;
        const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
        ch.yaw = approachAngle(ch.yaw, yawTo(cx - ch.pos.x, cz - ch.pos.z), 8 * dt);
        ch.pitch = 0;
        it.fire = true;
        return;
      }
      this.breakT = 0;
    }
    switch (this.state) {
      case 'loot': this.doLoot(dt); break;
      case 'gather': this.doGather(dt); break;
      case 'rotate': this.doRotate(dt); break;
      case 'fight': this.doFight(dt); break;
      case 'hunt': this.doHunt(dt); break;
      case 'heal': this.doHeal(dt); break;
      case 'retreat': this.doRetreat(dt); break;
      default: this.doWander(dt);
    }
    this.checkStuck(dt);
    m.botMs = (m.botMs || 0) * 0.98 + (performance.now() - t0) * 0.02 * m.bots.length;
  }

  steerDrop() {
    const ch = this.ch, it = ch.intent, t = this.dropTarget;
    const dx = t.x - ch.pos.x, dz = t.z - ch.pos.z;
    const d = Math.hypot(dx, dz);
    ch.yaw = approachAngle(ch.yaw, yawTo(dx, dz), 3 * 0.016);
    ch.pitch = -0.4;
    const alt = ch.pos.y - Math.max(0, this.m.world.hm.height(ch.pos.x, ch.pos.z));
    if (d > 6) { it.mx = dx / d; it.mz = dz / d; } else { it.mx = it.mz = 0; }
    it.dive = ch.mode === 'freefall' ? d < alt * 0.9 : d > 60;
    it.slow = ch.mode === 'glide' && d < 25;
    it.jump = ch.mode === 'freefall' && alt < AUTO_GLIDE_ALT + 40 && d > alt * 1.4;
    it.fire = false;
  }

  // ---------------- perception ----------------
  perceive() {
    const ch = this.ch, m = this.m, d = this.d;
    const fx = yawDirX(ch.yaw), fz = yawDirZ(ch.yaw);
    const cosFov = Math.cos(110 * Math.PI / 360);
    const ex = ch.pos.x, ey = ch.eyeY, ez = ch.pos.z;
    const cands = [];
    for (const o of m.chars) {
      if (o === ch || !o.alive || !o.hittable || o.mode === 'bus') continue;
      const dx = o.pos.x - ex, dz = o.pos.z - ez;
      const d2 = dx * dx + dz * dz;
      let range = d.viewDist * (o.crouching ? 0.7 : 1) * (o.mode === 'glide' || o.mode === 'freefall' ? 1.5 : 1);
      if (d2 > range * range) continue;
      const dist = Math.sqrt(d2);
      const facing = (dx * fx + dz * fz) / Math.max(0.01, dist);
      if (facing < cosFov && dist > 4 && !(o === this.target && dist < 25)) continue;
      cands.push([dist, o]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    let seen = null;
    let checks = 0;
    for (const [, o] of cands) {
      if (checks++ >= 3) break;
      const ty = o.pos.y + o.height * 0.6;
      if (m.physics.lineOfSight(ex, ey, ez, o.pos.x, ty, o.pos.z) || m.physics.lineOfSight(ex, ey, ez, o.pos.x, o.pos.y + o.height - 0.2, o.pos.z)) { seen = o; break; }
    }
    if (this.target && this.target.alive && this.target !== seen && this.canSeeRecently()) {
      // keep tracking the current target if still visible
      const o = this.target;
      const dd = Math.hypot(o.pos.x - ex, o.pos.z - ez);
      if (dd < d.viewDist * 1.2 && m.physics.lineOfSight(ex, ey, ez, o.pos.x, o.pos.y + o.height * 0.6, o.pos.z)) seen = o;
    }
    if (seen && seen !== this.target && seen !== this.lastDamageFrom) {
      // decide whether this new contact is worth a fight (players often avoid fights while looting)
      const ig = this.ignored || (this.ignored = new Map());
      const until = ig.get(seen);
      const close = Math.hypot(seen.pos.x - ex, seen.pos.z - ez) < 7 + (d.engage || 0) * 30; // skilled bots never let someone walk up on them
      if (until === undefined || (until > 0 && m.time > until)) {
        const weapons = ch.inv.weapons().length;
        const p = clamp(d.aggression * (0.45 + weapons * 0.2) + (m.time > 360 ? 0.3 : 0) + this.p.engageBonus + (d.engage || 0), 0.05, 0.97);
        if (!close && !this.rng.chance(p)) { ig.set(seen, m.time + 15); seen = null; }
        else ig.set(seen, -1); // engaged
      } else if (until > 0 && !close) seen = null;
    }
    if (seen) {
      if (seen !== this.target || m.time - this.seenT > 1.5) {
        this.reactT = m.time + d.reaction * this.rng.range(0.8, 1.3);
        this.acquiredT = m.time;
      }
      this.target = seen;
      this.seenT = m.time;
      this.lastKnown.x = seen.pos.x; this.lastKnown.y = seen.pos.y; this.lastKnown.z = seen.pos.z;
      this.lastVel.x = seen.vel.x; this.lastVel.z = seen.vel.z;
    } else if (this.target && (!this.target.alive || m.time - this.seenT > d.memory)) {
      this.target = null;
    }
  }

  // ---------------- decisions ----------------
  hasUsableGun() {
    const inv = this.ch.inv;
    return inv.slots.some((s) => s && s.kind === 'weapon' && (s.mag > 0 || inv.ammo[WEAPONS[s.type].ammo] > 0));
  }
  healSlot() {
    const ch = this.ch, inv = ch.inv;
    let best = -1, bestV = 0;
    for (let i = 0; i < 5; i++) {
      const s = inv.slots[i];
      if (!s || s.kind !== 'consumable') continue;
      const def = CONSUMABLES[s.type];
      if (def.throwable || !canUseConsumable(ch, def)) continue;
      let v = def.heal ? (100 - ch.health) / 100 : (100 - ch.shield) / 100 * 0.9;
      if (s.type === 'medkit' && ch.health > 60) v *= 0.3;
      if (s.type === 'bandage' && ch.health >= 75) v = 0;
      if (v > bestV) { bestV = v; best = i; }
    }
    return bestV > 0.15 ? best : -1;
  }

  decide() {
    const ch = this.ch, m = this.m, d = this.d, st = m.storm;
    const hp = ch.health + ch.shield;
    const gun = this.hasUsableGun();
    const visible = this.canSeeRecently();
    const known = this.target && this.target.alive && m.time - this.seenT < d.memory;
    const tdist = known ? Math.hypot(this.target.pos.x - ch.pos.x, this.target.pos.z - ch.pos.z) : 999;
    const scores = {};
    // storm
    let storm = 0;
    if (m.phase !== 'bus' || st.timer < 30) {
      if (!st.isInside(ch.pos.x, ch.pos.z, 2)) storm = 0.95 + (st.phase > 2 ? 0.1 : 0);
      else if (!st.insideNext(ch.pos.x, ch.pos.z, 8)) {
        const need = Math.hypot(st.next.x - ch.pos.x, st.next.z - ch.pos.z) - st.next.r * 0.7;
        const time = Math.max(1, st.timeUntilClosed() - 12 - this.p.stormEarly);
        storm = clamp(need / (time * 6.5), 0, 1) * 1.05;
        if (st.state === 'shrink') storm = Math.max(storm, 0.55);
      }
    }
    scores.rotate = storm;
    scores.fight = known ? (gun ? 0.5 + d.aggression * 0.4 : (tdist < 5 ? 0.6 : 0.05)) * (hp < 50 ? 0.65 : 1) * (tdist > 110 && !visible ? 0.5 : 1) : 0;
    if (known && !visible) scores.hunt = scores.fight * 0.85, scores.fight *= 0.4;
    const hs = this.healSlot();
    scores.heal = hs >= 0 && hp < 150 ? (visible && tdist < 30 ? 0.35 : 0.72) * (1 - hp / 200) * 1.6 * this.p.healBias : 0;
    // loot need
    const weapons = ch.inv.weapons();
    let need = weapons.length === 0 ? 0.85 : weapons.length === 1 ? 0.55 : 0.32;
    if (!gun && weapons.length) need = 0.75;
    // under-equipped bots that aren't being shot at prefer to keep looting
    if (weapons.length < 2 && m.time - (this.lastDamageT || -99) > 5 && tdist > 30) { const e = d.engage || 0; scores.fight *= 0.7 + 0.3 * e; if (scores.hunt) scores.hunt *= 0.6 + 0.4 * e; }
    need *= (0.6 + d.lootSmart * 0.4) * this.p.lootBias;
    if (this.lootTarget && !this.lootValid(this.lootTarget)) this.lootTarget = null;
    if (!this.lootTarget && need > 0.2 && m.time > this.lootGiveUpT && m.time > (this.lootSearchT || 0)) {
      this.lootTarget = this.findLoot();
      // nothing worth taking around: don't rescan every think tick (a scan touches every chest + nearby item)
      if (!this.lootTarget) this.lootSearchT = m.time + this.rng.range(2, 3.5);
    }
    if (m.time < 200 && weapons.length < 3 && m.time - (this.lastDamageT || -99) > 5) need *= 1.3;
    scores.loot = this.lootTarget ? need : 0;
    const matsTotal = ch.inv.mats.wood + ch.inv.mats.brick + ch.inv.mats.metal;
    const mg = this.p.matsGoal;
    scores.gather = matsTotal < (150 * d.lootSmart + 30) * mg ? 0.3 : matsTotal < 300 * mg ? 0.12 : 0;
    const recentlyHit = m.time - (this.lastDamageT || -99) < 4;
    if (known && tdist > 70 && !recentlyHit) { scores.fight *= 0.55; if (scores.hunt) scores.hunt *= 0.5; }
    const heardD = this.heard ? Math.hypot(this.heard.x - ch.pos.x, this.heard.z - ch.pos.z) : 999;
    scores.investigate = this.heard && m.time - this.heard.t < 8 && gun && heardD < 110 ? 0.38 * d.aggression * (m.time < 200 ? 0.5 : 1) : 0;
    // losing the fight with nothing to heal: break line of sight and reset
    const hasHeal = hs >= 0;
    const R = this.p.retreatHp;
    scores.retreat = visible && gun && tdist < 45 && hp < R && (!hasHeal || tdist < 25) ? 0.6 + (R - hp) / 100 : 0;
    if (this.inCover && this.state === 'retreat' && hp < R + 20 && this.stateT < 10) scores.retreat = Math.max(scores.retreat, 0.55);
    scores.wander = 0.15;
    // hysteresis
    const cur = this.state === 'hunt' && !scores.hunt ? 'fight' : this.state;
    if (scores[cur] !== undefined) scores[cur] += 0.08;
    let best = 'wander', bv = -1;
    for (const k in scores) if (scores[k] > bv) { bv = scores[k]; best = k; }
    if (best === 'investigate') {
      best = 'hunt';
      if (!known && this.heard) { this.lastKnown.x = this.heard.x; this.lastKnown.z = this.heard.z; this.lastKnown.y = ch.pos.y; this.investigating = true; }
    } else this.investigating = false;
    if (best !== this.state) this.setState(best);
  }

  setState(s) {
    const prev = this.state;
    this.state = s;
    this.stateT = 0;
    if (prev === 'heal' && this.ch.useT > 0) this.ch.useT = 0;
    if (s !== 'retreat' && s !== 'fight') this.inCover = false;
    if (s === 'retreat') this.m.aiStats.retreats++;
    if (s !== 'loot' && s !== 'gather') { /* keep path if goal similar */ }
    this.goal = null;
    this.path = null;
    if (s === 'gather') this.gatherTarget = null;
  }

  // ---------------- navigation ----------------
  /** Move toward (x,z) using the nav grid. Returns distance remaining. */
  navTo(x, z, y = null, sprint = true, chain = null) {
    const ch = this.ch;
    const d = Math.hypot(x - ch.pos.x, z - ch.pos.z);
    // indoor chain (upper floors): first leave current elevated area if needed, then follow chain
    if (chain && chain !== this.chain) { this.chain = chain; this.chainIdx = -1; }
    if (!chain && this.chain) {
      // we were inside on a chain; walk it backwards to exit if still elevated
      const elev = ch.pos.y - this.m.world.hm.height(ch.pos.x, ch.pos.z) > 1.5;
      if (elev) { this.exitChain = this.chain.slice().reverse(); this.chain = null; this.exitIdx = 0; }
      else this.chain = null;
    }
    if (this.exitChain) {
      const p = this.exitChain[this.exitIdx];
      if (!p) { this.exitChain = null; }
      else {
        if (Math.hypot(p.x - ch.pos.x, p.z - ch.pos.z) < 1.0 && Math.abs(p.y - ch.pos.y) < 2.2) this.exitIdx++;
        this.seek(p.x, p.z, false);
        return d;
      }
    }
    if (this.chain) {
      if (this.chainIdx === -1) {
        // navigate on ground to the first chain point
        const p0 = this.chain[0];
        if (Math.hypot(p0.x - ch.pos.x, p0.z - ch.pos.z) < 1.4) this.chainIdx = 1;
        else { this.followPath(p0.x, p0.z, sprint); return d; }
      }
      const p = this.chain[this.chainIdx];
      if (!p) { this.seek(x, z, false); return d; }
      if (Math.hypot(p.x - ch.pos.x, p.z - ch.pos.z) < 0.9 && Math.abs(p.y - ch.pos.y) < 1.6) this.chainIdx++;
      this.seek(p.x, p.z, false);
      return d;
    }
    this.followPath(x, z, sprint);
    return d;
  }

  followPath(x, z, sprint) {
    const ch = this.ch, m = this.m;
    const goalMoved = !this.goal || Math.hypot(this.goal.x - x, this.goal.z - z) > 4;
    if (goalMoved) {
      this.goal = { x, z };
      this.path = null;
      // short, clear hop: walk straight
      if (Math.hypot(x - ch.pos.x, z - ch.pos.z) < 10 && m.nav.clearLine(m.nav.idx(ch.pos.x, ch.pos.z), m.nav.idx(x, z))) {
        this.path = { points: [{ x, z }], complete: true };
        this.pathIdx = 0;
      } else { m.navigator.request(this, x, z); this.pathFails = 0; }
    }
    if (!this.path) {
      // waiting for the path finder, or the last search failed: walk straight at the goal meanwhile
      // (the stuck handler deals with walls) and ask again with a back-off instead of freezing
      if (!this.pathReq && m.time - this.pathFailT > 1.5 + this.pathFails) m.navigator.request(this, x, z);
      this.seek(x, z, sprint);
      return;
    }
    const pts = this.path.points;
    let p = pts[this.pathIdx];
    while (p && Math.hypot(p.x - ch.pos.x, p.z - ch.pos.z) < 1.3) { this.pathIdx++; p = pts[this.pathIdx]; }
    if (!p) {
      if (!this.path.complete && Math.hypot(x - ch.pos.x, z - ch.pos.z) > 3) { this.path = null; m.navigator.request(this, x, z); }
      else this.seek(x, z, sprint);
      return;
    }
    this.seek(p.x, p.z, sprint);
  }

  onPath(res, req) {
    if (!res || !res.points.length) {
      this.pathFailT = this.m.time; this.path = null;
      if (++this.pathFails >= 3) this.abandonGoal();   // unreachable: pick something else to do
      return;
    }
    this.pathFails = 0;
    this.path = res;
    // the bot kept walking while the search ran: continue from the closest of the first points
    const ch = this.ch;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < Math.min(4, res.points.length); i++) {
      const p = res.points[i], dd = Math.hypot(p.x - ch.pos.x, p.z - ch.pos.z);
      if (dd < bd) { bd = dd; bi = i; }
    }
    this.pathIdx = bi;
  }

  /** Drop the current objective (unreachable loot, blocked rotate spot...) and re-plan. */
  abandonGoal() {
    const m = this.m;
    if (this.state === 'loot' && this.lootTarget) this.giveUpLoot(this.lootTarget);
    else if (this.state === 'gather' && this.gatherTarget) { this.ignoreCols.add(this.gatherTarget); this.gatherTarget = null; }
    else if (this.state === 'rotate') this.rotateGoal = null;
    else if (this.state === 'hunt') { this.target = null; this.heard = null; }
    this.wanderGoal = null;
    this.path = null; this.goal = null; this.chain = null; this.exitChain = null; this.pathFails = 0;
    m.navigator.cancel(this);
    this.thinkT = 0;
    m.aiStats.unstuck = (m.aiStats.unstuck || 0) + 1;
  }

  seek(x, z, sprint, faceMove = true) {
    const ch = this.ch, it = ch.intent;
    let dx = x - ch.pos.x, dz = z - ch.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    dx /= d; dz /= d;
    // separation from nearby characters
    for (const o of this.m.chars) {
      if (o === ch || !o.alive || o.mode !== 'ground') continue;
      const ox = ch.pos.x - o.pos.x, oz = ch.pos.z - o.pos.z;
      const od = ox * ox + oz * oz;
      if (od < 2.2 && od > 1e-4) { const k = (1.5 - Math.sqrt(od)) * 0.8; dx += ox / Math.sqrt(od) * k; dz += oz / Math.sqrt(od) * k; }
    }
    const l = Math.hypot(dx, dz) || 1;
    it.mx = dx / l; it.mz = dz / l;
    it.sprint = sprint;
    if (faceMove) ch.yaw = approachAngle(ch.yaw, yawTo(it.mx, it.mz), 7 * 0.016);
    if (ch.blocked && ch.grounded && this.jumpCd <= 0) { it.jump = true; this.jumpCd = 0.7; }
  }

  checkStuck(dt) {
    const ch = this.ch, it = ch.intent, s = this.stuckCheck;
    const wants = Math.hypot(it.mx, it.mz) > 0.3;
    s.t += dt;
    if (s.t < 1.6) return;
    const moved = Math.hypot(ch.pos.x - s.x, ch.pos.z - s.z);
    s.x = ch.pos.x; s.z = ch.pos.z; s.t = 0;
    // idle watchdog: standing still without a reason (not fighting, healing, harvesting, breaking,
    // hiding) for ~5 s means the current objective is broken -> drop it
    const busy = ch.useT > 0 || ch.reloadT > 0 || this.breakT > 0 || it.fire || this.state === 'fight' || this.state === 'heal' || (this.state === 'retreat' && this.inCover);
    if (moved < 0.8 && !busy && !wants) {
      this.idleT += 1.6;
      if (this.idleT >= 4.8) { this.idleT = 0; this.stuckLevel = 0; this.abandonGoal(); return; }
    } else this.idleT = 0;
    if (!wants || moved > 1.0 || ch.useT > 0) { this.stuckLevel = 0; this.escapes = 0; return; }
    this.stuckLevel++;
    const m = this.m;
    if (this.stuckLevel === 1) { it.jump = true; }
    else if (this.stuckLevel === 2) { this.path = null; this.goal = null; this.chain = null; this.exitChain = null; }
    else if (this.stuckLevel === 3) {
      // break whatever is in front
      m.physics.raycast(ch.pos.x, ch.pos.y + 1, ch.pos.z, yawDirX(ch.yaw), 0, yawDirZ(ch.yaw), 2.5, null, hit);
      if (hit.hit && hit.kind === 'collider' && hit.collider.owner && (hit.collider.owner.kind === 'build' || hit.collider.owner.breakable || hit.collider.owner.kind === 'tree')) {
        this.breakTarget = hit.collider; this.breakT = 2.5;
      }
    } else if (this.stuckLevel === 4) {
      const mat = m.build.bestMaterial(ch);
      if (mat && ch.grounded) m.build.rampToward(ch, yawDirX(ch.yaw), yawDirZ(ch.yaw), mat);
    } else {
      // still stuck after jumping, re-pathing, breaking and ramping: wedged between colliders or
      // trapped in a steep pit -> step back onto the nearest walkable nav cell
      const k = m.nav.idx(ch.pos.x, ch.pos.z);
      const trapped = !ch.grounded || ch.sliding || !m.nav.walkable(k) || this.escapes > 0;
      this.escapes = (this.escapes || 0) + 1;
      if (trapped) {
        const w = m.nav.nearestWalkable(k, 6);
        if (w >= 0 && w !== k) {
          ch.pos.x = m.nav.cx(w); ch.pos.z = m.nav.cz(w);
          ch.pos.y = Math.max(m.world.hm.height(ch.pos.x, ch.pos.z), 0) + 0.05;
          ch.vel.x = ch.vel.y = ch.vel.z = 0; ch.grounded = false;
          ch.savePrev();
        }
      }
      this.abandonGoal();
      this.wanderGoal = { x: ch.pos.x + this.rng.range(-15, 15), z: ch.pos.z + this.rng.range(-15, 15) };
      this.setState('wander');
      this.stuckLevel = 0;
    }
  }

  // ---------------- behaviours ----------------
  lootValid(t) {
    if (t.kind === 'chest') return t.ref.alive && !t.ref.opened && (!t.ref.claimedBy || t.ref.claimedBy === this);
    return t.ref.alive;
  }

  /** itemScore plus this bot's personal taste (a sharpshooter loves snipers, a rusher shotguns). */
  score(item) {
    if (!item) return 0;
    let s = itemScore(item);
    if (item.kind === 'weapon') s += (this.p.weaponPref[item.type] || 0) * 0.6;
    else if (item.type === 'grenade' && this.p.fightGrenades) s += 2;
    return s;
  }

  wantItem(item) {
    const inv = this.ch.inv;
    if (item.kind === 'weapon') {
      const sc = this.score(item);
      const weapons = inv.weapons();
      if (weapons.some((w) => w.type === item.type && w.rarity >= item.rarity)) return false;
      if (inv.firstEmpty() >= 0) return weapons.length < 3 || sc > Math.min(...weapons.map((w) => this.score(w)));
      let worst = Infinity;
      for (const s of inv.slots) worst = Math.min(worst, this.score(s));
      return sc > worst + 1;
    }
    if (item.kind === 'consumable') {
      const def = CONSUMABLES[item.type];
      if (inv.slots.some((s) => s && s.kind === 'consumable' && s.type === item.type && s.count < def.stack)) return true;
      return inv.firstEmpty() >= 0 && inv.weapons().length >= 1;
    }
    return false;
  }

  findLoot() {
    // unarmed bots search much further (they need a gun more than anything)
    return this.findLootIn(45) || (this.ch.inv.weapons().length === 0 ? this.findLootIn(150) : null);
  }

  findLootIn(R) {
    const ch = this.ch, m = this.m;
    let best = null, bestS = 0;
    for (const c of m.world.loot.chests) {
      if (!c.alive || c.opened || (c.claimedBy && c.claimedBy !== this && c.claimedBy.ch.alive)) continue;
      const d = Math.hypot(c.x - ch.pos.x, c.z - ch.pos.z) + Math.abs(c.y - ch.pos.y) * 2;
      if (d > R * 1.3) continue;
      if (!c.chain && Math.abs(c.y - ch.pos.y) > 1.6 && c.y - m.world.hm.height(c.x, c.z) > 1.8) continue; // upper floor, no known way up
      const s = (c.kind === 'chest' ? 2.2 : 0.8) / (1 + d / 12);
      if (s > bestS) { bestS = s; best = { kind: 'chest', ref: c, chain: c.chain }; }
    }
    const list = m.world.loot.query(ch.pos.x, ch.pos.z, R, tmpLoot);
    for (const itm of list) {
      if (!itm.resting || this.ignoreLoot.has(itm.id)) continue;
      const k = itm.item.kind;
      if (k === 'ammo' || k === 'material') {
        const d = Math.hypot(itm.x - ch.pos.x, itm.z - ch.pos.z);
        const s = 0.35 / (1 + d / 10);
        if (s > bestS && Math.abs(itm.y - ch.pos.y) < 2) { bestS = s; best = { kind: 'item', ref: itm, chain: null }; }
        continue;
      }
      if (!this.wantItem(itm.item)) continue;
      const d = Math.hypot(itm.x - ch.pos.x, itm.z - ch.pos.z) + Math.abs(itm.y - ch.pos.y) * 2;
      const s = this.score(itm.item) * 0.2 / (1 + d / 12);
      if (s <= bestS) continue;
      const chain = this.chainFor(itm);
      if (!chain && Math.abs(itm.y - ch.pos.y) > 1.6) continue; // on another floor with no known way there
      bestS = s; best = { kind: 'item', ref: itm, chain };
    }
    if (best && best.kind === 'chest') best.ref.claimedBy = this;
    if (best) best.t0 = m.time;
    return best;
  }

  /** Find a building waypoint chain for an item lying on an upper floor. */
  chainFor(itm) {
    const ground = this.m.world.hm.height(itm.x, itm.z);
    if (itm.y - ground < 1.8) return null;
    let best = null, bd = 6;
    for (const s of this.m.world.lootSpots.concat(this.m.world.chestSpots)) {
      if (!s.chain) continue;
      const d = Math.hypot(s.x - itm.x, s.z - itm.z) + Math.abs(s.y - itm.y) * 3;
      if (d < bd) { bd = d; best = s.chain; }
    }
    return best;
  }

  doLoot(dt) {
    const ch = this.ch, m = this.m, t = this.lootTarget;
    if (!t || !this.lootValid(t)) { this.lootTarget = null; this.thinkT = 0; this.doWander(dt); return; }
    const r = t.ref;
    const dx = r.x - ch.pos.x, dz = r.z - ch.pos.z, dy = r.y - ch.pos.y;
    const d = Math.hypot(dx, dz);
    if (m.time - t.t0 > 25) { this.giveUpLoot(t); return; }
    // standing right under / above the item with no route between floors: give up quickly
    const climbing = (this.chain && this.chainIdx >= 0 && this.chainIdx < this.chain.length) || this.exitChain;
    if (d < 2.2 && Math.abs(dy) >= 1.6 && !climbing) {
      this.vertT += dt;
      if (this.vertT > 1.5) { this.vertT = 0; this.giveUpLoot(t); this.thinkT = 0; return; }
    } else this.vertT = 0;
    if (d < 1.7 && Math.abs(dy) < 1.6) {
      if (t.kind === 'chest') { openChest(m, ch, r); this.lootTarget = null; this.thinkT = 0.4; return; }
      const item = r.item;
      if (item.kind === 'weapon' && ch.inv.firstEmpty() < 0) {
        // select the worst slot so the pickup swaps it out
        let wi = 0, ws = Infinity;
        ch.inv.slots.forEach((s, i) => { const v = this.score(s); if (v < ws) { ws = v; wi = i; } });
        ch.inv.sel = wi + 1;
      }
      if (!tryPickup(m, ch, r)) this.ignoreLoot.add(r.id);
      this.lootTarget = null;
      this.thinkT = 0;
      this.equipBest(30);
      return;
    }
    this.navTo(r.x, r.z, r.y, d > 12, t.chain);
  }

  giveUpLoot(t) {
    if (t.kind === 'chest') t.ref.claimedBy = null; else this.ignoreLoot.add(t.ref.id);
    this.lootTarget = null;
    this.lootGiveUpT = this.m.time + 3;
  }

  doGather(dt) {
    const ch = this.ch, m = this.m;
    let g = this.gatherTarget;
    if (!g || !g.alive) {
      const list = m.physics.hash.query(ch.pos.x - 35, ch.pos.z - 35, ch.pos.x + 35, ch.pos.z + 35, tmpCols);
      let best = null, bd = Infinity;
      for (const c of list) {
        const o = c.owner;
        if (!o || this.ignoreCols.has(c) || (o.kind !== 'tree' && o.kind !== 'rock' && !(o.kind === 'struct' && o.breakable && o.mat === 'wood' && c.maxY - c.minY > 1.5))) continue;
        const d = Math.hypot((c.minX + c.maxX) / 2 - ch.pos.x, (c.minZ + c.maxZ) / 2 - ch.pos.z);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best) { this.setState('wander'); return; }
      g = this.gatherTarget = best;
    }
    const cx = (g.minX + g.maxX) / 2, cz = (g.minZ + g.maxZ) / 2;
    const half = Math.max(g.maxX - g.minX, g.maxZ - g.minZ) / 2;
    const d = Math.hypot(cx - ch.pos.x, cz - ch.pos.z);
    if (d > half + 1.6) { this.navTo(cx, cz, null, false); return; }
    ch.inv.sel = 0;
    ch.yaw = approachAngle(ch.yaw, yawTo(cx - ch.pos.x, cz - ch.pos.z), 8 * 0.016);
    const ty = Math.min(g.maxY - 0.3, ch.pos.y + 1.2);
    ch.pitch = Math.atan2(ty - ch.eyeY, Math.max(0.5, d - half));
    ch.intent.fire = true;
    if (this.stateT > 25) this.setState('wander');
  }

  rotateTarget() {
    const st = this.m.storm, rng = this.rng;
    if (this.rotatePhase !== st.phase || !this.rotateGoal) {
      this.rotatePhase = st.phase;
      for (let i = 0; i < 12; i++) {
        const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * st.next.r * 0.6;
        const x = st.next.x + Math.cos(a) * r, z = st.next.z + Math.sin(a) * r;
        this.rotateGoal = { x, z };
        if (this.m.world.hm.isLand(x, z) && this.m.nav.walkableAt(x, z)) break;
      }
    }
    return this.rotateGoal;
  }

  doRotate(dt) {
    const g = this.rotateTarget();
    const d = this.navTo(g.x, g.z, null, true);
    if (d < 6) this.thinkT = 0;
    if (d < 2.5) {
      // arrived but the storm logic still wants us to move: head closer to the zone centre
      const st = this.m.storm, r = st.next.r * 0.25 * this.rng.next();
      const a = this.rng.range(0, Math.PI * 2);
      this.rotateGoal = { x: st.next.x + Math.cos(a) * r, z: st.next.z + Math.sin(a) * r };
    }
    // shoot back while rotating if threatened
    if (this.canSeeRecently()) this.combatAim(dt, true);
  }

  doWander(dt) {
    const ch = this.ch, st = this.m.storm;
    if (!this.wanderGoal || Math.hypot(this.wanderGoal.x - ch.pos.x, this.wanderGoal.z - ch.pos.z) < 3 || this.stateT > 30) {
      // drift toward the safe zone, otherwise nearby POI/random
      const tx = st.next.x + (ch.pos.x - st.next.x) * 0.6, tz = st.next.z + (ch.pos.z - st.next.z) * 0.6;
      this.wanderGoal = { x: tx + this.rng.range(-40, 40), z: tz + this.rng.range(-40, 40) };
      if (!this.m.world.hm.isLand(this.wanderGoal.x, this.wanderGoal.z)) this.wanderGoal = { x: st.next.x, z: st.next.z };
      this.stateT = 0;
    }
    this.navTo(this.wanderGoal.x, this.wanderGoal.z, null, false);
  }

  equipBest(dist) {
    const ch = this.ch, inv = ch.inv;
    let best = -1, bs = -1;
    for (let i = 0; i < 5; i++) {
      const s = inv.slots[i];
      if (!s || s.kind !== 'weapon') continue;
      const def = WEAPONS[s.type];
      if (s.mag <= 0 && inv.ammo[def.ammo] <= 0) continue;
      let score = s.rarity * 0.6 + (s.mag > 0 ? 1 : 0);
      if (dist < 9) score += { shotgun: 6, smg: 5, ar: 3, pistol: 2.5, rocket: 0, sniper: 0.5 }[s.type];
      else if (dist < 40) score += { ar: 6, smg: 5, pistol: 3.5, shotgun: 1.5, rocket: 3, sniper: 2.5 }[s.type];
      else score += { sniper: 7, ar: 5.5, pistol: 2.5, smg: 2, rocket: 2, shotgun: 0 }[s.type];
      score += this.p.weaponPref[s.type] || 0;
      if (s.mag <= 0) score -= 2.5;
      if (score > bs) { bs = score; best = i; }
    }
    if (best >= 0 && inv.sel !== best + 1 && ch.reloadT <= 0) inv.sel = best + 1;
    return best >= 0;
  }

  /** Aim at the target with human-like error; fires when on target. */
  combatAim(dt, allowFire) {
    const ch = this.ch, m = this.m, d = this.d, t = this.target;
    if (!t || !t.alive) return;
    const dist = Math.hypot(t.pos.x - ch.pos.x, t.pos.z - ch.pos.z);
    this.errT -= dt;
    if (this.errT <= 0) {
      this.errT = this.rng.range(0.25, 0.6);
      const settle = 1 + Math.max(0, 2.0 - (m.time - this.acquiredT)) * 1.2 * (d.settle ?? 1);
      const lateral = Math.hypot(t.vel.x, t.vel.z) / 8;
      const e = d.aimError * settle * (1 + lateral * 0.7) * (t.mode !== 'ground' ? 1.3 : 1);
      this.aimErrY = gauss(this.rng) * e;
      this.aimErrP = gauss(this.rng) * e * 0.7;
      this.aimHead = this.rng.chance(d.headshot);
    }
    // predict where the target will be: projectile flight time (sniper/rocket) or a short
    // reaction horizon for hitscan, scaled by the bot's skill; compensate projectile drop
    const curW = ch.inv.current();
    const defW = curW && curW.kind === 'weapon' ? WEAPONS[curW.type] : null;
    const proj = defW && defW.projectile;
    const flight = proj ? dist / proj.speed : 0.07;
    const lead = d.lead ?? 0.5;
    const px = t.pos.x + t.vel.x * flight * lead, pz = t.pos.z + t.vel.z * flight * lead;
    const pyBase = t.pos.y + (t.mode !== 'ground' ? t.vel.y * flight * lead : 0);
    const ty = this.aimHead ? pyBase + t.height - 0.24 : pyBase + t.height * 0.55;
    const pdist = Math.hypot(px - ch.pos.x, pz - ch.pos.z);
    const desiredYaw = yawTo(px - ch.pos.x, pz - ch.pos.z);
    let desiredPitch = Math.atan2(ty - ch.eyeY, Math.max(0.3, pdist));
    if (proj && proj.gravity) desiredPitch += Math.atan2(0.5 * proj.gravity * flight * flight, Math.max(1, pdist)) * lead;
    const turn = d.turnSpeed * dt;
    ch.yaw = approachAngle(ch.yaw, desiredYaw + this.aimErrY, turn);
    ch.pitch = clamp(ch.pitch + clamp(desiredPitch + this.aimErrP - ch.pitch, -turn, turn), -1.4, 1.4);
    if (!allowFire || m.time < this.reactT || !this.canSeeRecently()) return;
    const cur = ch.inv.current();
    if (!cur || cur.kind !== 'weapon') return;
    const def = WEAPONS[cur.type];
    if (dist > def.range * 0.9) return;
    if (cur.type === 'shotgun' && dist > 20) return;
    if (cur.type === 'rocket' && dist < 7) return;
    // human-like trigger discipline: bursts with short pauses
    this.burstT -= dt;
    if (this.burstT <= -this.pauseLen) { this.burstT = this.rng.range(0.5, 1.2); this.pauseLen = this.rng.range(0.35, 0.9) * (2 - d.aggression) * (d.pauseMul ?? 1); }
    if (this.burstT < 0) return;
    const errAng = Math.abs(wrapAngle(desiredYaw - ch.yaw)) + Math.abs(desiredPitch - ch.pitch) * 0.7;
    const tol = Math.max(0.025, Math.atan2(0.7, dist)) + def.spread * 0.5;
    if (errAng < tol * 1.6) {
      if (proj && lead > 0.5 && ch.fireCd <= 0) m.aiStats.leads++;
      ch.intent.fire = true;
      ch.intent.firePressed = true;
      if (dist > 14 && (cur.type === 'ar' || cur.type === 'sniper' || cur.type === 'pistol') && this.rng.next() < d.ads) ch.intent.aim = true;
    }
  }

  doFight(dt) {
    const ch = this.ch, m = this.m, d = this.d, t = this.target;
    if (!t || !t.alive) { this.target = null; this.thinkT = 0; this.doWander(dt); return; }
    const dist = Math.hypot(t.pos.x - ch.pos.x, t.pos.z - ch.pos.z);
    const visible = this.canSeeRecently();
    if (!this.equipBest(dist)) { ch.inv.sel = 0; }
    if (!visible) { this.doHunt(dt); return; }
    let cur = ch.inv.current();
    // out of ammo in the magazine and nothing else loaded: reload behind cover
    const mat0 = m.build.bestMaterial(ch);
    const needReload = cur && cur.kind === 'weapon' && cur.mag === 0 && ch.inv.ammo[WEAPONS[cur.type].ammo] > 0;
    if ((needReload || ch.reloadT > 0) && dist < 60 && this.rng.next() < (d.cover ?? 0.5) + 0.4) {
      if (!mat0 || this.buildCd > 0) {
        if (this.takeCover(t)) ch.intent.reload = true;
        if (this.inCover) return;
      }
    } else this.inCover = false;
    // tactician: lob grenades into the fight, not only at hiding targets
    if (this.nadeT > 0) {
      this.nadeT -= dt;
      if (this.grenadeCd > 0) this.nadeT = 0;
      else if (this.throwGrenadeAt(t.pos.x, t.pos.y + 0.5, t.pos.z, dt)) return;
    } else if (this.p.fightGrenades && this.grenadeCd <= 0 && dist > 8 && dist < 28 && this.grenadeSlot() >= 0 && this.rng.next() < this.p.fightGrenades * dt) this.nadeT = 1.5;
    this.combatAim(dt, true);
    cur = ch.inv.current();
    const pref = cur && cur.kind === 'weapon' ? PREF_RANGE[cur.type] * this.p.rangeMul : 2;
    // movement: approach / keep range / strafe
    const tx = t.pos.x - ch.pos.x, tz = t.pos.z - ch.pos.z;
    const ux = tx / Math.max(0.01, dist), uz = tz / Math.max(0.01, dist);
    let mx = 0, mz = 0;
    if (dist > pref * 1.4) { mx += ux; mz += uz; }
    else if (dist < pref * 0.6) { mx -= ux * 0.8; mz -= uz * 0.8; }
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeT = this.rng.range(0.4, 1.4); this.strafeDir = this.rng.chance(0.5) ? 1 : -1; if (this.rng.next() < d.strafe * 0.3) this.strafeDir = 0; }
    mx += -uz * this.strafeDir * d.strafe; mz += ux * this.strafeDir * d.strafe;
    const l = Math.hypot(mx, mz);
    const it = ch.intent;
    if (l > 0.05) { it.mx = mx / l; it.mz = mz / l; }
    if (ch.blocked && this.jumpCd <= 0) { it.jump = true; this.jumpCd = 0.8; }
    if (this.rng.next() < d.jumpy * dt && this.jumpCd <= 0) { it.jump = true; this.jumpCd = 1.2; }
    if (dist > 30 && cur && cur.type !== 'shotgun' && this.rng.next() < 0.5 * dt) this.crouchT = 1.5;
    if (this.crouchT > 0) { this.crouchT -= dt; it.crouch = true; }
    // building under fire
    const mat = m.build.bestMaterial(ch);
    const recentlyHit = m.time - (this.lastDamageT || -99) < 0.7;
    if (mat && this.buildCd <= 0 && ch.grounded) {
      if (recentlyHit && this.rng.next() < d.buildChance) {
        const a = this.lastDamageFrom || t;
        if (m.build.wallToward(ch, a.pos.x, a.pos.z, mat)) this.buildCd = this.rng.range(1.2, 2.6) / this.p.buildRate;
        else this.buildCd = 0.5;
        if (this.rng.next() < d.buildChance * 0.5 && t.pos.y - ch.pos.y > 2.5 && dist < 28) m.build.rampToward(ch, ux, uz, mat);
      } else if (t.pos.y - ch.pos.y > 3 && dist < 25 && this.rng.next() < d.buildChance * 0.6) {
        m.build.rampToward(ch, ux, uz, mat);
        this.buildCd = 0.6;
        it.mx = ux; it.mz = uz;
      } else if (this.p.preBuild && dist > 8 && dist < 55 && this.rng.next() < this.p.preBuild * dt) {
        // builder: take height / put a wall up before the shots even land
        if (t.pos.y - ch.pos.y > 0.5 || this.rng.chance(0.45)) { m.build.rampToward(ch, ux, uz, mat); it.mx = ux; it.mz = uz; }
        else m.build.wallToward(ch, t.pos.x, t.pos.z, mat);
        this.buildCd = this.rng.range(0.8, 1.6) / this.p.buildRate;
      }
    }
    // reload behind cover-ish: if empty, swap weapon if possible
    if (cur && cur.kind === 'weapon' && cur.mag === 0) this.equipBest(dist);
  }

  doHunt(dt) {
    const ch = this.ch, m = this.m;
    const t = this.target;
    // predict where a fleeing target went (last seen position + velocity, capped)
    const since = Math.min(2.5, m.time - this.seenT);
    const lk = { x: this.lastKnown.x + (this.investigating ? 0 : this.lastVel.x * since * 0.8), y: this.lastKnown.y, z: this.lastKnown.z + (this.investigating ? 0 : this.lastVel.z * since * 0.8) };
    const d = Math.hypot(lk.x - ch.pos.x, lk.z - ch.pos.z);
    // target hiding nearby: grenade it or shoot through its builds
    if (t && t.alive && !this.investigating && m.time - this.seenT < this.d.memory) {
      if (this.grenadeCd <= 0 && d > 6 && d < 30 && this.grenadeSlot() >= 0 && this.rng.next() < (this.d.grenade ?? 0.5)) {
        if (this.throwGrenadeAt(t.pos.x, t.pos.y + 0.5, t.pos.z, dt)) return;
      }
      if (this.breachCover(dt)) return;
    }
    this.equipBest(d);
    if (d < 3 || this.stateT > 20) {
      if (!this.canSeeRecently()) { this.target = null; this.heard = null; this.thinkT = 0; }
      ch.yaw += dt * 2; // look around
      return;
    }
    this.navTo(lk.x, lk.z, null, d > 25 && !this.investigating);
    if (d < 40) { ch.intent.sprint = false; }
  }

  doHeal(dt) {
    const ch = this.ch, m = this.m, d = this.d;
    const visible = this.canSeeRecently();
    const t = this.target;
    if (visible && t) {
      const dist = Math.hypot(t.pos.x - ch.pos.x, t.pos.z - ch.pos.z);
      const mat = m.build.bestMaterial(ch);
      if (dist < 40 && mat && ch.inv.mats[mat] >= 40 && this.buildCd <= 0 && this.rng.next() < d.buildChance) {
        m.build.boxUp(ch, mat);
        this.buildCd = 6;
        this.boxedT = m.time;
      } else if (m.time - (this.boxedT || -99) > 6) {
        const arrived = this.takeCover(t);          // hide behind something, then heal there
        if (!arrived) {
          if (ch.useT > 0) ch.useT = 0;
          if (!this.inCover) {
            // no cover around: run away from the threat
            const ax = ch.pos.x - t.pos.x, az = ch.pos.z - t.pos.z, l = Math.hypot(ax, az) || 1;
            this.seek(ch.pos.x + ax / l * 10 + -az / l * 4, ch.pos.z + az / l * 10 + ax / l * 4, true);
          }
          return;
        }
      }
    }
    const slot = this.healSlot();
    if (slot < 0) { this.thinkT = 0; this.setState('wander'); return; }
    if (ch.inv.sel !== slot + 1) ch.inv.sel = slot + 1;
    ch.intent.fire = true;
    ch.intent.firePressed = ch.useT <= 0;
  }


  // ---------------- advanced tactics ----------------
  /**
   * A spot behind something solid (tree, rock, wall, build piece) relative to `threat`, verified with
   * a line-of-sight check from the threat's eyes. Cached for a short time.
   */
  findCover(threat, maxDist = 18) {
    const ch = this.ch, m = this.m;
    if (this.coverCache && m.time - this.coverCache.t < 1.2 && this.coverCache.threat === threat) return this.coverCache.p;
    const list = m.physics.hash.query(ch.pos.x - maxDist, ch.pos.z - maxDist, ch.pos.x + maxDist, ch.pos.z + maxDist, tmpCols);
    const cands = [];
    for (const c of list) {
      const o = c.owner;
      if (!o || c.type !== 0) continue;
      const g = m.world.hm.height((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2);
      if (c.maxY < g + 1.5 || c.minY > g + 0.8) continue;             // must hide a standing body
      const w = Math.max(c.maxX - c.minX, c.maxZ - c.minZ);
      if (w > 14) continue;                                            // skip huge slabs/foundations
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      cands.push([Math.hypot(cx - ch.pos.x, cz - ch.pos.z), c, cx, cz, w]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    let best = null, bestS = Infinity, checks = 0;
    const tx = threat.pos.x, tz = threat.pos.z, ty = threat.pos.y + 1.5;
    for (const [, c, cx, cz] of cands) {
      if (checks >= 10) break;
      let dx = cx - tx, dz = cz - tz;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const half = Math.abs(dx) > Math.abs(dz) ? (c.maxX - c.minX) / 2 : (c.maxZ - c.minZ) / 2;
      const px = cx + dx * (half + 0.9), pz = cz + dz * (half + 0.9);
      if (!m.nav.walkableAt(px, pz)) continue;
      const bc = this.badCover;
      if (bc && m.time - bc.t < 8 && Math.hypot(px - bc.x, pz - bc.z) < 2.5) continue;
      const dBot = Math.hypot(px - ch.pos.x, pz - ch.pos.z);
      if (dBot > maxDist) continue;
      checks++;
      const gy = m.world.hm.height(px, pz);
      if (m.physics.lineOfSight(tx, ty, tz, px, gy + 1.2, pz)) continue;  // threat would still see us
      const s = dBot + (Math.hypot(px - tx, pz - tz) < 6 ? 25 : 0);
      if (s < bestS) { bestS = s; best = { x: px, z: pz }; }
    }
    this.coverCache = { t: m.time, threat, p: best };
    return best;
  }

  /** Move to cover; returns true once there. */
  takeCover(threat) {
    const ch = this.ch;
    const cp = this.findCover(threat);
    if (!cp) return false;
    const d = Math.hypot(cp.x - ch.pos.x, cp.z - ch.pos.z);
    if (!this.inCover) this.m.aiStats.cover++;
    this.inCover = true;
    if (d > 1.0) { this.seek(cp.x, cp.z, true, false); ch.yaw = approachAngle(ch.yaw, yawTo(threat.pos.x - ch.pos.x, threat.pos.z - ch.pos.z), 6 * 0.016); return false; }
    return true;
  }

  grenadeSlot() { return this.ch.inv.slotOf((s) => s.kind === 'consumable' && s.type === 'grenade'); }

  /** Lob a grenade at (x,y,z): picks the pitch whose simulated arc lands closest. */
  throwGrenadeAt(x, y, z, dt) {
    const ch = this.ch, m = this.m;
    const gs = this.grenadeSlot();
    if (gs < 0) return false;
    if (ch.inv.sel !== gs + 1) { ch.inv.sel = gs + 1; return true; }   // equip first (equip delay)
    const dx = x - ch.pos.x, dz = z - ch.pos.z, dist = Math.hypot(dx, dz);
    const dy = y - ch.eyeY;
    let bestP = 0.3, bestE = Infinity;
    for (let p = -0.3; p <= 1.0; p += 0.1) {
      // same launch as Combat.throwGrenade: dir*21 + 5 up, gravity 20
      const vh = Math.cos(p) * 21, vy0 = Math.sin(p) * 21 + 5;
      // time when the arc comes back down to dy
      const a = -10, b = vy0, c = -dy;
      const D = b * b - 4 * a * c;
      if (D < 0) continue;
      const t = (-b - Math.sqrt(D)) / (2 * a);
      if (t <= 0) continue;
      const e = Math.abs(vh * t - dist);
      if (e < bestE) { bestE = e; bestP = p; }
    }
    ch.yaw = approachAngle(ch.yaw, yawTo(dx, dz), this.d.turnSpeed * dt);
    ch.pitch = bestP;
    if (Math.abs(wrapAngle(yawTo(dx, dz) - ch.yaw)) < 0.08 && ch.fireCd <= 0) {
      ch.intent.fire = true; ch.intent.firePressed = true;
      this.grenadeCd = this.rng.range(6, 12);
      m.aiStats.grenades++;
    }
    return true;
  }

  /** If the target hides behind a build piece, shoot (or rocket) the piece. Returns true if acting. */
  breachCover(dt) {
    const ch = this.ch, m = this.m, t = this.target;
    if (!t || !t.alive || this.rng.next() > (this.d.breach ?? 0.5) + 0.3) return false;
    const dist = Math.hypot(t.pos.x - ch.pos.x, t.pos.z - ch.pos.z);
    if (dist > 45 || m.time - this.seenT > this.d.memory) return false;
    const ex = ch.pos.x, ey = ch.eyeY, ez = ch.pos.z;
    const txx = t.pos.x, tyy = t.pos.y + t.height * 0.6, tzz = t.pos.z;
    const dx = txx - ex, dy = tyy - ey, dz = tzz - ez, l = Math.hypot(dx, dy, dz);
    m.physics.raycast(ex, ey, ez, dx / l, dy / l, dz / l, l, null, hit);
    if (!hit.hit || hit.kind !== 'collider' || !hit.collider.owner || hit.collider.owner.kind !== 'build') return false;
    if (hit.collider.owner.owner === ch) {
      // our own wall is in the way: peek around it instead of shooting our cover
      this.peekT = (this.peekT || 0) - dt;
      if (this.peekT <= 0) { this.peekT = this.rng.range(0.6, 1.2); this.peekDir = this.rng.chance(0.5) ? 1 : -1; }
      const ux = dx / l, uz = dz / l;
      ch.intent.mx = -uz * this.peekDir; ch.intent.mz = ux * this.peekDir;
      ch.yaw = approachAngle(ch.yaw, yawTo(dx, dz), this.d.turnSpeed * dt);
      return true;
    }
    // prefer a rocket, then guns that work at this range
    const inv = ch.inv;
    const rs = inv.slotOf((s) => s.kind === 'weapon' && s.type === 'rocket' && (s.mag > 0 || inv.ammo.rockets > 0));
    if (rs >= 0 && dist > 8) inv.sel = rs + 1; else this.equipBest(dist);
    const cur = inv.current();
    if (!cur || cur.kind !== 'weapon') return false;
    const hx = hit.x, hy = hit.y, hz = hit.z;
    const wy = yawTo(hx - ex, hz - ez), wp = Math.atan2(hy - ey, Math.max(0.3, Math.hypot(hx - ex, hz - ez)));
    const turn = this.d.turnSpeed * dt;
    ch.yaw = approachAngle(ch.yaw, wy, turn);
    ch.pitch = clamp(ch.pitch + clamp(wp - ch.pitch, -turn, turn), -1.4, 1.4);
    if (Math.abs(wrapAngle(wy - ch.yaw)) < 0.06) { ch.intent.fire = true; ch.intent.firePressed = true; if (ch.fireCd <= 0) m.aiStats.breach++; }
    return true;
  }

  doRetreat(dt) {
    const ch = this.ch, t = this.target;
    if (!t || !t.alive) { this.thinkT = 0; this.setState('wander'); return; }
    const covered = this.takeCover(t);
    if (covered && this.canSeeRecently()) {
      // the "cover" doesn't hide us: shoot back, and after a moment look for a better spot
      this.exposedT += dt;
      this.combatAim(dt, true);
      if (this.exposedT > 1.2) { this.exposedT = 0; this.badCover = { x: ch.pos.x, z: ch.pos.z, t: this.m.time }; this.coverCache = null; this.inCover = false; }
      return;
    }
    this.exposedT = 0;
    if (covered && !this.canSeeRecently()) {
      if (this.healSlot() >= 0) { this.setState('heal'); return; }
      const cur = ch.inv.current();
      if (cur && cur.kind === 'weapon' && cur.mag < WEAPONS[cur.type].mag) ch.intent.reload = true;
      return;
    }
    if (!this.coverCache || !this.coverCache.p) {
      // nothing to hide behind: run away zig-zagging, shoot back occasionally
      const ax = ch.pos.x - t.pos.x, az = ch.pos.z - t.pos.z, l = Math.hypot(ax, az) || 1;
      const zz = Math.sin(this.m.time * 3) * 4;
      this.seek(ch.pos.x + ax / l * 10 - az / l * zz, ch.pos.z + az / l * 10 + ax / l * zz, true);
      if (this.canSeeRecently() && this.rng.next() < 0.3) this.combatAim(dt, true);
    }
  }

  debugInfo() {
    const ch = this.ch;
    const cur = ch.inv.current();
    return [
      `-- bot ${ch.name} [${this.d.name} ${ch.persona.id}] state=${this.state} hp=${Math.ceil(ch.health)}+${Math.ceil(ch.shield)} mode=${ch.mode}`,
      `   target=${this.target ? this.target.name + (this.canSeeRecently() ? ' (visible)' : ' (memory)') : '-'}  weapon=${cur ? cur.type + ' r' + cur.rarity + ' ' + cur.mag : 'pickaxe'}`,
      `   goal=${this.goal ? this.goal.x.toFixed(0) + ',' + this.goal.z.toFixed(0) : '-'}  path=${this.path ? (this.pathIdx + '/' + this.path.points.length) : '-'}  chain=${this.chain ? this.chainIdx + '/' + this.chain.length : '-'}  stuck=${this.stuckLevel}  mats=${ch.inv.mats.wood}/${ch.inv.mats.brick}/${ch.inv.mats.metal}`,
    ];
  }
}

function gauss(rng) {
  const u = Math.max(1e-6, rng.next()), v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
