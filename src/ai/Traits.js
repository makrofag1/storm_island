// Bot character traits: WHAT a bot likes to do (play style), independent of HOW WELL it does it
// (that is the difficulty preset: aim, reaction, and `judgment` — how reliably the bot checks whether
// a trait-driven idea makes sense right now, see Tactics.judge).
// Every bot starts from an archetype template (Builder, Rusher, ...) and each trait is shifted by a
// random amount, so two Rushers still play a bit differently. All values are 0..1 (0.5 = neutral).

export const TRAITS = {
  build:       { hi: 'builds a lot',        lo: 'rarely builds' },        // defends / takes height by building
  caution:     { hi: 'cautious',            lo: 'fearless' },             // hides, avoids fights
  push:        { hi: 'pushes close',        lo: 'keeps distance' },       // closes the distance to enemies
  greed:       { hi: 'greedy looter',       lo: 'travels light' },        // loots longer, goes for chests and drops
  stormTiming: { hi: 'rotates early',       lo: 'plays the storm edge' }, // rotation margin
  thirdParty:  { hi: 'third-partier',       lo: 'minds its own business' }, // goes for the sound of other fights
  highGround:  { hi: 'loves high ground',   lo: null },                   // hills, roofs, ramps
  patience:    { hi: 'patient ambusher',    lo: 'restless' },             // waits in cover for enemies to come
  persistence: { hi: 'relentless chaser',   lo: 'lets enemies go' },      // chases fleeing enemies
  risk:        { hi: 'risk-taker',          lo: 'plays it safe' },        // fights on at low health, heals late
  utility:     { hi: 'grenade lover',       lo: null },                   // grenades, rockets on builds
};
export const TRAIT_KEYS = Object.keys(TRAITS);

// preferred weapon class (0..1 each): close = shotgun/SMG, mid = AR/pistol, long = sniper, explosive = rocket
export const WEAPON_CLASSES = { close: ['shotgun', 'smg'], mid: ['ar', 'pistol'], long: ['sniper'], explosive: ['rocket'] };
const WEAPON_LABELS = { close: 'loves shotguns', mid: 'rifle fan', long: 'sniper lover', explosive: 'explosives fan' };

// Archetypes: trait means (unlisted traits = 0.5) + preferred weapon classes.
export const ARCHETYPES = {
  builder:      { name: 'Builder',      icon: '🔨', weight: 0.14, t: { build: 0.92, caution: 0.45, push: 0.55, highGround: 0.75 }, w: { close: 0.7, mid: 0.65 } },
  rusher:       { name: 'Rusher',       icon: '⚡', weight: 0.14, t: { push: 0.92, caution: 0.1, risk: 0.85, persistence: 0.8, patience: 0.15, build: 0.4 }, w: { close: 0.92, long: 0.1 } },
  survivor:     { name: 'Survivor',     icon: '🛡', weight: 0.12, t: { caution: 0.9, risk: 0.12, stormTiming: 0.9, push: 0.25, patience: 0.6, persistence: 0.25 }, w: { mid: 0.7 } },
  sharpshooter: { name: 'Sharpshooter', icon: '🎯', weight: 0.12, t: { push: 0.1, highGround: 0.85, patience: 0.65, caution: 0.55 }, w: { long: 0.95, mid: 0.7, close: 0.2 } },
  tactician:    { name: 'Tactician',    icon: '💣', weight: 0.1,  t: { utility: 0.95, build: 0.6, thirdParty: 0.55 }, w: { explosive: 0.9, mid: 0.6 } },
  hunter:       { name: 'Hunter',       icon: '🐺', weight: 0.1,  t: { thirdParty: 0.92, persistence: 0.9, push: 0.65, risk: 0.6, caution: 0.2 }, w: { mid: 0.75, close: 0.6 } },
  camper:       { name: 'Camper',       icon: '⛺', weight: 0.09, t: { patience: 0.95, highGround: 0.8, caution: 0.65, push: 0.2, stormTiming: 0.7, greed: 0.35 }, w: { mid: 0.65, long: 0.65 } },
  scavenger:    { name: 'Scavenger',    icon: '🎒', weight: 0.09, t: { greed: 0.95, caution: 0.55, stormTiming: 0.6, thirdParty: 0.3 }, w: {} },
  balanced:     { name: 'All-rounder',  icon: '',   weight: 0.1,  t: {}, w: {} },
};
const ARCH_LIST = Object.entries(ARCHETYPES);

