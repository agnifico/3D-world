// Grassland World — minimap: a baked aerial (water · channel · shore ·
// greenery · path) with live overlays (bridge, buildings, boats, player). The
// base is rendered ONCE by sampling terrainHeight across the world, so it
// reads like a zoomed-out satellite teaser rather than a schematic.
import * as THREE from 'three';
import { terrainHeight, distPoly, PATH, fall, clamp01, WATER_Y } from './world.js';
import { BRIDGE } from './props.js';

const MAP_POI = [
  { x: -14, z: -48, k: 'house' }, { x: -4, z: -52, k: 'house' }, { x: -16, z: -38, k: 'house' },
  { x: -55, z: 60, k: 'mark' }, { x: 55, z: -55, k: 'mark' }, { x: -60, z: -15, k: 'mark' },
];

export function initMinimap(animated, BIOME, boats, getChar, getHeading, isGalleryOpen) {
  const _M = 172, _MC = _M / 2, _MR = 80, _MW = 100; // px size · centre · radius · world half-extent shown
  const _toMap = (x, z) => [_MC + (x / _MW) * _MR, _MC + (z / _MW) * _MR];
  const _srgb = hex => new THREE.Color(hex).convertLinearToSRGB();
  const _base = document.createElement('canvas'); _base.width = _base.height = _M;
  (function bakeAerial() {
    const c = _base.getContext('2d'), img = c.createImageData(_M, _M), d = img.data;
    const water = _srgb(BIOME.water), deep = _srgb(BIOME.bed);
    const gA = _srgb(BIOME.g1), gB = _srgb(BIOME.g2), sand = _srgb(BIOME.sand), dirt = _srgb(0x8b6f47);
    const col = new THREE.Color();
    for (let py = 0; py < _M; py++) for (let px = 0; px < _M; px++) {
      const wx = ((px - _MC) / _MR) * _MW, wz = ((py - _MC) / _MR) * _MW; // pixel → world
      const h = terrainHeight(wx, wz);
      if (h < WATER_Y - 0.02) col.copy(water).lerp(deep, clamp01((WATER_Y - h) / 3.4));   // lake + channel, deeper = darker
      else if (h < WATER_Y + 0.55) col.copy(sand);                                        // shoreline
      else {
        const n = Math.sin(wx * 0.31 + wz * 0.17) * 0.5 + Math.sin(wx * 0.07 - wz * 0.11) * 0.5;
        col.copy(gA).lerp(gB, clamp01(0.5 + n * 0.45));
        const dP = distPoly(wx, wz, PATH);
        if (dP < 3.6) col.lerp(dirt, fall(dP, 1.8, 3.6) * 0.85);                           // dirt path
      }
      const i = (py * _M + px) * 4;
      d[i] = col.r * 255; d[i + 1] = col.g * 255; d[i + 2] = col.b * 255; d[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  })();
  const _mm = document.createElement('canvas'); _mm.width = _mm.height = _M;
  _mm.style.cssText = 'position:fixed;right:14px;top:14px;z-index:2;border-radius:50%;border:2px solid rgba(107,79,53,.6);box-shadow:0 6px 18px rgba(0,0,0,.4)';
  document.body.appendChild(_mm);
  const _mc = _mm.getContext('2d');
  _mc.drawImage(_base, 0, 0); // paint the aerial immediately (overlays follow each frame)
  let _mmT = 1; // primed so the first frame draws overlays without waiting on the throttle
  animated.push(dt => {
    _mmT += dt; if (_mmT < 0.09) return; _mmT = 0;
    if (isGalleryOpen() || window.__aerial) { _mm.style.display = 'none'; return; }
    _mm.style.display = ''; const c = _mc; c.clearRect(0, 0, _M, _M);
    c.drawImage(_base, 0, 0);
    // bridge — short deck line across the channel
    const [bx, bz] = _toMap(BRIDGE.x, BRIDGE.z), bc = Math.sin(BRIDGE.rot), bs = Math.cos(BRIDGE.rot);
    c.strokeStyle = '#d7c199'; c.lineWidth = 2.5; c.lineCap = 'round'; c.beginPath();
    c.moveTo(bx - bc * 5, bz - bs * 5); c.lineTo(bx + bc * 5, bz + bs * 5); c.stroke();
    // buildings + landmarks
    for (const p of MAP_POI) {
      const [a, b] = _toMap(p.x, p.z);
      if (p.k === 'house') { c.fillStyle = '#caa46b'; c.fillRect(a - 2.5, b - 2.5, 5, 5); c.fillStyle = '#6b4f35'; c.fillRect(a - 2.5, b - 2.5, 5, 2); }
      else { c.fillStyle = '#efe7d8'; c.strokeStyle = '#6b4f35'; c.lineWidth = 1; c.beginPath(); c.arc(a, b, 3, 0, 7); c.fill(); c.stroke(); }
    }
    // boats
    c.fillStyle = '#f2d488'; c.strokeStyle = '#5b4a2a'; c.lineWidth = 1;
    for (const bo of boats) { const [a, b] = _toMap(bo.obj.position.x, bo.obj.position.z); c.beginPath(); c.arc(a, b, 2.6, 0, 7); c.fill(); c.stroke(); }
    // player heading arrow
    const char = getChar(), heading = getHeading();
    const [px, pz] = _toMap(char.position.x, char.position.z), fv = Math.sin(heading), fzv = Math.cos(heading);
    c.fillStyle = '#fff'; c.strokeStyle = '#10131a'; c.lineWidth = 1.2; c.beginPath();
    c.moveTo(px + fv * 7.5, pz + fzv * 7.5);
    c.lineTo(px - fv * 5 - fzv * 4, pz - fzv * 5 + fv * 4);
    c.lineTo(px - fv * 5 + fzv * 4, pz - fzv * 5 - fv * 4);
    c.closePath(); c.fill(); c.stroke();
  });
}
