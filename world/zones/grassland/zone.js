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
import { scatterWorld, resetScatter } from './scatter.js';
import { placeCatalogueFloraSync, instantiateCatalogueFlora } from './catalogue-flora.js';
import { applyEdits } from '../../core/world-edits.js';
import { edits } from './edits.js';
import { boats, boatHeight } from '../../core/boats.js';
import { disposeGroup, registerPortals } from '../../core/zone.js';
import { createStoneArch } from '../../core/portal-arch.js';

// The shore-arch portal to Lagoon: placed in water on purpose (per the
// addendum) so crossing here on a boat is the natural way across, not just
// on foot. (55,33) numerically checked against terrainHeight — 3.3 units
// underwater, well clear of the shoreline.
const PORTALS = [
  { id: 'shore-arch',    x: 55, z: 33, targetZone: 'lagoon',   targetPortal: 'drowned-arch' },
  { id: 'highland-arch', x: 22, z: 49, targetZone: 'highland', targetPortal: 'plunge-arch' },
  { id: 'fjord-arch', x: 92, z: 61, targetZone: 'open-sea', targetPortal: 'sea-fjord-gate' },
];

// scratch Color reused by the water-blend subscriber below (module-scope so
// it isn't reallocated per blend tick — matches the discipline every other
// blend path in this codebase already follows).
const _colScratch = new THREE.Color();
const _col = hex => _colScratch.set(hex);

let built = null; // { realScene, group } — captured at build() for dispose()

function build(ctx) {
  resetScatter();

  ctx.heightRegistry.register(terrainHeight, 'terrain');
  ctx.heightRegistry.register(boatHeight, 'boat'); // non-ridden decks walkable

  const { applyBlend: applyTerrainBlend } = createTerrainMesh(ctx.scene, PALETTES);
  const { waterMat } = createWater(ctx.scene, PALETTES);

  initNightFx({ ...ctx, terrainHeightFn: terrainHeight, waterY: WATER_Y }, ctx.scene, ctx.animated, ctx.renderer, ctx.camera);
  initMinimap(ctx, ctx.animated, PALETTES, boats, ctx.getChar, ctx.getHeading, () => false);

  // Trees/rocks/bushes: position/species/variant decided synchronously
  // (treePts must be ready before scatterWorld's mushroom-clustering pass,
  // right below); the actual GLB load + instancing + collision registration
  // is fire-and-forget async.
  const { groups: catalogueFloraGroups } = placeCatalogueFloraSync();
  const { applyGrassBlend, flowerMat } = scatterWorld(ctx.scene, ctx.animated, PALETTES);
  instantiateCatalogueFlora(ctx, ctx.scene, catalogueFloraGroups).catch(e => console.error('[catalogue-flora]', e));
  // World Editor (Layer 4) — hand-placed catalogue props (backtick editor).
  applyEdits(ctx, ctx.scene, { id: 'grassland', terrainHeight, WATER_Y }, edits).catch(e => console.error('[grassland world-edits]', e));

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
  // Shadow-casting sun follows the character every frame — Grassland's own
  // choice for shadow quality (Lagoon's sun stays at a fixed angle instead).
  const char = built.getChar();
  const off = built.lighting.getSunOffset();
  sun.position.set(char.position.x + off.x, off.y, char.position.z + off.z);
  sun.target.position.copy(char.position);
}

function dispose() {
  if (!built) return;
  built.unsubscribe?.();
  disposeMinimap();
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