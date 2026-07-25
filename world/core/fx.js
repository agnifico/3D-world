// World Shell — shared water ripple/splash particle fx, plus the
// EffectComposer/UnrealBloomPass plumbing that lets any zone's night palette
// drive a bloom pass without every zone re-wrapping renderer.render itself.
//
// Both pieces are shell-level, initialized ONCE at startup (not per zone):
// ripples/splash are spawned by the character controller (which persists
// across zone crossings) regardless of which zone is active, and the
// composer wraps `renderer.render` a single time — wrapping it again on every
// zone swap would double-wrap it. Zone-specific night dressing (stars, moon,
// fireflies, lit windows — tied to a particular zone's geometry) stays
// zone-owned; this module only supplies the bloom strength/radius/threshold
// values (via `getBloom`, from core/lighting.js) that any such zone dressing
// reads.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Ripple (swim/boat wake) + splash (dive/leap) particle fx. `sharedAnimated`
// is the shell's always-running per-frame list (independent of which zone is
// active) — callers push the returned update function onto it once.
export function initFx(scene, sharedAnimated) {
  const fx = [];
  sharedAnimated.push(dt => { for (let i = fx.length - 1; i >= 0; i--) if (fx[i](dt)) fx.splice(i, 1); });

  const _rippleGeo = new THREE.RingGeometry(0.55, 0.7, 24).rotateX(-Math.PI / 2);
  function spawnRipple(x, z, waterY, s = 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    const m = new THREE.Mesh(_rippleGeo, mat);
    m.position.set(x, waterY + 0.04, z);
    scene.add(m);
    let t = 0; const life = 1.3;
    fx.push(dt => { t += dt; const k = t / life; m.scale.setScalar(s * (0.3 + 2.6 * k)); mat.opacity = 0.45 * (1 - k); if (k >= 1) { scene.remove(m); mat.dispose(); return true; } });
  }
  const _dropGeo = new THREE.IcosahedronGeometry(0.08, 0);
  function spawnSplash(x, z, waterY, n = 14) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.95, depthWrite: false });
    const drops = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(_dropGeo, mat);
      const a = Math.random() * Math.PI * 2, sp = 1.4 + Math.random() * 2.8;
      m.position.set(x, waterY + 0.1, z); m.scale.setScalar(0.5 + Math.random());
      drops.push({ m, vx: Math.cos(a) * sp, vy: 3 + Math.random() * 3.5, vz: Math.sin(a) * sp });
      scene.add(m);
    }
    spawnRipple(x, z, waterY, 1.6);
    let t = 0; const life = 0.85;
    fx.push(dt => { t += dt; for (const d of drops) { d.vy -= 20 * dt; d.m.position.x += d.vx * dt; d.m.position.y += d.vy * dt; d.m.position.z += d.vz * dt; } mat.opacity = 0.95 * Math.max(0, 1 - t / life); if (t >= life) { for (const d of drops) scene.remove(d.m); mat.dispose(); return true; } });
  }

  return { spawnRipple, spawnSplash };
}

// Wraps renderer.render so it routes through an EffectComposer (RenderPass +
// UnrealBloomPass + OutputPass) whenever getBloom().strength is non-trivial
// AND the active zone opts in (isEnabled()), falling straight through to the
// plain render path otherwise — zero extra cost, and critically, zero risk
// of ever touching Lagoon's render path.
//
// Why the opt-in exists: Lagoon's palettes carry a non-trivial `bloom` field
// even in its DAY keyframe (strength 0.55 — unlike Grassland, whose day
// bloom is 0 and only wakes up at night), so a naive "any zone's bloom
// value" check would route Lagoon through this composer AT ALL TIMES. Lagoon
// was never built for that: its own README lists "EffectComposer +
// UnrealBloomPass rendered black... night glow is in-shader emissive
// instead" as a gotcha already solved — running it through here anyway is
// exactly what caused the shell's Lagoon view to render blown-out/
// differently-graded than zones/lagoon/preview.html (which never runs a
// composer at all). `isEnabled` defaults to always-true so callers that
// don't care (or only ever have one bloom-using zone) don't need to pass it.
export function initComposer(renderer, scene, camera, getBloom, isEnabled = () => true) {
  const PR = renderer.getPixelRatio();
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(PR);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.55, 0.72);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  addEventListener('resize', () => composer.setSize(innerWidth, innerHeight));

  let inComposer = false;
  const origRender = renderer.render.bind(renderer);
  renderer.render = function (scn, cam) {
    if (inComposer) { origRender(scn, cam); return; }
    const b = getBloom();
    if (isEnabled() && b.strength > 0.01) {
      bloomPass.strength = b.strength; bloomPass.radius = b.radius; bloomPass.threshold = b.threshold;
      inComposer = true; composer.render(); inComposer = false;
    } else {
      origRender(scn, cam);
    }
  };
  return composer;
}
