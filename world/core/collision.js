// World Shell — collision: circle/OBB colliders, a uniform spatial hash for
// cheap local queries, positional push-out-with-sliding movement resolution,
// and a support-surface query for standing on top of things. Model-agnostic
// on purpose: no character/rendering globals, so any zone's props/scatter and
// the shared character controller call the exact same
// queryColliders/resolveMovement/supportAt. No physics engine — pure
// position correction.
//
// Lifted from grassland/collision.js's module-level singleton into a factory
// (createCollisionRegistry()) so the shell can own one instance, hand it to
// every zone's build(ctx), and reset() it before building a new zone —
// otherwise a disposed zone's colliders (backed by freed Object3Ds) would
// linger in the spatial hash and get queried by the next zone.
//
// Every collider carries a vertical band, yLow/yHigh, always in ABSOLUTE
// WORLD-Y (never relative, never local). resolveMovement skips a collider
// once the mover's [feetY, headY] band no longer overlaps it (stepped onto
// it, or passing underneath); supportAt answers "what could I stand on here"
// using yHigh values on colliders explicitly marked standable.
export function createCollisionRegistry() {
  const CELL = 8;
  let _nextId = 1;
  let _colliders = new Map(); // id -> record
  let _grid = new Map();      // "cx,cz" -> Set<id>
  let _noclip = false;

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
  // a live registry the area designer can move) store a `live()` getter
  // instead, re-read fresh every time shape data is needed. Only the spatial
  // hash's cell bucketing is fixed at insert time either way.
  const liveX = rec => rec.live ? rec.live().x : rec.x;
  const liveZ = rec => rec.live ? rec.live().z : rec.z;
  const liveRot = rec => rec.live ? rec.live().rot : rec.rot;

  function addCircle(x, z, r, yLow = -Infinity, yHigh = Infinity, standable = true, live) {
    const rec = { id: _nextId++, shape: 'circle', x, z, r, yLow, yHigh, standable, live };
    const cx = liveX(rec), cz = liveZ(rec);
    rec._minX = cx - r; rec._maxX = cx + r; rec._minZ = cz - r; rec._maxZ = cz + r;
    insert(rec);
    _colliders.set(rec.id, rec);
    return rec;
  }
  function addOBB(x, z, hw, hd, rot, yLow = -Infinity, yHigh = Infinity, standable = true, live) {
    const rec = { id: _nextId++, shape: 'obb', x, z, hw, hd, rot, yLow, yHigh, standable, live };
    const cx = liveX(rec), cz = liveZ(rec), diag = Math.hypot(hw, hd); // conservative AABB regardless of rotation
    rec._minX = cx - diag; rec._maxX = cx + diag; rec._minZ = cz - diag; rec._maxZ = cz + diag;
    insert(rec);
    _colliders.set(rec.id, rec);
    return rec;
  }
  function removeCollider(id) {
    const rec = _colliders.get(id);
    if (!rec) return false;
    removeFromGrid(rec);
    _colliders.delete(id);
    return true;
  }
  function queryColliders(x, z, r) {
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
  function getAllColliders() { return [..._colliders.values()]; }

  function setNoclip(v) { _noclip = v === undefined ? !_noclip : !!v; return _noclip; }
  function isNoclip() { return _noclip; }

  // world -> local uses cos(rot)/sin(rot) unnegated (verified against THREE's
  // actual rotation.y matrix — see the zone's bridge/boat height math, same
  // convention).
  function insideCircle(px, pz, rec) {
    const cx = liveX(rec), cz = liveZ(rec);
    return Math.hypot(px - cx, pz - cz) <= rec.r;
  }
  function insideOBB(px, pz, rec) {
    const cx = liveX(rec), cz = liveZ(rec), rot = liveRot(rec);
    const dx = px - cx, dz = pz - cz;
    const c = Math.cos(rot), s = Math.sin(rot);
    const lx = dx * c - dz * s, lz = dx * s + dz * c; // world -> local
    return Math.abs(lx) <= rec.hw && Math.abs(lz) <= rec.hd;
  }
  // "What could I stand on at (x,z)?" — max yHigh among standable colliders
  // whose footprint contains the point, else null.
  function supportAt(x, z) {
    let best = null;
    for (const rec of queryColliders(x, z, 0.01)) {
      if (rec.standable === false) continue;
      const inside = rec.shape === 'circle' ? insideCircle(x, z, rec) : insideOBB(x, z, rec);
      if (inside && (best === null || rec.yHigh > best)) best = rec.yHigh;
    }
    return best;
  }

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
  // component of a collider hit, so the tangential component of the
  // attempted move is preserved by construction — that's the "slide along
  // the wall" feel, not a separate step.
  //
  // opts.feetY/opts.headY (both absolute world-Y) + opts.stepUp define the
  // mover's vertical band. A collider is skipped when yHigh <= feetY+stepUp
  // (already standing on it, or steppable) or yLow >= headY (passing
  // underneath). If feetY/headY aren't supplied, no vertical filtering
  // happens (blocks unconditionally).
  function resolveMovement(x, z, radius, dx, dz, opts = {}) {
    if (_noclip) return { x: x + dx, z: z + dz };
    let nx = x + dx, nz = z + dz;
    const { feetY, headY, stepUp = 0 } = opts;
    for (let pass = 0; pass < 3; pass++) {
      const nearby = queryColliders(nx, nz, radius + 3);
      let moved = false;
      for (const rec of nearby) {
        if (feetY !== undefined && rec.yHigh <= feetY + stepUp) continue; // steppable or already above it
        if (headY !== undefined && rec.yLow >= headY) continue;           // passing underneath it
        const hit = rec.shape === 'circle' ? resolveCircleCircle(nx, nz, radius, rec) : resolveCircleOBB(nx, nz, radius, rec);
        if (hit) { nx += hit.nx * hit.pen; nz += hit.nz * hit.pen; moved = true; }
      }
      if (!moved) break;
    }
    return { x: nx, z: nz };
  }

  function reset() {
    _colliders = new Map();
    _grid = new Map();
    _nextId = 1;
    _noclip = false;
  }

  return {
    addCircle, addOBB, removeCollider, queryColliders, getAllColliders,
    setNoclip, isNoclip, supportAt, resolveMovement, reset,
  };
}
