// Grassland World — static object placement: native hamlet/landmark props and
// the Kenney-pack set dressing, plus the bridge (the one landmark you can
// also walk on, so its height math lives here next to its placement). Also
// owns the live placement registry the area designer (editor.js) selects,
// moves, and deletes from.
import * as THREE from 'three';
import * as A from './assets.js';
import { terrainHeight, WATER_Y, groundHeight, registerHeightContributor } from './world.js';
import { BOAT_DEFS, registerBoat, setBridgeSpan } from './boats.js';
import { addCircle, addOBB, removeCollider } from './collision.js';

function fullBox(obj) { return new THREE.Box3().setFromObject(obj); }
function footprintOf(obj, kind) {
  const size = fullBox(obj).getSize(new THREE.Vector3());
  return { kind, x: obj.position.x, z: obj.position.z, r: Math.max(size.x, size.z) / 2, obj };
}

// ================= collider derivation (Brief 4 Part A) =================
// A naive full Box3 inflates on any roof overhang/protrusion the same way a
// tree's canopy radius does (see scatter.js's TREE_TRUNK_RATIO comment for
// the same class of bug) — so the auto-derived footprint comes from a LOW
// SLICE of the actual geometry instead: only vertices within LOW_SLICE_Y of
// the object's own base go into the box. Eaves/roofs/anything above head
// height stop inflating the footprint automatically. One-time cost per
// placement (props are low-poly by the project's own tri budget), not
// per-frame.
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
// name -> {shape:'circle', r} | {shape:'obb', hw, hd} | {shape:'split', circles:[{dx,dz,r}]} | null
// dx/dz on split circles are LOCAL offsets from the object's own origin,
// rotated by its current rotation.y at query time (so a moved/rotated
// instance keeps its pillars in the right place).
// Brief 5: houses get yHigh=Infinity (no roof-walking) — handled as a
// name-based set rather than a COLLIDER_OVERRIDES field, since houses keep
// their normal auto-derived low-slice footprint (hw/hd), only the vertical
// band changes. Deliberately scoped to houses only, not fences/hedges —
// those already have a low, finite yHigh (thin, excluded from standing via
// `standable` below) and giving them Infinity too isn't needed to stop
// roof-walking and would be an unrequested behavior change (Brief 4 made
// them jumpable over).
const NO_ROOF_WALK = new Set(['houseA', 'houseB', 'houseC']);
// standable:false — round/thin/tapered/uneven tops; still collide normally,
// just excluded from supportAt() (a judgment call, cheap to flip once
// tested in-browser).
export const COLLIDER_OVERRIDES = {
  // circles — round objects a bbox-derived OBB would misrepresent
  well: { shape: 'circle', r: 1.1, standable: false }, barrel: { shape: 'circle', r: 0.45, standable: false },
  // the actual watchtower model is a solid tapered cylinder, not separate
  // ground-level legs — one circle at its base radius, not fabricated legs
  watchtower: { shape: 'circle', r: 2.5, standable: false }, windmill: { shape: 'circle', r: 1.8, standable: false },
  lantern: { shape: 'circle', r: 0.25, standable: false }, signpost: { shape: 'circle', r: 0.2, standable: false }, 'signpost-single': { shape: 'circle', r: 0.2, standable: false },
  wheel: { shape: 'circle', r: 0.35, standable: false }, 'tree-log': { shape: 'circle', r: 0.4, standable: false }, 'tree-trunk': { shape: 'circle', r: 0.4, standable: false },
  // thin OBBs — a full bbox would be far too thick to walk close alongside
  fence: { shape: 'obb', hw: 1.0, hd: 0.12, standable: false }, 'fence-fortified': { shape: 'obb', hw: 1.0, hd: 0.12, standable: false },
  hedge: { shape: 'obb', hw: 1.0, hd: 0.3, standable: false },
  // null — walk-over (flat) or walk-through (decorative/small/an opening)
  bedroll: null, 'bedroll-packed': null, 'tool-axe': null, fish: null, flag: null, 'banner-green': null,
  bottle: null, 'resource-wood': null, 'resource-planks': null, 'resource-stone': null,
  'hedge-gate': null, 'fence-doorway': null, // the walkable openings, not the fence/hedge lines themselves
  'boat-row-small': null, 'ship-large': null, 'boat-fishing-small': null, // belt-and-braces — already excluded by kind (no static colliders on boats)
  stoneBridge: null, // handled by two explicit railing OBBs instead (see BRIDGE below) — a full-deck OBB would block the crossing
  // split — an open structure where one blob collider would block the walk-through gap; broken/uneven pillar tops, not standable
  ruinedArch: { shape: 'split', circles: [{ dx: -1.8, dz: 0, r: 0.55 }, { dx: 1.8, dz: 0, r: 0.55 }], standable: false },
};
// explicitOverride (from a placement tuple's optional trailing `collider`
// field) wins over the name-keyed COLLIDER_OVERRIDES table — same shape,
// just a per-instance escape hatch for the rare prop that needs to differ
// from every other instance of the same model.
function deriveCollider(obj, name, explicitOverride) {
  const override = explicitOverride !== undefined ? explicitOverride : (name in COLLIDER_OVERRIDES ? COLLIDER_OVERRIDES[name] : undefined);
  if (override === null) return [];
  const fullSize = fullBox(obj).getSize(new THREE.Vector3());
  // yLow/yHigh: absolute world-Y band for the collider (Part 0 lesson —
  // always this space, never a bare relative number). yHigh=Infinity (no
  // roof-walking) for NO_ROOF_WALK names; otherwise the object's own real
  // top. standable:false in the override, or the NO_ROOF_WALK case, keeps
  // it out of supportAt() even though it still collides normally.
  const yLow = groundHeight(obj.position.x, obj.position.z);
  const noRoofWalk = NO_ROOF_WALK.has(name);
  const yHigh = noRoofWalk ? Infinity : yLow + fullSize.y;
  const standable = !noRoofWalk && override?.standable !== false;
  const live = () => ({ x: obj.position.x, z: obj.position.z, rot: obj.rotation.y });
  const ids = [];
  if (override) {
    if (override.shape === 'circle') {
      ids.push(addCircle(obj.position.x, obj.position.z, override.r, yLow, yHigh, standable, live).id);
    } else if (override.shape === 'obb') {
      ids.push(addOBB(obj.position.x, obj.position.z, override.hw, override.hd, obj.rotation.y, yLow, yHigh, standable, live).id);
    } else if (override.shape === 'split') {
      for (const circ of override.circles) {
        const liveCirc = () => {
          const c = Math.cos(obj.rotation.y), s = Math.sin(obj.rotation.y); // forward local->world, Part 0's verified convention
          return { x: obj.position.x + circ.dx * c + circ.dz * s, z: obj.position.z + (-circ.dx * s + circ.dz * c) };
        };
        const p0 = liveCirc();
        ids.push(addCircle(p0.x, p0.z, circ.r, yLow, yHigh, standable, liveCirc).id);
      }
    }
    return ids;
  }
  // auto-derive: low-slice footprint -> OBB, absolute-capped shrink
  const sliceSize = lowSliceBox(obj).getSize(new THREE.Vector3());
  const hw = shrinkHalf(sliceSize.x), hd = shrinkHalf(sliceSize.z);
  ids.push(addOBB(obj.position.x, obj.position.z, hw, hd, obj.rotation.y, yLow, yHigh, standable, live).id);
  return ids;
}

