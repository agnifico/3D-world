// World Shell — World Editor (Layer 4) DOM: catalogue picker + toolbar +
// a per-object property inspector (position/rotation/scale fields, recolor,
// material-policy toggle, model swap — Phase 3; select/place/duplicate/
// delete/lock/save are Phase 2). Talks to core/world-editor.js only through
// its exported functions/callback, never reaches into its internals — same
// discipline grassland/editor-panel.js already established against
// grassland/editor.js.
//
// initEditorPanel() is called ONCE ever (main.js guards it behind "have I
// already dynamically imported this module"), not once per open/close
// toggle — the DOM root persists for the rest of the session and just
// hides via `display:none` (render() below) when the editor is closed.
// Deliberate: it's a handful of cheap DOM nodes, and hiding is simpler and
// exactly as memory-stable as destroy/recreate would be. The THREE-side
// state (core/world-editor.js's own openEditor/closeEditor) is the part
// that actually needs the "no growth across N cycles" discipline, since
// that's where geometries/listeners/TransformControls live.
import * as Editor from './world-editor.js';
import { loadRooms } from '../zones/gallery/rooms.js';

let root = null;
let rooms = null; // lazily loaded on first initEditorPanel(), cached for the process lifetime (same as gallery's own loadRooms cache)

function mkButton(label) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'font: inherit; padding:4px 8px; border-radius:6px; border:1px solid rgba(80,80,90,.35); background:#f4f3f8; color:#2a2a33; cursor:pointer;';
  return b;
}
function mkRow() {
  const r = document.createElement('div');
  r.style.cssText = 'display:flex; gap:6px; margin-top:6px; align-items:center;';
  return r;
}

async function ensureRooms() {
  if (!rooms) rooms = await loadRooms();
  return rooms;
}

function populateVariantSelect(sel, room) {
  sel.innerHTML = '';
  if (!room) return;
  for (const slot of room.slots) sel.appendChild(new Option(`${slot.name}${slot.used ? '' : ' (shelf)'}`, JSON.stringify({ id: slot.entryId, variant: slot.variant })));
}

// Same numeric-field shape grassland/editor-panel.js's own numField uses —
// `set` mutates the live object directly and does NOT trigger a panel
// re-render (see world-editor.js's setSelectedPosition/Rotation/Scale — a
// rebuild-on-every-keystroke would steal focus out from under the user).
function numField(grid, label, get, set, step = 0.1) {
  const l = document.createElement('span'); l.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'number'; inp.step = step; inp.value = +get().toFixed(3);
  inp.style.cssText = 'width:100%; font:inherit;';
  inp.oninput = () => { const v = parseFloat(inp.value); if (!Number.isNaN(v)) set(v); };
  grid.append(l, inp);
}
function fieldGrid() {
  const g = document.createElement('div');
  g.style.cssText = 'display:grid; grid-template-columns:auto 1fr; gap:4px 6px; align-items:center; margin-top:6px;';
  return g;
}
function swatch(hex) {
  const s = document.createElement('div');
  s.style.cssText = `width:20px; height:20px; border-radius:50%; background:${hex}; cursor:pointer; border:2px solid rgba(0,0,0,.25); flex:0 0 auto;`;
  return s;
}

function buildScaleSection(sel) {
  const wrap = document.createElement('div');
  const [sx0, sy0, sz0] = Editor.getSelectedUserScale();
  const uniformRow = document.createElement('label');
  uniformRow.style.cssText = 'display:flex; align-items:center; gap:6px; font-size:12px; margin-top:6px;';
  const cb = document.createElement('input'); cb.type = 'checkbox';
  cb.checked = Math.abs(sx0 - sy0) < 1e-4 && Math.abs(sy0 - sz0) < 1e-4;
  uniformRow.append(cb, document.createTextNode('Uniform scale'));
  wrap.appendChild(uniformRow);
  const grid = fieldGrid();
  wrap.appendChild(grid);
  function renderFields() {
    grid.innerHTML = '';
    if (cb.checked) {
      numField(grid, 'Scale', () => Editor.getSelectedUserScale()[0], v => Editor.setSelectedScale(v, v, v), 0.05);
    } else {
      // Each setter re-reads the OTHER two axes fresh at edit time (not
      // captured once at build time) — otherwise editing X after having
      // already edited Y would silently revert Y back to its build-time
      // value, since these callbacks never rebuild between keystrokes.
      numField(grid, 'Scale X', () => Editor.getSelectedUserScale()[0], v => { const [, y, z] = Editor.getSelectedUserScale(); Editor.setSelectedScale(v, y, z); }, 0.05);
      numField(grid, 'Scale Y', () => Editor.getSelectedUserScale()[1], v => { const [x, , z] = Editor.getSelectedUserScale(); Editor.setSelectedScale(x, v, z); }, 0.05);
      numField(grid, 'Scale Z', () => Editor.getSelectedUserScale()[2], v => { const [x, y] = Editor.getSelectedUserScale(); Editor.setSelectedScale(x, y, v); }, 0.05);
    }
  }
  cb.onchange = renderFields;
  renderFields();
  return wrap;
}

