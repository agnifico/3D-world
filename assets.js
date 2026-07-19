// Grassland World — asset factory library (Arc 1 + 2)
// Every factory returns a THREE.Group, pivot at base-center, 1u = 1m.
// Reusable: pure functions of (seed, scale); no scene references.
import * as THREE from 'three';

// ---------- utils ----------
export function rng(seed = 1) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const _mats = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!_mats.has(key)) _mats.set(key, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0, ...opts }));
  return _mats.get(key);
}
function m(geo, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
export const C = {
  green1: 0x7cb356, green2: 0xa8c66c, pine: 0x4e7d44, leafLight: 0xb2c96a,
  brown: 0x8b6f47, brownDark: 0x6b4f35, stone: 0x9a958a, stoneDark: 0x857f74,
  plaster: 0xe3d6b4, birch: 0xddd6c4, sky: 0x9ed2e8, water: 0x4aa8b8, accent: 0xe8c468,
};

// Triangular prism (roof), apex along ridge, pivot at base-center. Bottom face omitted.
export function prismGeometry(w, h, d) {
  const x = w / 2, z = d / 2;
  const v = [
    -x, 0, z, x, 0, z, 0, h, z,
    x, 0, -z, -x, 0, -z, 0, h, -z,
    -x, 0, z, 0, h, z, 0, h, -z, -x, 0, z, 0, h, -z, -x, 0, -z,
    x, 0, -z, 0, h, -z, 0, h, z, x, 0, -z, 0, h, z, x, 0, z,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

// Turn a template Group into InstancedMeshes (one per mesh in the template),
// applying each Matrix4 in `matrices`. Massive draw-call savings for repeats.
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
    out.add(im);
  });
  return out;
}

// Inject a gentle wind sway into an instanced material's vertex shader.
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

// ---------- trees (procedural, seeded) ----------
export function createPineTree(seed = 1, s = 1) {
  const r = rng(seed), g = new THREE.Group();
  const h = (4.5 + r() * 2) * s;
  g.add(m(new THREE.CylinderGeometry(0.16 * s, 0.28 * s, h * 0.3, 6), mat(C.brownDark), 0, h * 0.15, 0));
  const levels = 3;
  for (let i = 0; i < levels; i++) {
    const t = i / levels;
    const rad = (1.7 - t * 1.0) * s * (0.9 + r() * 0.25);
    const ch = h * 0.34;
    g.add(m(new THREE.ConeGeometry(rad, ch, 7), mat(C.pine), 0, h * (0.32 + t * 0.26) + ch * 0.3, 0));
  }
  g.userData.name = 'Pine'; return g;
}
export function createOakTree(seed = 2, s = 1) {
  const r = rng(seed), g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(0.24 * s, 0.42 * s, 2.0 * s, 6), mat(C.brown), 0, 1.0 * s, 0));
  const n = 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r();
    const rad = (1.1 + r() * 0.6) * s;
    g.add(m(new THREE.IcosahedronGeometry(rad, 0), mat(C.green1),
      Math.cos(a) * 0.9 * s, (2.8 + r() * 0.8) * s, Math.sin(a) * 0.9 * s));
  }
  g.add(m(new THREE.IcosahedronGeometry(1.3 * s, 0), mat(C.green1), 0, 3.6 * s, 0));
  g.userData.name = 'Oak'; return g;
}
export function createBirchTree(seed = 3, s = 1) {
  const r = rng(seed), g = new THREE.Group();
  const h = (5 + r() * 1.5) * s;
  g.add(m(new THREE.CylinderGeometry(0.1 * s, 0.17 * s, h, 6), mat(C.birch), 0, h / 2, 0));
  for (let i = 0; i < 3; i++) {
    const a = r() * Math.PI * 2;
    g.add(m(new THREE.IcosahedronGeometry((0.65 + r() * 0.35) * s, 0), mat(C.leafLight),
      Math.cos(a) * 0.5 * s, h * (0.72 + i * 0.11), Math.sin(a) * 0.5 * s));
  }
  g.userData.name = 'Birch'; return g;
}
export function createWillowTree(seed = 4, s = 1) {
  const r = rng(seed), g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(0.28 * s, 0.5 * s, 1.9 * s, 6), mat(C.brownDark), 0, 0.95 * s, 0));
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.6;
    const lobe = m(new THREE.IcosahedronGeometry(0.9 * s, 0), mat(C.green2),
      Math.cos(a) * 1.15 * s, (2.1 + r() * 0.3) * s, Math.sin(a) * 1.15 * s);
    lobe.scale.set(0.65, 1.7 + r() * 0.4, 0.65);
    g.add(lobe);
  }
  g.add(m(new THREE.IcosahedronGeometry(1.0 * s, 0), mat(C.green2), 0, 3.0 * s, 0));
  g.userData.name = 'Willow'; return g;
}
export function createDeadTree(seed = 5, s = 1) {
  const r = rng(seed), g = new THREE.Group();
  const h = (3 + r() * 1.2) * s;
  g.add(m(new THREE.CylinderGeometry(0.12 * s, 0.3 * s, h, 5), mat(0x7a6a58), 0, h / 2, 0));
  const n = 3 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const bh = (1.1 + r() * 0.8) * s;
    const geo = new THREE.CylinderGeometry(0.03 * s, 0.1 * s, bh, 4);
    geo.translate(0, bh / 2, 0);
    const b = m(geo, mat(0x7a6a58), 0, h * (0.45 + r() * 0.4), 0);
    b.rotation.set(0, r() * Math.PI * 2, 0.7 + r() * 0.5);
    g.add(b);
  }
  g.userData.name = 'Dead tree'; return g;
}
export const TREE_FACTORIES = [createPineTree, createOakTree, createBirchTree, createWillowTree, createDeadTree];

