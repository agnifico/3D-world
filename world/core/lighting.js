// World Shell — day/night lighting engine. Owns the scene's shared light
// objects (hemi/sun), scene.background, scene.fog, and the blended bloom
// values every zone's night-fx composer reads — generalized from
// grassland/lighting.js's hardcoded day/night lerp into an N-keyframe
// interpolator, since Lagoon ships 4 keyframes (day/afternoon/dusk/night)
// where Grassland only ever had 2.
//
// Each zone supplies `PALETTES` (a map of keyframe-name -> palette) and a
// `dayCycle` ([{t, key}, ...], ascending t) describing which keyframes exist
// and when they land. This module blends the SHELL-COMMON fields present in
// every zone's palettes (sky, fog, hemisphere lights, sun color/intensity,
// bloom) directly onto the shared THREE objects it owns. Anything
// zone-or-character-specific (water shader uniforms, terrain vertex-color
// bakes, grass blend, underwater fog/tint, the character's lantern, ...) is
// NOT guessed at here — any interested party calls onBlend(cb) to receive
// (paletteA, paletteB, localT, t) on every blend tick, exactly mirroring how
// grassland's old ctx.terrain.applyBlend/ctx.grass.applyBlend/ctx.lantern
// worked, just as independent subscribers instead of one main.js-wired ctx
// object — the zone subscribes in build() and unsubscribes in dispose();
// the character controller subscribes once at startup for the lantern and
// never unsubscribes, since the character persists across zone crossings.
import * as THREE from 'three';

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function lerpNum(a, b, k) { return a + (b - a) * k; }
const ease = x => (x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2);

// Picks the two bracketing keyframes in an ascending [{t,key}] dayCycle for
// a given t in [0,1], plus the local 0..1 blend fraction between them.
export function pickBracket(dayCycle, t) {
  t = clamp01(t);
  if (dayCycle.length === 1) return { a: dayCycle[0], b: dayCycle[0], localT: 0 };
  for (let i = 0; i < dayCycle.length - 1; i++) {
    const a = dayCycle[i], b = dayCycle[i + 1];
    if (t >= a.t && t <= b.t) return { a, b, localT: b.t === a.t ? 0 : (t - a.t) / (b.t - a.t) };
  }
  return { a: dayCycle[dayCycle.length - 1], b: dayCycle[dayCycle.length - 1], localT: 0 };
}

