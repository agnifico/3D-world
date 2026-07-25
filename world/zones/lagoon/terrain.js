// =============================================================================
// Zone 2 — "The Shallows"  ·  a sunken archipelago
// -----------------------------------------------------------------------------
// Pure data + math. NO three imports (so terrainHeight() stays testable in Node,
// same discipline as Grassland's world.js). Everything a rendering layer needs
// is expressed as plain numbers / hex strings / arrays.
//
// Coordinate convention: X east, Z south, Y up. Sea level is WATER_Y.
// "depth" everywhere means (WATER_Y - terrainHeight): positive = underwater.
// =============================================================================


// ─────────────────────────────────────────────────────────────────────────────
//  MATH HELPERS  (private, pure)
// ─────────────────────────────────────────────────────────────────────────────
// clamp01/lerp deduped into core/math.js (this file, lagoon-fx.js, AND
// grassland/world.js each had their own copy — see core/math.js's header for
// what's NOT deduped and why: smoothstep/fbm/vnoise/raisedCos/hash2 below
// have no real Grassland equivalent, so they stay put).
import { clamp01, lerp } from '../../core/math.js';
const PI = Math.PI;

// smoothstep that also works "reversed" (e0 > e1) to invert the ramp
function smoothstep(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  t = clamp01(t);
  return t * t * (3 - 2 * t);
}

// raised-cosine dome: 1 at t=0, 0 at t=1, ZERO slope at both ends.
// This is what guarantees gentle beaches (no cliff-drop at the waterline).
function raisedCos(t) {
  t = clamp01(t);
  return 0.5 * (1 + Math.cos(PI * t));
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > PI) d -= 2 * PI;
  while (d < -PI) d += 2 * PI;
  return d;
}

// distance from point (px,pz) to segment (ax,az)->(bx,bz)
function segDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const apx = px - ax, apz = pz - az;
  const len2 = abx * abx + abz * abz || 1e-6;
  let t = (apx * abx + apz * abz) / len2;
  t = clamp01(t);
  const cx = ax + abx * t, cz = az + abz * t;
  return Math.hypot(px - cx, pz - cz);
}

// integer hash -> 0..1  (stable, no Math.sin drift)
function hash2(ix, iz) {
  let h = (ix | 0) * 374761393 + (iz | 0) * 668265263;
  h = (h ^ (h >> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967295;
}

// smooth value noise, returns 0..1
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz),     b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

// fractal brownian motion, returns roughly -1..1
function fbm(x, z, oct = 4) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * (vnoise(x * freq, z * freq) * 2 - 1);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}


// ─────────────────────────────────────────────────────────────────────────────
//  WORLD CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
export const WORLD_EXTENT = 100;   // world spans [-100, 100] on X and Z (same as Grassland)
export const WATER_Y = 0;   // sea level. Everything below is water — most of the map.

// ── 1. Deep sea floor ─────────────────────────────────────────────────────────
const DEEP_FLOOR_Y     = -16.0;  // base plane, well below the surface
const DEEP_UNDULATION  = 1.7;    // gentle rolling amplitude of the deep floor
const DEEP_SCALE       = 0.014;  // horizontal frequency of that rolling

// ── 2. Lagoon basin (the bright shallow shelf — where most swimming happens) ───
export const LAGOON_CX        = 0;      // shelf centre X
export const LAGOON_CZ        = -2;     // shelf centre Z
const SHELF_Y          = -2.6;   // shelf floor depth (1.5–4 below surface -> reads shallow)
const SHELF_RADIUS     = 46;     // broad shelf, roughly the middle third of the map
const SHELF_EDGE       = 15;     // gentle blend width from shelf down to deep floor
const SHELF_WOBBLE     = 9;      // organic wobble on the shelf outline
const SHELF_WOBBLE_SCL = 0.03;
const SHELF_NOISE      = 0.55;   // small ripples on the shelf floor
const SHELF_NOISE_SCL  = 0.06;

