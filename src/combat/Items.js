// Item / weapon definitions and loot tables. Pure data.

export const AMMO_TYPES = ['light', 'medium', 'heavy', 'shells', 'rockets'];
export const AMMO_NAMES = { light: 'Light Ammo', medium: 'Medium Ammo', heavy: 'Heavy Ammo', shells: 'Shells', rockets: 'Rockets' };
export const AMMO_MAX = { light: 240, medium: 240, heavy: 60, shells: 60, rockets: 12 };
export const AMMO_PICKUP = { light: 30, medium: 24, heavy: 8, shells: 8, rockets: 3 };

// Rarity scaling: index 0..4 (common..legendary)
export const RARITY_DMG = [1.0, 1.05, 1.1, 1.16, 1.22];
export const RARITY_RELOAD = [1.0, 0.94, 0.88, 0.82, 0.76];
export const RARITY_SPREAD = [1.0, 0.93, 0.86, 0.79, 0.72];

export const WEAPONS = {
  ar: {
    name: 'Assault Rifle', short: 'AR', ammo: 'medium', mag: 30, rate: 5.5, auto: true, damage: 31,
    reload: 2.4, spread: 0.028, adsSpread: 0.012, bloomShot: 0.012, bloomMax: 0.07, bloomDecay: 0.18,
    falloff: [45, 140, 0.65], head: 2, recoil: 0.011, range: 400, pellets: 1, structMul: 1, sound: 'ar',
    rarities: [0, 1, 2, 3, 4], fov: 60,
  },
  shotgun: {
    name: 'Pump Shotgun', short: 'SG', ammo: 'shells', mag: 5, rate: 0.75, auto: false, damage: 9.5,
    reload: 4.6, spread: 0.075, adsSpread: 0.06, bloomShot: 0, bloomMax: 0, bloomDecay: 1,
    falloff: [7, 30, 0.25], head: 2, recoil: 0.05, range: 60, pellets: 10, structMul: 1, sound: 'shotgun',
    rarities: [0, 1, 2, 3, 4], fov: 72,
  },
  smg: {
    name: 'SMG', short: 'SMG', ammo: 'light', mag: 30, rate: 12, auto: true, damage: 17,
    reload: 2.0, spread: 0.045, adsSpread: 0.03, bloomShot: 0.006, bloomMax: 0.06, bloomDecay: 0.25,
    falloff: [18, 60, 0.55], head: 1.75, recoil: 0.006, range: 200, pellets: 1, structMul: 1, sound: 'smg',
    rarities: [0, 1, 2, 3, 4], fov: 68,
  },
  sniper: {
    name: 'Sniper Rifle', short: 'SNP', ammo: 'heavy', mag: 1, rate: 0.36, auto: false, damage: 104,
    // no spread at all: the bullet flies exactly where you aim and only drops with flight time (gravity)
    reload: 2.7, spread: 0, adsSpread: 0, bloomShot: 0, bloomMax: 0, bloomDecay: 1,
    falloff: [400, 800, 1], head: 2.5, recoil: 0.06, range: 1200, pellets: 1, structMul: 1, sound: 'sniper',
    projectile: { speed: 500, gravity: 8, fromEye: true }, rarities: [2, 3, 4], fov: 22, scope: true,
  },
  pistol: {
    name: 'Pistol', short: 'PST', ammo: 'light', mag: 16, rate: 6.5, auto: false, damage: 24,
    reload: 1.5, spread: 0.026, adsSpread: 0.012, bloomShot: 0.016, bloomMax: 0.06, bloomDecay: 0.22,
    falloff: [25, 80, 0.6], head: 2, recoil: 0.01, range: 200, pellets: 1, structMul: 1, sound: 'pistol',
    rarities: [0, 1, 2, 3, 4], fov: 66,
  },
  rocket: {
    name: 'Rocket Launcher', short: 'RKT', ammo: 'rockets', mag: 1, rate: 0.8, auto: false, damage: 105,
    reload: 3.4, spread: 0.02, adsSpread: 0.0, bloomShot: 0, bloomMax: 0, bloomDecay: 1,
    falloff: [999, 999, 1], head: 1, recoil: 0.05, range: 500, pellets: 1, structMul: 4, sound: 'rocket',
    projectile: { speed: 65, gravity: 0, explode: { radius: 4.5, structDmg: 450 } }, rarities: [3, 4], fov: 62,
  },
};

