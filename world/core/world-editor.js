// World Shell — World Editor (Layer 4), the engine: zone-agnostic edit mode
// over whatever zone is currently active. Select/move/rotate/scale
// placed[] catalogue props (core/world-edits.js's registry — Phase 4 adds
// scatter-instance selection on top of the same selection/gizmo plumbing),
// place new ones from a catalogue picker (world-editor-panel.js), duplicate/
// delete/lock, save back to edits.js.
//
// Lazy-loaded: main.js only `import()`s this module on the first toggle
// press, not a static top-level import — the tool stays out of the normal
// game's load path until actually invoked. Memory-stable across open/close
// (gallery-style swap, per PROJECT-STATE.md's Gallery v3 verification
// discipline): openEditor()/closeEditor() are meant to be called any number
// of times back-to-back with no growth — every listener uses this module's
// OWN AbortController (dropped in one shot on close), and the only THREE
// object this module itself creates (the TransformControls helper) is
// explicitly removed from the scene on close. It never disposes the zone's
// OWN placed objects — those belong to the zone and are freed by the
// zone's own dispose() on a real zone change (main.js also force-closes
// this editor on every zone change, since a stale selection pointing at a
// disposed object would be worse than just closing).
//
// Independent of the character controller's own listeners — gameplay
// (WASD/camera/Space/E) keeps working while open, same philosophy as
// grassland/editor.js's own Area Designer; left-click is unused by
// gameplay, so click-to-select/click-to-place don't collide with anything.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
  getPlacedRegistry, removePlacedObject, addPlacedObject, duplicatePlacedObject,
  rebuildPlacedObject, serializePlaced, genPlacedId, getEditsModule,
} from './world-edits.js';
import { getScatterMeshes, resolveScatterHit, getSiblingMeshes, getScatterMeshesForFamily } from './scatter-registry.js';
import { registerColliders } from './colliders.js';
import { COLLIDER_SPECS } from './collider-catalogue.js';

let deps = null; // { scene, camera, domElement, animated, renderer, zone, getChar, collisionRegistry, heightRegistry }
let open = false;
let abortCtl = null;
let raycaster = null, transform = null;
let selected = null; // a getPlacedRegistry() record, or null
let selectedScatter = null; // { id, family, mesh, index } or null — mutually exclusive with `selected`
let groundSnap = true;
let armedPlacement = null; // { catalogueId, variant } while a catalogue-picker "Place" is waiting for the next canvas click
let onChange = null; // world-editor-panel.js subscribes here to re-render on any state change
let dirty = false; // any live edit since open() or the last Save — the top bar's unsaved dot
let onDirtyChange = null; // separate from onChange: typed numeric edits (position/rotation/scale) mutate the
// live object WITHOUT calling notify() (see setSelectedPosition et al.'s own comment — a full panel
// rebuild on every keystroke would steal focus), so the dot needs its own lightweight signal that
// doesn't imply "rebuild the whole inspector".

function markDirty() { if (!dirty) { dirty = true; onDirtyChange?.(true); } }

// =============================================================================
// COLLISION-PAINTER-SESSION — Editor v2 phase 1: a "Collision" tab over the
// SAME selection/gizmo plumbing above, for SEEING and EDITING a placed
// object's collider spec (core/colliders.js's box/sphere/capsule/cone/deck
// vocabulary — see collider-catalogue.js's header for the storage model,
// which this file reads/writes but never redesigns).
//
// Coordinate space (the part the session brief calls "critical"): a shape's
// `pos`/`rot`/size fields are MODEL-LOCAL, not world space — exactly what a
// THREE child Object3D's own .position/.rotation/.scale already mean when
// parented under the selected object. So every overlay mesh below is added
// as a literal child of `selected.obj` (never the scene root) — THREE's own
// parent-child matrix composition places it in the right WORLD spot for
// free, and — the actual payoff — dragging it with TransformControls
// mutates exactly the local numbers the spec wants, with no manual
// world<->local matrix inversion anywhere in this file. Get this wrong (add
// overlays to the scene root, or read/write world coordinates) and every
// collider silently lands in the wrong place the moment the model is placed
// anywhere but the world origin — the "place a second dock elsewhere" check
// in the session brief's own Verify section exists specifically to catch
// that class of bug.
let colliderTabOpen = false;
let colliderShapes = null;       // working array of shape objects, or null when the tab is closed/nothing selected
let colliderIsStatic = true;     // the WHOLE spec's static flag (schema is spec-level, not per-shape)
let colliderShapeSelected = null; // index into colliderShapes currently gizmo-attached, or null
let colliderTarget = 'family';   // 'family' (-> collider-catalogue.js) | 'instance' (-> this row's own `collide`)
let colliderCatalogueId = null;
let colliderOverlayGroup = null; // THREE.Group, child of selected.obj, holds one child-Group per shape
let colliderDirty = false;       // separate from the placement `dirty` dot — a different export target
let onColliderChange = null;
let onColliderDirtyChange = null;

function colliderNotify() { onColliderChange?.(); }
function markColliderDirty() { if (!colliderDirty) { colliderDirty = true; onColliderDirtyChange?.(true); } }
function clearColliderDirtyFlag() { colliderDirty = false; onColliderDirtyChange?.(false); }
function round3(n) { return Math.round(n * 1000) / 1000; }

// A 'deck' shape has historically accepted its walkable height as EITHER a
// top-level `y` or `pos[1]` (core/colliders.js's registerDeck merges both —
// `y` wins — since collider-catalogue.js's hand-authored dock spec used the
// separate `y` spelling). This editor always READS via that same merge and
// always WRITES back consolidated into `pos` only, dropping any stray `y` —
// one canonical on-disk shape going forward, without requiring colliders.js
// (the engine — not to be touched this session) to stop accepting the old one.
function getEffectivePos(shape) {
  const p = shape.pos || [0, 0, 0];
  const y = shape.type === 'deck' ? (shape.y ?? p[1] ?? 0) : (p[1] ?? 0);
  return [p[0] ?? 0, y, p[2] ?? 0];
}
function setPos(shape, [x, y, z]) {
  shape.pos = [round3(x), round3(y), round3(z)];
  if (shape.type === 'deck') delete shape.y;
}
function getRot(shape) { return shape.rot || [0, 0, 0]; }
function setRot(shape, [x, y, z]) { shape.rot = [round3(x), round3(y), round3(z)]; }

