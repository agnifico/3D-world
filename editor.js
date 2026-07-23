// Grassland World — Area Designer: select/move/rotate/scale/add/delete
// placed objects (props.js's live registry). Owns its own input (L toggle,
// Tab cycles gizmo mode, Delete removes, Escape deselects) — independent of
// controller.js's listener, so gameplay (WASD/camera/Space/E) keeps working
// while the editor is open; left-click is unused by gameplay today, so
// click-to-select doesn't collide with anything.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { groundHeight, WATER_Y } from './world.js';
import { registry, removePlacement, spawnNative, spawnKenney, KENNEY_PACK, KENNEY_SCALE } from './props.js';
import { KENNEY_PALETTE, recolorKenneyMesh, recolorNativeMesh } from './assets.js';

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

// ---- recolor (nice-to-have, per the brief) ----
// Kenney meshes carry the swatches actually baked onto them in
// userData.palette (set once, at bake time, in assets.js); native meshes just
// report their current material color. Both lists are for the "from" picker.
export function getCurrentSwatches(rec) {
  const set = new Set();
  if (rec.kind === 'kenney') rec.obj.traverse(o => { if (o.isMesh && o.userData.palette) for (const c of o.userData.palette) set.add(c); });
  else rec.obj.traverse(o => { if (o.isMesh && o.material && o.material.color) set.add('#' + o.material.color.getHexString()); });
  return [...set];
}
// the fixed 14-color palette everything in the world snaps to — the "to" picker
export function getTargetPalette() { return KENNEY_PALETTE.map(hex => '#' + new THREE.Color(hex).getHexString()); }

export function recolor(rec, fromHex, toHex) {
  let changed = false;
  if (rec.kind === 'kenney') {
    rec.obj.traverse(o => { if (o.isMesh && recolorKenneyMesh(o, { [fromHex]: toHex })) changed = true; });
    // accumulate so a second recolor on the same instance doesn't lose the first
    if (changed) rec.overrides = { remap: { ...(rec.overrides?.remap || {}), [fromHex]: toHex } };
  } else {
    rec.obj.traverse(o => {
      if (o.isMesh && o.material && o.material.color && ('#' + o.material.color.getHexString()) === fromHex) {
        recolorNativeMesh(o, toHex); changed = true;
      }
    });
  }
  if (changed) notify();
  return changed;
}

// Serializes the live registry back into the two array-literal shapes
// props.js already reads at startup (NATIVE_PLACEMENTS / KENNEY_PLACEMENTS),
// ready to paste over those consts. `onWater` is inferred (a static boat sits
// at exactly WATER_Y - 0.15 until ridden) since it isn't tracked separately —
// approximate for anything hand-moved to that exact height by coincidence.
export function exportSnippet() {
  const native = [], kenney = [];
  for (const rec of registry) {
    const o = rec.obj;
    const x = +o.position.x.toFixed(2), z = +o.position.z.toFixed(2), rot = +o.rotation.y.toFixed(3);
    if (rec.kind === 'native') {
      native.push(`  ['${rec.name}', ${x}, ${z}, ${rot}, ${+o.position.y.toFixed(3)}],`);
    } else {
      const pack = KENNEY_PACK[rec.name];
      const base = KENNEY_SCALE[pack] || 2;
      const sMul = +(o.scale.x / base).toFixed(3);
      const onWater = Math.abs(o.position.y - (WATER_Y - 0.15)) < 0.05;
      const fields = [`'${rec.name}'`, x, z, rot, sMul, onWater];
      if (rec.overrides) {
        // overrides is a 7th positional field — sMul/onWater must stay
        // explicit, even at their defaults, or import would misparse them
        fields.push(JSON.stringify(rec.overrides));
      } else {
        while (fields.length > 3 && fields[fields.length - 1] === false) fields.pop(); // trailing false is the default
        if (fields.length === 5 && fields[4] === 1) fields.pop(); // trailing 1x scale is also the default
      }
      kenney.push(`  [${fields.join(', ')}],`);
    }
  }
  return `// NATIVE_PLACEMENTS\n[\n${native.join('\n')}\n]\n\n// KENNEY_PLACEMENTS\n[\n${kenney.join('\n')}\n]\n`;
}
