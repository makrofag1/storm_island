// Weapons, projectiles, explosions, pickaxe harvesting, consumables and damage application.
// Operates on Character intents so player and bots share exactly the same rules.
import { WEAPONS, CONSUMABLES, RARITY_RELOAD, RARITY_SPREAD } from './Items.js';
import { hitDamage, applyDamageToStats, canUseConsumable, applyConsumable } from './Damage.js';
import { makeHit } from '../world/Physics.js';
import { MAX_MATS } from '../core/config.js';
import { yawDirX, yawDirZ } from '../core/math.js';

const hit = makeHit();
const hit2 = makeHit();
const _org = { x: 0, y: 0, z: 0 };
const tmpList = [];
const PICKAXE_RANGE = 2.9;

export class Combat {
  constructor(ctx) {
    this.ctx = ctx;          // { physics, world, events, chars, time() }
    this.projectiles = [];
    this.pool = [];
    this.rng = ctx.rng;
  }

  get physics() { return this.ctx.physics; }

  /** Per-tick weapon/consumable logic for a character. */
  updateCharacter(ch, dt) {
    if (!ch.alive) return;
    if (ch.fireCd > 0) ch.fireCd -= dt;
    if (ch.swingCd > 0) ch.swingCd -= dt;
    const inv = ch.inv;
    if (inv.sel !== ch.lastSel) {
      ch.reloadT = 0; ch.useT = 0;
      ch.fireCd = Math.max(ch.fireCd, 0.22);
      ch.lastSel = inv.sel;
      ch.bloom = 0;
    }
    if (ch.mode !== 'ground') return;
    const it = ch.intent;
    const cur = inv.current();
    // bloom decay
    if (cur && cur.kind === 'weapon') {
      const def = WEAPONS[cur.type];
      ch.bloom = Math.max(0, ch.bloom - def.bloomMax * dt / Math.max(0.05, def.bloomDecay));
    }
    if (ch.emoting && (it.fire || it.mx || it.mz)) ch.emoting = false;
    if (ch.emoting) return;

    if (inv.sel === 0) {
      if (it.fire && ch.swingCd <= 0) this.swing(ch);
      return;
    }
    if (!cur) return;
    if (cur.kind === 'weapon') {
      const def = WEAPONS[cur.type];
      if (ch.reloadT > 0) {
        ch.reloadT -= dt;
        if (ch.reloadT <= 0) {
          const need = def.mag - cur.mag;
          const take = Math.min(need, inv.ammo[def.ammo]);
          cur.mag += take; inv.ammo[def.ammo] -= take;
          ch.reloadT = 0;
          this.ctx.events.emit('reloaded', { ch });
        }
        return;
      }
      if (it.reload && cur.mag < def.mag && inv.ammo[def.ammo] > 0) { this.startReload(ch, cur, def); return; }
      const wants = it.fire && (def.auto || it.firePressed);
      if (wants && ch.fireCd <= 0) {
        if (cur.mag > 0) this.fire(ch, cur, def, it.aim);
        else if (inv.ammo[def.ammo] > 0) this.startReload(ch, cur, def);
        else if (it.firePressed) { this.ctx.events.emit('dryFire', { ch }); ch.fireCd = 0.3; }
      }
      // auto reload when empty and not firing
      if (cur.mag === 0 && !it.fire && inv.ammo[def.ammo] > 0 && ch.fireCd <= 0) this.startReload(ch, cur, def);
    } else if (cur.kind === 'consumable') {
      const def = CONSUMABLES[cur.type];
      if (def.throwable) {
        if (it.firePressed && ch.fireCd <= 0) this.throwGrenade(ch, inv.sel - 1);
        return;
      }
      if (ch.useT > 0) {
        ch.useT -= dt;
        if (ch.useT <= 0) {
          ch.useT = 0;
          if (applyConsumable(ch, def)) {
            inv.consumeAt(ch.useSlot);
            this.ctx.events.emit('healed', { ch, type: cur.type });
          }
        }
      } else if (it.fire && it.firePressed !== undefined && (it.firePressed || it.fire)) {
        if (canUseConsumable(ch, def)) {
          ch.useT = ch.useTotal = def.time;
          ch.useSlot = inv.sel - 1;
          this.ctx.events.emit('useStart', { ch, type: cur.type });
        } else if (it.firePressed) this.ctx.events.emit('cantUse', { ch, type: cur.type });
      }
    }
  }

