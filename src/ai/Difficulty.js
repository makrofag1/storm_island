// Bot difficulty presets. Mixed lobbies blend them.
// settle: how much worse the aim is right after spotting a target (multiplier on the 2 s settle-in)
// pauseMul: length of the pauses between bursts; engage: bonus to the "take this fight" roll

export const DIFFICULTIES = {
  easy: {
    name: 'easy', reaction: 0.7, aimError: 0.12, turnSpeed: 3.0, fireMul: 1.7, spreadMul: 1.3, aggression: 0.3,
    buildChance: 0.12, lootSmart: 0.45, viewDist: 85, hearing: 0.65, memory: 4, headshot: 0.04, strafe: 0.4, jumpy: 0.12, ads: 0.3, lead: 0.3, cover: 0.35, grenade: 0.25, breach: 0.3,
    settle: 1.3, pauseMul: 1.3, engage: 0,
  },
  medium: {
    name: 'medium', reaction: 0.34, aimError: 0.06, turnSpeed: 5.5, fireMul: 1.18, spreadMul: 1.06, aggression: 0.6,
    buildChance: 0.45, lootSmart: 0.8, viewDist: 120, hearing: 0.9, memory: 7, headshot: 0.14, strafe: 0.8, jumpy: 0.3, ads: 0.7, lead: 0.75, cover: 0.75, grenade: 0.65, breach: 0.7,
    settle: 1.0, pauseMul: 0.9, engage: 0.15,
  },
  hard: {
    name: 'hard', reaction: 0.16, aimError: 0.026, turnSpeed: 9, fireMul: 1.0, spreadMul: 0.95, aggression: 0.85,
    buildChance: 0.85, lootSmart: 1, viewDist: 160, hearing: 1.15, memory: 10, headshot: 0.3, strafe: 1.1, jumpy: 0.5, ads: 1, lead: 1.0, cover: 1.0, grenade: 0.95, breach: 1.0,
    settle: 0.55, pauseMul: 0.5, engage: 0.5,
  },
  expert: {
    name: 'expert', reaction: 0.11, aimError: 0.017, turnSpeed: 12, fireMul: 1.0, spreadMul: 0.85, aggression: 0.95,
    buildChance: 0.95, lootSmart: 1, viewDist: 180, hearing: 1.25, memory: 12, headshot: 0.4, strafe: 1.2, jumpy: 0.6, ads: 1, lead: 1.1, cover: 1.1, grenade: 1.0, breach: 1.0,
    settle: 0.3, pauseMul: 0.3, engage: 0.8,
  },
};

export const DIFFICULTY_IDS = ['easy', 'medium', 'hard', 'expert'];

export function difficultyFor(setting, i, rng) {
  if (DIFFICULTIES[setting]) return { ...DIFFICULTIES[setting] };
  const k = rng.weighted([0.28, 0.4, 0.24, 0.08]);
  return { ...DIFFICULTIES[DIFFICULTY_IDS[k]] };
}