// One entry per shape TYPE the picker offers: how to build a placeholder
// overlay mesh (unit-sized — actual dimensions come from the overlay
// Group's own .scale, so a size/radius/height edit is just a scale edit,
// including via the SAME scale-mode gizmo T/R/Y already cycles through),
// how to read the spec's own size fields as a [sx,sy,sz] scale triple, and
// the inverse. `role` picks the overlay's color (blocker vs deck) — see
// buildShapeOverlay. Coarse on purpose (box/sphere/capsule/cone, per the
// session brief — no taper/skew shaping here).
const DECK_VIS_THICKNESS = 0.08; // cosmetic only — decks have no real "thickness" spec field
const SHAPE_KIND = {
  box: {
    role: 'blocker',
    makeGeometry: () => new THREE.BoxGeometry(1, 1, 1),
    getScale: s => [s.size?.[0] ?? 1, s.size?.[1] ?? 1, s.size?.[2] ?? 1],
    setScale: (s, [x, y, z]) => { s.size = [round3(x), round3(y), round3(z)]; },
    defaults: () => ({ type: 'box', size: [1, 1, 1], pos: [0, 0, 0], rot: [0, 0, 0] }),
  },
  sphere: {
    role: 'blocker',
    makeGeometry: () => new THREE.SphereGeometry(1, 16, 12),
    getScale: s => [s.r ?? 0.5, s.r ?? 0.5, s.r ?? 0.5],
    setScale: (s, [x]) => { s.r = round3(x); },
    defaults: () => ({ type: 'sphere', r: 0.5, pos: [0, 0, 0] }),
  },
  capsule: {
    role: 'blocker',
    makeGeometry: () => new THREE.CapsuleGeometry(1, 1, 4, 8),
    getScale: s => [s.r ?? 0.3, s.h ?? 1, s.r ?? 0.3],
    setScale: (s, [x, y]) => { s.r = round3(x); s.h = round3(y); },
    defaults: () => ({ type: 'capsule', r: 0.3, h: 1, pos: [0, 0, 0], rot: [0, 0, 0] }),
  },
  cone: {
    role: 'blocker',
    makeGeometry: () => new THREE.ConeGeometry(1, 1, 12),
    getScale: s => [s.r ?? 0.5, s.h ?? 1, s.r ?? 0.5],
    setScale: (s, [x, y]) => { s.r = round3(x); s.h = round3(y); },
    defaults: () => ({ type: 'cone', r: 0.5, h: 1, pos: [0, 0, 0], rot: [0, 0, 0] }),
  },
  deck: {
    role: 'deck',
    makeGeometry: () => new THREE.BoxGeometry(1, DECK_VIS_THICKNESS, 1),
    getScale: s => [s.size?.[0] ?? 1, 1, s.size?.[1] ?? 1],
    setScale: (s, [x, , z]) => { s.size = [round3(x), round3(z)]; },
    defaults: () => ({ type: 'deck', size: [1, 1], pos: [0, 0, 0] }),
  },
};

