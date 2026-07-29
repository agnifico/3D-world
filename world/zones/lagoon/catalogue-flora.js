// Lagoon zone — catalogue-driven real models: Pirates palms + reef rocks,
// Simple_Nature grass stretched into seaweed + shore bushes (Brief 9).
// Supersedes the old procedural `palm`/`kelp` scatterRecipe kinds (removed
// from terrain.js — depth bands now live in terrain.js's `catalogueBands`)
// AND temp-real-palms.js's non-instanced swap-in hack (retired — see
// TEMP-MODELS.md): that file cloned a full Object3D PER PALM INSTANCE, one
// draw call each; this instances properly, one InstancedMesh per variant
// part, same as Grassland's catalogue-flora.js.
//
// Two-phase, same discipline as Grassland: placement is pure seeded math
// (no lagoon collision system exists yet — zone.js's comment already notes
// Lagoon has none — so there's no synchronous ordering requirement the way
// Grassland's treePts/mushrooms had; still split for consistency and so
// the async load never blocks build()).
import * as THREE from 'three';
import { mulberry32 } from '../../core/math.js';
import { WATER_Y, terrainHeight, terrainNormal, catalogueBands } from './terrain.js';
import { loadCatalogue, findEntries, servedURL, sourceURL, weightedPick, parseCatalogueId, resolveAsset } from '../../core/catalogue.js';
import { loadTintedTemplate } from '../../core/gltf-assets.js';
import { makeInstanced, addWind, summarizeInstancing, logDrawCallsNextFrame } from '../../core/instancing.js';
import { reportMissingAsset } from '../../core/asset-diagnostics.js';
import { getPackPolicy } from '../../core/asset-policy.js';
import { bindings } from './bindings.js';

const AREA = { min: -95, max: 95 };

// RESOLVER-BINDING-SESSION Layer 2 — see grassland/catalogue-flora.js's
// identical PACK map for why this is a pure sync parse (no manifest fetch).
const PACK = Object.fromEntries(Object.entries(bindings).map(([slot, b]) => {
  const parsed = parseCatalogueId(b.id);
  return [slot, { ...parsed, policy: getPackPolicy(parsed.set) }];
}));

// Simple_Nature's grass GLB carries one solid-color material named "Leaves"
// (no texture, no vertex colors — same convention as BIGNature's nature
// GLBs) — tint it to the lagoon's own reef green (matches the retired
// procedural kelp's color) so it reads as part of this zone's palette, not
// a green lifted straight from Grassland.
const SEAWEED_TINT = { Leaves: '#3f7d5a' };

// Keyed by SLOT (not resolved family) — a binding repoint can change how
// many variants the bound entry actually has, so this needs a matching edit
// alongside bindings.js's id, same discipline as grassland's VARIANT_COUNT.
const VARIANT_COUNT = { palmTree: 3, seaweed: 3, reefRock: 5, shoreBush: 1 };
function pickVariant(rng, n) {
  const items = Array.from({ length: n }, (_, i) => i + 1);
  return weightedPick(items, rng);
}

// world-editor: rotation engine fix — see grassland/scatter.js's identical
// rotQuat for why (`rot` is a plain Y-heading number OR a full Euler
// [x,y,z]) — every existing call site below still passes a plain number.
function rotQuat(rot) {
  return Array.isArray(rot)
    ? new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]))
    : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
}
const mtx = (x, y, z, rotY, sx, sy, sz) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z),
  rotQuat(rotY),
  new THREE.Vector3(sx, sy, sz));

// Same depth/slope rejection-sampling shape buildFlora uses internally in
// lagoon-fx.js, standalone here since that function is private to its own
// closure — small enough to duplicate rather than refactor working code.
function placeBand(rng, band) {
  const placed = [];
  let attempts = 0, maxAttempts = band.count * 12;
  while (placed.length < band.count && attempts++ < maxAttempts) {
    const x = AREA.min + rng() * (AREA.max - AREA.min);
    const z = AREA.min + rng() * (AREA.max - AREA.min);
    const h = terrainHeight(x, z);
    const depth = WATER_Y - h;
    if (depth < band.minDepth || depth > band.maxDepth) continue;
    const n = terrainNormal(x, z, 0.6);
    if (n[1] < band.slopeMin) continue;
    placed.push({ x, y: h, z, r: rng() });
  }
  return placed;
}