// ---------- houses ----------
export function createHouseA() { // plaster cottage
  const g = new THREE.Group();
  g.add(m(new THREE.BoxGeometry(4, 2.6, 3.4), mat(C.plaster), 0, 1.3, 0));
  g.add(m(prismGeometry(4.7, 1.7, 4.0), mat(C.brownDark), 0, 2.6, 0));
  g.add(m(new THREE.BoxGeometry(0.95, 1.55, 0.12), mat(C.brown), 0.9, 0.78, 1.72));
  g.add(m(new THREE.BoxGeometry(0.75, 0.75, 0.1), mat(C.sky), -0.95, 1.5, 1.72));
  g.add(m(new THREE.BoxGeometry(0.55, 1.1, 0.55), mat(C.stone), -1.2, 3.3, 0.6));
  g.userData.name = 'House A — cottage'; return g;
}
export function createHouseB() { // two-story timber
  const g = new THREE.Group();
  g.add(m(new THREE.BoxGeometry(3.4, 2.0, 3.2), mat(C.stone), 0, 1.0, 0));
  g.add(m(new THREE.BoxGeometry(3.6, 1.9, 3.4), mat(C.brown), 0, 2.95, 0));
  g.add(m(prismGeometry(4.2, 2.2, 3.9), mat(C.brownDark), 0, 3.9, 0));
  g.add(m(new THREE.BoxGeometry(0.9, 1.5, 0.12), mat(C.brownDark), 0, 0.75, 1.62));
  g.add(m(new THREE.BoxGeometry(0.7, 0.7, 0.1), mat(C.sky), -1.0, 3.1, 1.72));
  g.add(m(new THREE.BoxGeometry(0.7, 0.7, 0.1), mat(C.sky), 1.0, 3.1, 1.72));
  g.userData.name = 'House B — timber'; return g;
}
export function createHouseC() { // long barn
  const g = new THREE.Group();
  g.add(m(new THREE.BoxGeometry(6, 1.1, 3.8), mat(C.stoneDark), 0, 0.55, 0));
  g.add(m(new THREE.BoxGeometry(5.8, 1.9, 3.6), mat(C.brown), 0, 2.0, 0));
  g.add(m(prismGeometry(6.5, 1.9, 4.2), mat(C.brownDark), 0, 2.95, 0));
  g.add(m(new THREE.BoxGeometry(1.5, 1.9, 0.14), mat(C.brownDark), 0, 0.95, 1.92));
  g.userData.name = 'House C — barn'; return g;
}

