// Pure decision helpers for the bot AI (no three.js, unit tested): storm danger, "does this make
// sense right now" checks for trait-driven ideas, and the judgment roll that decides whether a bot
// actually performs those checks (the skill side of a decision, see Difficulty.judgment).
import { WEAPONS } from '../combat/Items.js';
import { SPRINT_SPEED, BUILD_COST } from '../core/config.js';

/** Average speed over a real route (detours, slopes, obstacles). */
export const TRAVEL_SPEED = SPRINT_SPEED * 0.75;

/** The safe circle `t` real seconds from now (only looks ahead within the current phase). */
export function zoneAt(storm, t) {
  if (storm.state === 'done') return storm.cur;
  const p = storm.phases[storm.phase], st = t * (storm.speed || 1);
  let k0 = 0, k;
  if (storm.state === 'wait') {
    if (st <= storm.timer) return storm.cur;
    k = Math.min(1, (st - storm.timer) / p.shrink);
  } else {
    k0 = 1 - Math.max(0, storm.timer) / p.shrink;
    k = Math.min(1, k0 + st / p.shrink);
  }
  const from = storm.state === 'wait' ? storm.cur : storm.from, to = storm.next;
  return { x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k, r: from.r + (to.r - from.r) * k };
}

/** Will (x,z) still be inside the safe zone `t` seconds from now (with a margin in metres)? */
export function safeAt(storm, x, z, t = 0, margin = 0) {
  const c = t > 0 ? zoneAt(storm, t) : storm.cur;
  return Math.hypot(x - c.x, z - c.z) <= c.r - margin;
}

/**
 * Storm danger for a character at (x,z) with `health` (the storm ignores shields).
 * timeToDeath: seconds the health lasts in the storm; timeToSafety: seconds to get back inside
 * (the shrinking edge moving away from you is taken into account); urgent: it is about time to go.
 */
export function stormThreat(storm, x, z, health, speed = TRAVEL_SPEED) {
  const c = storm.cur, d = Math.hypot(x - c.x, z - c.z), out = d - c.r;
  if (out <= 0) return { outside: false, out, timeToDeath: Infinity, timeToSafety: 0, urgent: false };
  let closing = speed;
  if (storm.state === 'shrink') {
    const p = storm.phases[storm.phase];
    closing = Math.max(0.6, speed - ((storm.from.r - storm.next.r) / p.shrink) * (storm.speed || 1));
  }
  const timeToSafety = out / closing, timeToDeath = Math.max(0, health) / Math.max(0.5, storm.dps);
  return { outside: true, out, timeToDeath, timeToSafety, urgent: timeToDeath < timeToSafety * 1.5 + 6 };
}

// ---- "does it make sense" checks for trait-driven ideas ----

/** A usable close-range gun (shotgun / SMG with ammo) — pushing in without one is a bad idea. */
export function canPush(inv) {
  return inv.slots.some((s) => s && s.kind === 'weapon' && (s.type === 'shotgun' || s.type === 'smg') && (s.mag > 0 || inv.ammo[WEAPONS[s.type].ammo] > 0));
}

/** Enough materials for at least one piece. */
export function canBuild(inv, pieces = 1) {
  return inv.mats.wood >= BUILD_COST * pieces || inv.mats.brick >= BUILD_COST * pieces || inv.mats.metal >= BUILD_COST * pieces;
}

/**
 * Judgment roll: does the bot check whether its trait-driven idea makes sense right now? Rolled per
 * decision `key` with probability `judgment` and kept for a 4-8 s window — a weak bot sometimes
 * makes a bad call (charging with a sniper, trying to build without materials), but not forever and
 * not every time. `memo` is a per-bot Map.
 */
export function judge(memo, key, judgment, now, rng) {
  const e = memo.get(key);
  if (e && now < e.until) return e.ok;
  const ok = rng.next() < judgment;
  memo.set(key, { ok, until: now + 4 + rng.next() * 4 });
  return ok;
}