function groupKey(spec) { return [spec.set, spec.category || '', spec.family, spec.season, spec.state, spec.variant].join('|'); }
function addToGroup(groups, spec, matrix) {
  const key = groupKey(spec);
  let g = groups.get(key);
  if (!g) { g = { ...spec, matrices: [] }; groups.set(key, g); }
  g.matrices.push(matrix);
}

export function placeCatalogueFloraSync() {
  const rng = mulberry32(77331);
  const groups = new Map();

  // Palms — real Pirates models, land band (above water, same footprint the
  // old placeholder/temp-swap palms used).
  for (const p of placeBand(rng, catalogueBands.palm)) {
    const pack = PACK.palmTree;
    const s = (0.8 + rng() * 0.6) * pack.policy.scaleFactor;
    addToGroup(groups, { set: pack.set, category: pack.category, family: pack.family, season: 'normal', state: 'alive', variant: pickVariant(rng, VARIANT_COUNT.palmTree) },
      mtx(p.x, p.y, p.z, rng() * Math.PI * 2, s, s, s));
  }

  // Seaweed — Simple_Nature grass, stretched tall + thin, reef depth band
  // (same band the procedural kelp used) — this IS the "grass-as-seaweed"
  // transform: scaleY way up, scaleXZ down, so it reads as fronds, not
  // flat grass tufts sitting on the seabed.
  for (const p of placeBand(rng, catalogueBands.seaweed)) {
    const pack = PACK.seaweed;
    const sxz = (3 + rng() * 0.22) * pack.policy.scaleFactor, sy = (3.4 + rng() * 2.2) * pack.policy.scaleFactor;
    addToGroup(groups, { set: pack.set, category: pack.category, family: pack.family, season: 'normal', state: 'alive', variant: pickVariant(rng, VARIANT_COUNT.seaweed) },
      mtx(p.x, p.y, p.z, rng() * Math.PI * 2, sxz, sy, sxz));
  }

  // Reef rocks — Pirates rocks, shallow band.
  for (const p of placeBand(rng, catalogueBands.reefRock)) {
    const pack = PACK.reefRock;
    const s = (0.5 + rng() * 0.9) * pack.policy.scaleFactor;
    addToGroup(groups, { set: pack.set, category: pack.category, family: pack.family, season: 'normal', state: 'alive', variant: pickVariant(rng, VARIANT_COUNT.reefRock) },
      mtx(p.x, p.y, p.z, rng() * Math.PI * 2, s, s, s));
  }

  // Shore bushes — NNK Style Bush_Common (RESOLVER-BINDING-SESSION fix, see
  // bindings.js's header). Native GLB bbox measured directly: ~1.6u tall —
  // the old 2-2.6 scale range was tuned for a totally different model
  // (Simple_Nature's stretched grass blade) and would read 3-4u tall here,
  // taller than the character. Re-tuned against Bush_Common's own measured
  // height, landing ~0.5-0.7u once the NNK pack's 0.4x policy scaleFactor is
  // folded in (core/asset-policy.js) — UNVERIFIED in-browser, eyeball and
  // adjust this range (or bindings.js's optional `scale` override) if it
  // reads wrong.
  for (const p of placeBand(rng, catalogueBands.shoreBush)) {
    const pack = PACK.shoreBush;
    const s = (0.85 + rng() * 0.3) * pack.policy.scaleFactor;
    addToGroup(groups, { set: pack.set, category: pack.category, family: pack.family, season: 'normal', state: 'alive', variant: pickVariant(rng, VARIANT_COUNT.shoreBush) },
      mtx(p.x, p.y, p.z, rng() * Math.PI * 2, s, s, s));
  }

  return { groups };
}

