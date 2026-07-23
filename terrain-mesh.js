// Grassland World — terrain vertex-color bake mesh + water plane/material.
// Rendering only; all height/shape math comes from world.js.
import * as THREE from 'three';
import * as A from './assets.js';
import { terrainHeight, distPoly, PATH, WATER_Y, fall, clamp01 } from './world.js';

export function createTerrainMesh(scene, BIOME) {
  const geo = new THREE.PlaneGeometry(200, 200, 140, 140);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cA = new THREE.Color(BIOME.g1), cB = new THREE.Color(BIOME.g2);
  const dirt = new THREE.Color(A.C.brown), dirtD = new THREE.Color(A.C.brownDark);
  const sand = new THREE.Color(BIOME.sand), bed = new THREE.Color(BIOME.bed);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const n = Math.sin(x * 0.31 + z * 0.17) * 0.5 + Math.sin(x * 0.07 - z * 0.11) * 0.5;
    c.lerpColors(cA, cB, clamp01(0.5 + n * 0.45));
    if (h < WATER_Y + 0.7) c.lerp(sand, fall(h - WATER_Y, -0.2, 0.7));
    if (h < WATER_Y - 0.4) c.lerp(bed, clamp01((WATER_Y - 0.4 - h) / 2.5));
    if (h > WATER_Y + 0.2) {
      const dP = distPoly(x, z, PATH);
      if (dP < 3.8) { c.lerp(n > 0 ? dirt : dirtD, fall(dP, 2.0, 3.8) * 0.92); }
      const dH = Math.hypot(x + 9, z + 45);
      if (dH < 11) c.lerp(dirt, fall(dH, 4, 11) * 0.3);
    }
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  terrain.receiveShadow = true;
  scene.add(terrain);
  return terrain;
}

export function createWater(scene, BIOME) {
  const waterMat = new THREE.MeshStandardMaterial({
    color: BIOME.water, transparent: true, opacity: BIOME.waterOpacity, flatShading: false, roughness: 0.35, metalness: 0.05,
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