function buildRecolorSection(sel) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:8px; border-top:1px solid rgba(80,80,90,.2); padding-top:6px;';
  const label = document.createElement('small');
  label.textContent = 'Recolor — click a part, then pick a color';
  wrap.appendChild(label);
  const partsRow = mkRow();
  partsRow.style.flexWrap = 'wrap';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.style.cssText = 'margin-top:6px; width:100%;';
  picker.disabled = true;
  let activePart = null;
  for (const { name, hex } of Editor.getSelectedParts()) {
    const s = swatch(hex);
    s.title = name;
    s.onclick = () => {
      activePart = name;
      for (const c of partsRow.children) c.style.borderColor = 'rgba(0,0,0,.25)';
      s.style.borderColor = '#222';
      picker.disabled = false;
      picker.value = hex;
    };
    partsRow.appendChild(s);
  }
  if (!partsRow.children.length) { const n = document.createElement('small'); n.style.opacity = '.6'; n.textContent = 'No named material parts.'; partsRow.appendChild(n); }
  picker.oninput = () => { if (activePart) Editor.recolorSelectedPart(activePart, picker.value); };
  wrap.append(partsRow, picker);
  return wrap;
}

function buildPolicySection(sel) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:8px; border-top:1px solid rgba(80,80,90,.2); padding-top:6px;';
  const label = document.createElement('small'); label.textContent = 'Material policy';
  const sel2 = document.createElement('select');
  sel2.style.cssText = 'width:100%; font:inherit; margin-top:4px;';
  sel2.append(new Option('Pack default', ''), new Option('Authored (keep textures/materials as exported)', 'authored'), new Option('Flat-matte (Quaternius nature look)', 'flat-matte'));
  sel2.value = sel.row.materialPolicy || '';
  sel2.onchange = () => Editor.setSelectedMaterialPolicy(sel2.value || null).catch(err => console.error('[world-editor] material policy change failed', err));
  wrap.append(label, sel2);
  return wrap;
}

function buildSwapSection(sel) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:8px; border-top:1px solid rgba(80,80,90,.2); padding-top:6px;';
  const label = document.createElement('small'); label.textContent = 'Swap model';
  const roomSel = document.createElement('select');
  roomSel.style.cssText = 'width:100%; font:inherit; margin-top:4px;';
  const variantSel = document.createElement('select');
  variantSel.style.cssText = 'width:100%; font:inherit; margin-top:4px;';
  const btn = mkButton('Swap'); btn.style.cssText += 'width:100%; margin-top:4px;';
  btn.onclick = () => {
    if (!variantSel.value) return;
    const { id, variant } = JSON.parse(variantSel.value);
    Editor.swapSelectedModel(id, variant).catch(err => console.error('[world-editor] model swap failed', err));
  };
  ensureRooms().then(loaded => {
    for (const room of loaded) roomSel.appendChild(new Option(`${room.key} (${room.slots.length})`, room.key));
    populateVariantSelect(variantSel, loaded[0]);
    roomSel.onchange = () => populateVariantSelect(variantSel, loaded.find(r => r.key === roomSel.value));
  });
  wrap.append(label, roomSel, variantSel, btn);
  return wrap;
}

