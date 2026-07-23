// Grassland World — boats: definitions, placement registration, the walkable
// (non-ridden) deck height contributor, drive physics, and chimney smoke.
// Boarding/disembarking mutate character state, so those live in controller.js;
// it registers a board handler here so this module never reaches into the
// character controller's internals.
import * as THREE from 'three';
import { terrainHeight, WATER_Y } from './world.js';

// disembark: 'step' = climb down onto the surface with the step-out clip (no
// jump); 'leap' = a single ballistic hop using the running-jump clip.
// deckOffset/deckInset define the WALKABLE deck surface (see boatHeight) — tune
// deckOffset up/down so feet sit on the visible floor for each boat.
export const BOAT_DEFS = {
  'boat-row-small':     { label: 'Board the rowboat',      sitClip: 'sitRow',  seatAlong: -1.85,  seatUp: .64, faceOffset: 0,        turn: 2, accel: 2.6, maxSpeed: 10, fwdSign: 1, paddles: true, rowAmp: 0.5, disembark: 'leap', deckOffset: 0.42, deckInset: 0.6 },
  'boat-fishing-small': { label: 'Board the fishing boat', sitClip: 'sitFish', seatAlong: -2.4, seatUp: 1.35, faceOffset: Math.PI/2, turn: 2, accel: 2.0, maxSpeed: 12, fwdSign: 1, smoke: true, disembark: 'leap', deckOffset: 0.7, deckInset: 0.5 },
};
export const FISH_SMOKE = { along: 1.1, side: 0.45, up: 1.95 };

export const boats = [];
export const interactables = [];
let _boardHandler = null;
export function setBoardHandler(fn) { _boardHandler = fn; }

export function registerBoat(scene, animated, obj, name) {
  const def = BOAT_DEFS[name];
  const b = { obj, name, def, rowPhase: 0, ridden: false, heading: 0, speed: 0 };
  if (def.paddles) b.paddles = obj.getObjectByName('paddles');
  boats.push(b);
  const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  // Walkable deck: a flat surface inset from the hull, a little above the base,
  // folded into groundHeight so you can board on foot and stand like on the bridge.
  b.deckY = obj.position.y + (def.deckOffset ?? 0.4);
  b.deckHalf = { x: size.x * 0.5 * (def.deckInset ?? 0.6), z: size.z * 0.5 * (def.deckInset ?? 0.6) };
  interactables.push({
    pos: () => obj.position,
    radius: Math.max(size.x, size.z) * 0.5 + 1.8,
    enabled: () => !b.ridden,
    label: () => def.label,
    run: () => _boardHandler && _boardHandler(b),
  });
  if (def.smoke) {
    const smoke = makeChimneySmoke();
    scene.add(smoke);
    b.smoke = smoke;
    animated.push(dt => updateSmoke(smoke, b, dt));
  }
  return b;
}

// A non-ridden boat's deck reads as ground (like the bridge) so you can climb
// aboard on foot and walk around; the ridden boat is driven by the seat logic.
export function boatHeight(x, z) {
  let best = -Infinity;
  for (const b of boats) {
    if (b.ridden || b.deckY === undefined) continue;
    const dx = x - b.obj.position.x, dz = z - b.obj.position.z;
    const c = Math.cos(-b.obj.rotation.y), s = Math.sin(-b.obj.rotation.y);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < b.deckHalf.x && Math.abs(lz) < b.deckHalf.z) best = Math.max(best, b.deckY);
  }
  return best;
}

let bobT = 0;
export function updateBoat(dt, b, keys, char) {
  const d = b.def, o = b.obj;
  bobT += dt;
  const fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const turn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
  const speedFrac = Math.min(1, Math.abs(b.speed) / d.maxSpeed);
  b.heading += turn * d.turn * dt * (0.45 + 0.55 * speedFrac);
  const target = fwd * d.maxSpeed * d.fwdSign;
  b.speed += (target - b.speed) * Math.min(1, dt * d.accel);
  b.speed *= (1 - dt * 0.5);                     // water drag
  const nx = o.position.x + Math.sin(b.heading) * b.speed * dt;
  const nz = o.position.z + Math.cos(b.heading) * b.speed * dt;
  const afloat = (WATER_Y - terrainHeight(nx, nz)) > 0.45;
  if (Math.abs(nx) < 94 && Math.abs(nz) < 94 && afloat) { o.position.x = nx; o.position.z = nz; }
  else b.speed *= 0.25;                          // stall against the shallows
  o.rotation.y = b.heading;
  o.position.y = (WATER_Y - 0.15) + Math.sin(bobT * 1.2) * 0.05;
  o.rotation.z = Math.sin(bobT * 0.9) * 0.02;      // gentle roll
  char.position.set(
    o.position.x + Math.sin(b.heading) * d.seatAlong,
    o.position.y + d.seatUp,
    o.position.z + Math.cos(b.heading) * d.seatAlong
  );
  char.rotation.y = b.heading + d.faceOffset;
  if (b.paddles) {                                  // both oars sweep together, paced by speed
    const active = Math.abs(b.speed) > 0.12;
    b.rowPhase += dt * (2.5 + 6 * speedFrac);
    b.paddles.rotation.x = Math.sin(b.rowPhase) * (active ? d.rowAmp : d.rowAmp * 0.24);
  }
}

function makeChimneySmoke() {
  const g = new THREE.Group();
  g.userData.puffs = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.16, 0),
      new THREE.MeshLambertMaterial({ color: 0xdedcd2, transparent: true, flatShading: true })
    );
    g.add(m);
    g.userData.puffs.push({ m, life: i / 6, spin: Math.random() * 6, dx: (Math.random() - .5) * .3, dz: (Math.random() - .5) * .3 });
  }
  return g;
}
function updateSmoke(g, b, dt) {
  const o = b.obj, h = o.rotation.y;
  const cx = o.position.x + Math.sin(h) * FISH_SMOKE.along + Math.cos(h) * FISH_SMOKE.side;
  const cz = o.position.z + Math.cos(h) * FISH_SMOKE.along - Math.sin(h) * FISH_SMOKE.side;
  const cy = o.position.y + FISH_SMOKE.up;
  for (const p of g.userData.puffs) {
    p.life += dt * 0.32;
    if (p.life > 1) p.life -= 1;
    const e = p.life;
    p.m.position.set(cx + p.dx * e * 3, cy + e * 1.7, cz + p.dz * e * 3);
    p.m.scale.setScalar(0.4 + e * 1.5);
    p.m.rotation.y = p.spin + e * 2;
    p.m.material.opacity = Math.max(0, 0.7 * (1 - e));
  }
}
