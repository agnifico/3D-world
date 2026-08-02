// World Shell — loads catalogue GLB variants as reusable template Groups
// (memoized per url, exactly like grassland/assets.js's Kenney pipeline),
// and tints their named materials to a zone's palette. Zone-agnostic: no
// zone imports, so both Grassland and Lagoon load through this one path
// (the brief's "reuse the existing recolor path; don't fork it").
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Brief 10 — the FBX→GLB conversion that produced every catalogue nature
// asset baked metallicFactor≈0.4 / roughnessFactor≈0.415 onto EVERY
// material regardless of part (confirmed: identical on Wood/Green/Rock/
// Snow/Leaves across BIGNature and Simple_Nature — a conversion-tool
// default, not intentional authoring). Quaternius nature is meant to read
// flat/matte. At metalness 0.4, a material's diffuse contribution is cut
// to 60% of its base color and its specular reflects the base color
// itself (not a neutral 0.04) — under this codebase's warm sun +
// olive-toned hemisphere ground, that's enough on its own to explain every
// reported symptom: a metallic sheen on foliage/rock, "gold" highlights on
// thin bright shapes (the stretched grass-as-seaweed fronds), and
// "chocolate" snow (a near-white surface losing most of its diffuse white
// and picking up the environment's warm/olive tint instead). None of these
// GLBs actually carry vertex colors (checked directly — no COLOR_0
// attribute anywhere in this set); they're solid per-part baseColorFactor
// materials, so there's no colorspace bug to chase here, just this one.
//
// RESOLVER-BINDING-SESSION Layer 3 — this used to be an unconditional
// transform applied to EVERY loaded model regardless of pack. Now gated on
// the caller's resolved pack policy (core/asset-policy.js, surfaced via
// core/catalogue.js's resolveAsset): 'flat-matte' reproduces this exact
// former behavior for the packs that need it (BIGNature/Simple_Nature/
// pirates/kenney-models); 'authored' (the default) leaves the GLB's
// exported material untouched — this is what let the NNK smoke test prove
// the old blind override was destroying NNK's canopy detail.
function applyMaterialPolicy(mat, materialMode) {
  if (materialMode !== 'flat-matte') return; // 'authored' (default): leave the exported material alone
  mat.metalness = 0;
  mat.roughness = 0.9;
  mat.flatShading = true; // matches every procedural material's own mat() default in assets.js — low-poly faceted, not smoothed
  mat.needsUpdate = true;
}

const DEFAULT_POLICY = { material: 'authored', scaleFactor: 1 }; // pass-through fallback for a caller that doesn't (yet) pass one

let _loader = null;
const _templateCache = new Map(); // "url::materialMode" -> Promise<THREE.Group>

// Every consumer of a template (boats.js spawnBoatAt, world-edits.js
// buildPlacedObject, catalogue-flora.js) gets there via template.clone(true),
// which shares geometry/materials/textures BY REFERENCE — those resources
// belong to this module's caches, not to whichever zone group ends up
// holding the clone. core/zone.js's disposeGroup() checks this mark before
// disposing anything, so a zone teardown can free its own procedural content
// without freeing GPU resources every other zone is still using.
export const SHARED = '__sharedAsset';
export function markShared(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.userData[SHARED] = true;
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      m.userData[SHARED] = true;
      for (const k of ['map', 'alphaMap', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap']) {
        if (m[k]) m[k].userData[SHARED] = true;
      }
    }
  });
}

// Cache key includes policy.material (NOT the whole policy — scaleFactor is
// applied per-instance by callers, never baked into the template) because
// this invariant broke once the World Editor (Phase 3) added PER-OBJECT
// materialPolicy overrides: a url's policy used to be a pure function of its
// pack (one url -> one pack -> one policy), so keying by url alone was safe.
// Now the SAME url can legitimately be requested under two different material
// modes (a placed object's inspector override vs. everything else still
// using the pack default) — url-only caching would have silently returned
// whichever mode was cached first for every subsequent request.
function loadRaw(url, policy) {
  const key = `${url}::${policy.material}`;
  if (!_templateCache.has(key)) {
    _loader = _loader || new GLTFLoader();
    _templateCache.set(key, _loader.loadAsync(url).then(gltf => {
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      // Quaternius exports don't guarantee the pivot sits at the model's own
      // base (temp-real-palms.js hit the same thing) — every procedural
      // factory in this codebase promises "pivot at base-center", so match
      // that here too: shift once so bbox.min.y lands at 0.
      const box = new THREE.Box3().setFromObject(scene);
      scene.position.y -= box.min.y;
      scene.updateMatrixWorld(true);
      scene.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) applyMaterialPolicy(m, policy.material);
      });
      markShared(scene);
      return scene;
    }));
  }
  return _templateCache.get(key);
}

// Measures a real per-species trunk radius from the template's OWN geometry
// (unit scale) rather than guessing a flat ratio against canopy footprint —
// same idea as props.js's lowSliceBox (only vertices near the base count,
// so canopy/branches never inflate the collider), adapted for a scatter
// template rather than a single placed Object3D. sliceFrac is the fraction
// of total model height counted as "trunk zone" before canopy takes over.
export function measureTrunkRadius(template, sliceFrac = 0.16) {
  template.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(template);
  const height = Math.max(box.max.y - box.min.y, 0.001);
  const sliceY = box.min.y + height * sliceFrac;
  let maxR = 0;
  const v = new THREE.Vector3();
  template.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.y <= sliceY) maxR = Math.max(maxR, Math.hypot(v.x, v.z));
    }
  });
  return maxR > 0 ? maxR : Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.25;
}

// Overall footprint (XZ half-extent) + height from the template's own
// geometry, unit scale — used for props with no trunk/canopy distinction
// (rocks), where the whole bounding box IS the collider footprint.
export function measureFootprint(template) {
  template.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(template);
  return { radius: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2, height: box.max.y - box.min.y };
}

// Catalogue nature GLBs carry solid per-part materials (Wood/Green/Rock/...),
// not textures or vertex colors — recoloring is just remapping each named
// material's .color once, the same one-line technique
// grassland/assets.js's recolorNativeMesh already uses for native props.
// Cached per (url + remap) so different zones tinting the same source GLB
// to different palettes never share (or fight over) one mutated material.
const _tintedCache = new Map();
export function loadTintedTemplate(url, remap, policy = DEFAULT_POLICY) {
  // policy.material folded in for the same reason loadRaw's own cache key
  // needs it now (see that function's comment) — remap alone isn't enough
  // to disambiguate two requests for the same url+remap under different
  // material-policy overrides.
  const key = url + '::' + JSON.stringify(remap || {}) + '::' + policy.material;
  if (!_tintedCache.has(key)) {
    _tintedCache.set(key, loadRaw(url, policy).then(rawTemplate => {
      if (!remap) return rawTemplate;
      const tinted = rawTemplate.clone(true); // clone(true) shares geometry by reference, NOT materials' colors here, since we replace materials below rather than mutate the shared ones
      tinted.traverse(o => {
        if (!o.isMesh) return;
        const hex = remap[o.material.name];
        if (hex === undefined) return;
        o.material = o.material.clone();
        o.material.color.set(hex);
      });
      // The remap above builds brand-new materials, but they still live in
      // _tintedCache (module-level, cross-zone) — equally shared, so they need
      // the same mark as the raw template, not just its untouched siblings.
      markShared(tinted);
      return tinted;
    }));
  }
  return _tintedCache.get(key);
}
