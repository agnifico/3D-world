// =============================================================================
// Open Sea zone — "The Sunder"  ·  visual systems
// -----------------------------------------------------------------------------
// Same contract and structure as lagoon-fx.js (createOpenSea(zone, opts) ->
// { attach, update, setDayNight, setLayerEnabled, setOverlay, dispose, ... }),
// so zone.js is a thin adapter and the standalone preview harness works
// unchanged. Everything is procedural — no textures, no GLB.
//
// What is DIFFERENT from the lagoon, i.e. the open-sea fx set:
//   1. SWELL           long-wavelength rolling ocean surface (not lagoon ripple)
//   2. WHITECAPS       crest-driven foam — the surface read out at sea, where
//                      there is no shoreline foam to carry it
//   3. ABYSS FALLOFF   depth-driven darkening toward palette.abyssColor: the
//                      trench actually goes black, which is what sells 52 units
//   4. MARINE SNOW     motes DRIFT DOWNWARD, and glow with depth (deep plankton)
//   5. DEPTH-GATED     caustics and god rays fade out by their own palette
//      LIGHT           max-depth, so light visibly runs out as you descend
//   6. DRIFT CURRENTS  dash streaks flowing along the canyon axes
//   7. VENT PLUMES     tall bubble columns off the trench floor
//   8. FISH SCHOOLS    instanced schools orbiting plateau landmarks
//   9. LEVIATHAN       one big silhouette crossing the deep on a slow loop
//  10. SPINDRIFT       wind-blown spray skimming the surface (above water only)
// =============================================================================
import * as THREE from 'three';
import { clamp01, lerp, mulberry32 } from '../../core/math.js';

// ── render-side tunables ────────────────────────────────────────────────────
const TERRAIN_PAD   = 16;   // terrain mesh overshoots the world extent by this
const TERRAIN_SEG_X = 440;  // oblong: segments scale with the axis
const TERRAIN_SEG_Z = 220;
const WATER_PAD     = 140;  // water runs well past the map, into the fog
const WATER_SEG_X   = 240;
const WATER_SEG_Z   = 140;
const GODRAY_COUNT  = 9;
const MOTE_COUNT    = 620;
const MOTE_BOX      = 40;
const SPINDRIFT     = 420;
const VENTS         = 6;
const VENT_PER      = 26;
const CURRENT_DASHES = 260;
const SCHOOLS       = 10;
const FISH_PER      = 38;
const DIVE_TIME     = 0.3;
// depth field sampled into a texture so water colour is per-FRAGMENT smooth
// instead of interpolated across ~4-unit surface triangles (that interpolation
// is what made the blue-to-blue transitions read as faceted / jagged).
const DEPTH_TEX_W   = 1024;
const DEPTH_TEX_H   = 512;

const C = (hex) => new THREE.Color(hex);
const V3 = (hex) => { const c = C(hex); return new THREE.Vector3(c.r, c.g, c.b); };

// =============================================================================
//  GEOMETRY BUILDERS
// =============================================================================
class GB {
  constructor() { this.pos = []; this.col = []; this.idx = []; this.n = 0; this.hasCol = false; }
  v(x, y, z, r, g, b) {
    this.pos.push(x, y, z);
    if (r !== undefined) { this.col.push(r, g, b); this.hasCol = true; }
    return this.n++;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (this.hasCol) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

function bladeInto(gb, x0, z0, width, height, segs, taper, rot) {
  const dx = Math.cos(rot), dz = Math.sin(rot);
  let pL = -1, pR = -1;
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const y = t * height;
    const w = width * (1 - (1 - taper) * t) * 0.5;
    const L = gb.v(x0 - dx * w, y, z0 - dz * w);
    const R = gb.v(x0 + dx * w, y, z0 + dz * w);
    if (s > 0) gb.quad(pL, pR, R, L);
    pL = L; pR = R;
  }
}

function clumpGeometry(nBlades, width, height, spread, taper, seed, segs = 5) {
  const rng = mulberry32(seed);
  const gb = new GB();
  for (let i = 0; i < nBlades; i++) {
    const a = rng() * Math.PI * 2, r = rng() * spread;
    bladeInto(gb, Math.cos(a) * r, Math.sin(a) * r,
      width * (0.7 + rng() * 0.6), height * (0.7 + rng() * 0.6), segs, taper, rng() * Math.PI);
  }
  return gb.geo();
}

// A tapered tube along an arbitrary direction — the primitive the branching
// corals and the anemones are built out of. Returns the tip so callers can
// keep growing from it.
function tubeInto(gb, x, y, z, dx, dy, dz, len, r0, r1, sides) {
  const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
  const ux = Math.abs(dz) > 0.9 ? 1 : 0, uy = 0, uz = Math.abs(dz) > 0.9 ? 0 : 1;
  let s1x = dy * uz - dz * uy, s1y = dz * ux - dx * uz, s1z = dx * uy - dy * ux;
  const s1l = Math.hypot(s1x, s1y, s1z) || 1; s1x /= s1l; s1y /= s1l; s1z /= s1l;
  const s2x = dy * s1z - dz * s1y, s2y = dz * s1x - dx * s1z, s2z = dx * s1y - dy * s1x;
  const ring = (rr, t) => {
    const out = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2, cx = Math.cos(a) * rr, cy = Math.sin(a) * rr;
      out.push(gb.v(
        x + dx * len * t + s1x * cx + s2x * cy,
        y + dy * len * t + s1y * cx + s2y * cy,
        z + dz * len * t + s1z * cx + s2z * cy));
    }
    return out;
  };
  const A = ring(r0, 0), B = ring(r1, 1);
  for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; gb.quad(A[i], A[j], B[j], B[i]); }
  return [x + dx * len, y + dy * len, z + dz * len];
}

// Kelp: taller, more segments than a generic clump so the sway curve is smooth
// rather than a five-link chain.
function kelpGeometry() {
  const rng = mulberry32(31);
  const gb = new GB();
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2, r = rng() * 0.24;
    bladeInto(gb, Math.cos(a) * r, Math.sin(a) * r,
      0.1 * (0.7 + rng() * 0.6), 0.72 + rng() * 0.5, 10, 0.45, rng() * Math.PI);
  }
  return gb.geo();
}

