// World Shell — collision foundation: reads a `collide` spec (see the
// header comment on core/world-edits.js for the full schema) and registers
// its shapes into ctx.collisionRegistry (blockers) and ctx.heightRegistry
// (deck/stand-on surfaces). This is the ONE place that turns spec data into
// live colliders — core/collision.js itself stays shape-agnostic (circle/OBB
// primitives only), this module is the adapter between the richer authoring
// vocabulary (box/sphere/capsule/cone/deck) and that 2D-XZ-plus-vertical-band
// engine.
//
// Static vs dynamic (the perf split the COLLISION-FOUNDATION-SESSION brief
// mandates): `collideSpec.static !== false` (the default) bakes every
// shape's WORLD transform ONCE, right now — cheap, correct for anything that
// never moves after placement (docks, buildings, decor — today's only real
// caller, core/world-edits.js's applyEdits). `static: false` instead keeps
// each shape attached to `obj` via a `live` getter re-read on every query
// (same convention grassland/props.js's area-designer colliders already use
// for a movable prop) — for a moving object (a ridden boat), never a mesh
// collider, only these compound primitives, so cost stays O(shape count)
// regardless of the model's triangle count. No caller wires `static:false`
// up to a real moving object yet (the ship hookup is its own follow-up, see
// PROJECT-STATE.md) — this module supports it now so that follow-up is a
// data/wiring change, not another engine change.
//
// Two real, accepted limitations of riding on top of core/collision.js's
// existing engine rather than extending it (out of scope for a foundation
// session — see PROJECT-STATE.md):
// 1. Its circle/OBB records only ever track X/Z (+ yaw) live — yLow/yHigh
//    are fixed at registration time (see its own liveX/liveZ/liveRot). A
//    shape's vertical band is therefore always computed from the object's
//    position AT REGISTRATION TIME, static or dynamic alike. Fine for
//    anything that stays near-constant in Y while it moves (a floating
//    boat), same assumption core/boats.js's own boatHeight already makes.
// 2. Its spatial hash buckets a collider into cells ONCE, at registration
//    (insert()), from whatever `live()` reports at that moment — it is
//    never re-bucketed as a dynamic collider's `live()` position drifts
//    into different cells later. A boat that stays roughly in one area
//    (its usual case) keeps working; one that sails far enough to leave its
//    original cells would stop being found by queries near its new
//    position. Fixing this is a collision.js spatial-hash change, not a
//    colliders.js one — flagged for whoever wires up the dynamic ship case.
import * as THREE from 'three';
import { COLLIDER_SPECS } from './collider-catalogue.js';

// Resolves a placed[] row's `collide` field (see core/world-edits.js's
// schema header) into a real spec object, or null for "no collider":
//   'none'                    -> null
//   an explicit {static,shapes} object -> used as-is (per-placement override)
//   'auto' / missing          -> collider-catalogue.js's entry for this
//                                 catalogueId, or null if there isn't one
//                                 (unmapped models stay exactly as
//                                 walk-through as they were before this
//                                 session — no blind geometry-guessing here;
//                                 see collider-catalogue.js's own header for
//                                 why a hand-authored table, not a measured
//                                 fallback, is the seam this session builds).
export function resolveCollideSpec(collide, catalogueId) {
  if (!collide || collide === 'none') return null;
  if (typeof collide === 'object') return collide;
  return COLLIDER_SPECS[catalogueId] || null;
}

const _pos = new THREE.Vector3(), _quat = new THREE.Quaternion(), _scale = new THREE.Vector3();
const _localPos = new THREE.Vector3(), _localQuat = new THREE.Quaternion(), _euler = new THREE.Euler();

function shapeLocalQuat(rot) {
  if (!rot) return _localQuat.identity();
  return _localQuat.setFromEuler(_euler.set(rot[0] || 0, rot[1] || 0, rot[2] || 0, 'XYZ'));
}

