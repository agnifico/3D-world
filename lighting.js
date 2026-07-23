// Grassland World — day/night lighting: a pure-data PALETTES table (this
// file is handed to a design tool afterward that edits palette *values
// only* — keep every tunable number here, zero logic mixed in) plus
// applyLighting(t), the one function that lerps all of it onto the live
// scene. One biome (grassland). Day/Night changes ONLY lighting & colors —
// the world content (flora mix, objects) is identical in both.
import * as THREE from 'three';

export const PALETTES = {
  day: {
    name: 'Grassland',
    sky: 0x9ed2e8,
    fog: { color: 0x9ed2e8, near: 70, far: 250 },
    hemi: { sky: 0xbfe3f2, ground: 0x7a9455, intensity: 0.9 },
    sun: { color: 0xfff2d8, intensity: 1.6, offset: { x: 35, y: 55, z: 20 } },
    water: { color: 0x4aa8b8, opacity: 0.82 },
    terrain: { g1: 0x7cb356, g2: 0xa8c66c, sand: 0xcdbb8a, bed: 0x3d6b5e },
    grass: { accent: 0xc4c96a },
    flowerGlow: 0,
    lantern: { color: 0xffc37a, intensity: 0 },
    // inert stretch data for a later design/post-processing pass — not wired,
    // no bloom pipeline exists and building one isn't a trivial addition here
    bloom: { strength: 0, radius: 0.4, threshold: 0.85 },
  },
  night: {
    name: 'Grassland — Night',
    sky: 0x0f1226,
    fog: { color: 0x0f1226, near: 32, far: 175 },
    hemi: { sky: 0x3a4076, ground: 0x1b2a2e, intensity: 0.62 },
    sun: { color: 0x9fb6ff, intensity: 0.95, offset: { x: 35, y: 55, z: 20 } },
    water: { color: 0x1f4a66, opacity: 0.9 },
    terrain: { g1: 0x33504f, g2: 0x466055, sand: 0x474a63, bed: 0x0f2a34 },
    grass: { accent: 0x66b0a2 },
    flowerGlow: 0.7,
    lantern: { color: 0xffc37a, intensity: 30 },
    bloom: { strength: 0.35, radius: 0.5, threshold: 0.7 },
  },
};
export const modeKey = new URLSearchParams(location.search).get('mode') === 'night' ? 'night' : 'day';

// ================= scene light objects =================
// Creates the hemi + sun (no palette values baked in — applyLighting sets
// them the moment initLightingBlend runs). Returns both so main.js's render
// loop can keep repositioning the sun relative to the character every frame.
export function initLighting(scene) {
  scene.background = new THREE.Color(PALETTES[modeKey].sky);
  scene.fog = new THREE.Fog(PALETTES[modeKey].sky, PALETTES[modeKey].fog.near, PALETTES[modeKey].fog.far);

  const hemi = new THREE.HemisphereLight(PALETTES.day.hemi.sky, PALETTES.day.hemi.ground, PALETTES.day.hemi.intensity);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTES.day.sun.color, PALETTES.day.sun.intensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  return { hemi, sun };
}

// A lantern only ever existed if the *initial* mode was night — for
// continuous blending it must always exist so applyLighting can drive its
// intensity. Character-setup, not state-machine logic, so it lives here
// rather than in controller.js (main.js calls this once `char` exists).
export function createLantern(char) {
  const lamp = new THREE.PointLight(PALETTES.day.lantern.color, PALETTES.day.lantern.intensity, 22, 1.8);
  lamp.position.y = 2.2;
  char.add(lamp);
  return lamp;
}

// ================= applyLighting(t) =================
// ctx: { scene, hemi, sun, waterMat, terrain:{applyBlend}, grass:{applyBlend},
//        flowerMat, lantern }. Set once via initLightingBlend once every
// subsystem exists; applyLighting(t) itself only needs `t` after that, per
// the brief's literal signature.
let ctx = null;
let t = modeKey === 'night' ? 1 : 0;
let sunOffset = { x: PALETTES.day.sun.offset.x, y: PALETTES.day.sun.offset.y, z: PALETTES.day.sun.offset.z };

