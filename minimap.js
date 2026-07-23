// Grassland World — minimap: two baked aerials (day/night, 1024px — high
// enough resolution that cropping in close still looks sharp) with live
// overlays (bridge, buildings, boats, heading arrow), scrolling to follow
// the player instead of showing the whole static world. North-up, no
// rotation with heading.
import * as THREE from 'three';
import { terrainHeight, distPoly, PATH, fall, clamp01, WATER_Y } from './world.js';
import { BRIDGE } from './props.js';
import { getT } from './lighting.js';

const MAP_POI = [
  { x: -14, z: -48, k: 'house' }, { x: -4, z: -52, k: 'house' }, { x: -16, z: -38, k: 'house' },
  { x: -55, z: 60, k: 'mark' }, { x: 55, z: -55, k: 'mark' }, { x: -60, z: -15, k: 'mark' },
];

const BAKE_PX = 1024;
const WORLD_HALF = 100; // matches the terrain's 200x200 extent — full-world coverage, not just a bigger crop
const BAKE_SCALE = BAKE_PX / (WORLD_HALF * 2); // bake px per world unit
function worldToBakePx(x, z) { return [BAKE_PX / 2 + x * BAKE_SCALE, BAKE_PX / 2 + z * BAKE_SCALE]; }
// Crop rect (bake-px space) centered on the player at the given world-unit
// radius, clamped to the bake bounds so an edge shows map edge, not garbage.
export function computeCropRect(px, pz, radius) {
  const [bx, bz] = worldToBakePx(px, pz);
  let sSize = Math.min(BAKE_PX, radius * 2 * BAKE_SCALE);
  let sx = bx - sSize / 2, sy = bz - sSize / 2;
  sx = Math.max(0, Math.min(BAKE_PX - sSize, sx));
  sy = Math.max(0, Math.min(BAKE_PX - sSize, sy));
  return { sx, sy, sSize };
}
function worldToDisplayPx(x, z, crop, displaySize) {
  const [bx, bz] = worldToBakePx(x, z);
  return [(bx - crop.sx) / crop.sSize * displaySize, (bz - crop.sy) / crop.sSize * displaySize];
}

