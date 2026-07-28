// Gallery zone — the Zone contract object (see core/zone.js). A walkable
// showroom that force-loads every served catalogue entry, one family ("room")
// at a time: [ and ] page between rooms (fully disposing the previous
// room's models), M marks the nearest model keep/fix/cut, X exports one
// gallery-marks.json covering the WHOLE served set. This is the only thing
// that touches every catalogue entry the game could place — recipe-driven
// zones (Grassland, Lagoon) only load what they actually scatter.
import * as THREE from 'three';
import { servedURL } from '../../core/catalogue.js';
import { loadTintedTemplate } from '../../core/gltf-assets.js';
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
let exportBtn = null;

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
    const template = await loadTintedTemplate(servedURL(room.slots[0].served), null);
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

    const label = makeLabel(`${slot.name} …`, Marks.getVerdict(slot.served));
    label.position.set(0, 1.9, 0.6);
    wrapper.add(label);

    const view = { slot, wrapper, label, template: null, failed: false };
    currentViews.push(view);

    loadTintedTemplate(servedURL(slot.served), null).then(template => {
      if (token !== roomToken) return;
      wrapper.remove(placeholder);
      const clone = template.clone(true);
      clone.scale.setScalar(rawMode ? 1 : (FAMILY_SCALE[slot.family] || 1));
      wrapper.add(clone);
      view.template = clone;
      updateLabel(label, slot.name, Marks.getVerdict(slot.served));
    }).catch(e => {
      if (token !== roomToken) return;
      wrapper.remove(placeholder);
      wrapper.add(makePlaceholder(true));
      view.failed = true;
      Marks.setLoadFail(slot.served, e.message);
      console.error(`[gallery] ${slot.served} failed to load: ${e.message}`);
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
  const verdict = Marks.cycleMark(focusedView.slot.served);
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

function renderHud() {
  const el = document.getElementById('hudText');
  if (!el || !rooms.length) return;
  const room = rooms[roomIdx];
  const t = Marks.totals(rooms.flatMap(r => r.slots));
  el.innerHTML = `<b>Gallery — ${room.family}</b> <small style="opacity:.55">room ${roomIdx + 1} of ${rooms.length} · ${room.slots.length} models</small><br>`
    + `<b>[ ]</b> page rooms · <b>M</b> mark keep/fix/cut · <b>X</b> export JSON · <b>R</b> raw scale (${rawMode ? 'ON' : 'off'}) · <b>K</b> back to world<br>`
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
  addEventListener('keydown', onKeydown, { signal: abortCtl.signal });

  loadRooms().then(loaded => {
    rooms = loaded;
    if (!sceneRoot) return; // disposed before the catalogue fetch resolved
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
  abortCtl?.abort();
  rooms = []; roomGroup = null; currentViews = []; focusedView = null; exportBtn = null;
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
