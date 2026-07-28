// World Shell — entry point: the single renderer/scene/camera/animation
// loop, the shared systems every zone plugs into (height/collision
// registries, lighting, fx, audio, boats, interactables), the character
// controller (persists across zone crossings), and zone lifecycle
// (load/build/dispose). Portal transitions land in Stage C on top of this.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHeightRegistry } from './core/height-registry.js';
import { createCollisionRegistry } from './core/collision.js';
import { createLighting } from './core/lighting.js';
import { initFx, initComposer } from './core/fx.js';
import { initNightSky } from './core/night-sky.js';
import * as Audio from './core/audio.js';
import * as Boats from './core/boats.js';
import * as Interactables from './core/interactables.js';
import { CHARACTER } from './character/character.js';
import { initController } from './character/controller.js';
import grasslandZone from './zones/grassland/zone.js';
import lagoonZone from './zones/lagoon/zone.js';
import highland from './zones/highland/zone.js';
import galleryZone from './zones/gallery/zone.js';

const ZONES = { grassland: grasslandZone, lagoon: lagoonZone, highland: highland, gallery: galleryZone };

// ================= renderer / scene / camera =================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Explicit, matching zones/lagoon/preview.html — the reference Lagoon's
// custom shaders were tuned against (they hand-roll their own linear->sRGB
// encoding, so this must stay NoToneMapping; the default is already
// NoToneMapping, but stated explicitly so it can't silently drift).
renderer.toneMapping = THREE.NoToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ================= shared shell services =================
const heightRegistry = createHeightRegistry();
const collisionRegistry = createCollisionRegistry();
const lighting = createLighting(scene); // owns hemi/sun, scene.background, scene.fog, bloom values

const sharedAnimated = []; // shell-level per-frame work, independent of the active zone
const { spawnRipple, spawnSplash } = initFx(scene, sharedAnimated);
// Composer only runs for zones that opt in (default true) — see core/fx.js's
// initComposer comment: Lagoon explicitly opts out (zone.usesBloomComposer
// === false) since it was never built to render through one.
initComposer(renderer, scene, camera, lighting.getBloom, () => currentZone?.usesBloomComposer !== false);
// Shared night sky (stars + moon + the HUD vignette switch) — built once,
// added to the real scene, so every zone inherits it automatically without
// either zone.js needing to call anything.
initNightSky(scene, sharedAnimated, renderer, camera, lighting);

// ================= HUD =================
const hudText = document.getElementById('hudText');
const coordsEl = document.getElementById('coords');
let currentCharName = CHARACTER;
let WORLD_HUD = '';
function buildWorldHud() {
  return `<b>${currentZone ? currentZone.name : 'World'}</b> <small style="opacity:.55">world shell</small><br>WASD move · Space jump/dive · hold right-click to look (all directions) · scroll zoom · Shift walk/run · swim in deep water · <b>E</b> board / interact · <b>G</b> gallery · <b>K</b> catalogue gallery · <b>N</b> day/night · <b>C</b> character (${currentCharName}) · <b>1-3</b> emote`;
}

let overlayOpen = false; // true while a zone's own overlay (e.g. Grassland's gallery) is open
function handleOverlayToggle(open) {
  overlayOpen = open;
  coordsEl.style.display = open ? 'none' : '';
  if (open) { scene.fog.far = 5000; scene.fog.near = 3000; }
  else lighting.applyLighting(lighting.getT());
  hudText.innerHTML = open
    ? '<b>Asset gallery</b> — every factory in assets.js<br><b>G</b> back to the world'
    : WORLD_HUD;
}

// character hot-swap (C key) — a small loading hint
const charHint = document.createElement('div');
charHint.style.cssText = 'position:fixed; left:50%; top:14px; transform:translateX(-50%); z-index:3; display:none; font:600 13px ui-sans-serif, system-ui, sans-serif; color:#4a3826; background:rgba(250,248,240,.88); border:1px solid rgba(107,79,53,.3); border-radius:8px; padding:5px 12px;';
charHint.textContent = 'Loading character…';
document.body.appendChild(charHint);
function handleSwapStateChange(loading) { charHint.style.display = loading ? '' : 'none'; }
function handleCharacterChanged(name) {
  currentCharName = name;
  WORLD_HUD = buildWorldHud();
  if (!overlayOpen) hudText.innerHTML = WORLD_HUD;
}

