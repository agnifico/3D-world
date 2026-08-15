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
import { loadCatalogue, resolveAsset } from './catalogue.js';
import { loadTintedTemplate } from './gltf-assets.js';

let _gltfLoader = null;
// Loads and places a boat GLB at (x,z,rot), then registers it exactly like a
// zone's own initial boat placement — used by the shell after a boat-borne
// portal crossing to re-create "the same kind" of boat in the destination
// zone (not the same object instance, per the addendum). Uses a plain
// GLTFLoader rather than a zone's own recolor/vertex-bake pipeline: this is
// a rare, one-off spawn (a portal crossing), not worth a cross-zone
// dependency on one particular zone's asset-loading internals.
export async function spawnBoatAt(scene, animated, name, x, z, rot, waterY, instanceId, scale) {
  const def = BOAT_DEFS[name];
  if (!def) { console.warn(`[boats] unknown boat "${name}"`); return null; }
  if (!def.catalogueId) { console.warn(`[boats] "${name}" has no catalogueId — cannot spawn`); return null; }
  const manifest = await loadCatalogue();
  const resolved = resolveAsset(manifest, def.catalogueId);
  if (!resolved) { console.warn(`[boats] "${name}": catalogue id ${def.catalogueId} not found`); return null; }
  const template = await loadTintedTemplate(resolved.url, null, resolved.policy);
  const obj = template.clone(true);
  obj.scale.setScalar((scale ?? def.crossScale ?? 1) * resolved.policy.scaleFactor);
  obj.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  obj.rotation.y = rot;
  obj.position.set(x, waterY - 0.15, z);
  scene.add(obj);
  return registerBoat(scene, animated, obj, name, waterY, instanceId);
}

// disembark: 'step' = climb down onto the surface with the step-out clip (no
// jump); 'leap' = a single ballistic hop using the running-jump clip.
// deckOffset/deckInset define the WALKABLE deck surface (see boatHeight) —
// tune deckOffset up/down so feet sit on the visible floor for each boat.
export const BOAT_DEFS = {
  // 'boat-row-small': { label: 'Board the rowboat', sitClip: 'sitRow', seatAlong: -1.37, seatUp: .39, faceOffset: 0, turn: 3, accel: 3.0, maxSpeed: 10, fwdSign: 1, paddles: true, rowAmp: 0.5, disembark: 'leap', deckOffset: 0.42, deckInset: 0.6 },
  // 'ship-large': { label: 'Board the galleon', sitClip: 'sitRow', seatAlong: -5.3, seatUp: 2.95, faceOffset: Math.PI, turn: 1, accel: 1.0, maxSpeed: 25, fwdSign: 1, paddles: true, rowAmp: 0.5, disembark: 'leap', deckOffset: 0.42, deckInset: 0.6 },
  // 'boat-fishing-small': { label: 'Board the fishing boat', sitClip: 'sitFish', seatAlong: -2.4, seatUp: 1.35, faceOffset: Math.PI / 2, turn: 2, accel: 2.0, maxSpeed: 18, fwdSign: 1, smoke: true, disembark: 'leap', deckOffset: 0.7, deckInset: 0.5 },
  xiriya: { label: 'Board the Xiriya', singleton: true, sitClip: 'idle', seatAlong: -8.0, seatUp: 4.85, faceOffset: 0, turn: 1.2, accel: 1.4, maxSpeed: 40, fwdSign: 1, disembark: 'leap', deckOffset: 2.4, deckInset: 0.45, catalogueId: 'pirates::Xiriya:normal:alive:', crossScale: 1.37 },
  rowboat: { label: 'Board the rowboat', sitClip: 'sitRow', seatAlong: .8, seatUp: .35, faceOffset: Math.PI, turn: 3, accel: 3.0, maxSpeed: 30, fwdSign: 1, paddles: true, rowAmp: 0.5, disembark: 'leap', deckOffset: 0.42, deckInset: 0.6, catalogueId: 'kenney-models::boat-row-small:normal:alive:', crossScale: .75 },
  fishing: { label: 'Board the fishing boat', sitClip: 'sitFish', seatAlong: -1.7, seatUp: 1.2, faceOffset: Math.PI / 2, turn: 2, accel: 2.0, maxSpeed: 18, fwdSign: 1, smoke: true, disembark: 'leap', deckOffset: 0.7, deckInset: 0.5, catalogueId: 'kenney-models::boat-fishing-small:normal:alive:', crossScale: 1 },
};


