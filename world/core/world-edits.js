// World Shell — World Editor (Layer 4) data layer. Reads a zone's edits.js
// and applies its `placed[]` array against the live scene; familyOverrides/
// scatterEdits are consumed directly by catalogue-flora.js's scatter pass
// (Phase 4 — scatter reach), not here, but the schema for all three lives in
// one place so every zone/consumer agrees on it.
//
// --- edits.js schema (a zone's `export const edits = {...}`) ---
//   placed: [{
//     id,             // stable string, assigned once (by the editor on creation) and never reused —
//                     // identity for select/save/delete; NOT derived from position/index.
//     catalogueId,    // core/catalogue.js id — resolved via resolveAsset(manifest, catalogueId, variant)
//     variant,        // optional explicit variant number (default: the entry's first)
//     x, y, z,        // y === null/undefined -> terrain-snap at apply time (zone.terrainHeight(x,z));
//                     // a number -> explicit height (e.g. a floating prop at WATER_Y-relative height)
//     rot,            // [x,y,z] Euler radians, default [0,0,0] — full 3-axis (see the Phase 0 rotation fix)
//     scale,          // number (uniform) or [sx,sy,sz], default 1 — multiplies ONTO the resolved pack's
//                     // own policy.scaleFactor (core/asset-policy.js), same convention the scatter
//                     // bindings already use. This is the user-facing "looks right by default" number
//                     // the inspector panel shows/edits, not the compounded final render scale.
//     tint,           // optional {MaterialName:'#hex'} remap, passed straight to loadTintedTemplate
//     materialPolicy, // optional 'authored'|'flat-matte' override; null/undefined = the resolved
//                     // pack's own default policy
//     locked,         // editor-only: true blocks selection/transform via the gizmo
//   }],
//   familyOverrides: { [family]: { catalogueId?, scale?, tint?, materialPolicy? } },
//   scatterEdits: { [instanceId]: { hidden?, scale?, rot?, tint?, catalogueId? } },
//
// Override precedence (most-specific wins): scatterEdits[id] > familyOverrides[family] > the zone's
// own bindings.js default — enforced where these are actually consumed (catalogue-flora.js, Phase 4),
// not here.
import { loadCatalogue, resolveAsset, parseCatalogueId } from './catalogue.js';
import { loadTintedTemplate } from './gltf-assets.js';

// This zone's currently-live placed[] objects:
// [{ id, obj, row, zoneId, policyScaleFactor }]. `policyScaleFactor` is the
// resolved pack's own scale correction (core/asset-policy.js) captured at
// build time — serializePlaced() divides it back out of the object's LIVE
// scale (which may have been gizmo-dragged since) to recover the user-facing
// `row.scale` number, so save/reload never compounds it. Module-level
// singleton, same discipline as core/height-registry.js et al (core/
// zone.js: "the shell resets [shared registries] right before the NEXT
// zone's build() runs") — reset at the top of every applyEdits() call.
let _registry = [];
// The raw editsModule handed to the most recent applyEdits() call — kept so
// the World Editor's Save (Phase 2) can serialize the CURRENT familyOverrides/
// scatterEdits (Phase 4 mutates these live in place) instead of guessing/
// dropping them; this module doesn't otherwise read from it itself.
let _editsModule = null;
// Every placed[] id ever seen or handed out this session (see genPlacedId
// below) — seeded from each zone's OWN loaded rows in applyEdits so a new
// placement can never collide with an id that came from edits.js itself
// (not just ids the editor generated in-session).
const _issuedIds = new Set();

export function getPlacedRegistry() { return _registry; }
export function getPlacedRow(id) { return _registry.find(r => r.id === id); }
export function getEditsModule() { return _editsModule; }

function applyScale(obj, scale, scaleFactor) {
  if (Array.isArray(scale)) obj.scale.set(scale[0] * scaleFactor, scale[1] * scaleFactor, scale[2] * scaleFactor);
  else obj.scale.setScalar((scale ?? 1) * scaleFactor);
}

async function buildPlacedObject(zone, manifest, row) {
  const resolved = resolveAsset(manifest, row.catalogueId, row.variant);
  if (!resolved) { console.warn(`[world-edits] placed "${row.id}": catalogue id not found: ${row.catalogueId}`); return null; }
  const policy = row.materialPolicy ? { ...resolved.policy, material: row.materialPolicy } : resolved.policy;
  let template;
  try {
    template = await loadTintedTemplate(resolved.url, row.tint || null, policy);
  } catch (e) {
    console.warn(`[world-edits] placed "${row.id}" failed to load (${e.message})`);
    return null;
  }
  const obj = template.clone(true);
  applyScale(obj, row.scale, resolved.policy.scaleFactor);
  const [rx, ry, rz] = row.rot || [0, 0, 0];
  obj.rotation.set(rx, ry, rz);
  const y = (row.y === null || row.y === undefined) ? zone.terrainHeight(row.x, row.z) : row.y;
  obj.position.set(row.x, y, row.z);
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  obj.userData.__editsId = row.id;
  return { obj, policyScaleFactor: resolved.policy.scaleFactor };
}

