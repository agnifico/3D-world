// World Shell — loads catalogue GLB variants as reusable template Groups
// (memoized per url, exactly like grassland/assets.js's Kenney pipeline),
// and tints their named materials to a zone's palette. Zone-agnostic: no
// zone imports, so both Grassland and Lagoon load through this one path
// (the brief's "reuse the existing recolor path; don't fork it").
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let _loader = null;
const _templateCache = new Map(); // url -> Promise<THREE.Group>

function loadRaw(url) {
  if (!_templateCache.has(url)) {
    _loader = _loader || new GLTFLoader();
    _templateCache.set(url, _loader.loadAsync(url).then(gltf => {
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      // Quaternius exports don't guarantee the pivot sits at the model's own
      // base (temp-real-palms.js hit the same thing) — every procedural
      // factory in this codebase promises "pivot at base-center", so match
      // that here too: shift once so bbox.min.y lands at 0.
      const box = new THREE.Box3().setFromObject(scene);
      scene.position.y -= box.min.y;
      scene.updateMatrixWorld(true);
      scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return scene;
    }));
  }
  return _templateCache.get(url);
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
export function loadTintedTemplate(url, remap) {
  const key = url + '::' + JSON.stringify(remap || {});
  if (!_tintedCache.has(key)) {
    _tintedCache.set(key, loadRaw(url).then(rawTemplate => {
      if (!remap) return rawTemplate;
      const tinted = rawTemplate.clone(true); // clone(true) shares geometry by reference, NOT materials' colors here, since we replace materials below rather than mutate the shared ones
      tinted.traverse(o => {
        if (!o.isMesh) return;
        const hex = remap[o.material.name];
        if (hex === undefined) return;
        o.material = o.material.clone();
        o.material.color.set(hex);
      });
      return tinted;
    }));
  }
  return _tintedCache.get(key);
}