export const FISH_SMOKE = { along: 1.1, side: 0.45, up: 1.95 };

export const boats = [];
// World edge for boat travel, set per zone by the shell (main.js's loadZone).
// Boats are shared across zones, so this can't be a constant: open-sea is the
// first non-square, non-100-extent map, and the old hardcoded 94 pinned a boat
// in place anywhere past |94| (rotation still applied, so it read as "the boat
// spins but won't move"). Defaults reproduce the old value for a 100-extent
// zone, so a caller that never sets them behaves as before.
let _boundX = 100, _boundZ = 100;
export function setWorldBounds(extentX, extentZ) {
  _boundX = extentX - 0; _boundZ = extentZ - 0; // same 6-unit margin the old 94 kept off a 100 extent
}
// Real water surface (height + slope) for the active zone, pushed in by the
// shell (main.js's loadZone) same as setWorldBounds above. A zone with a flat
// plane (every zone but open-sea) never calls this, so boats keep floating
// at the flat waterY — only open-sea's live swell drives it.
let _surfaceAt = null, _surfaceNormalAt = null;
export function setSurfaceProvider(heightFn, normalFn) {
  _surfaceAt = heightFn || null;
  _surfaceNormalAt = normalFn || null;
}
// ── Persistent fleet (survives resetBoats / zone rebuilds) ────────────────
// One entry per boardable instance, keyed by its edits.js placement id.
// A boat exists exactly ONCE across the whole world; a zone spawns only the
// instances whose curZone == that zone. This is what kills cross-rebuild
// duplication (the old boat-identity bug) at the root.
const _fleet = new Map(); // instanceId -> { boatClass, homeZone, curZone, x, z, heading, scale }

// Register a boardable placement into the fleet the first time its home zone
// builds. Idempotent: re-entering the home zone finds the existing entry and
// leaves its (possibly-elsewhere) location untouched.
export function registerFleetBoat(instanceId, boatClass, homeZone, x, z, heading, scale) {
  if (_fleet.has(instanceId)) return _fleet.get(instanceId);
  const f = { boatClass, homeZone, curZone: homeZone, x, z, heading: heading || 0, scale: scale ?? 1, _homeX: x, _homeZ: z };
  _fleet.set(instanceId, f);
  return f;
}

// Spawn every fleet boat currently located in `zoneId`. Called once per zone
// build (from applyEdits, after placed[] is processed). Handles BOTH the
// home mooring and any boat that sailed in — same path.
export async function spawnFleetForZone(scene, animated, zoneId, waterY) {
  for (const [instanceId, f] of _fleet) {
    if (f.curZone !== zoneId) continue;
    await spawnBoatAt(scene, animated, f.boatClass, f.x, f.z, f.heading, waterY, instanceId, f.scale);
  }
}

// Update an instance's location — called by the crossing (new zone) and by
// disembark (park in place), so a boat is always re-spawned where you left it.
export function setFleetLocation(instanceId, zoneId, x, z, heading) {
  const f = _fleet.get(instanceId);
  if (!f) return;
  f.curZone = zoneId; f.x = x; f.z = z; f.heading = heading ?? f.heading;
}
export function getFleetEntry(instanceId) { return _fleet.get(instanceId); }

