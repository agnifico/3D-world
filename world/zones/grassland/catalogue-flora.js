// Grassland zone — catalogue-driven trees/rocks/bushes (Brief 9). Real
// Quaternius/BIGNature GLB models, instanced through the same
// makeInstanced() every procedural scatter kind already used, replacing the
// old createPineTree/createOakTree/.../createRock/createBush placeholder
// geometry in world scatter (gallery.js's showcase still uses those
// factories directly — untouched, that's a different feature).
//
// Two-phase, same discipline as props.js's placeKenneyProps: placement
// (position/species/season/state/variant/scale, all pure seeded math) runs
// SYNCHRONOUSLY so treePts/scatterFootprints are ready before scatterWorld's
// mushroom-clustering pass runs right after. Loading the actual GLBs and
// instancing them — plus registering their collision, which needs the real
// loaded geometry's measured trunk radius — is async/fire-and-forget, same
// timing contract placeKenneyProps already established for Kenney props.
import * as THREE from 'three';
import * as A from './assets.js';
import { terrainHeight, WATER_Y } from './world.js';
import { samplePoint, mtx, treePts, scatterFootprints } from './scatter.js';
import { loadCatalogue, findEntries, servedURL, sourceURL, weightedPick, parseCatalogueId } from '../../core/catalogue.js';
import { loadTintedTemplate, measureTrunkRadius, measureFootprint } from '../../core/gltf-assets.js';
import { makeInstanced, summarizeInstancing, logDrawCallsNextFrame } from '../../core/instancing.js';
import { reportMissingAsset } from '../../core/asset-diagnostics.js';
import { getPackPolicy } from '../../core/asset-policy.js';
import { resetScatterRegistry, registerScatterMesh } from '../../core/scatter-registry.js';
import { bindings } from './bindings.js';
import { edits } from './edits.js';

// RESOLVER-BINDING-SESSION Layer 2 — resolves each binding's id once, pure
// sync string parse (core/catalogue.js's parseCatalogueId), no manifest
// fetch needed. Keyed by the same family names placement below already
// switches on, so a binding repoint (edit bindings.js) is a one-line change
// here to take effect, nothing else in this file needs to know.
const PACK = Object.fromEntries(Object.entries(bindings).map(([slot, b]) => {
  const parsed = parseCatalogueId(b.id);
  return [slot, { ...parsed, policy: getPackPolicy(parsed.set) }];
}));

// Quaternius nature GLBs carry solid per-part materials (no textures, no
// vertex colors — see the tools/catalogue-assets.mjs inspection notes), so
// tinting is just remapping each named material once — reusing the same
// "clone material, set .color" technique assets.js's recolorNativeMesh uses
// for native props, via core/gltf-assets.js's loadTintedTemplate.
const GRASSLAND_TINT = {
  Wood: A.C.brown, Tree: A.C.brown, Black: A.C.brownDark, White: A.C.birch,
  Green: A.C.green1, DarkGreen: A.C.pine, Leaves: A.C.leafLight,
  Orange: 0xd08a3e, Berry: 0xb23a3a,
  Rock: A.C.stone,
};

// A biome-hinting region in each of two corners — snow (NW) and autumn (NE),
// both along the map's north edge (very negative Z), clear of the hamlet
// AVOID zones and the lake. Extend/add more via this array later.
const SNOW_PATCH = { xMin: -92, xMax: -30, zMin: -92, zMax: -35 };
const AUTUMN_PATCH = { xMin: 30, xMax: 92, zMin: -92, zMax: -35 };
const inPatch = (x, z, p) => x >= p.xMin && x <= p.xMax && z >= p.zMin && z <= p.zMax;
function seasonAt(x, z) {
  if (inPatch(x, z, SNOW_PATCH)) return 'snow';
  if (inPatch(x, z, AUTUMN_PATCH)) return 'autumn';
  return 'normal';
}

// Hardcoded, not read live off catalogue.json: the sync placement pass below
// must decide a variant NUMBER before the (async) manifest fetch can
// possibly resolve, so these mirror what tools/catalogue-assets.mjs
// currently produces for BIGNature. If a family's variant count changes,
// update here too — worst case otherwise is graceful fallback to variant 1
// (instantiateCatalogueFlora below), never a crash.
const VARIANT_COUNT = { CommonTree: 5, PineTree: 5, BirchTree: 5, Willow: 5, Rock: 7, Bush: 2, BushBerries: 2 };
// Weighted toward earlier/"fuller" variants per the brief — descending, then
// flat once past 5 (Rock has 7, no stated preference among the extras).
function pickVariant(R, family) {
  const n = VARIANT_COUNT[family] || 1;
  const weights = [1.3, 1.15, 1.0, 0.85, 0.7];
  while (weights.length < n) weights.push(0.6);
  let idx = 0, best = -Infinity;
  // weightedPick expects parallel items/weights arrays of matching length
  const items = Array.from({ length: n }, (_, i) => i + 1);
  return weightedPick(items, R, weights.slice(0, n));
}

