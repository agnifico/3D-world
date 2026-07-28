// =============================================================================
// Highland Terraces — rendering layer.  createHighland(zoneData, opts) turns the
// pure terrain module into THREE content and exposes the build/update/dispose/
// setDayNight shape the Zone contract wants (see ./zone.js) AND the standalone
// preview harness uses (see ./preview.html) — same split as Lagoon's
// createLagoon.
//
// Owns: the terraced terrain mesh (height-band vertex colours), the plunge-pool
// water (depth-graded shallow→deep), a gradient sky dome, and — when run with
// no shell lights (preview) — its own hemi/sun + scene.background/fog. In the
// shell it uses the shared lights (opts.hemi/opts.sun) and lets core/lighting.js
// own background + fog; it only drives its own materials on each blend tick.
//
// Solid hex fills, flat-shaded, NO textures / PBR maps (per the spec art note).
// =============================================================================
import * as THREE from 'three';
import {
  WORLD_EXTENT, WATER_Y, terrainHeight, depthAt, terrainNormal,
  PALETTES, dayCycle, LANDMARKS,
} from './terrain.js';

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

// Pick the two bracketing day-cycle keyframes for t∈[0,1] + local blend frac.
function bracket(t) {
  t = clamp01(t);
  for (let i = 0; i < dayCycle.length - 1; i++) {
    const a = dayCycle[i], b = dayCycle[i + 1];
    if (t >= a.t && t <= b.t) return { A: PALETTES[a.key], B: PALETTES[b.key], lt: b.t === a.t ? 0 : (t - a.t) / (b.t - a.t) };
  }
  const last = PALETTES[dayCycle[dayCycle.length - 1].key];
  return { A: last, B: last, lt: 0 };
}

const MID_T = (dayCycle.find(k => k.key === 'midday') || { t: 0.35 }).t;

