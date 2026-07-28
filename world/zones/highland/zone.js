// Highland Terraces — the Zone contract object (see core/zone.js). terrain.js
// stays pure data + math; highland-fx.js's createHighland(zone) builds the THREE
// content and already exposes almost exactly the build/update/dispose shape the
// contract wants — this file is the thin adapter that wires it to the shell's
// height/collision/lighting/portal systems, same pattern as Lagoon's zone.js.
import * as THREE from 'three';
import {
  WORLD_EXTENT, WATER_Y, terrainHeight, depthAt, terrainNormal,
  PALETTES, dayCycle, scatterRecipe, spawnPoints as rawSpawnPoints, portals, LANDMARKS,
} from './terrain.js';
import { createHighland } from './highland-fx.js';
import { disposeGroup, registerPortals } from '../../core/zone.js';
import { createStoneArch } from '../../core/portal-arch.js';

// The shell's generic spawn-placement expects {x,z}; terrain.js carries the
// richer {position,lookAt,eyeHeight} the preview harness's view buttons need.
// Normalized here rather than complicating the shell for one zone.
const spawnPoints = {
  default: { x: rawSpawnPoints.entry.position[0], z: rawSpawnPoints.entry.position[2] }, // Plateau 1 entry
  entry: { x: rawSpawnPoints.entry.position[0], z: rawSpawnPoints.entry.position[2] },
  pool: { x: rawSpawnPoints.pool.position[0], z: rawSpawnPoints.pool.position[2] },
};

let built = null; // { highland, unsubscribe, realScene, group }

function build(ctx) {
  // Register terrain as a height contributor so the shared character controller
  // resolves ground height here (without it, groundHeight is -Infinity across
  // the zone → the character reads infinite water depth and never stands). The
  // terraces are a continuous single-valued heightfield, so standing/falling is
  // fully described by this — cliffs are just steep terrain (the intended slide/
  // leap), with no ledges to catch a diver on the pool-rim drop.
  ctx.heightRegistry.register(terrainHeight, 'terrain');

  const highland = createHighland(
    { WORLD_EXTENT, WATER_Y, terrainHeight, depthAt, terrainNormal, PALETTES, dayCycle, scatterRecipe, portals, LANDMARKS },
    { hemi: ctx.lighting.hemi, sun: ctx.lighting.sun },
  );
  highland.attach(ctx.scene);

  // Portal arches — the same shared factory Grassland/Lagoon use, so a portal
  // reads consistently from either side. Base at the local ground height, with
  // pillar colliders so you can't walk through the stones.
  for (const portal of portals) {
    const gy = terrainHeight(portal.x, portal.z);
    const arch = createStoneArch();
    arch.position.set(portal.x, gy, portal.z);
    ctx.scene.add(arch);
    ctx.collisionRegistry.addCircle(portal.x - 3.2, portal.z, 0.7, gy, gy + 5, false);
    ctx.collisionRegistry.addCircle(portal.x + 3.2, portal.z, 0.7, gy, gy + 5, false);
  }
  registerPortals(ctx, portals);

  // Highland resolves its OWN keyframed day cycle internally (sky-dome gradient,
  // terrain grade, pool tint, sun angle), so it just wants the raw global t.
  const unsubscribe = ctx.lighting.onBlend((PA, PB, localT, t) => highland.setDayNight(t));

  built = { highland, unsubscribe, realScene: ctx.realScene, group: ctx.scene };
  return ctx.scene;
}

function update(dt, camera) {
  if (!built) return;
  // hand the camera to the fx layer via the scene so the sky dome can follow it
  if (built.realScene) built.realScene.__cam = camera;
  built.highland.update(dt, camera);
}

function dispose() {
  if (!built) return;
  built.unsubscribe();
  disposeGroup(built.realScene, built.group);
  built = null;
}

export const zone = {
  id: 'highland',
  name: 'Highland Terraces',
  worldExtent: WORLD_EXTENT,
  WATER_Y,
  terrainHeight,
  PALETTES,
  dayCycle,
  spawnPoints,
  portals,
  build,
  update,
  dispose,
};
export default zone;
