// Gallery zone — the Zone contract object (see core/zone.js). A walkable
// showroom over the WHOLE catalogue (Gallery v4: every entry Agni owns —
// 1,903 variants across ~876 family rooms — not just the 131 the game
// currently serves), one family ("room") at a time: [ and ] page between
// rooms (fully disposing the previous room's models), M marks the nearest
// model keep/fix/cut, X exports one gallery-marks.json covering the WHOLE
// catalogue. Served entries load through the game path (core/gltf-assets.js
// + FAMILY_SCALE); shelf (never-served) entries load straight from their
// 3DResources/ source — see rooms.js's loadUrl resolution. A "keep" mark on
// a shelf model is the promotion shopping list for a later session; this one
// only makes the shelf visible and walkable, it never copies or catalogues
// anything itself.
import * as THREE from 'three';
import { loadTintedTemplate } from '../../core/gltf-assets.js';
import { getPackPolicy } from '../../core/asset-policy.js';
import { loadRooms } from './rooms.js';
import * as Marks from './marks.js';

// Brief 10's per-family base-scale correction (world/zones/grassland/
// catalogue-flora.js's FAMILY_SCALE) copied here rather than imported, so a
// verdict reflects the shipping look without coupling the gallery to a
// specific zone's recipe module. Keyed by "set/family" (rooms.js's room key)
// so Simple_Nature's unrelated Bush family is never affected by BIGNature's
// correction.
const FAMILY_SCALE = { 'BIGNature/Willow': 1.25, 'BIGNature/Bush': 0.55, 'BIGNature/BushBerries': 0.55 };

const VERDICT_COLOR = { unmarked: '#ffffff', keep: '#3ecf6b', fix: '#e0a13a', cut: '#e0453a', loadfail: '#e0453a' };

// ---------------------------------------------------------------------------
// Everything below is module-level state for the ONE gallery instance the
// shell ever builds at a time (matches every other zone module's convention
// of a single `built` closure — see highland/zone.js).
// ---------------------------------------------------------------------------
let sceneRoot = null, realScene = null, abortCtl = null, getChar = null;
let rooms = [];
let roomIdx = 0, roomToken = 0;
let roomGroup = null;
let currentViews = []; // [{ slot, wrapper, label, template, failed }] for the ACTIVE room only
let focusedView = null;
let focusRing = null;
let rawMode = false;
let exportBtn = null, roomJump = null;

// A single shared placeholder geometry, reused for every loading/load-failed
// slot across the gallery's whole lifetime — tagged sharedGeometry so
// disposeOwned() never frees it (it's never re-created, so there's nothing
// to leak either way).
const PLACEHOLDER_GEO = new THREE.BoxGeometry(0.8, 0.8, 0.8);

function verdictColor(v) { return VERDICT_COLOR[v] || '#fff'; }

// Frees only what THIS module actually allocated (labels' canvas textures,
// placeholder/loadfail materials, the floor, the focus ring) — catalogue
// models loaded via loadTintedTemplate() are a shared cache also read by
// Grassland/Lagoon and are deliberately left alone; only their scene-graph
// parent is dropped when the room group is discarded.
function disposeOwned(root) {
  root.traverse(o => {
    if (!o.userData?.galleryOwned) return;
    if (o.geometry && !o.userData.sharedGeometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (!m) continue; if (m.map) m.map.dispose(); m.dispose(); }
    }
  });
}

function paintLabel(canvas, text, verdict) {
  const cx = canvas.getContext('2d');
  cx.clearRect(0, 0, canvas.width, canvas.height);
  cx.fillStyle = verdictColor(verdict);
  cx.font = '600 40px system-ui, sans-serif';
  cx.textAlign = 'center';
  cx.fillText(text, 256, 60);
}
function makeLabel(text, verdict) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
  paintLabel(cv, text, verdict);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
  sp.scale.set(4.2, 0.79, 1);
  sp.renderOrder = 10;
  sp.userData.galleryOwned = true;
  return sp;
}
function updateLabel(sprite, text, verdict) {
  paintLabel(sprite.material.map.image, text, verdict);
  sprite.material.map.needsUpdate = true;
}

// Small corner tag distinguishing what the game already ships (SERVED) from
// what's only ever been catalogued (SHELF) — independent of the keep/fix/cut
// verdict color, so the two signals never get confused.
function makeStatusTag(used) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 56;
  const cx = cv.getContext('2d');
  cx.fillStyle = used ? '#3a7bd5' : '#b8781f';
  cx.font = '700 30px system-ui, sans-serif';
  cx.textAlign = 'center';
  cx.fillText(used ? 'SERVED' : 'SHELF', 128, 38);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
  sp.scale.set(1.5, 0.33, 1);
  sp.renderOrder = 10;
  sp.userData.galleryOwned = true;
  return sp;
}

