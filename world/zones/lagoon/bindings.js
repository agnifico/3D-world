// Lagoon — Layer 2 binding table (RESOLVER-BINDING-SESSION). Same shape and
// role as grassland/bindings.js: { family, id, count?, scale?, rotation?,
// tint?, where? }. `family` doubles as catalogue-flora.js's own group-spec
// family key, same convention as grassland's table.
//
// `shoreBush` history: originally hardcoded `{set:'Simple_Nature',
// family:'Grass'}` (the comment said "Simple_Nature bush" but the code
// actually requested BIGNature rocks — PROJECT-STATE.md's flagged bug), then
// mid-fix (uncommitted, found already sitting in the working tree this
// session) `{set:'NNK Style', family:'Bush'}` — closer, but 'Bush' isn't a
// real NNK family (it's 'Bush_Common'), so it was silently resolving to
// nothing and getting dropped by asset-diagnostics' missing-asset guard.
// Fixed here as part of the NNK binding proof this session: the real family
// name, so it actually resolves and renders — this is also the "bind ONE
// NNK family into a zone via the table" proof the session brief asks for,
// landed as a real scatter species rather than a one-off static prop.
//
// `where`/`rotation` are only meaningful on `mainShip` below — a single
// hand-placed prop, not a scattered species. The other four rows are
// SCATTER slots: the existing placeBand loop in catalogue-flora.js owns its
// own count/budget (catalogueBands in terrain.js), so `count` here is
// unused for them.
export const bindings = {
  palmTree:  { family: 'PalmTree',    id: 'pirates:Environment:PalmTree:normal:alive:' },
  seaweed:   { family: 'Grass',       id: 'Simple_Nature::Grass:normal:alive:' },
  reefRock:  { family: 'Rock',        id: 'pirates:Environment:Rock:normal:alive:' },
  shoreBush: { family: 'Bush_Common', id: 'BIGNature::Plant:normal:alive:' },

  // Proof binding (RESOLVER-BINDING-SESSION) — a single hand-placed prop,
  // not a scatter species. (25,-25) numerically checked against terrain.js's
  // own terrainHeight/depthAt — depth 6.15u, clear of every islet (nearest
  // is Kiln at (31,9), r=25, ~34.5u away) and sandbar, same discipline the
  // portal-arch placements already use for their own coordinates. Native
  // bbox measured directly off the GLB (15.4 x 11.5 x 5.3u) reads as a
  // sane "Large" ship size at policy scale 1 — no override needed.
  // `rot` is world-editor session's 3-axis proof value ([0.3,0,0.2], the
  // session's own prescribed test vector) — a visible list/pitch, standing
  // in for the previous Y=0.4 heading (dropped, not preserved: the exact
  // prescribed vector was used as-is rather than blended with it). This row
  // moves into lagoon/edits.js's placed[] in the very next phase — tune the
  // tilt for real (or re-add a heading) via the World Editor once it lands,
  // not by hand-editing this file.
  mainShip: { family: 'Large', id: 'pirates:Ship:Large:normal:alive:', where: { x: 25, z: -25 }, rot: [0.3, 0, 0.2] },
};
