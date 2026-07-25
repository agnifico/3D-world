// World Shell — shared night sky: star field + moon, plus the HUD vignette
// switch. Built ONCE at shell startup (like core/fx.js's ripple/splash and
// bloom composer) and added straight to the REAL scene, not any zone's
// private group — so every zone inherits the same sky for free, and it
// survives zone swaps without needing to be rebuilt or disposed.
//
// Moved out of zones/grassland/night-fx.js verbatim (same constants, same
// shaders, same fade curves) — Grassland's night sky must look identical to
// before; only the ownership moved. Fireflies and lit windows stay
// zone-owned (they're tied to Grassland's specific geography/houses) and a
// zone's own bioluminescence/glow (e.g. Lagoon's flora) stays zone-owned too
// — this module is only the shared base sky both zones now render under.
//
// Deliberately NOT here (per the brief): a moving sun/moon arc or a
// continuous day cycle — this is still the static night sky, just
// phase-driven on/off via the existing applyLighting/getT() machinery. The
// moving arc is later work (Brief 7).
import * as THREE from 'three';

export const NIGHT_SKY = {
  STAR_COUNT: 2800,
  STAR_DOME_RADIUS: 340,             // sky-dome radius; re-centred on the camera each frame so stars sit "at infinity"
  STAR_TWINKLE_SPEED: 0.7,
  STAR_FADE: [0.35, 0.85],           // blend-t window over which stars fade in
  MOON_DIR: { x: -0.72, y: 0.26, z: -0.4 },  // direction TO the moon — opposite-ish the day sun, low over the landscape
  MOON_DIST: 300,
  MOON_SIZE: 64,                     // world-units across the moon+halo quad
  MOON_CORE: 0xfbf7ff, MOON_HALO: 0x9db6ff,
  MOON_FADE: [0.3, 0.8],
};

const _fade = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));

function pointFieldMaterial(colorHex, twinkleSpeed, pixelRatio) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uOpacity: { value: 0 },
      uSpeed: { value: twinkleSpeed }, uPR: { value: pixelRatio },
      uColor: { value: new THREE.Color(colorHex) },
    },
    vertexShader: `
      uniform float uTime, uSpeed, uPR; attribute float aSize, aPhase; varying float vTw;
      void main() {
        vTw = 0.45 + 0.55 * sin(uTime * uSpeed + aPhase);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPR;
      }`,
    fragmentShader: `
      uniform float uOpacity; uniform vec3 uColor; varying float vTw;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(uColor, a * a * vTw * uOpacity);
      }`,
  });
}

// Call once at shell startup — scene is the REAL THREE.Scene (persists
// across zone swaps), sharedAnimated is the shell's always-running per-frame
// list, lighting is the core/lighting.js instance (its getT() drives the
// fade regardless of which zone is active).
export function initNightSky(scene, sharedAnimated, renderer, camera, lighting) {
  const PR = renderer.getPixelRatio();

  // ---- stars: one Points sky-dome, upper hemisphere, slow twinkle ----
  const SC = NIGHT_SKY.STAR_COUNT;
  const sPos = new Float32Array(SC * 3), sSize = new Float32Array(SC), sPhase = new Float32Array(SC);
  for (let i = 0; i < SC; i++) {
    const th = Math.random() * Math.PI * 2, yy = Math.random() * 1.05 - 0.05, rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    sPos[i * 3] = Math.cos(th) * rr * NIGHT_SKY.STAR_DOME_RADIUS;
    sPos[i * 3 + 1] = yy * NIGHT_SKY.STAR_DOME_RADIUS;
    sPos[i * 3 + 2] = Math.sin(th) * rr * NIGHT_SKY.STAR_DOME_RADIUS;
    sSize[i] = 1.1 + Math.pow(Math.random(), 3) * 2.7;   // a few big bright stars, mostly small
    sPhase[i] = Math.random() * 6.283;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(sPhase, 1));
  const starMat = pointFieldMaterial(0xdfe8ff, NIGHT_SKY.STAR_TWINKLE_SPEED, PR);
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false; stars.renderOrder = -1;
  scene.add(stars);

  // ---- moon: billboarded glowing disc + soft halo ----
  const moonMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uOpacity: { value: 0 },
      uCore: { value: new THREE.Color(NIGHT_SKY.MOON_CORE) },
      uHalo: { value: new THREE.Color(NIGHT_SKY.MOON_HALO) },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uOpacity; uniform vec3 uCore, uHalo; varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float core = smoothstep(0.30, 0.18, r);
        float halo = pow(1.0 - clamp(r, 0.0, 1.0), 3.0) * 0.6;
        vec3 col = uCore * core + uHalo * (halo + core * 0.35);
        gl_FragColor = vec4(col, clamp(core + halo, 0.0, 1.0) * uOpacity);
      }`,
  });
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(NIGHT_SKY.MOON_SIZE, NIGHT_SKY.MOON_SIZE), moonMat);
  moon.frustumCulled = false;
  scene.add(moon);
  const moonDir = new THREE.Vector3(NIGHT_SKY.MOON_DIR.x, NIGHT_SKY.MOON_DIR.y, NIGHT_SKY.MOON_DIR.z).normalize();

  // ---- one update loop for stars + moon + the HUD vignette switch ----
  sharedAnimated.push((dt, time) => {
    const t = lighting.getT();

    const so = _fade(t, NIGHT_SKY.STAR_FADE[0], NIGHT_SKY.STAR_FADE[1]);
    stars.visible = so > 0.001;
    if (stars.visible) { stars.position.copy(camera.position); starMat.uniforms.uTime.value = time; starMat.uniforms.uOpacity.value = so; }

    const mo = _fade(t, NIGHT_SKY.MOON_FADE[0], NIGHT_SKY.MOON_FADE[1]);
    moon.visible = mo > 0.001;
    if (moon.visible) { moon.position.copy(camera.position).addScaledVector(moonDir, NIGHT_SKY.MOON_DIST); moon.quaternion.copy(camera.quaternion); moonMat.uniforms.uOpacity.value = mo; }

    document.body.classList.toggle('night', t >= 0.5); // HUD vignette switch
  });

  return { stars, moon };
}