// Rock: a jittered icosahedron. The jitter is hashed off the ROUNDED vertex
// position so faces that share a corner displace identically (no cracks).
function rockGeometry(seed) {
  const geo = new THREE.IcosahedronGeometry(0.5, 1);
  const p = geo.attributes.position;
  const q = (v) => Math.round(v * 1000) / 1000;
  const h = (x, y, z) => { const s = Math.sin(q(x) * 17.3 + q(y) * 9.13 + q(z) * 23.7 + seed) * 43758.5453; return s - Math.floor(s); };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.6 + h(x, y, z) * 0.78;
    p.setXYZ(i, x * k, y * k * 0.74, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

// Brain coral: a flattened dome with meander ridges.
function brainGeometry() {
  const geo = new THREE.SphereGeometry(0.5, 18, 11);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (0.05 * Math.sin(x * 21.0) * Math.sin(z * 18.0) + 0.03 * Math.sin(y * 14.0)) / 0.5;
    p.setXYZ(i, x * k, Math.max(y, -0.08) * k * 0.78, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

// Branching coral: recursive tubes, unit height ~1.
function branchGeometry() {
  const rng = mulberry32(4242);
  const gb = new GB();
  (function grow(p, d, len, r, depth) {
    const end = tubeInto(gb, p[0], p[1], p[2], d[0], d[1], d[2], len, r, r * 0.66, 5);
    if (depth <= 0) return;
    const n = 2 + (rng() < 0.45 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, sp = 0.45 + rng() * 0.55;
      grow(end, [d[0] * 0.5 + Math.cos(a) * sp, d[1] * 0.8 + 0.3, d[2] * 0.5 + Math.sin(a) * sp],
        len * (0.62 + rng() * 0.16), r * 0.66, depth - 1);
    }
  })([0, 0, 0], [0, 1, 0], 0.36, 0.06, 3);
  return gb.geo();
}

// Anemone: a squat crown of soft tentacles.
function anemoneGeometry() {
  const rng = mulberry32(9091);
  const gb = new GB();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rng() * 0.4, r = 0.06 + rng() * 0.1;
    tubeInto(gb, Math.cos(a) * r * 0.4, 0.06, Math.sin(a) * r * 0.4,
      Math.cos(a) * 0.75, 1.0, Math.sin(a) * 0.75, 0.5 + rng() * 0.45, 0.045, 0.012, 4);
  }
  tubeInto(gb, 0, 0, 0, 0, 1, 0, 0.16, 0.2, 0.16, 8);
  return gb.geo();
}

// A sea fan: a flat, lobed paddle standing on a short stem. Reads as a
// silhouette against the water — which is exactly what a ridge crest wants.
function seafanGeometry() {
  const gb = new GB();
  const lobes = 5;
  gb.v(-0.04, 0, 0); gb.v(0.04, 0, 0);
  let prevL = 0, prevR = 1;
  for (let s = 1; s <= 6; s++) {
    const t = s / 6;
    const w = 0.06 + Math.sin(t * Math.PI) * 0.42 * (0.75 + 0.25 * Math.cos(t * lobes * 2.4));
    const y = t * 1.0;
    const L = gb.v(-w, y, Math.sin(t * 3.1) * 0.04);
    const R = gb.v(w, y, Math.sin(t * 3.1) * 0.04);
    gb.quad(prevL, prevR, R, L);
    prevL = L; prevR = R;
  }
  return gb.geo();
}

// Low-poly fish: diamond body + tail fin, nose along +X.
function fishGeometry() {
  const gb = new GB();
  const nose = gb.v(0.5, 0, 0);
  const top = gb.v(0.05, 0.14, 0);
  const bot = gb.v(0.05, -0.12, 0);
  const sideA = gb.v(0.1, 0, 0.11);
  const sideB = gb.v(0.1, 0, -0.11);
  const tail = gb.v(-0.4, 0, 0);
  gb.tri(nose, top, sideA); gb.tri(nose, sideA, bot);
  gb.tri(nose, bot, sideB); gb.tri(nose, sideB, top);
  gb.tri(tail, sideA, top); gb.tri(tail, bot, sideA);
  gb.tri(tail, top, sideB); gb.tri(tail, sideB, bot);
  const t1 = gb.v(-0.44, 0.2, 0), t2 = gb.v(-0.44, -0.2, 0), t3 = gb.v(-0.72, 0.1, 0), t4 = gb.v(-0.72, -0.1, 0);
  gb.quad(t1, t2, t4, t3);
  return gb.geo();
}

// A big manta-ish silhouette, wings along Z, nose along +X.
function leviathanGeometry() {
  const gb = new GB();
  const nose = gb.v(6, 0, 0);
  const lw = gb.v(-1, 0, 9), rw = gb.v(-1, 0, -9);
  const lb = gb.v(-5, 0, 3.4), rb = gb.v(-5, 0, -3.4);
  const spine = gb.v(0, 0.9, 0);
  const tail = gb.v(-13, 0, 0);
  gb.tri(nose, lw, spine); gb.tri(nose, spine, rw);
  gb.tri(spine, lw, lb); gb.tri(spine, rb, rw);
  gb.tri(spine, lb, rb);
  gb.tri(lb, tail, rb);
  return gb.geo();
}

function geometryFor(id) {
  switch (id) {
    case 'seafan':   return seafanGeometry();
    case 'kelp':     return kelpGeometry();
    case 'seagrass': return clumpGeometry(12, 0.055, 1.0, 0.36, 0.14, 77, 7);
    case 'tubeworm': return clumpGeometry(7, 0.06, 1.0, 0.22, 0.5, 57);
    case 'anemone':  return anemoneGeometry();
    case 'rock':     return rockGeometry(1301);
    case 'boulder':  return rockGeometry(2603);
    case 'brain':    return brainGeometry();
    case 'branch':   return branchGeometry();
    case 'shells':   return new THREE.SphereGeometry(0.5, 7, 3, 0, Math.PI * 2, 0, Math.PI * 0.5);
    default:         return new THREE.BoxGeometry(0.3, 0.3, 0.3);
  }
}

// =============================================================================
//  MATERIALS
// =============================================================================
function floraMaterial(kind) {
  const mat = new THREE.MeshStandardMaterial({
    roughness: kind.roughness ?? 0.86, metalness: 0.0,
    side: kind.solid ? THREE.FrontSide : THREE.DoubleSide, transparent: false,
  });
  const u = {
    uTime: { value: 0 },
    uSway: { value: kind.sway || 0 },
    uSwayScale: { value: kind.swayScale || 1 },
    uNightMix: { value: 0 },
    uNightTint: { value: V3(kind.colorNight || (kind.colorsNight && kind.colorsNight[0]) || kind.color || (kind.colors && kind.colors[0]) || '#204040') },
    uGlowAmt: { value: 0 },
    uGlowBase: { value: kind.glowNight || 0 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPhase;\nuniform float uTime,uSway,uSwayScale;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float _hy = max(transformed.y, 0.0);
        float _w = sin(uTime*uSwayScale + aPhase + transformed.y*0.35);
        float _w2 = cos(uTime*uSwayScale*0.8 + aPhase*1.3);
        transformed.x += _w * uSway * _hy * 0.2;
        transformed.z += _w2 * uSway * _hy * 0.15;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNightMix,uGlowAmt,uGlowBase;\nuniform vec3 uNightTint;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, uNightTint, uNightMix);`)
      .replace('#include <colorspace_fragment>', `
        gl_FragColor.rgb += vColor * (uGlowBase * uGlowAmt * 2.6);
        #include <colorspace_fragment>`);
  };
  mat.customProgramCacheKey = () => 'opensea-flora-' + kind.id;
  mat.userData.u = u;
  return mat;
}

// Fish: the body itself undulates. A rigid mesh translating along a path is
// exactly what reads as "floating" rather than swimming, so the tail beat is a
// vertex displacement that grows toward the tail, phased per instance.
function fishMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: '#b9d6e2', roughness: 0.52, metalness: 0.14, side: THREE.DoubleSide,
  });
  const u = { uTime: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aPhase;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float _tail = clamp((0.5 - transformed.x)/1.2, 0.0, 1.0);
        float _beat = sin(uTime*7.0 + aPhase - transformed.x*3.4);
        transformed.z += _beat * _tail * _tail * 0.34;
        transformed.y += _beat * _tail * 0.05;`);
  };
  mat.customProgramCacheKey = () => 'opensea-fish';
  mat.userData.u = u;
  return mat;
}

// Terrain: baked vertex colours + caustics (depth-gated) + underwater grade +
// ABYSS FALLOFF, the open-sea addition — light runs out with depth.
function terrainMaterial(day) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.0 });
  const uw = day.underwater;
  const u = {
    uTime: { value: 0 },
    uCaustic: { value: 1 },
    uCausticStrength: { value: uw.causticStrength },
    uCausticColor: { value: V3(uw.godrayColor) },
    uCausticMaxDepth: { value: uw.causticMaxDepth ?? 14 },
    uWaterY: { value: 0 },
    uUnderTint: { value: V3(uw.tint) },
    uUnderAmt: { value: 0 },
    uTerrainGrade: { value: new THREE.Vector3(1, 1, 1) },
    uAbyssColor: { value: V3(uw.abyssColor || '#03102c') },
    uAbyssStart: { value: uw.abyssStart ?? 18 },
    uAbyssFull: { value: uw.abyssFull ?? 46 },
    uAbyss: { value: 1 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vWPos=(modelMatrix*vec4(transformed,1.0)).xyz;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vWNorm=normalize(mat3(modelMatrix)*objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNorm;
        uniform float uTime,uCaustic,uCausticStrength,uWaterY,uUnderAmt,uCausticMaxDepth;
        uniform float uAbyssStart,uAbyssFull,uAbyss;
        uniform vec3 uCausticColor,uUnderTint,uTerrainGrade,uAbyssColor;
        float cLayer(vec2 p,float t){
          float v=sin(p.x+t)+sin(p.y-t*0.83)+sin((p.x+p.y)*0.7+t*0.6)+sin((p.x-p.y)*0.9-t*0.5);
          return pow(max(0.0,v*0.125+0.5),3.0);
        }`)
      .replace('#include <colorspace_fragment>', `
        float _below = step(vWPos.y, uWaterY);
        float _depth = max(uWaterY - vWPos.y, 0.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb*uUnderTint*1.9, _below*uUnderAmt*0.32);
        float _up = smoothstep(0.4,0.85,vWNorm.y);
        float _fade = clamp(1.0 - _depth/uCausticMaxDepth, 0.0, 1.0);
        float _c = cLayer(vWPos.xz*0.5, uTime*0.6)*0.6 + cLayer(vWPos.xz*0.9+13.0, -uTime*0.5)*0.5;
        gl_FragColor.rgb += uCausticColor * _c * uCausticStrength * uCaustic * _below * _up * _fade;
        gl_FragColor.rgb *= uTerrainGrade;
        // ── abyss falloff: absorption with depth, the open-sea signature ──
        float _ab = smoothstep(uAbyssStart, uAbyssFull, _depth) * uAbyss;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uAbyssColor, _ab*0.92);
        #include <colorspace_fragment>`);
  };
  mat.customProgramCacheKey = () => 'opensea-terrain';
  mat.userData.u = u;
  return mat;
}

