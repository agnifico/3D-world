// Lagoon zone — the Zone contract object (see core/zone.js). `terrain.js`
// stays pure data + math (imported here); `lagoon-fx.js`'s createLagoon(zone)
// builds the THREE content and already exposes almost exactly the
// build/update/dispose shape the contract wants — this file is a thin
// adapter, not a rewrite.
import {
  WORLD_EXTENT, WATER_Y, terrainHeight, depthAt, terrainNormal,
  PALETTES, dayCycle, scatterRecipe, spawnPoints as rawSpawnPoints, portals,
  ISLETS, SANDBARS, LAGOON_CX, LAGOON_CZ, DROP_BEARING, REEF_RADIUS,
} from './terrain.js';
import { createLagoon } from './lagoon-fx.js';
import { disposeGroup, registerPortals } from '../../core/zone.js';
import { createStoneArch } from '../../core/portal-arch.js';
import { placeCatalogueFloraSync, instantiateCatalogueFlora } from './catalogue-flora.js';
import { applyEdits } from '../../core/world-edits.js';
import { edits } from './edits.js';

// The data zone object lagoon-fx.js's createLagoon(zone) expects — same
// shape terrain.js used to bundle as its own default export.
const zoneData = {
  id: 'lagoon', name: 'The Shallows', worldExtent: WORLD_EXTENT, WATER_Y,
  terrainHeight, depthAt, terrainNormal, PALETTES, dayCycle, scatterRecipe, portals,
  landmarks: { islets: ISLETS, sandbars: SANDBARS, lagoonCenter: [LAGOON_CX, LAGOON_CZ], dropBearing: DROP_BEARING, reefRadius: REEF_RADIUS },
};

// The shell's generic spawn-placement (see zones/grassland/zone.js) expects
// {x,z} — terrain.js's spawnPoints carry richer {position:[x,y,z],lookAt,
// eyeHeight} for the preview harness's free-camera views. Normalized here
// rather than complicating the shell's generic placement logic for one zone.
const spawnPoints = {
  default: { x: rawSpawnPoints.shore.position[0], z: rawSpawnPoints.shore.position[2] },
  shore: { x: rawSpawnPoints.shore.position[0], z: rawSpawnPoints.shore.position[2] },
  boat: { x: rawSpawnPoints.boat.position[0], z: rawSpawnPoints.boat.position[2] },
};

let built = null; // { lagoon, unsubscribe, realScene, group }

function build(ctx) {
  // The shared character controller reads ground height via
  // ctx.heightRegistry (not a zone's terrainHeight directly) — without this,
  // groundHeight would resolve to -Infinity everywhere in Lagoon (no
  // contributors registered), reading as infinite water depth and never
  // letting the character stand even on dry land. No collision system is
  // needed here (Lagoon has no props/colliders yet), just the terrain
  // contributor itself.
  ctx.heightRegistry.register(terrainHeight, 'terrain');

  const lagoon = createLagoon(zoneData, { hemi: ctx.lighting.hemi, sun: ctx.lighting.sun });
  lagoon.attach(ctx.scene); // parents lagoon's content group under this zone's private group

  // Real Pirates palms + reef rocks, Simple_Nature grass stretched into
  // seaweed + shore bushes — catalogue-driven, instanced (see
  // catalogue-flora.js). Placement is sync; loading/instancing is
  // fire-and-forget async, same convention as Grassland's placeKenneyProps/
  // catalogue-flora.js.
  const { groups: catalogueFloraGroups } = placeCatalogueFloraSync();
  instantiateCatalogueFlora(ctx, ctx.scene, catalogueFloraGroups).catch(e => console.error('[lagoon catalogue-flora]', e));
  // World Editor (Layer 4) — hand-placed catalogue props (mainShip lives
  // here now, see edits.js) — fire-and-forget, same convention as above.
  applyEdits(ctx, ctx.scene, { id: 'lagoon', terrainHeight, WATER_Y }, edits).catch(e => console.error('[lagoon world-edits]', e));

  // Lagoon resolves its OWN 4-keyframe day cycle internally (richer than the
  // shell's generic 2-field blend — water depth stops, terrain grade,
  // flora night-mix/glow, underwater fog/tint all need Lagoon-specific
  // interpolation) — so it just wants the raw global t, not the
  // (PA,PB,localT) breakdown core/lighting.js already did for its own
  // shell-common fields.
  const unsubscribe = ctx.lighting.onBlend((PA, PB, localT, t) => lagoon.setDayNight(t));

  // The drowned-arch portal was data-only until now (no visual at all, per
  // the README's own TODO) — same shared arch factory Grassland's portal
  // uses, so a portal reads consistently from either side. (6,20) numerically
  // checked: 2.87 units underwater, well clear of the 0.45 boat-floats
  // threshold and not near any islet/sandbar.
  for (const portal of portals) {
    const arch = createStoneArch();
    arch.position.set(portal.x, WATER_Y, portal.z);
    ctx.scene.add(arch);
  }
  registerPortals(ctx, portals);

  built = { lagoon, unsubscribe, realScene: ctx.realScene, group: ctx.scene };
  return ctx.scene;
}

function update(dt, camera) {
  if (!built) return;
  // envScene = the REAL scene, not this zone's private content group — see
  // lagoon-fx.js's update() comment: fog/background need the object
  // renderer.render(scene,camera) actually reads.
  built.lagoon.update(dt, camera, built.realScene);
}

function dispose() {
  if (!built) return;
  built.unsubscribe();
  // No need to also call built.lagoon.dispose() — its own traversal only
  // does the same geometry/material disposal disposeGroup() already does
  // generically (and lagoon-fx.js has no DOM listeners to worry about).
  disposeGroup(built.realScene, built.group);
  built = null;
}

export const zone = {
  id: 'lagoon',
  name: 'The Shallows',
  worldExtent: WORLD_EXTENT,
  WATER_Y,
  terrainHeight,
  PALETTES,
  dayCycle,
  spawnPoints,
  portals,
  // Opt out of the shell's shared bloom composer (core/fx.js) — Lagoon's
  // palettes carry a non-trivial bloom.strength even in its day keyframe,
  // but its shaders (custom water/flora/terrain, all hand-authored sRGB
  // encoding) were tuned against a plain renderer.render(), no post stack at
  // all, exactly matching preview.html. Running it through EffectComposer +
  // UnrealBloomPass anyway is precisely the gotcha the README already
  // flags ("rendered black... night glow is in-shader emissive instead")
  // and is what caused the shell's Lagoon view to look blown-out/
  // differently-graded than the preview. Grassland has no such field and
  // defaults to true (composer only actually engages there at night, when
  // its own bloom.strength wakes up).
  usesBloomComposer: false,
  build,
  update,
  dispose,
};
export default zone;