// ---------- landmarks ----------
export function createWatchtower() {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(2.0, 2.5, 1.4, 8), mat(C.stoneDark), 0, 0.7, 0));
  g.add(m(new THREE.CylinderGeometry(1.4, 1.9, 6.8, 8), mat(C.stone), 0, 4.8, 0));
  g.add(m(new THREE.CylinderGeometry(2.3, 2.3, 0.5, 8), mat(C.brown), 0, 8.4, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(m(new THREE.BoxGeometry(0.18, 1.0, 0.18), mat(C.brownDark), Math.cos(a) * 2.05, 9.1, Math.sin(a) * 2.05));
  }
  g.add(m(new THREE.ConeGeometry(2.5, 1.9, 8), mat(C.brownDark), 0, 10.5, 0));
  g.userData.name = 'Watchtower'; return g;
}
export function createWindmill() {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(1.7, 2.5, 7, 8), mat(C.plaster), 0, 3.5, 0));
  g.add(m(new THREE.ConeGeometry(2.0, 1.8, 8), mat(C.brownDark), 0, 7.85, 0));
  g.add(m(new THREE.BoxGeometry(0.9, 1.5, 0.12), mat(C.brownDark), 0, 0.75, 2.42));
  const hub = new THREE.Group();
  hub.position.set(0, 6.9, 2.05);
  hub.add(m(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 6).rotateX(Math.PI / 2), mat(C.brownDark), 0, 0, 0.2));
  for (let i = 0; i < 4; i++) {
    const blade = m(new THREE.BoxGeometry(0.55, 4.6, 0.1), mat(C.accent), 0, 2.4, 0.45);
    const arm = new THREE.Group(); arm.rotation.z = (i / 4) * Math.PI * 2; arm.add(blade); hub.add(arm);
  }
  g.add(hub);
  g.userData.name = 'Windmill'; g.userData.blades = hub;
  return g;
}
// Arched bridge, length along local Z. Deck height above group origin:
export function bridgeDeckHeight(lz) { const t = Math.min(1, Math.abs(lz) / 6.5); return 1.5 * (1 - t * t) + 0.25; }
export function createStoneBridge() {
  const g = new THREE.Group();
  const segs = 5, half = 6.5;
  for (let i = 0; i < segs; i++) {
    const z0 = -half + (i / segs) * half * 2, z1 = -half + ((i + 1) / segs) * half * 2;
    const zm = (z0 + z1) / 2;
    const y0 = bridgeDeckHeight(z0), y1 = bridgeDeckHeight(z1);
    const len = Math.hypot(z1 - z0, y1 - y0);
    const deck = m(new THREE.BoxGeometry(3.2, 0.45, len + 0.15), mat(C.stone), 0, (y0 + y1) / 2 - 0.22, zm);
    deck.rotation.x = -Math.atan2(y1 - y0, z1 - z0);
    g.add(deck);
    for (const side of [-1.5, 1.5]) {
      const rail = m(new THREE.BoxGeometry(0.28, 0.55, len + 0.15), mat(C.stoneDark), side, (y0 + y1) / 2 + 0.22, zm);
      rail.rotation.x = deck.rotation.x;
      g.add(rail);
    }
  }
  for (const [sx, sz] of [[-1.5, -6.3], [1.5, -6.3], [-1.5, 6.3], [1.5, 6.3]])
    g.add(m(new THREE.BoxGeometry(0.5, 1.1, 0.5), mat(C.stoneDark), sx, 0.55, sz));
  g.userData.name = 'Stone bridge'; return g;
}
export function createRuinedArch() {
  const g = new THREE.Group();
  const r = rng(11);
  for (const px of [-1.8, 1.8]) {
    let y = 0;
    const blocks = px < 0 ? 4 : 3;
    for (let i = 0; i < blocks; i++) {
      const bh = 0.85;
      const b = m(new THREE.BoxGeometry(1.0 - i * 0.05, bh, 1.0 - i * 0.05), mat(C.stone), px + (r() - 0.5) * 0.15, y + bh / 2, (r() - 0.5) * 0.15);
      b.rotation.y = (r() - 0.5) * 0.2;
      g.add(b); y += bh;
    }
  }
  const arch = m(new THREE.TorusGeometry(1.85, 0.42, 5, 9, Math.PI * 0.72), mat(C.stoneDark), 0, 3.0, 0);
  arch.rotation.z = Math.PI * 0.14;
  g.add(arch);
  for (let i = 0; i < 5; i++)
    g.add(m(new THREE.BoxGeometry(0.5 + r() * 0.4, 0.4, 0.5 + r() * 0.3), mat(C.stone), (r() - 0.5) * 5, 0.2, 1 + r() * 2));
  g.userData.name = 'Ruined arch'; return g;
}

