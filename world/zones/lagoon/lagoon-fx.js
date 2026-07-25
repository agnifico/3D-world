// =============================================================================
// Lagoon zone — "The Shallows"  ·  visual systems
// -----------------------------------------------------------------------------
// All the three.js that brings zone.js to life: terrain mesh, depth-coloured
// water (rendered from above AND below), caustics, god rays, drifting motes,
// bubble streams, instanced procedural flora, and a controller that handles the
// day/night blend and the above/below-water dive transition.
//
// Adapted for the shared world shell (see README "Ownership to decide up
// front"): createLagoon no longer creates its own hemi/sun by default — pass
// `opts.hemi`/`opts.sun` (the shell's shared lights, from core/lighting.js)
// and it mutates those instead of owning private ones. Omit them (as
// preview.html does) and it falls back to its own local lights exactly as
// before, so the standalone harness needs no changes. Similarly `update`
// takes an optional 3rd `envScene` param — the REAL THREE.Scene to write
// fog/background onto — since the shell hands zones a private content GROUP
// (for clean disposal), not the real scene; preview.html's 2-arg call keeps
// using whatever `attach()` was given, unchanged.
//
// Everything is procedural — no textures, no image files, no GLB dependency.
// One draw call per flora kind (InstancedMesh).
// =============================================================================
import * as THREE from 'three';
// clamp01/lerp/mulberry32 — deduped into core/math.js (this file used to
// carry its own copy of all three; mulberry32 also matched grassland's
// verbatim, just written slightly differently — numerically identical since
// JS's bitwise operators ToInt32-coerce either way, verified before merging).
import { clamp01, lerp, mulberry32 } from '../../core/math.js';

// ── render-side tunables (see README) ────────────────────────────────────────
const TERRAIN_SIZE   = 224;   // terrain plane extent (a little past worldExtent)
const TERRAIN_SEG    = 256;   // terrain subdivisions
const WATER_SIZE     = 260;   // water plane extent (past the reef, into the fog)
const WATER_SEG      = 200;
const WAVE_AMP       = 0.12;  // vertical wave amplitude (calm lagoon)
const WAVE_SCALE     = 0.16;
const CAUSTIC_MAXDEPTH = 9.0; // caustics fade out by this depth
const GODRAY_COUNT   = 6;
const MOTE_COUNT     = 700;
const MOTE_BOX       = 34;    // motes fill a box of this half-extent around camera
const BUBBLE_STREAMS = 5;
const BUBBLE_PER     = 16;   // softer, sparser streams (they read as harsh white steam if dense)
const DIVE_TIME      = 0.3;   // seconds to blend across the surface

const C = (hex) => new THREE.Color(hex);
const V3 = (hex) => { const c = C(hex); return new THREE.Vector3(c.r, c.g, c.b); };
function mixColor(a, b, t, out) { return (out || new THREE.Color()).copy(a).lerp(b, t); }


// =============================================================================
//  GEOMETRY BUILDERS  (tiny, procedural, low-poly)
// =============================================================================

// Accumulator for hand-built low-poly geometry.
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

// A vertical tapered blade from y=0 up to y=height, facing angle `rot`.
function bladeInto(gb, x0, z0, width, height, segs, taper, rot, col) {
  const dx = Math.cos(rot), dz = Math.sin(rot);
  let pL = -1, pR = -1;
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const y = t * height;
    const w = width * (1 - (1 - taper) * t) * 0.5;
    const L = gb.v(x0 - dx * w, y, z0 - dz * w, col && col.r, col && col.g, col && col.b);
    const R = gb.v(x0 + dx * w, y, z0 + dz * w, col && col.r, col && col.g, col && col.b);
    if (s > 0) gb.quad(pL, pR, R, L);
    pL = L; pR = R;
  }
}

// A clump of several blades (seagrass / reeds).
function clumpGeometry(nBlades, width, height, spread, taper, seed) {
  const rng = mulberry32(seed);
  const gb = new GB();
  for (let i = 0; i < nBlades; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * spread;
    bladeInto(gb, Math.cos(a) * r, Math.sin(a) * r,
      width * (0.7 + rng() * 0.6), height * (0.7 + rng() * 0.6),
      4, taper, rng() * Math.PI, null);
  }
  return gb.geo();
}

// A single tall kelp blade (more segments -> smooth bend).
function kelpGeometry() {
  const gb = new GB();
  bladeInto(gb, 0, 0, 0.22, 1.0, 8, 0.35, 0, null);
  bladeInto(gb, 0, 0, 0.22, 1.0, 8, 0.35, Math.PI * 0.5, null); // cross blade for volume
  return gb.geo();
}

// Lumpy low-poly coral (displaced icosphere, stretched up a touch).
function coralGeometry() {
  const g = new THREE.IcosahedronGeometry(0.5, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len, ny = y / len, nz = z / len;
    // cheap 3d-ish lump from stacked sines
    const lump = 0.62
      + 0.26 * Math.sin(nx * 6.0 + nz * 3.0)
      + 0.18 * Math.sin(ny * 7.0 + nx * 4.0)
      + 0.12 * Math.sin(nz * 9.0 - ny * 5.0);
    const rr = 0.5 * Math.max(0.55, lump);
    p.setXYZ(i, nx * rr, (ny * rr) * 1.25 + 0.3, nz * rr); // lift & stretch upward
  }
  g.computeVertexNormals();
  return g;
}