  startReload(ch, cur, def) {
    if (ch.reloadT > 0) return;
    ch.reloadT = ch.reloadTotal = def.reload * RARITY_RELOAD[cur.rarity];
    this.ctx.events.emit('reloadStart', { ch, type: cur.type });
  }

  /**
   * Where shots start: the eyes, or (VR) the muzzle of the gun in the player's hand — unless the
   * muzzle pokes through a wall, then the eyes again (no shooting through walls by reaching).
   */
  shotOrigin(ch, out) {
    out.x = ch.pos.x; out.y = ch.eyeY; out.z = ch.pos.z;
    const o = ch.aimOrigin;
    if (!o) return out;
    const dx = o.x - out.x, dy = o.y - out.y, dz = o.z - out.z, l = Math.hypot(dx, dy, dz);
    if (l < 1e-3) return out;
    if (l > 1.6) return out; // stale / bogus origin
    this.physics.raycast(out.x, out.y, out.z, dx / l, dy / l, dz / l, l + 0.05, null, hit2);
    if (!hit2.hit) { out.x = o.x; out.y = o.y; out.z = o.z; }
    return out;
  }

  /** Aim direction for a character (player: towards camera aim point; bots: aimDir). */
  aimDir(ch, out, origin) {
    const o = origin || this.shotOrigin(ch, _org);
    const ex = o.x, ey = o.y, ez = o.z;
    if (ch.aimPoint) {
      let dx = ch.aimPoint.x - ex, dy = ch.aimPoint.y - ey, dz = ch.aimPoint.z - ez;
      const l = Math.hypot(dx, dy, dz);
      if (l > 0.5) { out.x = dx / l; out.y = dy / l; out.z = dz / l; return out; }
    }
    const cp = Math.cos(ch.pitch);
    out.x = yawDirX(ch.yaw) * cp; out.y = Math.sin(ch.pitch); out.z = yawDirZ(ch.yaw) * cp;
    return out;
  }

  spreadFor(ch, def, cur, ads) {
    let base = ads ? def.adsSpread : def.spread;
    const speed = Math.hypot(ch.vel.x, ch.vel.z);
    let mult = 1;
    if (!ch.grounded) mult *= 2.2;
    else if (ch.sprinting) mult *= 1.8;
    else if (speed > 1.5) mult *= ads ? 1.25 : 1.45;
    if (ch.crouching) mult *= 0.72;
    return (base * mult + ch.bloom * (ads ? 0.5 : 1)) * RARITY_SPREAD[cur.rarity] * (ch.spreadMul || 1);
  }