function buildInspector(sel) {
  const wrap = document.createElement('div');
  const obj = sel.obj;
  const head = document.createElement('div');
  head.innerHTML = `<b>${sel.id}</b>${sel.row.locked ? ' <small style="opacity:.6">(locked)</small>' : ''}`;
  wrap.appendChild(head);

  const posGrid = fieldGrid();
  numField(posGrid, 'X', () => obj.position.x, v => Editor.setSelectedPosition(v, obj.position.y, obj.position.z));
  numField(posGrid, 'Y', () => obj.position.y, v => Editor.setSelectedPosition(obj.position.x, v, obj.position.z));
  numField(posGrid, 'Z', () => obj.position.z, v => Editor.setSelectedPosition(obj.position.x, obj.position.y, v));
  wrap.appendChild(posGrid);

  const toDeg = r => r * 180 / Math.PI;
  const rotGrid = fieldGrid();
  numField(rotGrid, 'Rot X°', () => toDeg(obj.rotation.x), v => Editor.setSelectedRotationDeg(v, toDeg(obj.rotation.y), toDeg(obj.rotation.z)), 1);
  numField(rotGrid, 'Rot Y°', () => toDeg(obj.rotation.y), v => Editor.setSelectedRotationDeg(toDeg(obj.rotation.x), v, toDeg(obj.rotation.z)), 1);
  numField(rotGrid, 'Rot Z°', () => toDeg(obj.rotation.z), v => Editor.setSelectedRotationDeg(toDeg(obj.rotation.x), toDeg(obj.rotation.y), v), 1);
  wrap.appendChild(rotGrid);

  wrap.appendChild(buildScaleSection(sel));
  wrap.appendChild(buildRecolorSection(sel));
  wrap.appendChild(buildPolicySection(sel));
  wrap.appendChild(buildSwapSection(sel));
  return wrap;
}

// COLLISION-PAINTER-SESSION — Editor v2 phase 1: switches the inspector
// between the existing Properties view (buildInspector, above) and the new
// Collision view below. Deliberately has no LOCAL "which tab" state of its
// own — Editor.isColliderTabOpen() is the single source of truth (also
// flips via the X hotkey in world-editor.js), so clicking a tab button here
// and pressing X do the exact same thing and can never drift out of sync.
function buildTabBar() {
  const row = mkRow();
  row.style.marginTop = '2px';
  const collisionOpen = Editor.isColliderTabOpen();
  const propBtn = mkButton('Properties');
  propBtn.style.cssText += `flex:1; ${collisionOpen ? 'opacity:.55;' : 'font-weight:700;'}`;
  propBtn.onclick = () => Editor.closeColliderTab();
  const colBtn = mkButton('Collision');
  colBtn.style.cssText += `flex:1; ${collisionOpen ? 'font-weight:700;' : 'opacity:.55;'}`;
  colBtn.onclick = () => Editor.openColliderTab();
  row.append(propBtn, colBtn);
  return row;
}

// One row per shape in the working spec, highlighting whichever index is
// currently gizmo-attached (Editor.getColliderShapeSelected()) — clicking a
// row is the panel-side equivalent of clicking the shape's 3D overlay.
function buildColliderShapeList(shapes, selIdx) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; gap:3px; margin-top:4px; max-height:140px; overflow:auto;';
  if (!shapes.length) {
    const n = document.createElement('small');
    n.style.opacity = '.6';
    n.textContent = 'No shapes yet — this model is walk-through.';
    wrap.appendChild(n);
    return wrap;
  }
  shapes.forEach((s, i) => {
    const b = mkButton(`${i}. ${s.type}${s.type === 'deck' ? ' (walk-on)' : ''}`);
    b.style.cssText += `width:100%; text-align:left; ${i === selIdx ? 'border-color:#c88; background:#fdf0e8;' : ''}`;
    b.onclick = () => Editor.selectColliderShape(i);
    wrap.appendChild(b);
  });
  return wrap;
}