// Tiny shell / scallop cap.
function shellGeometry() {
  return new THREE.SphereGeometry(0.5, 7, 3, 0, Math.PI * 2, 0, Math.PI * 0.5);
}

// Palm silhouette placeholder: leaning trunk + radial fronds (baked vertex colours).
function palmGeometry(trunkHex, frondHex) {
  const gb = new GB();
  const trunk = C(trunkHex), frond = C(frondHex);
  const H = 1.0, lean = 0.12;
  // trunk: 4-sided tapered prism
  const seg = 5, rB = 0.06, rT = 0.035;
  const ring = (y, r, cx) => {
    const idx = [];
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * Math.PI * 2 + Math.PI / 4;
      idx.push(gb.v(cx + Math.cos(a) * r, y, Math.sin(a) * r, trunk.r, trunk.g, trunk.b));
    }
    return idx;
  };
  let prev = ring(0, rB, 0);
  for (let s = 1; s <= seg; s++) {
    const t = s / seg, y = t * H, r = lerp(rB, rT, t), cx = lean * t * t;
    const cur = ring(y, r, cx);
    for (let k = 0; k < 4; k++) gb.quad(prev[k], cur[k], cur[(k + 1) % 4], prev[(k + 1) % 4]);
    prev = cur;
  }
  // canopy: fronds radiating from the top
  const topY = H, topX = lean;
  const nFr = 7;
  for (let f = 0; f < nFr; f++) {
    const a = f / nFr * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const len = 0.5, droop = 0.16, wid = 0.06;
    const bx = topX, bz = 0;
    const perpx = -dz, perpz = dx;
    const b0 = gb.v(bx - perpx * wid, topY, bz - perpz * wid, frond.r, frond.g, frond.b);
    const b1 = gb.v(bx + perpx * wid, topY, bz + perpz * wid, frond.r, frond.g, frond.b);
    const mx = bx + dx * len * 0.55, mz = bz + dz * len * 0.55, my = topY + 0.05;
    const m0 = gb.v(mx - perpx * wid * 0.7, my, mz - perpz * wid * 0.7, frond.r, frond.g, frond.b);
    const m1 = gb.v(mx + perpx * wid * 0.7, my, mz + perpz * wid * 0.7, frond.r, frond.g, frond.b);
    const tx = bx + dx * len, tz = bz + dz * len, ty = topY - droop;
    const tip = gb.v(tx, ty, tz, frond.r, frond.g, frond.b);
    gb.quad(b0, b1, m1, m0);
    gb.tri(m0, m1, tip);
  }
  return gb.geo();
}

function geometryFor(id, kind) {
  switch (id) {
    case 'kelp':     return kelpGeometry();
    case 'coral':    return coralGeometry();
    case 'seagrass': return clumpGeometry(6, 0.05, 1.0, 0.18, 0.15, 11);
    case 'reeds':    return clumpGeometry(5, 0.045, 1.0, 0.16, 0.1, 23);
    case 'shells':   return shellGeometry();
    case 'palm':     return palmGeometry(kind.trunk || '#b9a17a', kind.color);
    default:         return new THREE.BoxGeometry(0.3, 0.3, 0.3);
  }
}


// =============================================================================
//  MATERIAL INJECTORS
// =============================================================================

// Flora material: per-instance colour, height-scaled sway, night colour blend
// + bioluminescent glow. One shared material per kind.
function floraMaterial(kind, WATER_Y) {
  const useVertexColor = kind.id === 'palm'; // palm bakes trunk/frond colours; others use instanceColor
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: useVertexColor,
    roughness: 0.85, metalness: 0.0,
    side: THREE.DoubleSide,
    transparent: false,
  });
  const u = {
    uTime: { value: 0 },
    uSway: { value: kind.sway || 0 },
    uSwayScale: { value: kind.swayScale || 1 },
    uNightMix: { value: 0 },
    uNightTint: { value: V3(kind.colorNight || kind.color || '#204040') },
    uGlow: { value: V3(kind.colorNight || kind.color || '#000000') },
    uGlowAmt: { value: 0 },
    uGlowBase: { value: kind.glowNight || 0 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPhase;\nuniform float uTime,uSway,uSwayScale;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float _hy = max(transformed.y, 0.0);
        float _w = sin(uTime*uSwayScale + aPhase + transformed.y*0.4);
        float _w2 = cos(uTime*uSwayScale*0.8 + aPhase*1.3);
        transformed.x += _w * uSway * _hy * 0.16;
        transformed.z += _w2 * uSway * _hy * 0.12;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNightMix,uGlowAmt,uGlowBase;\nuniform vec3 uNightTint,uGlow;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, uNightTint, uNightMix);`)
      .replace('#include <colorspace_fragment>', `
        // bioluminescence: each instance glows its own colour (vColor) at night
        gl_FragColor.rgb += vColor * (uGlowBase * uGlowAmt * 2.6);
        #include <colorspace_fragment>`);
  };
  mat.customProgramCacheKey = () => 'lagoon-flora-' + kind.id;
  mat.userData.u = u;
  mat.userData.useVertexColor = useVertexColor;
  return mat;
}