export function createLighting(scene) {
  scene.background = new THREE.Color(0x000000);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  let zone = null;          // active zone's { PALETTES, dayCycle }
  let t = 0;
  let sunOffset = { x: 35, y: 55, z: 20 };
  let bloomState = { strength: 0, radius: 0.4, threshold: 0.85 };
  const _scratch = new THREE.Color();
  const subscribers = new Set();
  function onBlend(cb) { subscribers.add(cb); return () => subscribers.delete(cb); }

  // Reads hemisphere light data off a palette keyframe under either name —
  // Grassland's palettes use `hemi`, Lagoon's use `hemisphere` (the brief
  // asks these to fold into one schema at the dedup pass; until then this
  // module accepts either so neither zone needs a rename to work).
  const hemiOf = p => p.hemisphere || p.hemi;

  function blendCommon(PA, PB, localT) {
    if (!PA || !PB) return;
    if (PA.sky !== undefined && PB.sky !== undefined) {
      _scratch.set(PA.sky).lerp(new THREE.Color(PB.sky), localT);
      scene.background.copy(_scratch);
    }
    if (PA.fog && PB.fog) {
      if (!scene.fog) scene.fog = new THREE.Fog(PA.fog.color, PA.fog.near, PA.fog.far);
      _scratch.set(PA.fog.color).lerp(new THREE.Color(PB.fog.color), localT);
      scene.fog.color.copy(_scratch);
      scene.fog.near = lerpNum(PA.fog.near, PB.fog.near, localT);
      scene.fog.far = lerpNum(PA.fog.far, PB.fog.far, localT);
    }
    const hA = hemiOf(PA), hB = hemiOf(PB);
    if (hA && hB) {
      hemi.color.set(hA.sky).lerp(new THREE.Color(hB.sky), localT);
      hemi.groundColor.set(hA.ground).lerp(new THREE.Color(hB.ground), localT);
      hemi.intensity = lerpNum(hA.intensity, hB.intensity, localT);
    }
    if (PA.sun && PB.sun) {
      sun.color.set(PA.sun.color).lerp(new THREE.Color(PB.sun.color), localT);
      sun.intensity = lerpNum(PA.sun.intensity, PB.sun.intensity, localT);
      if (PA.sun.offset && PB.sun.offset) {
        sunOffset = {
          x: lerpNum(PA.sun.offset.x, PB.sun.offset.x, localT),
          y: lerpNum(PA.sun.offset.y, PB.sun.offset.y, localT),
          z: lerpNum(PA.sun.offset.z, PB.sun.offset.z, localT),
        };
      }
    }
    if (PA.bloom && PB.bloom) {
      bloomState = {
        strength: lerpNum(PA.bloom.strength, PB.bloom.strength, localT),
        radius: lerpNum(PA.bloom.radius, PB.bloom.radius, localT),
        threshold: lerpNum(PA.bloom.threshold, PB.bloom.threshold, localT),
      };
    }
  }

  function applyLighting(newT) {
    t = clamp01(newT);
    if (!zone) return;
    const { a, b, localT } = pickBracket(zone.dayCycle, t);
    const PA = zone.PALETTES[a.key], PB = zone.PALETTES[b.key];
    blendCommon(PA, PB, localT);
    for (const cb of subscribers) cb(PA, PB, localT, t);
  }

  // Called once a zone finishes build() and has its materials ready to
  // blend. `initialT` lets a portal-crossing keep the current time-of-day
  // carried across into the new zone instead of resetting to day.
  function loadZonePalette(z, initialT = t) {
    zone = z;
    tStart = tTarget = initialT;
    elapsed = DURATION;
    applyLighting(initialT);
  }

  // ================= N-key transition (ease in/out, ~3s, retargets cleanly) =================
  const DURATION = 3;
  let tStart = 0, tTarget = 0, elapsed = DURATION; // elapsed>=DURATION means "settled"
  let cycleSecondsPerDay = 0;

  function requestToggle() {
    tStart = t;
    tTarget = tTarget === 1 ? 0 : 1;
    elapsed = 0;
  }
  function setMode(mode) {
    const tt = mode === 'night' ? 1 : 0;
    tStart = tTarget = tt;
    elapsed = DURATION;
    applyLighting(tt);
  }
  function blendTo(newT) { // direct testing — no animation, snaps
    tStart = tTarget = newT;
    elapsed = DURATION;
    applyLighting(newT);
  }
  function setCycle(secondsPerFullDay) { cycleSecondsPerDay = secondsPerFullDay || 0; }
  function tick(dt) {
    if (elapsed < DURATION) {
      elapsed = Math.min(DURATION, elapsed + dt);
      applyLighting(tStart + (tTarget - tStart) * ease(elapsed / DURATION));
      return;
    }
    if (cycleSecondsPerDay > 0) {
      const phase = ((performance.now() / 1000) % cycleSecondsPerDay) / cycleSecondsPerDay;
      applyLighting(phase < 0.5 ? phase * 2 : (1 - phase) * 2);
    }
  }

  function getT() { return t; }
  function getSunOffset() { return sunOffset; }
  function getBloom() { return bloomState; }

  window.__blend = applyLighting;
  window.__setMode = setMode;
  window.__cycle = setCycle;

  return { hemi, sun, loadZonePalette, applyLighting, onBlend, requestToggle, setMode, blendTo, setCycle, tick, getT, getSunOffset, getBloom };
}
