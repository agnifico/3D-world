// ============================================================================
// TEMPORARY HACK — quick swap-in of the 3 real palm models under
// /finalised/ over Lagoon's procedural palm placeholders. This is NOT the
// real asset-placement system (that's later work, per the user) — it's
// deliberately small and isolated so it's trivial to rip out:
//   - delete this file
//   - remove the one `import` + one `swapInRealPalms(...)` call in zone.js
// Nothing else in the codebase references this module.
//
// How it works: lagoon-fx.js's buildFlora() already placed 30 procedural
// palm instances (position/rotation/height all baked into one InstancedMesh,
// per the scatterRecipe's `palm` kind) — this just reads those same
// per-instance transforms straight off that InstancedMesh, hides it, and
// drops a real GLTF clone (randomly one of the 3 models) at each transform
// instead. So "wherever existing palm trees are" is exactly where these
// land — zero new placement logic, zero risk of drifting from the
// procedural recipe if it's retuned later (just re-run this against
// whatever it placed).
// ============================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Copied (not referenced in place) from the top-level finalised/ folder into
// world/assets/temp-models/ — keeps every asset the served app needs inside
// world/ itself, same as watercraft-pack etc. Paths resolve relative to the
// served page (world/index.html), not this module's own location.
const MODEL_URLS = [
  'assets/temp-models/Environment_PalmTree_1.gltf',
  'assets/temp-models/Environment_PalmTree_2.gltf',
  'assets/temp-models/Environment_PalmTree_3.gltf',
];

let _cache = null;
function loadModels() {
  if (!_cache) {
    const loader = new GLTFLoader();
    _cache = Promise.all(MODEL_URLS.map(async (url) => {
      const gltf = await loader.loadAsync(url);
      const model = gltf.scene;
      model.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
      // Normalize to the same "pivot at base" convention every other asset
      // in this codebase uses, and remember its natural height so instances
      // can be rescaled to the height the procedural placeholder intended.
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const wrap = new THREE.Group();
      model.position.y -= box.min.y;
      wrap.add(model);
      wrap.userData.naturalHeight = size.y || 1;
      return wrap;
    }));
  }
  return _cache;
}

// `lagoon` is createLagoon()'s returned controller (from zone.js's build());
// `scene` is wherever the clones should live — pass the zone's own content
// group so normal zone disposal cleans them up like everything else.
export async function swapInRealPalms(lagoon, scene) {
  const palmMesh = lagoon.layers.flora.children.find((m) => m.userData.kind && m.userData.kind.id === 'palm');
  if (!palmMesh) return;

  const models = await loadModels();

  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
  const group = new THREE.Group();
  for (let i = 0; i < palmMesh.count; i++) {
    palmMesh.getMatrixAt(i, m);
    m.decompose(pos, quat, scale);
    if (scale.y < 0.001) continue; // an under-placed filler instance (see buildFlora) — skip, nothing to swap
    const template = models[(Math.random() * models.length) | 0];
    const clone = template.clone(true);
    clone.position.copy(pos);
    clone.quaternion.copy(quat);
    clone.scale.setScalar(scale.y / template.userData.naturalHeight); // match the intended world height
    group.add(clone);
  }
  scene.add(group);
  palmMesh.visible = false; // hide, don't remove — cheap and trivially reversible
  return group;
}
