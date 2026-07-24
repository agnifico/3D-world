// Grassland World — scattering: trees, rocks, bushes, mushrooms, flowers, grass.
import * as THREE from 'three';
import * as A from './assets.js';
import { terrainHeight, distPoly, PATH, WATER_Y } from './world.js';
import { BRIDGE } from './props.js';
import { addCircle } from './collision.js';

// Trunk radius, not canopy: scatterFootprints' r (below) is a canopy-sized
// spacing/avoidance proxy — colliding on it would block ~1.5-2 units of open
// air around every trunk. Real per-species trunk-base radii in assets.js
// range ~0.17s-0.5s; rather than plumbing per-species data through, this is
// a flat ratio against the real per-instance scale already in scope at
// placement time (not derived back out of the exported canopy r).
const TREE_TRUNK_RATIO = 0.35;
// Rocks/bushes are blob-shaped (icosahedron-based, no overhang) — their
// existing scatterFootprints radius is already a reasonable collision proxy.
const BUSH_COLLIDE_MIN_R = 0.8; // "large only" per the brief; bush r today ranges ~0.49-1.05

const TREE_MIX = [0.30, 0.28, 0.27, 0.08, 0.07]; // pine oak birch willow dead

const AVOID = [
  { x: -9, z: -45, r: 15 }, { x: -55, z: 60, r: 8 }, { x: 55, z: -55, r: 8 },
  { x: -60, z: -15, r: 7 }, { x: BRIDGE.x, z: BRIDGE.z, r: 9 },
];
function blockedBy(x, z, extra = 0) {
  for (const a of AVOID) if (Math.hypot(x - a.x, z - a.z) < a.r + extra) return true;
  return false;
}
function samplePoint(R, opts = {}) {
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
const mtx = (x, y, z, rotY, s, sy = s) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
    new THREE.Vector3(s, sy, s));

// --- trees: 2 seeded template variants per species, instanced ---
export const treePts = [];
// Every scatter placement with a rough footprint radius — groundwork for a
// future collision pass. Grass is excluded (decorative, no collision value).
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

  {
    const buckets = []; // per template: matrix list
    const templates = [];
    for (const f of A.TREE_FACTORIES) for (let v = 0; v < 2; v++) { templates.push(f(f.name.length * 7 + v * 13 + 3)); buckets.push([]); }
    const cum = []; let acc = 0;
    for (const w of TREE_MIX) { acc += w; cum.push(acc); }
    const speciesFor = (h) => {
      // willows hug the shore
      if (h < WATER_Y + 1.6 && R() < 0.55) return 6 + Math.round(R()); // willow templates
      const w = R() * acc;
      for (let sp = 0; sp < 5; sp++) if (w < cum[sp]) return sp * 2 + Math.round(R());
      return 8;
    };
    let placed = 0, guard = 0;
    while (placed < 115 && guard++ < 3000) {
      const p = samplePoint(R, { pathClear: 5, avoidExtra: 2 });
      if (!p) continue;
      let ok = true;
      for (const t of treePts) if (Math.hypot(p.x - t.x, p.z - t.z) < 4) { ok = false; break; }
      if (!ok) continue;
      const ti = speciesFor(p.h);
      const s = 0.8 + R() * 0.5;
      buckets[ti].push(mtx(p.x, p.h - 0.05, p.z, R() * Math.PI * 2, s, 0.8 + R() * 0.6));
      treePts.push(p);
      scatterFootprints.push({ kind: 'tree', x: p.x, z: p.z, r: s * 1.3 }); // canopy proxy — spacing/avoidance only, NOT the collider (see TREE_TRUNK_RATIO)
      addCircle(p.x, p.z, s * TREE_TRUNK_RATIO, Infinity); // trunk-sized, never jumpable
      placed++;
    }
    for (let i = 0; i < templates.length; i++)
      if (buckets[i].length) scene.add(A.makeInstanced(templates[i], buckets[i]));
  }

  // --- rocks: 3 variants ---
  for (let v = 0; v < 3; v++) {
    const ms = [];
    for (let i = 0; i < 55; i++) {
      const p = samplePoint(R, { minShore: -0.2, pathClear: 2.5 });
      if (p) {
        const s = 0.5 + R() * 1.2, sy = 0.5 + R() * 0.8;
        ms.push(mtx(p.x, p.h, p.z, R() * Math.PI * 2, s, sy));
        scatterFootprints.push({ kind: 'rock', x: p.x, z: p.z, r: s * 0.6 });
        addCircle(p.x, p.z, s * 0.6, p.h + sy * 0.93); // small/low rocks can be hopped — blockH from the same vertical scale as the visual mesh
      }
    }
    scene.add(A.makeInstanced(A.createRock(v), ms));
  }

  // --- bushes ---
  {
    const ms = [];
    for (let i = 0; i < 70; i++) {
      const p = samplePoint(R, { pathClear: 3.5, pathFade: 8 });
      if (p) {
        const s = 0.7 + R() * 0.8, r = s * 0.7;
        ms.push(mtx(p.x, p.h, p.z, R() * Math.PI * 2, s));
        scatterFootprints.push({ kind: 'bush', x: p.x, z: p.z, r });
        if (r > BUSH_COLLIDE_MIN_R) addCircle(p.x, p.z, r, p.h + s * 0.8); // "large only" per the brief
      }
    }
    scene.add(A.makeInstanced(A.createBush(5), ms));
  }

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
      // capture both random draws ONCE so day and night reuse the identical
      // blend/accent decision per instance — only the resolved colors differ,
      // positions/rotations/scales and every other scatter category's
      // randomness are completely unaffected (grass is the last R() consumer)
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
    // bypassing setColorAt (which lazily creates this) since colors come from
    // applyGrassBlend below, not a single static per-instance set
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
