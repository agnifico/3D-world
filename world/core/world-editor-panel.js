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

export async function initEditorPanel() {
  root = document.createElement('div');
  root.id = 'worldEditorPanel';
  root.style.cssText = `position:fixed; left:14px; top:14px; z-index:6; display:none;
    font:13px/1.4 ui-sans-serif, system-ui, sans-serif; color:#22222a;
    background:rgba(240,239,246,.94); border:1px solid rgba(80,80,90,.35);
    border-radius:8px; padding:10px 12px; width:280px; max-height:82vh; overflow:auto;
    box-shadow:0 6px 22px rgba(20,20,30,.22);`;
  document.body.appendChild(root);

  const title = document.createElement('div');
  title.innerHTML = '<b>World Editor</b><br><small style="opacity:.65">click select · T/R/Y gizmo · Del remove · Ctrl/Cmd+D duplicate · Esc cancel · ` close</small>';
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
    if (!isOpen) return;
    const sel = Editor.getSelected();
    const armed = Editor.getArmedPlacement();
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
      statusEl.appendChild(buildInspector(sel));
    } else {
      const hint = document.createElement('small');
      hint.style.opacity = '.6';
      hint.textContent = 'Nothing selected';
      statusEl.appendChild(hint);
    }
  }
  Editor.onSelectionChange(render);
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
  console.log(`[world-editor] exported ${zoneId}/edits.js (${text.length} chars) — download + clipboard`);
}