export const CONSUMABLES = {
  bandage: { name: 'Bandages', stack: 15, time: 3.2, heal: 15, healCap: 75, color: '#f0f0f0' },
  medkit: { name: 'Med Kit', stack: 3, time: 8, heal: 100, healCap: 100, color: '#ff5050' },
  smallshield: { name: 'Small Shield', stack: 6, time: 2, shield: 25, shieldCap: 50, color: '#55b8ff' },
  bigshield: { name: 'Shield Potion', stack: 3, time: 4.5, shield: 50, shieldCap: 100, color: '#2d7cff' },
  grenade: { name: 'Grenade', stack: 6, time: 0, throwable: true, color: '#7d9c4f', damage: 95, radius: 5, structDmg: 300 },
};

export const MATERIALS = ['wood', 'brick', 'metal'];

export function weaponDamage(type, rarity) {
  return WEAPONS[type].damage * RARITY_DMG[rarity];
}

/** Value score used by bots to compare items. */
export function itemScore(item) {
  if (!item) return 0;
  if (item.kind === 'weapon') {
    const base = { ar: 10, shotgun: 9.5, smg: 7.5, sniper: 8, pistol: 4, rocket: 7 }[item.type] ?? 3;
    return base + item.rarity * 2.2;
  }
  if (item.kind === 'consumable') return { bandage: 3, medkit: 5, smallshield: 4.5, bigshield: 6, grenade: 3 }[item.type] ?? 1;
  return 0;
}

export function makeWeapon(type, rarity) {
  return { kind: 'weapon', type, rarity, mag: WEAPONS[type].mag };
}

/** Roll an item for a loot source. src: 'floor' | 'chest' */
export function rollLoot(rng, src = 'floor') {
  const out = [];
  const rarityWeights = src === 'chest' ? [0, 38, 34, 20, 8] : [42, 32, 17, 7, 2];
  const pickWeapon = () => {
    const types = ['ar', 'shotgun', 'smg', 'pistol', 'sniper', 'rocket'];
    const weights = src === 'chest' ? [30, 26, 18, 8, 12, 6] : [28, 24, 20, 18, 7, 3];
    let type = types[rng.weighted(weights)];
    let r = rng.weighted(rarityWeights);
    const allowed = WEAPONS[type].rarities;
    if (!allowed.includes(r)) r = r < allowed[0] ? allowed[0] : allowed[allowed.length - 1];
    return makeWeapon(type, r);
  };
  const ammoFor = (w) => ({ kind: 'ammo', type: WEAPONS[w.type].ammo, count: AMMO_PICKUP[WEAPONS[w.type].ammo] * (src === 'chest' ? 2 : 1) });
  const pickConsumable = () => {
    const types = ['bandage', 'medkit', 'smallshield', 'bigshield', 'grenade'];
    const type = types[rng.weighted([28, 10, 26, 14, 14])];
    const count = { bandage: 5, medkit: 1, smallshield: 3, bigshield: 1, grenade: 3 }[type];
    return { kind: 'consumable', type, count };
  };
  if (src === 'chest') {
    const w = pickWeapon();
    out.push(w, ammoFor(w), pickConsumable());
    out.push({ kind: 'material', type: rng.pick(MATERIALS), count: 30 });
    if (rng.chance(0.35)) out.push(pickConsumable());
    return out;
  }
  if (src === 'ammobox') {
    const a = rng.pick(['light', 'medium', 'shells', 'heavy', 'medium', 'light']);
    out.push({ kind: 'ammo', type: a, count: AMMO_PICKUP[a] * 2 });
    const b = rng.pick(['light', 'medium', 'shells']);
    out.push({ kind: 'ammo', type: b, count: AMMO_PICKUP[b] });
    return out;
  }
  const roll = rng.weighted([46, 22, 20, 12]);
  if (roll === 0) { const w = pickWeapon(); out.push(w, ammoFor(w)); }
  else if (roll === 1) { const a = rng.pick(['light', 'medium', 'shells', 'heavy', 'medium', 'light', 'shells']); out.push({ kind: 'ammo', type: a, count: AMMO_PICKUP[a] }); }
  else if (roll === 2) out.push(pickConsumable());
  else out.push({ kind: 'material', type: rng.pick(MATERIALS), count: rng.pick([20, 30, 40]) });
  return out;
}

export function itemName(item) {
  if (item.kind === 'weapon') return WEAPONS[item.type].name;
  if (item.kind === 'consumable') return CONSUMABLES[item.type].name;
  if (item.kind === 'ammo') return AMMO_NAMES[item.type];
  if (item.kind === 'material') return item.type[0].toUpperCase() + item.type.slice(1);
  return '?';
}