// Unlit + translucent (MeshBasicMaterial, depthWrite:false) so overlays read
// clearly regardless of scene lighting and don't fully occlude the model
// underneath or fight z-order with each other. Module-scope, created once,
// never disposed — same discipline as this file's own scratch `_plane`/
// `_hit` (editor-only, lives for the process lifetime once first opened).
const _matBlockerFill = new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
const _matBlockerWire = new THREE.MeshBasicMaterial({ color: 0xff6a3d, wireframe: true, transparent: true, opacity: 0.85 });
const _matDeckFill = new THREE.MeshBasicMaterial({ color: 0x46d17a, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
const _matDeckWire = new THREE.MeshBasicMaterial({ color: 0x46d17a, wireframe: true, transparent: true, opacity: 0.85 });
const _matSelectedWire = new THREE.MeshBasicMaterial({ color: 0xffe14d, wireframe: true, transparent: true, opacity: 1, depthTest: false });

// One shape -> one Group(fill mesh, wire mesh[, selection-highlight mesh]),
// local pos/rot/scale set straight from the shape's own fields — see this
// section's header comment on why "child of selected.obj, local transform"
// is the whole coordinate-space trick. `fill`/`wire` share ONE geometry
// (disposing it twice in clearColliderOverlay is harmless — THREE's
// dispose() is idempotent) since they're always the same unit shape.
function buildShapeOverlay(shape, index) {
  const kind = SHAPE_KIND[shape.type];
  if (!kind) { console.warn(`[world-editor] collider: unknown shape type "${shape.type}"`); return null; }
  const geo = kind.makeGeometry();
  const [matFill, matWire] = kind.role === 'deck' ? [_matDeckFill, _matDeckWire] : [_matBlockerFill, _matBlockerWire];
  const fill = new THREE.Mesh(geo, matFill), wire = new THREE.Mesh(geo, matWire);
  const group = new THREE.Group();
  group.add(fill, wire);
  group.userData.__colliderShapeIndex = index;
  group.position.set(...getEffectivePos(shape));
  group.rotation.set(...getRot(shape));
  group.scale.set(...kind.getScale(shape));
  if (index === colliderShapeSelected) {
    const hi = new THREE.Mesh(geo, _matSelectedWire);
    hi.scale.setScalar(1.03); // a hair larger so the highlight wire reads over the base wire, not z-fighting it
    group.add(hi);
  }
  // Tagged directly on every mesh (not just the parent Group) so a flat
  // `selected.obj.traverse(o => ...)` elsewhere — getSelectedParts/
  // recolorSelectedPart, the Properties tab's recolor swatches — can skip
  // these with an O(1) check instead of an ancestor walk. These overlays are
  // added as real children of `selected.obj` (see this section's header on
  // why), so without this tag they'd otherwise show up as bogus, empty-
  // named "material parts" to recolor.
  for (const m of group.children) m.userData.__colliderOverlay = true;
  return group;
}

function clearColliderOverlay() {
  if (colliderOverlayGroup) {
    colliderOverlayGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    colliderOverlayGroup.parent?.remove(colliderOverlayGroup);
  }
  colliderOverlayGroup = null;
}
function refreshColliderOverlay() {
  clearColliderOverlay();
  if (!colliderTabOpen || !selected || !colliderShapes) return;
  colliderOverlayGroup = new THREE.Group();
  colliderOverlayGroup.name = '__colliderOverlay';
  for (let i = 0; i < colliderShapes.length; i++) {
    const g = buildShapeOverlay(colliderShapes[i], i);
    if (g) colliderOverlayGroup.add(g);
  }
  selected.obj.add(colliderOverlayGroup);
}
function syncOverlayFromShape(index) {
  const shape = colliderShapes?.[index];
  const group = colliderOverlayGroup?.children[index];
  const kind = shape && SHAPE_KIND[shape.type];
  if (!shape || !group || !kind) return;
  group.position.set(...getEffectivePos(shape));
  group.rotation.set(...getRot(shape));
  group.scale.set(...kind.getScale(shape));
}
// Inverse: reads the (just-dragged) overlay Group's CURRENT local transform
// back into the working shape — the only place world-editor.js converts a
// gizmo drag into spec data. Nothing here touches world space at all
// (`group.position`/`.rotation`/`.scale` are already local-to-`selected.obj`
// by construction — see this section's header), which is what makes this
// correct regardless of the selected object's own position/rotation/scale.
function syncColliderShapeFromGizmo() {
  if (colliderShapeSelected === null || !colliderOverlayGroup) return;
  const group = colliderOverlayGroup.children[colliderShapeSelected];
  const shape = colliderShapes[colliderShapeSelected];
  const kind = shape && SHAPE_KIND[shape.type];
  if (!group || !kind) return;
  setPos(shape, [group.position.x, group.position.y, group.position.z]);
  setRot(shape, [group.rotation.x, group.rotation.y, group.rotation.z]);
  kind.setScale(shape, [group.scale.x, group.scale.y, group.scale.z]);
  markColliderDirty();
}

function colliderCtx() { return { collisionRegistry: deps.collisionRegistry, heightRegistry: deps.heightRegistry }; }
// The live-preview half of "see AND test in the real renderer" (session
// brief, Phase 2): retracts whatever collider is CURRENTLY registered for
// `selected` — the original zone-load one the first time this runs for this
// object (selected.colliderDispose, set by core/world-edits.js's applyEdits;
// consumed exactly once), this editor's own previous live version every
// time after (selected.colliderLiveDispose) — then registers a fresh one
// from the current working `colliderShapes`. Both disposer slots live ON
// THE REGISTRY RECORD (not a module-level variable here), so switching
// selection to a different placed object never mixes up whose collider is
// whose, and needs no manual reset when selection changes. Never runs
// during Phase 1 (read-only viewing) — only ever called from an actual edit
// (drag-end, a numeric field, add/delete, static toggle) — so just opening
// the tab to look never touches the object's real collider.
function liveReregisterCollider() {
  if (!selected || !deps.collisionRegistry || !deps.heightRegistry) return;
  if (selected.colliderDispose) { selected.colliderDispose(); selected.colliderDispose = null; }
  selected.colliderLiveDispose?.();
  selected.colliderLiveDispose = null;
  if (!colliderShapes?.length) return; // every shape deleted — object now has zero colliders, intentional
  selected.colliderLiveDispose = registerColliders(selected.obj, { static: colliderIsStatic, shapes: colliderShapes }, null, colliderCtx());
}

// Loads the working copy for whatever's currently `selected` — precedence:
// an existing per-INSTANCE override (selected.row.collide, an explicit
// {static,shapes} object) if present, else the per-CATALOGUE-MODEL spec
// (collider-catalogue.js's COLLIDER_SPECS, keyed by catalogueId), else
// empty (no spec yet for this model — Add a shape to start one). Deep-
// copies every shape (own pos/rot/size arrays) so editing never mutates
// COLLIDER_SPECS/row.collide directly until an explicit Export/apply —
// mirrors serializeRows' own "never mutate the source of truth mid-edit"
// discipline in core/world-edits.js.
function loadColliderSpecForSelection() {
  if (!selected) { colliderShapes = null; colliderCatalogueId = null; return; }
  colliderCatalogueId = selected.row.catalogueId;
  const instanceSpec = (selected.row.collide && typeof selected.row.collide === 'object') ? selected.row.collide : null;
  const familySpec = COLLIDER_SPECS[colliderCatalogueId] || null;
  const source = instanceSpec || familySpec;
  colliderTarget = instanceSpec ? 'instance' : 'family';
  colliderIsStatic = source?.static !== false;
  colliderShapes = (source?.shapes || []).map(s => ({
    ...s,
    pos: s.pos ? [...s.pos] : undefined,
    rot: s.rot ? [...s.rot] : undefined,
    size: s.size ? [...s.size] : undefined,
  }));
  colliderShapeSelected = null;
  clearColliderDirtyFlag();
}

const MODE_KEYS = { KeyT: 'translate', KeyR: 'rotate', KeyY: 'scale' };

function notify() { onChange?.(); }

function selectableObjects() {
  return getPlacedRegistry().filter(r => !r.row.locked).map(r => r.obj);
}
function findRegistryEntry(hitObject) {
  const registry = getPlacedRegistry();
  for (let o = hitObject; o; o = o.parent) {
    const rec = registry.find(r => r.obj === o);
    if (rec) return rec;
  }
  return null;
}

function select(rec) {
  selectedScatter = null;
  selected = rec;
  transform.attach(rec.obj);
  // Switching the placed selection while the Collision tab is open re-loads
  // it for the NEWLY selected object — same "click a different object,
  // its own colliders show up" workflow the session brief's Phase 2 assumes.
  if (colliderTabOpen) { loadColliderSpecForSelection(); refreshColliderOverlay(); }
  notify();
}
// Scatter instances (World Editor Phase 4, "scatter reach") get no
// TransformControls gizmo — an InstancedMesh instance isn't its own
// Object3D, so dragging one would need a proxy-object mechanism this
// session scoped out (see PROJECT-STATE.md). Selecting one still gets you
// its Family#NNNN id, a hide action, and a family-wide override section.
function selectScatter(hit) {
  selected = null;
  transform.detach();
  selectedScatter = hit;
  notify();
}
function deselect() {
  selected = null;
  selectedScatter = null;
  transform.detach();
  if (colliderTabOpen) { colliderShapes = null; colliderCatalogueId = null; colliderShapeSelected = null; clearColliderOverlay(); }
  notify();
}

// Only meaningful after a TRANSLATE drag — rotate/scale drags never touch
// position, so snapping Y after one would incorrectly slam a floating
// object (e.g. the ship, which floats well above its own terrainHeight)
// down to the ground on every rotate/scale, not just moves.
function snapSelectedY() {
  if (!selected || !groundSnap || transform.mode !== 'translate') return;
  const p = selected.obj.position;
  p.y = deps.zone.terrainHeight(p.x, p.z);
}

// Ray -> ground point, iterated a few times against a horizontal plane at
// the current best-guess height so the result converges on the actual
// terrain point under the cursor rather than a flat-plane approximation —
// cheap (3 plane intersections) and accurate enough for this game's gentle
// terrain grades (see docs/terrain-from-map.js's own "gentle beaches, no
// cliff-drop" design intent).
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();
function groundPointFromEvent(e) {
  const rect = deps.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, deps.camera);
  let y = 0;
  for (let i = 0; i < 3; i++) {
    _plane.constant = -y;
    if (!raycaster.ray.intersectPlane(_plane, _hit)) return null;
    y = deps.zone.terrainHeight(_hit.x, _hit.z);
  }
  return { x: _hit.x, y, z: _hit.z };
}

async function placeArmed(e) {
  const point = groundPointFromEvent(e);
  const armed = armedPlacement;
  armedPlacement = null;
  notify(); // clear the "click to place" hint immediately, don't wait on the load
  if (!point) return;
  const row = {
    id: genPlacedId(armed.catalogueId),
    catalogueId: armed.catalogueId, variant: armed.variant,
    x: +point.x.toFixed(3), y: +point.y.toFixed(3), z: +point.z.toFixed(3),
    rot: [0, 0, 0], scale: 1, tint: null, materialPolicy: null, locked: false, collide: 'auto',
  };
  const rec = await addPlacedObject(deps.scene, deps.zone, row);
  if (rec) { markDirty(); select(rec); } else notify();
}

function onPointerDown(e) {
  if (!open || !e.isTrusted || e.button !== 0 || transform.dragging) return;
  if (armedPlacement) { placeArmed(e).catch(err => console.error('[world-editor] place failed', err)); return; }
  const rect = deps.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, deps.camera);
  // Collision tab open: a hit on one of the overlay shapes takes priority
  // over re-picking a placed/scattered object entirely — you're mid-edit on
  // `selected`, so a click should refine THAT (select a shape to drag) before
  // it's read as "select something else". Missing every overlay falls
  // through to the normal raycast below unchanged (so clicking a DIFFERENT
  // placed object still works, and reloads the tab for it — see select()).
  if (colliderTabOpen && colliderOverlayGroup) {
    const shapeHits = raycaster.intersectObjects(colliderOverlayGroup.children, true);
    if (shapeHits.length) {
      let o = shapeHits[0].object;
      while (o && o.userData.__colliderShapeIndex === undefined) o = o.parent;
      if (o) { selectColliderShape(o.userData.__colliderShapeIndex); return; }
    }
  }
  // One combined raycast (not two separate ones) so a placed object and a
  // scattered instance compete on actual distance — whichever is visually
  // closer under the cursor wins, not "placed always beats scatter".
  const hits = raycaster.intersectObjects([...selectableObjects(), ...getScatterMeshes()], true);
  if (!hits.length) { deselect(); return; }
  const hit = hits[0];
  const placedRec = findRegistryEntry(hit.object);
  if (placedRec) { select(placedRec); return; }
  // hit.instanceId is only ever set by THREE for a hit against an
  // InstancedMesh — a plain Mesh hit (that isn't under a placed-registry
  // root either, e.g. terrain/water/other zone content the raycast can
  // still technically reach) leaves it undefined.
  if (hit.instanceId !== undefined) {
    const resolved = resolveScatterHit(hit.object, hit.instanceId);
    if (resolved) { selectScatter({ ...resolved, mesh: hit.object, index: hit.instanceId }); return; }
  }
  deselect();
}

