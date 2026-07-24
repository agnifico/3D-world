// Grassland World — terrain math and layout data. Pure functions of (x, z);
// no THREE import, no rendering concerns, so this module is plain-JS testable.
export const WATER_Y = -0.9;
export const PATH = [[-10,-45],[5,-28],[11,-11],[15,8],[24,32],[30,40]];
// Channel: starts INSIDE the lake (connects lagoon → main body), flows down
// through the bridge crossing at (11,-12), then swings west/north AROUND the
// hamlet (was cutting straight through it and flooding the houses) before
// exiting the south-west corner.
export const STREAM = [[58,50],[48,32],[40,16],[26,2],[11,-12],[-6,-20],[-24,-26],[-44,-38],[-62,-54]];
export const LAKE = { x: 60, z: 55 };

export function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
export function distPoly(px, pz, pts) {
  let d = 1e9;
  for (let i = 0; i < pts.length - 1; i++)
    d = Math.min(d, distSeg(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return d;
}
export const clamp01 = v => Math.max(0, Math.min(1, v));
// 1 inside `inner`, fades to 0 at `outer`
export function fall(d, inner, outer) { const t = clamp01((d - inner) / (outer - inner)); return 1 - t * t * (3 - 2 * t); }

export function rawHeight(x, z) {
  let h = Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.028 + 0.4) * 2.0
        + Math.sin(x * 0.048 + 4.1) * Math.sin(z * 0.043 + 2.0) * 0.9
        + Math.sin(x * 0.11 + 0.7) * Math.cos(z * 0.09 + 5.1) * 0.35 + 0.6;
  const dx = x - LAKE.x, dz = z - LAKE.z, d = Math.hypot(dx, dz), ang = Math.atan2(dz, dx);
  const r = 34 + Math.sin(ang * 3 + 1.2) * 5 + Math.sin(ang * 7 + 0.5) * 2;
  const tL = fall(d, r - 12, r + 8);
  const tS = fall(distPoly(x, z, STREAM), 1.5, 5.5);
  const sink = Math.max(tL, tS * 0.92);
  return h * (1 - sink) - Math.max(tL * 4.2, tS * 2.4);
}
// flat pads for buildings
export const FLATTENS = [
  { x: -14, z: -48, r: 7 }, { x: -4, z: -52, r: 7 }, { x: -16, z: -38, r: 7 },
  { x: -8, z: -44, r: 4.5 }, { x: -2, z: -46, r: 4 },
  { x: -55, z: 60, r: 7 }, { x: 55, z: -55, r: 7 }, { x: -60, z: -15, r: 7 },
];
for (const f of FLATTENS) f.h = rawHeight(f.x, f.z);
export function terrainHeight(x, z) {
  let h = rawHeight(x, z);
  for (const f of FLATTENS) {
    const t = fall(Math.hypot(x - f.x, z - f.z), f.r * 0.55, f.r);
    h = h + (f.h - h) * t;
  }
  return h;
}

// ---- height-contributor registry ----
// groundHeight = max over every registered contributor. Terrain registers
// itself below; the bridge (props.js) and boats (boats.js) register theirs
// from their own modules at import time, so world.js never has to import
// them back — that would-be circular dependency (props.js/boats.js need
// terrainHeight too) is exactly what this registry breaks.
// `label` is optional and purely diagnostic (see resolveSupport) — passing
// it doesn't change groundHeight's behavior at all.
const _contributors = []; // { fn, label }
export function registerHeightContributor(fn, label) { _contributors.push({ fn, label: label || fn.name || 'unknown' }); }
export function groundHeight(x, z) {
  let h = -Infinity;
  for (const c of _contributors) { const v = c.fn(x, z); if (v > h) h = v; }
  return h;
}
// Same max-over-contributors computation as groundHeight, but also reports
// which one won — for the __footing() debug HUD and (per Brief 4 Part 0)
// eventually the wade/swim depth fix itself.
export function resolveSupport(x, z) {
  let h = -Infinity, contributor = null;
  for (const c of _contributors) { const v = c.fn(x, z); if (v > h) { h = v; contributor = c.label; } }
  return { height: h, contributor };
}
registerHeightContributor(terrainHeight, 'terrain');
