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
import { loadCatalogue, resolveAsset } from './catalogue.js';
import { loadTintedTemplate } from './gltf-assets.js';

// This zone's currently-live placed[] objects: [{ id, obj, row, zoneId }].
// Module-level singleton, same discipline as core/height-registry.js et al
// (core/zone.js: "the shell resets [shared registries] right before the
// NEXT zone's build() runs") — reset at the top of every applyEdits() call.
let _registry = [];

export function getPlacedRegistry() { return _registry; }
export function getPlacedRow(id) { return _registry.find(r => r.id === id); }

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
  return obj;
}

// Called once per zone build (fire-and-forget, same convention as
// instantiateCatalogueFlora/placeMainShip): loads and places every
// placed[] row, registering each into the live registry above so a later
// phase's editor can select/transform/duplicate/delete/save it. `zone` is
// a small { id, terrainHeight, WATER_Y } — each zone.js already has these
// imported directly, no need to pass the whole zone contract object.
export async function applyEdits(ctx, scene, zone, editsModule) {
  _registry = [];
  const placed = editsModule?.placed || [];
  if (!placed.length) return;
  const manifest = await loadCatalogue();
  // Kick off every row's load concurrently (same reasoning as catalogue-
  // flora.js's own resolved-then-parallel-await pattern) — placed[] is
  // expected to stay small, but there's no reason to serialize it either.
  const pending = placed.map(row => buildPlacedObject(zone, manifest, row));
  const objs = await Promise.all(pending);
  for (let i = 0; i < placed.length; i++) {
    const obj = objs[i];
    if (!obj) continue;
    scene.add(obj);
    _registry.push({ id: placed[i].id, obj, row: { ...placed[i] }, zoneId: zone.id });
  }
}
