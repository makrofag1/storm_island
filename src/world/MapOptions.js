// Map generation options (Settings → Map) and the visual themes (season / biome) they select.
// Every option also has 'random', resolved per match from the map seed so a seed stays reproducible.

export const MAP_OPTIONS = {
  mapSize: { label: 'Island size', values: [['normal', 'Normal'], ['small', 'Small'], ['large', 'Large']] },
  mapTerrain: { label: 'Terrain', values: [['hills', 'Hills'], ['flat', 'Flat'], ['mountains', 'Mountains']] },
  mapTheme: { label: 'Season / biome', values: [['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter'], ['desert', 'Desert']] },
  mapWater: { label: 'Water', values: [['lake', 'Lake'], ['dry', 'No lake'], ['islands', 'Archipelago (channels)']] },
  mapTowns: { label: 'Buildings', values: [['normal', 'Normal'], ['few', 'Few'], ['many', 'Many']] },
  mapForest: { label: 'Vegetation', values: [['normal', 'Normal'], ['sparse', 'Sparse'], ['dense', 'Dense']] },
};

export const MAP_DEFAULTS = { mapSize: 'normal', mapTerrain: 'hills', mapTheme: 'summer', mapWater: 'lake', mapTowns: 'normal', mapForest: 'normal' };

export const THEMES = {
  summer: {
    fog: 0xa9cdee, clear: 0x87b8e8, skyTop: [0.22, 0.5, 0.95], skyHor: [0.72, 0.86, 0.98],
    leaves: [[0x2f6b3a, 0x3a7d44, 0x2a5e36], [0x5fae3e, 0x6fbf4a, 0x4f9c38, 0x86c05a], [0x9fd05a, 0xb5d86a, 0xe0c050]],
    trunks: [0x6b4a2f, 0x7a5434, 0xe8e4da], treeWeights: [0.45, 0.4, 0.15],
    bushes: [0x4f9a3a, 0x5aa845, 0x3f8a34, 0x6cb04c], grass: [0x5aa83e, 0x6ab84a, 0x4c9a34, 0x7cc05a], grassMul: 1,
    forestMul: 1, rockMul: 1,
  },
  autumn: {
    fog: 0xd8c8b0, clear: 0xb8c4d4, skyTop: [0.35, 0.52, 0.82], skyHor: [0.9, 0.84, 0.74],
    leaves: [[0x2f5a36, 0x3a6b40, 0x5a6a2a], [0xd9792a, 0xc4472c, 0xe8a83a, 0xb85a26], [0xf0c040, 0xe8a030, 0xd8d060]],
    trunks: [0x5e4029, 0x6e4a2e, 0xe0dccf], treeWeights: [0.3, 0.45, 0.25],
    bushes: [0xa8642a, 0xc08a34, 0x8a5a2a, 0x9c7a34], grass: [0xa89a48, 0xb8a050, 0x8f8a3c, 0xc2a85a], grassMul: 0.8,
    forestMul: 1, rockMul: 1,
  },
  winter: {
    fog: 0xdfe8f2, clear: 0xc4d4e6, skyTop: [0.42, 0.58, 0.82], skyHor: [0.88, 0.92, 0.97],
    leaves: [[0x24503a, 0x2c5c42, 0x335f4a], [0xe8eef4, 0xd8e2ea, 0xf4f8fb], [0xdfe7ee, 0xeef3f7, 0xc9d6e0]],
    trunks: [0x4e3a2a, 0x5a4636, 0xd8d6cf], treeWeights: [0.8, 0.1, 0.1],
    bushes: [0xe6edf3, 0xd4dee8, 0xc8d6e2, 0xf0f4f8], grass: [0xd8e2ea, 0xc8d6e0, 0xe4ebf1, 0xbfcfdb], grassMul: 0.25,
    forestMul: 0.9, rockMul: 1.2, snowRoofs: true,
  },
  desert: {
    fog: 0xe8d8b8, clear: 0xc8d8e8, skyTop: [0.3, 0.55, 0.9], skyHor: [0.95, 0.88, 0.74],
    leaves: [[0x5a7040, 0x667a46, 0x4e6438], [0x8a9a48, 0x9aa852, 0x7a8a40], [0xa8b058, 0xb8b868, 0x98a050]],
    trunks: [0x7a5a3a, 0x8a6a44, 0xd8ccb0], treeWeights: [0.15, 0.35, 0.5],
    bushes: [0x8a8a4a, 0x9a9050, 0x7a7a40, 0xa8985a], grass: [0xb8a868, 0xc8b878, 0xa89858, 0xd0c088], grassMul: 0.35,
    forestMul: 0.3, rockMul: 1.8,
  },
};

function pick(setting, key, rng) {
  const vals = MAP_OPTIONS[key].values.map((v) => v[0]);
  if (setting === 'random' || !vals.includes(setting)) return vals[Math.floor(rng.next() * vals.length)];
  return setting;
}

/** Turn the settings (possibly 'random') into concrete generation parameters for one match. */
export function resolveMapOptions(settings, rng) {
  const r = rng.fork('mapoptions');
  const o = {};
  for (const k of Object.keys(MAP_OPTIONS)) o[k] = pick(settings[k] ?? MAP_DEFAULTS[k], k, r);
  const theme = THEMES[o.mapTheme];
  return {
    ...o,
    theme, themeId: o.mapTheme,
    landScale: { small: 0.78, normal: 1, large: 1.06 }[o.mapSize],
    hillAmp: { flat: 0.35, hills: 1, mountains: 1.55 }[o.mapTerrain],
    mountainAmp: { flat: 0.5, hills: 1, mountains: 1.3 }[o.mapTerrain],
    extraPeak: o.mapTerrain === 'mountains',
    lake: o.mapWater !== 'dry',
    islands: o.mapWater === 'islands',
    townMul: { few: 0.6, normal: 1, many: 1.5 }[o.mapTowns],
    siteCount: { few: 7, normal: 16, many: 30 }[o.mapTowns],
    forestMul: { sparse: 0.4, normal: 1, dense: 1.8 }[o.mapForest] * theme.forestMul,
  };
}

/** Default parameters (used by tests / tools that build a Heightmap without settings). */
export const DEFAULT_MAP = {
  ...MAP_DEFAULTS, theme: THEMES.summer, themeId: 'summer', landScale: 1, hillAmp: 1, mountainAmp: 1, extraPeak: false,
  lake: true, islands: false, townMul: 1, siteCount: 16, forestMul: 1,
};