// Numeric fields for whichever shape is currently selected — pos/rot are
// uniform across every type (getColliderShapeDisplay already resolves the
// deck y/pos[1] merge); size fields switch on `disp.type` since box/sphere/
// capsule/cone/deck each store their own dimensions under different field
// names (collider-catalogue.js's own vocabulary, not reinvented here).
function buildColliderShapeFields(disp0) {
  const idx = Editor.getColliderShapeSelected();
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:8px; border-top:1px solid rgba(80,80,90,.2); padding-top:6px;';
  const label = document.createElement('small');
  label.textContent = `Shape ${idx}: ${disp0.type}${disp0.role === 'deck' ? ' — walkable surface, not a wall' : ''}`;
  wrap.appendChild(label);

  // Every setter re-reads the CURRENT live shape via
  // Editor.getColliderShapeDisplay(idx) at the moment it fires, not the
  // `disp0` snapshot this function was built with — patchColliderShapePos
  // et al. deliberately don't trigger a full panel re-render per keystroke
  // (same "don't steal focus" reasoning as every other numField in this
  // file), so without this, editing field B after already editing field A
  // in the same render cycle would silently revert A back to its stale
  // pre-edit value — the exact bug buildScaleSection's own per-axis scale
  // fields hit and fixed (see PROJECT-STATE.md's Phase 3 write-up) for the
  // identical reason, one level up (placed objects, not collider shapes).
  const live = () => Editor.getColliderShapeDisplay(idx) || disp0;

  const posGrid = fieldGrid();
  numField(posGrid, 'X', () => live().pos[0], v => { const d = live(); Editor.patchColliderShapePos(v, d.pos[1], d.pos[2]); });
  numField(posGrid, 'Y', () => live().pos[1], v => { const d = live(); Editor.patchColliderShapePos(d.pos[0], v, d.pos[2]); });
  numField(posGrid, 'Z', () => live().pos[2], v => { const d = live(); Editor.patchColliderShapePos(d.pos[0], d.pos[1], v); });
  wrap.appendChild(posGrid);

  // Rotation is a genuine no-op for sphere (radius is direction-independent)
  // in core/colliders.js's actual math — hidden rather than shown-but-inert,
  // to not offer an affordance that silently does nothing.
  if (disp0.type !== 'sphere') {
    const rotGrid = fieldGrid();
    numField(rotGrid, 'Rot X°', () => live().rotDeg[0], v => { const d = live(); Editor.patchColliderShapeRotDeg(v, d.rotDeg[1], d.rotDeg[2]); }, 1);
    numField(rotGrid, 'Rot Y°', () => live().rotDeg[1], v => { const d = live(); Editor.patchColliderShapeRotDeg(d.rotDeg[0], v, d.rotDeg[2]); }, 1);
    numField(rotGrid, 'Rot Z°', () => live().rotDeg[2], v => { const d = live(); Editor.patchColliderShapeRotDeg(d.rotDeg[0], d.rotDeg[1], v); }, 1);
    wrap.appendChild(rotGrid);
  }

  const sizeGrid = fieldGrid();
  if (disp0.type === 'box') {
    numField(sizeGrid, 'Size X', () => live().raw.size?.[0] ?? 1, v => { const r = live().raw; Editor.patchColliderShape({ size: [v, r.size?.[1] ?? 1, r.size?.[2] ?? 1] }); }, 0.05);
    numField(sizeGrid, 'Size Y', () => live().raw.size?.[1] ?? 1, v => { const r = live().raw; Editor.patchColliderShape({ size: [r.size?.[0] ?? 1, v, r.size?.[2] ?? 1] }); }, 0.05);
    numField(sizeGrid, 'Size Z', () => live().raw.size?.[2] ?? 1, v => { const r = live().raw; Editor.patchColliderShape({ size: [r.size?.[0] ?? 1, r.size?.[1] ?? 1, v] }); }, 0.05);
  } else if (disp0.type === 'sphere') {
    numField(sizeGrid, 'Radius', () => live().raw.r ?? 0.5, v => Editor.patchColliderShape({ r: v }), 0.05);
  } else if (disp0.type === 'capsule' || disp0.type === 'cone') {
    numField(sizeGrid, 'Radius', () => live().raw.r ?? 0.5, v => Editor.patchColliderShape({ r: v }), 0.05);
    numField(sizeGrid, 'Height', () => live().raw.h ?? 1, v => Editor.patchColliderShape({ h: v }), 0.05);
  } else if (disp0.type === 'deck') {
    numField(sizeGrid, 'Size X', () => live().raw.size?.[0] ?? 1, v => { const r = live().raw; Editor.patchColliderShape({ size: [v, r.size?.[1] ?? 1] }); }, 0.05);
    numField(sizeGrid, 'Size Z', () => live().raw.size?.[1] ?? 1, v => { const r = live().raw; Editor.patchColliderShape({ size: [r.size?.[0] ?? 1, v] }); }, 0.05);
  }
  wrap.appendChild(sizeGrid);
  return wrap;
}

