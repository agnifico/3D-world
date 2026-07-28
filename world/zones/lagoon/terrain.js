// =============================================================================
// Zone 2 — "The Shallows"  ·  a sunken archipelago
// -----------------------------------------------------------------------------
// The heightfield is built from a hand-painted band map (map.png) via
// core/terrain-from-map.js (see that file for the band->height/blur/noise
// pipeline). That loader is browser-only (offscreen canvas image decode),
// so — unlike the old procedural version — this module is no longer
// Node-testable in isolation; terrainHeight/depthAt/terrainNormal are still
// exported with the exact same signatures the zone contract expects, just
// backed by a loaded grid instead of live fbm math.
//
// Coordinate convention: X east, Z south, Y up. Sea level is WATER_Y.
// "depth" everywhere means (WATER_Y - terrainHeight): positive = underwater.
// =============================================================================
import { loadTerrainMap } from '../../core/terrain-from-map.js';


// ─────────────────────────────────────────────────────────────────────────────
//  WORLD CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
export const WORLD_EXTENT = 100;   // world spans [-100, 100] on X and Z (same as Grassland)
export const WATER_Y = 0;   // sea level. Everything below is water — most of the map.

// LAGOON_CX/CZ, DROP_BEARING, REEF_RADIUS, ISLETS, SANDBARS below are the old
// procedural model's landmark data — kept as plain literals (zone.js still
// imports these names for its unused-downstream `landmarks` bundle) but no
// longer fed into terrainHeight, which is now map-driven (see LEGEND below).
export const LAGOON_CX     = 0;
export const LAGOON_CZ     = -2;
export const DROP_BEARING  = Math.PI * 0.5;
export const REEF_RADIUS   = 78;

// peak = height above WATER_Y at the centre; r = footprint radius; rough = noise amp.
export const ISLETS = [
  { name: 'Longbeach',  x: -23, z: -37, r: 39, peak: 5.0, rough: 0.65 }, // BIG — broad, spacious beach + palms
  { name: 'Kiln',       x:  31, z:   9, r: 25, peak: -0.01, rough: 0.7 },
  { name: 'Warden',     x: -35, z:  22, r: 14, peak: 3.1, rough: 0.7 },
  { name: 'Pebble',     x:  14, z:  -9, r:  8, peak: 1.0, rough: 0.4 },
  { name: 'Gull',       x:  41, z: -23, r:  5, peak: 1.2, rough: 0.3 }, // tiny
  { name: 'Lone Stack', x:  -7, z:  31, r:  4.5, peak: 2.4, rough: 0.3 }, // tiny sea-stack by the Drop
];
export const SANDBARS = [
  { ax: -23, az: -37, bx: 14, bz:  -9, width: 20, top:  0.2, rough: 1 }, // Longbeach -> Pebble
  { ax:  14, az:  -9, bx: 31, bz:   9, width: 10, top: -0.05, rough: 0.30 }, // Pebble -> Kiln (just submerged)
  { ax: -35, az:  22, bx: -7, bz:  31, width: 5.0, top:  0.08, rough: 0.30 }, // Warden -> Lone Stack
];


// ─────────────────────────────────────────────────────────────────────────────
//  TERRAIN HEIGHT  —  built from map.png (lunalaguna) via terrain-from-map.js.
//  Band heights below are DERIVED, not guessed: they're the midpoint of each
//  band's actual movement-behavior range read straight out of
//  character/controller.js's footing thresholds (WADE_START=0.45,
//  SWIM_DEPTH=1.2 — see that file's "swim tuning" constants). REEF/DEEP have
//  no controller threshold of their own (both already read as "swim" once
//  depth passes SWIM_DEPTH) — REEF reuses the old procedural shelf depth
//  (-2.6, "most swimming happens, floor visible") and DEEP reuses the old
//  procedural deep-floor depth (-16.0, "well below the surface") as the
//  closest existing precedent for where this game already drew that line.
//    LAND     height  0.8   comfortably dry (> STEP_UP=0.5, never reads wet)
//    SHALLOW  height -0.22  mid(0, WADE_START=0.45)           -> runnable
//    WADE     height -0.82  mid(WADE_START=0.45, SWIM_DEPTH=1.2) -> walk-only
//    REEF     height -2.6   old SHELF_Y precedent              -> swim, floor visible
//    DEEP     height -16.0  old DEEP_FLOOR_Y precedent          -> swim, high sea
// ─────────────────────────────────────────────────────────────────────────────
const LEGEND = [
  { id: 'LAND',    color: '#ff9100', height:  0.8 },
  { id: 'SHALLOW', color: '#ffeb00', height: -0.22 },
  { id: 'WADE',    color: '#00d6ff', height: -0.82 },
  { id: 'REEF',    color: '#007dff', height: -2.6 },
  { id: 'DEEP',    color: '#002b99', height: -16.0 },
];

