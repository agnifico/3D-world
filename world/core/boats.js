// World Shell — boats: definitions, placement registration, the walkable
// (non-ridden) deck height contributor, drive physics, and chimney smoke.
// Shared across zones (per the addendum: both Grassland and Lagoon need to
// spawn the same kinds of boats — a boat that crosses a portal is re-created
// in the destination zone as the same *kind*, not the same object instance).
// Boarding/disembarking mutate character state, so those live in
// character/controller.js; it registers a board handler here so this module
// never reaches into the character controller's internals.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as Interactables from './interactables.js';

let _gltfLoader = null;
// Loads and places a boat GLB at (x,z,rot), then registers it exactly like a
// zone's own initial boat placement — used by the shell after a boat-borne
// portal crossing to re-create "the same kind" of boat in the destination
// zone (not the same object instance, per the addendum). Uses a plain
// GLTFLoader rather than a zone's own recolor/vertex-bake pipeline: this is
// a rare, one-off spawn (a portal crossing), not worth a cross-zone
// dependency on one particular zone's asset-loading internals.
export async function spawnBoatAt(scene, animated, name, x, z, rot, waterY) {
  const def = BOAT_DEFS[name];
  if (!def) { console.warn(`[boats] unknown boat "${name}"`); return null; }
  _gltfLoader ||= new GLTFLoader();
  const gltf = await _gltfLoader.loadAsync(`assets/kenney/watercraft-pack/${name}.glb`);
  const obj = gltf.scene;
  obj.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  obj.rotation.y = rot;
  obj.position.set(x, waterY - 0.15, z);
  scene.add(obj);
  return registerBoat(scene, animated, obj, name, waterY);
}

// disembark: 'step' = climb down onto the surface with the step-out clip (no
// jump); 'leap' = a single ballistic hop using the running-jump clip.
// deckOffset/deckInset define the WALKABLE deck surface (see boatHeight) —
// tune deckOffset up/down so feet sit on the visible floor for each boat.
export const BOAT_DEFS = {
  'boat-row-small':     { label: 'Board the rowboat',      sitClip: 'sitRow',  seatAlong: -1.37,  seatUp: .39, faceOffset: 0,        turn: 3, accel: 3.0, maxSpeed: 10, fwdSign: 1, paddles: true, rowAmp: 0.5, disembark: 'leap', deckOffset: 0.42, deckInset: 0.6 },
  'ship-large':     { label: 'Board the galleon',      sitClip: 'idle',  seatAlong: -5.5,  seatUp: 4.5, faceOffset: Math.PI/2,        turn: 1, accel: 5.0, maxSpeed: 20, fwdSign: 1, paddles: true, rowAmp: 0.5, disembark: 'leap', deckOffset: 0.42, deckInset: 0.6 },
  'boat-fishing-small': { label: 'Board the fishing boat', sitClip: 'sitFish', seatAlong: -2.4, seatUp: 1.35, faceOffset: Math.PI/2, turn: 2, accel: 2.0, maxSpeed: 18, fwdSign: 1, smoke: true, disembark: 'leap', deckOffset: 0.7, deckInset: 0.5 },
};
export const FISH_SMOKE = { along: 1.1, side: 0.45, up: 1.95 };

export const boats = [];
let _boardHandler = null;
export function setBoardHandler(fn) { _boardHandler = fn; }

// Optional bridge-clearance hook, pushed in by a zone's own bridge geometry
// (only Grassland has one today) — this module stays generic (a
// local-transform + bounds check), the caller supplies the specifics. span =
// { x, z, rot, hw, lzLo, lzHi, clearanceAt } — hw/lzLo/lzHi define the local
// footprint a boat's position is tested against; clearanceAt(lz) returns the
// measured absolute world-Y of the deck's underside AT that specific point
// along the span.
let _bridgeSpan = null;
export function setBridgeSpan(span) { _bridgeSpan = span; }
// airDraft is measured from a Box3 that includes everything on the boat
// (rigging, raised paddles, etc.), which reads stricter than what actually
// needs to duck under the arch — a small tolerance so the smallest boat
// isn't blocked by its own margin of measurement error.
const BRIDGE_CLEARANCE_MARGIN = 0.3;
// Lowest of the three seeded interaction priorities (see core/interactables.js)
// — matches the prior hardcoded behavior where disembarking always beat
// boarding a different nearby boat while already riding one.
const BOARD_PRIORITY = 10;