function makePlaceholder(failed) {
  const mesh = new THREE.Mesh(PLACEHOLDER_GEO, new THREE.MeshBasicMaterial({ color: failed ? 0xe0453a : 0xbbbbbb, wireframe: true }));
  if (failed) mesh.scale.setScalar(1.6);
  mesh.position.y = 0.4;
  mesh.userData.galleryOwned = true;
  mesh.userData.sharedGeometry = true;
  return mesh;
}
function makeFloor() {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 1 }),
  );
  floor.receiveShadow = true;
  floor.userData.galleryOwned = true;
  return floor;
}
function makeFocusRing() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.6, 1.85, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  ring.userData.galleryOwned = true;
  ring.visible = false;
  return ring;
}

// One representative variant's bounding box stands in for the whole room —
// a room is a single family, and different variants of the same species
// don't vary wildly in scale, so this avoids either guessing a flat spacing
// or reflowing an already-visible grid once every slot has loaded.
async function measureRoomCellSize(room) {
  if (!room.slots.length) return 6;
  try {
    const template = await loadTintedTemplate(room.slots[0].loadUrl, null, getPackPolicy(room.set));
    const size = new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3());
    return Math.max(3, Math.max(size.x, size.z) * 2.8 + 2);
  } catch {
    return 6; // representative variant failed — the slot itself will still auto-flag on its own turn
  }
}

async function loadRoom(idx) {
  const token = ++roomToken;
  if (roomGroup) { disposeOwned(roomGroup); sceneRoot.remove(roomGroup); }
  currentViews = [];
  focusedView = null;
  rawMode = false;
  roomIdx = idx;
  const room = rooms[idx];
  if (roomJump) roomJump.value = String(idx);
  roomGroup = new THREE.Group();
  sceneRoot.add(roomGroup);

  const cellSize = await measureRoomCellSize(room);
  if (token !== roomToken) return; // paged away while measuring

  const cols = Math.max(1, Math.round(Math.sqrt(room.slots.length) * 1.3));

  room.slots.forEach((slot, i) => {
    const gx = ((i % cols) - (cols - 1) / 2) * cellSize;
    const gz = -(Math.floor(i / cols) + 0.5) * cellSize;

    const wrapper = new THREE.Group();
    wrapper.position.set(gx, 0, gz);
    roomGroup.add(wrapper);

    const placeholder = makePlaceholder(false);
    wrapper.add(placeholder);

    const label = makeLabel(`${slot.name} …`, Marks.getVerdict(slot.marksKey));
    label.position.set(0, 1.9, 0.6);
    wrapper.add(label);

    const tag = makeStatusTag(slot.used);
    tag.position.set(0, 2.35, 0.6);
    wrapper.add(tag);

    const view = { slot, wrapper, label, template: null, failed: false };
    currentViews.push(view);

    loadTintedTemplate(slot.loadUrl, null, getPackPolicy(room.set)).then(template => {
      if (token !== roomToken) return;
      wrapper.remove(placeholder);
      const clone = template.clone(true);
      clone.scale.setScalar(rawMode ? 1 : (FAMILY_SCALE[slot.family] || 1));
      wrapper.add(clone);
      view.template = clone;
      updateLabel(label, slot.name, Marks.getVerdict(slot.marksKey));
    }).catch(e => {
      if (token !== roomToken) return;
      wrapper.remove(placeholder);
      wrapper.add(makePlaceholder(true));
      view.failed = true;
      Marks.setLoadFail(slot.marksKey, e.message);
      console.error(`[gallery] ${slot.loadUrl} failed to load: ${e.message}`);
      updateLabel(label, `${slot.name} — LOAD FAIL`, 'loadfail');
    });
  });
}

function pageRoom(delta) {
  if (!rooms.length) return;
  loadRoom((roomIdx + delta + rooms.length) % rooms.length);
}

function handleMark() {
  if (!focusedView) return;
  const verdict = Marks.cycleMark(focusedView.slot.marksKey);
  updateLabel(focusedView.label, focusedView.failed ? `${focusedView.slot.name} — LOAD FAIL` : focusedView.slot.name, verdict);
}

function toggleRaw() {
  rawMode = !rawMode;
  for (const v of currentViews) {
    if (!v.template) continue;
    v.template.scale.setScalar(rawMode ? 1 : (FAMILY_SCALE[v.slot.family] || 1));
  }
}

function exportMarks() {
  const data = Marks.exportAll(rooms);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'gallery-marks.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  navigator.clipboard?.writeText(json).catch(() => {});
  console.log(`[gallery] exported ${data.length} entries`);
}

function onKeydown(e) {
  if (!e.isTrusted) return;
  if (e.code === 'BracketRight') pageRoom(1);
  else if (e.code === 'BracketLeft') pageRoom(-1);
  else if (e.code === 'KeyM') handleMark();
  else if (e.code === 'KeyX') exportMarks();
  else if (e.code === 'KeyR') toggleRaw();
}

function makeExportButton() {
  const btn = document.createElement('button');
  btn.textContent = 'Export marks (X)';
  btn.style.cssText = 'position:fixed; left:12px; bottom:12px; z-index:5; font:600 12px ui-sans-serif, system-ui, sans-serif; padding:6px 12px; border-radius:6px; border:1px solid rgba(0,0,0,.2); background:rgba(255,255,255,.9); cursor:pointer;';
  btn.addEventListener('click', exportMarks);
  document.body.appendChild(btn);
  return btn;
}

