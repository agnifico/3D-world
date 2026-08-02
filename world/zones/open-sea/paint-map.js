// =============================================================================
// Open Sea — the SOURCE of map.png.
// -----------------------------------------------------------------------------
// The seafloor was not drawn by hand in an image editor; it is composed from
// shape fields (trench polylines, plateau blobs, ridge lines, cones) and then
// QUANTIZED to the band legend. That means the depth bands, and the concentric
// beach/wade/shoal rings around every rise, fall out automatically and stay
// consistent — and the topology stays editable: change a polyline here, run
// paintMap(), get a new map.png.
//
//   import { paintMap } from './paint-map.js';
//   const url = await paintMap();            // -> data URL of a 2000x1000 PNG
//
// Band heights must stay in sync with terrain.js's LEGEND.
// =============================================================================

export const MAP_W = 2000, MAP_H = 1000;      // 3.333 px per world unit on both axes
export const EXTENT_X = 300, EXTENT_Z = 150;

const BANDS = [
  { id: 'LAND',    color: '#ff8000', height:  3.4 },
  { id: 'SAND',    color: '#ffe600', height: -0.25 },
  { id: 'WADE',    color: '#7cff2e', height: -0.85 },
  { id: 'SHOAL',   color: '#00e5ff', height: -3.0 },
  { id: 'PLATEAU', color: '#0f9dff', height: -8.0 },
  { id: 'FLOOR',   color: '#0b57d0', height: -16.0 },
  { id: 'SLOPE',   color: '#16277f', height: -30.0 },
  { id: 'TRENCH',  color: '#08103a', height: -52.0 },
];

// ── field helpers ────────────────────────────────────────────────────────────
function hash2(ix, iz) {
  let h = (ix | 0) * 374761393 + (iz | 0) * 668265263;
  h = (h ^ (h >> 13)) >>> 0; h = (h * 1274126177) >>> 0; h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967295;
}
function vn(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x, z, o = 4) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < o; i++) { s += a * (vn(x * f, z * f) * 2 - 1); n += a; a *= 0.5; f *= 2; }
  return s / n;
}
const ss = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const blob = (x, z, cx, cz, rx, rz, warp, wf) =>
  ss(1.0, 0.62, Math.hypot((x - cx) / rx, (z - cz) / rz) + fbm(x * wf + 11.3, z * wf - 7.1, 3) * warp);
function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}
function polyMask(x, z, pts, halfW, soft, wobAmp, wobF, seed = 0) {
  let d = 1e9;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return ss(halfW + soft + fbm(x * wobF + 3.7 + seed, z * wobF + 9.2 - seed, 2) * wobAmp, halfW * 0.3, d);
}
const cone = (x, z, cx, cz, r, rough, seed = 0) =>
  ss(1.0, 0.0, Math.hypot(x - cx, z - cz) / r + fbm(x * 0.06 + 5 + seed, z * 0.06 - 3 + seed, 3) * rough);
const up = (h, target, m) => Math.max(h, h + (target - h) * m);
const down = (h, target, m) => Math.min(h, h + (target - h) * m);

// ── the topology (mirrors terrain.js's LANDMARKS) ────────────────────────────
const TRENCH = [[-300, -58], [-212, -28], [-150, 10], [-70, 40], [12, 54], [96, 26], [162, 46], [236, 74], [300, 60]];
const BRANCH = [[104, 32], [126, 72], [132, 112], [118, 148]];
const CANYONS = [
  [[-206, -118], [-192, -78], [-176, -38], [-156, 2]],
  [[-124, -136], [-114, -90], [-106, -44], [-98, 6]],
  [[ 126, -130], [ 142, -86], [ 148, -40], [ 152, 12]],
  [[ 198, -120], [ 208, -74], [ 216, -24], [ 224, 26]],
  [[  44,  -98], [  12, -66], [ -16, -32], [ -30, 10]],
  [[ 246,  -96], [ 262, -52], [ 268,  -8]],
  [[ 196,   62], [ 190,  96], [ 186, 134]],
  [[ 232,   70], [ 246, 104], [ 258, 138]],
  [[ 156,   84], [ 132, 112], [ 108, 140]],
  [[ 214,   88], [ 224, 118]],
];
const RIDGES = [
  [[-252, -72], [-196, -56], [-138, -66]],
  [[ 106, -98], [ 158, -84], [ 214, -98]],
  [[ 152, -50], [ 198, -42], [ 248, -56]],
  [[-264, -120], [-232, -98], [-198, -106]],
  [[ 168,  56], [ 210,  62], [ 250,  74]],
  [[ 174, 104], [ 208, 112], [ 238, 108]],
  [[-118,  96], [ -74, 104], [ -40, 118]],
  [[-186,  74], [-232,  92], [-268, 118]],
];
const PINNACLES = [[-150, 120, 14], [-262, 58, 12], [62, -120, 15], [292, 116, 13], [-38, 74, 11], [240, -124, 12]];

