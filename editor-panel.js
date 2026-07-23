// Grassland World — Area Designer DOM overlay: add/export toolbar (built
// once) + a property panel that refreshes on every selection/transform
// change. Talks to editor.js only through its exported functions/callback —
// never reaches into its internals.
import * as Editor from './editor.js';
import { NATIVE_CATALOG, KENNEY_PACK } from './props.js';

function mkButton(label) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'font: inherit; padding:4px 8px; border-radius:6px; border:1px solid rgba(107,79,53,.35); background:#fdf6e8; color:#4a3826; cursor:pointer;';
  return b;
}
function mkRow() {
  const r = document.createElement('div');
  r.style.cssText = 'display:flex; gap:6px; margin-top:6px; align-items:center;';
  return r;
}

export function initEditorPanel() {
  const root = document.createElement('div');
  root.id = 'editorPanel';
  root.style.cssText = `position:fixed; left:14px; top:14px; z-index:4; display:none;
    font:13px/1.4 ui-sans-serif, system-ui, sans-serif; color:#2e4632;
    background:rgba(236,233,216,.92); border:1px solid rgba(107,79,53,.35);
    border-radius:8px; padding:10px 12px; width:240px; max-height:80vh; overflow:auto;
    box-shadow:0 6px 22px rgba(46,70,50,.18);`;
  document.body.appendChild(root);

  const title = document.createElement('div');
  title.innerHTML = '<b>Area Designer</b><br><small style="opacity:.65">click to select · Tab cycle gizmo · Del remove · Esc deselect · L close</small>';
  root.appendChild(title);

  // --- toolbar: built once, never rebuilt (so the dropdown keeps its state) ---
  const catalogRow = mkRow();
  const select = document.createElement('select');
  select.style.cssText = 'flex:1; min-width:0; font:inherit;';
  const nativeGroup = document.createElement('optgroup'); nativeGroup.label = 'Native';
  for (const name of Object.keys(NATIVE_CATALOG)) nativeGroup.appendChild(new Option(name, 'native:' + name));
  select.appendChild(nativeGroup);
  const byPack = {};
  for (const [name, pack] of Object.entries(KENNEY_PACK)) (byPack[pack] ||= []).push(name);
  for (const pack of Object.keys(byPack)) {
    const g = document.createElement('optgroup'); g.label = pack;
    for (const name of byPack[pack]) g.appendChild(new Option(name, 'kenney:' + name));
    select.appendChild(g);
  }
  const addBtn = mkButton('Add');
  addBtn.onclick = () => { const [kind, name] = select.value.split(':'); Editor.spawnFromCatalog(kind, name); };
  catalogRow.append(select, addBtn);
  root.appendChild(catalogRow);

  const actionRow = mkRow();
  const exportBtn = mkButton('Export…'); exportBtn.style.flex = '1';
  exportBtn.onclick = openExportModal;
  const closeBtn = mkButton('Close');
  closeBtn.onclick = () => Editor.toggle();
  actionRow.append(exportBtn, closeBtn);
  root.appendChild(actionRow);

  // --- property panel: rebuilt on every notify (selection or live drag update) ---
  const propsEl = document.createElement('div');
  root.appendChild(propsEl);

  function render() {
    const open = Editor.isEditorOpen();
    root.style.display = open ? '' : 'none';
    if (!open) return;
    const sel = Editor.getSelected();
    propsEl.innerHTML = '';
    if (sel) propsEl.appendChild(buildPropertyPanel(sel));
  }
  Editor.onSelect(render);
  render();
}

function numField(grid, label, get, set, step = 0.1) {
  const l = document.createElement('span'); l.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'number'; inp.step = step; inp.value = +get().toFixed(3);
  inp.style.cssText = 'width:100%; font:inherit;';
  inp.oninput = () => { const v = parseFloat(inp.value); if (!Number.isNaN(v)) set(v); };
  grid.append(l, inp);
}

function buildPropertyPanel(sel) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'border-top:1px solid rgba(107,79,53,.25); padding-top:8px; margin-top:8px;';
  const obj = sel.obj;
  const head = document.createElement('div');
  head.innerHTML = `<b>${sel.name}</b> <small style="opacity:.6">(${sel.kind})</small>`;
  wrap.appendChild(head);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns:auto 1fr; gap:4px 6px; align-items:center; margin-top:6px;';
  numField(grid, 'X', () => obj.position.x, v => obj.position.x = v);
  numField(grid, 'Y', () => obj.position.y, v => obj.position.y = v);
  numField(grid, 'Z', () => obj.position.z, v => obj.position.z = v);
  numField(grid, 'Rot°', () => obj.rotation.y * 180 / Math.PI, v => obj.rotation.y = v * Math.PI / 180, 1);
  numField(grid, 'Scale', () => obj.scale.x, v => obj.scale.setScalar(v), 0.05);
  wrap.appendChild(grid);

  const lockRow = document.createElement('label');
  lockRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-top:6px;';
  const lockCb = document.createElement('input'); lockCb.type = 'checkbox'; lockCb.checked = Editor.getLockY();
  lockCb.onchange = () => Editor.setLockY(lockCb.checked);
  const lockLabel = document.createElement('span'); lockLabel.textContent = 'Lock Y (skip ground-snap)';
  lockRow.append(lockCb, lockLabel);
  wrap.appendChild(lockRow);

  const modeRow = mkRow();
  modeRow.style.marginTop = '8px';
  for (const [m, label] of [['translate', 'Move'], ['rotate', 'Rotate'], ['scale', 'Scale']]) {
    const b = mkButton(label);
    b.style.opacity = Editor.getMode() === m ? '1' : '.55';
    b.style.flex = '1';
    b.onclick = () => Editor.setMode(m);
    modeRow.appendChild(b);
  }
  wrap.appendChild(modeRow);

  const delBtn = mkButton('Delete');
  delBtn.style.cssText += 'margin-top:8px; width:100%; color:#a33; border-color:#a33;';
  delBtn.onclick = () => Editor.deleteSelected();
  wrap.appendChild(delBtn);

  return wrap;
}

function openExportModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed; inset:0; z-index:10; background:rgba(20,20,20,.5); display:flex; align-items:center; justify-content:center;';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  const box = document.createElement('div');
  box.style.cssText = 'background:#fdf6e8; border-radius:10px; padding:16px; width:min(720px,90vw); max-height:80vh; display:flex; flex-direction:column; gap:8px; font:13px ui-sans-serif, system-ui, sans-serif; color:#2e4632;';
  const titleEl = document.createElement('b'); titleEl.textContent = 'Paste into props.js (replaces NATIVE_PLACEMENTS / KENNEY_PLACEMENTS)';
  const ta = document.createElement('textarea');
  ta.readOnly = true;
  ta.style.cssText = 'width:100%; height:50vh; font:12px/1.4 ui-monospace, monospace; white-space:pre; resize:vertical;';
  ta.value = Editor.exportSnippet();
  const row = mkRow(); row.style.justifyContent = 'flex-end';
  const copyBtn = mkButton('Copy');
  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(ta.value); copyBtn.textContent = 'Copied!'; setTimeout(() => copyBtn.textContent = 'Copy', 1200); }
    catch { ta.focus(); ta.select(); }
  };
  const closeBtn = mkButton('Close'); closeBtn.onclick = () => overlay.remove();
  row.append(copyBtn, closeBtn);
  box.append(titleEl, ta, row);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  ta.focus(); ta.select();
}
