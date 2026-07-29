// World Shell — World Editor (Layer 4) DOM: catalogue picker + toolbar +
// a minimal status line (the full per-object property inspector is Phase
// 3 — this phase only needs enough UI to select/place/duplicate/delete/
// lock/save). Talks to core/world-editor.js only through its exported
// functions/callback, never reaches into its internals — same discipline
// grassland/editor-panel.js already established against grassland/editor.js.
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
    statusEl.innerHTML = armed
      ? `<b>Click terrain to place…</b> <small style="opacity:.6">(Esc cancels)</small>`
      : sel
        ? `<b>Selected:</b> ${sel.id}${sel.row.locked ? ' <small style="opacity:.6">(locked)</small>' : ''}`
        : `<small style="opacity:.6">Nothing selected</small>`;
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