// Called once per zone build (fire-and-forget, same convention as
// instantiateCatalogueFlora/placeMainShip): loads and places every
// placed[] row, registering each into the live registry above so the World
// Editor can select/transform/duplicate/delete/save it. `zone` is a small
// { id, terrainHeight, WATER_Y } — each zone.js already has these imported
// directly, no need to pass the whole zone contract object.
export async function applyEdits(ctx, scene, zone, editsModule) {
  _registry = [];
  _editsModule = editsModule;
  const placed = editsModule?.placed || [];
  if (!placed.length) return;
  const manifest = await loadCatalogue();
  // Kick off every row's load concurrently (same reasoning as catalogue-
  // flora.js's own resolved-then-parallel-await pattern) — placed[] is
  // expected to stay small, but there's no reason to serialize it either.
  const pending = placed.map(row => buildPlacedObject(zone, manifest, row));
  const built = await Promise.all(pending);
  for (let i = 0; i < placed.length; i++) {
    const b = built[i];
    if (!b) continue;
    scene.add(b.obj);
    _registry.push({ id: placed[i].id, obj: b.obj, row: { ...placed[i] }, zoneId: zone.id, policyScaleFactor: b.policyScaleFactor });
    _issuedIds.add(placed[i].id);
  }
}

// ---------------------------------------------------------------------------
// World Editor mutation API (Phase 2 — edit mode). Every function below
// operates on the SAME live registry applyEdits() populated; core/world-
// editor.js is the only caller.
// ---------------------------------------------------------------------------

// A short, hand-editable id derived from the catalogue family.
export function genPlacedId(catalogueId) {
  const family = parseCatalogueId(catalogueId).family || 'obj';
  let n = 1;
  while (_issuedIds.has(`${family}-${n}`)) n++;
  const id = `${family}-${n}`;
  _issuedIds.add(id);
  return id;
}

export function removePlacedObject(scene, id) {
  const idx = _registry.findIndex(r => r.id === id);
  if (idx === -1) return false;
  scene.remove(_registry[idx].obj);
  _registry.splice(idx, 1);
  return true;
}

// Place-new (from the catalogue picker) or the target half of a duplicate —
// both just want "load this row, add it, register it" with no special-casing.
export async function addPlacedObject(scene, zone, row) {
  const manifest = await loadCatalogue();
  const built = await buildPlacedObject(zone, manifest, row);
  if (!built) return null;
  scene.add(built.obj);
  const rec = { id: row.id, obj: built.obj, row: { ...row }, zoneId: zone.id, policyScaleFactor: built.policyScaleFactor };
  _registry.push(rec);
  return rec;
}

// Duplicates the CURRENT live state of an existing placed object (not its
// stale build-time row — picks up any gizmo drag since) at a small offset,
// so it doesn't render exactly on top of the original.
export async function duplicatePlacedObject(scene, zone, id) {
  const src = _registry.find(r => r.id === id);
  if (!src) return null;
  const [row] = serializeRows([src]);
  const newRow = { ...row, id: genPlacedId(row.catalogueId), x: row.x + 1, z: row.z + 1 };
  return addPlacedObject(scene, zone, newRow);
}

// Rebuilds an EXISTING placed object in place under the SAME id, applying
// `patch` on top of its current live state (position/rotation/scale carry
// over from serializeRows, same "pick up any gizmo drag since" reasoning
// duplicatePlacedObject uses) — the inspector's live model-swap
// (`patch: {catalogueId, variant, tint:null}` — a different model's material
// names likely don't match the old tint, so it's dropped rather than
// silently mismatched) and material-policy toggle (`patch:
// {materialPolicy}`) both just want "reload with these fields changed."
// On failure (bad id, load error) the OLD object is left completely
// untouched — only swapped out once the replacement has actually loaded.
export async function rebuildPlacedObject(scene, zone, id, patch) {
  const idx = _registry.findIndex(r => r.id === id);
  if (idx === -1) return null;
  const old = _registry[idx];
  const [row] = serializeRows([old]);
  const newRow = { ...row, ...patch };
  const manifest = await loadCatalogue();
  const built = await buildPlacedObject(zone, manifest, newRow);
  if (!built) return null;
  scene.remove(old.obj);
  scene.add(built.obj);
  const rec = { id, obj: built.obj, row: { ...newRow, id }, zoneId: old.zoneId, policyScaleFactor: built.policyScaleFactor };
  _registry[idx] = rec;
  return rec;
}

// Reads each record's LIVE transform (position/rotation set directly, no
// policy involved, so read straight off the object) back into placed[]
// row shape — scale divides `policyScaleFactor` back out first, since
// buildPlacedObject multiplies it IN (see the schema comment up top: saved
// `scale` is always the pre-policy, user-facing number).
function serializeRows(records) {
  return records.map(rec => {
    const o = rec.obj;
    const scale = Array.isArray(rec.row.scale)
      ? [o.scale.x / rec.policyScaleFactor, o.scale.y / rec.policyScaleFactor, o.scale.z / rec.policyScaleFactor].map(n => +n.toFixed(4))
      : +(o.scale.x / rec.policyScaleFactor).toFixed(4);
    return {
      ...rec.row,
      x: +o.position.x.toFixed(3), y: +o.position.y.toFixed(3), z: +o.position.z.toFixed(3),
      rot: [o.rotation.x, o.rotation.y, o.rotation.z].map(n => +n.toFixed(4)),
      scale,
    };
  });
}
export function serializePlaced() { return serializeRows(_registry); }