// Terrain material: baked sand/rock/wet vertex colours, lit by the zone lights,
// plus in-shader caustics on the up-facing seabed and an underwater grade.
function terrainMaterial(day) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.0 });
  const u = {
    uTime: { value: 0 },
    uCaustic: { value: 1 },
    uCausticStrength: { value: day.underwater.causticStrength },
    uCausticColor: { value: V3(day.underwater.godrayColor) },
    uCausticMaxDepth: { value: CAUSTIC_MAXDEPTH },
    uWaterY: { value: 0 },
    uUnderTint: { value: V3(day.underwater.tint) },
    uUnderAmt: { value: 0 },
    uTerrainGrade: { value: new THREE.Vector3(1, 1, 1) }, // per-time-of-day colour grade over the baked (day) vertex colours
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
        uniform vec3 uCausticColor,uUnderTint,uTerrainGrade;
        float cLayer(vec2 p,float t){
          float v=sin(p.x+t)+sin(p.y-t*0.83)+sin((p.x+p.y)*0.7+t*0.6)+sin((p.x-p.y)*0.9-t*0.5);
          return pow(max(0.0,v*0.125+0.5),3.0);
        }`)
      .replace('#include <colorspace_fragment>', `
        float _below = step(vWPos.y, uWaterY);
        float _depth = max(uWaterY - vWPos.y, 0.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb*uUnderTint*1.7, _below*uUnderAmt*0.55);
        float _up = smoothstep(0.4,0.85,vWNorm.y);
        float _fade = clamp(1.0 - _depth/uCausticMaxDepth, 0.0, 1.0);
        float _c = cLayer(vWPos.xz*0.5, uTime*0.6)*0.6 + cLayer(vWPos.xz*0.9+13.0, -uTime*0.5)*0.5;
        gl_FragColor.rgb += uCausticColor * _c * uCausticStrength * uCaustic * _below * _up * _fade;
        gl_FragColor.rgb *= uTerrainGrade;   // time-of-day grade (sand / rock / mounds)
        #include <colorspace_fragment>`);
  };
  mat.customProgramCacheKey = () => 'lagoon-terrain';
  mat.userData.u = u;
  return mat;
}


