// Grassland zone — the Zone contract object (see core/zone.js). Wraps what
// used to be grassland/main.js's top-level wiring into build(ctx)/update
// (dt,camera)/dispose(), so the shell can build, run, and cleanly tear this
// zone down any number of times across portal crossings.
import * as THREE from 'three';
import { terrainHeight, WATER_Y } from './world.js';
import { PALETTES, dayCycle } from './palettes.js';
import { createTerrainMesh, createWater } from './terrain-mesh.js';
import { initNightFx } from './night-fx.js';
import { initMinimap, disposeMinimap } from './minimap.js';
import { placeNativeProps, placeKenneyProps, registerBridge, resetRegistry } from './props.js';
import { scatterWorld, resetScatter } from './scatter.js';
import { placeCatalogueFloraSync, instantiateCatalogueFlora } from './catalogue-flora.js';
import * as Gallery from './gallery.js';
import { initEditor, disposeEditor } from './editor.js';
import { initEditorPanel, disposeEditorPanel } from './editor-panel.js';
import { boats, boatHeight } from '../../core/boats.js';
import { disposeGroup, registerPortals } from '../../core/zone.js';
import { createStoneArch } from '../../core/portal-arch.js';

// The shore-arch portal to Lagoon: placed in water on purpose (per the
// addendum) so crossing here on a boat is the natural way across, not just
// on foot. (55,33) numerically checked against terrainHeight — 3.3 units
// underwater, well clear of the shoreline.
const PORTALS = [
  { id: 'shore-arch', x: 55, z: 33, targetZone: 'lagoon', targetPortal: 'drowned-arch' },
];

// scratch Color reused by the water-blend subscriber below (module-scope so
// it isn't reallocated per blend tick — matches the discipline every other
// blend path in this codebase already follows).
const _colScratch = new THREE.Color();
const _col = hex => _colScratch.set(hex);

let built = null; // { realScene, group } — captured at build() for dispose()

function build(ctx) {
  resetRegistry();
  resetScatter();

  ctx.heightRegistry.register(terrainHeight, 'terrain');
  ctx.heightRegistry.register(boatHeight, 'boat');

  const { applyBlend: applyTerrainBlend } = createTerrainMesh(ctx.scene, PALETTES);
  const { waterMat } = createWater(ctx.scene, PALETTES);

  initNightFx({ ...ctx, terrainHeightFn: terrainHeight, waterY: WATER_Y }, ctx.scene, ctx.animated, ctx.renderer, ctx.camera);
  initMinimap(ctx, ctx.animated, PALETTES, boats, ctx.getChar, ctx.getHeading, Gallery.isGalleryOpen);

  placeNativeProps(ctx, ctx.scene, ctx.animated);
  registerBridge(ctx);
  placeKenneyProps(ctx, ctx.scene, ctx.animated); // fire-and-forget — awaits internally per placement

  // Trees/rocks/bushes: position/species/variant decided synchronously
  // (treePts must be ready before scatterWorld's mushroom-clustering pass,
  // right below); the actual GLB load + instancing + collision registration
  // is fire-and-forget async, same convention as placeKenneyProps above.
  const { groups: catalogueFloraGroups } = placeCatalogueFloraSync();
  const { applyGrassBlend, flowerMat } = scatterWorld(ctx.scene, ctx.animated, PALETTES);
  instantiateCatalogueFlora(ctx, ctx.scene, catalogueFloraGroups).catch(e => console.error('[catalogue-flora]', e));

  Gallery.buildGallery(ctx, ctx.scene, ctx.animated, open => ctx.onOverlayToggle?.(open));

  initEditor({ ctx, scene: ctx.scene, camera: ctx.camera, domElement: ctx.domElement, animated: ctx.animated, getChar: ctx.getChar });
  initEditorPanel();

  // Portal arch — base at WATER_Y (per the addendum: "standing in/over the
  // water"), rising up from the surface rather than the seafloor 3.3 units
  // below, so it reads as an arch you sail/swim through, not a submerged ruin.
  for (const portal of PORTALS) {
    const arch = createStoneArch();
    arch.position.set(portal.x, WATER_Y, portal.z);
    ctx.scene.add(arch);
    ctx.collisionRegistry.addCircle(portal.x - 3.2, portal.z, 0.7, WATER_Y, WATER_Y + 5, false);
    ctx.collisionRegistry.addCircle(portal.x + 3.2, portal.z, 0.7, WATER_Y, WATER_Y + 5, false);
  }
  registerPortals(ctx, PORTALS);

  built = { realScene: ctx.realScene, group: ctx.scene, sun: ctx.lighting.sun, lighting: ctx.lighting, getChar: ctx.getChar };

  // Registers this zone's own material blend (terrain/grass vertex colors +
  // water color/opacity/roughness/metalness + flower emissive) as a
  // subscriber on the shared lighting engine, alongside the shell-common
  // fields (sky/fog/hemi/sun/bloom) core/lighting.js already handles itself.
  const unsubscribe = ctx.lighting.onBlend((PA, PB, localT) => {
    if (waterMat) {
      waterMat.color.set(PA.water.color).lerp(_col(PB.water.color), localT);
      waterMat.opacity = PA.water.opacity + (PB.water.opacity - PA.water.opacity) * localT;
      waterMat.roughness = PA.water.roughness + (PB.water.roughness - PA.water.roughness) * localT;
      waterMat.metalness = PA.water.metalness + (PB.water.metalness - PA.water.metalness) * localT;
    }
    applyTerrainBlend(localT);
    applyGrassBlend(localT);
    if (flowerMat) flowerMat.emissiveIntensity = (PA.flowerGlow + (PB.flowerGlow - PA.flowerGlow) * localT) * 0.5;
  });
  built.unsubscribe = unsubscribe;

  return ctx.scene;
}

function update(dt, camera) {
  if (!built) return;
  const sun = built.sun;
  if (Gallery.isGalleryOpen()) {
    // The gallery's orbit-camera view lives here (moved from the old main.js
    // render loop, since the gallery — and the camera mode it needs — are
    // zone content now, not a shell concern): the shell skips its own
    // character-follow camera update whenever an overlay is open and defers
    // to this instead.
    const t = performance.now() / 1000;
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
  } else {
    // Shadow-casting sun follows the character every frame (moved from the
    // old main.js loop — this "sun rides the player" behavior is Grassland's
    // own choice for shadow quality, not a shell-generic concern; Lagoon's
    // sun stays at a fixed directional angle instead).
    const char = built.getChar();
    const off = built.lighting.getSunOffset();
    sun.position.set(char.position.x + off.x, off.y, char.position.z + off.z);
    sun.target.position.copy(char.position);
  }
}

function dispose() {
  if (!built) return;
  built.unsubscribe?.();
  disposeMinimap();
  disposeEditorPanel();
  disposeEditor();
  disposeGroup(built.realScene, built.group);
  built = null;
}

export const zone = {
  id: 'grassland',
  name: 'Grassland',
  worldExtent: 100,
  WATER_Y,
  terrainHeight,
  PALETTES,
  dayCycle,
  spawnPoints: {
    default: { x: 25, z: 37 }, // matches the original hardcoded controller spawn
  },
  portals: PORTALS,
  build,
  update,
  dispose,
};
export default zone;