// ---------- hero props ----------
export function createWell() {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(1.0, 1.1, 0.95, 8), mat(C.stone), 0, 0.48, 0));
  g.add(m(new THREE.CylinderGeometry(0.75, 0.75, 0.1, 8), mat(0x3d6b73), 0, 0.95, 0));
  for (const px of [-0.95, 0.95])
    g.add(m(new THREE.BoxGeometry(0.16, 1.6, 0.16), mat(C.brownDark), px, 1.5, 0));
  g.add(m(new THREE.CylinderGeometry(0.06, 0.06, 2.0, 5).rotateZ(Math.PI / 2), mat(C.brown), 0, 1.9, 0));
  g.add(m(prismGeometry(2.6, 0.85, 1.7), mat(C.brown), 0, 2.25, 0));
  g.userData.name = 'Well'; return g;
}
export function createCart() {
  const g = new THREE.Group();
  g.add(m(new THREE.BoxGeometry(2.1, 0.14, 1.15), mat(C.brown), 0, 0.72, 0));
  for (const sz of [-0.62, 0.62])
    g.add(m(new THREE.BoxGeometry(2.1, 0.4, 0.09), mat(C.brown), 0, 0.98, sz));
  for (const sx of [-1.08, 1.08])
    g.add(m(new THREE.BoxGeometry(0.09, 0.4, 1.15), mat(C.brown), sx, 0.98, 0));
  for (const sz of [-0.66, 0.66]) {
    const w = m(new THREE.CylinderGeometry(0.46, 0.46, 0.11, 10).rotateX(Math.PI / 2), mat(C.brownDark), -0.3, 0.46, sz);
    g.add(w);
  }
  for (const sz of [-0.4, 0.4]) {
    const h = m(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 5), mat(C.brownDark), 1.6, 0.55, sz);
    h.rotation.z = -1.15;
    g.add(h);
  }
  g.userData.name = 'Cart'; return g;
}
export function createSignpost() {
  const g = new THREE.Group();
  g.add(m(new THREE.BoxGeometry(0.15, 2.3, 0.15), mat(C.brownDark), 0, 1.15, 0));
  const b1 = m(new THREE.BoxGeometry(1.15, 0.3, 0.07), mat(C.brown), 0.35, 1.95, 0);
  b1.rotation.y = 0.35;
  const b2 = m(new THREE.BoxGeometry(1.0, 0.3, 0.07), mat(C.brown), -0.3, 1.55, 0);
  b2.rotation.y = -2.6;
  g.add(b1, b2);
  g.userData.name = 'Signpost'; return g;
}