// ================= live placement registry (area designer) =================
// One entry per placed object; position/rotation/scale are read straight off
// `obj` by consumers (never snapshotted), so moving something in the editor
// can't go stale. `propsFootprints` (below) stays a separate, simpler list —
// groundwork for a future collision pass — kept in sync on add/remove.
export const registry = [];
let _nextId = 1;
function registerPlacement(kind, name, obj, colliderIds) {
  const rec = { id: _nextId++, kind, name, obj, colliderIds: colliderIds || [] };
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
  for (const cid of rec.colliderIds) removeCollider(cid);
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
  // Brief 4 Part 0: this used to pass peak=0.8, a leftover from before the
  // dedup in Brief 1, while the visual mesh (createStoneBridge) uses the
  // default peak=1.5 — a ~0.7-unit gap at deck center that read as sinking to
  // waist height. Walkable surface now matches the visual deck exactly.
  return BRIDGE.y + A.bridgeDeckHeight(lz);
}
registerHeightContributor(bridgeHeight, 'bridge');

// Two thin railing colliders along the deck edges, so GROUND movement can't
// walk off the side mid-span — registered directly (not through
// deriveCollider/COLLIDER_OVERRIDES; stoneBridge is null-overridden there
// precisely so a generic full-deck collider never gets derived on top of
// this).
//
// Brief 5 Part C: measured (Node, against the real terrainHeight/WATER_Y —
// not guessed) where the stream under the bridge actually reads as deep
// water (boats.js's own `afloat` definition: (WATER_Y - terrainHeight) >
// 0.45): local lz in [-3.18, 2.44], asymmetric because the stream bends
// here. The old rails spanned the full visual deck (lz ±6.5, 13 units) and
// blocked both banks; RAIL_LZ_LO/HI below pad that measured gap by 0.5 on
// each side and leave the banks open.
//
// yLow uses the MAXIMUM deck-top height across this span — the true local
// peak at lz=0, which this (now much shorter) span still straddles — NOT
// the minimum. A single OBB only carries one scalar band, and a
// minimum-based yLow lets the rail's own yHigh dip close to (or below) the
// deck surface right at the arch's actual peak, where the real deck is
// tallest: the walker's feetY there sits close to yHigh, eating the
// STEP_UP margin and letting them casually step over what should be a
// barrier (verified by an initial Node table test that failed exactly this
// way at the deck center — caught before committing). Using the max instead
// guarantees yLow is never below the true local deck anywhere in the span,
// so the STEP_UP margin holds everywhere.
// RAIL_RISE must clear two constraints simultaneously: > STEP_UP (0.5) or
// the rail becomes a step-up-able curb instead of a barrier; and low enough
// that a mid-span sideways dive off the deck clears it before the
// character's horizontal position reaches the rail. Checked via kinematics
// (vy=6.0, GRAV=20, DIVE_FWD=6.0, character radius 0.35 reaching the rail's
// inner edge at lx≈1.1): RAIL_RISE=0.6 clears the dive with ~0.16 margin and
// clears STEP_UP with ~0.1 margin — this needs an actual in-game "dive off
// the bridge mid-span" test; lower RAIL_RISE if it doesn't clear.
const RAIL_LZ_LO = -3.68, RAIL_LZ_HI = 2.94;
const RAIL_RISE = 0.6;
{
  const c = Math.cos(BRIDGE.rot), s = Math.sin(BRIDGE.rot);
  const railLzCenter = (RAIL_LZ_LO + RAIL_LZ_HI) / 2, railHd = (RAIL_LZ_HI - RAIL_LZ_LO) / 2;
  const yLow = BRIDGE.y + A.bridgeDeckHeight(0); // the span straddles lz=0, the arch's true peak
  const yHigh = yLow + RAIL_RISE;
  for (const side of [-1, 1]) {
    const lx = side * 1.6;
    const wx = BRIDGE.x + lx * c + railLzCenter * s, wz = BRIDGE.z + (-lx * s + railLzCenter * c); // forward local->world
    addOBB(wx, wz, 0.15, railHd, BRIDGE.rot, yLow, yHigh, false);
  }
}