// Brief 10 — per-family base-scale correction (recipe-level, applied once
// per family, not per-instance): user observed willows reading too small
// and bushes too tall against the ~1.7u character. Multiplies onto the
// existing seeded s/sy formulas below so the shape of the per-instance
// variation is preserved — only its center moves. Measured native
// (unscaled) heights to ground the direction: Willow's raw avg height
// (~2.86u across its 5 variants) is actually in line with CommonTree's
// (~2.87u), so "too small" is a deliberate call to make willows read as
// the larger, sweeping species they should be, not a geometry defect.
// Bush's raw avg height (~1.2u) combined with the OLD 0.7–1.5 scale range
// could reach 1.79u — taller than the character — confirming "too tall"
// directly.
const FAMILY_SCALE = {
  Willow: 1.25,       // before: s in [0.85, 1.30] (~2.4–3.7u tall) -> after: ~[1.06, 1.63] (~3.0–4.6u)
  Bush: 0.55,         // before: s in [0.70, 1.50] (~0.8–1.8u tall) -> after: ~[0.39, 0.83] (~0.5–1.0u)
  BushBerries: 0.55,
};

const TREE_SPECIES = [
  { family: 'CommonTree', weight: 0.48, deadCapable: true },
  { family: 'PineTree', weight: 0.24, deadCapable: false },
  { family: 'BirchTree', weight: 0.28, deadCapable: true },
];
function pickTreeFamily(R) {
  let acc = 0; const w = R();
  for (const sp of TREE_SPECIES) { acc += sp.weight; if (w < acc) return sp; }
  return TREE_SPECIES[0];
}

function groupKey(spec) { return [spec.set, spec.category || '', spec.family, spec.season, spec.state, spec.variant, spec.moss ? 'moss' : ''].join('|'); }
function addToGroup(groups, spec, matrix, id) {
  const key = groupKey(spec);
  let g = groups.get(key);
  if (!g) { g = { ...spec, matrices: [], ids: [] }; groups.set(key, g); }
  g.matrices.push(matrix);
  g.ids.push(id);
}

// World Editor Phase 4 ("scatter reach") — deterministic Family#NNNN ids in
// PLACEMENT order. The counter advances for EVERY candidate that clears the
// rejection-sampling checks below, whether or not it ends up hidden (see the
// `edits.scatterEdits[id]?.hidden` check at each call site) — hiding must
// never renumber everything after it, or a saved scatterEdit would silently
// start pointing at a different physical placement on the next reload.
// Local to one placeCatalogueFloraSync() call (reset every zone build).
function makeInstanceIdGen() {
  const counters = {};
  return family => {
    const n = counters[family] ?? 0;
    counters[family] = n + 1;
    return `${family}#${String(n).padStart(4, '0')}`;
  };
}