// blurRadius/blurPasses tuned so the transition band (~2.5 world units) reads
// as a gentle slope without eroding the smallest painted landmark (the
// "one single big rock" islet, ~3-unit footprint radius) — a wider/softer
// blur would wash it flat. A future cliffy zone would want blurRadius:1,
// blurPasses:1 (next to no smoothing) instead.
export const { terrainHeight, bandAt } = await loadTerrainMap(
  new URL('./map.png', import.meta.url).href,
  LEGEND,
  {
    extent: WORLD_EXTENT,
    tolerance: 60,
    blurRadius: 4,
    blurPasses: 3,
    noiseAmp:   { LAND: 0.5, SHALLOW: 0, WADE: 0, REEF: 0.4, DEEP: 1.7 }, // land dunes / flat shallows·wade / reef floor texture / deep swell
    noiseScale: { LAND: 0.09, REEF: 0.06, DEEP: 0.014 }, // matches the old dune / shelf / deep-floor noise frequencies
  }
);

// Convenience (pure): depth below the surface, positive underwater.
export function depthAt(x, z) {
  return WATER_Y - terrainHeight(x, z);
}

// Convenience (pure): terrain surface normal via finite differences.
// Returns [nx, ny, nz], normalized. Used for slope tests in the scatterer.
export function terrainNormal(x, z, eps = 0.5) {
  const hL = terrainHeight(x - eps, z);
  const hR = terrainHeight(x + eps, z);
  const hD = terrainHeight(x, z - eps);
  const hU = terrainHeight(x, z + eps);
  const nx = hL - hR;
  const nz = hD - hU;
  const ny = 2 * eps;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}