async function duplicateSelected() {
  if (!selected) return;
  const rec = await duplicatePlacedObject(deps.scene, deps.zone, selected.id);
  if (rec) { markDirty(); select(rec); }
}
function deleteSelected() {
  if (!selected) return;
  const id = selected.id;
  deselect();
  removePlacedObject(deps.scene, id);
  markDirty();
  notify();
}

// Records a per-instance scatterEdits[id] override on the CURRENT zone's
// live editsModule (getEditsModule() — populated by applyEdits at zone
// build time, always resolved by the time the editor could possibly be
// open) so Save picks it up, merging over anything already there rather
// than replacing the row outright. Both this and patchFamilyOverride below
// are the ONLY two ways a scatter-related edit is recorded, so marking
// dirty here covers hide/recolor-family/material-policy in one place.
function patchScatterEdit(id, patch) {
  const editsModule = getEditsModule();
  if (!editsModule) return;
  editsModule.scatterEdits ||= {};
  editsModule.scatterEdits[id] = { ...(editsModule.scatterEdits[id] || {}), ...patch };
  markDirty();
}
function patchFamilyOverride(family, patch) {
  const editsModule = getEditsModule();
  if (!editsModule) return;
  editsModule.familyOverrides ||= {};
  editsModule.familyOverrides[family] = { ...(editsModule.familyOverrides[family] || {}), ...patch };
  markDirty();
}