function buildCollisionTab(sel) {
  const wrap = document.createElement('div');

  const catId = Editor.getColliderCatalogueId();
  const idLabel = document.createElement('small');
  idLabel.style.cssText = 'display:block; opacity:.6; word-break:break-all; margin-top:6px;';
  idLabel.textContent = catId || '(no catalogue id)';
  wrap.appendChild(idLabel);

  const staticRow = document.createElement('label');
  staticRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-top:8px;';
  const staticCb = document.createElement('input'); staticCb.type = 'checkbox';
  staticCb.checked = Editor.getColliderIsStatic();
  staticCb.onchange = () => Editor.setColliderStatic(staticCb.checked);
  const staticLabel = document.createElement('span'); staticLabel.textContent = 'Static (bake once — buildings/docks/decor)';
  staticRow.append(staticCb, staticLabel);
  wrap.appendChild(staticRow);

  const targetLabel = document.createElement('small');
  targetLabel.style.cssText = 'display:block; margin-top:8px; opacity:.75;';
  targetLabel.textContent = 'Apply to:';
  const targetSel = document.createElement('select');
  targetSel.style.cssText = 'width:100%; font:inherit; margin-top:2px;';
  targetSel.append(
    new Option(`ALL placements of ${catId ? catId.split(':').slice(0, 3).join(':') : 'this model'}`, 'family'),
    new Option('Just this instance', 'instance'),
  );
  targetSel.value = Editor.getColliderTarget();
  targetSel.onchange = () => Editor.setColliderTarget(targetSel.value);
  wrap.append(targetLabel, targetSel);

  const shapes = Editor.getColliderShapes();
  const selIdx = Editor.getColliderShapeSelected();
  const listLabel = document.createElement('small');
  listLabel.style.cssText = 'display:block; margin-top:10px; opacity:.75;';
  listLabel.textContent = `Shapes (${shapes.length}) — click to select, [ / ] to cycle`;
  wrap.appendChild(listLabel);
  wrap.appendChild(buildColliderShapeList(shapes, selIdx));

  const addRow = mkRow();
  const addSel = document.createElement('select');
  addSel.style.cssText = 'flex:1; font:inherit;';
  for (const t of ['box', 'sphere', 'capsule', 'cone', 'deck']) addSel.appendChild(new Option(t, t));
  const addBtn = mkButton('Add shape');
  addBtn.onclick = () => Editor.addColliderShape(addSel.value);
  addRow.append(addSel, addBtn);
  wrap.appendChild(addRow);

  const delBtn = mkButton('Delete selected shape (Del)');
  delBtn.style.cssText += 'width:100%; margin-top:6px; color:#a33; border-color:#a33;';
  delBtn.disabled = selIdx === null;
  delBtn.onclick = () => Editor.deleteColliderShape();
  wrap.appendChild(delBtn);

  if (selIdx !== null) {
    const disp = Editor.getColliderShapeDisplay(selIdx);
    if (disp) wrap.appendChild(buildColliderShapeFields(disp));
  }

  const exportRow = mkRow();
  exportRow.style.marginTop = '10px';
  const exportBtn = mkButton(Editor.isColliderDirty() ? 'Export colliders*' : 'Export colliders');
  exportBtn.style.flex = '1';
  exportBtn.onclick = () => exportColliders();
  exportRow.appendChild(exportBtn);
  wrap.appendChild(exportRow);
  const exportNote = document.createElement('small');
  exportNote.style.cssText = 'display:block; opacity:.6; margin-top:4px;';
  exportNote.textContent = Editor.getColliderTarget() === 'instance'
    ? 'Downloads this zone\'s edits.js (same as the top-bar Save) — this override lives on the placement, not the catalogue.'
    : 'Downloads collider-catalogue.js — paste over world/core/collider-catalogue.js.';
  wrap.appendChild(exportNote);

  return wrap;
}