// ─────────────────────────────────────────────────────────────────────────────
//  PALETTES  —  same shape as Grassland's lighting palettes, plus `underwater`.
//  Colours are hex strings so this module stays three-free; the renderer wraps
//  them in THREE.Color.
// ─────────────────────────────────────────────────────────────────────────────
export const PALETTES = {
  // ── DAY: warm, bright, weightless. Sun on turquoise water. ──────────────────
  day: {
    sky: '#a7deeb',
    fog:        { color: '#cfeef0', near: 55, far: 235 },
    hemisphere: { sky: '#e2f6fa', ground: '#e8d6ac', intensity: 0.95 },
    sun:        { color: '#fff4de', intensity: 1.55, direction: [0.42, 0.8, 0.28] },
    // depthStops: [depthBelowWater, hexColor] — near-white at the waterline,
    // bright turquoise over the shelf, deepening to blue-teal over the drop.
    water: {
      opacity: 0.94,
      depthStops: [[0.0, '#a9ece4'], [1.8, '#20c4cc'], [6.0, '#0d93bd'], [15.0, '#0a5680']],
      surfaceTint: '#c6eff0',   // fresnel sky tint at grazing angles
      sunColor:    '#fff6df',   // specular glints
      shimmer:     0.6,
      foam:        '#f4fbf6',   // shoreline foam / wet-sand band
      foamBand:    0.7,         // depth (units) over which foam fades out
      ceiling:     '#c3eef0',   // the surface seen from BELOW (bright ceiling)
      sunDisc:     '#fff3cf',   // sun shimmer visible through the ceiling
    },
    terrain: { sand: '#e8d7ad', wetSand: '#cbb488', rock: '#d9d3c3', deepTint: '#8bb0a6' },
    terrainGrade: '#ffffff',   // no grade at midday (baked vertex colours show as-is)
    bloom:   { strength: 0.55, radius: 0.55, threshold: 0.82 },
    underwater: {
      fogColor: '#1fb2c6', fogDensity: 0.030, // linear-fog feel; ~25u visibility
      tint: '#2fc4d2', tintStrength: 0.26,     // full-screen colour grade
      ambient: 0.58,                           // extra fill so seabed stays legible
      causticStrength: 0.95,
      godrayColor: '#eafffb', godrayStrength: 0.5,
      moteColor: '#dff6f2',
      bioluminescence: 0.0,
    },
  },

  // ── AFTERNOON: high, warm, sunny — the brightest, clearest hour. ──────────
  afternoon: {
    sky: '#bfe4e6',
    fog:        { color: '#dcefe6', near: 60, far: 250 },
    hemisphere: { sky: '#ecf7f2', ground: '#f0dcac', intensity: 1.05 },
    sun:        { color: '#ffe7b8', intensity: 1.8, direction: [-0.05, 0.72, -0.4] }, // strong warm sun
    water: {
      opacity: 0.94,
      depthStops: [[0.0, '#bdeede'], [1.8, '#2fccc4'], [6.0, '#118fb0'], [15.0, '#0a5578']],
      surfaceTint: '#dff3ea',
      sunColor:    '#fff2cf',
      shimmer:     0.7,
      foam:        '#f6fbf4',
      foamBand:    0.7,
      ceiling:     '#cdefe4',
      sunDisc:     '#ffe9b0',
    },
    terrain: { sand: '#e8d7ad', wetSand: '#cbb488', rock: '#d9d3c3', deepTint: '#8bb0a6' },
    terrainGrade: '#fff3e2',   // faint warm-gold cast
    bloom:   { strength: 0.6, radius: 0.55, threshold: 0.8 },
    underwater: {
      fogColor: '#25b6c0', fogDensity: 0.028,
      tint: '#33c6cc', tintStrength: 0.24,
      ambient: 0.6,
      causticStrength: 1.05,
      godrayColor: '#fff4e0', godrayStrength: 0.6,  // warm shafts
      moteColor: '#eaf7ee',
      bioluminescence: 0.0,
    },
  },

  // ── DUSK / EVENING: purple · pink · yellow pastel — soft, warm, luminous. ────
  dusk: {
    sky: '#dcb8dd',
    fog:        { color: '#e9c4d2', near: 40, far: 210 },
    hemisphere: { sky: '#f0c9e0', ground: '#f2d6a6', intensity: 0.82 }, // pink sky + warm yellow bounce
    sun:        { color: '#ffb27a', intensity: 1.05, direction: [-0.5, 0.3, -0.5] }, // low golden-pink sun
    water: {
      opacity: 0.93,
      depthStops: [[0.0, '#f0cfd6'], [1.8, '#b3b8e2'], [6.0, '#7a7fc6'], [15.0, '#565aa0']], // peach → lavender → dusky purple
      surfaceTint: '#ffd9e0',
      sunColor:    '#ffdca8',
      shimmer:     0.8,
      foam:        '#fdeede',    // warm cream-yellow foam
      foamBand:    0.7,
      ceiling:     '#dcc2e2',
      sunDisc:     '#ffd39a',    // golden sun disc
    },
    terrain: { sand: '#e8d7ad', wetSand: '#cbb488', rock: '#d9d3c3', deepTint: '#8bb0a6' },
    terrainGrade: '#ffd6dd',   // soft pink cast → pastel sand
    bloom:   { strength: 0.85, radius: 0.6, threshold: 0.6 },
    underwater: {
      fogColor: '#9a7ec4', fogDensity: 0.033,
      tint: '#ab90d4', tintStrength: 0.3,
      ambient: 0.52,
      causticStrength: 0.72,
      godrayColor: '#ffd6c2', godrayStrength: 0.48,
      moteColor: '#f2d9ff',      // pink-lavender motes
      bioluminescence: 0.45,
    },
  },

  // ── NIGHT: deep, moonlit, purple-blue — a high sea the archipelago sits in. ──
  night: {
    sky: '#141636',
    fog:        { color: '#1c2b58', near: 30, far: 200 },   // clearly BLUE + far: reads as open high sea, not grey fog
    hemisphere: { sky: '#3a4a86', ground: '#3a3550', intensity: 0.5 }, // lifted so land mounds aren't black
    sun:        { color: '#aebbff', intensity: 0.7, direction: [-0.3, 0.66, -0.34] }, // brighter moon: sand catches light
    water: {
      opacity: 0.95,
      depthStops: [[0.0, '#4a5c9e'], [1.8, '#33489a'], [6.0, '#22357e'], [15.0, '#182a63']], // purple-blue, high-sea
      surfaceTint: '#5566a8',
      sunColor:    '#cdd6ff',   // moon glints
      shimmer:     0.85,
      foam:        '#9fb0d8',   // cool foam, not harsh white
      foamBand:    0.7,
      ceiling:     '#1e2f5e',
      sunDisc:     '#e6ecff',   // moon disc through the ceiling
    },
    terrain: { sand: '#5c5847', wetSand: '#494636', rock: '#54514a', deepTint: '#26424a' }, // (inert; graded via terrainGrade)
    terrainGrade: '#7a82c4',   // dusky blue-lavender cast on the day sand — fixes the metallic look
    bloom:   { strength: 1.15, radius: 0.62, threshold: 0.5 },
    underwater: {
      fogColor: '#122a5a', fogDensity: 0.04,   // blue, a touch less dense
      tint: '#1c3170', tintStrength: 0.4,
      ambient: 0.34,                            // seabed stays legible
      causticStrength: 0.4,
      godrayColor: '#bcd0ff', godrayStrength: 0.3,
      moteColor: '#a8d6ff',                     // blue plankton
      bioluminescence: 1.0,
    },
  },
};