// =============================================================================
//  WATER
// =============================================================================
function buildWater(zone, day, night) {
  const geo = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, WATER_SEG, WATER_SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const depthArr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    depthArr[i] = zone.WATER_Y - zone.terrainHeight(x, z);
  }
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depthArr, 1));

  const dayStops = day.water.depthStops, nightStops = night.water.depthStops;
  const u = {
    uTime: { value: 0 },
    uWaveAmp: { value: WAVE_AMP }, uWaveScale: { value: WAVE_SCALE },
    uDayC: { value: dayStops.map((s) => V3(s[1])) },
    uNightC: { value: nightStops.map((s) => V3(s[1])) },
    uDepthT: { value: dayStops.map((s) => s[0]) },
    uDayNight: { value: 0 },
    uOpacity: { value: day.water.opacity },
    uSurfaceTint: { value: V3(day.water.surfaceTint) },
    uSunColor: { value: V3(day.water.sunColor) },
    uSunDir: { value: new THREE.Vector3(...day.sun.direction).normalize() },
    uShimmer: { value: day.water.shimmer },
    uFoam: { value: V3(day.water.foam) },
    uFoamBand: { value: day.water.foamBand },
    uCeiling: { value: V3(day.water.ceiling) },
    uSunDisc: { value: V3(day.water.sunDisc) },
    uFogColor: { value: V3(day.fog.color) },
    uFogNear: { value: day.fog.near }, uFogFar: { value: day.fog.far },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime,uWaveAmp,uWaveScale;
      attribute float aDepth;
      varying float vDepth; varying vec3 vWorldPos; varying vec3 vNormalW; varying float vFogDepth;
      void main(){
        vDepth = aDepth;
        vec3 p = position;
        float wl = clamp(aDepth, 0.0, 1.0);
        float d0 = sin(p.x*uWaveScale + uTime*0.9)*cos(p.z*uWaveScale*0.8 + uTime*0.7)*0.6
                 + sin((p.x+p.z)*uWaveScale*1.7 - uTime*1.3)*0.4;
        float e = 0.6;
        float dx = sin((p.x+e)*uWaveScale + uTime*0.9)*cos(p.z*uWaveScale*0.8 + uTime*0.7)*0.6
                 + sin((p.x+e+p.z)*uWaveScale*1.7 - uTime*1.3)*0.4;
        float dz = sin(p.x*uWaveScale + uTime*0.9)*cos((p.z+e)*uWaveScale*0.8 + uTime*0.7)*0.6
                 + sin((p.x+p.z+e)*uWaveScale*1.7 - uTime*1.3)*0.4;
        p.y += d0 * uWaveAmp * wl;
        vNormalW = normalize(vec3(-(dx-d0)*uWaveAmp*wl/e, 1.0, -(dz-d0)*uWaveAmp*wl/e));
        vec4 wp = modelMatrix*vec4(p,1.0);
        vWorldPos = wp.xyz;
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `
      uniform vec3 uDayC[4]; uniform vec3 uNightC[4]; uniform float uDepthT[4];
      uniform float uDayNight,uOpacity,uShimmer,uFoamBand,uFogNear,uFogFar;
      uniform vec3 uSurfaceTint,uSunColor,uSunDir,uFoam,uCeiling,uSunDisc,uFogColor;
      varying float vDepth; varying vec3 vWorldPos; varying vec3 vNormalW; varying float vFogDepth;
      vec3 toSRGB(vec3 c){ vec3 lo=c*12.92; vec3 hi=1.055*pow(clamp(c,0.0,1.0),vec3(0.41666667))-0.055; return mix(lo,hi,step(vec3(0.0031308),c)); }
      vec3 stops(vec3 c0,vec3 c1,vec3 c2,vec3 c3,float d){
        vec3 c=c0;
        c=mix(c,c1,smoothstep(uDepthT[0],uDepthT[1],d));
        c=mix(c,c2,smoothstep(uDepthT[1],uDepthT[2],d));
        c=mix(c,c3,smoothstep(uDepthT[2],uDepthT[3],d));
        return c;
      }
      void main(){
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 N = normalize(vNormalW);
        vec3 S = normalize(uSunDir);
        float depth = max(vDepth,0.0);
        vec3 base = mix(
          stops(uDayC[0],uDayC[1],uDayC[2],uDayC[3],depth),
          stops(uNightC[0],uNightC[1],uNightC[2],uNightC[3],depth), uDayNight);
        vec3 col; float alpha;
        if(gl_FrontFacing){
          float fres = pow(1.0 - max(dot(N,V),0.0), 3.0);
          col = base + uSurfaceTint*fres*0.6;
          vec3 H = normalize(S+V);
          col += uSunColor*pow(max(dot(N,H),0.0),80.0)*uShimmer;
          float foam = smoothstep(uFoamBand,0.0,depth);
          col = mix(col, uFoam, foam*0.85);
          // turquoise reads strongly; only the very shallowest water reveals the floor
          alpha = mix(0.72, uOpacity, smoothstep(0.3,6.0,depth));
          alpha = max(alpha, foam*0.92);
        } else {
          float sun = pow(max(dot(normalize(-V),S),0.0),40.0);
          col = uCeiling + uSunDisc*sun*1.3;
          col += uSunColor*(0.5+0.5*sin(vWorldPos.x*0.6+vWorldPos.z*0.5))*0.03;
          alpha = 0.82;
        }
        col = mix(col, uFogColor, smoothstep(uFogNear,uFogFar,vFogDepth));
        gl_FragColor = vec4(toSRGB(col), alpha);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  mesh.userData.u = u;
  return mesh;
}


// =============================================================================
//  GOD RAYS
// =============================================================================
function buildGodrays(zone, day) {
  const group = new THREE.Group();
  const u = {
    uTime: { value: 0 },
    uColor: { value: V3(day.underwater.godrayColor) },
    uOpacity: { value: 0.06 * day.underwater.godrayStrength },
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
      uniform vec3 uColor; uniform float uOpacity,uTime,uFogNear,uFogFar;
      varying float vY; varying float vFog;
      vec3 toSRGB(vec3 c){ vec3 lo=c*12.92; vec3 hi=1.055*pow(clamp(c,0.0,1.0),vec3(0.41666667))-0.055; return mix(lo,hi,step(vec3(0.0031308),c)); }
      void main(){
        float vert = smoothstep(0.0,0.35,vY)*pow(vY,0.6);
        float flick = 0.72 + 0.28*sin(uTime*0.7 + vY*3.0);
        float fog = smoothstep(uFogNear,uFogFar,vFog);
        gl_FragColor = vec4(toSRGB(uColor), uOpacity*vert*flick*(1.0-fog));
      }`,
  });
  const rng = mulberry32(707);
  const geo = new THREE.CylinderGeometry(0.6, 7.0, 24, 14, 1, true);
  const tilt = new THREE.Vector3(...day.sun.direction).normalize();
  for (let i = 0; i < GODRAY_COUNT; i++) {
    const a = rng() * Math.PI * 2, r = 8 + rng() * 30;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.7 - 2;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, zone.WATER_Y - 11, z); // top pokes just above the surface
    m.rotation.z = (tilt.x) * 0.25 + (rng() - 0.5) * 0.1;
    m.rotation.x = (-tilt.z) * 0.25 + (rng() - 0.5) * 0.1;
    m.scale.setScalar(0.7 + rng() * 0.8);
    m.frustumCulled = false;
    group.add(m);
  }
  group.userData.u = u;
  return group;
}