// ── 5. The Drop (signature drop-off from shelf into deep water) ────────────────
// A sharp escarpment on ONE bearing of the shelf edge. A swimmer heading that way
// meets it and feels the floor fall away.
export const DROP_BEARING     = PI * 0.5; // +Z (south-ish per convention); atan2(dz,dx)
const DROP_ARC         = 1.05;     // angular half-width of the sharp sector (radians)
const DROP_EDGE        = 2.2;      // tiny blend width here = dramatic cliff

// ── 6. Reef ring (partial, submerged, textures the far water & hints boundary) ─
export const REEF_RADIUS      = 78;     // distance from shelf centre
const REEF_WIDTH       = 13;     // radial thickness of the ring
const REEF_TOP         = -1.0;   // crest depth (submerged 0.5–2)
const REEF_NOISE       = 0.8;    // lumpiness of the crest
const REEF_LUMPS       = 5.0;    // how many gaps/segments around the ring
const REEF_GAP_LO      = 0.34;   // gap thresholds (a partial, broken ring)
const REEF_GAP_HI      = 0.62;

// ── 3. Islets (radial bumps breaking the surface) ─────────────────────────────
// peak = height above WATER_Y at the centre; r = footprint radius; rough = noise amp.
// At least one big (beach + prop dressing), at least two tiny.
export const ISLETS = [
  { name: 'Longbeach',  x: -23, z: -37, r: 39, peak: 5.0, rough: 0.65 }, // BIG — broad, spacious beach + palms
  { name: 'Kiln',       x:  31, z:   9, r: 16, peak: 3.6, rough: 0.7 },
  { name: 'Warden',     x: -35, z:  22, r: 14, peak: 3.1, rough: 0.7 },
  { name: 'Pebble',     x:  14, z:  -9, r:  8, peak: 1.7, rough: 0.4 },
  { name: 'Gull',       x:  41, z: -23, r:  5, peak: 1.2, rough: 0.3 }, // tiny
  { name: 'Lone Stack', x:  -7, z:  31, r:  4.5, peak: 2.4, rough: 0.3 }, // tiny sea-stack by the Drop
];

// ── 4. Sandbars (barely-breaking ridges — wadeable causeways between islets) ───
// top ~ WATER_Y so they surface only just. Great readable traversal.
export const SANDBARS = [
  { ax: -23, az: -37, bx: 14, bz:  -9, width: 6.5, top:  0.12, rough: 0.35 }, // Longbeach -> Pebble
  { ax:  14, az:  -9, bx: 31, bz:   9, width: 5.5, top: -0.05, rough: 0.30 }, // Pebble -> Kiln (just submerged)
  { ax: -35, az:  22, bx: -7, bz:  31, width: 5.0, top:  0.08, rough: 0.30 }, // Warden -> Lone Stack
];


