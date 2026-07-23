// Grassland World — Area Designer: select/move/rotate/scale/add/delete
// placed objects (props.js's live registry). Owns its own input (L toggle,
// Tab cycles gizmo mode, Delete removes, Escape deselects) — independent of
// controller.js's listener, so gameplay (WASD/camera/Space/E) keeps working
// while the editor is open; left-click is unused by gameplay today, so
// click-to-select doesn't collide with anything.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { groundHeight } from './world.js';
import { registry, removePlacement, spawnNative, spawnKenney } from './props.js';

let scene, camera, domElement, animated, getChar;
let raycaster, transform;
let open = false, selected = null, lockY = false;
let onSelectionChange = null;

function notify() { if (onSelectionChange) onSelectionChange(selected); }

function findPlacementRoot(obj) {
  let o = obj;
  while (o) {
    if (o.userData && o.userData.__placementId !== undefined) return o;
    o = o.parent;
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

function snapY() {
  if (!selected || lockY) return;
  const p = selected.obj.position;
  p.y = groundHeight(p.x, p.z);
}

function onPointerDown(e) {
  if (!open || !e.isTrusted || e.button !== 0 || transform.dragging) return;
  const rect = domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(registry.map(r => r.obj), true);
  if (!hits.length) { deselect(); return; }
  const root = findPlacementRoot(hits[0].object);
  const rec = root && registry.find(r => r.obj === root);
  if (rec) select(rec); else deselect();
}

const MODES = ['translate', 'rotate', 'scale'];
function onKeyDown(e) {
  if (!e.isTrusted) return;
  if (e.code === 'KeyL') { toggle(); return; }
  if (!open) return;
  if (e.code === 'Tab') { e.preventDefault(); transform.mode = MODES[(MODES.indexOf(transform.mode) + 1) % MODES.length]; notify(); }
  if ((e.code === 'Delete' || e.code === 'Backspace') && selected) { e.preventDefault(); removeSelected(); }
  if (e.code === 'Escape') deselect();
}

function removeSelected() {
  if (!selected) return;
  const id = selected.id;
  deselect();
  removePlacement(scene, id);
}

export function initEditor(deps) {
  ({ scene, camera, domElement, animated, getChar } = deps);
  raycaster = new THREE.Raycaster();
  transform = new TransformControls(camera, domElement);
  scene.add(transform.getHelper());
  transform.getHelper().visible = false;
  transform.addEventListener('objectChange', notify);
  transform.addEventListener('dragging-changed', e => { if (!e.value) { snapY(); notify(); } });
  domElement.addEventListener('pointerdown', onPointerDown);
  addEventListener('keydown', onKeyDown);
}

export function isEditorOpen() { return open; }
export function toggle() {
  open = !open;
  if (!open) deselect(); // detach() also hides the gizmo helper
  notify();
  return open;
}

export function getSelected() { return selected; }
export function getMode() { return transform.mode; }
export function setMode(m) { if (MODES.includes(m)) { transform.mode = m; notify(); } }
export function getLockY() { return lockY; }
export function setLockY(v) { lockY = !!v; }
export function onSelect(cb) { onSelectionChange = cb; }

export async function spawnFromCatalog(kind, name) {
  const pos = getChar().position;
  const rec = kind === 'native'
    ? spawnNative(scene, animated, name, pos.x, pos.z, 0)
    : await spawnKenney(scene, animated, name, pos.x, pos.z, 0);
  if (rec) select(rec);
  return rec;
}

export function deleteSelected() { removeSelected(); }
export function deselectAll() { deselect(); }
