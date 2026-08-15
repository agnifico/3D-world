// Open Sea zone — the Zone contract object (see core/zone.js). Same thin
// adapter shape as zones/lagoon/zone.js: terrain.js stays pure data + math,
// open-sea-fx.js builds the THREE content, this file wires them to the shell.
import {
  WORLD_EXTENT, WORLD_EXTENT_X, WORLD_EXTENT_Z, WATER_Y,
  terrainHeight, depthAt, terrainNormal, bandAt,
  PALETTES, dayCycle, scatterRecipe, catalogueBands,
  spawnPoints as rawSpawnPoints, portals, LANDMARKS, PLACED_GEOMETRY,
} from './terrain.js';
import { createOpenSea } from './open-sea-fx.js';
import { disposeGroup, registerPortals } from '../../core/zone.js';
import { createStoneArch } from '../../core/portal-arch.js';
import { applyEdits } from '../../core/world-edits.js';
import { edits } from './edits.js';

// The data zone object createOpenSea(zone) expects. worldExtentX/Z are the
// oblong pair (the fx layer sizes its terrain/water planes off them);
// worldExtent stays the scalar the shell reads.
const zoneData = {
  id: 'open-sea', name: 'The Open Sea',
  worldExtent: WORLD_EXTENT, worldExtentX: WORLD_EXTENT_X, worldExtentZ: WORLD_EXTENT_Z,
  WATER_Y, terrainHeight, depthAt, terrainNormal, bandAt,
  PALETTES, dayCycle, scatterRecipe, portals,
  landmarks: LANDMARKS,
};

const spawnPoints = {
  default: { x: 70, z: 20 }, 
  shore: { x: rawSpawnPoints.shore.position[0], z: rawSpawnPoints.shore.position[2] },
  boat: { x: rawSpawnPoints.boat.position[0], z: rawSpawnPoints.boat.position[2] },
  dive: { x: rawSpawnPoints.dive.position[0], z: rawSpawnPoints.dive.position[2] },
};

let built = null;

function build(ctx) {
  // Same reason as Lagoon: the shared character controller reads ground height
  // through ctx.heightRegistry, not a zone's terrainHeight directly.
  ctx.heightRegistry.register(terrainHeight, 'terrain');

  applyEdits(ctx, ctx.scene, { id: 'open-sea', terrainHeight, WATER_Y }, edits)
    .catch(e => console.error('[open-sea world-edits]', e));

  const sea = createOpenSea(zoneData, { hemi: ctx.lighting.hemi, sun: ctx.lighting.sun });
  sea.attach(ctx.scene);

  // ── PLACED GEOMETRY (the only non-painted terrain in the zone) ────────────
  // A heightfield cannot overhang, so every swim-through is a prop. Three of
  // them, all at deliberate dive destinations — see PLACED_GEOMETRY in
  // terrain.js for the rationale of each.
  for (const g of PLACED_GEOMETRY) {
    const arch = createStoneArch();
    arch.position.set(g.x, terrainHeight(g.x, g.z), g.z);
    if (g.rotY) arch.rotation.y = g.rotY;
    // tunnels read as a longer, flatter arch until there are real cave props
    if (g.kind === 'tunnel') arch.scale.set(1.1, 0.75, 2.6);
    else arch.scale.setScalar(1.6);
    ctx.scene.add(arch);
  }

  // Open Sea resolves its own 4-keyframe cycle internally (water depth stops,
  // abyss ramp, caustic/godray depth gates, plankton glow) — it wants the raw
  // global t, same as Lagoon.
  const unsubscribe = ctx.lighting.onBlend((PA, PB, localT, t) => sea.setDayNight(t));

  // The portal back to Town, in wading water on Gullhook's beach.
  for (const portal of portals) {
    const arch = createStoneArch();
    arch.position.set(portal.x, terrainHeight(portal.x, portal.z), portal.z);
    ctx.scene.add(arch);
  }
  registerPortals(ctx, portals);

  built = { sea, unsubscribe, realScene: ctx.realScene, group: ctx.scene };
  return ctx.scene;
}

function update(dt, camera) {
  if (!built) return;
  built.sea.update(dt, camera, built.realScene);
}

function dispose() {
  if (!built) return;
  built.unsubscribe();
  disposeGroup(built.realScene, built.group);
  built = null;
}

// Zone contract (core/zone.js): the real swell, not the flat WATER_Y plane
// every other zone falls back to. Guarded for the window before build() has
// run (e.g. resolveSpawn reads terrainHeight before the fx layer exists).
function surfaceHeightAt(x, z) { return built ? built.sea.surfaceHeightAt(x, z) : WATER_Y; }
function surfaceNormalAt(x, z) { return built ? built.sea.surfaceNormalAt(x, z) : { x: 0, y: 1, z: 0 }; }

export const zone = {
  id: 'open-sea',
  name: 'The Open Sea',
  worldExtent: WORLD_EXTENT,
  worldExtentX: WORLD_EXTENT_X,
  worldExtentZ: WORLD_EXTENT_Z,
  WATER_Y,
  terrainHeight,
  surfaceHeightAt,
  surfaceNormalAt,
  PALETTES,
  dayCycle,
  spawnPoints,
  portals,
  catalogueBands,
  // Same reason as Lagoon: these shaders are hand-authored sRGB and were tuned
  // against a plain renderer.render(), no post stack. Bloom is in-shader.
  usesBloomComposer: false,
  build,
  update,
  dispose,
};
export default zone;
