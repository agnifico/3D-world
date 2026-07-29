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

let deps = null; // { scene, camera, domElement, animated, renderer, zone, getChar }
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
    if (!o.isMesh) return;
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
    if (!o.isMesh) return;
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

function onKeyDown(e) {
  if (!e.isTrusted || !open) return;
  // Don't hijack T/R/Y/Delete/Ctrl+D while the user is typing/searching in
  // the panel's own catalogue-picker <select> (native selects support
  // type-ahead search, and keydown still bubbles to this window-level
  // listener regardless of which element has focus).
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (MODE_KEYS[e.code]) { transform.mode = MODE_KEYS[e.code]; notify(); return; }
  if ((e.code === 'Delete' || e.code === 'Backspace') && selected) { e.preventDefault(); deleteSelected(); return; }
  if ((e.code === 'Delete' || e.code === 'Backspace') && selectedScatter) { e.preventDefault(); hideSelectedScatterInstance(); return; }
  if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey) && selected) { e.preventDefault(); duplicateSelected(); return; }
  if (e.code === 'Escape') { if (armedPlacement) { armedPlacement = null; notify(); } else deselect(); }
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
  transform.addEventListener('objectChange', () => { markDirty(); notify(); });
  transform.addEventListener('dragging-changed', e => { if (!e.value) { snapSelectedY(); notify(); } });
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
  deselect();
  armedPlacement = null;
  transform?.disconnect();
  const helper = transform?.getHelper();
  helper?.parent?.remove(helper);
  abortCtl?.abort();
  transform = null; raycaster = null; abortCtl = null; deps = null;
  open = false;
  notify();
}
