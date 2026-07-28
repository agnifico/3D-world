// =============================================================================
// Zone 3 — "Highland Terraces"  ·  a grassland→alpine transition
// -----------------------------------------------------------------------------
// Pure data + math. NO three imports (so terrainHeight() stays Node-testable,
// same discipline as Lagoon's terrain.js / Grassland's world.js). A rendering
// layer (highland-fx.js) turns these numbers + hex strings into THREE content.
//
// Coordinate convention: X east, Z south, Y up.  NORTH is -Z.
// The zone ascends south→north in three massive flat steps (plateaus),
// separated by sheer cliffs with a few localized walkable ramps. A deep gorge
// on the EAST edge holds the plunge pool; the highest plateau juts a rocky
// tongue out over it — the "leap of faith" diving point.
//
//   heights:  Plateau 1 (low) = 0   ·   Plateau 2 (mid) = 15   ·
//             Plateau 3 (high) = 35  ·   plunge-pool floor = -10  ·
//             foothill backdrop = 60+ (impassable range to the north)
// =============================================================================

import { clamp01, lerp } from '../../core/math.js';
const PI = Math.PI;

// ─────────────────────────────────────────────────────────────────────────────
//  MATH HELPERS  (private, pure)  — same shapes Lagoon uses; kept local so this
//  zone stays a self-contained drop-in and doesn't couple to Lagoon's file.
// ─────────────────────────────────────────────────────────────────────────────
function smoothstep(e0, e1, x) {           // works "reversed" (e0>e1) to flip the ramp
  let t = (x - e0) / (e1 - e0);
  t = clamp01(t);
  return t * t * (3 - 2 * t);
}
function raisedCos(t) {                     // 1 at t=0 → 0 at t=1, zero slope both ends
  t = clamp01(t);
  return 0.5 * (1 + Math.cos(PI * t));
}
function segDist(px, pz, ax, az, bx, bz) {  // point→segment distance (the diving tongue)
  const abx = bx - ax, abz = bz - az;
  const apx = px - ax, apz = pz - az;
  const len2 = abx * abx + abz * abz || 1e-6;
  let t = (apx * abx + apz * abz) / len2;
  t = clamp01(t);
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}
function hash2(ix, iz) {
  let h = (ix | 0) * 374761393 + (iz | 0) * 668265263;
  h = (h ^ (h >> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967295;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x, z, oct = 4) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * (vnoise(x * freq, z * freq) * 2 - 1);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

// ─────────────────────────────────────────────────────────────────────────────
//  WORLD CONSTANTS  (the elevation legend, as exact numbers)
// ─────────────────────────────────────────────────────────────────────────────
export const WORLD_EXTENT = 100;   // world spans [-100,100] on X and Z (same as the other zones)
// Water surface sits 1 unit below Plateau 1 (=0) so the low tier reads as dry
// land just above a lake, never flooded. Basin floor is -10 → ~9 units of deep
// water; the leap from Plateau 3 (35) is a ~36-unit fall into it.
export const WATER_Y = -1.0;

const LOW = 0, MID = 15, HIGH = 35;     // the three plateau heights (spec legend)
const POOL_FLOOR = -10;                 // carved plunge-pool basin

// tier boundaries (Z lines) + which X-corridor carries the walkable ramp
const B1_Z = 28,  RAMP1_X = -30;        // low→mid  boundary, ramp on the west
const B2_Z = -16, RAMP2_X = 8;          // mid→high boundary, ramp centre-ish
const RAMP_HALF = 15;                   // X half-width of a ramp corridor
const CLIFF_W = 3.0;                    // sheer-drop transition width (a cliff)
const RAMP_W  = 26;                     // gentle transition width inside a corridor (~30° ramp)

// north foothill backdrop
const FH_START = -60, FH_END = -96;

// east gorge / plunge pool footprint (a sharp-rimmed rectangle on the east edge)
export const POOL_RIM_X = 46;           // west rim (cliff into the gorge)
const POOL_EAST_X = 90;                 // pool stops here; rock wall beyond
const POOL_S_Z = 0, POOL_N_Z = -92;    // south / north pool walls
const RIM_W = 2.2;                       // pool-rim sharpness (small = cliff)

// the diving tongue — a narrow spur of Plateau-3 rock jutting east into the pool
const DIVE_BASE_X = 40, DIVE_TIP_X = 55, DIVE_Z = -40, DIVE_W = 3;

// ─────────────────────────────────────────────────────────────────────────────
//  private height sub-functions
// ─────────────────────────────────────────────────────────────────────────────
function stepNorth(z, zb, width) {                 // 0 south of the boundary, 1 north of it
  return smoothstep(zb + width * 0.5, zb - width * 0.5, z);
}
function transWidth(x, xr) {                        // narrow (cliff) except inside a ramp corridor
  const m = raisedCos(Math.min(1, Math.abs(x - xr) / RAMP_HALF));
  return lerp(CLIFF_W, RAMP_W, m);
}
function poolMask(x, z) {                           // 1 inside the pool basin, 0 outside (sharp)
  const west  = smoothstep(POOL_RIM_X - RIM_W, POOL_RIM_X + RIM_W, x);   // land → pool going east
  const east  = smoothstep(POOL_EAST_X + RIM_W, POOL_EAST_X - RIM_W, x); // inside → wall
  const south = smoothstep(POOL_S_Z + RIM_W, POOL_S_Z - RIM_W, z);       // 1 for z<POOL_S_Z
  const north = smoothstep(POOL_N_Z - RIM_W, POOL_N_Z + RIM_W, z);       // 1 for z>POOL_N_Z
  return west * east * south * north;
}
function edgeRise(x, z) {                           // soft containment on the non-north world edges
  let r = 0;
  r += smoothstep(84, 100, -x) * 14;   // far-west ridge
  r += smoothstep(86, 100, z)  * 9;    // far-south soft hill (the grassland-facing plain)
  r += smoothstep(92, 100, x)  * 24;   // far-east rock wall, beyond the pool
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
//  TERRAIN HEIGHT  —  the level itself (pure)
// ─────────────────────────────────────────────────────────────────────────────
export function terrainHeight(x, z) {
  // 1. stepped tiers: low → mid → high, cliffs by default, ramps in-corridor
  let h = LOW;
  h += (MID - LOW)  * stepNorth(z, B1_Z, transWidth(x, RAMP1_X));
  h += (HIGH - MID) * stepNorth(z, B2_Z, transWidth(x, RAMP2_X));

  // 2. faint surface noise so the flats aren't dead-flat (tiny — long sightlines
  //    and the "roam-ground reads open" pillar depend on staying nearly level)
  h += (vnoise(x * 0.05, z * 0.05) - 0.5) * 0.8;

  // 3. foothill backdrop climbing north of Plateau 3 (impassable bounding range)
  const fh = smoothstep(FH_START, FH_END, z);
  if (fh > 0) {
    const ridge = 30 + Math.max(0, fbm(x * 0.035, z * 0.06, 3)) * 44;
    h = lerp(h, HIGH + ridge, fh);
  }

  // 4. soft world-edge containment (W / S / far-E)
  h += edgeRise(x, z);

  // 5. carve the east gorge → plunge pool basin (sharp cliff rims)
  const pm = poolMask(x, z);
  if (pm > 0) {
    const floor = POOL_FLOOR + (vnoise(x * 0.08, z * 0.08) - 0.5) * 1.0;
    h = lerp(h, floor, pm);
  }

  // 6. the diving tongue: raise a narrow Plateau-3 spur out over the pool, so the
  //    high point overhangs deep water on three sides (the hero landmark + the
  //    one non-negotiable sightline). max() keeps it clean over the carved basin.
  const dsv = segDist(x, z, DIVE_BASE_X, DIVE_Z, DIVE_TIP_X, DIVE_Z);
  if (dsv < DIVE_W) {
    const spur = (HIGH + 0.5) - smoothstep(3, DIVE_W, dsv) * ((HIGH + 1) - (POOL_FLOOR + 2));
    h = Math.max(h, spur);
  }

  return h;
}

// depth below the surface, positive underwater (pure).
export function depthAt(x, z) { return WATER_Y - terrainHeight(x, z); }

// terrain surface normal via finite differences → [nx,ny,nz] normalized.
// Drives the slope-based cliff/edge shading and (later) the scatter slope test.
export function terrainNormal(x, z, eps = 0.5) {
  const hL = terrainHeight(x - eps, z), hR = terrainHeight(x + eps, z);
  const hD = terrainHeight(x, z - eps), hU = terrainHeight(x, z + eps);
  const nx = hL - hR, nz = hD - hU, ny = 2 * eps;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

// ─────────────────────────────────────────────────────────────────────────────
//  PALETTES  —  same schema the shell's lighting engine (core/lighting.js) reads
//  (sky / fog / hemisphere / sun / bloom), plus zone-specific water + terrain +
//  sky-gradient fields highland-fx.js consumes. Hex strings only (three-free).
//
//  MIDDAY is the built + graded phase (per the build directions). dawn/dusk/
//  night are the vetted FORWARD spec — carried here so the day-cycle is ready
//  the moment Brief 7's moving sun lands, but only midday is tuned against the
//  real renderer today.
// ─────────────────────────────────────────────────────────────────────────────
export const PALETTES = {
  // ── MIDDAY — crisp high-altitude blue overhead, pale dusty horizon. ──────────
  midday: {
    sky: '#D4D9C4',                                   // background base = horizon
    skyZenith: '#5C7C9E', skyHorizon: '#D4D9C4',      // vertical sky gradient
    fog: { color: '#D4D9C4', near: 120, far: 500 },   // preserves the high-cliff vista
    hemisphere: { sky: '#9CB1BD', ground: '#B9A583', intensity: 1.3 },
    sun: { color: '#FFF9ED', intensity: 1.9, direction: [0.40, 0.86, 0.28] }, // high midday, raked for cliff shape + long shadows
    water: { tint: '#ffffff', shallow: '#558896', deep: '#1D4F5C', opacity: 0.86 },
    terrain: { grass: '#76895D', cliff: '#8B7D73', edge: '#9C886B', pineScrub: '#3E523A', foothill: '#69717C', poolFloor: '#123138' },
    terrainGrade: '#ffffff',                          // no cast at midday (baked colours as-is)
    bloom: { strength: 0, radius: 0.5, threshold: 0.85 },
  },

  // ── DAWN — low warm sun, long cliff shadows (forward spec). ──────────────────
  dawn: {
    sky: '#E5CDB3', skyZenith: '#48607A', skyHorizon: '#E5CDB3',
    fog: { color: '#E5CDB3', near: 90, far: 450 },
    hemisphere: { sky: '#7E8A93', ground: '#8A7A67', intensity: 0.72 },
    sun: { color: '#FFC982', intensity: 1.25, direction: [0.72, 0.26, 0.36] }, // ~15°
    water: { tint: '#d8c3a8', shallow: '#5f8188', deep: '#28505a', opacity: 0.9 },
    terrain: { grass: '#76895D', cliff: '#8B7D73', edge: '#9C886B', pineScrub: '#3E523A', foothill: '#69717C', poolFloor: '#123138' },
    terrainGrade: '#f0d6b0',
    bloom: { strength: 0.25, radius: 0.5, threshold: 0.8 },
  },

  // ── DUSK — low orange sun, cooling shadows (forward spec). ───────────────────
  dusk: {
    sky: '#B39A96', skyZenith: '#374354', skyHorizon: '#B39A96',
    fog: { color: '#B39A96', near: 80, far: 400 },
    hemisphere: { sky: '#5A5560', ground: '#7A6355', intensity: 0.66 },
    sun: { color: '#E88151', intensity: 1.1, direction: [-0.7, 0.22, -0.4] }, // ~10°
    water: { tint: '#8f7d80', shallow: '#4a6b74', deep: '#213f4a', opacity: 0.9 },
    terrain: { grass: '#76895D', cliff: '#8B7D73', edge: '#9C886B', pineScrub: '#3E523A', foothill: '#69717C', poolFloor: '#123138' },
    terrainGrade: '#c99f93',
    bloom: { strength: 0.45, radius: 0.55, threshold: 0.7 },
  },

  // ── NIGHT — cool moonlight, deep haze (forward spec; zenith inherits core sky). ─
  night: {
    sky: '#151B24', skyZenith: '#1A2233', skyHorizon: '#151B24',
    fog: { color: '#151B24', near: 60, far: 300 },
    hemisphere: { sky: '#2C3752', ground: '#171C26', intensity: 0.5 },
    sun: { color: '#B5CBE6', intensity: 0.72, direction: [-0.2, 0.9, -0.3] }, // moon ~65°
    water: { tint: '#26405a', shallow: '#2c5566', deep: '#132a3a', opacity: 0.95 },
    terrain: { grass: '#76895D', cliff: '#8B7D73', edge: '#9C886B', pineScrub: '#3E523A', foothill: '#69717C', poolFloor: '#0d1f28' },
    terrainGrade: '#5a6784',
    bloom: { strength: 0.9, radius: 0.6, threshold: 0.55 },
  },
};

// Ordered keyframes the day→night slider interpolates across (ascending t).
// Midday sits at 0.35 so the shell's default "morning" start reads as first
// light climbing toward the tuned midday look.
export const dayCycle = [
  { t: 0.0,  key: 'dawn' },
  { t: 0.35, key: 'midday' },
  { t: 0.72, key: 'dusk' },
  { t: 1.0,  key: 'night' },
];

// ─────────────────────────────────────────────────────────────────────────────
//  LANDMARKS  —  numeric anchors highland-fx.js + preview.html reference.
// ─────────────────────────────────────────────────────────────────────────────
export const LANDMARKS = {
  plateaus: { low: LOW, mid: MID, high: HIGH },
  poolFloor: POOL_FLOOR,
  poolBox: { minX: POOL_RIM_X - 2, maxX: POOL_EAST_X + 2, minZ: POOL_N_Z - 2, maxZ: POOL_S_Z + 2 },
  divingPoint: [DIVE_TIP_X, HIGH + 1, DIVE_Z],   // the tongue's tip
};

// ─────────────────────────────────────────────────────────────────────────────
//  SPAWN POINTS  &  PORTALS
//  Rich {position,lookAt,eyeHeight} for the preview harness; zone.js normalizes
//  to the shell's generic {x,z} placement.
// ─────────────────────────────────────────────────────────────────────────────
export const spawnPoints = {
  // Entry from Grassland — lands on Plateau 1 (low tier), looking north up the
  // terraces toward the high cliff and pool.
  entry: {
    position: [36, terrainHeight(36, -36) + 1.7, -36],
    lookAt: [24, 12, -30],
    eyeHeight: 1.7,
  },
  // The diving point — on the tongue tip, looking down-east at the plunge pool
  // (the legibility crux sightline).
  dive: {
    position: [DIVE_TIP_X - 1, HIGH + 1 + 1.7, DIVE_Z],
    lookAt: [80, -3, -26],
    eyeHeight: 1.7,
  },
  // A ledge on Plateau 2, at the pool's south-west rim (near the return portal).
  pool: {
    position: [42, terrainHeight(42, 14) + 1.7, 14],
    lookAt: [72, WATER_Y, -20],
    eyeHeight: 1.7,
  },
};

export const portals = [
  // Arrival / return-to-Grassland arch, on Plateau 1 beside the entry spawn.
  // { id: 'terrace-arch', x: -14, z: 80, targetZone: 'grassland', targetPortal: 'highland-arch' },
  // Second arch on the Plateau-2 pool ledge ("[PORTAL]" on the spec map, SE).
  // Placeholder target Grassland for now — retargets to the future alpine zone.
  { id: 'plunge-arch',  x: 42,  z: 14, targetZone: 'grassland', targetPortal: 'highland-arch' },
];

// ─────────────────────────────────────────────────────────────────────────────
//  SCATTER RECIPE  —  HELD (per the spec appendix + build directions). Landed
//  only after the catalogue integrity pass confirms conifers/rocks/bushes exist
//  on disk. Declared now so the density intent travels with the zone; highland-
//  fx.js reads nothing from it until `held` flips false.
// ─────────────────────────────────────────────────────────────────────────────
export const scatterRecipe = {
  held: true,
  seed: 41207,
  area: { min: -95, max: 95 },
  intent: 'open plateau centres (very low density) · cluster dense rock + dry scrub along cliff borders and ramps to telegraph drops · frame the diving point with two uniquely-scaled towering pines/boulders as a cross-expanse landmark',
  kinds: [
    { id: 'boulder', asset: 'rock', place: 'edges',  minH: 2,  maxH: HIGH + 5, slopeMin: 0.2, density: 'high-at-cliff-borders', color: '#8B7D73' },
    { id: 'scrub',   asset: 'bush', place: 'edges',  minH: 2,  maxH: HIGH + 5, slopeMin: 0.55, density: 'high-at-cliff-borders', color: '#3E523A' },
    { id: 'conifer', asset: 'pine', place: 'alpine', minH: 18, maxH: HIGH + 8, slopeMin: 0.6,  density: 'sparse',                color: '#3E523A' },
    { id: 'hero-pines', asset: 'pine', place: 'landmark', at: [[DIVE_BASE_X - 3, DIVE_Z - 3], [DIVE_BASE_X - 5, DIVE_Z + 4]], scale: [1.8, 2.4], color: '#3E523A' },
  ],
};
