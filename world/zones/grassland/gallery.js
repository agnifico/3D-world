// Grassland zone — asset gallery (press G): every factory on a pedestal,
// slowly rotating — the inspect/iterate view. Owns its own G-key listener
// (moved here from the shared character controller, since the gallery is
// zone content, not a shell/character concern) and the 3D gallery scene's
// open/closed flag.
import * as THREE from 'three';
import * as A from './assets.js';

let gallery = null;
let inGallery = false;
let onToggle = null; // shell-supplied hook, e.g. to widen fog while browsing

export function buildGallery(ctx, scene, animated, toggleCb) {
  onToggle = toggleCb;
  inGallery = false;
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
    ['survival-kit', 2.0, ['tent', 'tent-canvas', 'campfire-pit', 'campfire-stand', 'campfire-fishing-stand', 'bedroll', 'bedroll-packed', 'bucket', 'bottle', 'fence', 'fence-doorway', 'fence-fortified', 'barrel', 'box', 'box-open', 'workbench', 'workbench-anvil', 'workbench-grind', 'signpost', 'signpost-single', 'tree-log', 'tree-trunk', 'resource-wood', 'resource-planks', 'resource-stone', 'resource-stone-large', 'tool-axe', 'fish']],
    ['fantasy-town-kit', 1.0, ['lantern', 'stall-green', 'stall-bench', 'banner-green', 'hedge', 'hedge-gate', 'wheel']],
    ['castle-kit', 1.0, ['flag']],
    ['watercraft-pack', 1.0, ['boat-row-small', 'ship-large', 'boat-fishing-small']],
  ];
  const KENNEY_OVERRIDES = {
    bedroll: { remap: { '#4aa8b8': 0xe8dfc8 } },
    'bedroll-packed': { remap: { '#4aa8b8': 0xe8dfc8 } },
  };
  const packUrl = pack => pack === 'watercraft-pack' ? `assets/kenney/${pack}` : `zones/grassland/assets/kenney/${pack}`;
  let gi = items.length;
  (async () => {
    for (const [pack, scale, names] of KENNEY_SHORTLIST) {
      for (const name of names) {
        try {
          const obj = await A.loadKenneyModel(`${packUrl(pack)}/${name}.glb`, KENNEY_OVERRIDES[name]);
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
  addEventListener('keydown', e => { if (e.isTrusted && e.code === 'KeyG') toggleGallery(); }, { signal: ctx.abortController.signal });
  return gallery;
}

export function toggleGallery() {
  inGallery = !inGallery;
  gallery.visible = inGallery;
  onToggle?.(inGallery);
  return inGallery;
}
export function isGalleryOpen() { return inGallery; }
export function getGallery() { return gallery; }
