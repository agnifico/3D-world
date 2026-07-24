// Grassland World — collision: circle/OBB colliders, a uniform spatial hash
// for cheap local queries, and positional push-out-with-sliding movement
// resolution. Model-agnostic on purpose: no character/rendering globals, so
// a future animal/NPC wander AI calls the exact same queryColliders/
// resolveMovement. No physics engine — pure position correction, matching
// the controller's existing feel.
const CELL = 8;
let _nextId = 1;
const _colliders = new Map(); // id -> record
const _grid = new Map();      // "cx,cz" -> Set<id>

function cellKey(cx, cz) { return cx + ',' + cz; }
function cellRange(minX, maxX, minZ, maxZ) {
  return [Math.floor(minX / CELL), Math.floor(maxX / CELL), Math.floor(minZ / CELL), Math.floor(maxZ / CELL)];
}
function insert(rec) {
  const [cx0, cx1, cz0, cz1] = cellRange(rec._minX, rec._maxX, rec._minZ, rec._maxZ);
  rec._cells = [];
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
    const k = cellKey(cx, cz);
    let set = _grid.get(k);
    if (!set) { set = new Set(); _grid.set(k, set); }
    set.add(rec.id);
    rec._cells.push(k);
  }
}
function removeFromGrid(rec) {
  for (const k of rec._cells) {
    const set = _grid.get(k);
    if (set) { set.delete(rec.id); if (!set.size) _grid.delete(k); }
  }
}

// Static colliders (scatter-sourced — no per-instance Object3D exists to
// track) store x/z/rot directly. Live colliders (props-sourced — backed by
// props.js's registry, which the Area Designer can move) store a `live()`
// getter instead, re-read fresh every time shape data is needed. Only the
// spatial hash's cell bucketing is fixed at insert time either way — see
// the plan's "Live vs. frozen shape data" note for why that's an acceptable
// simplification (no collider-editing UI exists yet; normal edits don't
// cross an 8-unit cell boundary).
const liveX = rec => rec.live ? rec.live().x : rec.x;
const liveZ = rec => rec.live ? rec.live().z : rec.z;
const liveRot = rec => rec.live ? rec.live().rot : rec.rot;

export function addCircle(x, z, r, blockH = Infinity, live) {
  const rec = { id: _nextId++, shape: 'circle', x, z, r, blockH, live };
  const cx = liveX(rec), cz = liveZ(rec);
  rec._minX = cx - r; rec._maxX = cx + r; rec._minZ = cz - r; rec._maxZ = cz + r;
  insert(rec);
  _colliders.set(rec.id, rec);
  return rec;
}
export function addOBB(x, z, hw, hd, rot, blockH = Infinity, live) {
  const rec = { id: _nextId++, shape: 'obb', x, z, hw, hd, rot, blockH, live };
  const cx = liveX(rec), cz = liveZ(rec), diag = Math.hypot(hw, hd); // conservative AABB regardless of rotation
  rec._minX = cx - diag; rec._maxX = cx + diag; rec._minZ = cz - diag; rec._maxZ = cz + diag;
  insert(rec);
  _colliders.set(rec.id, rec);
  return rec;
}
export function removeCollider(id) {
  const rec = _colliders.get(id);
  if (!rec) return false;
  removeFromGrid(rec);
  _colliders.delete(id);
  return true;
}
export function queryColliders(x, z, r) {
  const [cx0, cx1, cz0, cz1] = cellRange(x - r, x + r, z - r, z + r);
  const seen = new Set(), out = [];
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
    const set = _grid.get(cellKey(cx, cz));
    if (!set) continue;
    for (const id of set) {
      if (seen.has(id)) continue;
      seen.add(id);
      const rec = _colliders.get(id);
      if (rec) out.push(rec);
    }
  }
  return out;
}
export function getAllColliders() { return [..._colliders.values()]; }

let _noclip = false;
export function setNoclip(v) { _noclip = v === undefined ? !_noclip : !!v; return _noclip; }
export function isNoclip() { return _noclip; }

// world -> local uses cos(rot)/sin(rot) unnegated (verified against THREE's
// actual rotation.y matrix during the Part 0 bridge/boat investigation —
// see props.js's bridgeHeight / boats.js's boatHeight, same convention).
function resolveCircleCircle(px, pz, r, rec) {
  const cx = liveX(rec), cz = liveZ(rec);
  const dx = px - cx, dz = pz - cz;
  const dist = Math.hypot(dx, dz);
  const minDist = r + rec.r;
  if (dist >= minDist) return null;
  if (dist < 1e-6) return { nx: 1, nz: 0, pen: minDist }; // degenerate: exactly at center, deterministic fallback
  return { nx: dx / dist, nz: dz / dist, pen: minDist - dist };
}
function resolveCircleOBB(px, pz, r, rec) {
  const cx = liveX(rec), cz = liveZ(rec), rot = liveRot(rec);
  const dx = px - cx, dz = pz - cz;
  const c = Math.cos(rot), s = Math.sin(rot);
  const lx = dx * c - dz * s, lz = dx * s + dz * c; // world -> local
  const clx = Math.max(-rec.hw, Math.min(rec.hw, lx));
  const clz = Math.max(-rec.hd, Math.min(rec.hd, lz));
  const ddx = lx - clx, ddz = lz - clz;
  const dist = Math.hypot(ddx, ddz);
  let nlx, nlz, pen;
  if (dist < 1e-6) {
    // center is inside (or exactly on the boundary of) the box — push out
    // along whichever axis has the LEAST penetration; also the deterministic
    // fallback for "exactly at box center" (lx=lz=0 picks +x by convention)
    const penX = rec.hw - Math.abs(lx), penZ = rec.hd - Math.abs(lz);
    if (penX < penZ) { nlx = lx >= 0 ? 1 : -1; nlz = 0; pen = r + penX; }
    else { nlx = 0; nlz = lz >= 0 ? 1 : -1; pen = r + penZ; }
  } else {
    if (dist >= r) return null;
    nlx = ddx / dist; nlz = ddz / dist; pen = r - dist;
  }
  const nx = nlx * c + nlz * s, nz = -nlx * s + nlz * c; // local -> world (forward rotation)
  return { nx, nz, pen };
}

// Push-out with sliding: only ever adjusts the normal (penetration)
// component of a collider hit, so the tangential component of the attempted
// move is preserved by construction — that's the "slide along the wall"
// feel, not a separate step.
export function resolveMovement(x, z, radius, dx, dz, opts = {}) {
  if (_noclip) return { x: x + dx, z: z + dz };
  let nx = x + dx, nz = z + dz;
  const feetHeight = opts.feetHeight;
  for (let pass = 0; pass < 3; pass++) {
    const nearby = queryColliders(nx, nz, radius + 3);
    let moved = false;
    for (const rec of nearby) {
      if (feetHeight !== undefined && rec.blockH <= feetHeight) continue; // airborne clears low obstacles
      const hit = rec.shape === 'circle' ? resolveCircleCircle(nx, nz, radius, rec) : resolveCircleOBB(nx, nz, radius, rec);
      if (hit) { nx += hit.nx * hit.pen; nz += hit.nz * hit.pen; moved = true; }
    }
    if (!moved) break;
  }
  return { x: nx, z: nz };
}

window.__noclip = () => setNoclip(); // console/debug hook — the overlay's own window.__colliders lives in editor.js
