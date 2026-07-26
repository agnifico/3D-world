// World Shell — generic THREE instancing helpers. Zone-agnostic (no zone
// imports): originally grassland/assets.js's own private helpers, moved here
// once Lagoon needed the exact same "turn a template into InstancedMeshes"
// and "inject wind sway" logic for its own catalogue-driven GLTF scatter —
// grassland/assets.js re-exports both so its existing `A.makeInstanced`/
// `A.addWind` call sites are unchanged.
import * as THREE from 'three';

// Turn a template Group into InstancedMeshes (one per mesh in the template),
// applying each Matrix4 in `matrices`. Massive draw-call savings for repeats:
// a multi-part template (e.g. a GLTF tree with separate trunk/leaves meshes)
// yields exactly one InstancedMesh per part, NOT one per (part × instance).
export function makeInstanced(template, matrices, opts = {}) {
  template.updateMatrixWorld(true);
  const out = new THREE.Group();
  const tmp = new THREE.Matrix4();
  template.traverse(child => {
    if (!child.isMesh) return;
    const im = new THREE.InstancedMesh(child.geometry, child.material, matrices.length);
    for (let i = 0; i < matrices.length; i++) {
      tmp.multiplyMatrices(matrices[i], child.matrixWorld);
      im.setMatrixAt(i, tmp);
    }
    im.castShadow = opts.shadow !== false;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    // InstancedMesh's own object transform stays identity — every instance
    // lives in the per-instance matrix buffer instead — so the DEFAULT
    // frustum-culling test (which checks geometry.boundingSphere against
    // object.matrixWorld) checks a tiny sphere sitting at local origin, not
    // where the scattered instances actually are, and wrongly culls the
    // whole mesh. Same fix lagoon-fx.js/night-fx.js/night-sky.js already
    // apply to their own scattered InstancedMesh/Points content.
    im.frustumCulled = false;
    out.add(im);
  });
  return out;
}

// Inject a gentle wind sway into an instanced material's vertex shader.
// Derives per-instance phase straight from the instance's own world position
// (instanceMatrix's translation column) — no separate per-instance attribute
// needed, unlike a shader driven by an explicit aPhase buffer.
export function addWind(material, strength = 0.1, speed = 1.7) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 wpp = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        float sww = sin(uTime*${speed.toFixed(2)} + wpp.x*0.4 + wpp.y*0.35) * ${strength.toFixed(3)} * smoothstep(0.02, 0.5, transformed.y);
        transformed.x += sww; transformed.z += sww * 0.7;
      #endif`
    );
    material.userData.shader = shader;
  };
}

// Walks one or more already-in-scene groups and reports (InstancedMesh
// count, total instance count) — the actual pass/fail signal for "variant
// instancing preserved": mesh count should track distinct geometries
// (one per variant part), NOT scale with how many instances were placed.
// Takes an ARRAY of roots to inspect, not a merged group — Object3D.add()
// detaches its argument from any current parent, so building a throwaway
// "combined" group via .add() to summarize already-placed content would
// silently rip it back out of the real scene.
export function summarizeInstancing(label, roots) {
  let meshes = 0, instances = 0;
  for (const root of roots) root.traverse(o => { if (o.isInstancedMesh) { meshes++; instances += o.count; } });
  console.log(`[scatter] ${label}: ${meshes} InstancedMesh (= draw calls) for ${instances} placed instances`);
  return { meshes, instances };
}

// renderer.info.render.calls only reflects the MOST RECENT render() pass, so
// reading it right after build() (before the shell's next frame has actually
// rendered this zone) would report the previous zone's stale count. Queues a
// one-shot read on this zone's own next update() tick instead, guaranteed to
// run after a render() of the new scene has happened.
export function logDrawCallsNextFrame(ctx, renderer, label) {
  let done = false;
  ctx.animated.push(() => {
    if (done) return;
    done = true;
    console.log(`[draw-calls] ${label}: renderer.info.render.calls = ${renderer.info.render.calls}, triangles = ${renderer.info.render.triangles}`);
  });
}
