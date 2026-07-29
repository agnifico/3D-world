// Grassland zone — scattering: mushrooms, flowers, grass (procedural).
// Trees/rocks/bushes are catalogue-driven real models — see
// catalogue-flora.js — but share this module's samplePoint/AVOID/mtx
// placement primitives and treePts/scatterFootprints bookkeeping.
import * as THREE from 'three';
import * as A from './assets.js';
import { terrainHeight, distPoly, PATH, WATER_Y } from './world.js';
import { BRIDGE } from './props.js';

const AVOID = [
  { x: -9, z: -45, r: 15 }, { x: -55, z: 60, r: 8 }, { x: 55, z: -55, r: 8 },
  { x: -60, z: -15, r: 7 }, { x: BRIDGE.x, z: BRIDGE.z, r: 9 },
];
export function blockedBy(x, z, extra = 0) {
  for (const a of AVOID) if (Math.hypot(x - a.x, z - a.z) < a.r + extra) return true;
  return false;
}
export function samplePoint(R, opts = {}) {
  for (let tries = 0; tries < 40; tries++) {
    const x = (R() - 0.5) * 188, z = (R() - 0.5) * 188;
    const h = terrainHeight(x, z);
    if (h < WATER_Y + (opts.minShore ?? 0.45)) continue;
    if (opts.maxShore !== undefined && h > WATER_Y + opts.maxShore) continue;
    const dP = distPoly(x, z, PATH);
    if (dP < (opts.pathClear ?? 3)) continue;
    if (opts.pathFade && dP < opts.pathFade && R() < 1 - (dP - (opts.pathClear ?? 3)) / (opts.pathFade - (opts.pathClear ?? 3))) continue;
    if (blockedBy(x, z, opts.avoidExtra ?? 0)) continue;
    return { x, z, h };
  }
  return null;
}
// world-editor: rotation engine fix — `rot` is either a plain number (the
// original convention: a Y-only heading, radians) or a full Euler [x,y,z]
// (radians) for objects that aren't upright by design (e.g. a placed prop
// tilted via the World Editor's rotate gizmo). Backward-compatible: every
// existing call site in this file still passes a plain number and gets
// byte-identical output.
function rotQuat(rot) {
  return Array.isArray(rot)
    ? new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]))
    : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
}
export const mtx = (x, y, z, rotY, s, sy = s) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    rotQuat(rotY),
    new THREE.Vector3(s, sy, s));

// --- trees: 2 seeded template variants per species, instanced ---
export const treePts = [];
export const scatterFootprints = [];

