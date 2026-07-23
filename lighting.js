// Grassland World — day/night lighting table + BIOME resolution.
// One biome (grassland). Day/Night changes ONLY lighting & colors — the
// world content (flora mix, objects) is identical in both.
import * as THREE from 'three';

export const LIGHTING = {
  day: {
    name: 'Grassland', sky: 0x9ed2e8, fogNear: 70, fogFar: 250,
    hemiSky: 0xbfe3f2, hemiGround: 0x7a9455, hemiI: 0.9, sunColor: 0xfff2d8, sunI: 1.6,
    g1: 0x7cb356, g2: 0xa8c66c, grassAccent: 0xc4c96a, sand: 0xcdbb8a, bed: 0x3d6b5e,
    water: 0x4aa8b8, waterOpacity: 0.82, flowerGlow: 0, lantern: false,
  },
  night: {
    name: 'Grassland — Night', sky: 0x0f1226, fogNear: 32, fogFar: 175,
    hemiSky: 0x3a4076, hemiGround: 0x1b2a2e, hemiI: 0.62, sunColor: 0x9fb6ff, sunI: 0.95,
    g1: 0x33504f, g2: 0x466055, grassAccent: 0x66b0a2, sand: 0x474a63, bed: 0x0f2a34,
    water: 0x1f4a66, waterOpacity: 0.9, flowerGlow: 0.7, lantern: true,
  },
};
export const modeKey = new URLSearchParams(location.search).get('mode') === 'night' ? 'night' : 'day';
export const BIOME = LIGHTING[modeKey];

// Creates the hemi + sun lights, sets scene.background/fog. Returns `sun` so
// the render loop can keep repositioning it (it follows the character/gallery
// focus every frame — a main.js/loop concern, not a lighting-setup one).
export function createLights(scene) {
  scene.background = new THREE.Color(BIOME.sky);
  scene.fog = new THREE.Fog(BIOME.sky, BIOME.fogNear, BIOME.fogFar);

  scene.add(new THREE.HemisphereLight(BIOME.hemiSky, BIOME.hemiGround, BIOME.hemiI));
  const sun = new THREE.DirectionalLight(BIOME.sunColor, BIOME.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  return { sun };
}
