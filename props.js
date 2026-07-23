// Grassland World — static object placement: native hamlet/landmark props and
// the Kenney-pack set dressing, plus the bridge (the one landmark you can
// also walk on, so its height math lives here next to its placement). Also
// owns the live placement registry the area designer (editor.js) selects,
// moves, and deletes from.
import * as THREE from 'three';
import * as A from './assets.js';
import { terrainHeight, WATER_Y, groundHeight, registerHeightContributor } from './world.js';
import { BOAT_DEFS, registerBoat } from './boats.js';

function footprintOf(obj, kind) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  return { kind, x: obj.position.x, z: obj.position.z, r: Math.max(size.x, size.z) / 2, obj };
}

// ================= live placement registry (area designer) =================
// One entry per placed object; position/rotation/scale are read straight off
// `obj` by consumers (never snapshotted), so moving something in the editor
// can't go stale. `propsFootprints` (below) stays a separate, simpler list —
// groundwork for a future collision pass — kept in sync on add/remove.
export const registry = [];
let _nextId = 1;
function registerPlacement(kind, name, obj) {
  const rec = { id: _nextId++, kind, name, obj };
  obj.userData.__placementId = rec.id;
  registry.push(rec);
  return rec;
}
export function removePlacement(scene, id) {
  const i = registry.findIndex(r => r.id === id);
  if (i === -1) return false;
  const [rec] = registry.splice(i, 1);
  scene.remove(rec.obj);
  const fi = propsFootprints.findIndex(f => f.obj === rec.obj);
  if (fi !== -1) propsFootprints.splice(fi, 1);
  return true;
}

// Every static object this module places, with a rough footprint radius —
// groundwork for a future collision pass. Populated as placement runs.
export const propsFootprints = [];

// bridge (crosses the stream on the path) — rot puts the deck's long axis
// perpendicular to the local stream flow so it spans bank-to-bank
export const BRIDGE = { x: 11, z: -11.5, rot: Math.atan2(-11, 16), y: -0.35 };
export function bridgeHeight(x, z) {
  const dx = x - BRIDGE.x, dz = z - BRIDGE.z;
  // world→local using the inverse of the mesh's rotation.y (must match place())
  const c = Math.cos(BRIDGE.rot), s = Math.sin(BRIDGE.rot);
  const lx = dx * c - dz * s; // width axis (across the deck)
  const lz = dx * s + dz * c; // length axis (along the deck) — matches the visual
  if (Math.abs(lx) > 1.7 || Math.abs(lz) > 6.6) return -Infinity;
  return BRIDGE.y + A.bridgeDeckHeight(lz, 0.8); // same formula as the visual deck, walkable-surface peak
}
registerHeightContributor(bridgeHeight);

// ================= native hamlet/landmark props =================
export const NATIVE_CATALOG = {
  houseA: A.createHouseA, houseB: A.createHouseB, houseC: A.createHouseC,
  well: A.createWell, cart: A.createCart, signpost: A.createSignpost,
  watchtower: A.createWatchtower, windmill: A.createWindmill,
  ruinedArch: A.createRuinedArch, stoneBridge: A.createStoneBridge,
};
// footprint `kind` label per catalog entry — matches what propsFootprints used
// before this was data-driven (multiple house variants all group as 'house')
const NATIVE_KIND = {
  houseA: 'house', houseB: 'house', houseC: 'house', well: 'well', cart: 'cart',
  signpost: 'signpost', watchtower: 'watchtower', windmill: 'windmill',
  ruinedArch: 'ruined-arch', stoneBridge: 'bridge',
};
// [catalogName, x, z, rot, y?]
const NATIVE_PLACEMENTS = [
  ['houseA', -14, -48, 0.5],
  ['houseB', -4, -52, -0.3],
  ['houseC', -16, -38, 1.9],
  ['well', -8, -44, 0.4],
  ['cart', -2, -46, -1.2],
  // (native signposts replaced by Kenney signpost — see set-dressing pass below)
  ['watchtower', -55, 60, 0],
  ['windmill', 55, -55, 2.4],
  ['ruinedArch', -60, -15, 0.7],
  ['stoneBridge', BRIDGE.x, BRIDGE.z, BRIDGE.rot, BRIDGE.y],
];

export function spawnNative(scene, animated, name, x, z, rot = 0, y) {
  const make = NATIVE_CATALOG[name];
  if (!make) { console.warn('[props] unknown native prop', name); return null; }
  const obj = make();
  obj.position.set(x, y !== undefined ? y : terrainHeight(x, z), z);
  obj.rotation.y = rot;
  scene.add(obj);
  if (obj.userData.blades) animated.push(dt => { obj.userData.blades.rotation.z += dt * 0.7; });
  propsFootprints.push(footprintOf(obj, NATIVE_KIND[name] || name));
  return registerPlacement('native', name, obj);
}

export function placeNativeProps(scene, animated) {
  for (const [name, x, z, rot, y] of NATIVE_PLACEMENTS) spawnNative(scene, animated, name, x, z, rot || 0, y);
}