// World Editor Phase 4 ("scatter reach") — a scattered instance (a tree/
// rock/bush from the catalogue-flora scatter pass, not a hand-placed
// prop). No gizmo, no position/rotation/scale fields (see world-editor.js's
// selectScatter comment for why) — just its id, a hide action, and a
// family-wide override (every instance of this family, every season/state/
// variant group currently on screen).
function buildScatterInspector(hit) {
  const wrap = document.createElement('div');
  const head = document.createElement('div');
  head.innerHTML = `<b>${hit.id}</b> <small style="opacity:.6">(scatter instance)</small>`;
  wrap.appendChild(head);

  const hideBtn = mkButton('Hide this instance');
  hideBtn.style.cssText += 'width:100%; margin-top:8px; color:#a33; border-color:#a33;';
  hideBtn.onclick = () => Editor.hideSelectedScatter();
  wrap.appendChild(hideBtn);

  const famWrap = document.createElement('div');
  famWrap.style.cssText = 'margin-top:8px; border-top:1px solid rgba(80,80,90,.2); padding-top:6px;';
  const famLabel = document.createElement('small');
  famLabel.textContent = `Apply to whole "${hit.family}" family`;
  famWrap.appendChild(famLabel);

  const partsRow = mkRow();
  partsRow.style.flexWrap = 'wrap';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.style.cssText = 'margin-top:6px; width:100%;';
  picker.disabled = true;
  let activePart = null;
  for (const { name, hex } of Editor.getFamilyParts(hit.family)) {
    const s = swatch(hex);
    s.title = name;
    s.onclick = () => {
      activePart = name;
      for (const c of partsRow.children) c.style.borderColor = 'rgba(0,0,0,.25)';
      s.style.borderColor = '#222';
      picker.disabled = false;
      picker.value = hex;
    };
    partsRow.appendChild(s);
  }
  picker.oninput = () => { if (activePart) Editor.recolorFamily(hit.family, activePart, picker.value); };
  famWrap.append(partsRow, picker);

  const polSel = document.createElement('select');
  polSel.style.cssText = 'width:100%; font:inherit; margin-top:6px;';
  polSel.append(new Option('Pack default', ''), new Option('Authored', 'authored'), new Option('Flat-matte', 'flat-matte'));
  polSel.onchange = () => Editor.setFamilyMaterialPolicy(hit.family, polSel.value || null);
  const polNote = document.createElement('small');
  polNote.style.cssText = 'display:block; opacity:.6; margin-top:4px;';
  polNote.textContent = 'Material policy applies on next zone reload, not live.';
  famWrap.append(polSel, polNote);

  wrap.appendChild(famWrap);
  return wrap;
}