// ================= character controller (persists across zone crossings) =================
const controllerApi = initController(scene, sharedAnimated, {
  canvas: renderer.domElement,
  spawnRipple, spawnSplash,
  sfxSplash: Audio.sfxSplash, sfxStep: Audio.sfxStep, sfxJump: Audio.sfxJump, sfxBoard: Audio.sfxBoard,
  heightRegistry, collisionRegistry, lighting,
  onSwapStateChange: handleSwapStateChange,
  onCharacterChanged: handleCharacterChanged,
});
const { char, updateCharacter, updateCamera, frameGuards } = controllerApi;

// GLB drop-in (pipeline test): placeGLB('assets/tree_pine_01.glb', 0, -20) from the console.
window.placeGLB = async function (url, x, z, scale = 1) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const obj = gltf.scene;
  obj.scale.setScalar(scale);
  obj.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  console.log(`[placeGLB] ${url} — size ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} u`);
  obj.position.set(x, currentZone.terrainHeight(x, z) - box.min.y, z);
  scene.add(obj);
  return obj;
};

// ================= zone lifecycle =================
let currentZone = null, currentZoneCtx = null;

// Cross-cutting bridge between the two shared registries: a standable
// collider (a rock, a bridge deck's rail top, ...) should also read as
// ground height. Re-registered on every zone build since heightRegistry's
// reset() (below) clears it along with everything else.
function resetForNewZone() {
  heightRegistry.reset();
  collisionRegistry.reset();
  Boats.resetBoats();
  Interactables.reset();
  heightRegistry.register((x, z) => collisionRegistry.supportAt(x, z) ?? -Infinity, 'props-support');
}

// entryId can name either a spawnPoint or a portal id (a portal crossing
// names the destination portal, e.g. 'drowned-arch') — arriving AT a portal
// means landing at that portal's own (x,z), not a separate named spawn.
function resolveSpawn(zoneModule, entryId) {
  if (entryId) {
    const portal = zoneModule.portals.find(p => p.id === entryId);
    if (portal) return { x: portal.x, z: portal.z };
    if (zoneModule.spawnPoints[entryId]) return zoneModule.spawnPoints[entryId];
  }
  return zoneModule.spawnPoints.default || { x: 0, z: 0 };
}

export function loadZone(zoneId, entryId) {
  const zoneModule = ZONES[zoneId];
  if (!zoneModule) { console.warn(`[world] unknown zone "${zoneId}"`); return; }
  if (currentZone) currentZone.dispose();
  overlayOpen = false;
  resetForNewZone();

  const group = new THREE.Group();
  scene.add(group);
  const ctx = {
    scene: group, realScene: scene, animated: [],
    heightRegistry, collisionRegistry, lighting,
    abortController: new AbortController(), renderer, camera, domElement: renderer.domElement,
    getChar: () => controllerApi.char, getHeading: () => controllerApi.getHeading(),
    onOverlayToggle: handleOverlayToggle,
    onPortalEnter: crossPortal,
  };
  zoneModule.build(ctx);
  currentZone = zoneModule; currentZoneCtx = ctx;

  lighting.loadZonePalette(zoneModule, lighting.getT());
  controllerApi.setActiveZone(zoneModule, { isOverlayOpen: () => overlayOpen });

  const spawn = resolveSpawn(zoneModule, entryId);
  const y = zoneModule.terrainHeight(spawn.x, spawn.z);
  controllerApi.placeAt(spawn.x, y, spawn.z, spawn.heading || 0);

  WORLD_HUD = buildWorldHud();
  if (!overlayOpen) hudText.innerHTML = WORLD_HUD;
}

