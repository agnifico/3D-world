// Grassland zone — static object placement: native hamlet/landmark props and
// the Kenney-pack set dressing, plus the bridge (the one landmark you can
// also walk on, so its height math lives here next to its placement). Also
// owns the live placement registry the area designer (editor.js) selects,
// moves, and deletes from.
//
// Adapted for the shared shell: collider/height-contributor registration
// that used to fire once at module top-level now happens inside functions
// the zone's build(ctx) calls explicitly (registerBridge, placeNativeProps,
// placeKenneyProps) — an ES module's top level only ever runs once, but this
// zone can be disposed and rebuilt many times (portal crossings), so nothing
// that needs to exist again after a rebuild may live outside a function.
import * as THREE from 'three';
import * as A from './assets.js';
import { terrainHeight, WATER_Y } from './world.js';
import { BOAT_DEFS, registerBoat, setBridgeSpan } from '../../core/boats.js';

function fullBox(obj) { return new THREE.Box3().setFromObject(obj); }
function footprintOf(obj, kind) {
  const size = fullBox(obj).getSize(new THREE.Vector3());
  return { kind, x: obj.position.x, z: obj.position.z, r: Math.max(size.x, size.z) / 2, obj };
}

// ================= collider derivation (Brief 4 Part A) =================
// A naive full Box3 inflates on any roof overhang/protrusion the same way a
// tree's canopy radius does — so the auto-derived footprint comes from a LOW
// SLICE of the actual geometry instead: only vertices within LOW_SLICE_Y of
// the object's own base go into the box. Eaves/roofs/anything above head
// height stop inflating the footprint automatically.
const LOW_SLICE_Y = 1.5;
function lowSliceBox(obj, maxLocalY = LOW_SLICE_Y) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const baseY = obj.position.y;
  let any = false;
  obj.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.y - baseY <= maxLocalY) { box.expandByPoint(v); any = true; }
    }
  });
  return any ? box : fullBox(obj); // fallback: an object entirely above the cutoff
}
// Absolute-capped shrink, not flat-percentage — a flat 15% is ~0.05 units on
// a small rock (fine) but ~0.9 units *inside the wall* on a house half-extent
// (not fine).
const SHRINK_PCT = 0.15, SHRINK_CAP = 0.2, MIN_HALF = 0.05;
function shrinkHalf(fullSize) {
  const half = fullSize / 2;
  return Math.max(MIN_HALF, half - Math.min(SHRINK_PCT * half, SHRINK_CAP));
}
const NO_ROOF_WALK = new Set(['houseA', 'houseB', 'houseC']);
// name -> {shape:'circle', r} | {shape:'obb', hw, hd} | {shape:'split', circles:[{dx,dz,r}]} | null
export const COLLIDER_OVERRIDES = {
  well: { shape: 'circle', r: 1.1, standable: false }, barrel: { shape: 'circle', r: 0.45, standable: false },
  watchtower: { shape: 'circle', r: 2.5, standable: false }, windmill: { shape: 'circle', r: 1.8, standable: false },
  lantern: { shape: 'circle', r: 0.25, standable: false }, signpost: { shape: 'circle', r: 0.2, standable: false }, 'signpost-single': { shape: 'circle', r: 0.2, standable: false },
  wheel: { shape: 'circle', r: 0.35, standable: false }, 'tree-log': { shape: 'circle', r: 0.4, standable: false }, 'tree-trunk': { shape: 'circle', r: 0.4, standable: false },
  fence: { shape: 'obb', hw: 1.0, hd: 0.12, standable: false }, 'fence-fortified': { shape: 'obb', hw: 1.0, hd: 0.12, standable: false },
  hedge: { shape: 'obb', hw: 1.0, hd: 0.3, standable: false },
  bedroll: null, 'bedroll-packed': null, 'tool-axe': null, fish: null, flag: null, 'banner-green': null,
  bottle: null, 'resource-wood': null, 'resource-planks': null, 'resource-stone': null,
  'hedge-gate': null, 'fence-doorway': null,
  'boat-row-small': null, 'ship-large': null, 'boat-fishing-small': null,
  stoneBridge: null, // handled by two explicit railing OBBs instead (see registerBridge below)
  ruinedArch: { shape: 'split', circles: [{ dx: -1.8, dz: 0, r: 0.55 }, { dx: 1.8, dz: 0, r: 0.55 }], standable: false },
};
function deriveCollider(ctx, obj, name, explicitOverride) {
  const override = explicitOverride !== undefined ? explicitOverride : (name in COLLIDER_OVERRIDES ? COLLIDER_OVERRIDES[name] : undefined);
  if (override === null) return [];
  const fullSize = fullBox(obj).getSize(new THREE.Vector3());
  const yLow = ctx.heightRegistry.groundHeight(obj.position.x, obj.position.z);
  const noRoofWalk = NO_ROOF_WALK.has(name);
  const yHigh = noRoofWalk ? Infinity : yLow + fullSize.y;
  const standable = !noRoofWalk && override?.standable !== false;
  const live = () => ({ x: obj.position.x, z: obj.position.z, rot: obj.rotation.y });
  const ids = [];
  if (override) {
    if (override.shape === 'circle') {
      ids.push(ctx.collisionRegistry.addCircle(obj.position.x, obj.position.z, override.r, yLow, yHigh, standable, live).id);
    } else if (override.shape === 'obb') {
      ids.push(ctx.collisionRegistry.addOBB(obj.position.x, obj.position.z, override.hw, override.hd, obj.rotation.y, yLow, yHigh, standable, live).id);
    } else if (override.shape === 'split') {
      for (const circ of override.circles) {
        const liveCirc = () => {
          const c = Math.cos(obj.rotation.y), s = Math.sin(obj.rotation.y);
          return { x: obj.position.x + circ.dx * c + circ.dz * s, z: obj.position.z + (-circ.dx * s + circ.dz * c) };
        };
        const p0 = liveCirc();
        ids.push(ctx.collisionRegistry.addCircle(p0.x, p0.z, circ.r, yLow, yHigh, standable, liveCirc).id);
      }
    }
    return ids;
  }
  const sliceSize = lowSliceBox(obj).getSize(new THREE.Vector3());
  const hw = shrinkHalf(sliceSize.x), hd = shrinkHalf(sliceSize.z);
  ids.push(ctx.collisionRegistry.addOBB(obj.position.x, obj.position.z, hw, hd, obj.rotation.y, yLow, yHigh, standable, live).id);
  return ids;
}