// Composes one shape's LOCAL pos/rot (collider-spec space, see the schema)
// with a base world transform (the placed object's own position/rotation/
// scale) into { x, y, z, yaw, sx, sy, sz }. `yaw` is the WORLD-space Y-axis
// rotation only: core/collision.js's OBB/circle primitives are 2D (XZ) +a
// vertical band, so a shape authored with pitch/roll (rot[0]/rot[2]) only
// ever shapes its own local geometry before this projection — it can never
// tilt the engine's actual lateral test. Fine for every shape this session
// needs (flat decks, upright posts); a real limitation for a genuinely
// tilted collider, flagged rather than silently wrong.
function composeShape(shape, basePos, baseQuat, baseScale) {
  _localPos.set(...(shape.pos || [0, 0, 0])).multiply(baseScale);
  _localPos.applyQuaternion(baseQuat).add(basePos);
  const worldQuat = baseQuat.clone().multiply(shapeLocalQuat(shape.rot));
  const yaw = _euler.setFromQuaternion(worldQuat, 'YXZ').y;
  return { x: _localPos.x, y: _localPos.y, z: _localPos.z, yaw, sx: baseScale.x, sy: baseScale.y, sz: baseScale.z };
}

function baseTransform(obj, matrix) {
  if (matrix) { matrix.decompose(_pos, _quat, _scale); return { pos: _pos.clone(), quat: _quat.clone(), scale: _scale.clone() }; }
  obj.updateMatrixWorld(true);
  obj.matrixWorld.decompose(_pos, _quat, _scale);
  return { pos: _pos.clone(), quat: _quat.clone(), scale: _scale.clone() };
}

// Registers every shape in `collideSpec.shapes` against either a live
// Object3D (`obj` — every placed[] row today) or a bare world matrix
// (`matrix` — for a future caller with no per-instance Object3D, e.g. an
// instanced scatter placement, matching how catalogue-flora.js already
// registers rock/tree colliders straight off a THREE.Matrix4). Exactly one
// of `obj`/`matrix` is required; `obj` is also required (in addition to
// `matrix`, if both given) for `static: false`, since dynamic tracking has
// nothing to re-read a live transform from otherwise.
//
// `ctx` needs `.collisionRegistry` and `.heightRegistry` (the zone build
// ctx every zone already receives). Returns a disposer that removes every
// collider + height contributor this call added — unused by this session's
// only caller (applyEdits relies on the shell's own per-zone-build reset
// instead, see core/collision.js/core/height-registry.js), but required for
// any sane dynamic usage later (a boat's colliders must be retractable when
// it despawns/crosses zones without waiting for a full zone rebuild).
export function registerColliders(obj, collideSpec, matrix, ctx) {
  if (!collideSpec || collideSpec === 'none' || collideSpec === 'auto' || !collideSpec.shapes?.length) return () => {};
  const isStatic = collideSpec.static !== false;
  if (!isStatic && !obj) throw new Error('[colliders] a dynamic (static:false) spec needs a live obj to track');

  const disposers = [];
  const base = baseTransform(obj, matrix);

  for (const shape of collideSpec.shapes) {
    if (shape.type === 'deck') { disposers.push(registerDeck(shape, obj, base, isStatic, ctx)); continue; }
    disposers.push(registerBlocker(shape, obj, base, isStatic, ctx));
  }
  return () => { for (const d of disposers) d(); };
}

