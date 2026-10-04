// Bot personalities: on top of the difficulty preset every bot gets a play style that shifts its
// skills (difficulty numbers) and its behaviour weights (weapon taste, preferred range, building,
// risk taking). Shown in the kill feed / spectate bar so players can tell them apart.

const BASE = {
  rangeMul: 1,        // preferred fighting distance multiplier
  weaponPref: {},     // weapon type -> bonus when choosing / looting weapons
  matsGoal: 1,        // how many materials the bot wants before it stops gathering
  buildRate: 1,       // build cooldown divider
  preBuild: 0,        // chance per second to build cover / high ground before being shot
  retreatHp: 40,      // hp+shield below which a losing fight is abandoned
  engageBonus: 0,     // added to the "is this contact worth a fight" roll
  stormEarly: 0,      // extra seconds of margin when rotating
  healBias: 1,        // heal desire multiplier
  fightGrenades: 0,   // chance to throw grenades during a visible fight, not only when hunting
  lootBias: 1,        // loot desire multiplier
};

export const PERSONAS = {
  builder: {
    id: 'builder', name: 'Builder', icon: '🔨', weight: 0.2,
    tune(d) {
      d.buildChance = Math.min(0.97, d.buildChance * 1.8 + 0.2);
      d.cover = Math.min(1.2, (d.cover ?? 0.5) + 0.2);
    },
    traits: { matsGoal: 2.2, buildRate: 2.2, preBuild: 0.9, weaponPref: { shotgun: 1.5, ar: 1 } },
  },
  sharpshooter: {
    id: 'sharpshooter', name: 'Sharpshooter', icon: '🎯', weight: 0.18,
    tune(d) {
      d.aimError *= 0.6;
      d.headshot = Math.min(0.6, d.headshot * 2 + 0.08);
      d.ads = 1;
      d.lead = Math.min(1.15, (d.lead ?? 0.5) + 0.3);
      d.viewDist *= 1.25;
      d.turnSpeed *= 1.15;
      d.spreadMul *= 0.9;
      d.aggression *= 0.85;
    },
    traits: { rangeMul: 1.5, weaponPref: { sniper: 4, ar: 2.5, pistol: 1, shotgun: -1.5, smg: -0.5 } },
  },
  rusher: {
    id: 'rusher', name: 'Rusher', icon: '⚡', weight: 0.2,
    tune(d) {
      d.aggression = Math.min(1, d.aggression + 0.35);
      d.reaction *= 0.8;
      d.strafe = Math.min(1.25, d.strafe + 0.3);
      d.jumpy += 0.3;
      d.cover = (d.cover ?? 0.5) * 0.5;
      d.memory *= 1.4;
      d.hearing *= 1.2;
      d.aimError *= 1.1;
    },
    traits: { rangeMul: 0.6, retreatHp: 22, engageBonus: 0.3, weaponPref: { shotgun: 3, smg: 3, sniper: -2.5, rocket: -1 } },
  },
  survivor: {
    id: 'survivor', name: 'Survivor', icon: '🛡', weight: 0.15,
    tune(d) {
      d.aggression *= 0.5;
      d.cover = Math.min(1.2, (d.cover ?? 0.5) + 0.4);
      d.hearing *= 1.2;
      d.viewDist *= 1.1;
    },
    traits: { retreatHp: 75, engageBonus: -0.2, stormEarly: 25, healBias: 1.4, lootBias: 1.15, weaponPref: { ar: 1.5 } },
  },
  tactician: {
    id: 'tactician', name: 'Tactician', icon: '💣', weight: 0.12,
    tune(d) {
      d.grenade = Math.min(1, (d.grenade ?? 0.5) + 0.4);
      d.breach = Math.min(1, (d.breach ?? 0.5) + 0.4);
      d.cover = Math.min(1.2, (d.cover ?? 0.5) + 0.2);
    },
    traits: { fightGrenades: 0.45, weaponPref: { rocket: 3, ar: 1 } },
  },
  balanced: {
    id: 'balanced', name: 'All-rounder', icon: '', weight: 0.15,
    tune() {},
    traits: {},
  },
};

const LIST = Object.values(PERSONAS);

/** Pick a personality and apply it to (a copy of) the difficulty preset. */
export function assignPersona(diff, rng, forced = null) {
  const def = forced && PERSONAS[forced] ? PERSONAS[forced] : LIST[rng.weighted(LIST.map((p) => p.weight))];
  const d = { ...diff };
  def.tune(d);
  const traits = { ...BASE, ...def.traits, weaponPref: { ...def.traits.weaponPref } };
  return { persona: { id: def.id, name: def.name, icon: def.icon }, diff: d, traits };
}
