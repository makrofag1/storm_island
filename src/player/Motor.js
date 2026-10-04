// Character movement: capsule (vertical cylinder) vs heightmap + colliders, step-up, slope sliding,
// swimming, fall damage, freefall and glider. Used identically by player and bots.
import { C_BOX, surfaceY } from '../world/Colliders.js';
import {
  GRAVITY, JUMP_VEL, STEP_UP, WALK_SPEED, SPRINT_SPEED, CROUCH_SPEED, SWIM_SPEED, CHAR_HEIGHT, CROUCH_HEIGHT,
  FALL_DAMAGE_VEL, HALF,
} from '../core/config.js';
import { yawDirX, yawDirZ } from '../core/math.js';

const tmpList = [];
const g = { y: 0, collider: null, water: false };
const nrm = { x: 0, y: 1, z: 0 };
export const AUTO_GLIDE_ALT = 110;

function approachVec(vel, tx, tz, maxDelta) {
  const dx = tx - vel.x, dz = tz - vel.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d < 1e-6) { vel.x = tx; vel.z = tz; return; }
  vel.x += dx / d * maxDelta; vel.z += dz / d * maxDelta;
}

/** Horizontal move with collision response against colliders. */
export function moveHorizontal(ch, dx, dz, physics) {
  const r = ch.radius;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / (r * 0.8)));
  let x = ch.pos.x, z = ch.pos.z;
  const feet = ch.pos.y, head = feet + ch.height;
  ch.blocked = false;
  for (let s = 0; s < steps; s++) {
    x += dx / steps; z += dz / steps;
    for (let iter = 0; iter < 3; iter++) {
      const list = physics.hash.query(x - r, z - r, x + r, z + r, tmpList);
      let moved = false;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.minY >= head - 0.05) continue;
        const top = c.type === C_BOX ? c.maxY : surfaceY(c, x, z);
        if (top <= feet + STEP_UP) continue;
        if (c.type !== C_BOX && c.minY > feet + STEP_UP && top > head) { /* ceiling-ish ramp */ }
        const nx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x;
        const nz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
        let ddx = x - nx, ddz = z - nz;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 >= r * r) continue;
        let ux, uz;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          ux = ddx / d; uz = ddz / d;
          x += ux * (r - d); z += uz * (r - d);
        } else {
          const l = x - c.minX, rr = c.maxX - x, b = z - c.minZ, f = c.maxZ - z;
          const m = Math.min(l, rr, b, f);
          if (m === l) { ux = -1; uz = 0; x = c.minX - r; }
          else if (m === rr) { ux = 1; uz = 0; x = c.maxX + r; }
          else if (m === b) { ux = 0; uz = -1; z = c.minZ - r; }
          else { ux = 0; uz = 1; z = c.maxZ + r; }
        }
        const vn = ch.vel.x * ux + ch.vel.z * uz;
        if (vn < 0) { ch.vel.x -= vn * ux; ch.vel.z -= vn * uz; }
        ch.blocked = true;
        moved = true;
      }
      if (!moved) break;
    }
  }
  const lim = HALF - 4;
  ch.pos.x = x < -lim ? -lim : x > lim ? lim : x;
  ch.pos.z = z < -lim ? -lim : z > lim ? lim : z;
}

function headroom(ch, physics, h) {
  const r = ch.radius * 0.9;
  const list = physics.hash.query(ch.pos.x - r, ch.pos.z - r, ch.pos.x + r, ch.pos.z + r, tmpList);
  for (const c of list) {
    if (c.type !== C_BOX) continue;
    if (c.minY > ch.pos.y + 0.3 && c.minY < ch.pos.y + h) return false;
  }
  return true;
}

/** Returns fall damage dealt this tick (0 if none). */
export function stepMotor(ch, dt, physics) {
  if (ch.mode === 'ground') return groundMove(ch, dt, physics);
  if (ch.mode === 'freefall') return freefall(ch, dt, physics);
  if (ch.mode === 'glide') return glide(ch, dt, physics);
  return 0;
}