// ================= live placement registry (area designer) =================
export const registry = [];
let _nextId = 1;
function registerPlacement(kind, name, obj, colliderIds) {
  const rec = { id: _nextId++, kind, name, obj, colliderIds: colliderIds || [] };
  obj.userData.__placementId = rec.id;
  registry.push(rec);
  return rec;
}
export function removePlacement(ctx, scene, id) {
  const i = registry.findIndex(r => r.id === id);
  if (i === -1) return false;
  const [rec] = registry.splice(i, 1);
  scene.remove(rec.obj);
  const fi = propsFootprints.findIndex(f => f.obj === rec.obj);
  if (fi !== -1) propsFootprints.splice(fi, 1);
  for (const cid of rec.colliderIds) ctx.collisionRegistry.removeCollider(cid);
  return true;
}
// Reset the live registry — called at the start of build() so a rebuild
// (e.g. re-entering this zone via a portal) doesn't accumulate duplicate
// entries; the old THREE objects are already gone via the zone group being
// disposed, this just drops the bookkeeping arrays too.
export function resetRegistry() {
  registry.length = 0;
  propsFootprints.length = 0;
}

export const propsFootprints = [];

// bridge (crosses the stream on the path) — rot puts the deck's long axis
// perpendicular to the local stream flow so it spans bank-to-bank
export const BRIDGE = { x: 11, z: -11.5, rot: Math.atan2(-11, 16), y: -0.35 };
function bridgeHeight(x, z) {
  const dx = x - BRIDGE.x, dz = z - BRIDGE.z;
  const c = Math.cos(BRIDGE.rot), s = Math.sin(BRIDGE.rot);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  if (Math.abs(lx) > 1.7 || Math.abs(lz) > 6.6) return -Infinity;
  return BRIDGE.y + A.bridgeDeckHeight(lz);
}
const RAIL_LZ_LO = -3.68, RAIL_LZ_HI = 2.94;
const RAIL_RISE = 0.6;
const WATER_GAP_LZ_LO = RAIL_LZ_LO + 0.5, WATER_GAP_LZ_HI = RAIL_LZ_HI - 0.5;
const DECK_BOTTOM_OFFSET = 0.445;
const clearanceAt = lz => BRIDGE.y + A.bridgeDeckHeight(lz) - DECK_BOTTOM_OFFSET;