// Pre-built day/night endpoint Colors (constructed once) + one scratch Color
// per field, reused every call — applyLighting runs every frame during a
// transition, so none of this may allocate.
function endpoints(dayHex, nightHex) { return { d: new THREE.Color(dayHex), n: new THREE.Color(nightHex), scratch: new THREE.Color() }; }
const _sky = endpoints(PALETTES.day.sky, PALETTES.night.sky);
const _hemiSky = endpoints(PALETTES.day.hemi.sky, PALETTES.night.hemi.sky);
const _hemiGround = endpoints(PALETTES.day.hemi.ground, PALETTES.night.hemi.ground);
const _sun = endpoints(PALETTES.day.sun.color, PALETTES.night.sun.color);
const _water = endpoints(PALETTES.day.water.color, PALETTES.night.water.color);
const lerpNum = (a, b, k) => a + (b - a) * k;
const lerpColor = e => e.scratch.copy(e.d).lerp(e.n, t);

export function applyLighting(newT) {
  t = Math.max(0, Math.min(1, newT));
  if (!ctx) return; // called before initLightingBlend wired everything — nothing to apply yet
  const D = PALETTES.day, N = PALETTES.night;

  const sky = lerpColor(_sky);
  ctx.scene.background.copy(sky);
  ctx.scene.fog.color.copy(sky);
  ctx.scene.fog.near = lerpNum(D.fog.near, N.fog.near, t);
  ctx.scene.fog.far = lerpNum(D.fog.far, N.fog.far, t);

  ctx.hemi.color.copy(lerpColor(_hemiSky));
  ctx.hemi.groundColor.copy(lerpColor(_hemiGround));
  ctx.hemi.intensity = lerpNum(D.hemi.intensity, N.hemi.intensity, t);

  ctx.sun.color.copy(lerpColor(_sun));
  ctx.sun.intensity = lerpNum(D.sun.intensity, N.sun.intensity, t);
  sunOffset.x = lerpNum(D.sun.offset.x, N.sun.offset.x, t);
  sunOffset.y = lerpNum(D.sun.offset.y, N.sun.offset.y, t);
  sunOffset.z = lerpNum(D.sun.offset.z, N.sun.offset.z, t);

  if (ctx.waterMat) {
    ctx.waterMat.color.copy(lerpColor(_water));
    ctx.waterMat.opacity = lerpNum(D.water.opacity, N.water.opacity, t);
  }
  ctx.terrain?.applyBlend(t);
  ctx.grass?.applyBlend(t);
  if (ctx.flowerMat) ctx.flowerMat.emissiveIntensity = lerpNum(D.flowerGlow, N.flowerGlow, t) * 0.5;

  // binary things hard-step at t = 0.5, per the brief
  if (ctx.lantern) {
    const p = t < 0.5 ? D.lantern : N.lantern;
    ctx.lantern.color.set(p.color);
    ctx.lantern.intensity = p.intensity;
  }
}
export function initLightingBlend(c) { ctx = c; applyLighting(t); }
export function getT() { return t; }
export function getSunOffset() { return sunOffset; }

// ================= N-key transition (ease in/out, ~3s, retargets cleanly) =================
const DURATION = 3;
let tStart = t, tTarget = t, elapsed = DURATION; // elapsed>=DURATION means "settled", nothing to tick
const ease = x => (x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2);

export function requestToggle() {
  tStart = t;
  tTarget = tTarget === 1 ? 0 : 1;
  elapsed = 0;
}
export function setMode(mode) {
  const tt = mode === 'night' ? 1 : 0;
  tStart = tTarget = tt;
  elapsed = DURATION;
  applyLighting(tt);
}
export function blendTo(newT) { // for direct __blend(t) testing — no animation, snaps
  tStart = tTarget = newT;
  elapsed = DURATION;
  applyLighting(newT);
}
let cycleSecondsPerDay = 0; // 0 = off
export function setCycle(secondsPerFullDay) { cycleSecondsPerDay = secondsPerFullDay || 0; }
export function tick(dt) {
  if (elapsed < DURATION) {
    elapsed = Math.min(DURATION, elapsed + dt);
    applyLighting(tStart + (tTarget - tStart) * ease(elapsed / DURATION));
    return;
  }
  if (cycleSecondsPerDay > 0) {
    // day(0)->night(1)->day(0) continuous, ignores the toggle target state
    const phase = ((performance.now() / 1000) % cycleSecondsPerDay) / cycleSecondsPerDay; // 0..1 over a full cycle
    applyLighting(phase < 0.5 ? phase * 2 : (1 - phase) * 2);
  }
}

window.__blend = applyLighting;
window.__setMode = setMode;
window.__cycle = setCycle;