  fire(ch, cur, def, ads) {
    const ctx = this.ctx;
    cur.mag--;
    ch.fireCd = (1 / def.rate) * (ch.fireMul || 1);
    ch.stats.shots++;
    ch.lastShotT = ctx.time();
    ch.anim.fire = 1;
    const org = this.shotOrigin(ch, { x: 0, y: 0, z: 0 });
    const dir = this.aimDir(ch, { x: 0, y: 0, z: 0 }, org);
    const spread = this.spreadFor(ch, def, cur, ads);
    const ex = org.x, ey = org.y, ez = org.z;
    // muzzle (visual only; VR shots already start at the real muzzle)
    const rx = Math.cos(ch.yaw), rz = -Math.sin(ch.yaw);
    const vr = !!ch.aimOrigin;
    const mx = vr ? ex : ex + dir.x * 0.9 + rx * 0.3, my = vr ? ey : ey - 0.25 + dir.y * 0.9, mz = vr ? ez : ez + dir.z * 0.9 + rz * 0.3;
    let anyHit = false;
    for (let p = 0; p < def.pellets; p++) {
      const d = applySpread(dir, def.pellets > 1 ? spread * (0.35 + 0.65 * Math.random()) : spread, this.rng);
      if (def.projectile) {
        this.spawnProjectile(ch, cur.type, cur.rarity, mx, my, mz, d.x * def.projectile.speed, d.y * def.projectile.speed, d.z * def.projectile.speed);
        continue;
      }
      this.physics.raycast(ex, ey, ez, d.x, d.y, d.z, def.range, { chars: true, ignore: ch }, hit);
      const endX = hit.x, endY = hit.y, endZ = hit.z;
      if (hit.hit) anyHit = this.resolveBulletHit(ch, def, cur, hit, hit.t) || anyHit;
      if (p < 3 || Math.random() < 0.3) ctx.events.emit('tracer', { x0: mx, y0: my, z0: mz, x1: endX, y1: endY, z1: endZ, ch, weapon: cur.type });
    }
    ch.bloom = Math.min(def.bloomMax, ch.bloom + def.bloomShot);
    ctx.events.emit('shot', { ch, weapon: cur.type, x: mx, y: my, z: mz, dx: dir.x, dy: dir.y, dz: dir.z, recoil: def.recoil });
  }

  /** Returns true if a character was hit. */
  resolveBulletHit(ch, def, cur, h, dist) {
    const ctx = this.ctx;
    if (h.kind === 'char') {
      const dmg = hitDamage(def, cur.rarity, dist, h.head);
      this.applyDamage(h.char, dmg, { attacker: ch, weapon: cur.type, head: h.head, x: h.x, y: h.y, z: h.z, cause: 'gun' });
      ctx.events.emit('impact', { x: h.x, y: h.y, z: h.z, nx: h.nx, ny: h.ny, nz: h.nz, surface: 'flesh', ch });
      return true;
    }
    if (h.kind === 'collider') {
      const res = ctx.world.damageCollider(h.collider, def.damage * def.structMul, { attacker: ch });
      ctx.events.emit('impact', { x: h.x, y: h.y, z: h.z, nx: h.nx, ny: h.ny, nz: h.nz, surface: res ? res.surface : 'stone', ch, collider: h.collider, decal: true });
      if (res) ctx.events.emit('structHit', { ch, collider: h.collider, destroyed: res.destroyed, amount: def.damage * def.structMul, x: h.x, y: h.y, z: h.z });
    } else if (h.kind === 'terrain') {
      ctx.events.emit('impact', { x: h.x, y: h.y, z: h.z, nx: h.nx, ny: h.ny, nz: h.nz, surface: 'dirt', ch, decal: true });
    }
    return false;
  }