// Registers the bridge's height contributor, its two railing colliders, and
// the boat-clearance span with core/boats.js. Called once per build() (not
// at module top-level) so a rebuilt zone gets these back after dispose().
export function registerBridge(ctx) {
  ctx.heightRegistry.register(bridgeHeight, 'bridge');
  const c = Math.cos(BRIDGE.rot), s = Math.sin(BRIDGE.rot);
  const railLzCenter = (RAIL_LZ_LO + RAIL_LZ_HI) / 2, railHd = (RAIL_LZ_HI - RAIL_LZ_LO) / 2;
  const yLow = BRIDGE.y + A.bridgeDeckHeight(0); // the span straddles lz=0, the arch's true peak
  const yHigh = yLow + RAIL_RISE;
  for (const side of [-1, 1]) {
    const lx = side * 1.6;
    const wx = BRIDGE.x + lx * c + railLzCenter * s, wz = BRIDGE.z + (-lx * s + railLzCenter * c);
    ctx.collisionRegistry.addOBB(wx, wz, 0.15, railHd, BRIDGE.rot, yLow, yHigh, false);
  }
  setBridgeSpan({ x: BRIDGE.x, z: BRIDGE.z, rot: BRIDGE.rot, hw: 1.7, lzLo: WATER_GAP_LZ_LO, lzHi: WATER_GAP_LZ_HI, clearanceAt });
}

// ================= native hamlet/landmark props =================
export const NATIVE_CATALOG = {
  houseA: A.createHouseA, houseB: A.createHouseB, houseC: A.createHouseC,
  well: A.createWell, cart: A.createCart, signpost: A.createSignpost,
  watchtower: A.createWatchtower, windmill: A.createWindmill,
  ruinedArch: A.createRuinedArch, stoneBridge: A.createStoneBridge,
};
const NATIVE_KIND = {
  houseA: 'house', houseB: 'house', houseC: 'house', well: 'well', cart: 'cart',
  signpost: 'signpost', watchtower: 'watchtower', windmill: 'windmill',
  ruinedArch: 'ruined-arch', stoneBridge: 'bridge',
};
// [catalogName, x, z, rot, y?, collider?] — collider overrides COLLIDER_OVERRIDES for this instance only
const NATIVE_PLACEMENTS = [
  ['houseA', -14, -48, 0.5],
  ['houseB', -4, -52, -0.3],
  ['houseC', -16, -38, 1.9],
  ['well', -8, -44, 0.4],
  ['cart', -2, -46, -1.2],
  ['watchtower', -55, 60, 0],
  ['windmill', 55, -55, 2.4],
  ['ruinedArch', -60, -15, 0.7],
  ['stoneBridge', BRIDGE.x, BRIDGE.z, BRIDGE.rot, BRIDGE.y],
];

export function spawnNative(ctx, scene, animated, name, x, z, rot = 0, y, collider) {
  const make = NATIVE_CATALOG[name];
  if (!make) { console.warn('[props] unknown native prop', name); return null; }
  const obj = make();
  obj.position.set(x, y !== undefined ? y : terrainHeight(x, z), z);
  obj.rotation.y = rot;
  scene.add(obj);
  if (obj.userData.blades) animated.push(dt => { obj.userData.blades.rotation.z += dt * 0.7; });
  propsFootprints.push(footprintOf(obj, NATIVE_KIND[name] || name));
  const colliderIds = deriveCollider(ctx, obj, name, collider);
  return registerPlacement('native', name, obj, colliderIds);
}

export function placeNativeProps(ctx, scene, animated) {
  for (const [name, x, z, rot, y, collider] of NATIVE_PLACEMENTS) spawnNative(ctx, scene, animated, name, x, z, rot || 0, y, collider);
}