function isDescendant(root, node) {
  for (let n = node; n; n = n.parent) if (n === root) return true;
  return false;
}
// waterY: the active zone's WATER_Y — boats are shared, but each zone
// defines its own water level, so this is passed in rather than imported
// from one zone's module.
export function registerBoat(scene, animated, obj, name, waterY) {
  const def = BOAT_DEFS[name];
  const b = { obj, name, def, waterY, rowPhase: 0, ridden: false, heading: 0, speed: 0 };
  if (def.paddles) b.paddles = obj.getObjectByName('paddles');
  boats.push(b);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  // Walkable deck: a flat surface inset from the hull, a little above the base,
  // folded into groundHeight so you can board on foot and stand like on the bridge.
  b.deckY = obj.position.y + (def.deckOffset ?? 0.4);
  b.deckHalf = { x: size.x * 0.5 * (def.deckInset ?? 0.6), z: size.z * 0.5 * (def.deckInset ?? 0.6) };
  // airDraft — tallest point above the waterline, MEASURED from the loaded
  // mesh's own Box3 (not hand-guessed). Boats spawn at waterY-0.15 and float
  // there continuously (see updateBoat below), so that's the correct
  // waterline reference regardless of the object's exact spawn Y. Excludes
  // the paddles subtree (if any): oars swing well above the hull at rest and
  // would gate bridge clearance on rigging that isn't actually part of the
  // hull passing under the arch.
  const hullBox = new THREE.Box3();
  obj.traverse(o => { if (o.isMesh && !(b.paddles && isDescendant(b.paddles, o))) hullBox.expandByObject(o); });
  const hullMaxY = hullBox.isEmpty() ? box.max.y : hullBox.max.y;
  b.airDraft = hullMaxY - (waterY - 0.15);
  const boardRadius = Math.max(size.x, size.z) * 0.5 + 1.8;
  const distToBoat = (character) => Math.hypot(character.position.x - obj.position.x, character.position.z - obj.position.z);
  Interactables.register({
    id: `board-${name}-${b.obj.id}`,
    priority: BOARD_PRIORITY,
    inRange: (character) => !b.ridden && distToBoat(character) < boardRadius,
    distanceTo: distToBoat,
    label: () => def.label,
    key: 'KeyE',
    onActivate: () => _boardHandler && _boardHandler(b),
  });
  if (def.smoke) {
    const smoke = makeChimneySmoke();
    scene.add(smoke);
    b.smoke = smoke;
    animated.push(dt => updateSmoke(smoke, b, dt));
  }
  return b;
}

// A non-ridden boat's deck reads as ground (like the bridge) so you can climb
// aboard on foot and walk around; the ridden boat is driven by the seat logic.
// Register with a zone's height registry as `ctx.heightRegistry.register(boatHeight, 'boat')`.
export function boatHeight(x, z) {
  let best = -Infinity;
  for (const b of boats) {
    if (b.ridden || b.deckY === undefined) continue;
    const dx = x - b.obj.position.x, dz = z - b.obj.position.z;
    const c = Math.cos(b.obj.rotation.y), s = Math.sin(b.obj.rotation.y);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < b.deckHalf.x && Math.abs(lz) < b.deckHalf.z) best = Math.max(best, b.deckY);
  }
  return best;
}

// Live deck calibration — deckOffset/deckInset are hand-tuned per boat
// against the loaded GLB's visual floor. window.__deckTune('boat-row-small',
// { deckOffset: 0.5, deckInset: 0.8 }) adjusts every currently-placed boat of
// that name live (re-deriving deckY/deckHalf), so the right numbers can be
// found by eye and then copied into BOAT_DEFS above as the permanent fix.
window.__deckTune = (name, { deckOffset, deckInset } = {}) => {
  const def = BOAT_DEFS[name];
  if (!def) return `unknown boat "${name}"`;
  if (deckOffset !== undefined) def.deckOffset = deckOffset;
  if (deckInset !== undefined) def.deckInset = deckInset;
  let n = 0;
  for (const b of boats) {
    if (b.name !== name) continue;
    const size = new THREE.Box3().setFromObject(b.obj).getSize(new THREE.Vector3());
    b.deckY = b.obj.position.y + (def.deckOffset ?? 0.4);
    b.deckHalf = { x: size.x * 0.5 * (def.deckInset ?? 0.6), z: size.z * 0.5 * (def.deckInset ?? 0.6) };
    n++;
  }
  return { name, deckOffset: def.deckOffset, deckInset: def.deckInset, updated: n };
};

// console/debug hook — exact measured numbers for the bridge-clearance
// check, since none of this (loaded GLB geometry) can be measured in Node.
window.__boatDraft = () => boats.map(b => {
  const center = _bridgeSpan ? _bridgeSpan.clearanceAt(0) : null;
  const edge = _bridgeSpan ? Math.min(_bridgeSpan.clearanceAt(_bridgeSpan.lzLo), _bridgeSpan.clearanceAt(_bridgeSpan.lzHi)) : null;
  return {
    name: b.name,
    airDraft: +b.airDraft.toFixed(3),
    clearanceAtCenter: center !== null ? +center.toFixed(3) : null,
    clearanceAtEdge: edge !== null ? +edge.toFixed(3) : null,
    marginedThresholdAtCenter: center !== null ? +(center + BRIDGE_CLEARANCE_MARGIN).toFixed(3) : null,
    clearsAtCenter: center !== null ? b.airDraft <= center + BRIDGE_CLEARANCE_MARGIN : null,
    clearsAtEdge: edge !== null ? b.airDraft <= edge + BRIDGE_CLEARANCE_MARGIN : null,
  };
});