function groundMove(ch, dt, physics) {
  const it = ch.intent;
  const wantCrouch = it.crouch && !ch.swimming;
  if (wantCrouch && !ch.crouching) ch.crouching = true;
  else if (!wantCrouch && ch.crouching && headroom(ch, physics, CHAR_HEIGHT)) ch.crouching = false;
  ch.height = ch.crouching ? CROUCH_HEIGHT : CHAR_HEIGHT;

  const len = Math.hypot(it.mx, it.mz);
  const moving = len > 0.05;
  // sprint only when moving roughly forward
  const fwdDot = moving ? (it.mx * yawDirX(ch.yaw) + it.mz * yawDirZ(ch.yaw)) / len : 0;
  let speed = WALK_SPEED;
  ch.sprinting = false;
  if (ch.swimming) speed = SWIM_SPEED;
  else if (ch.crouching) speed = CROUCH_SPEED;
  else if (it.sprint && !it.aim && fwdDot > 0.3 && ch.useT <= 0 && ch.reloadT <= 0) { speed = SPRINT_SPEED; ch.sprinting = moving; }
  if (it.aim && !ch.swimming) speed = Math.min(speed, WALK_SPEED * 0.68);
  if (ch.useT > 0) speed = Math.min(speed, WALK_SPEED * 0.55);
  if (ch.emoting) speed = 0;
  const k = moving ? speed * Math.min(1, len) / len : 0;
  const tx = it.mx * k, tz = it.mz * k;
  const accel = ch.grounded ? (moving ? 70 : 55) : 16;
  approachVec(ch.vel, tx, tz, accel * dt);

  ch.sliding = false;
  if (ch.grounded && !ch.groundCollider && !ch.swimming) {
    physics.hm.normal(ch.pos.x, ch.pos.z, nrm);
    if (nrm.y < 0.7) {
      ch.sliding = true;
      ch.vel.x += nrm.x * 28 * dt; ch.vel.z += nrm.z * 28 * dt;
      // remove uphill input component
      const up = -(ch.vel.x * nrm.x + ch.vel.z * nrm.z);
      if (up > 0) { ch.vel.x += nrm.x * up * 0.8; ch.vel.z += nrm.z * up * 0.8; }
    }
  }
  ch.jumped = false;
  // jumping is allowed on steep slopes too, otherwise a pit between slopes could trap you forever
  if (it.jump && ch.grounded && !ch.swimming && !ch.emoting) {
    ch.vel.y = JUMP_VEL;
    ch.grounded = false;
    ch.jumped = true;
    if (ch.crouching && headroom(ch, physics, CHAR_HEIGHT)) { ch.crouching = false; ch.height = CHAR_HEIGHT; }
  }
  if (!ch.grounded) ch.vel.y = Math.max(ch.vel.y - GRAVITY * dt, -60);

  moveHorizontal(ch, ch.vel.x * dt, ch.vel.z * dt, physics);
  return vertical(ch, dt, physics, true);
}

function vertical(ch, dt, physics, allowFallDamage) {
  const oldY = ch.pos.y;
  let newY = oldY + ch.vel.y * dt;
  const probeTop = ch.grounded ? oldY + STEP_UP : Math.max(oldY, newY) + 0.05;
  physics.groundAt(ch.pos.x, ch.pos.z, probeTop, g, 0.18);
  let dmg = 0;
  ch.landedImpact = 0;
  if (ch.grounded) {
    if (g.y >= oldY - 0.55) { newY = g.y; ch.vel.y = 0; }
    else { ch.grounded = false; ch.vel.y = Math.min(ch.vel.y, 0); newY = oldY; }
  }
  if (!ch.grounded && newY <= g.y) {
    const impact = -ch.vel.y;
    newY = g.y;
    ch.vel.y = 0;
    ch.grounded = true;
    ch.landedImpact = impact;
    if (allowFallDamage && impact > FALL_DAMAGE_VEL && !g.water) dmg = Math.round((impact - FALL_DAMAGE_VEL) * 5.5);
  }
  if (ch.vel.y > 0) {
    const r = ch.radius * 0.9;
    const list = physics.hash.query(ch.pos.x - r, ch.pos.z - r, ch.pos.x + r, ch.pos.z + r, tmpList);
    for (const c of list) {
      if (c.type !== C_BOX) continue;
      if (ch.pos.x + r < c.minX || ch.pos.x - r > c.maxX || ch.pos.z + r < c.minZ || ch.pos.z - r > c.maxZ) continue;
      if (c.minY >= oldY + ch.height - 0.1 && c.minY < newY + ch.height) { newY = c.minY - ch.height; ch.vel.y = 0; }
    }
  }
  ch.pos.y = newY;
  ch.groundCollider = ch.grounded ? g.collider : null;
  ch.swimming = ch.grounded && g.water;
  return dmg;
}

function freefall(ch, dt, physics) {
  const it = ch.intent;
  ch.freefallT += dt;
  const hs = it.dive ? 24 : it.slow ? 10 : 16;
  approachVec(ch.vel, it.mx * hs, it.mz * hs, 22 * dt);
  const vyT = it.dive ? -54 : it.slow ? -27 : -38;
  ch.vel.y += Math.sign(vyT - ch.vel.y) * Math.min(Math.abs(vyT - ch.vel.y), 40 * dt);
  moveHorizontal(ch, ch.vel.x * dt, ch.vel.z * dt, physics);
  const ground = physics.hm.height(ch.pos.x, ch.pos.z);
  const alt = ch.pos.y - Math.max(ground, 0);
  if (alt < AUTO_GLIDE_ALT || (it.jump && ch.freefallT > 0.8 && alt < 260)) {
    ch.mode = 'glide';
    ch.vel.y = Math.max(ch.vel.y, -12);
    ch.deployed = true;
  }
  vertical(ch, dt, physics, false);
  if (ch.grounded) ch.mode = 'ground';
  return 0;
}

function glide(ch, dt, physics) {
  const it = ch.intent;
  const fx = yawDirX(ch.yaw), fz = yawDirZ(ch.yaw);
  const base = it.dive ? 22 : it.slow ? 9 : 15;
  const tx = fx * base * 0.55 + it.mx * base * 0.6, tz = fz * base * 0.55 + it.mz * base * 0.6;
  approachVec(ch.vel, tx, tz, 14 * dt);
  const vyT = it.dive ? -11 : it.slow ? -4.5 : -6.5;
  ch.vel.y += Math.sign(vyT - ch.vel.y) * Math.min(Math.abs(vyT - ch.vel.y), 25 * dt);
  moveHorizontal(ch, ch.vel.x * dt, ch.vel.z * dt, physics);
  vertical(ch, dt, physics, false);
  if (ch.grounded) { ch.mode = 'ground'; ch.landedImpact = 0; ch.anim.land = 0.3; }
  return 0;
}