// ─────────────────────────────────────────────────────────────────────────────
export function createHighland(zoneData, opts = {}) {
  const P0 = PALETTES.midday;
  const group = new THREE.Group();
  group.name = 'highland';

  // whether we own the lights + sky colour + fog (preview), or the shell does.
  const ownsLights = !opts.sun;
  const _c = new THREE.Color();
  const layers = { terrain: true, water: true, sky: true };

  // ── terrain mesh — height-band vertex colours, flat-shaded ──────────────────
  const SEG = 240; // ~0.83 u / vertex over 200 u → crisp-enough cliff facets
  const terr = buildTerrain(SEG);
  group.add(terr.mesh);

  // ── plunge-pool water — a plane over the gorge, depth-graded, gentle waves ───
  const water = buildWater();
  group.add(water.mesh);

  // ── gradient sky dome (fog-exempt so the zenith→horizon ramp survives) ───────
  const sky = buildSky();
  group.add(sky.mesh);

  // ── lights (preview only) ───────────────────────────────────────────────────
  let hemi = opts.hemi || null, sun = opts.sun || null;
  if (ownsLights) {
    hemi = new THREE.HemisphereLight(P0.hemisphere.sky, P0.hemisphere.ground, P0.hemisphere.intensity);
    sun = new THREE.DirectionalLight(P0.sun.color, P0.sun.intensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const S = 130;
    sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
    sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 600;
    sun.shadow.bias = -0.0004;
    group.add(hemi, sun, sun.target);
  }

  let attachedScene = null;
  function attach(scene) {
    scene.add(group);
    attachedScene = scene;
    if (ownsLights) {
      scene.background = new THREE.Color(P0.sky);
      scene.fog = new THREE.Fog(P0.fog.color, P0.fog.near, P0.fog.far);
    }
    setDayNight(MID_T); // land on the tuned midday look
    return group;
  }

  // ── day-cycle blend ─────────────────────────────────────────────────────────
  function setDayNight(t) {
    const { A, B, lt } = bracket(t);

    // sky dome gradient
    sky.mat.uniforms.uZenith.value.set(A.skyZenith).lerp(_c.set(B.skyZenith), lt);
    sky.mat.uniforms.uHorizon.value.set(A.skyHorizon).lerp(_c.set(B.skyHorizon), lt);

    // terrain phase grade (multiplies the baked colours)
    terr.applyGrade(_c.set(A.terrainGrade).lerp(new THREE.Color(B.terrainGrade), lt));

    // water phase tint (MeshStandard multiplies vertexColor × material colour)
    water.mat.color.set(A.water.tint).lerp(_c.set(B.water.tint), lt);
    water.mat.opacity = lerp(A.water.opacity, B.water.opacity, lt);

    // sun direction/colour (we position the sun ourselves — a fixed celestial
    // angle per phase, not a char-follow, matching the static-midday brief)
    const dir = [
      lerp(A.sun.direction[0], B.sun.direction[0], lt),
      lerp(A.sun.direction[1], B.sun.direction[1], lt),
      lerp(A.sun.direction[2], B.sun.direction[2], lt),
    ];
    const dl = Math.hypot(...dir) || 1;
    if (sun) {
      sun.position.set(dir[0] / dl * 220, dir[1] / dl * 220, dir[2] / dl * 220);
      sun.target.position.set(0, 0, -10);
      sun.target.updateMatrixWorld();
    }

    if (ownsLights) {
      sun.color.set(A.sun.color).lerp(_c.set(B.sun.color), lt);
      sun.intensity = lerp(A.sun.intensity, B.sun.intensity, lt);
      hemi.color.set(A.hemisphere.sky).lerp(_c.set(B.hemisphere.sky), lt);
      hemi.groundColor.set(A.hemisphere.ground).lerp(_c.set(B.hemisphere.ground), lt);
      hemi.intensity = lerp(A.hemisphere.intensity, B.hemisphere.intensity, lt);
      if (attachedScene) {
        attachedScene.background.set(A.sky).lerp(_c.set(B.sky), lt);
        if (attachedScene.fog) {
          attachedScene.fog.color.set(A.fog.color).lerp(_c.set(B.fog.color), lt);
          attachedScene.fog.near = lerp(A.fog.near, B.fog.near, lt);
          attachedScene.fog.far = lerp(A.fog.far, B.fog.far, lt);
        }
      }
    }
  }

  function setLayerEnabled(id, on) {
    if (id in layers) { layers[id] = on; }
    if (id === 'terrain') terr.mesh.visible = on;
    if (id === 'water') water.mesh.visible = on;
    if (id === 'sky') sky.mesh.visible = on;
  }

  let time = 0;
  function update(dt) {
    time += dt;
    if (water.mat.userData.shader) water.mat.userData.shader.uniforms.uTime.value = time;
    // keep the sky dome centred on the camera so it never clips
    if (attachedScene && attachedScene.__cam) sky.mesh.position.copy(attachedScene.__cam.position);
  }

  function dispose() {
    // geometry/material freeing is handled generically by the contract's
    // disposeGroup() (see core/zone.js); nothing here holds DOM listeners.
  }

  return {
    group, attach, update, setDayNight, setLayerEnabled, dispose,
    get sun() { return sun; }, get hemi() { return hemi; },
    terrainHeight, depthAt, WATER_Y, LANDMARKS,
  };

  // ── builders ────────────────────────────────────────────────────────────────
  function buildTerrain(seg) {
    const geo = new THREE.PlaneGeometry(200, 200, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const base = new Float32Array(pos.count * 3);   // un-graded baked colours
    const live = new Float32Array(pos.count * 3);
    const T = P0.terrain;
    const GRASS = new THREE.Color(T.grass), CLIFF = new THREE.Color(T.cliff),
          EDGE = new THREE.Color(T.edge), PINE = new THREE.Color(T.pineScrub),
          FOOT = new THREE.Color(T.foothill), BED = new THREE.Color(T.poolFloor);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const ny = terrainNormal(x, z)[1];             // 1 flat → 0 vertical

      // slope band: flat grass → worn edge-dirt shoulders → sheer cliff
      if (ny < 0.5) c.copy(CLIFF);
      else if (ny < 0.82) c.copy(GRASS).lerp(EDGE, (0.82 - ny) / 0.32);
      else c.copy(GRASS);

      // alpine transition: darken toward pine-scrub on the higher walkable ground
      const alp = clamp01((h - 22) / 26);
      if (alp > 0 && ny >= 0.5) c.lerp(PINE, alp * 0.5);

      // cool slate for the tall foothill backdrop
      const fh = clamp01((h - 46) / 30);
      if (fh > 0) c.lerp(FOOT, fh * 0.9);

      // pool basin floor (seen through the water)
      if (h < WATER_Y - 0.3) c.copy(BED);

      // faint per-vertex value variation so flats have life without noise-slop
      c.offsetHSL(0, 0, (vnoiseHash(x, z) - 0.5) * 0.03);

      base[i * 3] = c.r; base[i * 3 + 1] = c.g; base[i * 3 + 2] = c.b;
      live[i * 3] = c.r; live[i * 3 + 1] = c.g; live[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(live, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true; mesh.castShadow = true;

    const attr = geo.attributes.color;
    const gc = new THREE.Color();
    function applyGrade(grade) {
      for (let i = 0; i < pos.count; i++) {
        gc.setRGB(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]).multiply(grade);
        live[i * 3] = gc.r; live[i * 3 + 1] = gc.g; live[i * 3 + 2] = gc.b;
      }
      attr.needsUpdate = true;
    }
    return { mesh, applyGrade };
  }

  function buildWater() {
    // plane confined to the gorge footprint → no stray puddles on the plateaus
    const b = LANDMARKS.poolBox;
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
    const geo = new THREE.PlaneGeometry(w, d, 60, 90);
    geo.rotateX(-Math.PI / 2);
    geo.translate((b.minX + b.maxX) / 2, WATER_Y, (b.minZ + b.maxZ) / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const SH = new THREE.Color(P0.water.shallow), DP = new THREE.Color(P0.water.deep), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const dep = depthAt(pos.getX(i), pos.getZ(i));
      c.copy(SH).lerp(DP, clamp01((dep - 1.0) / 7.0));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, color: 0xffffff, transparent: true, opacity: P0.water.opacity,
      roughness: 0.30, metalness: 0.0, flatShading: false,
    });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed.y += (sin(position.x*0.5+uTime*1.1) + sin(position.z*0.6+uTime*1.5)*0.7 + sin((position.x+position.z)*0.28+uTime*0.8)*0.5) * 0.06;`
      );
      mat.userData.shader = sh;
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return { mesh, mat };
  }

  function buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(P0.skyZenith) },
        uHorizon: { value: new THREE.Color(P0.skyHorizon) },
      },
      vertexShader: `varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uZenith; uniform vec3 uHorizon; varying vec3 vDir;
        void main(){ float t = smoothstep(-0.02, 0.5, vDir.y); gl_FragColor = vec4(mix(uHorizon, uZenith, t), 1.0); }`,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    return { mesh, mat };
  }
}

// tiny stable value hash for the terrain colour dither (no three, no drift)
function vnoiseHash(x, z) {
  let h = (Math.floor(x * 7.3) | 0) * 374761393 + (Math.floor(z * 7.3) | 0) * 668265263;
  h = (h ^ (h >> 13)) >>> 0; h = (h * 1274126177) >>> 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