// Escape hatch (dev now; the grassland dock will call this later): send every
// boat back to its home mooring. Only affects the persistent record — the
// visible boat updates on the next build of the relevant zones.
export function recallAllBoats() {
  for (const f of _fleet.values()) { f.curZone = f.homeZone; f.x = f._homeX ?? f.x; f.z = f._homeZ ?? f.z; }
  return `recalled ${_fleet.size} boat(s) to home moorings`;
}
window.recall = recallAllBoats;
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
export function registerBoat(scene, animated, obj, name, waterY, instanceId) {
  const def = BOAT_DEFS[name];
  const b = { obj, name, instanceId: instanceId ?? null, def, waterY, rowPhase: 0, ridden: false, heading: 0, speed: 0 };
  if (def.paddles) b.paddles = obj.getObjectByName('paddles');
  boats.push(b);
  obj.rotation.x = 0; obj.rotation.z = 0;
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

window.__seatTune = (name, { seatAlong, seatUp, faceOffset } = {}) => {
  const def = BOAT_DEFS[name];
  if (!def) return `unknown boat "${name}"`;
  if (seatAlong !== undefined) def.seatAlong = seatAlong;
  if (seatUp !== undefined) def.seatUp = seatUp;
  if (faceOffset !== undefined) def.faceOffset = faceOffset;
  return { name, seatAlong: def.seatAlong, seatUp: def.seatUp, faceOffset: def.faceOffset };
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

// ─────────── TEMP DIAGNOSTIC (hull-not-rendering) — REVERT ───────────
const _hex = (c) => { try { return '#' + c.getHexString(); } catch { return null; } };
const _nextFrames = (n) => new Promise(res => {
  let i = 0;
  const step = () => (++i >= n ? res() : requestAnimationFrame(step));
  requestAnimationFrame(step);
});
window.__boatDump = async function (which) {
  const b = which ?? boats.find(x => x.ridden) ?? boats[0];
  if (!b) return { error: 'no boat in boats[]' };
  const obj = b.obj;
  const renderer = window.__renderer;
  const zone = window.__currentZone && window.__currentZone();

  // ── parent chain ──
  const chain = [];
  for (let n = obj; n; n = n.parent) {
    n.updateMatrixWorld && n.updateMatrixWorld(false);
    const ws = new THREE.Vector3();
    n.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), ws);
    chain.push({
      type: n.type, name: n.name || '(unnamed)', visible: n.visible,
      layers: n.layers.mask,
      localScale: [+n.scale.x.toFixed(4), +n.scale.y.toFixed(4), +n.scale.z.toFixed(4)],
      worldScale: [+ws.x.toFixed(4), +ws.y.toFixed(4), +ws.z.toFixed(4)],
      isScene: !!n.isScene,
    });
  }
  const inSceneGraph = chain[chain.length - 1].isScene;

  // ── box3 ──
  const box = new THREE.Box3().setFromObject(obj);
  const f3 = (v) => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];

  // ── meshes + materials ──
  const meshes = [];
  const matSeen = new Set();
  obj.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    meshes.push({
      name: o.name || '(unnamed)', visible: o.visible, frustumCulled: o.frustumCulled,
      renderOrder: o.renderOrder, layers: o.layers.mask,
      posCount: o.geometry?.attributes?.position?.count ?? null,
      posArrayLen: o.geometry?.attributes?.position?.array?.length ?? null,
      index: o.geometry?.index?.count ?? null,
      geoUUID: o.geometry?.uuid?.slice(0, 8),
      drawRange: o.geometry ? `${o.geometry.drawRange.start}..${o.geometry.drawRange.count}` : null,
      geoBoundingSphereR: o.geometry?.boundingSphere ? +o.geometry.boundingSphere.radius.toFixed(3) : 'null(unset)',
      mats: mats.map(m => {
        if (!m) return null;
        const props = renderer?.properties?.get?.(m);
        const rec = {
          uuid: m.uuid.slice(0, 8), type: m.type, name: m.name || '(unnamed)',
          color: m.color ? _hex(m.color) : null,
          opacity: m.opacity, transparent: m.transparent, visible: m.visible,
          depthTest: m.depthTest, depthWrite: m.depthWrite, colorWrite: m.colorWrite,
          side: m.side, wireframe: !!m.wireframe, alphaTest: m.alphaTest,
          fog: m.fog, needsUpdate: m.version,
          map: m.map ? { uuid: m.map.uuid.slice(0, 8), img: !!m.map.source?.data, ver: m.map.version } : null,
          // "is it live in the renderer": a compiled program means the renderer
          // has actually seen and set this material up this session.
          hasProgram: !!(props && props.currentProgram),
          firstDump: !matSeen.has(m.uuid),
        };
        matSeen.add(m.uuid);
        return rec;
      }),
    });
  });

  // ── triangles before/after toggling obj.visible ──
  const wasVisible = obj.visible;
  obj.visible = true;  await _nextFrames(3);
  const triVisible = renderer ? renderer.info.render.triangles : null;
  const callsVisible = renderer ? renderer.info.render.calls : null;
  obj.visible = false; await _nextFrames(3);
  const triHidden = renderer ? renderer.info.render.triangles : null;
  const callsHidden = renderer ? renderer.info.render.calls : null;
  obj.visible = wasVisible; await _nextFrames(2);

  const cam = window.__camera;
  return {
    zone: zone?.id, ridden: b.ridden, boatName: b.name, instanceId: b.instanceId,
    obj: {
      position: f3(obj.position), scale: f3(obj.scale), visible: obj.visible,
      rotationY: +obj.rotation.y.toFixed(3), uuid: obj.uuid.slice(0, 8),
      childCount: obj.children.length, meshCount: meshes.length,
    },
    parentChain: chain,
    inSceneGraph,
    box3: box.isEmpty() ? 'EMPTY' : { min: f3(box.min), max: f3(box.max), size: f3(box.getSize(new THREE.Vector3())) },
    meshes,
    render: {
      triWithBoatVisible: triVisible, triWithBoatHidden: triHidden,
      deltaTriangles: (triVisible !== null && triHidden !== null) ? triVisible - triHidden : null,
      callsVisible, callsHidden, deltaCalls: callsVisible - callsHidden,
      geometriesInMemory: renderer?.info.memory.geometries,
      texturesInMemory: renderer?.info.memory.textures,
      programs: renderer?.info.programs?.length,
    },
    world: {
      WATER_Y: zone?.WATER_Y, boatWaterY: b.waterY,
      terrainHeightUnderBoat: zone?.terrainHeight ? +zone.terrainHeight(obj.position.x, obj.position.z).toFixed(3) : null,
      deckY: b.deckY, airDraft: b.airDraft !== undefined ? +b.airDraft.toFixed(3) : null,
    },
    renderer: {
      clippingPlanes: renderer?.clippingPlanes?.length ?? 'n/a',
      localClippingEnabled: renderer?.localClippingEnabled ?? 'n/a',
      currentRenderTarget: renderer?.getRenderTarget?.() ? 'SET' : 'null(default framebuffer)',
      renderFnPatched: renderer ? renderer.render.name !== 'render' : null,
      usesBloomComposer: zone?.usesBloomComposer !== false,
      toneMapping: renderer?.toneMapping, outputColorSpace: renderer?.outputColorSpace,
    },
    camera: cam ? {
      layersMask: cam.layers.mask, near: cam.near, far: cam.far,
      position: f3(cam.position),
      distToBoat: +cam.position.distanceTo(obj.position).toFixed(2),
    } : 'no __camera hook',
    fog: window.__scene?.fog ? { type: window.__scene.fog.type, near: window.__scene.fog.near, far: window.__scene.fog.far, color: _hex(window.__scene.fog.color) } : null,
  };
};
// ───────────────────── END TEMP DIAGNOSTIC ─────────────────────

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
  else if (Math.abs(nx) < _boundX && Math.abs(nz) < _boundZ && afloat) { o.position.x = nx; o.position.z = nz; }
  else b.speed *= 0.25;                          // stall against the shallows
  o.rotation.y = b.heading;

  // Ride the real surface: flat waterY everywhere but open-sea, whose live
  // swell drives both the float height and the deck's pitch/roll.
  const surf = _surfaceAt ? _surfaceAt(o.position.x, o.position.z) : b.waterY;
  o.position.y = surf - 0.15 + Math.sin(bobT * 1.2) * 0.05;
  const cosmeticRoll = Math.sin(bobT * 0.9) * 0.02; // kept as a floor so flat-water zones still look alive
  const n = _surfaceNormalAt ? _surfaceNormalAt(o.position.x, o.position.z) : null;
  const damp = Math.min(1, dt * 3);
  if (n) {
    const hs = Math.sin(b.heading), hc = Math.cos(b.heading);
    const slopeFwd = n.x * hs + n.z * hc;   // surface slope along the boat's heading -> pitch
    const slopeSide = n.x * hc - n.z * hs;  // surface slope across the boat's heading -> roll
    o.rotation.x += (slopeFwd * 0.6 - o.rotation.x) * damp;
    o.rotation.z += (-slopeSide * 0.6 + cosmeticRoll - o.rotation.z) * damp;
  } else {
    o.rotation.x += (0 - o.rotation.x) * damp;
    o.rotation.z = cosmeticRoll;
  }
  // deckY tracks the swell too — stale once-computed deckY reads as feet
  // sinking through the floor as the hull rides a crest or trough.
  b.deckY = o.position.y + (d.deckOffset ?? 0.4);

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