const clamp01 = (v) => Math.max(0, Math.min(1, v));
function gauss(rng) {
  const u = Math.max(1e-6, rng.next()), v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Roll a bot's profile: archetype + individually shifted traits. Deterministic for an RNG state. */
export function rollProfile(rng, forced = null) {
  const id = forced && ARCHETYPES[forced] ? forced : ARCH_LIST[rng.weighted(ARCH_LIST.map(([, a]) => a.weight))][0];
  const a = ARCHETYPES[id];
  const traits = {};
  for (const k of TRAIT_KEYS) traits[k] = clamp01((a.t[k] ?? 0.5) + gauss(rng) * 0.15);
  traits.weapon = {};
  for (const k in WEAPON_CLASSES) traits.weapon[k] = clamp01((a.w[k] ?? 0.5) + gauss(rng) * 0.15);
  return { persona: { id, name: a.name, icon: a.icon }, traits };
}

/**
 * The most distinctive traits as short labels (for the spectate bar). With `archetype`, traits that
 * merely restate it ("Tactician · grenade lover") rank last, so the labels say what is special about
 * this particular bot.
 */
export function topTraits(traits, n = 2, archetype = null) {
  const a = ARCHETYPES[archetype];
  const defining = (mean, v) => mean !== undefined && Math.abs(mean - 0.5) > 0.3 && (mean > 0.5) === (v > 0.5);
  const c = [];
  for (const k of TRAIT_KEYS) {
    const v = traits[k], dev = Math.abs(v - 0.5), label = v >= 0.5 ? TRAITS[k].hi : TRAITS[k].lo;
    if (label && dev > 0.2) c.push([dev - (a && defining(a.t[k], v) ? 1 : 0), label]);
  }
  let wk = null;
  for (const k in traits.weapon) if (traits.weapon[k] > 0.75 && (!wk || traits.weapon[k] > traits.weapon[wk])) wk = k;
  if (wk) c.push([traits.weapon[wk] - 0.5 - (a && defining(a.w[wk], traits.weapon[wk]) ? 1 : 0), WEAPON_LABELS[wk]]);
  return c.sort((x, y) => y[0] - x[0]).slice(0, n).map((e) => e[1]);
}

/**
 * Behaviour numbers derived from the traits (what the bot code reads). Kept here so the mapping is
 * in one place and testable.
 */
export function behaviour(t) {
  const wp = {};
  for (const k in WEAPON_CLASSES) for (const type of WEAPON_CLASSES[k]) wp[type] = (t.weapon[k] - 0.5) * 6; // -3..+3
  return {
    weaponPref: wp,                                  // weapon type -> taste bonus (loot + equip)
    rangeMul: 1.45 - t.push * 0.95,                  // preferred fighting distance multiplier (0.5..1.45)
    matsGoal: 0.5 + t.build * 1.9,                   // how many materials it wants before it stops farming
    buildRate: 0.5 + t.build * 1.9,                  // build cooldown divider
    buildMul: 0.25 + t.build * 1.5,                  // multiplier on the difficulty's buildChance
    preBuild: Math.max(0, t.build - 0.55) * 2,       // chance/s to build cover or height before being shot
    engage: (0.5 - t.caution) * 0.9 + (t.risk - 0.5) * 0.2, // added to the "take this fight" roll
    holdChance: Math.max(0, t.caution - 0.45) * 1.6, // chance to hide instead of fighting a fresh contact
    ambush: Math.max(0, t.patience - 0.5) * 2,       // waits in cover for enemies to walk in
    stormEarly: t.stormTiming * 35 - 8,              // extra seconds of margin when rotating (-8..+27)
    retreatHp: 18 + (1 - t.risk) * 62,               // hp+shield below which a losing fight is abandoned
    healBias: 0.65 + (1 - t.risk) * 0.8,
    lootBias: 0.7 + t.greed * 0.7,
    lootRadius: 32 + t.greed * 35,
    investigate: 0.35 + t.thirdParty * 1.3,          // weight of going towards heard gunfights
    huntTime: 8 + t.persistence * 22,                // seconds it keeps searching for a lost enemy
    memoryMul: 0.7 + t.persistence * 0.7,
    fightGrenades: Math.max(0, t.utility - 0.5) * 1.1,
    breach: (t.utility - 0.5) * 0.6,
    highGround: t.highGround,
  };
}