// Returns { applyGrassBlend(t) } — grass has genuine per-instance colors that
// vary with the palette (g1/g2/grass.accent), so it needs the same
// bake-two-arrays-and-lerp treatment as the terrain. Flowers don't: their
// per-instance jitter is on a fixed palette (assets.js's FLOWER_COLORS, not
// day/night-dependent) — only the head material's emissiveIntensity
// (flowerGlow) is palette-reactive, and that's a single material property
// the caller can lerp directly (see the returned `flowerMat`).
export function scatterWorld(scene, animated, PALETTES) {
  const R = A.rng(1234);

  // Mushrooms cluster around treePts, which catalogue-flora.js's synchronous
  // placement pass fills BEFORE this runs (zone.js calls it first) — trees
  // themselves are loaded/instanced asynchronously after, but their (x,z,h)
  // positions are already known here.

  // --- mushrooms (cluster near trees) ---
  {
    const ms = [];
    for (let i = 0; i < 90; i++) {
      const t = treePts[Math.floor(R() * treePts.length)];
      if (!t) break;
      const x = t.x + (R() - 0.5) * 4, z = t.z + (R() - 0.5) * 4;
      const h = terrainHeight(x, z);
      if (h < WATER_Y + 0.4) continue;
      ms.push(mtx(x, h, z, R() * Math.PI * 2, 0.7 + R() * 1.1));
      scatterFootprints.push({ kind: 'mushroom', x, z, r: 0.3 });
    }
    scene.add(A.makeInstanced(A.createMushroom(), ms, { shadow: false }));
  }

  // --- flowers: clumps, instanced stems + colored heads ---
  let flowerMat;
  {
    const stems = [], heads = [], headColors = [];
    for (let cnum = 0; cnum < 65; cnum++) {
      const cpt = samplePoint(R, { pathClear: 3, pathFade: 6, avoidExtra: -6 });
      if (!cpt) continue;
      const col = new THREE.Color(A.FLOWER_COLORS[Math.floor(R() * A.FLOWER_COLORS.length)]);
      const n = 5 + Math.floor(R() * 5);
      let any = false;
      for (let i = 0; i < n; i++) {
        const x = cpt.x + (R() - 0.5) * 3.2, z = cpt.z + (R() - 0.5) * 3.2;
        const h = terrainHeight(x, z);
        if (h < WATER_Y + 0.4 || distPoly(x, z, PATH) < 2.2) continue;
        const M = mtx(x, h, z, R() * Math.PI * 2, 0.8 + R() * 0.5);
        stems.push(M); heads.push(M);
        headColors.push(col.clone().offsetHSL((R() - 0.5) * 0.03, 0, (R() - 0.5) * 0.08));
        any = true;
      }
      if (any) scatterFootprints.push({ kind: 'flower-clump', x: cpt.x, z: cpt.z, r: 1.6 });
    }
    const stemGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.36, 4); stemGeo.translate(0, 0.18, 0);
    const headGeo = new THREE.IcosahedronGeometry(0.09, 0); headGeo.translate(0, 0.4, 0);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x6a9a4e, flatShading: true, roughness: 1 });
    const headMat = flowerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.8, emissive: 0xfff2d8, emissiveIntensity: PALETTES.day.flowerGlow * 0.5 });
    A.addWind(stemMat, 0.05); A.addWind(headMat, 0.05);
    const stemIM = new THREE.InstancedMesh(stemGeo, stemMat, stems.length);
    const headIM = new THREE.InstancedMesh(headGeo, headMat, heads.length);
    for (let i = 0; i < stems.length; i++) {
      stemIM.setMatrixAt(i, stems[i]);
      headIM.setMatrixAt(i, heads[i]);
      headIM.setColorAt(i, headColors[i]);
    }
    headIM.instanceColor.needsUpdate = true;
    stemIM.receiveShadow = headIM.receiveShadow = true;
    scene.add(stemIM, headIM);
    animated.push((dt, t) => {
      for (const mm of [stemMat, headMat]) if (mm.userData.shader) mm.userData.shader.uniforms.uTime.value = t;
    });
  }

  // --- grass: thousands, one InstancedMesh, wind in vertex shader ---
  let applyGrassBlend = () => {};
  {
    const grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1, side: THREE.DoubleSide });
    A.addWind(grassMat, 0.11);
    const N = 5500;
    const geo = A.grassTuftGeometry();
    const im = new THREE.InstancedMesh(geo, grassMat, N);
    const dayA = new THREE.Color(PALETTES.day.terrain.g1), dayB = new THREE.Color(PALETTES.day.terrain.g2), dayAccent = new THREE.Color(PALETTES.day.grass.accent);
    const nightA = new THREE.Color(PALETTES.night.terrain.g1), nightB = new THREE.Color(PALETTES.night.terrain.g2), nightAccent = new THREE.Color(PALETTES.night.grass.accent);
    const dayCol = new Float32Array(N * 3), nightCol = new Float32Array(N * 3);
    const tmp = new THREE.Color();
    let i = 0, guard = 0;
    while (i < N && guard++ < N * 12) {
      const p = samplePoint(R, { pathClear: 1.6, pathFade: 5, minShore: 0.25, avoidExtra: -10 });
      if (!p) continue;
      if (Math.hypot(p.x + 9, p.z + 45) < 8 && R() < 0.75) continue; // thin inside hamlet
      im.setMatrixAt(i, mtx(p.x, p.h - 0.02, p.z, R() * Math.PI * 2, 0.75 + R() * 0.7, 0.7 + R() * 0.9));
      const blendFrac = R(), accentRoll = R();
      tmp.lerpColors(dayA, dayB, blendFrac); if (accentRoll < 0.15) tmp.lerp(dayAccent, 0.5);
      dayCol[i * 3] = tmp.r; dayCol[i * 3 + 1] = tmp.g; dayCol[i * 3 + 2] = tmp.b;
      tmp.lerpColors(nightA, nightB, blendFrac); if (accentRoll < 0.15) tmp.lerp(nightAccent, 0.5);
      nightCol[i * 3] = tmp.r; nightCol[i * 3 + 1] = tmp.g; nightCol[i * 3 + 2] = tmp.b;
      i++;
    }
    im.count = i;
    im.receiveShadow = true;
    scene.add(im);
    animated.push((dt, t) => { if (grassMat.userData.shader) grassMat.userData.shader.uniforms.uTime.value = t; });
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    const liveCol = im.instanceColor;
    const n3 = i * 3;
    applyGrassBlend = t => {
      const arr = liveCol.array;
      for (let k = 0; k < n3; k++) arr[k] = dayCol[k] + (nightCol[k] - dayCol[k]) * t;
      liveCol.needsUpdate = true;
    };
    applyGrassBlend(0);
  }
  return { applyGrassBlend, flowerMat };
}

// Reset the module-level scatter arrays — called at the start of build() so
// a rebuild doesn't accumulate stale entries from the previous build.
export function resetScatter() {
  treePts.length = 0;
  scatterFootprints.length = 0;
}