// ─────────────────────────────────────────────────────────────────────────────
//  TERRAIN HEIGHT  —  pure math, the level itself
// ─────────────────────────────────────────────────────────────────────────────
export function terrainHeight(x, z) {
  // 1. deep sea floor -------------------------------------------------------
  let h = DEEP_FLOOR_Y + fbm(x * DEEP_SCALE, z * DEEP_SCALE, 3) * DEEP_UNDULATION;

  // 2. lagoon shelf ---------------------------------------------------------
  const dx = x - LAGOON_CX, dz = z - LAGOON_CZ;
  const r = Math.hypot(dx, dz);
  const ang = Math.atan2(dz, dx);
  const wobble = fbm(x * SHELF_WOBBLE_SCL, z * SHELF_WOBBLE_SCL, 2) * SHELF_WOBBLE;
  const shelfR = SHELF_RADIUS + wobble;

  // 5. the Drop: shrink the edge blend on the drop bearing -> sharp escarpment
  const dropK = smoothstep(DROP_ARC, DROP_ARC * 0.4, Math.abs(angleDiff(ang, DROP_BEARING)));
  const edge = lerp(SHELF_EDGE, DROP_EDGE, dropK);
  const inside = smoothstep(shelfR + edge, shelfR - edge, r); // 1 on shelf, 0 in deep
  const shelfLevel = SHELF_Y + fbm(x * SHELF_NOISE_SCL, z * SHELF_NOISE_SCL, 3) * SHELF_NOISE;
  h = lerp(h, shelfLevel, inside);

  // 6. reef ring (partial, only outside the shelf) --------------------------
  const reefBand = raisedCos(Math.abs(r - REEF_RADIUS) / REEF_WIDTH);
  const reefGap = smoothstep(REEF_GAP_LO, REEF_GAP_HI, vnoise(ang * REEF_LUMPS, r * 0.05));
  const reefAmt = reefBand * reefGap * (1 - inside);
  const reefLevel = REEF_TOP + fbm(x * 0.08, z * 0.08, 2) * REEF_NOISE;
  h = lerp(h, Math.max(h, reefLevel), reefAmt);

  // 3 + 4. islets and sandbars rise toward their target height from the floor
  // (max of contributions, so overlaps don't stack; zero at footprint edge => gentle)
  let contrib = 0;
  for (let i = 0; i < ISLETS.length; i++) {
    const is = ISLETS[i];
    const d = Math.hypot(x - is.x, z - is.z);
    if (d < is.r) {
      const dome = raisedCos(d / is.r);
      const target = is.peak + fbm(x * 0.09, z * 0.09, 3) * is.rough;
      contrib = Math.max(contrib, (target - h) * dome);
    }
  }
  for (let i = 0; i < SANDBARS.length; i++) {
    const b = SANDBARS[i];
    const d = segDist(x, z, b.ax, b.az, b.bx, b.bz);
    if (d < b.width) {
      const dome = raisedCos(d / b.width);
      const target = b.top + fbm(x * 0.16, z * 0.16, 2) * b.rough;
      contrib = Math.max(contrib, (target - h) * dome);
    }
  }
  h += contrib;

  return h;
}

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
      id: 'kelp',                                   // tall swaying fronds, deep areas
      count: 240, minDepth: 4.5, maxDepth: 13.0, slopeMin: 0.55, place: 'seabed',
      height: [2.6, 5.6], radius: [0.10, 0.20], sway: 0.6, swayScale: 0.45,
      color: '#3f7d5a', colorNight: '#123038', glowNight: 0.0,
    },
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
    {
      id: 'palm',                                   // silhouette placeholders (Quaternius later)
      count: 30, minDepth: -6.0, maxDepth: -0.7, slopeMin: 0.62, place: 'land',
      height: [4.0, 7.0], sway: 0.18, swayScale: 0.3,
      color: '#3c6b3a', colorNight: '#12222a', trunk: '#b9a17a', trunkNight: '#2a2b28', glowNight: 0.0,
    },
  ],
};


// ─────────────────────────────────────────────────────────────────────────────
//  SPAWN POINTS  &  PORTALS
// ─────────────────────────────────────────────────────────────────────────────
const SHORE_XZ = [-14, -22];  // on Longbeach's shallow beach
const BOAT_XZ  = [6, -4];     // out on the bright lagoon shelf

export const spawnPoints = {
  // A shore spawn on the big islet's beach, looking out over the lagoon.
  shore: {
    position: [SHORE_XZ[0], terrainHeight(SHORE_XZ[0], SHORE_XZ[1]) + 1.7, SHORE_XZ[1]],
    lookAt: [10, WATER_Y - 1, 20],
    eyeHeight: 1.7,
  },
  // A boat spawn floating on the shelf, looking toward the Drop.
  boat: {
    position: [BOAT_XZ[0], WATER_Y + 1.1, BOAT_XZ[1]],
    lookAt: [-7, WATER_Y - 2, 31],
    eyeHeight: 1.1,
  },
};

export const portals = [
  // A ruin arch standing in shallow water near the Lone Stack, at the Drop's mouth.
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
// build(ctx)/update(dt,camera)/dispose() on top). This file stays pure data
// + math only.