// Hides ONE scattered instance: persists scatterEdits[id]={hidden:true} for
// next build, AND hides it live right now by collapsing its matrix to zero
// scale across every sibling part-mesh of the SAME placement (trunk+leaves
// together) — getSiblingMeshes (not getScatterMeshesForFamily) is what
// keeps this scoped to the one placement instead of every instance sharing
// that numeric index across unrelated groups of the same family.
function hideSelectedScatterInstance() {
  if (!selectedScatter) return;
  const { id, mesh, index } = selectedScatter;
  patchScatterEdit(id, { hidden: true });
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const m of getSiblingMeshes(mesh, index)) {
    m.setMatrixAt(index, zero);
    m.instanceMatrix.needsUpdate = true;
  }
  deselect();
}

// Family-wide recolor — same clone-then-set-color technique as
// recolorSelectedPart (see its own comment), applied across EVERY currently
// registered mesh of the family (every season/state/variant group), not
// just the instance that happened to be selected. Live + persisted.
function recolorFamily(family, materialName, hex) {
  let changed = false;
  for (const mesh of getScatterMeshesForFamily(family)) {
    if (mesh.material?.name !== materialName) continue;
    const clone = mesh.material.clone();
    clone.color.set(hex);
    mesh.material = clone;
    changed = true;
  }
  if (changed) patchFamilyOverride(family, { tint: { ...(getEditsModule()?.familyOverrides?.[family]?.tint || {}), [materialName]: hex } });
  return changed;
}

// Family-wide material-policy override: PERSISTED (scatterEdits/
// familyOverrides.materialPolicy is picked up on the next zone build via
// catalogue-flora.js's own familyOverrides check) but NOT live-applied this
// session — reapplying a policy correctly would mean rebuilding every group
// of the family (re-resolve, re-load, re-instance), the same rebuild
// core/world-edits.js's rebuildPlacedObject does for a single placed
// object; scoped out here for time (see PROJECT-STATE.md). Reload the zone
// (or Save + refresh) to see it take effect.
function setFamilyMaterialPolicy(family, mode) {
  patchFamilyOverride(family, { materialPolicy: mode });
}

// Every material part visible on the CURRENTLY selected scatter instance's
// own mesh — the family-override recolor row's swatches.
function getFamilyParts(family) {
  const parts = new Map();
  for (const mesh of getScatterMeshesForFamily(family)) {
    if (mesh.material?.name && mesh.material?.color) parts.set(mesh.material.name, '#' + mesh.material.color.getHexString());
  }
  return [...parts.entries()].map(([name, hex]) => ({ name, hex }));
}

// Model swap / material-policy toggle both rebuild the object under the
// same id (core/world-edits.js's rebuildPlacedObject) — the OLD object is
// gone (removed from the scene) once this resolves, so the gizmo has to
// re-attach to the NEW one; re-selecting does both (select() re-attaches).
async function rebuildSelected(patch) {
  if (!selected) return false;
  const rec = await rebuildPlacedObject(deps.scene, deps.zone, selected.id, patch);
  if (!rec) return false;
  markDirty();
  select(rec);
  return true;
}

// Per-material-name swatches for the CURRENTLY selected object's live
// materials — the inspector's recolor row reads this to know what's there
// to click on and what it currently looks like.
function getSelectedParts() {
  if (!selected) return [];
  const parts = new Map(); // material name -> current hex (last one wins if somehow duplicated — cosmetic only)
  selected.obj.traverse(o => {
    if (!o.isMesh || o.userData.__colliderOverlay) return; // skip the Collision tab's own overlay meshes, if any
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m?.name && m.color) parts.set(m.name, '#' + m.color.getHexString());
    }
  });
  return [...parts.entries()].map(([name, hex]) => ({ name, hex }));
}

// Recolors ONE named material part on the selected object: clones it first
// (never mutates the material object in place) then sets .color on the
// clone — cloning preserves the original's map/roughness/metalness/etc., so
// a textured (authored) material keeps its texture and just gets tinted,
// rather than being replaced by a flat solid-color material and rendering
// washed-out/greyscale (the exact mistake this technique avoids — see
// core/gltf-assets.js's loadTintedTemplate, which uses the identical clone-
// then-set-color technique for the same reason). Persists into
// selected.row.tint so Save/serialize picks it up. Deliberately does NOT
// notify() — same reasoning as the transform setters above: a native
// <input type=color> fires oninput continuously while its picker is being
// dragged, and rebuilding the panel (which would recreate that same input)
// mid-drag would be at best disruptive and at worst close the picker.
function recolorSelectedPart(materialName, hex) {
  if (!selected) return false;
  let changed = false;
  selected.obj.traverse(o => {
    if (!o.isMesh || o.userData.__colliderOverlay) return; // skip the Collision tab's own overlay meshes, if any
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (let i = 0; i < mats.length; i++) {
      if (mats[i].name !== materialName) continue;
      const clone = mats[i].clone();
      clone.color.set(hex);
      if (Array.isArray(o.material)) o.material[i] = clone; else o.material = clone;
      changed = true;
    }
  });
  if (changed) { selected.row.tint = { ...(selected.row.tint || {}), [materialName]: hex }; markDirty(); }
  return changed;
}