  swing(ch) {
    const ctx = this.ctx;
    ch.swingCd = 0.6;
    ch.swingAnim = 1;
    const org = this.shotOrigin(ch, { x: 0, y: 0, z: 0 });
    const dir = this.aimDir(ch, { x: 0, y: 0, z: 0 }, org);
    const ex = org.x, ey = org.y, ez = org.z;
    this.physics.raycast(ex, ey, ez, dir.x, dir.y, dir.z, PICKAXE_RANGE, { chars: true, ignore: ch }, hit);
    ctx.events.emit('swing', { ch });
    if (!hit.hit) return;
    if (hit.kind === 'char') {
      this.applyDamage(hit.char, 20, { attacker: ch, weapon: 'pickaxe', head: false, x: hit.x, y: hit.y, z: hit.z, cause: 'pickaxe' });
      ctx.events.emit('impact', { x: hit.x, y: hit.y, z: hit.z, nx: -dir.x, ny: -dir.y, nz: -dir.z, surface: 'flesh', ch });
      return;
    }
    if (hit.kind !== 'collider') {
      ctx.events.emit('impact', { x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, ny: hit.ny, nz: hit.nz, surface: 'dirt', ch, pickaxe: true });
      return;
    }
    const c = hit.collider;
    const ws = ch.weakSpot;
    const crit = !!(ws && ws.collider === c && Math.hypot(ws.x - hit.x, ws.y - hit.y, ws.z - hit.z) < 0.6);
    const isOwnBuild = c.owner && c.owner.kind === 'build';
    const res = ctx.world.damageCollider(c, crit ? 100 : 50, { pickaxe: true, crit, attacker: ch });
    ctx.events.emit('impact', { x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, ny: hit.ny, nz: hit.nz, surface: res ? res.surface : 'stone', ch, pickaxe: true, crit });
    if (res && res.harvest && !isOwnBuild) {
      const type = res.harvest.type;
      const before = ch.inv.mats[type];
      ch.inv.mats[type] = Math.min(MAX_MATS, before + res.harvest.amount);
      const gained = ch.inv.mats[type] - before;
      ch.stats.mats += gained;
      ctx.events.emit('harvest', { ch, type, amount: gained, crit, x: hit.x, y: hit.y, z: hit.z });
    }
    if (res) ctx.events.emit('structHit', { ch, collider: c, destroyed: res.destroyed, amount: crit ? 100 : 50, x: hit.x, y: hit.y, z: hit.z, pickaxe: true });
    // new weak spot near the hit point on the same face
    if (res && !res.destroyed && c.alive) {
      const nx = hit.nx, ny = hit.ny, nz = hit.nz;
      let ux = -nz, uy = 0, uz = nx;
      if (Math.abs(ny) > 0.7) { ux = 1; uy = 0; uz = 0; }
      const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
      const a = Math.random() * Math.PI * 2, r = 0.35 + Math.random() * 0.45;
      let wx = hit.x + (ux * Math.cos(a) + vx * Math.sin(a)) * r;
      let wy = hit.y + (uy * Math.cos(a) + vy * Math.sin(a)) * r;
      let wz = hit.z + (uz * Math.cos(a) + vz * Math.sin(a)) * r;
      wx = Math.min(c.maxX + 0.02, Math.max(c.minX - 0.02, wx));
      wy = Math.min(c.maxY - 0.1, Math.max(c.minY + 0.1, wy, ch.pos.y + 0.3));
      wz = Math.min(c.maxZ + 0.02, Math.max(c.minZ - 0.02, wz));
      ch.weakSpot = { collider: c, x: wx + nx * 0.03, y: wy, z: wz + nz * 0.03 };
    } else ch.weakSpot = null;
  }

  throwGrenade(ch, slot) {
    const org = this.shotOrigin(ch, { x: 0, y: 0, z: 0 });
    const dir = this.aimDir(ch, { x: 0, y: 0, z: 0 }, org);
    ch.inv.consumeAt(slot);
    ch.fireCd = 0.8;
    ch.anim.fire = 1;
    const sp = 21;
    if (ch.throwVel) {
      // VR: thrown with the real hand velocity
      const v = ch.throwVel; ch.throwVel = null;
      this.spawnProjectile(ch, 'grenade', 0, org.x, org.y, org.z, v.x, v.y, v.z);
    } else if (ch.aimOrigin) this.spawnProjectile(ch, 'grenade', 0, org.x, org.y, org.z, dir.x * sp, dir.y * sp + 5, dir.z * sp);
    else this.spawnProjectile(ch, 'grenade', 0, ch.pos.x + dir.x * 0.6, ch.eyeY, ch.pos.z + dir.z * 0.6, dir.x * sp, dir.y * sp + 5, dir.z * sp);
    this.ctx.events.emit('throw', { ch });
  }