// ================= portal transition =================
// Masked fade: fade to white -> dispose old zone, build new zone, place
// character (+ boat, if riding) -> fade in. The mask hides the build hitch
// and guarantees clean teardown, per the brief. Runs the SAME branch for
// on-foot and boat-borne crossings except for the boat re-spawn/re-mount
// step in the middle.
const fadeEl = document.getElementById('fade');
function fadeTo(opacity, seconds) {
  return new Promise(resolve => {
    fadeEl.style.transition = `opacity ${seconds}s ease`;
    fadeEl.style.opacity = String(opacity);
    setTimeout(resolve, seconds * 1000);
  });
}

let crossing = false;
export async function crossPortal(portal) {
  if (crossing) return;
  crossing = true;
  try {
    const crossState = controllerApi.getCrossingState(); // { riding, boatType, heading } | { riding: false }
    await fadeTo(1, 0.6);
    loadZone(portal.targetZone, portal.targetPortal);
    if (crossState.riding) {
      // Into the NEW zone's own private content group (currentZoneCtx.scene,
      // set by loadZone() just above) — NOT the real top-level `scene`. A
      // boat added straight to the real scene would never be reachable by
      // disposeGroup() on the next crossing and would leak forever (caught
      // by the 10x round-trip check: textures grew every single crossing
      // until this was fixed).
      const boat = await Boats.spawnBoatAt(currentZoneCtx.scene, currentZoneCtx.animated, crossState.boatType, char.position.x, char.position.z, crossState.heading, currentZone.WATER_Y);
      if (boat) controllerApi.mountBoat(boat);
    }
    await fadeTo(0, 0.6);
  } finally {
    crossing = false;
  }
}
window.__crossPortal = crossPortal; // dev hook — e.g. __crossPortal(__portal())
window.__portal = () => currentZone?.portals?.[0]; // dev hook — the active zone's first portal

// Dev hotkey: force-cross the active zone's first portal regardless of
// distance (P), alongside the normal E-when-in-range path (interactables).
addEventListener('keydown', e => {
  if (!e.isTrusted || e.code !== 'KeyP') return;
  const portal = currentZone?.portals?.[0];
  if (portal) crossPortal(portal);
});

// Catalogue gallery (K): a full zone swap, not an overlay, so it force-loads
// every served catalogue entry via the same build/dispose lifecycle any
// other zone gets. Remembers which zone was active so K again returns there.
let zoneBeforeGallery = null;
addEventListener('keydown', e => {
  if (!e.isTrusted || e.code !== 'KeyK' || overlayOpen) return;
  if (currentZone?.id === 'gallery') {
    loadZone(zoneBeforeGallery || 'grassland');
    zoneBeforeGallery = null;
  } else {
    zoneBeforeGallery = currentZone?.id;
    loadZone('gallery');
  }
});

const _params = new URLSearchParams(location.search);
loadZone(_params.get('zone') || 'grassland', _params.get('entry'));

// ================= loop =================
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  frameGuards();
  lighting.tick(dt);
  for (const fn of sharedAnimated) fn(dt, t);
  for (const fn of currentZoneCtx.animated) fn(dt, t);
  if (window.__aerial) {
    scene.fog.far = 5000; scene.fog.near = 3000;
    camera.position.set(0, 175, 30);
    camera.lookAt(0, 0, -2);
    lighting.sun.position.set(40, 120, 30); lighting.sun.target.position.set(0, 0, 0);
  } else if (!overlayOpen) {
    updateCharacter(dt);
    updateCamera(dt, camera);
    coordsEl.textContent = `x ${char.position.x.toFixed(1)} · z ${char.position.z.toFixed(1)} · y ${char.position.y.toFixed(1)}`;
  }
  // Sun positioning is zone-specific (Grassland follows the character for
  // shadow quality; Lagoon wants a fixed directional angle, no follow) — each
  // zone's own update() decides, not this shell loop.
  currentZone.update(dt, camera);
  renderer.render(scene, camera);
});

window.__scene = scene;
window.__loadZone = loadZone; // dev hook — force a zone (re)build from the console, e.g. for the round-trip memory check
window.__rendererInfo = () => ({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures });
