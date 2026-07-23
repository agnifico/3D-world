// Grassland World — asset gallery (press G): every factory on a pedestal,
// slowly rotating — the inspect/iterate view. Owns only the 3D gallery scene
// and its open/closed flag; HUD text + fog swapping on toggle stay in
// main.js (they need BIOME/CHARACTER, which aren't this module's concern).
import * as THREE from 'three';
import * as A from './assets.js';

let gallery = null;
let inGallery = false;

export function buildGallery(scene, animated) {
  gallery = new THREE.Group();
  gallery.position.set(0, 0, -400);
  gallery.visible = false;

  const ground = new THREE.Mesh(new THREE.CircleGeometry(68, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: A.C.green2, flatShading: true, roughness: 1 }));
  ground.receiveShadow = true;
  gallery.add(ground);
  const items = [
    A.createPineTree(3), A.createOakTree(4), A.createBirchTree(5), A.createWillowTree(6), A.createDeadTree(7),
    A.createHouseA(), A.createHouseB(), A.createHouseC(),
    A.createWatchtower(), A.createWindmill(), A.createStoneBridge(), A.createRuinedArch(),
    A.createWell(), A.createCart(), A.createSignpost(),
    A.createRock(0), A.createRock(1), A.createRock(2), A.createBush(3), A.createMushroom(), A.createFlower(), A.createCharacter(),
  ];
  const cols = 8;
  function galleryPlace(it, i) {
    const gx = ((i % cols) - (cols - 1) / 2) * 11;
    const gz = Math.floor(i / cols) * 12 - 42;
    it.position.set(gx, 0, gz);
    gallery.add(it);
    if (it.userData.blades) animated.push(dt => { if (gallery.visible) it.userData.blades.rotation.z += dt * 0.7; });
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#2e4632'; cx.font = '600 44px system-ui, sans-serif'; cx.textAlign = 'center';
    cx.fillText(it.userData.name || 'Asset', 256, 62);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
    sp.scale.set(5.5, 1.03, 1);
    sp.position.set(gx, 0.6, gz + 3.6);
    gallery.add(sp);
  }
  items.forEach((it, i) => galleryPlace(it, i));
  // --- Kenney shortlist — curated set, loaded through the recolor pipeline ---
  const KENNEY_SHORTLIST = [
    // [pack, scale, models] — survival-kit is authored ~half-scale (fence 0.52u vs ~1u)
    ['survival-kit', 2.0, ['tent', 'tent-canvas', 'campfire-pit', 'campfire-stand', 'campfire-fishing-stand', 'bedroll', 'bedroll-packed', 'bucket', 'bottle', 'fence', 'fence-doorway', 'fence-fortified', 'barrel', 'box', 'box-open', 'workbench', 'workbench-anvil', 'workbench-grind', 'signpost', 'signpost-single', 'tree-log', 'tree-trunk', 'resource-wood', 'resource-planks', 'resource-stone', 'resource-stone-large', 'tool-axe', 'fish']],
    ['fantasy-town-kit', 1.0, ['lantern', 'stall-green', 'stall-bench', 'banner-green', 'hedge', 'hedge-gate', 'wheel']],
    ['castle-kit', 1.0, ['flag']],
    ['watercraft-pack', 1.0, ['boat-row-small', 'boat-fishing-small']],
  ];
  // per-model override map. Two forms (see loadKenneyModel):
  //   { remap: { '#bakedHex': 'paletteKeyOrColor' } }  — recolor one swatch only
  //   { meshOrMaterialName: 'paletteKeyOrColor' }        — whole-mesh solid
  // #4aa8b8 (water teal) lands on the bedroll/sleep-fabric swatch — snap it to
  // desaturated warm cream so bedrolls read as cloth, not water.
  const KENNEY_OVERRIDES = {
    bedroll: { remap: { '#4aa8b8': 0xe8dfc8 } },
    'bedroll-packed': { remap: { '#4aa8b8': 0xe8dfc8 } },
  };
  let gi = items.length;
  (async () => {
    for (const [pack, scale, names] of KENNEY_SHORTLIST) {
      for (const name of names) {
        try {
          const obj = await A.loadKenneyModel(`assets/kenney/${pack}/${name}.glb`, KENNEY_OVERRIDES[name]);
          obj.scale.setScalar(scale);
          obj.userData.name = name;
          galleryPlace(obj, gi++);
        } catch (e) { console.warn(`[kenney] ${name} failed:`, e.message); }
      }
    }
    // hard assert: no image texture may remain on any Kenney mesh after recolor
    let kTex = 0, kMesh = 0, charTex = 0;
    scene.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (o.userData && o.userData.kenney) { kMesh++; for (const mm of mats) if (mm && mm.map) kTex++; }
      else for (const mm of mats) if (mm && mm.map) charTex++;
    });
    console.log(kTex === 0
      ? `[kenney] texture check: PASS — 0 image textures across ${kMesh} Kenney meshes (character retains its own ${charTex} skin texture(s), expected)`
      : `[kenney] texture check: FAIL — ${kTex} textured Kenney material(s) remain`);
  })();
  animated.push(dt => {
    if (!gallery.visible) return;
    for (const it of gallery.children) if (it.isGroup) it.rotation.y += dt * 0.35;
  });

  scene.add(gallery);
  return gallery;
}

export function toggleGallery() {
  inGallery = !inGallery;
  gallery.visible = inGallery;
  return inGallery;
}
export function isGalleryOpen() { return inGallery; }
export function getGallery() { return gallery; }