// ---- Collision tab mutation API (Editor v2 phase 1) ----------------------
// Everything below operates on `colliderShapes`/`colliderOverlayGroup`, the
// working copy loadColliderSpecForSelection() populated for whatever's
// currently `selected` — see that function and this section's header
// comment (above SHAPE_KIND) for the coordinate-space/precedence rules.

function openColliderTab() {
  if (colliderTabOpen) return;
  colliderTabOpen = true;
  loadColliderSpecForSelection();
  refreshColliderOverlay();
  colliderNotify();
}
function closeColliderTab() {
  if (!colliderTabOpen) return;
  colliderTabOpen = false;
  colliderShapeSelected = null;
  clearColliderOverlay();
  colliderShapes = null; colliderCatalogueId = null;
  if (selected) transform.attach(selected.obj); // gizmo falls back to the object itself, not left dangling on a disposed shape mesh
  colliderNotify();
}
function selectColliderShape(index) {
  if (!colliderShapes || index < 0 || index >= colliderShapes.length) return;
  colliderShapeSelected = index;
  refreshColliderOverlay(); // rebuilds so the newly-selected shape gets its highlight wire (buildShapeOverlay checks colliderShapeSelected)
  const group = colliderOverlayGroup?.children[index];
  if (group) transform.attach(group);
  colliderNotify();
}
function deselectColliderShape() {
  if (colliderShapeSelected === null) return;
  colliderShapeSelected = null;
  refreshColliderOverlay(); // drop the highlight wire
  if (selected) transform.attach(selected.obj);
  colliderNotify();
}
function cycleColliderShape(dir) {
  if (!colliderShapes?.length) return;
  const cur = colliderShapeSelected ?? -1;
  selectColliderShape((cur + dir + colliderShapes.length) % colliderShapes.length);
}
function addColliderShape(type) {
  if (!colliderShapes || !SHAPE_KIND[type]) return;
  colliderShapes.push(SHAPE_KIND[type].defaults());
  markColliderDirty();
  selectColliderShape(colliderShapes.length - 1); // also refreshes the overlay to include the new shape
  liveReregisterCollider();
}
function deleteColliderShape() {
  if (colliderShapeSelected === null || !colliderShapes) return;
  colliderShapes.splice(colliderShapeSelected, 1);
  colliderShapeSelected = null;
  markColliderDirty();
  refreshColliderOverlay();
  if (selected) transform.attach(selected.obj);
  liveReregisterCollider();
  colliderNotify();
}
function setColliderStatic(v) {
  if (!colliderShapes) return;
  colliderIsStatic = !!v;
  markColliderDirty();
  liveReregisterCollider();
  colliderNotify();
}
function setColliderTarget(t) {
  colliderTarget = t === 'instance' ? 'instance' : 'family';
  markColliderDirty();
  colliderNotify();
}
// Numeric-field write path (position/rotation) for the currently selected
// shape — same role as setSelectedPosition et al. for placed objects, one
// level down. Live-reregisters on every commit (unlike the placement
// fields' own "don't notify every keystroke" caution): each call here is a
// handful of collider primitives, not a whole-panel rebuild, so there's no
// focus-stealing/perf reason to hold back — same reasoning core/colliders.js
// itself gives for why a static bake is cheap.
function patchColliderShapePos(x, y, z) {
  const shape = colliderShapes?.[colliderShapeSelected];
  if (!shape) return;
  setPos(shape, [x, y, z]);
  syncOverlayFromShape(colliderShapeSelected);
  markColliderDirty();
  liveReregisterCollider();
}
function patchColliderShapeRotDeg(xDeg, yDeg, zDeg) {
  const shape = colliderShapes?.[colliderShapeSelected];
  if (!shape) return;
  const d = Math.PI / 180;
  setRot(shape, [xDeg * d, yDeg * d, zDeg * d]);
  syncOverlayFromShape(colliderShapeSelected);
  markColliderDirty();
  liveReregisterCollider();
}
// Partial patch of the shape's OWN spec fields (e.g. {size:[x,y,z]} for a
// box, {r:...} for a sphere) — deliberately not positional args, so the
// panel can construct exactly the fields that make sense for `shape.type`
// without needing to know this file's internal scale-axis mapping.
function patchColliderShape(patch) {
  const shape = colliderShapes?.[colliderShapeSelected];
  if (!shape) return;
  Object.assign(shape, patch);
  syncOverlayFromShape(colliderShapeSelected);
  markColliderDirty();
  liveReregisterCollider();
}

// TARGET + EXPORT (Phase 4). Applies the CURRENT working spec to wherever
// `colliderTarget` says it belongs: 'family' mutates collider-catalogue.js's
// own live COLLIDER_SPECS table in place (an empty shape list deletes the
// entry rather than leaving a `{shapes:[]}` husk); 'instance' writes an
// explicit per-placement override onto this row's own `collide` field
// (reusing the EXISTING placement-dirty flag/Save path — serializePlaced()
// already spreads `...row`, `collide` included, so nothing else needs to
// change for that half). Returns which target it applied to, or null if
// there's nothing to apply (no selection).
function applyColliderTarget() {
  if (!selected || !colliderShapes) return null;
  const spec = { static: colliderIsStatic, shapes: colliderShapes };
  if (colliderTarget === 'instance') {
    selected.row.collide = colliderShapes.length ? spec : 'none';
    markDirty();
    return 'instance';
  }
  if (colliderCatalogueId) {
    if (colliderShapes.length) COLLIDER_SPECS[colliderCatalogueId] = spec;
    else delete COLLIDER_SPECS[colliderCatalogueId];
  }
  return 'family';
}
// Pure text generation (no download side-effect, no re-applying the working
// spec — the caller already did that via applyColliderTarget()), same
// contract as exportEditsText below — world-editor-panel.js owns the actual
// Blob/anchor/clipboard mechanics for both.
function exportColliderCatalogueText() {
  const body = JSON.stringify(COLLIDER_SPECS, null, 2);
  return `// Auto-exported by the World Editor's Collision tab — paste over world/core/collider-catalogue.js\n`
    + `// Replaces the WHOLE table — this file's own hand-written header comments\n`
    + `// aren't round-tripped; copy back whichever ones you still want to keep.\n`
    + `export const COLLIDER_SPECS = ${body};\n`;
}

