// Grassland World — character registry, GLB/FBX loading + retargeting, and the
// locomotion (animation crossfade) layer. loadCharacter() is the reusable
// entry point a future hot-swap brief can call again for a different name.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// One folder per character under assets/, each holding a .glb mesh (which
// carries NO baked animation) plus its animation FBX clips. Switch characters
// with ?char=<name> in the URL, by pressing C in-world, or by changing
// DEFAULT_CHARACTER below. Adding a character = a new folder + an entry here;
// no other code changes.
//
// Every clip is retargeted onto the character's own skeleton at load. Both
// rigs here are VRoid exports whose GLB bones carry a node-index suffix
// (Mia "Hips_01", Vic "J_Bip_C_Hips_025") that the FBX tracks omit ("Hips",
// "J_Bip_C_Hips"); retargetClip bridges that automatically.
//
// `clips` maps the game's logical states to each character's filenames. A clip
// that's absent or fails to load is simply skipped: the state machine falls
// back to the nearest available pose (missing jump → hold locomotion; missing
// boat-sit → idle) and movement/physics keep working.
export const CHARACTERS = {
  mia: {
    dir: 'assets/mia/', model: 'Mia.glb', height: 1.7,
    clips: {
      idle: 'Idle with Skin.fbx', walk: 'Walking.fbx', run: 'Fast Run.fbx',
      jump: 'Running Jump.fbx', jumpIdle: 'Stationary Jump.fbx', jumpWalk: 'Walking Jump.fbx',
      dive: 'Run To Dive.fbx', swim: 'Swimming.fbx',
      sitRow: 'Sitting Cross Legged.fbx', sitFish: 'Laying on Side.fbx',
      hopOut: 'Jumping Out Of A Plane.fbx',
      emote1: 'Static Emote 1.fbx', emote2: 'Laying on Side.fbx', emote3: 'Sexy Dance.fbx',
      // no tread-water clip supplied → treading falls back to idle
    },
  },
  vic: {
    dir: 'assets/vic/', model: 'vic.glb', height: 1.7,
    clips: {
      idle: 'idle_with_skin.fbx', walk: 'Walking.fbx', run: 'Fast Run.fbx',
      jump: 'Jump.fbx', jumpIdle: 'Stationary Jump.fbx', jumpWalk: 'Walking Jump.fbx',
      dive: 'Run To Dive.fbx', swim: 'Swimming.fbx', tread: 'Treading Water.fbx',
      sitRow: 'Sitting Cross Legged.fbx', sitFish: 'Boat Sitting.fbx',
      hopOut: 'Jumping Out Of A Plane.fbx',
      emote1: 'Boat Sitting.fbx', emote2: 'Static Pose.fbx', emote3: 'Booty Hip Hop Dance.fbx'
    },
  },
};
export const DEFAULT_CHARACTER = 'mia';
const _charParam = new URLSearchParams(location.search).get('char');
export const CHARACTER = CHARACTERS[_charParam] ? _charParam : DEFAULT_CHARACTER;

export function createLocomotion(mixer, clips) {
  const actions = {};
  for (const name in clips) actions[name] = mixer.clipAction(clips[name]);
  let currentName = null, returnToName = 'idle';
  function play(name, { fade = 0.2, oneShot = false } = {}) {
    const next = actions[name];
    if (!next || name === currentName) return;
    const prev = currentName ? actions[currentName] : null;
    next.reset();
    if (oneShot) { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; }
    else next.setLoop(THREE.LoopRepeat, Infinity);
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play(); // crossFadeFrom only blends weights — an un-played action drives nothing (T-pose)
    if (prev) next.crossFadeFrom(prev, fade, true);
    if (oneShot) returnToName = currentName || returnToName;
    currentName = name;
  }
  // one-shot clips (jump, punch, ...) hand control back to whatever was playing
  // before them. The mixer `finished` listener itself is wired by the caller
  // (controller.js owns the state that decides whether a return is allowed
  // right now) — `resume` is the hook it calls back into.
  return { setState: play, update: dt => mixer.update(dt), resume: () => play(returnToName, { fade: 0.2 }) };

  window.__model.traverse(o => {
  if (!o.isMesh) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  mats.forEach(m => console.log(o.name, {
    metalness: m.metalness,
    roughness: m.roughness,
    metalnessMap: !!m.metalnessMap,
    normalMap: !!m.normalMap,
    aoMap: !!m.aoMap,
    vertexColors: m.vertexColors,
    hasColorAttr: !!o.geometry.attributes.color,
    hasUV2: !!o.geometry.attributes.uv2 || !!o.geometry.attributes.uv1,
  }));
});
}