// ---------- scatter props ----------
export function createRock(variant = 0, seed = 7) {
  const r = rng(seed + variant * 31), g = new THREE.Group();
  const rock = m(new THREE.IcosahedronGeometry(0.55, 0), mat(variant === 1 ? C.stoneDark : C.stone));
  rock.scale.set(0.8 + r() * 0.7, 0.5 + r() * 0.45, 0.8 + r() * 0.7);
  rock.position.y = rock.scale.y * 0.38;
  rock.rotation.y = r() * Math.PI;
  g.add(rock);
  if (variant === 2) {
    const r2 = m(new THREE.IcosahedronGeometry(0.32, 0), mat(C.stoneDark), 0.55, 0.16, 0.2);
    g.add(r2);
  }
  g.userData.name = 'Rock ' + 'ABC'[variant]; return g;
}
export function createBush(seed = 8) {
  const r = rng(seed), g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const b = m(new THREE.IcosahedronGeometry(0.45 + r() * 0.25, 0), mat(C.green1),
      (r() - 0.5) * 0.7, 0.35 + r() * 0.15, (r() - 0.5) * 0.7);
    b.scale.y = 0.75;
    g.add(b);
  }
  g.userData.name = 'Bush'; return g;
}
export function createMushroom(seed = 9) {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(0.05, 0.08, 0.2, 5), mat(0xe8dfc8), 0, 0.1, 0));
  g.add(m(new THREE.ConeGeometry(0.17, 0.15, 6), mat(0xc96e5a), 0, 0.25, 0));
  g.userData.name = 'Mushroom'; return g;
}
export function createFlower(color = 0xe8c468) {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(0.02, 0.03, 0.36, 4), mat(0x6a9a4e), 0, 0.18, 0));
  g.add(m(new THREE.IcosahedronGeometry(0.09, 0), mat(color), 0, 0.4, 0));
  g.userData.name = 'Flower'; return g;
}
export const FLOWER_COLORS = [0xe8c468, 0xe8956d, 0xefe9d8, 0xc96e6e, 0xb48fb3];

// Grass tuft: 3 single-triangle blades, near-zero cost when instanced.
export function grassTuftGeometry() {
  const pos = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const c = Math.cos(a), s = Math.sin(a);
    const bx = c * 0.05, bz = s * 0.05, w = 0.05, h = 0.38 + (i % 2) * 0.14;
    pos.push(bx - s * -w, 0, bz - c * w, bx + s * -w, 0, bz + c * w, bx + c * 0.24, h, bz + s * 0.24);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function createCrystal(seed = 12) {
  const r = rng(seed), g = new THREE.Group();
  const glow = new THREE.MeshStandardMaterial({ color: 0x7ef2df, emissive: 0x3fd8c2, emissiveIntensity: 1.1, flatShading: true, roughness: 0.4 });
  const n = 3 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const h = 0.5 + r() * 1.2;
    const geo = new THREE.ConeGeometry(0.14 + r() * 0.13, h, 5);
    geo.translate(0, h / 2, 0);
    const c = new THREE.Mesh(geo, glow);
    c.position.set((r() - 0.5) * 0.8, 0, (r() - 0.5) * 0.8);
    c.rotation.set((r() - 0.5) * 0.5, r() * Math.PI, (r() - 0.5) * 0.5);
    c.castShadow = c.receiveShadow = true;
    g.add(c);
  }
  g.add(m(new THREE.IcosahedronGeometry(0.5, 0), mat(C.stoneDark), 0, 0.12, 0));
  g.userData.name = 'Crystal'; return g;
}

// ---------- character (Arc 0 placeholder — replaced in Arc 3) ----------
export function createCharacter() {
  const g = new THREE.Group();
  const body = m(new THREE.CapsuleGeometry(0.34, 0.72, 4, 8), mat(C.accent), 0, 0.72, 0);
  const head = m(new THREE.SphereGeometry(0.27, 8, 6), mat(0xecd9b0), 0, 1.42, 0);
  const nose = m(new THREE.ConeGeometry(0.06, 0.14, 5).rotateX(Math.PI / 2), mat(0xd9b98c), 0, 1.42, 0.27);
  g.add(body, head, nose);
  g.userData.name = 'Character (placeholder)'; return g;
}