let bobT = 0;
export function updateBoat(dt, b, keys, char, terrainHeightFn) {
  const d = b.def, o = b.obj;
  bobT += dt;
  const fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const turn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
  const speedFrac = Math.min(1, Math.abs(b.speed) / d.maxSpeed);
  b.heading += turn * d.turn * dt * (0.45 + 0.55 * speedFrac);
  const target = fwd * d.maxSpeed * d.fwdSign;
  b.speed += (target - b.speed) * Math.min(1, dt * d.accel);
  b.speed *= (1 - dt * 0.5);                     // water drag
  const nx = o.position.x + Math.sin(b.heading) * b.speed * dt;
  const nz = o.position.z + Math.cos(b.heading) * b.speed * dt;
  const afloat = (b.waterY - terrainHeightFn(nx, nz)) > 0.45;
  // too-tall-for-the-bridge check — same push-out spirit as resolveMovement
  // (block the attempted move, don't teleport/clip), applied to the boat's
  // own position instead of the character's.
  let bridgeBlocked = false;
  if (_bridgeSpan) {
    const dx = nx - _bridgeSpan.x, dz = nz - _bridgeSpan.z;
    const c = Math.cos(_bridgeSpan.rot), s = Math.sin(_bridgeSpan.rot);
    const lx = dx * c - dz * s, lz = dx * s + dz * c; // world -> local
    if (Math.abs(lx) < _bridgeSpan.hw && lz > _bridgeSpan.lzLo && lz < _bridgeSpan.lzHi) {
      const localClearance = _bridgeSpan.clearanceAt(lz);
      if (b.airDraft > localClearance + BRIDGE_CLEARANCE_MARGIN) bridgeBlocked = true;
    }
  }
  b.bridgeBlocked = bridgeBlocked;
  if (bridgeBlocked) { b.speed *= 0.25; }
  else if (Math.abs(nx) < 94 && Math.abs(nz) < 94 && afloat) { o.position.x = nx; o.position.z = nz; }
  else b.speed *= 0.25;                          // stall against the shallows
  o.rotation.y = b.heading;
  o.position.y = (b.waterY - 0.15) + Math.sin(bobT * 1.2) * 0.05;
  o.rotation.z = Math.sin(bobT * 0.9) * 0.02;      // gentle roll
  char.position.set(
    o.position.x + Math.sin(b.heading) * d.seatAlong,
    o.position.y + d.seatUp,
    o.position.z + Math.cos(b.heading) * d.seatAlong
  );
  char.rotation.y = b.heading + d.faceOffset;
  if (b.paddles) {                                  // both oars sweep together, paced by speed
    const active = Math.abs(b.speed) > 0.12;
    b.rowPhase += dt * (2.5 + 6 * speedFrac);
    b.paddles.rotation.x = Math.sin(b.rowPhase) * (active ? d.rowAmp : d.rowAmp * 0.24);
  }
}

function makeChimneySmoke() {
  const g = new THREE.Group();
  g.userData.puffs = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.16, 0),
      new THREE.MeshLambertMaterial({ color: 0xdedcd2, transparent: true, flatShading: true })
    );
    g.add(m);
    g.userData.puffs.push({ m, life: i / 6, spin: Math.random() * 6, dx: (Math.random() - .5) * .3, dz: (Math.random() - .5) * .3 });
  }
  return g;
}
function updateSmoke(g, b, dt) {
  const o = b.obj, h = o.rotation.y;
  const cx = o.position.x + Math.sin(h) * FISH_SMOKE.along + Math.cos(h) * FISH_SMOKE.side;
  const cz = o.position.z + Math.cos(h) * FISH_SMOKE.along - Math.sin(h) * FISH_SMOKE.side;
  const cy = o.position.y + FISH_SMOKE.up;
  for (const p of g.userData.puffs) {
    p.life += dt * 0.32;
    if (p.life > 1) p.life -= 1;
    const e = p.life;
    p.m.position.set(cx + p.dx * e * 3, cy + e * 1.7, cz + p.dz * e * 3);
    p.m.scale.setScalar(0.4 + e * 1.5);
    p.m.rotation.y = p.spin + e * 2;
    p.m.material.opacity = Math.max(0, 0.7 * (1 - e));
  }
}

// Called by the shell right before building a new zone (alongside the
// height/collision registry resets) — otherwise a disposed zone's boats
// (pointing at freed geometry) would linger here and get scanned/rendered
// after the zone that owned them is gone.
export function resetBoats() {
  boats.length = 0;
  _bridgeSpan = null;
}