// box/sphere/capsule/cone — all BLOCKERS (never standable on their own; a
// 'deck' shape is the only way a spec contributes standable height), same
// convention grassland/props.js's own COLLIDER_OVERRIDES already uses for
// fences/lanterns/etc: solid, but you don't climb them.
function registerBlocker(shape, obj, base, isStatic, ctx) {
  // c0 seeds the record's fixed fields (yLow/yHigh always, x/z/yaw too when
  // static) and, even when dynamic, the record's initial spatial-hash
  // bucket (core/collision.js's insert() calls `live()` once up front when
  // present — see this module's own header caveat on why that bucket never
  // moves again as the object roams).
  const c0 = composeShape(shape, base.pos, base.quat, base.scale);
  const live = isStatic ? undefined : () => { const c = liveCompose(shape, obj); return { x: c.x, z: c.z, rot: c.yaw }; };

  const avgXZ = (c0.sx + c0.sz) / 2;
  let rec;
  if (shape.type === 'box') {
    const hw = (shape.size[0] * c0.sx) / 2, hd = (shape.size[2] * c0.sz) / 2, halfH = (shape.size[1] * c0.sy) / 2;
    rec = ctx.collisionRegistry.addOBB(c0.x, c0.z, hw, hd, c0.yaw, c0.y - halfH, c0.y + halfH, false, live);
  } else if (shape.type === 'sphere') {
    const r = shape.r * avgXZ, halfH = shape.r * c0.sy;
    rec = ctx.collisionRegistry.addCircle(c0.x, c0.z, r, c0.y - halfH, c0.y + halfH, false, live);
  } else if (shape.type === 'capsule') {
    const r = shape.r * avgXZ, halfH = (shape.h * c0.sy) / 2 + r;
    rec = ctx.collisionRegistry.addCircle(c0.x, c0.z, r, c0.y - halfH, c0.y + halfH, false, live);
  } else if (shape.type === 'cone') {
    // Coarse: a cone's BASE radius used for its whole vertical band (no
    // taper) — the parametric taper/skew shaping the session brief itself
    // defers to a later session; a vertical cylinder of the base radius is
    // the conservative (never-too-small) stand-in until then.
    const r = shape.r * avgXZ, halfH = (shape.h * c0.sy) / 2;
    rec = ctx.collisionRegistry.addCircle(c0.x, c0.z, r, c0.y - halfH, c0.y + halfH, false, live);
  } else {
    console.warn(`[colliders] unknown shape type "${shape.type}" — skipped`);
    return () => {};
  }
  return () => ctx.collisionRegistry.removeCollider(rec.id);
}

function liveCompose(shape, obj) {
  obj.updateMatrixWorld(true);
  obj.matrixWorld.decompose(_pos, _quat, _scale);
  return composeShape(shape, _pos, _quat, _scale);
}

// A 'deck' shape is HEIGHT ONLY — a flat standable rectangle folded into
// ctx.heightRegistry, same pattern as core/boats.js's boatHeight/
// grassland/props.js's bridgeHeight (both plain height-registry functions,
// never collisionRegistry entries) — never a collisionRegistry blocker, so
// it never walls off the space beneath/beside it the way a box would.
// `shape.y` (if given) overrides `shape.pos[1]` as the local walkable-surface
// height — both spellings of the same number are accepted (see the schema
// header) since `y` is the one authors will retune most.
function registerDeck(shape, obj, base, isStatic, ctx) {
  const local = { ...shape, pos: [shape.pos?.[0] ?? 0, shape.y ?? shape.pos?.[1] ?? 0, shape.pos?.[2] ?? 0] };
  const hw0 = local.size[0] / 2, hd0 = local.size[1] / 2;

  function heightAt(x, z, c) {
    const dx = x - c.x, dz = z - c.z;
    const cw = Math.cos(c.yaw), sw = Math.sin(c.yaw);
    const lx = dx * cw - dz * sw, lz = dx * sw + dz * cw; // world -> local
    if (Math.abs(lx) > hw0 * c.sx || Math.abs(lz) > hd0 * c.sz) return -Infinity;
    return c.y;
  }

  let fn;
  if (isStatic) {
    const c0 = composeShape(local, base.pos, base.quat, base.scale); // baked once — see this module's header
    fn = (x, z) => heightAt(x, z, c0);
  } else {
    fn = (x, z) => heightAt(x, z, liveCompose(local, obj));
  }
  return ctx.heightRegistry.register(fn, 'placed-deck');
}
