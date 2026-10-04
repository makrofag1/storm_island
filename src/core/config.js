// Global tuning constants for Storm Island. Units: meters, seconds.

export const WORLD_SIZE = 1536;
export const HALF = WORLD_SIZE / 2;
export const HM_RES = 2;              // heightmap sample spacing (m)
export const SEA_LEVEL = 0;
export const WATER_FLOAT_Y = -1.3;    // feet height while swimming

export const CELL = 4;                // build grid cell size (m)
export const LEVEL_H = 3;             // build grid level height (m)

export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;

export const GRAVITY = 22;
export const JUMP_VEL = 8;
export const CHAR_RADIUS = 0.4;
export const CHAR_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.25;
export const STEP_UP = 0.65;
export const WALK_SPEED = 6;
export const SPRINT_SPEED = 8.5;
export const CROUCH_SPEED = 3;
export const SWIM_SPEED = 3.6;
export const FALL_DAMAGE_VEL = 18;    // impact speed above which fall damage applies

export const MAX_MATS = 999;
export const BUILD_COST = 10;

export const RARITIES = [
  { name: 'Common', color: '#b8b8b8', hex: 0xb8b8b8 },
  { name: 'Uncommon', color: '#5fd35a', hex: 0x5fd35a },
  { name: 'Rare', color: '#3fa0ff', hex: 0x3fa0ff },
  { name: 'Epic', color: '#b866ff', hex: 0xb866ff },
  { name: 'Legendary', color: '#ffb52e', hex: 0xffb52e },
];

// renderScale > 1 supersamples (sharper edges even on 1080p screens where devicePixelRatio is 1);
// softShadows = PCF soft filtering; wind = swaying grass; terrainRes = terrain mesh spacing (m);
// cinematic = ACES filmic tone mapping (punchier colours and highlights).
export const QUALITY = {
  low:    { pixelRatio: 0.75, renderScale: 1,    shadows: false, shadowSize: 0,    shadowRange: 0,   softShadows: false, terrainRes: 8, grass: 0,     grassRange: 0,   wind: false, drawDist: 380,  particles: 500,  charDist: 260 },
  medium: { pixelRatio: 1.0,  renderScale: 1,    shadows: true,  shadowSize: 1024, shadowRange: 55,  softShadows: false, terrainRes: 4, grass: 5000,  grassRange: 110, wind: false, drawDist: 620,  particles: 1200, charDist: 420 },
  high:   { pixelRatio: 1.5,  renderScale: 1.25, shadows: true,  shadowSize: 4096, shadowRange: 120, softShadows: true,  terrainRes: 2, grass: 24000, grassRange: 150, wind: true,  drawDist: 1150, particles: 2600, charDist: 800, cinematic: true },
};

export const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1';
