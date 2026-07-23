// Grassland World — entry point: renderer/scene/camera, wires every module
// together, owns the `animated` update list and the render loop.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { terrainHeight } from './world.js';
import { BIOME } from './lighting.js';
import * as Lighting from './lighting.js';
import { createTerrainMesh, createWater } from './terrain-mesh.js';
import { initFx } from './fx.js';
import * as Audio from './audio.js';
import { initMinimap } from './minimap.js';
import { placeNativeProps, placeKenneyProps } from './props.js';
import { scatterWorld } from './scatter.js';
import { CHARACTER } from './character.js';
import { initController } from './controller.js';
import { boats } from './boats.js';
import * as Gallery from './gallery.js';
import { initEditor } from './editor.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const { sun } = Lighting.createLights(scene);
createTerrainMesh(scene, BIOME);
const { waterMat } = createWater(scene, BIOME);

const animated = [];
const { spawnRipple, spawnSplash } = initFx(scene, animated);
initMinimap(animated, BIOME, boats, () => controllerApi.char, () => controllerApi.getHeading(), Gallery.isGalleryOpen);

placeNativeProps(scene, animated);

// GLB drop-in (pipeline test): placeGLB('assets/tree_pine_01.glb', 0, -20) from the console.
window.placeGLB = async function (url, x, z, scale = 1) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const obj = gltf.scene;
  obj.scale.setScalar(scale);
  obj.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  console.log(`[placeGLB] ${url} — size ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} u`);
  obj.position.set(x, terrainHeight(x, z) - box.min.y, z);
  scene.add(obj);
  return obj;
};

placeKenneyProps(scene, animated); // fire-and-forget — awaits internally per placement

scatterWorld(scene, animated, BIOME);
animated.push((dt, t) => { if (waterMat.userData.shader) waterMat.userData.shader.uniforms.uTime.value = t; });

const gallery = Gallery.buildGallery(scene, animated);

function handleToggleGallery() {
  const open = Gallery.toggleGallery();
  coordsEl.style.display = open ? 'none' : '';
  scene.fog.far = open ? 5000 : BIOME.fogFar;
  scene.fog.near = open ? 3000 : BIOME.fogNear;
  hudText.innerHTML = open
    ? '<b>Asset gallery</b> — every factory in assets.js<br><b>G</b> back to the world'
    : WORLD_HUD;
}

const controllerApi = initController(scene, animated, {
  canvas: renderer.domElement,
  spawnRipple, spawnSplash,
  sfxSplash: Audio.sfxSplash, sfxStep: Audio.sfxStep, sfxJump: Audio.sfxJump, sfxBoard: Audio.sfxBoard,
  onToggleGallery: handleToggleGallery,
});
const { char, updateCharacter, updateCamera, frameGuards } = controllerApi;

// Area Designer — L toggles it; no panel yet (step 2 of the staged rollout),
// drive it from the console: (await import('./editor.js')).spawnFromCatalog(...)
initEditor({ scene, camera, domElement: renderer.domElement, animated, getChar: () => char });

window.__scene = scene; window.__gallery = gallery;
window.__toggleGallery = handleToggleGallery; // console/debug hook (G key requires trusted events)
window.__focus = name => { // frame one gallery model + return its material colors
  let hit = null; gallery.traverse(o => { if (o.userData && o.userData.name === name && o.children.length) hit = o; });
  if (!hit) return 'not found';
  const b = new THREE.Box3().setFromObject(hit), c = b.getCenter(new THREE.Vector3());
  window.__focusPos = { x: hit.position.x, y: c.y, z: hit.position.z };
  window.__focusR = Math.max(1.5, b.getSize(new THREE.Vector3()).length() * 1.1);
  const cols = []; hit.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m && m.color && cols.push('#' + m.color.getHexString())); });
  return { name, colors: cols };
};

const hudText = document.getElementById('hudText');
const WORLD_HUD = '<b>' + BIOME.name + ' — Arc 1+2</b> <small style="opacity:.55">v13</small><br>WASD move · Space jump/dive · hold right-click to look (all directions) · scroll zoom · Shift walk/run · swim in deep water · <b>E</b> board / interact · <b>G</b> gallery · <b>N</b> day/night · <b>C</b> character (' + CHARACTER + ') · <b>1-3</b> emote';
hudText.innerHTML = WORLD_HUD;
const coordsEl = document.getElementById('coords');

// ================= loop =================
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  frameGuards();
  for (const fn of animated) fn(dt, t);
  if (Gallery.isGalleryOpen()) {
    if (window.__focusPos) {
      const f = window.__focusPos, r = window.__focusR || 3.5;
      camera.position.set(f.x + Math.sin(t * 0.25) * r, f.y + r * 0.55, f.z - 400 + Math.cos(t * 0.25) * r);
      camera.lookAt(f.x, f.y, f.z - 400);
      sun.position.set(f.x + 8, 40, f.z - 400 + 8); sun.target.position.set(f.x, f.y, f.z - 400);
    } else {
      const a = t * 0.06;
      camera.position.set(Math.sin(a) * 58, 24, -400 + Math.cos(a) * 58);
      camera.lookAt(0, 1, -400);
      sun.position.set(30, 50, -370); sun.target.position.set(0, 0, -400);
    }
  } else if (window.__aerial) {
    scene.fog.far = 5000; scene.fog.near = 3000;
    camera.position.set(0, 175, 30);
    camera.lookAt(0, 0, -2);
    sun.position.set(40, 120, 30); sun.target.position.set(0, 0, 0);
  } else {
    updateCharacter(dt);
    updateCamera(dt, camera);
    coordsEl.textContent = `x ${char.position.x.toFixed(1)} · z ${char.position.z.toFixed(1)} · y ${char.position.y.toFixed(1)}`;
    sun.position.set(char.position.x + 35, 55, char.position.z + 20);
    sun.target.position.copy(char.position);
  }
  renderer.render(scene, camera);
});
