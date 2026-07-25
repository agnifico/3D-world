// Grassland zone — night dressing: fireflies + lit windows. Zone-owned
// because both are tied to Grassland's own geography (shore/meadow drift
// zones, the hamlet's actual house positions) — unlike the star field and
// moon, which moved to core/night-sky.js as a shared, shell-owned base sky
// every zone now inherits. Everything here is still night-only: it fades
// with the day/night blend `t` and is NOT drawn by day.
import * as THREE from 'three';

export const NIGHT = {
  FIREFLY_COUNT: 30,
  FIREFLY_COLOR: 0xffe08a,
  FIREFLY_FADE: [0.55, 0.92],
  FIREFLY_ZONES: [                   // world-space drift zones near the shore / meadow / stream
    { x: 30, z: 28, r: 9 },
    { x: 17, z: 14, r: 8 },
    { x: -3, z: -18, r: 6 },
  ],
  WINDOW_COLOR: 0xffbe66,            // warm interior glow
  WINDOW_FADE: [0.42, 0.72],         // windows "switch on" around dusk
};

// Lit-window rectangles, world-space {x,y,z,w,h,rotY}. Positioned on the
// procedural hamlet houses (+ the windmill).
export const WINDOWS = [
  { x: -13.97, y: 2.92, z: -45.96, w: 0.95, h: 0.9,  rotY: 0.5 },  // House A
  { x: -5.49,  y: 4.85, z: -50.58, w: 0.72, h: 0.72, rotY: -0.3 }, // House B — left
  { x: -3.58,  y: 4.85, z: -49.98, w: 0.72, h: 0.72, rotY: -0.3 }, // House B — right
  { x: -13.59, y: 3.42, z: -36.82, w: 0.8,  h: 0.8,  rotY: 1.9 },  // House C — barn left
  { x: -14.82, y: 3.42, z: -40.41, w: 0.8,  h: 0.8,  rotY: 1.9 },  // House C — barn right
  { x: 56.45,  y: 4.14, z: -56.59, w: 0.7,  h: 0.85, rotY: 2.4 },  // Windmill
];

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

export function initNightFx(ctx, scene, animated, renderer, camera) {
  const PR = renderer.getPixelRatio();

  // ---- fireflies: one Points object, sinusoidal drift in shore/meadow zones ----
  const FC = NIGHT.FIREFLY_COUNT;
  const fBase = new Float32Array(FC * 3), fPos = new Float32Array(FC * 3);
  const fSize = new Float32Array(FC), fPhase = new Float32Array(FC), fp = [];
  for (let i = 0; i < FC; i++) {
    const zone = NIGHT.FIREFLY_ZONES[i % NIGHT.FIREFLY_ZONES.length];
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * zone.r;
    const x = zone.x + Math.cos(a) * rr, z = zone.z + Math.sin(a) * rr;
    const y = Math.max(ctx.terrainHeightFn(x, z), ctx.waterY) + 0.5 + Math.random() * 1.3; // hover above ground OR water, never under it
    fBase[i * 3] = fPos[i * 3] = x; fBase[i * 3 + 1] = fPos[i * 3 + 1] = y; fBase[i * 3 + 2] = fPos[i * 3 + 2] = z;
    fSize[i] = 5 + Math.random() * 4; fPhase[i] = Math.random() * 6.283;
    fp.push({ ax: 0.6 + Math.random() * 1.1, az: 0.6 + Math.random() * 1.1,
              fx: 0.35 + Math.random() * 0.5, fy: 0.7 + Math.random() * 0.7, fz: 0.35 + Math.random() * 0.5,
              px: Math.random() * 6.283, py: Math.random() * 6.283, pz: Math.random() * 6.283 });
  }
  const flyGeo = new THREE.BufferGeometry();
  flyGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
  flyGeo.setAttribute('aSize', new THREE.BufferAttribute(fSize, 1));
  flyGeo.setAttribute('aPhase', new THREE.BufferAttribute(fPhase, 1));
  const flyMat = pointFieldMaterial(NIGHT.FIREFLY_COLOR, 2.6, PR);
  const flies = new THREE.Points(flyGeo, flyMat);
  flies.frustumCulled = false;
  scene.add(flies);

  // ---- lit windows: one merged quad mesh, warm unlit glow ----
  const wPos = [];
  for (const w of WINDOWS) {
    const hw = w.w / 2, hh = w.h / 2, c = Math.cos(w.rotY), s = Math.sin(w.rotY);
    const P = (lx, ly) => [w.x + lx * c, w.y + ly, w.z - lx * s];  // local (+Z-facing) → world, rotated about Y
    const bl = P(-hw, -hh), br = P(hw, -hh), tr = P(hw, hh), tl = P(-hw, hh);
    wPos.push(...bl, ...br, ...tr, ...bl, ...tr, ...tl);
  }
  const winGeo = new THREE.BufferGeometry();
  winGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  const winMat = new THREE.MeshBasicMaterial({ color: NIGHT.WINDOW_COLOR, transparent: true, opacity: 0, side: THREE.DoubleSide, fog: true, depthWrite: false });
  const winMesh = new THREE.Mesh(winGeo, winMat);
  winMesh.renderOrder = 1;
  scene.add(winMesh);

  // ---- one update loop for fireflies + windows ----
  animated.push((dt, time) => {
    const t = ctx.lighting.getT();

    const fo = _fade(t, NIGHT.FIREFLY_FADE[0], NIGHT.FIREFLY_FADE[1]);
    flies.visible = fo > 0.001;
    if (flies.visible) {
      for (let i = 0; i < FC; i++) {
        const b = i * 3, q = fp[i];
        fPos[b]     = fBase[b]     + Math.sin(time * q.fx + q.px) * q.ax;
        fPos[b + 1] = fBase[b + 1] + Math.sin(time * q.fy + q.py) * 0.35;
        fPos[b + 2] = fBase[b + 2] + Math.cos(time * q.fz + q.pz) * q.az;
      }
      flyGeo.attributes.position.needsUpdate = true;
      flyMat.uniforms.uTime.value = time; flyMat.uniforms.uOpacity.value = fo;
    }

    const wo = _fade(t, NIGHT.WINDOW_FADE[0], NIGHT.WINDOW_FADE[1]);
    winMesh.visible = wo > 0.001;
    if (winMesh.visible) winMat.opacity = wo;
  });
}