// A clip's tracks target bones by name; if a name matches no node the track
// drives nothing and the rig freezes in T-pose. FBX exports vary the naming
// two ways vs the loaded model: a namespace prefix ("mixamorig:Hips") and/or a
// missing node-index suffix ("Hips" where the GLB bone is "Hips_01"). nameMap
// holds every model node keyed by BOTH its full name and its suffix-stripped
// base, so each track resolves by full → namespace-stripped → suffix-stripped.
// Unmatched tracks are dropped.
export function retargetClip(clip, nameMap) {
  const tracks = [], miss = new Set();
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf('.');
    const node = t.name.slice(0, dot), prop = t.name.slice(dot);
    const stripped = node.slice(node.lastIndexOf(':') + 1);
    const target = nameMap[node] || nameMap[stripped] || nameMap[stripped.replace(/_\d+$/, '')];
    if (!target) { miss.add(node); continue; }
    const nt = t.clone();
    nt.name = target + prop;
    tracks.push(nt);
  }
  if (!tracks.length) console.warn(`[character] clip "${clip.name}" matched 0 bones — check skeleton names`);
  else if (miss.size) console.log(`[character] clip "${clip.name}" dropped ${miss.size} unmapped node(s):`, [...miss].slice(0, 6).join(', '));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
// Movement is controller-driven — remove the clip's net travel (start→end
// drift) from a node's position track, keeping in-cycle bob and weight-shift.
export function removeTravel(clip, nodeNames) {
  for (const t of clip.tracks) {
    if (!nodeNames.some(n => t.name === n + '.position')) continue;
    const nf = t.times.length, x0 = t.values[0], z0 = t.values[2];
    const x1 = t.values[(nf - 1) * 3], z1 = t.values[(nf - 1) * 3 + 2];
    const T = t.times[nf - 1] - t.times[0];
    for (let i = 0; i < nf; i++) {
      const f = T ? (t.times[i] - t.times[0]) / T : 0;
      t.values[i * 3] -= (x1 - x0) * f;
      t.values[i * 3 + 2] -= (z1 - z0) * f;
    }
  }
  return clip;
}

// Loads `name`'s GLB mesh + retargeted FBX clips, normalizes scale, and
// builds its mixer/locomotion. Resolves to null (with a console.warn) on
// failure so the caller can keep showing its placeholder.
export async function loadCharacter(name) {
  const CHAR_DEF = CHARACTERS[name];
  const CHAR_HEIGHT = CHAR_DEF.height;
  const gltfCharLoader = new GLTFLoader();
  const fbxLoader = new FBXLoader().setPath(CHAR_DEF.dir);
  const clips = {};

  try {
    const gltf = await gltfCharLoader.loadAsync(CHAR_DEF.dir + CHAR_DEF.model);
    const model = gltf.scene;
    // Build the retarget name map from the model's own nodes. Two passes so a
    // real full name always wins its slot before any suffix-stripped base fills
    // a gap: e.g. FBX "Hips" resolves to the GLB bone "Hips_01".
    const nameMap = {};
    model.traverse(o => { if (o.name && !o.isMesh) nameMap[o.name] = o.name; });
    model.traverse(o => {
      if (!o.name || o.isMesh) return;
      const base = o.name.replace(/_\d+$/, '');
      if (base !== o.name && !(base in nameMap)) nameMap[base] = o.name;
    });
    // Nodes that carry whole-body travel (hips / armature / root). removeTravel
    // strips only their net start→end drift so the controller owns position.
    const rootNodes = [...new Set(Object.values(nameMap))].filter(n => /hips|armature|rootjoint/i.test(n));
    console.log('[character] root nodes:', rootNodes.join(', '));

    await Promise.all(Object.entries(CHAR_DEF.clips).map(([cname, file]) =>
      fbxLoader.loadAsync(file)
        .then(fbx => { clips[cname] = removeTravel(retargetClip(fbx.animations[0], nameMap), rootNodes); })
        .catch(e => console.warn(`[character] clip "${cname}" (${file}) failed:`, e.message))
    ));

    // Skinned meshes animate outside their bind-pose bounds — never frustum-cull.
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

    // Normalize height. GLB is authored ~human scale (Y-up); only stand it up if
    // it reads as authored Z-up (deeper than tall).
    model.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model);
    let size = box.getSize(new THREE.Vector3());
    if (size.z > size.y * 1.4) {
      model.rotation.x = -Math.PI / 2;
      model.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(model);
      size = box.getSize(new THREE.Vector3());
    }
    console.log(`[character] ${CHAR_DEF.model} — size ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} u`);
    model.scale.multiplyScalar(CHAR_HEIGHT / size.y);
    model.updateMatrixWorld(true);
    model.position.y -= new THREE.Box3().setFromObject(model).min.y; // feet at group origin

    const mixer = new THREE.AnimationMixer(model);
    const locomotion = createLocomotion(mixer, clips);
    console.log(`[character] "${name}" loaded, clips:`, Object.keys(clips).join(', '));
    return { model, clips, mixer, locomotion };
  } catch (e) {
    console.warn(`[character] ${name} model failed, using placeholder:`, e.message);
    return null;
  }
}