// Ordered palette keyframes the day→night slider interpolates across (t in 0..1).
export const dayCycle = [
  { t: 0.0,  key: 'day' },
  { t: 0.35, key: 'afternoon' },
  { t: 0.65, key: 'dusk' },
  { t: 1.0,  key: 'night' },
];


// ─────────────────────────────────────────────────────────────────────────────
//  SCATTER RECIPE  —  declarative procedural flora / coral placement.
//  The renderer (lagoon-fx) builds ONE InstancedMesh per kind from this.
//  depth is (WATER_Y - terrainHeight): positive = underwater, negative = above.
//  slopeMax is the minimum acceptable up-facing normal.y (1 = flat, 0 = vertical).
// ─────────────────────────────────────────────────────────────────────────────
export const scatterRecipe = {
  seed: 92771,
  area: { min: -95, max: 95 },
  kinds: [
    {
      id: 'coral',                                  // low-poly clusters — the reef ACCENT: ONE 3-colour family
      count: 280, minDepth: 1.0, maxDepth: 9.0, slopeMin: 0.35, place: 'seabed',
      scale: [0.5, 1.5], sway: 0.0,
      colors:      ['#ff4d6d', '#ff7ec4', '#a25cff'],   // rose · pink · violet
      colorsNight: ['#ff5f83', '#ff92d2', '#bf8cff'],   // same family, neon at night
      glowNight: 1.0,
    },
    {
      id: 'seagrass',                               // short dense patches, lagoon shelf
      count: 950, minDepth: 0.6, maxDepth: 4.5, slopeMin: 0.6, place: 'seabed',
      height: [0.4, 1.0], sway: 0.75, swayScale: 1.2,
      color: '#5f9e5c', colorNight: '#1c3a30', glowNight: 0.16,
    },
    {
      id: 'shells',                                 // tiny detail on the sand — kept NEUTRAL (cream) so it adds no stray hue
      count: 440, minDepth: 0.05, maxDepth: 3.6, slopeMin: 0.55, place: 'seabed',
      scale: [0.05, 0.14],
      colors:      ['#f3e3c8', '#ecd6b4', '#f7efe0'],
      colorsNight: ['#8f8c96', '#7d8a90', '#7a7480'], glowNight: 0.0,
    },
    {
      id: 'reeds',                                  // waterline band, above the shell line
      count: 280, minDepth: -0.35, maxDepth: 0.55, slopeMin: 0.5, place: 'waterline',
      height: [0.9, 1.9], sway: 0.6, swayScale: 1.0,
      color: '#c7b24a', colorNight: '#38472a', glowNight: 0.0,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
//  CATALOGUE BANDS  —  depth-band data (same discipline as scatterRecipe
//  above, kept here rather than in the renderer) for the real-GLB scatter
//  kinds zones/lagoon/catalogue-flora.js builds — Brief 9's palms/seaweed/
//  reef rocks/shore vegetation. `palm` supersedes the old procedural `palm`
//  kind (removed above) AND the temp-real-palms.js swap-in hack (retired —
//  see TEMP-MODELS.md); `seaweed` supersedes the old procedural `kelp` kind
//  at the same reef depth band, now real Simple_Nature grass stretched tall
//  + thin instead of hand-rolled blade geometry.
// ─────────────────────────────────────────────────────────────────────────────
export const catalogueBands = {
  palm: { count: 30, minDepth: -6.0, maxDepth: -0.7, slopeMin: 0.62 },
  seaweed: { count: 220, minDepth: 4.5, maxDepth: 13.0, slopeMin: 0.55 },
  reefRock: { count: 60, minDepth: 0.5, maxDepth: 4.0, slopeMin: 0.5 },
  shoreBush: { count: 40, minDepth: -1.2, maxDepth: 0.8, slopeMin: 0.55 },
};


// ─────────────────────────────────────────────────────────────────────────────
//  SPAWN POINTS  &  PORTALS
// ─────────────────────────────────────────────────────────────────────────────
// RELOCATED for the new map (the old coordinates were tuned to the
// procedural islets above and both landed in open DEEP water under
// lunalaguna.png — checked via terrainHeight/bandAt against the actual
// loaded grid, not eyeballed). New spots sit on/around the SW atoll cluster
// (the map's biggest landmass + its lagoon interior):
const SHORE_XZ = [-40, 52];  // on the SW atoll's main landmass, facing its lagoon (north)
const BOAT_XZ  = [-15, 10];  // afloat in that atoll's open reef interior

export const spawnPoints = {
  // A shore spawn on the SW atoll's beach, looking out over its lagoon.
  shore: {
    position: [SHORE_XZ[0], terrainHeight(SHORE_XZ[0], SHORE_XZ[1]) + 1.7, SHORE_XZ[1]],
    lookAt: [-15, WATER_Y - 1, 10],
    eyeHeight: 1.7,
  },
  // A boat spawn floating in the atoll's lagoon, looking toward the drowned arch.
  boat: {
    position: [BOAT_XZ[0], WATER_Y + 1.1, BOAT_XZ[1]],
    lookAt: [6, WATER_Y - 2, 20],
    eyeHeight: 1.1,
  },
};

export const portals = [
  // A ruin arch standing in reef water off the SW atoll cluster. UNCHANGED
  // coordinates: checked against the new map (bandAt(6,20) === 'REEF', depth
  // 2.6 — still solidly submerged, same as it was under the old procedural
  // terrain), so no move was needed here.
  {
    id: 'drowned-arch',
    x: 6, z: 20,
    targetZone: 'grassland',
    targetPortal: 'shore-arch',
  },
];


// Note: this module used to have a default export bundling all of the above
// into one "zone" object — that role now belongs to ./zone.js (the Zone
// contract wrapper, which imports everything from here and adds
// build(ctx)/update(dt,camera)/dispose() on top). This file stays data +
// terrain-loading glue only.