// =============================================================================
//  WATER — rolling swell + whitecaps
// =============================================================================
function buildWater(zone, day, night, EX, EZ) {
  const geo = new THREE.PlaneGeometry((EX + WATER_PAD) * 2, (EZ + WATER_PAD) * 2, WATER_SEG_X, WATER_SEG_Z);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const depthArr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) depthArr[i] = zone.WATER_Y - zone.terrainHeight(pos.getX(i), pos.getZ(i));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depthArr, 1));

  // ── smooth depth field, as a texture ──────────────────────────────────────
  // The surface mesh is ~4 world units per triangle. Reading depth from the
  // vertex attribute means the colour ramp is linearly interpolated across
  // those triangles, and every stop boundary shows as a chain of facets. A
  // bilinear half-float texture gives a continuous depth per fragment instead.
  const halfX = EX + WATER_PAD, halfZ = EZ + WATER_PAD;
  const raw = new Float32Array(DEPTH_TEX_W * DEPTH_TEX_H);
  for (let j = 0; j < DEPTH_TEX_H; j++) {
    const z = -halfZ + ((j + 0.5) / DEPTH_TEX_H) * 2 * halfZ;
    for (let i = 0; i < DEPTH_TEX_W; i++) {
      const x = -halfX + ((i + 0.5) / DEPTH_TEX_W) * 2 * halfX;
      raw[j * DEPTH_TEX_W + i] = zone.WATER_Y - zone.terrainHeight(x, z);
    }
  }
  const sm = new Float32Array(raw.length);   // one 3x3 pass: kills the map's own band steps
  for (let j = 0; j < DEPTH_TEX_H; j++) {
    for (let i = 0; i < DEPTH_TEX_W; i++) {
      let s = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = Math.min(DEPTH_TEX_H - 1, Math.max(0, j + dj));
        for (let di = -1; di <= 1; di++) {
          const ii = Math.min(DEPTH_TEX_W - 1, Math.max(0, i + di));
          s += raw[jj * DEPTH_TEX_W + ii];
        }
      }
      sm[j * DEPTH_TEX_W + i] = s / 9;
    }
  }
  const halfData = new Uint16Array(sm.length);
  for (let i = 0; i < sm.length; i++) halfData[i] = THREE.DataUtils.toHalfFloat(sm[i]);
  const depthTex = new THREE.DataTexture(halfData, DEPTH_TEX_W, DEPTH_TEX_H, THREE.RedFormat, THREE.HalfFloatType);
  depthTex.minFilter = THREE.LinearFilter;
  depthTex.magFilter = THREE.LinearFilter;
  depthTex.wrapS = THREE.ClampToEdgeWrapping;
  depthTex.wrapT = THREE.ClampToEdgeWrapping;
  depthTex.generateMipmaps = false;
  depthTex.needsUpdate = true;

  const stops = day.water.depthStops;
  const u = {
    uTime: { value: 0 },
    uSwellAmp: { value: day.water.swellAmp ?? 0.6 },
    uSwellScale: { value: day.water.swellScale ?? 0.055 },
    uDepthTex: { value: depthTex },
    uHalf: { value: new THREE.Vector2(halfX, halfZ) },
    uDayC: { value: stops.map((s) => V3(s[1])) },
    uDepthT: { value: stops.map((s) => s[0]) },
    uOpacity: { value: day.water.opacity },
    uSurfaceTint: { value: V3(day.water.surfaceTint) },
    uSunColor: { value: V3(day.water.sunColor) },
    uSunDir: { value: new THREE.Vector3(...day.sun.direction).normalize() },
    uShimmer: { value: day.water.shimmer },
    uFoam: { value: V3(day.water.foam) },
    uFoamBand: { value: day.water.foamBand },
    uWhitecap: { value: day.water.whitecap ?? 0.5 },
    uCeiling: { value: V3(day.water.ceiling) },
    uSunDisc: { value: V3(day.water.sunDisc) },
    uFogColor: { value: V3(day.fog.color) },
    uFogNear: { value: day.fog.near }, uFogFar: { value: day.fog.far },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime,uSwellAmp,uSwellScale;
      attribute float aDepth;
      varying float vDepth; varying vec3 vWorldPos; varying vec3 vNormalW;
      varying float vFogDepth; varying float vCrest;
      // Two long crossing swells + a shorter chop rider. Deep-ocean surfaces
      // read as a few big wavelengths, not many small ones.
      float swell(vec2 p, float t){
        float a = sin(dot(p, vec2(0.92,0.39))*uSwellScale + t*0.55);
        float b = sin(dot(p, vec2(-0.35,0.94))*uSwellScale*0.72 - t*0.41);
        float c = sin(dot(p, vec2(0.6,-0.8))*uSwellScale*2.6 + t*1.15)*0.28;
        return a*0.62 + b*0.5 + c;
      }
      void main(){
        vDepth = aDepth;
        vec3 p = position;
        // amplitude tapers out in the last couple of units of water so the
        // surface never tears through a beach
        float wl = smoothstep(0.0, 3.0, aDepth);
        float d0 = swell(p.xz, uTime);
        float e = 1.4;
        float dx = swell(p.xz + vec2(e,0.0), uTime);
        float dz = swell(p.xz + vec2(0.0,e), uTime);
        p.y += d0 * uSwellAmp * wl;
        vNormalW = normalize(vec3(-(dx-d0)*uSwellAmp*wl/e, 1.0, -(dz-d0)*uSwellAmp*wl/e));
        // crest factor: high, steep water -> whitecap
        float steep = length(vec2(dx-d0, dz-d0))/e;
        vCrest = smoothstep(0.35, 0.95, d0) * smoothstep(0.02, 0.16, steep) * wl;
        vec4 wp = modelMatrix*vec4(p,1.0);
        vWorldPos = wp.xyz;
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `
      uniform vec3 uDayC[4]; uniform float uDepthT[4];
      uniform float uOpacity,uShimmer,uFoamBand,uWhitecap,uFogNear,uFogFar,uTime;
      uniform vec3 uSurfaceTint,uSunColor,uSunDir,uFoam,uCeiling,uSunDisc,uFogColor;
      uniform sampler2D uDepthTex; uniform vec2 uHalf;
      varying float vDepth; varying vec3 vWorldPos; varying vec3 vNormalW;
      varying float vFogDepth; varying float vCrest;
      vec3 enc(vec3 c){ return c; } // identity: the RENDERER owns sRGB encoding here (outputColorSpace = SRGBColorSpace, ColorManagement on), so palette hex values render as authored. Lagoon hand-encodes instead; if you wire this zone into a renderer configured Lagoon-style, restore the manual encode.
      vec3 stops(float d){
        vec3 c=uDayC[0];
        c=mix(c,uDayC[1],smoothstep(uDepthT[0],uDepthT[1],d));
        c=mix(c,uDayC[2],smoothstep(uDepthT[1],uDepthT[2],d));
        c=mix(c,uDayC[3],smoothstep(uDepthT[2],uDepthT[3],d));
        return c;
      }
      // fine capillary ripple, as a NORMAL perturbation. Three octaves drifting
      // at different rates: the sun glitter then breaks up into a moving field
      // of sparkles instead of sliding around as one soft blob.
      vec2 ripple(vec2 p, float t){
        vec2 n = vec2(0.0);
        float a = 1.0, f = 1.0;
        for(int i=0;i<3;i++){
          n += a*vec2(cos(p.x*f*0.62 + p.y*f*0.21 + t*f*0.85),
                      cos(p.y*f*0.57 - p.x*f*0.18 - t*f*0.72));
          a *= 0.52; f *= 2.3;
        }
        return n;
      }
      void main(){
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 N = normalize(vNormalW);
        vec3 S = normalize(uSunDir);
        // per-fragment depth: bilinear, so the colour ramp has no facet edges
        vec2 duv = (vWorldPos.xz + uHalf) / (2.0*uHalf);
        float depth = max(texture2D(uDepthTex, clamp(duv, 0.0, 1.0)).r, 0.0);
        vec3 base = stops(depth);
        vec3 col; float alpha;
        if(gl_FrontFacing){
          vec2 rp = ripple(vWorldPos.xz, uTime);
          vec3 Nf = normalize(N + vec3(rp.x, 0.0, rp.y)*0.055);
          float fres = pow(1.0 - max(dot(N,V),0.0), 3.0);
          col = base + uSurfaceTint*fres*0.3;
          vec3 H = normalize(S+V);
          // broad sheen from the swell + tight glitter from the ripple normal
          float sheen   = pow(max(dot(N ,H),0.0), 28.0);
          float glitter = pow(max(dot(Nf,H),0.0), 340.0);
          col += uSunColor*(sheen*0.22 + glitter*1.15)*uShimmer;
          // whitecaps: two crossing streak fields, thresholded, so foam sits in
          // torn ribbons on the crests rather than a smooth wash
          float s1 = sin(vWorldPos.x*0.85 - vWorldPos.z*0.55 + uTime*1.05);
          float s2 = sin(vWorldPos.x*2.35 + vWorldPos.z*1.75 - uTime*1.6);
          float streak = clamp(0.5 + 0.34*s1 + 0.22*s2, 0.0, 1.0);
          float cap = smoothstep(0.22, 0.72, vCrest*streak)*uWhitecap;
          float shore = smoothstep(uFoamBand,0.0,depth);
          col = mix(col, uFoam, clamp(cap + shore*0.85, 0.0, 1.0));
          alpha = mix(0.7, uOpacity, smoothstep(0.2,5.0,depth));
          alpha = max(alpha, max(shore*0.92, cap*0.9));
        } else {
          // seen from BELOW: bright ceiling, sun disc, crest brightening
          float sun = pow(max(dot(normalize(-V),S),0.0),40.0);
          col = uCeiling + uSunDisc*sun*1.4;
          col += uSunColor*vCrest*0.35;
          col += uSunColor*(0.5+0.5*sin(vWorldPos.x*0.35+vWorldPos.z*0.3+uTime*0.5))*0.04;
          alpha = 0.86;
        }
        col = mix(col, uFogColor, smoothstep(uFogNear,uFogFar,vFogDepth));
        gl_FragColor = vec4(enc(col), alpha);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  mesh.userData.u = u;
  return mesh;
}

// =============================================================================
//  GOD RAYS — depth-gated: they belong to the top of the water column only
// =============================================================================
function buildGodrays(zone, day) {
  const group = new THREE.Group();
  const u = {
    uTime: { value: 0 },
    uColor: { value: V3(day.underwater.godrayColor) },
    uOpacity: { value: 0.06 * day.underwater.godrayStrength },
    uDepthGate: { value: 1 },
    uFogNear: { value: 2 }, uFogFar: { value: 34 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `
      varying float vY; varying float vFog;
      void main(){ vY = uv.y;
        vec4 mv = modelViewMatrix*vec4(position,1.0);
        vFog = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity,uTime,uFogNear,uFogFar,uDepthGate;
      varying float vY; varying float vFog;
      vec3 enc(vec3 c){ return c; } // identity: the RENDERER owns sRGB encoding here (outputColorSpace = SRGBColorSpace, ColorManagement on), so palette hex values render as authored. Lagoon hand-encodes instead; if you wire this zone into a renderer configured Lagoon-style, restore the manual encode.
      void main(){
        float vert = smoothstep(0.0,0.3,vY)*pow(vY,0.55);
        float flick = 0.7 + 0.3*sin(uTime*0.6 + vY*3.0);
        float fog = smoothstep(uFogNear,uFogFar,vFog);
        gl_FragColor = vec4(enc(uColor), uOpacity*vert*flick*(1.0-fog)*uDepthGate);
      }`,
  });
  const rng = mulberry32(9131);
  const geo = new THREE.CylinderGeometry(0.8, 9.0, 34, 14, 1, true);
  const tilt = new THREE.Vector3(...day.sun.direction).normalize();
  for (let i = 0; i < GODRAY_COUNT; i++) {
    const a = rng() * Math.PI * 2, r = 6 + rng() * 44;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(Math.cos(a) * r, zone.WATER_Y - 16, Math.sin(a) * r * 0.75);
    m.rotation.z = tilt.x * 0.3 + (rng() - 0.5) * 0.12;
    m.rotation.x = -tilt.z * 0.3 + (rng() - 0.5) * 0.12;
    m.scale.setScalar(0.7 + rng() * 0.9);
    m.frustumCulled = false;
    group.add(m);
  }
  group.userData.u = u;
  return group;
}

// =============================================================================
//  MARINE SNOW — motes that fall, and glow once the light has gone
// =============================================================================
function buildMotes(day) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(MOTE_COUNT * 3), ph = new Float32Array(MOTE_COUNT), sp = new Float32Array(MOTE_COUNT);
  const rng = mulberry32(5150);
  for (let i = 0; i < MOTE_COUNT; i++) {
    p[i * 3] = (rng() * 2 - 1) * MOTE_BOX;
    p[i * 3 + 1] = (rng() * 2 - 1) * MOTE_BOX;
    p[i * 3 + 2] = (rng() * 2 - 1) * MOTE_BOX;
    ph[i] = rng() * 100;
    sp[i] = 0.35 + rng() * 0.75;   // sink rate
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  g.setAttribute('aSink', new THREE.BufferAttribute(sp, 1));
  const u = {
    uTime: { value: 0 }, uSize: { value: 1.7 },
    uColor: { value: V3(day.underwater.moteColor) }, uOpacity: { value: 0.26 },
    uFogNear: { value: 2 }, uFogFar: { value: 34 },
    uGlow: { value: 0 }, uBox: { value: MOTE_BOX },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime,uSize,uBox; attribute float aPhase,aSink;
      varying float vFog; varying float vTw;
      void main(){
        vec3 pp = position;
        // sink and wrap through the box the camera carries around
        pp.y = mod(pp.y - uTime*aSink*0.6 + aPhase, uBox*2.0) - uBox;
        pp.x += sin(uTime*0.16 + aPhase)*0.9;
        pp.z += cos(uTime*0.13 + aPhase*1.2)*0.9;
        vTw = 0.55 + 0.45*sin(uTime*1.6 + aPhase*7.0);
        vec4 mv = modelViewMatrix*vec4(pp,1.0);
        vFog = -mv.z;
        gl_PointSize = min(uSize * (300.0 / max(-mv.z,1.0)), 4.5);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity,uFogNear,uFogFar,uGlow;
      varying float vFog; varying float vTw;
      vec3 enc(vec3 c){ return c; } // identity: the RENDERER owns sRGB encoding here (outputColorSpace = SRGBColorSpace, ColorManagement on), so palette hex values render as authored. Lagoon hand-encodes instead; if you wire this zone into a renderer configured Lagoon-style, restore the manual encode.
      void main(){
        float d = length(gl_PointCoord-0.5);
        float a = smoothstep(0.5,0.0,d)*uOpacity*(1.0-smoothstep(uFogNear,uFogFar,vFog));
        // plankton twinkle only kicks in where it is dark
        vec3 c = uColor*(1.0 + uGlow*vTw*2.2);
        gl_FragColor = vec4(enc(c), a*(0.7+0.3*vTw));
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  pts.userData.u = u;
  return pts;
}

// =============================================================================
//  DRIFT CURRENTS — dashes streaming along the canyon axes
// =============================================================================
function buildCurrents(zone) {
  const lanes = (zone.landmarks && zone.landmarks.canyons) || [];
  const rng = mulberry32(3311);
  const posArr = [], dirArr = [], phaseArr = [], lenArr = [], tailArr = [];
  const per = Math.max(1, Math.floor(CURRENT_DASHES / Math.max(1, lanes.length)));
  for (const lane of lanes) {
    for (let i = 0; i < per; i++) {
      const seg = Math.min(lane.length - 2, Math.floor(rng() * (lane.length - 1)));
      const a = lane[seg], b = lane[seg + 1];
      const t = rng();
      const jx = (rng() - 0.5) * 14, jz = (rng() - 0.5) * 14;
      const x = a[0] + (b[0] - a[0]) * t + jx;
      const z = a[1] + (b[1] - a[1]) * t + jz;
      const y = zone.terrainHeight(x, z) + 1.5 + rng() * 8;
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const dl = Math.hypot(dx, dz) || 1;
      const travel = 16 + rng() * 26;
      const dashLen = 1.6 + rng() * 3.4;
      for (let k = 0; k < 2; k++) {   // head + tail vertex of one dash
        posArr.push(x, y, z);
        dirArr.push(dx / dl, 0, dz / dl);
        phaseArr.push(rng());
        lenArr.push(travel);
        tailArr.push(k === 0 ? 0 : dashLen);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  g.setAttribute('aDir', new THREE.Float32BufferAttribute(dirArr, 3));
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phaseArr, 1));
  g.setAttribute('aTravel', new THREE.Float32BufferAttribute(lenArr, 1));
  g.setAttribute('aTail', new THREE.Float32BufferAttribute(tailArr, 1));
  const u = {
    uTime: { value: 0 }, uColor: { value: V3('#cfeaff') }, uOpacity: { value: 0.3 },
    uFogNear: { value: 2 }, uFogFar: { value: 34 }, uSpeed: { value: 0.09 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime,uSpeed; attribute vec3 aDir; attribute float aPhase,aTravel,aTail;
      varying float vFog; varying float vFade;
      void main(){
        float t = fract(uTime*uSpeed*(0.6+aPhase) + aPhase);
        vFade = sin(t*3.14159);
        vec3 pp = position + aDir*(t*aTravel - aTail);
        vec4 mv = modelViewMatrix*vec4(pp,1.0);
        vFog = -mv.z;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity,uFogNear,uFogFar;
      varying float vFog; varying float vFade;
      vec3 enc(vec3 c){ return c; } // identity: the RENDERER owns sRGB encoding here (outputColorSpace = SRGBColorSpace, ColorManagement on), so palette hex values render as authored. Lagoon hand-encodes instead; if you wire this zone into a renderer configured Lagoon-style, restore the manual encode.
      void main(){
        gl_FragColor = vec4(enc(uColor), uOpacity*vFade*(1.0-smoothstep(uFogNear,uFogFar,vFog)));
      }`,
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 3;
  lines.userData.u = u;
  return lines;
}

// =============================================================================
//  VENT PLUMES — tall bubble columns off the trench floor
// =============================================================================
function buildVents(zone) {
  const axis = (zone.landmarks && zone.landmarks.trench) || [[0, 0], [1, 1]];
  const rng = mulberry32(2027);
  const N = VENTS * VENT_PER;
  const pos = new Float32Array(N * 3);
  const aPhase = new Float32Array(N), aSpeed = new Float32Array(N), aRise = new Float32Array(N), aWob = new Float32Array(N);
  const anchors = [];
  for (let s = 0; s < VENTS; s++) {
    const seg = Math.min(axis.length - 2, Math.floor((s / VENTS) * (axis.length - 1)));
    const a = axis[seg], b = axis[seg + 1], t = 0.25 + rng() * 0.5;
    const x = a[0] + (b[0] - a[0]) * t + (rng() - 0.5) * 18;
    const z = a[1] + (b[1] - a[1]) * t + (rng() - 0.5) * 18;
    anchors.push([x, z]);
  }
  let k = 0;
  for (let s = 0; s < VENTS; s++) {
    const [ax, az] = anchors[s];
    const ay = zone.terrainHeight(ax, az) + 0.2;
    const rise = Math.min(zone.WATER_Y - ay, 30) + 1;
    for (let b = 0; b < VENT_PER; b++) {
      pos[k * 3] = ax + (rng() - 0.5) * 1.6;
      pos[k * 3 + 1] = ay;
      pos[k * 3 + 2] = az + (rng() - 0.5) * 1.6;
      aPhase[k] = rng(); aSpeed[k] = 0.05 + rng() * 0.05;
      aRise[k] = rise; aWob[k] = 0.4 + rng() * 0.9;
      k++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
  g.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
  g.setAttribute('aRise', new THREE.BufferAttribute(aRise, 1));
  g.setAttribute('aWob', new THREE.BufferAttribute(aWob, 1));
  const u = { uTime: { value: 0 }, uSize: { value: 3.2 }, uOpacity: { value: 0.3 }, uFogNear: { value: 2 }, uFogFar: { value: 34 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime,uSize; attribute float aPhase,aSpeed,aRise,aWob;
      varying float vFog; varying float vT;
      void main(){
        float tt = fract(uTime*aSpeed + aPhase);
        vT = tt;
        vec3 pp = position;
        pp.y += tt*aRise;
        pp.x += sin(tt*6.2831 + aPhase*10.0)*aWob*(0.4+tt);
        pp.z += cos(tt*6.2831*1.1 + aPhase*10.0)*aWob*(0.4+tt);
        vec4 mv = modelViewMatrix*vec4(pp,1.0);
        vFog = -mv.z;
        gl_PointSize = min(uSize*(0.5+tt*1.3) * (300.0/max(-mv.z,1.0)), 7.0);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `
      uniform float uOpacity,uFogNear,uFogFar;
      varying float vFog; varying float vT;
      vec3 enc(vec3 c){ return c; } // identity: the RENDERER owns sRGB encoding here (outputColorSpace = SRGBColorSpace, ColorManagement on), so palette hex values render as authored. Lagoon hand-encodes instead; if you wire this zone into a renderer configured Lagoon-style, restore the manual encode.
      void main(){
        float d = length(gl_PointCoord-0.5);
        float core = smoothstep(0.5,0.06,d);
        float a = core*uOpacity*(1.0-vT*0.8)*(1.0-smoothstep(uFogNear,uFogFar,vFog));
        gl_FragColor = vec4(enc(vec3(0.72,0.86,0.94)), a);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  pts.userData.u = u;
  return pts;
}

// =============================================================================
//  SPINDRIFT — wind-blown spray skimming the surface (above water only)
// =============================================================================
function buildSpindrift(zone, EX, EZ) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(SPINDRIFT * 3), ph = new Float32Array(SPINDRIFT);
  const rng = mulberry32(8484);
  for (let i = 0; i < SPINDRIFT; i++) {
    p[i * 3] = (rng() * 2 - 1) * 90;
    p[i * 3 + 1] = zone.WATER_Y + rng() * 2.2;
    p[i * 3 + 2] = (rng() * 2 - 1) * 90;
    ph[i] = rng();
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  const u = {
    uTime: { value: 0 }, uSize: { value: 2.2 }, uOpacity: { value: 0.22 },
    uColor: { value: V3('#ffffff') }, uWind: { value: new THREE.Vector2(0.92, 0.39) },
    uFogNear: { value: 90 }, uFogFar: { value: 420 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime,uSize; uniform vec2 uWind; attribute float aPhase;
      varying float vFog; varying float vT;
      void main(){
        float t = fract(uTime*0.07 + aPhase);
        vT = t;
        vec3 pp = position;
        pp.xz += uWind * (t*70.0);
        pp.y += sin(t*3.14159)*1.6;
        vec4 mv = modelViewMatrix*vec4(pp,1.0);
        vFog = -mv.z;
        gl_PointSize = uSize*(300.0/max(-mv.z,1.0));
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity,uFogNear,uFogFar;
      varying float vFog; varying float vT;
      vec3 enc(vec3 c){ return c; } // identity: the RENDERER owns sRGB encoding here (outputColorSpace = SRGBColorSpace, ColorManagement on), so palette hex values render as authored. Lagoon hand-encodes instead; if you wire this zone into a renderer configured Lagoon-style, restore the manual encode.
      void main(){
        float d=length(gl_PointCoord-0.5);
        float a=smoothstep(0.5,0.0,d)*uOpacity*sin(vT*3.14159)*(1.0-smoothstep(uFogNear,uFogFar,vFog));
        gl_FragColor=vec4(enc(uColor),a);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 2;
  pts.userData.u = u;
  return pts;
}

// =============================================================================
//  FISH SCHOOLS + LEVIATHAN — the only moving life; CPU-driven (few enough)
// =============================================================================
function buildFish(zone) {
  const group = new THREE.Group();
  const rng = mulberry32(6060);
  const plateaus = (zone.landmarks && zone.landmarks.plateaus) || [];
  const schools = [];
  for (let s = 0; s < SCHOOLS; s++) {
    const pl = plateaus[s % Math.max(1, plateaus.length)] || { x: 0, z: 0, rx: 60, rz: 40 };
    const cx = pl.x + (rng() - 0.5) * pl.rx * 0.7;
    const cz = pl.z + (rng() - 0.5) * pl.rz * 0.7;
    const orbit = 14 + rng() * 26;
    const y = zone.terrainHeight(cx, cz) + 3 + rng() * 6;
    schools.push({
      cx, cz, orbit, y, phase: rng() * Math.PI * 2,
      speed: (0.05 + rng() * 0.05) * (rng() < 0.5 ? -1 : 1),
      bob: 1.2 + rng() * 2.4, squash: 0.62 + rng() * 0.3,
      fish: Array.from({ length: FISH_PER }, () => ({
        // each fish keeps its own slot in the shoal: a lead along the path, a
        // radial offset off it, and a height offset. Nothing shares a heading.
        lead: (rng() - 0.5) * 0.5,
        orad: (rng() - 0.5) * 9,
        oy: (rng() - 0.5) * 3.4,
        ph: rng() * 6.28,
        beat: 0.85 + rng() * 0.5,
        sc: 0.5 + rng() * 0.7,
      })),
    });
  }
  const geo = fishGeometry();
  const total = SCHOOLS * FISH_PER;
  // per-instance phase drives the tail beat in the vertex shader
  const fishPhase = new Float32Array(total);
  const mat = fishMaterial();
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  mesh.frustumCulled = false;
  group.add(mesh);

  // the leviathan: one slow silhouette crossing the deep
  const lev = new THREE.Mesh(leviathanGeometry(), new THREE.MeshStandardMaterial({
    color: '#0d2137', roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
  }));
  lev.frustumCulled = false;
  group.add(lev);

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  {  // seed per-instance tail phase + a little colour variety across the shoal
    let i = 0;
    for (const sc of schools) for (const f of sc.fish) {
      fishPhase[i] = f.ph * 3.0;
      col.setHSL(0.52 + (f.ph % 1) * 0.06, 0.22 + (f.sc - 0.5) * 0.18, 0.58 + (f.ph % 0.3));
      mesh.setColorAt(i, col);
      i++;
    }
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(fishPhase, 1));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function update(t) {
    mat.userData.u.uTime.value = t;
    let i = 0;
    for (const sc of schools) {
      const a = sc.phase + t * sc.speed;
      for (const f of sc.fish) {
        // travel the shoal's path at your own lead, at your own radius
        const fa = a + f.lead;
        const R = sc.orbit + f.orad;
        const weave = Math.sin(t * 0.55 + f.ph) * 1.1;
        const hx = sc.cx + Math.cos(fa) * (R + weave);
        const hz = sc.cz + Math.sin(fa) * (R + weave) * sc.squash;
        // tangent of that ellipse = the direction actually travelled
        const dx = -Math.sin(fa) * R * Math.sign(sc.speed);
        const dz = Math.cos(fa) * R * sc.squash * Math.sign(sc.speed);
        const bobY = Math.sin(t * 0.9 + f.ph) * 0.45 + Math.sin(t * 0.3 + sc.phase) * sc.bob;
        let y = sc.y + f.oy + bobY;
        const floor = zone.terrainHeight(hx, hz) + 0.9 * f.sc;
        if (y < floor) y = floor;
        if (y > zone.WATER_Y - 0.7) y = zone.WATER_Y - 0.7;
        dummy.position.set(hx, y, hz);
        // nose (+X) onto the tangent, bank into the turn, pitch with the bob
        const yaw = Math.atan2(-dz, dx);
        const roll = -0.34 * Math.sign(sc.speed) + Math.sin(t * 1.7 * f.beat + f.ph) * 0.12;
        const pitch = Math.cos(t * 0.9 + f.ph) * 0.16;
        dummy.rotation.set(pitch, yaw, roll, 'YXZ');
        dummy.scale.setScalar(f.sc);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    // leviathan: long west-east pass down the trench, banking gently
    const lt = (t * 0.012) % 1;
    const lx = lerp(-320, 320, lt);
    const lz = lerp(-40, 66, lt) + Math.sin(t * 0.05) * 22;
    lev.position.set(lx, zone.terrainHeight(lx, lz) * 0.42 - 6, lz);
    lev.rotation.set(Math.sin(t * 0.1) * 0.08, -Math.PI * 0.5 + Math.sin(t * 0.05) * 0.3, Math.sin(t * 0.12) * 0.12);
  }
  group.userData.update = update;
  return group;
}

// =============================================================================
//  FLORA (instanced)
// =============================================================================
function buildFlora(zone) {
  const group = new THREE.Group();
  const kinds = {};
  const recipe = zone.scatterRecipe;
  const rng = mulberry32(recipe.seed);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const A = recipe.area;
  const minX = A.minX ?? A.min, maxX = A.maxX ?? A.max;
  const minZ = A.minZ ?? A.min, maxZ = A.maxZ ?? A.max;

  for (const kind of recipe.kinds) {
    const placed = [];
    let attempts = 0;
    const maxAtt = kind.count * 26;
    // `clump` kinds grow in patches: one accepted point seeds a neighbourhood
    // that the next N samples are drawn from. Meadows and coral gardens, not
    // an even sprinkle.
    let center = null, centerLeft = 0;
    while (placed.length < kind.count && attempts < maxAtt) {
      attempts++;
      let x, z;
      if (kind.clump && center && centerLeft > 0) {
        const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * kind.clump;
        x = center[0] + Math.cos(a) * rr; z = center[1] + Math.sin(a) * rr;
        centerLeft--;
      } else {
        x = lerp(minX, maxX, rng());
        z = lerp(minZ, maxZ, rng());
      }
      const h = zone.terrainHeight(x, z);
      const depth = zone.WATER_Y - h;
      if (depth < kind.minDepth || depth > kind.maxDepth) continue;
      const n = zone.terrainNormal(x, z, 0.8);
      if (n[1] < kind.slopeMin) continue;
      if (kind.clump && centerLeft <= 0) { center = [x, z]; centerLeft = kind.clumpCount || 22; }
      placed.push({ x, y: h, z, rot: rng() * Math.PI * 2, r: rng(), r2: rng(), r3: rng(), r4: rng(), n });
    }
    const geo = geometryFor(kind.id);
    const mat = floraMaterial(kind);
    const count = Math.max(placed.length, 1);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const phases = new Float32Array(count);
    const palette = (kind.colors || [kind.color]).map(C);
    for (let i = 0; i < placed.length; i++) {
      const pl = placed[i];
      dummy.position.set(pl.x, pl.y, pl.z);
      dummy.rotation.set(0, pl.rot, 0);
      if (kind.id === 'shells') { dummy.rotation.x = (pl.r - 0.5) * 0.6; dummy.rotation.z = pl.n[0] * 0.8; }
      let sx, sy, sz;
      if (kind.height) {
        const hgt = lerp(kind.height[0], kind.height[1], pl.r);
        const wq = 0.8 + pl.r * 0.5;
        sx = wq; sz = wq; sy = hgt;
      } else {
        const sc = kind.scale ? lerp(kind.scale[0], kind.scale[1], pl.r) : 1;
        sx = sy = sz = sc;
      }
      // rocks and boulders: squashed and stretched per instance, tilted onto
      // the slope, and part-buried so they sit IN the seabed, not on it
      if (kind.nonUniform) {
        sx *= 0.7 + pl.r2 * 0.75; sz *= 0.7 + pl.r3 * 0.75; sy *= 0.55 + pl.r4 * 0.7;
        dummy.rotation.x = (pl.r2 - 0.5) * 0.5 + Math.asin(clamp01(-pl.n[2] + 0.5) - 0.5) * 0.5;
        dummy.rotation.z = (pl.r3 - 0.5) * 0.5;
      }
      if (kind.sink) dummy.position.y -= sy * kind.sink;
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      phases[i] = pl.r * 100;
      col.copy(palette[(pl.r * palette.length) | 0] || palette[0]);
      col.offsetHSL(0, 0, (pl.r - 0.5) * 0.08);
      mesh.setColorAt(i, col);
    }
    for (let i = placed.length; i < count; i++) {
      dummy.position.set(0, -9999, 0); dummy.scale.set(0.0001, 0.0001, 0.0001); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.frustumCulled = false;
    group.add(mesh);
    kinds[kind.id] = mesh;
  }
  return { group, kinds };
}

// =============================================================================
//  TERRAIN
// =============================================================================
function buildTerrain(zone, day, EX, EZ) {
  const geo = new THREE.PlaneGeometry((EX + TERRAIN_PAD) * 2, (EZ + TERRAIN_PAD) * 2, TERRAIN_SEG_X, TERRAIN_SEG_Z);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const t = day.terrain;
  const cSand = C(t.sand), cWet = C(t.wetSand), cRock = C(t.rock), cDeep = C(t.deepTint);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = zone.terrainHeight(x, z);
    pos.setY(i, h);
    const depth = zone.WATER_Y - h;
    const n = zone.terrainNormal(x, z, 0.9);
    tmp.copy(cSand);
    const wet = Math.max(0, 1 - Math.abs(depth - 0.3) / 1.4);
    tmp.lerp(cWet, wet * 0.7);
    const steep = clamp01((0.9 - n[1]) / 0.5);   // canyon + trench walls are rock
    tmp.lerp(cRock, steep * 0.95);
    // the deeps lose colour AND value — a dive should read as a descent even
    // before the shader's abyss ramp takes over
    tmp.lerp(cDeep, clamp01((depth - 4) / 22) * 0.9);
    const dark = 1 - 0.5 * clamp01((depth - 8) / 40);
    tmp.multiplyScalar(dark);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = terrainMaterial(day);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.u = mat.userData.u;
  mesh.frustumCulled = false;
  return mesh;
}

// =============================================================================
//  CONTROLLER
// =============================================================================
export function createOpenSea(zone, opts = {}) {
  const day = zone.PALETTES.day;
  const WATER_Y = zone.WATER_Y;
  const EX = zone.worldExtentX ?? zone.worldExtent ?? 300;
  const EZ = zone.worldExtentZ ?? zone.worldExtent ?? 150;
  const group = new THREE.Group();

  const ownLights = !opts.hemi || !opts.sun;
  const hemi = opts.hemi || new THREE.HemisphereLight(C(day.hemisphere.sky), C(day.hemisphere.ground), day.hemisphere.intensity);
  const sun = opts.sun || new THREE.DirectionalLight(C(day.sun.color), day.sun.intensity);
  const ambient = new THREE.AmbientLight(0xffffff, 0.0);
  if (ownLights) group.add(hemi, sun, sun.target);
  group.add(ambient);

  const terrain = buildTerrain(zone, day, EX, EZ);
  const water = buildWater(zone, day, zone.PALETTES.night, EX, EZ);
  const godrays = buildGodrays(zone, day);
  const motes = buildMotes(day);
  const currents = buildCurrents(zone);
  const vents = buildVents(zone);
  const spindrift = buildSpindrift(zone, EX, EZ);
  const fish = buildFish(zone);
  const flora = buildFlora(zone);
  group.add(terrain, water, godrays, motes, currents, vents, spindrift, fish, flora.group);

  const layers = { terrain, water, godrays, motes, currents, vents, spindrift, fish, flora: flora.group, caustics: null, abyss: null };
  const enabled = {
    terrain: true, water: true, caustics: true, abyss: true, godrays: true, motes: true,
    currents: true, vents: true, spindrift: true, fish: true, flora: true, glow: true,
  };
  let glowOn = true;

  const state = { dayNight: 0, underwater: false, underwaterAmount: 0, time: 0, cameraDepth: 0 };
  let overlayEl = null;

  const cycle = ((zone.dayCycle && zone.dayCycle.length) ? zone.dayCycle : [{ t: 0, key: 'day' }, { t: 1, key: 'night' }])
    .map((s) => ({ t: s.t, pal: zone.PALETTES[s.key] }))
    .filter((s) => s.pal)
    .sort((a, b) => a.t - b.t);

  function res(p) {
    return {
      hemiSky: C(p.hemisphere.sky), hemiGround: C(p.hemisphere.ground), hemiInt: p.hemisphere.intensity,
      sunColor: C(p.sun.color), sunInt: p.sun.intensity, sunDir: new THREE.Vector3(...p.sun.direction).normalize(),
      wOpacity: p.water.opacity, wStops: p.water.depthStops.map((s) => C(s[1])),
      wSurface: C(p.water.surfaceTint), wSun: C(p.water.sunColor), wCeiling: C(p.water.ceiling),
      wSunDisc: C(p.water.sunDisc), wShimmer: p.water.shimmer, wFoam: C(p.water.foam),
      wWhitecap: p.water.whitecap ?? 0.5, wSwellAmp: p.water.swellAmp ?? 0.6, wSwellScale: p.water.swellScale ?? 0.055,
      grade: C(p.terrainGrade || '#ffffff'),
      fogColor: C(p.fog.color), fogNear: p.fog.near, fogFar: p.fog.far, sky: C(p.sky),
      uwFog: C(p.underwater.fogColor), uwDensity: p.underwater.fogDensity, uwTint: C(p.underwater.tint),
      uwTintStr: p.underwater.tintStrength, uwAmbient: p.underwater.ambient,
      caustic: p.underwater.causticStrength, causticMax: p.underwater.causticMaxDepth ?? 14,
      godC: C(p.underwater.godrayColor), godStr: p.underwater.godrayStrength, godMax: p.underwater.godrayMaxDepth ?? 26,
      moteC: C(p.underwater.moteColor), biolum: p.underwater.bioluminescence,
      abyssC: C(p.underwater.abyssColor || '#03102c'),
      abyssStart: p.underwater.abyssStart ?? 18, abyssFull: p.underwater.abyssFull ?? 46,
      deepBiolum: p.underwater.deepBiolum ?? 0.5, current: p.underwater.currentStrength ?? 0.5,
      bStr: p.bloom.strength, bRad: p.bloom.radius, bThr: p.bloom.threshold,
    };
  }
  const RES = cycle.map((s) => ({ t: s.t, r: res(s.pal) }));
  const cur = res(cycle[0].pal);
  const bloom = { strength: cur.bStr, radius: cur.bRad, threshold: cur.bThr };

  const _fog = new THREE.Color(), _fogUw = new THREE.Color(), _fogFinal = new THREE.Color();
  const _sky = new THREE.Color(), _bg = new THREE.Color(), _grade = new THREE.Color();
  const _setv = (u, c) => u.value.set(c.r, c.g, c.b);

  function setDayNight(tt) {
    tt = clamp01(tt); state.dayNight = tt;
    let a = RES[0], b = RES[RES.length - 1];
    for (let i = 0; i < RES.length - 1; i++) {
      if (tt >= RES[i].t && tt <= RES[i + 1].t) { a = RES[i]; b = RES[i + 1]; break; }
    }
    const A = a.r, B = b.r, f = clamp01((tt - a.t) / ((b.t - a.t) || 1));
    const L = (k) => lerp(A[k], B[k], f);
    const M = (k) => cur[k].copy(A[k]).lerp(B[k], f);

    M('hemiSky'); M('hemiGround'); cur.hemiInt = L('hemiInt');
    M('sunColor'); cur.sunInt = L('sunInt');
    cur.sunDir.copy(A.sunDir).lerp(B.sunDir, f).normalize();
    cur.wOpacity = L('wOpacity');
    for (let i = 0; i < cur.wStops.length; i++) cur.wStops[i].copy(A.wStops[i]).lerp(B.wStops[i], f);
    M('wSurface'); M('wSun'); M('wCeiling'); M('wSunDisc'); M('wFoam');
    cur.wShimmer = L('wShimmer'); cur.wWhitecap = L('wWhitecap');
    cur.wSwellAmp = L('wSwellAmp'); cur.wSwellScale = L('wSwellScale');
    M('grade'); M('fogColor'); cur.fogNear = L('fogNear'); cur.fogFar = L('fogFar'); M('sky');
    M('uwFog'); cur.uwDensity = L('uwDensity'); M('uwTint');
    cur.uwTintStr = L('uwTintStr'); cur.uwAmbient = L('uwAmbient');
    cur.caustic = L('caustic'); cur.causticMax = L('causticMax');
    M('godC'); cur.godStr = L('godStr'); cur.godMax = L('godMax');
    M('moteC'); cur.biolum = L('biolum');
    M('abyssC'); cur.abyssStart = L('abyssStart'); cur.abyssFull = L('abyssFull');
    cur.deepBiolum = L('deepBiolum'); cur.current = L('current');
    cur.bStr = L('bStr'); cur.bRad = L('bRad'); cur.bThr = L('bThr');

    hemi.color.copy(cur.hemiSky); hemi.groundColor.copy(cur.hemiGround); hemi.intensity = cur.hemiInt;
    sun.color.copy(cur.sunColor); sun.intensity = cur.sunInt;
    sun.position.copy(cur.sunDir).multiplyScalar(240); sun.target.position.set(0, 0, 0);

    const wu = water.userData.u;
    for (let i = 0; i < cur.wStops.length; i++) { const s = cur.wStops[i]; wu.uDayC.value[i].set(s.r, s.g, s.b); }
    wu.uOpacity.value = cur.wOpacity;
    _setv(wu.uSurfaceTint, cur.wSurface); _setv(wu.uSunColor, cur.wSun);
    _setv(wu.uCeiling, cur.wCeiling); _setv(wu.uSunDisc, cur.wSunDisc); _setv(wu.uFoam, cur.wFoam);
    wu.uSunDir.value.copy(cur.sunDir);
    wu.uShimmer.value = cur.wShimmer; wu.uWhitecap.value = cur.wWhitecap;
    wu.uSwellAmp.value = cur.wSwellAmp; wu.uSwellScale.value = cur.wSwellScale;

    const tu = terrain.userData.u;
    tu.uCausticStrength.value = cur.caustic;
    tu.uCausticMaxDepth.value = cur.causticMax;
    _setv(tu.uCausticColor, cur.godC); _setv(tu.uUnderTint, cur.uwTint); _setv(tu.uTerrainGrade, cur.grade);
    _setv(tu.uAbyssColor, cur.abyssC);
    tu.uAbyssStart.value = cur.abyssStart; tu.uAbyssFull.value = cur.abyssFull;

    const nn = clamp01((tt - 0.35) / 0.65), nightness = nn * nn * (3 - 2 * nn);
    for (const id in flora.kinds) {
      const u = flora.kinds[id].material.userData.u;
      u.uNightMix.value = nightness; u.uGlowAmt.value = glowOn ? nightness : 0;
    }
    _setv(godrays.userData.u.uColor, cur.godC); godrays.userData.u.uOpacity.value = 0.055 * cur.godStr;
    _setv(motes.userData.u.uColor, cur.moteC);
    currents.userData.u.uOpacity.value = 0.26 * cur.current;
    bloom.strength = cur.bStr; bloom.radius = cur.bRad; bloom.threshold = cur.bThr;
  }

  function setLayerEnabled(name, on) {
    if (!(name in enabled)) return;
    enabled[name] = !!on;
    if (name === 'caustics') { terrain.userData.u.uCaustic.value = on ? 1 : 0; return; }
    if (name === 'abyss') { terrain.userData.u.uAbyss.value = on ? 1 : 0; return; }
    if (name === 'glow') {
      glowOn = !!on;
      const nn = clamp01((state.dayNight - 0.35) / 0.65), nightness = nn * nn * (3 - 2 * nn);
      for (const id in flora.kinds) flora.kinds[id].material.userData.u.uGlowAmt.value = glowOn ? nightness : 0;
      return;
    }
    if (layers[name]) layers[name].visible = !!on;
  }

  function setOverlay(el) { overlayEl = el; }

  function update(dt, camera, envScene) {
    state.time += dt;
    const T = state.time;

    const target = camera.position.y < WATER_Y ? 1 : 0;
    state.underwaterAmount += (target - state.underwaterAmount) * Math.min(1, (dt / DIVE_TIME) * 3);
    if (Math.abs(target - state.underwaterAmount) < 0.002) state.underwaterAmount = target;
    state.underwater = camera.position.y < WATER_Y;
    const uw = state.underwaterAmount;
    const camDepth = Math.max(0, WATER_Y - camera.position.y);
    state.cameraDepth = camDepth;

    water.userData.u.uTime.value = T;
    terrain.userData.u.uTime.value = T;
    terrain.userData.u.uUnderAmt.value = uw;
    godrays.userData.u.uTime.value = T;
    motes.userData.u.uTime.value = T;
    currents.userData.u.uTime.value = T;
    vents.userData.u.uTime.value = T;
    spindrift.userData.u.uTime.value = T;
    for (const id in flora.kinds) flora.kinds[id].material.userData.u.uTime.value = T;
    if (enabled.fish) fish.userData.update(T);

    // marine snow rides with the camera; its glow is the deep-plankton read —
    // dark water (by depth) and dark hour (by palette) both drive it
    motes.position.copy(camera.position);
    const deepness = clamp01((camDepth - cur.abyssStart * 0.5) / (cur.abyssFull - cur.abyssStart * 0.5));
    motes.userData.u.uGlow.value = Math.max(cur.biolum * 0.7, deepness * cur.deepBiolum);
    motes.visible = enabled.motes && uw > 0.01;
    // god rays live in the top of the water column only
    godrays.userData.u.uDepthGate.value = 1 - clamp01(camDepth / cur.godMax);
    godrays.visible = enabled.godrays && uw > 0.01 && camDepth < cur.godMax;
    godrays.position.set(camera.position.x, 0, camera.position.z);
    currents.visible = enabled.currents && uw > 0.01;
    vents.visible = enabled.vents;
    spindrift.visible = enabled.spindrift && uw < 0.5;

    const fogScene = envScene || scene;
    if (!fogScene) return;
    _fog.copy(cur.fogColor);
    _fogUw.copy(cur.uwFog);
    // underwater visibility shortens further with depth: the trench is murk
    const depthMul = 1 - 0.32 * clamp01(camDepth / cur.abyssFull);
    const uwFar = (1.0 / cur.uwDensity) * depthMul, uNear = uwFar * 0.03;
    const fogColor = _fogFinal.copy(_fog).lerp(_fogUw, uw);
    // ...and the fog colour itself sinks toward the abyss colour
    fogColor.lerp(cur.abyssC, uw * clamp01((camDepth - cur.abyssStart) / (cur.abyssFull - cur.abyssStart)) * 0.85);
    const fogNear = lerp(cur.fogNear, uNear, uw);
    const fogFar = lerp(cur.fogFar, uwFar, uw);
    if (!fogScene.fog) fogScene.fog = new THREE.Fog(fogColor.getHex(), fogNear, fogFar);
    fogScene.fog.color.copy(fogColor);
    fogScene.fog.near = fogNear;
    fogScene.fog.far = fogFar;

    _sky.copy(cur.sky);
    _bg.copy(_sky).lerp(fogColor, uw);
    if (!fogScene.background || !fogScene.background.isColor) fogScene.background = new THREE.Color();
    fogScene.background.copy(_bg);

    const wu = water.userData.u;
    wu.uFogColor.value.set(fogColor.r, fogColor.g, fogColor.b);
    wu.uFogNear.value = fogNear; wu.uFogFar.value = fogFar;
    for (const pu of [godrays.userData.u, motes.userData.u, currents.userData.u, vents.userData.u]) {
      pu.uFogNear.value = fogNear; pu.uFogFar.value = fogFar;
    }
    spindrift.userData.u.uFogNear.value = cur.fogNear;
    spindrift.userData.u.uFogFar.value = cur.fogFar;

    ambient.intensity = lerp(0, cur.uwAmbient, uw) * 0.5;

    if (overlayEl) {
      const tintA = cur.uwTintStr * uw;
      _grade.copy(cur.uwTint).lerp(cur.abyssC, clamp01((camDepth - cur.abyssStart) / (cur.abyssFull - cur.abyssStart)));
      overlayEl.style.background = `rgb(${(_grade.r * 255) | 0},${(_grade.g * 255) | 0},${(_grade.b * 255) | 0})`;
      overlayEl.style.opacity = Math.min(0.5, tintA + clamp01((camDepth - cur.abyssStart) / (cur.abyssFull - cur.abyssStart)) * 0.2).toFixed(3);
    }
  }

  let scene = null;
  function attach(s) { scene = s; s.add(group); }
  function detach(s) { s.remove(group); if (scene === s) scene = null; }

  // Mirrors the water vertexShader's swell() exactly (see buildWater above).
  // Any edit to one is an edit to both. Evaluated on LOCAL position.xz; the
  // water mesh carries no transform, so local == world — if that ever
  // changes, both this and the shader must change together.
  function swell(x, z, t, scale) {
    const a = Math.sin((x * 0.92 + z * 0.39) * scale + t * 0.55);
    const b = Math.sin((x * -0.35 + z * 0.94) * scale * 0.72 - t * 0.41);
    const c = Math.sin((x * 0.6 + z * -0.8) * scale * 2.6 + t * 1.15) * 0.28;
    return a * 0.62 + b * 0.5 + c;
  }
  function smoothstepJS(e0, e1, x) {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  }

  // Zone contract: absolute world Y of the water surface at (x,z) THIS
  // FRAME (core/zone.js's surfaceHeightAt). Accepted approximation, do not
  // "fix": the shader interpolates wl across ~4-unit triangles from a
  // per-vertex aDepth; this evaluates terrainHeight at the exact point
  // instead, so the two differ slightly on steep beaches — the JS answer is
  // the better one.
  function surfaceHeightAt(x, z) {
    const depth = WATER_Y - zone.terrainHeight(x, z);
    const wl = smoothstepJS(0, 3, depth);
    return WATER_Y + swell(x, z, state.time, cur.wSwellScale) * cur.wSwellAmp * wl;
  }

  // Companion slope, for boats/objects that should pitch/roll with the real
  // surface instead of a flat cosmetic bob — same finite difference (e =
  // 1.4) the shader uses for vNormalW.
  function surfaceNormalAt(x, z) {
    const depth = WATER_Y - zone.terrainHeight(x, z);
    const wl = smoothstepJS(0, 3, depth);
    const t = state.time, scale = cur.wSwellScale, amp = cur.wSwellAmp;
    const e = 1.4;
    const d0 = swell(x, z, t, scale), dx = swell(x + e, z, t, scale), dz = swell(x, z + e, t, scale);
    const nx = -(dx - d0) * amp * wl / e;
    const nz = -(dz - d0) * amp * wl / e;
    const len = Math.hypot(nx, 1, nz) || 1;
    return { x: nx / len, y: 1 / len, z: nz / len };
  }

  setDayNight(0);

  return {
    group, layers, state, bloom,
    attach, detach, setDayNight, setLayerEnabled, setOverlay, update,
    surfaceHeightAt, surfaceNormalAt,
    get underwater() { return state.underwater; },
    get underwaterAmount() { return state.underwaterAmount; },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
    },
  };
}