// ---------------------------------------------------------------------------
// Phase 1 (sync): decide every placement — position, species, season, state,
// variant, scale/rotation — exactly the same rejection-sampling budget/rules
// the old procedural code used, so density and layout read the same. Fills
// treePts/scatterFootprints (read by scatterWorld's mushrooms right after)
// and returns the grouped placement matrices for phase 2.
// ---------------------------------------------------------------------------
export function placeCatalogueFloraSync() {
  const R = A.rng(4321);
  const groups = new Map();
  const genId = makeInstanceIdGen();

  // --- trees (same budget as the old procedural pass: 115) ---
  let placed = 0, guard = 0;
  while (placed < 115 && guard++ < 3000) {
    const p = samplePoint(R, { pathClear: 5, avoidExtra: 2 });
    if (!p) continue;
    let ok = true;
    for (const t of treePts) if (Math.hypot(p.x - t.x, p.z - t.z) < 4) { ok = false; break; }
    if (!ok) continue;

    let family, state = 'alive';
    if (p.h < WATER_Y + 1.6 && R() < 0.5) {
      family = 'Willow'; // willows hug the shore
    } else if (p.h > WATER_Y + 3.0 && R() < 0.045) {
      family = R() < 0.55 ? 'CommonTree' : 'BirchTree'; // dead trees: rare, away from water only
      state = 'dead';
    } else {
      family = pickTreeFamily(R).family;
    }
    const season = seasonAt(p.x, p.z);
    const variant = pickVariant(R, family);
    const id = genId(family); // consumed even if hidden below — see makeInstanceIdGen's own comment

    // Every RNG draw below happens UNCONDITIONALLY, hidden or not — only the
    // final addToGroup (what actually renders) is gated. Skipping any of
    // these draws for a hidden instance would shift the RNG stream for
    // every placement after it, breaking the "stable across rebuilds"
    // guarantee for the WHOLE rest of the pass, not just the hidden one.
    let s = 0.85 + R() * 0.45;
    s *= FAMILY_SCALE[family] || 1;
    s *= PACK[family].policy.scaleFactor;
    const sy = s * (0.95 + R() * 0.1);
    const rot = R() * Math.PI * 2;

    treePts.push(p);
    scatterFootprints.push({ kind: 'tree', x: p.x, z: p.z, r: s * 1.3 }); // canopy proxy — spacing/avoidance only, NOT the collider (see instantiateCatalogueFlora)
    placed++;
    if (!edits.scatterEdits?.[id]?.hidden) {
      addToGroup(groups, { set: PACK[family].set, category: PACK[family].category, family: PACK[family].family, season, state, variant },
        mtx(p.x, p.h - 0.05, p.z, rot, s, sy), id);
    }
  }

  // --- rocks: mostly plain, a moss fraction everywhere, snow variant inside the snow patch ---
  placed = 0; guard = 0;
  while (placed < 150 && guard++ < 3000) {
    const p = samplePoint(R, { minShore: -0.2, pathClear: 2.5 });
    if (!p) continue;
    const season = seasonAt(p.x, p.z);
    const state = 'alive';
    const rockSeason = season === 'snow' ? 'snow' : (R() < 0.2 ? 'mossy' : 'normal'); // 'mossy' resolved to the Rock+moss entry below
    const variant = pickVariant(R, 'Rock');
    const id = genId('Rock');

    // See the tree loop's identical comment: every draw unconditional, only
    // addToGroup gated, so hiding one instance never shifts the RNG stream
    // for anything placed after it.
    let s = 0.5 + R() * 1.2;
    s *= PACK.Rock.policy.scaleFactor;
    const sy = s * (0.8 + R() * 0.5);
    const rot = R() * Math.PI * 2;

    scatterFootprints.push({ kind: 'rock', x: p.x, z: p.z, r: s * 0.6 });
    placed++;
    if (!edits.scatterEdits?.[id]?.hidden) {
      addToGroup(groups, { set: PACK.Rock.set, category: PACK.Rock.category, family: PACK.Rock.family, season: rockSeason === 'mossy' ? 'normal' : rockSeason, state, variant, moss: rockSeason === 'mossy' },
        mtx(p.x, p.h, p.z, rot, s, sy), id);
    }
  }

  // --- bushes: plain + a BushBerries fraction (harvestable, placed not wired) ---
  placed = 0; guard = 0;
  while (placed < 75 && guard++ < 2000) {
    const p = samplePoint(R, { pathClear: 3.5, pathFade: 8 });
    if (!p) continue;
    const season = seasonAt(p.x, p.z);
    const isBerries = R() < 0.25;
    const family = isBerries ? 'BushBerries' : 'Bush';
    // Catalogue only has Bush/Bush_Snow (no autumn) and plain BushBerries
    // (no seasonal variants at all) — never request a combo that can't exist.
    const bushSeason = isBerries ? 'normal' : (season === 'snow' ? 'snow' : 'normal');
    const variant = pickVariant(R, family);
    const id = genId(family);

    let s = 0.7 + R() * 0.8;
    s *= FAMILY_SCALE[family] || 1;
    s *= PACK[family].policy.scaleFactor;
    const rot = R() * Math.PI * 2; // unconditional — see the tree/rock loops' identical comment

    scatterFootprints.push({ kind: 'bush', x: p.x, z: p.z, r: s * 0.7 }); // decorative — walk-through
    placed++;
    if (!edits.scatterEdits?.[id]?.hidden) {
      addToGroup(groups, { set: PACK[family].set, category: PACK[family].category, family: PACK[family].family, season: bushSeason, state: 'alive', variant },
        mtx(p.x, p.h, p.z, rot, s), id);
    }
  }

  return { groups };
}