function bakeAerial(palette) {
  const cv = document.createElement('canvas'); cv.width = cv.height = BAKE_PX;
  const c = cv.getContext('2d'), img = c.createImageData(BAKE_PX, BAKE_PX), d = img.data;
  const srgb = hex => new THREE.Color(hex).convertLinearToSRGB();
  const water = srgb(palette.water.color), deep = srgb(palette.terrain.bed);
  const gA = srgb(palette.terrain.g1), gB = srgb(palette.terrain.g2), sand = srgb(palette.terrain.sand), dirt = srgb(0x8b6f47);
  const col = new THREE.Color();
  for (let py = 0; py < BAKE_PX; py++) for (let px = 0; px < BAKE_PX; px++) {
    const wx = ((px - BAKE_PX / 2) / BAKE_SCALE), wz = ((py - BAKE_PX / 2) / BAKE_SCALE); // pixel → world
    const h = terrainHeight(wx, wz);
    if (h < WATER_Y - 0.02) col.copy(water).lerp(deep, clamp01((WATER_Y - h) / 3.4));   // lake + channel, deeper = darker
    else if (h < WATER_Y + 0.55) col.copy(sand);                                        // shoreline
    else {
      const n = Math.sin(wx * 0.31 + wz * 0.17) * 0.5 + Math.sin(wx * 0.07 - wz * 0.11) * 0.5;
      col.copy(gA).lerp(gB, clamp01(0.5 + n * 0.45));
      const dP = distPoly(wx, wz, PATH);
      if (dP < 3.6) col.lerp(dirt, fall(dP, 1.8, 3.6) * 0.85);                           // dirt path
    }
    const i = (py * BAKE_PX + px) * 4;
    d[i] = col.r * 255; d[i + 1] = col.g * 255; d[i + 2] = col.b * 255; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return cv;
}

const ZOOM_LEVELS = [70, 100, 160]; // world-unit radius shown; >= WORLD_HALF clamps to the full map
let zoomIdx = 0;

export function initMinimap(animated, PALETTES, boats, getChar, getHeading, isGalleryOpen) {
  const _M = 172; // on-screen display size — unchanged, only the bake source got sharper
  const _baseDay = bakeAerial(PALETTES.day);
  const _baseNight = bakeAerial(PALETTES.night);
  const _mm = document.createElement('canvas'); _mm.width = _mm.height = _M;
  _mm.style.cssText = 'position:fixed;right:14px;top:14px;z-index:2;border-radius:50%;border:2px solid rgba(107,79,53,.6);box-shadow:0 6px 18px rgba(0,0,0,.4)';
  document.body.appendChild(_mm);
  const _mc = _mm.getContext('2d');

  addEventListener('keydown', e => { if (e.isTrusted && e.code === 'KeyM') zoomIdx = (zoomIdx + 1) % ZOOM_LEVELS.length; });

  let _mmT = 1; // primed so the first frame draws overlays without waiting on the throttle
  animated.push(dt => {
    _mmT += dt; if (_mmT < 0.09) return; _mmT = 0;
    if (isGalleryOpen() || window.__aerial) { _mm.style.display = 'none'; return; }
    _mm.style.display = '';
    const char = getChar(), heading = getHeading();
    const crop = computeCropRect(char.position.x, char.position.z, ZOOM_LEVELS[zoomIdx]);
    const toMap = (x, z) => worldToDisplayPx(x, z, crop, _M);

    const c = _mc; c.clearRect(0, 0, _M, _M);
    const base = getT() < 0.5 ? _baseDay : _baseNight; // hard swap at t=0.5, per the brief
    c.drawImage(base, crop.sx, crop.sy, crop.sSize, crop.sSize, 0, 0, _M, _M);

    // bridge — short deck line across the channel
    const [bx, bz] = toMap(BRIDGE.x, BRIDGE.z), bc = Math.sin(BRIDGE.rot), bs = Math.cos(BRIDGE.rot);
    c.strokeStyle = '#d7c199'; c.lineWidth = 2.5; c.lineCap = 'round'; c.beginPath();
    c.moveTo(bx - bc * 5, bz - bs * 5); c.lineTo(bx + bc * 5, bz + bs * 5); c.stroke();
    // buildings + landmarks
    for (const p of MAP_POI) {
      const [a, b] = toMap(p.x, p.z);
      if (p.k === 'house') { c.fillStyle = '#caa46b'; c.fillRect(a - 2.5, b - 2.5, 5, 5); c.fillStyle = '#6b4f35'; c.fillRect(a - 2.5, b - 2.5, 5, 2); }
      else { c.fillStyle = '#efe7d8'; c.strokeStyle = '#6b4f35'; c.lineWidth = 1; c.beginPath(); c.arc(a, b, 3, 0, 7); c.fill(); c.stroke(); }
    }
    // boats
    c.fillStyle = '#f2d488'; c.strokeStyle = '#5b4a2a'; c.lineWidth = 1;
    for (const bo of boats) { const [a, b] = toMap(bo.obj.position.x, bo.obj.position.z); c.beginPath(); c.arc(a, b, 2.6, 0, 7); c.fill(); c.stroke(); }
    // player heading arrow — offsets from center itself when the crop is
    // clamped at a world edge, since it's computed through the same toMap
    const [px, pz] = toMap(char.position.x, char.position.z), fv = Math.sin(heading), fzv = Math.cos(heading);
    c.fillStyle = '#fff'; c.strokeStyle = '#10131a'; c.lineWidth = 1.2; c.beginPath();
    c.moveTo(px + fv * 7.5, pz + fzv * 7.5);
    c.lineTo(px - fv * 5 - fzv * 4, pz - fzv * 5 + fv * 4);
    c.lineTo(px - fv * 5 + fzv * 4, pz - fzv * 5 - fv * 4);
    c.closePath(); c.fill(); c.stroke();
  });
}
