// Grassland World — water FX: ripples (swim/boat) and dive/leap splash.
// Self-contained: updaters run through the `animated` list.
import * as THREE from 'three';
import { WATER_Y } from './world.js';

export function initFx(scene, animated) {
  const fx = [];
  animated.push(dt => { for (let i = fx.length - 1; i >= 0; i--) if (fx[i](dt)) fx.splice(i, 1); });

  const _rippleGeo = new THREE.RingGeometry(0.55, 0.7, 24).rotateX(-Math.PI / 2);
  function spawnRipple(x, z, s = 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    const m = new THREE.Mesh(_rippleGeo, mat);
    m.position.set(x, WATER_Y + 0.04, z);
    scene.add(m);
    let t = 0; const life = 1.3;
    fx.push(dt => { t += dt; const k = t / life; m.scale.setScalar(s * (0.3 + 2.6 * k)); mat.opacity = 0.45 * (1 - k); if (k >= 1) { scene.remove(m); mat.dispose(); return true; } });
  }
  const _dropGeo = new THREE.IcosahedronGeometry(0.08, 0);
  function spawnSplash(x, z, n = 14) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.95, depthWrite: false });
    const drops = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(_dropGeo, mat);
      const a = Math.random() * Math.PI * 2, sp = 1.4 + Math.random() * 2.8;
      m.position.set(x, WATER_Y + 0.1, z); m.scale.setScalar(0.5 + Math.random());
      drops.push({ m, vx: Math.cos(a) * sp, vy: 3 + Math.random() * 3.5, vz: Math.sin(a) * sp });
      scene.add(m);
    }
    spawnRipple(x, z, 1.6);
    let t = 0; const life = 0.85;
    fx.push(dt => { t += dt; for (const d of drops) { d.vy -= 20 * dt; d.m.position.x += d.vx * dt; d.m.position.y += d.vy * dt; d.m.position.z += d.vz * dt; } mat.opacity = 0.95 * Math.max(0, 1 - t / life); if (t >= life) { for (const d of drops) scene.remove(d.m); mat.dispose(); return true; } });
  }

  return { spawnRipple, spawnSplash };
}