// ================= Kenney set dressing =================
const KENNEY_PACK = {};
[['survival-kit', ['tent', 'tent-canvas', 'campfire-pit', 'campfire-stand', 'campfire-fishing-stand', 'bedroll', 'bedroll-packed', 'bucket', 'bottle', 'fence', 'fence-doorway', 'fence-fortified', 'barrel', 'box', 'box-open', 'workbench', 'workbench-anvil', 'workbench-grind', 'signpost', 'signpost-single', 'tree-log', 'tree-trunk', 'resource-wood', 'resource-planks', 'resource-stone', 'resource-stone-large', 'tool-axe', 'fish']],
 ['fantasy-town-kit', ['lantern', 'stall-green', 'stall-bench', 'banner-green', 'hedge', 'hedge-gate', 'wheel']],
 ['castle-kit', ['flag']],
 ['watercraft-pack', ['boat-row-small', 'boat-fishing-small', 'ship-large']]
].forEach(([pack, names]) => names.forEach(n => (KENNEY_PACK[n] = pack)));
export { KENNEY_PACK };
export const KENNEY_SCALE = { 'survival-kit': 3.2, 'fantasy-town-kit': 1.7, 'castle-kit': 2.2, 'watercraft-pack': 1.7 };
const KENNEY_DRESS_OVERRIDES = {
  bedroll: { remap: { '#4aa8b8': 0xe8dfc8 } },
  'bedroll-packed': { remap: { '#4aa8b8': 0xe8dfc8 } },
};
// Watercraft GLBs moved to the shared world/assets/kenney/ (both zones spawn
// boats); every other pack stays under this zone's own assets/kenney/. GLB
// loader URLs resolve relative to the page (world/index.html), not this
// module's own path, hence the zones/grassland/ prefix on the zone-local case.
function packUrl(pack, name) {
  return pack === 'watercraft-pack' ? `assets/kenney/${pack}/${name}.glb` : `zones/grassland/assets/kenney/${pack}/${name}.glb`;
}
// name, x, z, rot, scaleMul?, onWater?, overrides?, collider?
export async function spawnKenney(ctx, scene, animated, name, x, z, rot = 0, sMul = 1, onWater = false, overrides, collider) {
  const pack = KENNEY_PACK[name];
  if (!pack) { console.warn('[kenney] unknown model', name); return null; }
  try {
    const obj = await A.loadKenneyModel(packUrl(pack, name), overrides || KENNEY_DRESS_OVERRIDES[name]);
    obj.scale.setScalar((KENNEY_SCALE[pack] || 2) * sMul);
    obj.rotation.y = rot;
    obj.position.set(x, onWater ? WATER_Y - 0.15 : ctx.heightRegistry.groundHeight(x, z), z);
    obj.userData.name = name;
    scene.add(obj);
    propsFootprints.push(footprintOf(obj, name));
    const colliderIds = BOAT_DEFS[name] ? [] : deriveCollider(ctx, obj, name, collider);
    const rec = registerPlacement('kenney', name, obj, colliderIds);
    if (BOAT_DEFS[name]) registerBoat(scene, animated, obj, name, WATER_Y);
    return rec;
  } catch (e) { console.warn(`[kenney] place ${name} failed:`, e.message); return null; }
}
// [name, x, z, rot, scaleMul?, onWater?, overrides?, collider?]
const KENNEY_PLACEMENTS = [
  ['tent', 21, -25, 0.6], ['campfire-pit', 16.5, -28, 0], ['campfire-stand', 15.4, -29.4, 0.3],
  ['bedroll', 23, -23, -0.8], ['bedroll-packed', 24, -24.6, 0.4], ['bucket', 18, -30, 0], ['bottle', 15.4, -29.4, 0, 0.8],
  ['barrel', -12.5, -50.5, 0.2], ['barrel', -10.9, -50.9, 1.1], ['box', -1.6, -43, 0.3],
  ['box-open', 0.3, -42.2, -0.4], ['workbench', -19, -42.5, 1.6], ['workbench-anvil', -20.2, -44.4, 1.2],
  ['workbench-grind', -18.4, -46, 0.4], ['wheel', -17.3, -47.4, 0.5],
  ['fence-doorway', -22.5, -40, 0.0], ['fence', -25, -41.4, 0.0], ['fence', -27.2, -42.8, 0.0],
  ['fence-fortified', -20, -38.4, 0.0],
  ['hedge', -9, -34, 0], ['hedge', -6, -34, 0], ['hedge-gate', -3, -34, 0],
  ['stall-green', -12.5, -39, 1.2], ['stall-bench', -10.8, -37.4, 0.4], ['banner-green', -3, -32.5, 0.2],
  ['signpost', 3, -31, 0.9], ['signpost-single', 22, 28, -2.2], ['lantern', 6.5, -27, 0], ['lantern', 25, 33, 0],
  ['tree-trunk', 35, -30, 0], ['tree-log', 37, -31.2, 1.2], ['tool-axe', 35, -29.3, 0.6],
  ['resource-wood', 33, -32, 0], ['resource-planks', 32, -30.6, 0.5], ['resource-stone', 34.6, -33, 0],
  ['resource-stone-large', 36, -33.6, 0.3],
  ['campfire-fishing-stand', 24, 30, 2.4], ['fish', 25.6, 31, 0.5], ['fish', 26.2, 30, -0.4, 0.8],
  ['boat-row-small', 42, 47, 1.2, 0.75, true],
  ['ship-large', 10.58, 92.91, 1.384, 0.75, true],
  ['boat-fishing-small', 46, 51, 2.0, 1, true],
  ['flag', -52, 58, 0.5],
];

export async function placeKenneyProps(ctx, scene, animated) {
  for (const [n, x, z, rot, sm, w, overrides, collider] of KENNEY_PLACEMENTS) {
    await spawnKenney(ctx, scene, animated, n, x, z, rot || 0, sm || 1, !!w, overrides, collider);
  }
}
