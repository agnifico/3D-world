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
import { loadCatalogue, findEntries, servedURL, weightedPick } from '../../core/catalogue.js';
import { loadTintedTemplate } from '../../core/gltf-assets.js';
import { makeInstanced, addWind, summarizeInstancing, logDrawCallsNextFrame } from '../../core/instancing.js';

const AREA = { min: -95, max: 95 };

// Simple_Nature's grass GLB carries one solid-color material named "Leaves"
// (no texture, no vertex colors — same convention as BIGNature's nature
// GLBs) — tint it to the lagoon's own reef green (matches the retired
// procedural kelp's color) so it reads as part of this zone's palette, not
// a green lifted straight from Grassland.
const SEAWEED_TINT = { Leaves: '#3f7d5a' };

const VARIANT_COUNT = { PalmTree: 3, Grass: 3, Rock: 5, Bush: 3 };
function pickVariant(rng, n) {
  const items = Array.from({ length: n }, (_, i) => i + 1);
  return weightedPick(items, rng);
}

const mtx = (x, y, z, rotY, sx, sy, sz) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
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
    const s = 0.8 + rng() * 0.6;
    addToGroup(groups, { set: 'pirates', category: 'Environment', family: 'PalmTree', season: 'normal', state: 'alive', variant: pickVariant(rng, VARIANT_COUNT.PalmTree) },
      mtx(p.x, p.y, p.z, rng() * Math.PI * 2, s, s, s));
  }

  // Seaweed — Simple_Nature grass, stretched tall + thin, reef depth band
  // (same band the procedural kelp used) — this IS the "grass-as-seaweed"
  // transform: scaleY way up, scaleXZ down, so it reads as fronds, not
  // flat grass tufts sitting on the seabed.
  for (const p of placeBand(rng, catalogueBands.seaweed)) {
    const sxz = 0.32 + rng() * 0.22, sy = 3.4 + rng() * 2.2;
    addToGroup(groups, { set: 'Simple_Nature', category: null, family: 'Grass', season: 'normal', state: 'alive', variant: pickVariant(rng, VARIANT_COUNT.Grass) },
      mtx(p.x, p.y, p.z, rng() * Math.PI * 2, sxz, sy, sxz));
  }

  // Reef rocks — Pirates rocks, shallow band.
  for (const p of placeBand(rng, catalogueBands.reefRock)) {
    const s = 0.5 + rng() * 0.9;
    addToGroup(groups, { set: 'pirates', category: 'Environment', family: 'Rock', season: 'normal', state: 'alive', variant: pickVariant(rng, VARIANT_COUNT.Rock) },
      mtx(p.x, p.y, p.z, rng() * Math.PI * 2, s, s, s));
  }

  // Shore bushes — Simple_Nature bush, small vegetation on the waterline-ish band.
  for (const p of placeBand(rng, catalogueBands.shoreBush)) {
    const s = 0.5 + rng() * 0.6;
    addToGroup(groups, { set: 'Simple_Nature', category: null, family: 'Bush', season: 'normal', state: 'alive', variant: pickVariant(rng, VARIANT_COUNT.Bush) },
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
    if (!entry) { console.warn('[lagoon catalogue-flora] no catalogue entry for', g.family); continue; }
    const variantRec = entry.variants.find(v => v.variant === g.variant) || entry.variants[0];
    if (!variantRec?.served) { console.warn('[lagoon catalogue-flora] no served file for', g.family); continue; }
    const tint = g.family === 'Grass' ? SEAWEED_TINT : null;
    resolved.push({ g, templatePromise: loadTintedTemplate(servedURL(variantRec.served), tint) });
  }

  const swayMaterials = new Set();
  for (const { g, templatePromise } of resolved) {
    const template = await templatePromise;
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