// Brief 5 Part E: boat clearance under the bridge — independent of the
// character collision system above. WATER_GAP_LZ_LO/HI un-pad RAIL_LZ_LO/HI
// back to the raw measured water-gap (a boat can only ever be where there's
// actually deep water, per updateBoat's own `afloat` check, so the padding
// added for the rail's sideways-egress purpose doesn't apply here).
// DECK_BOTTOM_OFFSET (0.445) comes directly from createStoneBridge's own
// deck geometry (assets.js): a 0.45-tall box centered 0.22 below the deck-
// top formula's return value, so bottom = deckTop - 0.22 - (0.45/2).
//
// clearance is a function of lz, not a single scalar — the arch is tallest
// at its center (lz=0) and lowest at the water-gap's own edges. An earlier
// version used the single worst-case (lowest) value across the whole gap,
// which blocked a boat everywhere in the span, including dead center where
// there's actually plenty of headroom — exactly backwards from what you'd
// want (some clipping right at the low edges is fine; blocking the highest,
// most-open point is not). clearanceAt(lz) is measured from the real deck
// formula at the boat's own position instead.
const WATER_GAP_LZ_LO = RAIL_LZ_LO + 0.5, WATER_GAP_LZ_HI = RAIL_LZ_HI - 0.5;
const DECK_BOTTOM_OFFSET = 0.445;
const clearanceAt = lz => BRIDGE.y + A.bridgeDeckHeight(lz) - DECK_BOTTOM_OFFSET;
setBridgeSpan({ x: BRIDGE.x, z: BRIDGE.z, rot: BRIDGE.rot, hw: 1.7, lzLo: WATER_GAP_LZ_LO, lzHi: WATER_GAP_LZ_HI, clearanceAt });

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
// [catalogName, x, z, rot, y?, collider?] — collider overrides COLLIDER_OVERRIDES for this instance only
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

