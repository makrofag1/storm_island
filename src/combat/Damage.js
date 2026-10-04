// Pure damage / healing math (unit tested).
import { RARITY_DMG } from './Items.js';

export function falloffMul(def, dist) {
  const [d0, d1, min] = def.falloff;
  if (dist <= d0) return 1;
  if (dist >= d1) return min;
  return 1 + (min - 1) * (dist - d0) / (d1 - d0);
}

/** Damage of a single bullet/pellet. */
export function hitDamage(def, rarity, dist, head) {
  return def.damage * RARITY_DMG[rarity] * falloffMul(def, dist) * (head ? def.head : 1);
}

/** Shield absorbs first unless bypassed (storm/fall). Mutates stats {health, shield}. */
export function applyDamageToStats(stats, amount, bypassShield = false) {
  let a = Math.max(0, amount);
  let shieldDamage = 0;
  if (!bypassShield && stats.shield > 0) {
    shieldDamage = Math.min(stats.shield, a);
    stats.shield -= shieldDamage;
    a -= shieldDamage;
  }
  const healthDamage = Math.min(stats.health, a);
  stats.health -= a;
  if (stats.health < 0) stats.health = 0;
  return { shieldDamage, healthDamage, total: shieldDamage + healthDamage, dead: stats.health <= 0 };
}

/** Can a consumable be used right now? */
export function canUseConsumable(stats, def) {
  if (def.throwable) return true;
  if (def.heal) return stats.health < def.healCap;
  if (def.shield) return stats.shield < def.shieldCap;
  return false;
}

/** Apply consumable effect. Returns true if anything changed. */
export function applyConsumable(stats, def) {
  if (!canUseConsumable(stats, def)) return false;
  if (def.heal) stats.health = Math.min(def.healCap, stats.health + def.heal);
  if (def.shield) stats.shield = Math.min(def.shieldCap, stats.shield + def.shield);
  return true;
}