// =============================================================================
//  PARTICLES — drifting motes + rising bubble streams
// =============================================================================
function buildMotes(day) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(MOTE_COUNT * 3), ph = new Float32Array(MOTE_COUNT);
  const rng = mulberry32(4242);
  for (let i = 0; i < MOTE_COUNT; i++) {
    p[i * 3] = (rng() * 2 - 1) * MOTE_BOX;
    p[i * 3 + 1] = (rng() * 2 - 1) * MOTE_BOX;
    p[i * 3 + 2] = (rng() * 2 - 1) * MOTE_BOX;
    ph[i] = rng() * 100;
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  const u = {
    uTime: { value: 0 }, uSize: { value: 2.2 },
    uColor: { value: V3(day.underwater.moteColor) }, uOpacity: { value: 0.5 },
    uFogNear: { value: 2 }, uFogFar: { value: 34 }, uGlow: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime,uSize; attribute float aPhase;
      varying float vFog;
      void main(){
        vec3 pp = position;
        pp.x += sin(uTime*0.2 + aPhase)*0.7;
        pp.y += sin(uTime*0.15 + aPhase*1.3)*0.5;
        pp.z += cos(uTime*0.18 + aPhase)*0.7;
        vec4 mv = modelViewMatrix*vec4(pp,1.0);
        vFog = -mv.z;
        gl_PointSize = uSize * (300.0 / max(-mv.z,1.0));
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity,uFogNear,uFogFar,uGlow;
      varying float vFog;
      vec3 toSRGB(vec3 c){ vec3 lo=c*12.92; vec3 hi=1.055*pow(clamp(c,0.0,1.0),vec3(0.41666667))-0.055; return mix(lo,hi,step(vec3(0.0031308),c)); }
      void main(){
        float d = length(gl_PointCoord-0.5);
        float a = smoothstep(0.5,0.0,d)*uOpacity*(1.0-smoothstep(uFogNear,uFogFar,vFog));
        gl_FragColor = vec4(toSRGB(uColor*(1.0+uGlow)), a);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  pts.userData.u = u;
  return pts;
}

function buildBubbles(zone) {
  // fixed seabed anchor points (shallow shelf + a couple deeper vents)
  const anchors = [
    [10, 6], [-16, -8], [24, -4], [-6, 18], [33, 12], [-30, 16],
  ];
  const N = BUBBLE_STREAMS * BUBBLE_PER;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const aPhase = new Float32Array(N), aSpeed = new Float32Array(N), aRise = new Float32Array(N), aWob = new Float32Array(N);
  const rng = mulberry32(1717);
  let k = 0;
  for (let s = 0; s < BUBBLE_STREAMS; s++) {
    const [ax, az] = anchors[s % anchors.length];
    const ay = zone.terrainHeight(ax, az) + 0.15;
    const rise = Math.min(zone.WATER_Y - ay, 6) + 0.5;
    for (let b = 0; b < BUBBLE_PER; b++) {
      pos[k * 3] = ax; pos[k * 3 + 1] = ay; pos[k * 3 + 2] = az;
      aPhase[k] = rng(); aSpeed[k] = 0.12 + rng() * 0.1;
      aRise[k] = rise; aWob[k] = 0.15 + rng() * 0.25;
      k++;
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
  g.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
  g.setAttribute('aRise', new THREE.BufferAttribute(aRise, 1));
  g.setAttribute('aWob', new THREE.BufferAttribute(aWob, 1));
  const u = {
    uTime: { value: 0 }, uSize: { value: 2.6 }, uOpacity: { value: 0.24 },
    uFogNear: { value: 2 }, uFogFar: { value: 34 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime,uSize;
      attribute float aPhase,aSpeed,aRise,aWob;
      varying float vFog; varying float vT;
      void main(){
        float tt = fract(uTime*aSpeed + aPhase);
        vT = tt;
        vec3 pp = position;
        pp.y += tt*aRise;
        pp.x += sin(tt*6.2831 + aPhase*10.0)*aWob;
        pp.z += cos(tt*6.2831*1.1 + aPhase*10.0)*aWob;
        vec4 mv = modelViewMatrix*vec4(pp,1.0);
        vFog = -mv.z;
        gl_PointSize = uSize*(0.6+tt) * (300.0/max(-mv.z,1.0));
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `
      uniform float uOpacity,uFogNear,uFogFar;
      varying float vFog; varying float vT;
      vec3 toSRGB(vec3 c){ vec3 lo=c*12.92; vec3 hi=1.055*pow(clamp(c,0.0,1.0),vec3(0.41666667))-0.055; return mix(lo,hi,step(vec3(0.0031308),c)); }
      void main(){
        vec2 c = gl_PointCoord-0.5; float d=length(c);
        // soft-edged blob (a hard bright rim reads as harsh steam when many overlap)
        float core = smoothstep(0.5,0.06,d);
        float a = core*uOpacity*(1.0-vT)*(1.0-smoothstep(uFogNear,uFogFar,vFog));
        gl_FragColor = vec4(toSRGB(vec3(0.70,0.83,0.90)), a);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  pts.userData.u = u;
  return pts;
}


// =============================================================================
//  FLORA (instanced)
// =============================================================================
function buildFlora(zone, day) {
  const group = new THREE.Group();
  const kinds = {};
  const recipe = zone.scatterRecipe;
  const rng = mulberry32(recipe.seed);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  for (const kind of recipe.kinds) {
    // placement
    const placed = [];
    let attempts = 0, maxAtt = kind.count * 10;
    while (placed.length < kind.count && attempts < maxAtt) {
      attempts++;
      const x = lerp(recipe.area.min, recipe.area.max, rng());
      const z = lerp(recipe.area.min, recipe.area.max, rng());
      const h = zone.terrainHeight(x, z);
      const depth = zone.WATER_Y - h;
      if (depth < kind.minDepth || depth > kind.maxDepth) continue;
      const n = zone.terrainNormal(x, z, 0.6);
      if (n[1] < kind.slopeMin) continue;
      placed.push({ x, y: h, z, rot: rng() * Math.PI * 2, r: rng(), n });
    }

    const geo = geometryFor(kind.id, kind);
    const mat = floraMaterial(kind, zone.WATER_Y);
    const count = Math.max(placed.length, 1);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const phases = new Float32Array(count);
    const useVC = mat.userData.useVertexColor;
    const palette = (kind.colors || [kind.color]).map(C);

    for (let i = 0; i < placed.length; i++) {
      const pl = placed[i];
      dummy.position.set(pl.x, pl.y, pl.z);
      dummy.rotation.set(0, pl.rot, 0);
      // shells & coral lie/settle onto the seabed slope a touch
      if (kind.id === 'shells') { dummy.rotation.x = (pl.r - 0.5) * 0.6; dummy.rotation.z = (pl.n[0]) * 0.8; }
      let sx, sy, sz;
      if (kind.height) {
        const hgt = lerp(kind.height[0], kind.height[1], pl.r);
        const wq = 0.8 + pl.r * 0.4;
        sx = wq; sz = wq; sy = hgt;
      } else {
        const sc = kind.scale ? lerp(kind.scale[0], kind.scale[1], pl.r) : 1;
        sx = sy = sz = sc;
      }
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      phases[i] = pl.r * 100;
      if (!useVC) {
        col.copy(palette[(pl.r * palette.length) | 0] || palette[0]);
        // small per-instance value jitter
        col.offsetHSL(0, 0, (pl.r - 0.5) * 0.08);
        mesh.setColorAt(i, col);
      }
    }
    // fill remaining (if under-placed) off-screen
    for (let i = placed.length; i < count; i++) {
      dummy.position.set(0, -9999, 0); dummy.scale.set(0.0001, 0.0001, 0.0001); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.frustumCulled = false;
    mesh.userData.kind = kind;
    group.add(mesh);
    kinds[kind.id] = mesh;
  }
  return { group, kinds };
}


// =============================================================================
//  TERRAIN
// =============================================================================
function buildTerrain(zone, day) {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
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
    const n = zone.terrainNormal(x, z, 0.7);
    tmp.copy(cSand);
    // wet band right around the waterline
    const wet = Math.max(0, 1 - Math.abs(depth - 0.3) / 1.4);
    tmp.lerp(cWet, wet * 0.7);
    // rock on steep faces (the Drop, sea-stack sides)
    const steep = clamp01((0.72 - n[1]) / 0.4);
    tmp.lerp(cRock, steep * 0.85);
    // cooler tint in the deeps
    tmp.lerp(cDeep, clamp01((depth - 5) / 10) * 0.5);
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
export function createLagoon(zone, opts = {}) {
  const day = zone.PALETTES.day, night = zone.PALETTES.night;
  const WATER_Y = zone.WATER_Y;
  const group = new THREE.Group();

  // Lights: use the shell's shared hemi/sun when given (opts.hemi/opts.sun —
  // the shell integration always passes these, mutating the same objects
  // Grassland's zone also drives, so they aren't reparented/removed on a
  // dispose). Falls back to owning local lights when not given, so
  // preview.html's fully-standalone use needs no changes.
  const ownLights = !opts.hemi || !opts.sun;
  const hemi = opts.hemi || new THREE.HemisphereLight(C(day.hemisphere.sky), C(day.hemisphere.ground), day.hemisphere.intensity);
  const sun = opts.sun || new THREE.DirectionalLight(C(day.sun.color), day.sun.intensity);
  const ambient = new THREE.AmbientLight(0xffffff, 0.0); // extra underwater fill — Lagoon-specific, always zone-owned
  if (ownLights) group.add(hemi, sun, sun.target);
  group.add(ambient);

  const terrain = buildTerrain(zone, day);
  const water = buildWater(zone, day, night);
  const godrays = buildGodrays(zone, day);
  const motes = buildMotes(day);
  const bubbles = buildBubbles(zone);
  const flora = buildFlora(zone, day);
  group.add(terrain, water, godrays, motes, bubbles, flora.group);

  const layers = {
    terrain, water, godrays, motes, bubbles,
    flora: flora.group,
    caustics: null, // handled via terrain uniform
  };
  const enabled = { terrain: true, water: true, caustics: true, godrays: true, motes: true, bubbles: true, flora: true, glow: true };
  let glowOn = true;

  const state = { dayNight: 0, underwater: false, underwaterAmount: 0, time: 0 };
  let overlayEl = null;

  // ── day cycle: interpolate ALL palette values across ordered keyframes ──────
  const cycle = ((zone.dayCycle && zone.dayCycle.length) ? zone.dayCycle
        : [{ t: 0, key: 'day' }, { t: 1, key: 'night' }])
      .map((s) => ({ t: s.t, pal: zone.PALETTES[s.key] }))
      .filter((s) => s.pal)
      .sort((a, b) => a.t - b.t);

  function res(p) {
    return {
      hemiSky: C(p.hemisphere.sky), hemiGround: C(p.hemisphere.ground), hemiInt: p.hemisphere.intensity,
      sunColor: C(p.sun.color), sunInt: p.sun.intensity, sunDir: new THREE.Vector3(...p.sun.direction).normalize(),
      wOpacity: p.water.opacity, wStops: p.water.depthStops.map((s) => C(s[1])),
      wSurface: C(p.water.surfaceTint), wSun: C(p.water.sunColor), wCeiling: C(p.water.ceiling),
      wSunDisc: C(p.water.sunDisc), wShimmer: p.water.shimmer,
      grade: C(p.terrainGrade || '#ffffff'),
      fogColor: C(p.fog.color), fogNear: p.fog.near, fogFar: p.fog.far, sky: C(p.sky),
      uwFog: C(p.underwater.fogColor), uwDensity: p.underwater.fogDensity, uwTint: C(p.underwater.tint),
      uwTintStr: p.underwater.tintStrength, uwAmbient: p.underwater.ambient,
      caustic: p.underwater.causticStrength, godC: C(p.underwater.godrayColor), godStr: p.underwater.godrayStrength,
      moteC: C(p.underwater.moteColor), biolum: p.underwater.bioluminescence,
      bStr: p.bloom.strength, bRad: p.bloom.radius, bThr: p.bloom.threshold,
    };
  }
  const RES = cycle.map((s) => ({ t: s.t, r: res(s.pal) }));
  const cur = res(cycle[0].pal); // persistent, mutated in place each tick

  const bloom = { strength: cur.bStr, radius: cur.bRad, threshold: cur.bThr };

  // scratch colours for env compositing (in update)
  const _fog = new THREE.Color(), _fogUw = new THREE.Color(), _fogFinal = new THREE.Color();
  const _sky = new THREE.Color(), _bg = new THREE.Color(), _bgColor = new THREE.Color(), _grade = new THREE.Color();
  const _setv = (u, c) => u.value.set(c.r, c.g, c.b);

  function setDayNight(tt) {
    tt = clamp01(tt); state.dayNight = tt;
    let a = RES[0], b = RES[RES.length - 1];
    for (let i = 0; i < RES.length - 1; i++) {
      if (tt >= RES[i].t && tt <= RES[i + 1].t) { a = RES[i]; b = RES[i + 1]; break; }
    }
    const A = a.r, B = b.r, f = clamp01((tt - a.t) / ((b.t - a.t) || 1));

    cur.hemiSky.copy(A.hemiSky).lerp(B.hemiSky, f);
    cur.hemiGround.copy(A.hemiGround).lerp(B.hemiGround, f);
    cur.hemiInt = lerp(A.hemiInt, B.hemiInt, f);
    cur.sunColor.copy(A.sunColor).lerp(B.sunColor, f);
    cur.sunInt = lerp(A.sunInt, B.sunInt, f);
    cur.sunDir.copy(A.sunDir).lerp(B.sunDir, f).normalize();
    cur.wOpacity = lerp(A.wOpacity, B.wOpacity, f);
    for (let i = 0; i < cur.wStops.length; i++) cur.wStops[i].copy(A.wStops[i]).lerp(B.wStops[i], f);
    cur.wSurface.copy(A.wSurface).lerp(B.wSurface, f);
    cur.wSun.copy(A.wSun).lerp(B.wSun, f);
    cur.wCeiling.copy(A.wCeiling).lerp(B.wCeiling, f);
    cur.wSunDisc.copy(A.wSunDisc).lerp(B.wSunDisc, f);
    cur.wShimmer = lerp(A.wShimmer, B.wShimmer, f);
    cur.grade.copy(A.grade).lerp(B.grade, f);
    cur.fogColor.copy(A.fogColor).lerp(B.fogColor, f);
    cur.fogNear = lerp(A.fogNear, B.fogNear, f);
    cur.fogFar = lerp(A.fogFar, B.fogFar, f);
    cur.sky.copy(A.sky).lerp(B.sky, f);
    cur.uwFog.copy(A.uwFog).lerp(B.uwFog, f);
    cur.uwDensity = lerp(A.uwDensity, B.uwDensity, f);
    cur.uwTint.copy(A.uwTint).lerp(B.uwTint, f);
    cur.uwTintStr = lerp(A.uwTintStr, B.uwTintStr, f);
    cur.uwAmbient = lerp(A.uwAmbient, B.uwAmbient, f);
    cur.caustic = lerp(A.caustic, B.caustic, f);
    cur.godC.copy(A.godC).lerp(B.godC, f);
    cur.godStr = lerp(A.godStr, B.godStr, f);
    cur.moteC.copy(A.moteC).lerp(B.moteC, f);
    cur.biolum = lerp(A.biolum, B.biolum, f);
    cur.bStr = lerp(A.bStr, B.bStr, f);
    cur.bRad = lerp(A.bRad, B.bRad, f);
    cur.bThr = lerp(A.bThr, B.bThr, f);

    // apply -----------------------------------------------------------------
    hemi.color.copy(cur.hemiSky); hemi.groundColor.copy(cur.hemiGround); hemi.intensity = cur.hemiInt;
    sun.color.copy(cur.sunColor); sun.intensity = cur.sunInt;
    sun.position.copy(cur.sunDir).multiplyScalar(120); sun.target.position.set(0, 0, 0);

    const wu = water.userData.u;
    wu.uDayNight.value = 0;
    for (let i = 0; i < cur.wStops.length; i++) { const s = cur.wStops[i]; wu.uDayC.value[i].set(s.r, s.g, s.b); }
    wu.uOpacity.value = cur.wOpacity;
    _setv(wu.uSurfaceTint, cur.wSurface); _setv(wu.uSunColor, cur.wSun);
    _setv(wu.uCeiling, cur.wCeiling); _setv(wu.uSunDisc, cur.wSunDisc);
    wu.uSunDir.value.copy(cur.sunDir); wu.uShimmer.value = cur.wShimmer;

    const tu = terrain.userData.u;
    tu.uCausticStrength.value = cur.caustic;
    _setv(tu.uCausticColor, cur.godC); _setv(tu.uUnderTint, cur.uwTint); _setv(tu.uTerrainGrade, cur.grade);

    // flora shifts to night colour + glow only from dusk onward (afternoon stays bright)
    const nn = clamp01((tt - 0.35) / 0.65), nightness = nn * nn * (3 - 2 * nn);
    for (const id in flora.kinds) {
      const u = flora.kinds[id].material.userData.u;
      u.uNightMix.value = nightness; u.uGlowAmt.value = glowOn ? nightness : 0;
    }

    _setv(godrays.userData.u.uColor, cur.godC); godrays.userData.u.uOpacity.value = 0.06 * cur.godStr;
    _setv(motes.userData.u.uColor, cur.moteC); motes.userData.u.uGlow.value = cur.biolum * 0.8;

    bloom.strength = cur.bStr; bloom.radius = cur.bRad; bloom.threshold = cur.bThr;
  }

  function setLayerEnabled(name, on) {
    if (!(name in enabled)) return;
    enabled[name] = !!on;
    if (name === 'caustics') { terrain.userData.u.uCaustic.value = on ? 1 : 0; return; }
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

    // dive transition
    const target = camera.position.y < WATER_Y ? 1 : 0;
    const step = dt / DIVE_TIME;
    state.underwaterAmount += (target - state.underwaterAmount) * Math.min(1, step * 3);
    if (Math.abs(target - state.underwaterAmount) < 0.002) state.underwaterAmount = target;
    state.underwater = camera.position.y < WATER_Y;
    const uw = state.underwaterAmount;

    // time uniforms
    const T = state.time;
    water.userData.u.uTime.value = T;
    terrain.userData.u.uTime.value = T;
    terrain.userData.u.uUnderAmt.value = uw;
    godrays.userData.u.uTime.value = T;
    motes.userData.u.uTime.value = T;
    bubbles.userData.u.uTime.value = T;
    for (const id in flora.kinds) flora.kinds[id].material.userData.u.uTime.value = T;

    // motes follow the camera (they surround the viewer), only meaningful underwater
    motes.position.copy(camera.position);
    motes.visible = enabled.motes && uw > 0.01;
    godrays.visible = enabled.godrays && uw > 0.01;
    bubbles.visible = enabled.bubbles; // visible from above too (streams to surface)

    // ── environment: fog + background from the blended palette + dive amount ──
    // This is Lagoon-specific composite state (day/night blend AND the
    // per-frame dive amount together) that no generic shared blend engine
    // could compute — so, per the brief's "let the zone drive them" option,
    // Lagoon writes scene.fog/background itself every frame it's active,
    // onto `envScene` (the REAL THREE.Scene the shell passes) rather than
    // `attach()`'s content-group target. preview.html omits envScene and
    // falls back to whatever attach() was given (its own real scene there).
    const fogScene = envScene || scene;
    _fog.copy(cur.fogColor);
    const aNear = cur.fogNear, aFar = cur.fogFar;
    _fogUw.copy(cur.uwFog);
    const uwFar = 1.0 / cur.uwDensity, uNear = uwFar * 0.03, uFar = uwFar;

    const fogColor = _fogFinal.copy(_fog).lerp(_fogUw, uw);
    const fogNear = lerp(aNear, uNear, uw);
    const fogFar = lerp(aFar, uFar, uw);
    if (!fogScene) return;
    if (!fogScene.fog) fogScene.fog = new THREE.Fog(fogColor.getHex(), fogNear, fogFar);
    fogScene.fog.color.copy(fogColor);
    fogScene.fog.near = fogNear;
    fogScene.fog.far = fogFar;

    _sky.copy(cur.sky);
    _bg.copy(_sky).lerp(_fogUw, uw);
    if (!fogScene.background || !fogScene.background.isColor) fogScene.background = new THREE.Color();
    fogScene.background.copy(_bg);

    const wu = water.userData.u;
    wu.uFogColor.value.set(fogColor.r, fogColor.g, fogColor.b); wu.uFogNear.value = fogNear; wu.uFogFar.value = fogFar;
    for (const pu of [godrays.userData.u, motes.userData.u, bubbles.userData.u]) {
      pu.uFogNear.value = fogNear; pu.uFogFar.value = fogFar;
    }

    ambient.intensity = lerp(0, cur.uwAmbient, uw) * 0.5;

    if (overlayEl) {
      const tintA = cur.uwTintStr * uw;
      _grade.copy(cur.uwTint);
      overlayEl.style.background = `rgb(${(_grade.r * 255) | 0},${(_grade.g * 255) | 0},${(_grade.b * 255) | 0})`;
      overlayEl.style.opacity = tintA.toFixed(3);
    }
  }

  // scene binding — `s` here is whatever the caller wants `group` parented
  // into (the shell's private per-zone content group, or preview.html's own
  // real scene); update()'s optional envScene param is the separate "where
  // do fog/background actually go" target for the shell-integrated case.
  let scene = null;
  function attach(s) { scene = s; s.add(group); }
  function detach(s) { s.remove(group); if (scene === s) scene = null; }

  setDayNight(0);

  return {
    group, layers, state, bloom,
    attach, detach, setDayNight, setLayerEnabled, setOverlay, update,
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