export async function instantiateCatalogueFlora(ctx, scene, groups) {
  const manifest = await loadCatalogue();
  const palmGroup = new THREE.Group(), seaweedGroup = new THREE.Group(), rockGroup = new THREE.Group(), bushGroup = new THREE.Group();

  // Resolve entries + kick off every variant fetch concurrently (see
  // Grassland's catalogue-flora.js for why: a fully-sequential await chain
  // across dozens of groups was measured taking 60-90s to settle).
  const resolved = [];
  for (const g of groups.values()) {
    const entry = findEntries(manifest, { set: g.set, category: g.category, family: g.family, season: g.season, state: g.state })[0];
    if (!entry) { reportMissingAsset(`${g.set}/${g.family}`, 'lagoon catalogue-flora: no catalogue entry'); continue; }
    const variantRec = entry.variants.find(v => v.variant === g.variant) || entry.variants[0];
    if (!variantRec) { reportMissingAsset(`${g.set}/${g.family}`, 'lagoon catalogue-flora: no variant record'); continue; }
    const tint = g.family === 'Grass' ? SEAWEED_TINT : null;
    // RESOLVER-BINDING-SESSION — served-or-shelf, same fallback core/
    // catalogue.js's resolveAsset uses: a binding can now point at a
    // shelf-only (never-served) entry, like shoreBush's NNK Style bush.
    const url = variantRec.served ? servedURL(variantRec.served) : sourceURL(variantRec.source);
    resolved.push({ g, url, templatePromise: loadTintedTemplate(url, tint, getPackPolicy(g.set)) });
  }

  const swayMaterials = new Set();
  for (const { g, url, templatePromise } of resolved) {
    // See grassland/catalogue-flora.js's identical guard: one group's load
    // failure is reported and skipped, never a reason to abort the rest of
    // this loop (palms/rocks/bushes placed after the failing group).
    let template;
    try {
      template = await templatePromise;
    } catch (e) {
      reportMissingAsset(url, `lagoon catalogue-flora: ${g.family} failed to load (${e.message})`);
      continue;
    }
    if (g.family === 'Grass') {
      // Underwater sway — reuses the shared addWind helper (the same
      // mechanism Grassland's grass/flowers use) rather than forking a new
      // one; applied once per distinct tinted material.
      template.traverse(o => {
        if (!o.isMesh || o.material.userData.__swayApplied) return;
        addWind(o.material, 0.4, 1.0);
        o.material.userData.__swayApplied = true;
        swayMaterials.add(o.material);
      });
    }
    const instanced = makeInstanced(template, g.matrices);
    if (g.family === 'PalmTree') palmGroup.add(instanced);
    else if (g.family === 'Grass') seaweedGroup.add(instanced);
    else if (g.family === 'Rock') rockGroup.add(instanced);
    else bushGroup.add(instanced);
  }

  if (swayMaterials.size) {
    ctx.animated.push((dt, t) => {
      for (const m of swayMaterials) if (m.userData.shader) m.userData.shader.uniforms.uTime.value = t;
    });
  }

  scene.add(palmGroup, seaweedGroup, rockGroup, bushGroup);
  summarizeInstancing('lagoon catalogue flora (palm+seaweed+rock+bush)', [palmGroup, seaweedGroup, rockGroup, bushGroup]);
  if (ctx.renderer) logDrawCallsNextFrame(ctx, ctx.renderer, 'lagoon (post catalogue-flora)');
}

// RESOLVER-BINDING-SESSION proof binding — mainShip isn't a scatter species
// like the four above: one hand-placed prop, resolved straight through
// Layer 1 (core/catalogue.js's resolveAsset) rather than findEntries, and
// loaded with its pack's Layer 3 policy. No matrix-group batching — a
// one-instance InstancedMesh would be pure overhead for a single prop. Not
// part of the two-phase sync/async split above: no placement budget or
// treePts-style ordering dependency to protect, same as the (now-retired)
// NNK smoke test's own placement, which used this same direct-load shape.
// Fire-and-forget from lagoon/zone.js, same convention as
// instantiateCatalogueFlora above.
export async function placeMainShip(scene) {
  const b = bindings.mainShip;
  const manifest = await loadCatalogue();
  const resolved = resolveAsset(manifest, b.id);
  if (!resolved) { reportMissingAsset(b.id, 'lagoon bindings: mainShip catalogue id not found'); return; }
  let template;
  try {
    template = await loadTintedTemplate(resolved.url, null, resolved.policy);
  } catch (e) {
    reportMissingAsset(resolved.url, `lagoon bindings: mainShip failed to load (${e.message})`);
    return;
  }
  const ship = template.clone(true);
  const scale = (b.scale ?? 1) * resolved.policy.scaleFactor;
  ship.scale.setScalar(scale);
  // world-editor: full Euler now, not Y-only — b.rot is [x,y,z] radians.
  const [rx, ry, rz] = b.rot || [0, 0, 0];
  ship.rotation.set(rx, ry, rz);
  // Floats at the waterline, same -0.15 draft convention core/boats.js uses
  // for every actually-sailable boat spawn — this ship is a static prop,
  // not a rideable one, but the same "just barely submerged" look applies.
  ship.position.set(b.where.x, WATER_Y - 0.15, b.where.z);
  ship.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(ship);
}