// Continuous design depth at a world point, in world units.
export function designHeight(x, z) {
  let h = -30 + fbm(x * 0.012, z * 0.012, 4) * 4.5;                 // the deep slope everything sits in
  // calm open sandy floors — the quiet beats
  h = up(h, -16, blob(x, z, -220,  96, 132, 54, 0.18, 0.020));
  h = up(h, -16, blob(x, z,  256, -16,  92, 82, 0.20, 0.022));
  h = up(h, -16, blob(x, z,  -34, -118, 124, 42, 0.22, 0.025));
  h = up(h, -16, blob(x, z,  208,  96, 110, 58, 0.20, 0.020));
  h = up(h, -16, blob(x, z,  -96, 112,  86, 44, 0.20, 0.024));
  // plateaus at dive depth
  h = up(h, -8, blob(x, z, -196, -86, 106, 60, 0.16, 0.018));
  h = up(h, -8, blob(x, z,  172, -74, 122, 66, 0.16, 0.018));
  h = up(h, -8, blob(x, z, -100, 112,  62, 34, 0.20, 0.024));
  h = up(h, -8, blob(x, z,  210,  92,  78, 44, 0.18, 0.020));
  // ridge / terrace crests
  for (let i = 0; i < RIDGES.length; i++) h = up(h, -3.0, polyMask(x, z, RIDGES[i], 10, 10, 4.5, 0.032, i * 3.1));
  // "The Spire" — a seamount off the deep floor that breaks the surface
  h = up(h, -8,   cone(x, z, 26, 92, 62, 0.18, 2));
  h = up(h, -3,   cone(x, z, 26, 92, 30, 0.16, 4));
  h = up(h, -1.1, cone(x, z, 26, 92, 13, 0.10, 6));
  // scattered pinnacles / rubble mounds in the open
  for (let i = 0; i < PINNACLES.length; i++) {
    const p = PINNACLES[i];
    h = up(h, -16,  cone(x, z, p[0], p[1], p[2] * 2.2, 0.18, i));
    h = up(h, -4.5, cone(x, z, p[0], p[1], p[2], 0.14, i + 9));
  }
  // carve: main trench, its southern branch, the central basin, the canyons
  h = down(h, -52, polyMask(x, z, TRENCH, 26, 16, 7, 0.012));
  h = down(h, -46, polyMask(x, z, BRANCH, 15, 12, 6, 0.016, 5));
  h = down(h, -40, blob(x, z, -12, 44, 92, 52, 0.18, 0.020));
  for (let i = 0; i < CANYONS.length; i++) h = down(h, -32, polyMask(x, z, CANYONS[i], 8, 7, 3.4, 0.034, i * 2.7));
  // islands last — never carved
  h = up(h, 4.2, cone(x, z, -214, -104, 27, 0.16));
  h = up(h, 2.6, cone(x, z,   26,   92,  7, 0.10));
  return h;
}

// Quantize to the nearest legend band and write the flat-colour PNG.
export async function paintMap(canvas) {
  const c = canvas || Object.assign(document.createElement('canvas'), { width: MAP_W, height: MAP_H });
  c.width = MAP_W; c.height = MAP_H;
  const g = c.getContext('2d');
  const img = g.createImageData(MAP_W, MAP_H);
  const rgb = BANDS.map(b => [parseInt(b.color.slice(1, 3), 16), parseInt(b.color.slice(3, 5), 16), parseInt(b.color.slice(5, 7), 16)]);
  for (let py = 0; py < MAP_H; py++) {
    const z = -EXTENT_Z + (py / (MAP_H - 1)) * 2 * EXTENT_Z;
    for (let px = 0; px < MAP_W; px++) {
      const x = -EXTENT_X + (px / (MAP_W - 1)) * 2 * EXTENT_X;
      const h = designHeight(x, z);
      let bi = 0, bd = Infinity;
      for (let i = 0; i < BANDS.length; i++) { const d = Math.abs(h - BANDS[i].height); if (d < bd) { bd = d; bi = i; } }
      const o = (py * MAP_W + px) * 4, r = rgb[bi];
      img.data[o] = r[0]; img.data[o + 1] = r[1]; img.data[o + 2] = r[2]; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