  spawnProjectile(owner, type, rarity, x, y, z, vx, vy, vz) {
    const p = this.pool.pop() || {};
    p.owner = owner; p.type = type; p.rarity = rarity;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.px = x; p.py = y; p.pz = z;
    p.life = type === 'grenade' ? 2.6 : 4; p.dist = 0; p.active = true;
    this.projectiles.push(p);
    this.ctx.events.emit('projectileSpawn', { p });
    return p;
  }

  updateProjectiles(dt) {
    const list = this.projectiles;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      p.px = p.x; p.py = p.y; p.pz = p.z;
      if (p.type === 'grenade') {
        p.vy -= 20 * dt;
        const sx = p.vx * dt, sy = p.vy * dt, sz = p.vz * dt;
        const len = Math.hypot(sx, sy, sz);
        if (len > 1e-5) {
          this.physics.raycast(p.x, p.y, p.z, sx / len, sy / len, sz / len, len + 0.15, null, hit2);
          if (hit2.hit) {
            p.x = hit2.x + hit2.nx * 0.16; p.y = hit2.y + hit2.ny * 0.16; p.z = hit2.z + hit2.nz * 0.16;
            const vn = p.vx * hit2.nx + p.vy * hit2.ny + p.vz * hit2.nz;
            p.vx = (p.vx - 2 * vn * hit2.nx) * 0.45; p.vy = (p.vy - 2 * vn * hit2.ny) * 0.45; p.vz = (p.vz - 2 * vn * hit2.nz) * 0.45;
            if (Math.abs(vn) > 3) this.ctx.events.emit('bounce', { x: p.x, y: p.y, z: p.z });
          } else { p.x += sx; p.y += sy; p.z += sz; }
        }
        if (p.life <= 0) {
          const d = CONSUMABLES.grenade;
          this.explode(p.x, p.y, p.z, d.radius, d.damage, d.structDmg, p.owner, 'grenade');
          this.kill(i);
        }
        continue;
      }
      const def = WEAPONS[p.type];
      p.vy -= (def.projectile.gravity || 0) * dt;
      const sx = p.vx * dt, sy = p.vy * dt, sz = p.vz * dt;
      const len = Math.hypot(sx, sy, sz);
      this.physics.raycast(p.x, p.y, p.z, sx / len, sy / len, sz / len, len, { chars: true, ignore: p.owner }, hit2);
      if (hit2.hit) {
        p.x = hit2.x; p.y = hit2.y; p.z = hit2.z;
        if (def.projectile.explode) {
          const e = def.projectile.explode;
          this.explode(hit2.x - sx / len * 0.3, hit2.y - sy / len * 0.3, hit2.z - sz / len * 0.3, e.radius, def.damage * (1 + p.rarity * 0.05), e.structDmg, p.owner, p.type);
        } else {
          this.resolveBulletHit(p.owner, def, { rarity: p.rarity, type: p.type }, hit2, p.dist + hit2.t);
          this.ctx.events.emit('tracer', { x0: p.px, y0: p.py, z0: p.pz, x1: hit2.x, y1: hit2.y, z1: hit2.z, weapon: p.type });
        }
        this.kill(i);
        continue;
      }
      p.x += sx; p.y += sy; p.z += sz; p.dist += len;
      if (p.type === 'sniper') this.ctx.events.emit('tracer', { x0: p.px, y0: p.py, z0: p.pz, x1: p.x, y1: p.y, z1: p.z, weapon: 'sniper' });
      if (p.life <= 0 || p.y < -30) this.kill(i);
    }
  }

  kill(i) {
    const p = this.projectiles[i];
    p.active = false;
    this.projectiles[i] = this.projectiles[this.projectiles.length - 1];
    this.projectiles.pop();
    this.pool.push(p);
  }

  explode(x, y, z, radius, damage, structDmg, owner, weapon) {
    const ctx = this.ctx;
    ctx.events.emit('explosion', { x, y, z, radius, owner });
    for (const ch of ctx.chars) {
      if (!ch.alive || !ch.hittable) continue;
      const cy = ch.pos.y + ch.height * 0.5;
      const d = Math.hypot(ch.pos.x - x, cy - y, ch.pos.z - z);
      if (d > radius + 0.5) continue;
      let dmg = damage * Math.max(0.15, 1 - d / (radius + 0.5));
      if (!this.physics.lineOfSight(x, y, z, ch.pos.x, cy, ch.pos.z)) dmg *= 0.35;
      this.applyDamage(ch, dmg, { attacker: owner, weapon, head: false, x: ch.pos.x, y: cy, z: ch.pos.z, cause: 'explosion' });
    }
    const list = this.physics.hash.query(x - radius, z - radius, x + radius, z + radius, tmpList).slice();
    for (const c of list) {
      if (!c.alive) continue;
      const nx = Math.max(c.minX, Math.min(x, c.maxX)), ny = Math.max(c.minY, Math.min(y, c.maxY)), nz = Math.max(c.minZ, Math.min(z, c.maxZ));
      const d = Math.hypot(nx - x, ny - y, nz - z);
      if (d > radius) continue;
      ctx.world.damageCollider(c, structDmg * (1 - d / radius * 0.5), { attacker: owner });
    }
  }

  /** Apply damage to a character (handles shields, stats, events, death). */
  applyDamage(target, amount, opts) {
    if (!target.alive || amount <= 0) return null;
    if (target.god) amount = 0;
    const ctx = this.ctx;
    const res = applyDamageToStats(target, amount, !!opts.bypassShield);
    const attacker = opts.attacker;
    target.lastDamageT = ctx.time();
    if (attacker && attacker !== target) { target.lastAttacker = attacker; attacker.stats.damage += res.total; attacker.stats.hits++; if (opts.head) attacker.stats.headshots++; }
    target.stats.damageTaken += res.total;
    target.anim.hit = 1;
    if (target.useT > 0 && opts.cause !== 'storm') { target.useT = 0; ctx.events.emit('useCancel', { ch: target }); }
    ctx.events.emit('damage', { target, attacker, amount: res.total, shieldDamage: res.shieldDamage, head: !!opts.head, x: opts.x ?? target.pos.x, y: opts.y ?? target.pos.y + 1.2, z: opts.z ?? target.pos.z, cause: opts.cause, weapon: opts.weapon });
    if (res.dead) ctx.events.emit('death', { target, attacker: attacker && attacker !== target ? attacker : null, weapon: opts.weapon, cause: opts.cause });
    return res;
  }

  clear() { this.projectiles.length = 0; this.pool.length = 0; }
}

const _u = { x: 0, y: 0, z: 0 }, _v = { x: 0, y: 0, z: 0 }, _o = { x: 0, y: 0, z: 0 };
export function applySpread(dir, angle, rng) {
  if (angle <= 0) { _o.x = dir.x; _o.y = dir.y; _o.z = dir.z; return _o; }
  // basis
  if (Math.abs(dir.y) < 0.9) { _u.x = -dir.z; _u.y = 0; _u.z = dir.x; }
  else { _u.x = 1; _u.y = 0; _u.z = 0; }
  let l = Math.hypot(_u.x, _u.y, _u.z); _u.x /= l; _u.y /= l; _u.z /= l;
  _v.x = dir.y * _u.z - dir.z * _u.y; _v.y = dir.z * _u.x - dir.x * _u.z; _v.z = dir.x * _u.y - dir.y * _u.x;
  const r = Math.tan(angle) * Math.sqrt(rng.next()), a = rng.next() * Math.PI * 2;
  const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
  _o.x = dir.x + _u.x * ca + _v.x * sa; _o.y = dir.y + _u.y * ca + _v.y * sa; _o.z = dir.z + _u.z * ca + _v.z * sa;
  l = Math.hypot(_o.x, _o.y, _o.z); _o.x /= l; _o.y /= l; _o.z /= l;
  return _o;
}