function onKeyDown(e) {
  if (!e.isTrusted || !open) return;
  // Don't hijack T/R/Y/Delete/Ctrl+D while the user is typing/searching in
  // the panel's own catalogue-picker <select> (native selects support
  // type-ahead search, and keydown still bubbles to this window-level
  // listener regardless of which element has focus).
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (MODE_KEYS[e.code]) { transform.mode = MODE_KEYS[e.code]; notify(); return; }
  if (e.code === 'Delete' || e.code === 'Backspace') {
    if (colliderTabOpen && colliderShapeSelected !== null) { e.preventDefault(); deleteColliderShape(); return; }
    if (selected) { e.preventDefault(); deleteSelected(); return; }
    if (selectedScatter) { e.preventDefault(); hideSelectedScatterInstance(); return; }
  }
  if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey) && selected) { e.preventDefault(); duplicateSelected(); return; }
  if (e.code === 'KeyX' && selected) { e.preventDefault(); if (colliderTabOpen) closeColliderTab(); else openColliderTab(); return; }
  if (colliderTabOpen && (e.code === 'BracketRight' || e.code === 'BracketLeft')) { e.preventDefault(); cycleColliderShape(e.code === 'BracketRight' ? 1 : -1); return; }
  if (e.code === 'Escape') {
    if (armedPlacement) { armedPlacement = null; notify(); }
    else if (colliderTabOpen && colliderShapeSelected !== null) { deselectColliderShape(); }
    else deselect();
  }
}

// ---- exported surface — world-editor-panel.js and main.js are the only callers ----

export function isOpen() { return open; }
export function getZoneId() { return deps?.zone?.id; }
export function getSelected() { return selected; }
export function getSelectedScatter() { return selectedScatter; }
export function hideSelectedScatter() { return hideSelectedScatterInstance(); }
export { recolorFamily, setFamilyMaterialPolicy, getFamilyParts };
export function getMode() { return transform?.mode; }
export function setMode(m) { if (transform && ['translate', 'rotate', 'scale'].includes(m)) { transform.mode = m; notify(); } }
export function getGroundSnap() { return groundSnap; }
export function setGroundSnap(v) { groundSnap = !!v; }
export function getArmedPlacement() { return armedPlacement; }
export function armPlacement(catalogueId, variant) { armedPlacement = { catalogueId, variant }; deselect(); notify(); }
export function cancelArmedPlacement() { armedPlacement = null; notify(); }
export function onSelectionChange(cb) { onChange = cb; }
export function onDirty(cb) { onDirtyChange = cb; }
export function isDirty() { return dirty; }
export function clearDirty() { dirty = false; onDirtyChange?.(false); }
export function duplicateSelectedObject() { return duplicateSelected(); }
export function deleteSelectedObject() { return deleteSelected(); }
export function toggleSelectedLock() {
  if (!selected) return;
  selected.row.locked = !selected.row.locked;
  if (selected.row.locked) deselect(); else notify();
}
export { getSelectedParts, recolorSelectedPart };
// Position/rotation (degrees)/uniform-vs-per-axis scale — the inspector
// sets these directly on the live object for instant visual feedback.
// Deliberately does NOT call notify(): the panel rebuilds its numeric
// <input>s from scratch on every notify (same as grassland/editor-panel.js's
// own numField/render pattern), which would steal focus/cursor position out
// from under the user on every keystroke. grassland's own numField sidesteps
// this the identical way — its `set()` callbacks mutate the object directly
// without routing through editor.js's notify-calling functions. The 3D view
// still updates instantly regardless (the render loop runs every frame,
// with or without a DOM re-render) — only the *panel's own* redraw is
// skipped, and nothing in the panel needs to reflect a value the user is
// still actively typing into. Save's serializePlaced() reads the live
// object's transform at export time, so this needs no `row` bookkeeping.
export function setSelectedPosition(x, y, z) {
  if (!selected) return;
  selected.obj.position.set(x, y, z);
  markDirty(); // cheap: only ever fires onDirtyChange once (see markDirty's own `if (!dirty)` guard), never per-keystroke
}
export function setSelectedRotationDeg(xDeg, yDeg, zDeg) {
  if (!selected) return;
  const d = Math.PI / 180;
  selected.obj.rotation.set(xDeg * d, yDeg * d, zDeg * d);
  markDirty();
}
// scale is stored/edited as the USER-FACING (pre-policy) number, matching
// what Save writes — multiplies policyScaleFactor back in before touching
// the live object, mirroring core/world-edits.js's own applyScale.
export function setSelectedScale(sx, sy, sz) {
  if (!selected) return;
  markDirty();
  const f = selected.policyScaleFactor;
  selected.obj.scale.set(sx * f, sy * f, sz * f);
}
export function getSelectedUserScale() {
  if (!selected) return [1, 1, 1];
  const f = selected.policyScaleFactor;
  const s = selected.obj.scale;
  return [s.x / f, s.y / f, s.z / f];
}
export function swapSelectedModel(catalogueId, variant) {
  return rebuildSelected({ catalogueId, variant, tint: null });
}
export function setSelectedMaterialPolicy(mode) {
  // mode: 'authored' | 'flat-matte' | null (null clears the override, back
  // to the resolved pack's own default policy)
  return rebuildSelected({ materialPolicy: mode });
}
export function exportEditsText(zoneId) {
  const placed = serializePlaced();
  // familyOverrides/scatterEdits come from the currently-loaded editsModule
  // (Phase 4 mutates these live in place as the user edits scatter) — NOT
  // hardcoded empty, so Save never silently drops them once Phase 4 lands.
  const current = getEditsModule();
  const body = { placed, familyOverrides: current?.familyOverrides || {}, scatterEdits: current?.scatterEdits || {} };
  return `// Auto-exported by the World Editor — paste over world/zones/${zoneId}/edits.js\n`
    + `export const edits = ${JSON.stringify(body, null, 2)};\n`;
}