export function spawnNative(scene, animated, name, x, z, rot = 0, y, collider) {
  const make = NATIVE_CATALOG[name];
  if (!make) { console.warn('[props] unknown native prop', name); return null; }
  const obj = make();
  obj.position.set(x, y !== undefined ? y : terrainHeight(x, z), z);
  obj.rotation.y = rot;
  scene.add(obj);
  if (obj.userData.blades) animated.push(dt => { obj.userData.blades.rotation.z += dt * 0.7; });
  propsFootprints.push(footprintOf(obj, NATIVE_KIND[name] || name));
  const colliderIds = deriveCollider(obj, name, collider);
  return registerPlacement('native', name, obj, colliderIds);
}

export function placeNativeProps(scene, animated) {
  for (const [name, x, z, rot, y, collider] of NATIVE_PLACEMENTS) spawnNative(scene, animated, name, x, z, rot || 0, y, collider);
}

// ================= Kenney set dressing =================
// Curated shortlist placed into the world in themed vignettes, all through the
// recolor pipeline. Kenney survival-kit is authored ~half native scale, so it
// gets a big multiplier to read at world scale next to the 1.7u character.
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
// name, x, z, rot, scaleMul?, onWater?, overrides?, collider? — overrides (if
// given) wins over KENNEY_DRESS_OVERRIDES[name]; used for per-instance
// area-designer recolors. collider (if given) wins over COLLIDER_OVERRIDES[name].
export async function spawnKenney(scene, animated, name, x, z, rot = 0, sMul = 1, onWater = false, overrides, collider) {
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
    // no static colliders on boats — deck walking is height-contributor-only
    // (structural guarantee via BOAT_DEFS, on top of the belt-and-braces null
    // overrides in COLLIDER_OVERRIDES)
    const colliderIds = BOAT_DEFS[name] ? [] : deriveCollider(obj, name, collider);
    const rec = registerPlacement('kenney', name, obj, colliderIds);
    if (BOAT_DEFS[name]) registerBoat(scene, animated, obj, name);
    return rec;
  } catch (e) { console.warn(`[kenney] place ${name} failed:`, e.message); return null; }
}
// [name, x, z, rot, scaleMul?, onWater?, overrides?, collider?]
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
  ['boat-row-small', 42, 47, 1.2, 0.75, true], 
  ['ship-large', 10.58, 92.91, 1.384, 0.75, true],
  ['boat-fishing-small', 46, 51, 2.0, 1, true],
  // castle flag at the watchtower
  ['flag', -52, 58, 0.5],
];

export async function placeKenneyProps(scene, animated) {
  for (const [n, x, z, rot, sm, w, overrides, collider] of KENNEY_PLACEMENTS) {
    await spawnKenney(scene, animated, n, x, z, rot || 0, sm || 1, !!w, overrides, collider);
  }
}