export async function initEditorPanel() {
  root = document.createElement('div');
  root.id = 'worldEditorPanel';
  root.style.cssText = `position:fixed; left:14px; top:44px; z-index:6; display:none;
    font:13px/1.4 ui-sans-serif, system-ui, sans-serif; color:#22222a;
    background:rgba(240,239,246,.94); border:1px solid rgba(80,80,90,.35);
    border-radius:8px; padding:10px 12px; width:280px; max-height:calc(82vh - 30px); overflow:auto;
    box-shadow:0 6px 22px rgba(20,20,30,.22);`;
  document.body.appendChild(root);

  // --- top bar (Phase 5): zone, selection, gizmo mode, unsaved dot, Save/Export — always
  // visible while the editor is open, independent of (and above) the property panel below.
  const topBar = document.createElement('div');
  topBar.id = 'worldEditorTopBar';
  topBar.style.cssText = `position:fixed; top:0; left:0; right:0; z-index:6;
    font:12px ui-sans-serif, system-ui, sans-serif; color:#22222a;
    background:rgba(240,239,246,.96); border-bottom:1px solid rgba(80,80,90,.35);
    padding:6px 14px; align-items:center; gap:14px; display:none;`;
  const zoneEl = document.createElement('b');
  const selEl = document.createElement('span');
  const modeEl = document.createElement('span');
  const dotEl = document.createElement('span');
  dotEl.title = 'No unsaved changes';
  dotEl.style.cssText = 'width:8px; height:8px; border-radius:50%; background:#3a3; flex:0 0 auto;';
  // Collision tab's own HUD line + dot (Editor v2 phase 1) — see render()'s
  // own comment on why this is a SEPARATE indicator from dotEl above (two
  // different export targets, collider-catalogue.js vs edits.js).
  const colliderHudEl = document.createElement('span');
  colliderHudEl.style.cssText = 'opacity:.8; display:none;';
  const colliderDotEl = document.createElement('span');
  colliderDotEl.style.cssText = 'width:8px; height:8px; border-radius:50%; background:#3a3; flex:0 0 auto;';
  const copyBtn = mkButton('Copy selection JSON');
  copyBtn.onclick = () => {
    const text = Editor.copySelectionAsJSON();
    if (!text) return;
    const old = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = old; }, 1200);
  };
  const saveBtnTop = mkButton('Save');
  saveBtnTop.onclick = () => exportEdits();
  const spacer = document.createElement('span');
  spacer.style.flex = '1';
  topBar.append(zoneEl, selEl, modeEl, dotEl, colliderHudEl, colliderDotEl, spacer, copyBtn, saveBtnTop);
  document.body.appendChild(topBar);
  Editor.onDirty(isDirty => {
    dotEl.style.background = isDirty ? '#c33' : '#3a3';
    dotEl.title = isDirty ? 'Unsaved changes' : 'No unsaved changes';
  });

  const title = document.createElement('div');
  title.innerHTML = '<b>World Editor</b><br><small style="opacity:.65">click select (placed OR scattered) · T/R/Y gizmo · Del remove/hide · Ctrl/Cmd+D duplicate · Esc cancel · ` close<br><b>X</b> Collision tab · <b>[</b>/<b>]</b> cycle shapes (while open)</small>';
  root.appendChild(title);

  // --- catalogue picker: room -> variant -> Place (armed, next canvas click drops it) ---
  const roomSel = document.createElement('select');
  roomSel.style.cssText = 'width:100%; font:inherit; margin-top:8px;';
  roomSel.appendChild(new Option('Loading catalogue…', ''));
  root.appendChild(roomSel);

  const variantSel = document.createElement('select');
  variantSel.style.cssText = 'width:100%; font:inherit; margin-top:6px;';
  root.appendChild(variantSel);

  const placeRow = mkRow();
  const placeBtn = mkButton('Place (click terrain)');
  placeBtn.style.flex = '1';
  placeBtn.onclick = () => {
    if (!variantSel.value) return;
    const { id, variant } = JSON.parse(variantSel.value);
    Editor.armPlacement(id, variant);
  };
  placeRow.appendChild(placeBtn);
  root.appendChild(placeRow);

  ensureRooms().then(loaded => {
    roomSel.innerHTML = '';
    for (const room of loaded) roomSel.appendChild(new Option(`${room.key} (${room.slots.length})`, room.key));
    populateVariantSelect(variantSel, loaded[0]);
    roomSel.onchange = () => populateVariantSelect(variantSel, loaded.find(r => r.key === roomSel.value));
  });

  // --- toolbar: selection actions + ground-snap + save (rebuilt is unnecessary — just re-read state) ---
  const toolRow1 = mkRow();
  const dupBtn = mkButton('Duplicate'); dupBtn.style.flex = '1';
  dupBtn.onclick = () => Editor.duplicateSelectedObject().catch(err => console.error('[world-editor] duplicate failed', err));
  const delBtn = mkButton('Delete'); delBtn.style.flex = '1'; delBtn.style.color = '#a33'; delBtn.style.borderColor = '#a33';
  delBtn.onclick = () => Editor.deleteSelectedObject();
  toolRow1.append(dupBtn, delBtn);
  root.appendChild(toolRow1);

  const lockRow = document.createElement('label');
  lockRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-top:8px;';
  const lockCb = document.createElement('input'); lockCb.type = 'checkbox';
  lockCb.onchange = () => Editor.toggleSelectedLock();
  const lockLabel = document.createElement('span'); lockLabel.textContent = 'Locked (no select/transform)';
  lockRow.append(lockCb, lockLabel);
  root.appendChild(lockRow);

  const snapRow = document.createElement('label');
  snapRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-top:4px;';
  const snapCb = document.createElement('input'); snapCb.type = 'checkbox'; snapCb.checked = Editor.getGroundSnap();
  snapCb.onchange = () => Editor.setGroundSnap(snapCb.checked);
  const snapLabel = document.createElement('span'); snapLabel.textContent = 'Ground-snap Y after drag';
  snapRow.append(snapCb, snapLabel);
  root.appendChild(snapRow);

  const modeRow = mkRow();
  for (const [m, label] of [['translate', 'Move (T)'], ['rotate', 'Rotate (R)'], ['scale', 'Scale (Y)']]) {
    const b = mkButton(label);
    b.style.flex = '1';
    b.onclick = () => Editor.setMode(m);
    b.dataset.mode = m;
    modeRow.appendChild(b);
  }
  root.appendChild(modeRow);

  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'margin-top:8px; border-top:1px solid rgba(80,80,90,.25); padding-top:8px;';
  root.appendChild(statusEl);

  const saveRow = mkRow();
  const saveBtn = mkButton('Save (download + copy)'); saveBtn.style.flex = '1';
  saveBtn.onclick = () => exportEdits();
  saveRow.appendChild(saveBtn);
  root.appendChild(saveRow);

  function render() {
    const isOpen = Editor.isOpen();
    root.style.display = isOpen ? '' : 'none';
    topBar.style.display = isOpen ? 'flex' : 'none';
    if (!isOpen) return;
    const sel = Editor.getSelected();
    const scatterSel = Editor.getSelectedScatter();
    const armed = Editor.getArmedPlacement();
    const collisionOpen = Editor.isColliderTabOpen();
    zoneEl.textContent = Editor.getZoneId() || '';
    selEl.textContent = sel ? `selected: ${sel.id}` : scatterSel ? `selected: ${scatterSel.id}` : armed ? 'placing…' : 'nothing selected';
    modeEl.textContent = sel ? `[${Editor.getMode()}]` : '';
    dotEl.style.background = Editor.isDirty() ? '#c33' : '#3a3';
    dotEl.title = Editor.isDirty() ? 'Unsaved changes' : 'No unsaved changes';
    // Collision tab's own HUD line (Phase 5) — a separate dot from the
    // placement Save dot above: they write to two different files
    // (collider-catalogue.js / edits.js's `collide` field, depending on
    // target), so conflating them into one indicator would be misleading.
    if (collisionOpen && sel) {
      const shapes = Editor.getColliderShapes();
      const idx = Editor.getColliderShapeSelected();
      colliderHudEl.style.display = '';
      colliderHudEl.textContent = `collision: ${shapes.length} shape${shapes.length === 1 ? '' : 's'}`
        + (idx !== null ? ` · #${idx} (${shapes[idx]?.type})` : '')
        + ` · ${Editor.getColliderTarget()} · ${Editor.getColliderIsStatic() ? 'static' : 'dynamic'}`;
      colliderDotEl.style.background = Editor.isColliderDirty() ? '#c33' : '#3a3';
      colliderDotEl.title = Editor.isColliderDirty() ? 'Unsaved collider changes' : 'No unsaved collider changes';
    } else {
      colliderHudEl.style.display = 'none';
    }
    lockCb.checked = sel ? !!sel.row.locked : false;
    lockCb.disabled = !sel;
    dupBtn.disabled = !sel;
    delBtn.disabled = !sel;
    const mode = Editor.getMode();
    for (const b of modeRow.children) b.style.opacity = b.dataset.mode === mode ? '1' : '.55';
    statusEl.innerHTML = '';
    if (armed) {
      const hint = document.createElement('div');
      hint.innerHTML = `<b>Click terrain to place…</b> <small style="opacity:.6">(Esc cancels)</small>`;
      statusEl.appendChild(hint);
    } else if (sel) {
      statusEl.appendChild(buildTabBar());
      statusEl.appendChild(collisionOpen ? buildCollisionTab(sel) : buildInspector(sel));
    } else if (scatterSel) {
      statusEl.appendChild(buildScatterInspector(scatterSel));
    } else {
      const hint = document.createElement('small');
      hint.style.opacity = '.6';
      hint.textContent = 'Nothing selected';
      statusEl.appendChild(hint);
    }
  }
  Editor.onSelectionChange(render);
  Editor.onColliderSelectionChange(render); // separate notification stream — see world-editor.js's colliderNotify
  render();
}

