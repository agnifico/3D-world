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
  serializePlaced, genPlacedId, getEditsModule,
} from './world-edits.js';

let deps = null; // { scene, camera, domElement, animated, renderer, zone, getChar }
let open = false;
let abortCtl = null;
let raycaster = null, transform = null;
let selected = null; // a getPlacedRegistry() record, or null
let groundSnap = true;
let armedPlacement = null; // { catalogueId, variant } while a catalogue-picker "Place" is waiting for the next canvas click
let onChange = null; // world-editor-panel.js subscribes here to re-render on any state change

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
  selected = rec;
  transform.attach(rec.obj);
  notify();
}
function deselect() {
  selected = null;
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
    rot: [0, 0, 0], scale: 1, tint: null, materialPolicy: null, locked: false,
  };
  const rec = await addPlacedObject(deps.scene, deps.zone, row);
  if (rec) select(rec); else notify();
}

function onPointerDown(e) {
  if (!open || !e.isTrusted || e.button !== 0 || transform.dragging) return;
  if (armedPlacement) { placeArmed(e).catch(err => console.error('[world-editor] place failed', err)); return; }
  const rect = deps.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, deps.camera);
  const hits = raycaster.intersectObjects(selectableObjects(), true);
  if (!hits.length) { deselect(); return; }
  const rec = findRegistryEntry(hits[0].object);
  if (rec) select(rec); else deselect();
}

async function duplicateSelected() {
  if (!selected) return;
  const rec = await duplicatePlacedObject(deps.scene, deps.zone, selected.id);
  if (rec) select(rec);
}
function deleteSelected() {
  if (!selected) return;
  const id = selected.id;
  deselect();
  removePlacedObject(deps.scene, id);
  notify();
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
  if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey) && selected) { e.preventDefault(); duplicateSelected(); return; }
  if (e.code === 'Escape') { if (armedPlacement) { armedPlacement = null; notify(); } else deselect(); }
}

// ---- exported surface — world-editor-panel.js and main.js are the only callers ----

export function isOpen() { return open; }
export function getZoneId() { return deps?.zone?.id; }
export function getSelected() { return selected; }
export function getMode() { return transform?.mode; }
export function setMode(m) { if (transform && ['translate', 'rotate', 'scale'].includes(m)) { transform.mode = m; notify(); } }
export function getGroundSnap() { return groundSnap; }
export function setGroundSnap(v) { groundSnap = !!v; }
export function getArmedPlacement() { return armedPlacement; }
export function armPlacement(catalogueId, variant) { armedPlacement = { catalogueId, variant }; deselect(); notify(); }
export function cancelArmedPlacement() { armedPlacement = null; notify(); }
export function onSelectionChange(cb) { onChange = cb; }
export function duplicateSelectedObject() { return duplicateSelected(); }
export function deleteSelectedObject() { return deleteSelected(); }
export function toggleSelectedLock() {
  if (!selected) return;
  selected.row.locked = !selected.row.locked;
  if (selected.row.locked) deselect(); else notify();
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

export async function openEditor(d) {
  if (open) return;
  deps = d;
  abortCtl = new AbortController();
  raycaster = new THREE.Raycaster();
  transform = new TransformControls(deps.camera, deps.domElement);
  deps.scene.add(transform.getHelper());
  transform.addEventListener('objectChange', notify);
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