// ~876 rooms means the [ ] pager alone can't reach a given family in
// reasonable time — a native <select> gets type-to-jump and keyboard
// navigation for free (every browser already implements it for free-text
// option search) without building a custom search UI. Populated once rooms
// resolve; blurred right after a jump so WASD movement isn't swallowed by
// the still-focused control.
function makeRoomJump() {
  const select = document.createElement('select');
  select.style.cssText = 'position:fixed; right:12px; top:12px; z-index:5; font:600 12px ui-sans-serif, system-ui, sans-serif; padding:5px 8px; border-radius:6px; max-width:280px;';
  select.addEventListener('change', () => { loadRoom(Number(select.value)); select.blur(); });
  document.body.appendChild(select);
  return select;
}
function populateRoomJump() {
  if (!roomJump) return;
  roomJump.innerHTML = rooms.map((r, i) => `<option value="${i}">${r.key} (${r.slots.length})</option>`).join('');
}

function renderHud() {
  const el = document.getElementById('hudText');
  if (!el || !rooms.length) return;
  const room = rooms[roomIdx];
  const t = Marks.totals(rooms.flatMap(r => r.slots));
  el.innerHTML = `<b>Gallery — ${room.key}</b> <small style="opacity:.55">room ${roomIdx + 1} of ${rooms.length} · ${room.servedCount} served / ${room.shelfCount} shelf</small><br>`
    + `<b>[ ]</b> page rooms · dropdown (top-right) jumps rooms · <b>M</b> mark keep/fix/cut · <b>X</b> export JSON · <b>R</b> raw scale (${rawMode ? 'ON' : 'off'}) · <b>K</b> back to world<br>`
    + `keep ${t.keep} · fix ${t.fix} · cut ${t.cut} · loadfail ${t.loadfail} · unmarked ${t.unmarked}`;
}

function updateFocus() {
  if (!getChar) return;
  const p = getChar().position;
  let nearest = null, nearestDist = 4;
  for (const v of currentViews) {
    const d = Math.hypot(p.x - v.wrapper.position.x, p.z - v.wrapper.position.z);
    if (d < nearestDist) { nearestDist = d; nearest = v; }
  }
  focusedView = nearest;
  focusRing.visible = !!nearest;
  if (nearest) focusRing.position.set(nearest.wrapper.position.x, 0.02, nearest.wrapper.position.z);
}

function build(ctx) {
  sceneRoot = ctx.scene;
  realScene = ctx.realScene;
  abortCtl = ctx.abortController;
  getChar = ctx.getChar;
  rawMode = false;
  focusedView = null;

  ctx.heightRegistry.register(() => 0, 'gallery-floor');

  sceneRoot.add(makeFloor());
  focusRing = makeFocusRing();
  sceneRoot.add(focusRing);

  exportBtn = makeExportButton();
  roomJump = makeRoomJump();
  addEventListener('keydown', onKeydown, { signal: abortCtl.signal });

  loadRooms().then(loaded => {
    rooms = loaded;
    if (!sceneRoot) return; // disposed before the catalogue fetch resolved
    populateRoomJump();
    loadRoom(0);
  });

  return sceneRoot;
}

function update(dt) {
  if (!roomGroup) return;
  for (const v of currentViews) v.wrapper.rotation.y += dt * 0.3;
  updateFocus();
  // Rendered unconditionally, not on a dirty flag: main.js's own
  // handleCharacterChanged (fired whenever the async character GLB finishes
  // loading, independent of zone) stomps hudText.innerHTML back to the
  // generic per-zone HUD — since that can land in any frame, ours has to
  // keep re-winning the "last write" every frame, not just on room/mark
  // events.
  renderHud();
}

function dispose() {
  if (!sceneRoot) return;
  disposeOwned(sceneRoot);
  realScene.remove(sceneRoot);
  exportBtn?.remove();
  roomJump?.remove();
  abortCtl?.abort();
  rooms = []; roomGroup = null; currentViews = []; focusedView = null; exportBtn = null; roomJump = null;
  sceneRoot = null; realScene = null; getChar = null; abortCtl = null;
  roomToken++;
}

const PALETTES = {
  day: {
    sky: 0xf4f1ea,
    fog: { color: 0xf4f1ea, near: 140, far: 260 },
    hemisphere: { sky: 0xffffff, ground: 0xcfcabf, intensity: 1.1 },
    sun: { color: 0xffffff, intensity: 1.3, offset: { x: 30, y: 60, z: 20 } },
    bloom: { strength: 0, radius: 0.4, threshold: 1 },
  },
};
const dayCycle = [{ t: 0, key: 'day' }];
function terrainHeight() { return 0; }

export const zone = {
  id: 'gallery',
  name: 'Gallery',
  worldExtent: 120,
  WATER_Y: -50,
  terrainHeight,
  PALETTES,
  dayCycle,
  spawnPoints: { default: { x: 0, z: 10 } },
  portals: [],
  build,
  update,
  dispose,
};
export default zone;