// ---------------------------------------------------------------------------
// Phase 2 (async, fire-and-forget): resolve each group against the real
// catalogue manifest, load+tint each variant's template once, build one
// InstancedMesh per distinct geometry via makeInstanced (draw calls track
// distinct geometry × variant, NOT instance count), register trunk-radius
// collision from the real loaded geometry, and log the draw-call/instance
// summary the brief's verification step asks for.
// ---------------------------------------------------------------------------
export async function instantiateCatalogueFlora(ctx, scene, groups) {
  resetScatterRegistry(); // World Editor Phase 4 — fresh per zone build, same discipline as height/collision registries
  const manifest = await loadCatalogue();
  const treeGroup = new THREE.Group(), rockGroup = new THREE.Group(), bushGroup = new THREE.Group();
  const _pos = new THREE.Vector3(), _quat = new THREE.Quaternion(), _scale = new THREE.Vector3();

  // Resolve every group's catalogue entry synchronously first, then kick off
  // ALL variant fetches concurrently (loadTintedTemplate is memoized per url,
  // so repeated variants across groups share one in-flight request) — a
  // dozens-of-groups fully-sequential await chain was measured taking
  // 60-90s to settle, which read as a hang; loading them in parallel instead
  // brings the whole scatter in well under a second of network time.
  const resolved = [];
  for (const g of groups.values()) {
    const baseEntries = findEntries(manifest, { set: g.set, category: g.category, family: g.family, season: g.season, state: g.state });
    const mossEntries = baseEntries.filter(e => g.moss ? e.tags.includes('moss') : !e.tags.includes('moss'));
    const entry = mossEntries[0] || baseEntries[0];
    if (!entry) { reportMissingAsset(`${g.set}/${g.family}/${g.season}/${g.state}`, 'grassland catalogue-flora: no catalogue entry'); continue; }
    const variantRec = entry.variants.find(v => v.variant === g.variant) || entry.variants[0];
    if (!variantRec) { reportMissingAsset(`${g.set}/${g.family}/${g.season}/${g.state}`, 'grassland catalogue-flora: no variant record'); continue; }
    // RESOLVER-BINDING-SESSION — served-or-shelf, same fallback core/
    // catalogue.js's resolveAsset uses: a binding can point at a shelf-only
    // (never-served) entry, not just BIGNature's currently-all-served set.
    const url = variantRec.served ? servedURL(variantRec.served) : sourceURL(variantRec.source);
    // World Editor Phase 4 ("scatter reach") — a family-wide override can
    // retint or force a material-policy mode for EVERY instance of that
    // family. Scoped to tint/materialPolicy only this session (NOT a
    // catalogueId/scale override — see PROJECT-STATE.md's own note on why
    // that's cut): those two don't affect phase 1's placement math at all,
    // so applying them here needs no changes anywhere else.
    const famOverride = edits.familyOverrides?.[g.family];
    const tint = famOverride?.tint ? { ...GRASSLAND_TINT, ...famOverride.tint } : GRASSLAND_TINT;
    const policy = famOverride?.materialPolicy ? { ...getPackPolicy(g.set), material: famOverride.materialPolicy } : getPackPolicy(g.set);
    resolved.push({ g, url, templatePromise: loadTintedTemplate(url, tint, policy) });
  }

  for (const { g, url, templatePromise } of resolved) {
    // A load failure here (404, parse error) must not take down every group
    // that comes after it in this loop — one bad file is reported and
    // skipped, not a reason to blank the rest of the zone's flora.
    let template;
    try {
      template = await templatePromise; // already in flight (or done) — this await never blocks a fetch that hasn't started yet
    } catch (e) {
      reportMissingAsset(url, `grassland catalogue-flora: ${g.family} failed to load (${e.message})`);
      continue;
    }
    const instanced = makeInstanced(template, g.matrices);
    // World Editor Phase 4 — every InstancedMesh part shares the SAME id
    // list (makeInstanced applies g.matrices, in order, to every mesh part
    // of the template), so a raycast hit on ANY part resolves to the right
    // Family#NNNN regardless of which part (trunk vs. leaves, say) it hit.
    for (const part of instanced.children) registerScatterMesh(part, g.family, g.ids);

    if (g.family === 'Rock') {
      rockGroup.add(instanced);
      // Small/low rocks: real footprint radius from the loaded geometry —
      // can be hopped, and stood on (matches the old procedural rocks).
      const { radius, height } = measureFootprint(template);
      for (const m of g.matrices) {
        m.decompose(_pos, _quat, _scale);
        ctx.collisionRegistry.addCircle(_pos.x, _pos.z, radius * _scale.x, _pos.y, _pos.y + height * _scale.y * 0.93, true);
      }
    } else if (g.family === 'Bush' || g.family === 'BushBerries') {
      bushGroup.add(instanced); // decorative — walk-through, no collider (matches old bushes)
    } else {
      treeGroup.add(instanced);
      // Real per-species trunk radius from the loaded geometry (not a flat
      // guess) — canopy-sized scatterFootprints stays a spacing proxy only.
      const trunkRadiusUnit = measureTrunkRadius(template);
      for (const m of g.matrices) {
        m.decompose(_pos, _quat, _scale);
        ctx.collisionRegistry.addCircle(_pos.x, _pos.z, trunkRadiusUnit * _scale.x, _pos.y, Infinity, false);
      }
    }
  }

  scene.add(treeGroup, rockGroup, bushGroup);
  summarizeInstancing('grassland catalogue flora (trees+rocks+bushes)', [treeGroup, rockGroup, bushGroup]);
  if (ctx.renderer) logDrawCallsNextFrame(ctx, ctx.renderer, 'grassland (post catalogue-flora)');
}
