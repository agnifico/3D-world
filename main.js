// Grassland World — entry point: renderer/scene/camera, wires every module
// together, owns the `animated` update list and the render loop.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { terrainHeight } from './world.js';
import * as Lighting from './lighting.js';
import { PALETTES } from './lighting.js';
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
import { initEditorPanel } from './editor-panel.js';

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

// Light objects + dual-baked (day/night) content are all built before
// Lighting.initLightingBlend runs, since it needs every one of their blend
// functions/materials up front — see lighting.js's applyLighting(t).
const { hemi, sun } = Lighting.initLighting(scene);
const { applyBlend: applyTerrainBlend } = createTerrainMesh(scene, PALETTES);
const { waterMat } = createWater(scene, PALETTES);

const animated = [];
const { spawnRipple, spawnSplash } = initFx(scene, animated);
initMinimap(animated, PALETTES, boats, () => controllerApi.char, () => controllerApi.getHeading(), Gallery.isGalleryOpen);

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

const { applyGrassBlend, flowerMat } = scatterWorld(scene, animated, PALETTES);
animated.push((dt, t) => { if (waterMat.userData.shader) waterMat.userData.shader.uniforms.uTime.value = t; });

const gallery = Gallery.buildGallery(scene, animated);

function handleToggleGallery() {
  const open = Gallery.toggleGallery();
  coordsEl.style.display = open ? 'none' : '';
  if (open) { scene.fog.far = 5000; scene.fog.near = 3000; }
  else Lighting.applyLighting(Lighting.getT()); // restores fog (and everything else, harmlessly) to the current blend
  hudText.innerHTML = open
    ? '<b>Asset gallery</b> — every factory in assets.js<br><b>G</b> back to the world'
    : WORLD_HUD;
}

// character hot-swap (C key) — a small loading hint + keeping the HUD's
// character name current across swaps
const charHint = document.createElement('div');
charHint.style.cssText = 'position:fixed; left:50%; top:14px; transform:translateX(-50%); z-index:3; display:none; font:600 13px ui-sans-serif, system-ui, sans-serif; color:#4a3826; background:rgba(250,248,240,.88); border:1px solid rgba(107,79,53,.3); border-radius:8px; padding:5px 12px;';
charHint.textContent = 'Loading character…';
document.body.appendChild(charHint);
function handleSwapStateChange(loading) { charHint.style.display = loading ? '' : 'none'; }
function handleCharacterChanged(name) {
  WORLD_HUD = buildWorldHud(name);
  if (!Gallery.isGalleryOpen()) hudText.innerHTML = WORLD_HUD;
}

const controllerApi = initController(scene, animated, {
  canvas: renderer.domElement,
  spawnRipple, spawnSplash,
  sfxSplash: Audio.sfxSplash, sfxStep: Audio.sfxStep, sfxJump: Audio.sfxJump, sfxBoard: Audio.sfxBoard,
  onToggleGallery: handleToggleGallery,
  onSwapStateChange: handleSwapStateChange,
  onCharacterChanged: handleCharacterChanged,
});
const { char, updateCharacter, updateCamera, frameGuards } = controllerApi;

const lantern = Lighting.createLantern(char);
Lighting.initLightingBlend({
  scene, hemi, sun, waterMat,
  terrain: { applyBlend: applyTerrainBlend },
  grass: { applyBlend: applyGrassBlend },
  flowerMat, lantern,
});

// Area Designer — press L to open/close
initEditor({ scene, camera, domElement: renderer.domElement, animated, getChar: () => char });
initEditorPanel();

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
const coordsEl = document.getElementById('coords');
function buildWorldHud(charName) {
  return '<b>' + PALETTES[Lighting.modeKey].name + ' — Arc 1+2</b> <small style="opacity:.55">v13</small><br>WASD move · Space jump/dive · hold right-click to look (all directions) · scroll zoom · Shift walk/run · swim in deep water · <b>E</b> board / interact · <b>G</b> gallery · <b>N</b> day/night · <b>C</b> character (' + charName + ') · <b>1-3</b> emote';
}
let WORLD_HUD = buildWorldHud(CHARACTER);
hudText.innerHTML = WORLD_HUD;

// ================= loop =================
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  frameGuards();
  Lighting.tick(dt);
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
    const off = Lighting.getSunOffset();
    sun.position.set(char.position.x + off.x, off.y, char.position.z + off.z);
    sun.target.position.copy(char.position);
  }
  renderer.render(scene, camera);
});