// "Copy selection as JSON" (Phase 5) — a quick single-object export, not
// the whole zone: the current placed[] row (read live off the object, same
// as Save) for a placed selection, or {id, family, scatterEdit} for a
// scattered one (there's no per-instance transform data to show beyond
// that in this session's scoped-down scatter model — see PROJECT-STATE.md).
export function copySelectionAsJSON() {
  let data = null;
  if (selected) data = serializePlaced().find(r => r.id === selected.id) || null;
  else if (selectedScatter) data = { id: selectedScatter.id, family: selectedScatter.family, scatterEdit: getEditsModule()?.scatterEdits?.[selectedScatter.id] || null };
  if (!data) return null;
  const text = JSON.stringify(data, null, 2);
  navigator.clipboard?.writeText(text).catch(() => {});
  return text;
}

export async function openEditor(d) {
  if (open) return;
  deps = d;
  // Resets on every open, not just on a fresh zone build — "unsaved dot" is
  // scoped to "since I opened the panel just now", not "since edits.js was
  // last actually saved across a close/reopen with no zone change in
  // between" (a real but small gap: close the editor dirty, reopen, the dot
  // reads clean even though nothing was saved). Accepted for a "minimal"
  // top-bar indicator (Phase 5's own brief) rather than threading a zone-
  // build generation token through just for this.
  dirty = false;
  abortCtl = new AbortController();
  raycaster = new THREE.Raycaster();
  transform = new TransformControls(deps.camera, deps.domElement);
  deps.scene.add(transform.getHelper());
  transform.addEventListener('objectChange', () => {
    // A collider shape is attached instead of `selected.obj` itself while
    // one's picked (selectColliderShape) — route drags there instead of
    // treating them as a placement move (which would wrongly mark the
    // PLACEMENT dirty dot and, worse, feed a shape's local coordinates into
    // snapSelectedY() below as if they were the object's own world Y).
    if (colliderShapeSelected !== null) { syncColliderShapeFromGizmo(); colliderNotify(); return; }
    markDirty(); notify();
  });
  transform.addEventListener('dragging-changed', e => {
    if (e.value) return;
    if (colliderShapeSelected !== null) { syncColliderShapeFromGizmo(); liveReregisterCollider(); colliderNotify(); return; }
    snapSelectedY(); notify();
  });
  deps.domElement.addEventListener('pointerdown', onPointerDown, { signal: abortCtl.signal });
  addEventListener('keydown', onKeyDown, { signal: abortCtl.signal });
  open = true;
  notify();
}

// Same three@0.169.0 TransformControls bug grassland/editor.js's
// disposeEditor() already documents: .dispose() calls `this.traverse(...)`,
// but TransformControls extends the new `Controls` base (not Object3D) and
// has no .traverse — throws on every call. disconnect() (domElement
// listener removal only) is what we actually need; the helper's own
// geometries go untracked on close same as that precedent (an accepted,
// documented upstream-bug tradeoff, not new to this module).
export function closeEditor() {
  if (!open) return;
  deselect(); // already clears the collider overlay/working-shapes state when colliderTabOpen — see deselect()
  colliderTabOpen = false; colliderShapeSelected = null;
  clearColliderOverlay();
  armedPlacement = null;
  transform?.disconnect();
  const helper = transform?.getHelper();
  helper?.parent?.remove(helper);
  abortCtl?.abort();
  transform = null; raycaster = null; abortCtl = null; deps = null;
  open = false;
  notify();
}

// ---- Collision tab exported surface (Editor v2 phase 1) — world-editor-panel.js is the only caller ----
export { openColliderTab, closeColliderTab, selectColliderShape, deselectColliderShape, cycleColliderShape };
export { addColliderShape, deleteColliderShape, setColliderStatic, setColliderTarget };
export { patchColliderShapePos, patchColliderShapeRotDeg, patchColliderShape, applyColliderTarget, exportColliderCatalogueText };
export function isColliderTabOpen() { return colliderTabOpen; }
export function getColliderShapes() { return colliderShapes || []; }
export function getColliderShapeSelected() { return colliderShapeSelected; }
export function getColliderTarget() { return colliderTarget; }
export function getColliderIsStatic() { return colliderIsStatic; }
export function getColliderCatalogueId() { return colliderCatalogueId; }
export function isColliderDirty() { return colliderDirty; }
export function clearColliderDirty() { clearColliderDirtyFlag(); }
export function onColliderSelectionChange(cb) { onColliderChange = cb; }
export function onColliderDirty(cb) { onColliderDirtyChange = cb; }
// A read-only display view of one shape — position/rotation already
// resolved through the deck y/pos[1] merge (getEffectivePos) and rotation
// in degrees, so the panel never needs to know either convention itself.
export function getColliderShapeDisplay(index) {
  const shape = colliderShapes?.[index];
  const kind = shape && SHAPE_KIND[shape.type];
  if (!shape || !kind) return null;
  return {
    type: shape.type,
    role: kind.role,
    pos: getEffectivePos(shape),
    rotDeg: getRot(shape).map(r => r * 180 / Math.PI),
    scale: kind.getScale(shape),
    raw: shape,
  };
}