function exportEdits() {
  const zoneId = Editor.getZoneId() || 'unknown';
  const text = Editor.exportEditsText(zoneId);
  const blob = new Blob([text], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${zoneId}-edits.js`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  navigator.clipboard?.writeText(text).catch(() => {});
  Editor.clearDirty();
  console.log(`[world-editor] exported ${zoneId}/edits.js (${text.length} chars) — download + clipboard`);
}

// COLLISION-PAINTER-SESSION (Phase 4 — TARGET + EXPORT). Which file actually
// gets downloaded depends on the Collision tab's own target toggle:
// 'family' -> collider-catalogue.js (Editor.exportColliderCatalogueText,
// same Blob/anchor/clipboard mechanics as exportEdits above — this module
// owns the download side-effect for both, colliders.js/world-editor.js stay
// pure text generation); 'instance' -> the spec was just written onto this
// row's own `collide` field (Editor.applyColliderTarget), so the RIGHT
// download is the existing edits.js Save, reused as-is rather than
// duplicated. Either branch also needs to clear the Collision tab's OWN
// dirty flag — exportColliderCatalogueText does this itself for the
// 'family' path (see its own code), so only 'instance' needs it here.
function exportColliders() {
  const target = Editor.applyColliderTarget();
  if (!target) return;
  if (target === 'instance') {
    exportEdits(); // downloads/copies edits.js; also clears the PLACEMENT dot (applyColliderTarget already marked it)
    Editor.clearColliderDirty();
    return;
  }
  const text = Editor.exportColliderCatalogueText();
  const blob = new Blob([text], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'collider-catalogue.js';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  navigator.clipboard?.writeText(text).catch(() => {});
  Editor.clearColliderDirty();
  console.log(`[world-editor] exported collider-catalogue.js (${text.length} chars) — download + clipboard`);
}
