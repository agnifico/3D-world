// Grassland World — terrain vertex-color bake mesh + water plane/material.
// Rendering only; all height/shape math comes from world.js.
import * as THREE from 'three';
import * as A from './assets.js';
import { terrainHeight, distPoly, PATH, WATER_Y, fall, clamp01 } from './world.js';

// Bakes height + BOTH day and night vertex colors in one pass over the
// geometry (height/noise math computed once per vertex, same cost as
// before); applyBlend(t) then just lerps the two pre-baked color arrays into
// the live attribute — no per-frame trig/height recompute.
// scratch Colors for the bake, one set per palette, allocated once (this is
// a startup-only cost either way, but no reason not to do it properly)
function paletteScratch(palette) {
  return {
    cA: new THREE.Color(palette.terrain.g1), cB: new THREE.Color(palette.terrain.g2),
    sand: new THREE.Color(palette.terrain.sand), bed: new THREE.Color(palette.terrain.bed),
    c: new THREE.Color(),
  };
}
const _dirt = new THREE.Color(A.C.brown), _dirtD = new THREE.Color(A.C.brownDark);
function bakeColorsInto(out, i, x, z, h, n, s) {
  const c = s.c;
  c.lerpColors(s.cA, s.cB, clamp01(0.5 + n * 0.45));
  if (h < WATER_Y + 0.7) c.lerp(s.sand, fall(h - WATER_Y, -0.2, 0.7));
  if (h < WATER_Y - 0.4) c.lerp(s.bed, clamp01((WATER_Y - 0.4 - h) / 2.5));
  if (h > WATER_Y + 0.2) {
    const dP = distPoly(x, z, PATH);
    if (dP < 3.8) { c.lerp(n > 0 ? _dirt : _dirtD, fall(dP, 2.0, 3.8) * 0.92); }
    const dH = Math.hypot(x + 9, z + 45);
    if (dH < 11) c.lerp(_dirt, fall(dH, 4, 11) * 0.3);
  }
  out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b;
}

export function createTerrainMesh(scene, PALETTES) {
  const geo = new THREE.PlaneGeometry(200, 200, 140, 140);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const dayColors = new Float32Array(pos.count * 3);
  const nightColors = new Float32Array(pos.count * 3);
  const liveColors = new Float32Array(pos.count * 3);
  const dayScratch = paletteScratch(PALETTES.day), nightScratch = paletteScratch(PALETTES.night);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const n = Math.sin(x * 0.31 + z * 0.17) * 0.5 + Math.sin(x * 0.07 - z * 0.11) * 0.5;
    bakeColorsInto(dayColors, i, x, z, h, n, dayScratch);
    bakeColorsInto(nightColors, i, x, z, h, n, nightScratch);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(liveColors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  const colorAttr = geo.attributes.color;
  function applyBlend(t) {
    for (let i = 0; i < liveColors.length; i++) liveColors[i] = dayColors[i] + (nightColors[i] - dayColors[i]) * t;
    colorAttr.needsUpdate = true;
  }
  applyBlend(0);
  return { terrain, applyBlend };
}

export function createWater(scene, PALETTES) {
  const waterMat = new THREE.MeshStandardMaterial({
    color: PALETTES.day.water.color, transparent: true, opacity: PALETTES.day.water.opacity, flatShading: false, roughness: 0.35, metalness: 0.05,
  });
  waterMat.onBeforeCompile = shader => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       transformed.y += (sin(position.x*0.55+uTime*1.3) + sin(position.z*0.62+uTime*1.7)*0.7 + sin((position.x+position.z)*0.3+uTime*0.9)*0.5) * 0.045;`
    );
    waterMat.userData.shader = shader;
  };
  const geo = new THREE.PlaneGeometry(200, 200, 200, 200);
  geo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(geo, waterMat);
  water.position.y = WATER_Y;
  water.receiveShadow = true;
  scene.add(water);
  return { water, waterMat };
}