// ================= Kenney set dressing =================
// Curated shortlist placed into the world in themed vignettes, all through the
// recolor pipeline. Kenney survival-kit is authored ~half native scale, so it
// gets a big multiplier to read at world scale next to the 1.7u character.
const KENNEY_PACK = {};
[['survival-kit', ['tent', 'tent-canvas', 'campfire-pit', 'campfire-stand', 'campfire-fishing-stand', 'bedroll', 'bedroll-packed', 'bucket', 'bottle', 'fence', 'fence-doorway', 'fence-fortified', 'barrel', 'box', 'box-open', 'workbench', 'workbench-anvil', 'workbench-grind', 'signpost', 'signpost-single', 'tree-log', 'tree-trunk', 'resource-wood', 'resource-planks', 'resource-stone', 'resource-stone-large', 'tool-axe', 'fish']],
 ['fantasy-town-kit', ['lantern', 'stall-green', 'stall-bench', 'banner-green', 'hedge', 'hedge-gate', 'wheel']],
 ['castle-kit', ['flag']],
 ['watercraft-pack', ['boat-row-small', 'boat-fishing-small']]
].forEach(([pack, names]) => names.forEach(n => (KENNEY_PACK[n] = pack)));
export { KENNEY_PACK };
const KENNEY_SCALE = { 'survival-kit': 3.2, 'fantasy-town-kit': 1.7, 'castle-kit': 2.2, 'watercraft-pack': 1.7 };
const KENNEY_DRESS_OVERRIDES = {
  bedroll: { remap: { '#4aa8b8': 0xe8dfc8 } },
  'bedroll-packed': { remap: { '#4aa8b8': 0xe8dfc8 } },
};
// name, x, z, rot, scaleMul?, onWater?, overrides? — overrides (if given) wins
// over KENNEY_DRESS_OVERRIDES[name]; used for per-instance area-designer recolors.
export async function spawnKenney(scene, animated, name, x, z, rot = 0, sMul = 1, onWater = false, overrides) {
  const pack = KENNEY_PACK[name];
  if (!pack) { console.warn('[kenney] unknown model', name); return null; }
  try {
    const obj = await A.loadKenneyModel(`assets/kenney/${pack}/${name}.glb`, overrides || KENNEY_DRESS_OVERRIDES[name]);
    obj.scale.setScalar((KENNEY_SCALE[pack] || 2) * sMul);
    obj.rotation.y = rot;
    obj.position.set(x, onWater ? WATER_Y - 0.15 : groundHeight(x, z), z);
    obj.userData.name = name;
    scene.add(obj);
    propsFootprints.push(footprintOf(obj, name));
    const rec = registerPlacement('kenney', name, obj);
    if (BOAT_DEFS[name]) registerBoat(scene, animated, obj, name);
    return rec;
  } catch (e) { console.warn(`[kenney] place ${name} failed:`, e.message); return null; }
}
// [name, x, z, rot, scaleMul?, onWater?]
const KENNEY_PLACEMENTS = [
  // camp clearing, east of the hamlet
  ['tent', 21, -25, 0.6], ['campfire-pit', 16.5, -28, 0], ['campfire-stand', 15.4, -29.4, 0.3],
  ['bedroll', 23, -23, -0.8], ['bedroll-packed', 24, -24.6, 0.4], ['bucket', 18, -30, 0], ['bottle', 15.4, -29.4, 0, 0.8],
  // hamlet yard — barrels, crates, a smith corner
  ['barrel', -12.5, -50.5, 0.2], ['barrel', -10.9, -50.9, 1.1], ['box', -1.6, -43, 0.3],
  ['box-open', 0.3, -42.2, -0.4], ['workbench', -19, -42.5, 1.6], ['workbench-anvil', -20.2, -44.4, 1.2],
  ['workbench-grind', -18.4, -46, 0.4], ['wheel', -17.3, -47.4, 0.5],
  // yard fence line + gate
  ['fence-doorway', -22.5, -40, 0.0], ['fence', -25, -41.4, 0.0], ['fence', -27.2, -42.8, 0.0],
  ['fence-fortified', -20, -38.4, 0.0],
  // garden hedges + market by the well
  ['hedge', -9, -34, 0], ['hedge', -6, -34, 0], ['hedge-gate', -3, -34, 0],
  ['stall-green', -12.5, -39, 1.2], ['stall-bench', -10.8, -37.4, 0.4], ['banner-green', -3, -32.5, 0.2],
  // wayfinding (replaces the two native signposts) + path lanterns
  ['signpost', 3, -31, 0.9], ['signpost-single', 22, 28, -2.2], ['lantern', 6.5, -27, 0], ['lantern', 25, 33, 0],
  // woodcutting site, NE grassland
  ['tree-trunk', 35, -30, 0], ['tree-log', 37, -31.2, 1.2], ['tool-axe', 35, -29.3, 0.6],
  ['resource-wood', 33, -32, 0], ['resource-planks', 32, -30.6, 0.5], ['resource-stone', 34.6, -33, 0],
  ['resource-stone-large', 36, -33.6, 0.3],
  // lakeside — fishing stand + catch on the dry shore (pulled back from the
  // lake carve so groundHeight clears the water), boats on the water
  ['campfire-fishing-stand', 24, 30, 2.4], ['fish', 25.6, 31, 0.5], ['fish', 26.2, 30, -0.4, 0.8],
  ['boat-row-small', 42, 47, 1.2, 1, true], ['boat-fishing-small', 46, 51, 2.0, 1, true],
  // castle flag at the watchtower
  ['flag', -52, 58, 0.5],
];

export async function placeKenneyProps(scene, animated) {
  for (const [n, x, z, rot, sm, w, overrides] of KENNEY_PLACEMENTS) {
    await spawnKenney(scene, animated, n, x, z, rot || 0, sm || 1, !!w, overrides);
  }
}
