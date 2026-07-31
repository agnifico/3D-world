// World Shell — per-CATALOGUE-MODEL collider specs (COLLISION-FOUNDATION-
// SESSION). Keyed by the exact `catalogueId` string from
// world/assets/catalogue.json, so authoring one entry here propagates to
// EVERY placed[] row that uses that model, in every zone — a row's own
// `collide` only needs to say 'auto' (core/world-edits.js's
// resolveCollideSpec looks the catalogueId up here) or, for a genuine
// one-off, an explicit `{static, shapes}` object of its own (per-placement
// override, checked FIRST — see resolveCollideSpec).
//
// Units are the MODEL's own unscaled local space (same convention every
// other measurement in this codebase uses — core/gltf-assets.js's
// measureTrunkRadius/measureFootprint, grassland/props.js's lowSliceBox):
// `pos`/`size`/`y` are in the model's own units, local origin at its base
// (every loaded template is re-pivoted to bbox.min.y===0 by
// core/gltf-assets.js's loadRaw — "pivot at base", CLAUDE.md's own hard
// constraint). core/colliders.js multiplies these by the placement's actual
// world scale (row.scale * the pack's policy.scaleFactor) when it composes
// each shape, so these numbers do NOT need to account for scale themselves.
//
// The three Dock entries below are reasoned from the real GLB geometry
// (accessor min/max bounds, measured directly — not eyeballed) but the
// WALKABLE SURFACE height within that measured envelope is a first-pass
// estimate, not something bounds alone can prove — see PROJECT-STATE.md's
// entry for this session for the concrete "what to eyeball first" note.
// Dock/Dock_Broken measured footprint ~2.2x2.7 (x/z), height ~3.0, base at
// local y=0 (pivot, per the convention above); Dock_Pole's footprint is
// much smaller (~0.37x0.38) but the SAME ~3.0 height.
export const COLLIDER_SPECS = {
  // Deck (stand-on, not a wall) biased toward the lower part of the
  // measured envelope — most of a dock's height is piling driven down
  // toward the waterline, not walkway above it. Footprint inset ~15% from
  // the full measured bbox (same shrink idea as props.js's shrinkHalf) so
  // the collider doesn't bleed past the visible planks' edge.
  'pirates:Environment:Dock:normal:alive:': {
    static: true,
    shapes: [
      { type: 'deck', size: [1.9, 2.3], y: 1.0, pos: [-0.09, 0, -0.02] },
    ],
  },
  'pirates:Environment:Dock_Broken:normal:alive:': {
    static: true,
    shapes: [
      { type: 'deck', size: [2.0, 2.3], y: 1.0, pos: [0.0, 0, -0.02] },
    ],
  },
  // The pole itself: a solid post you can't walk through. Spans virtually
  // the model's FULL measured height (capsule half-extent h/2+r ≈ 1.42,
  // centered at y=1.5 → local [0.08, 2.92] against the measured [0, 3.01])
  // deliberately — unlike the deck surface, getting this vertical band
  // wrong in the "too short" direction would silently break the "can't
  // walk through the poles" proof, so it errs generous rather than precise.
  'pirates:Environment:Dock_Pole:normal:alive:': {
    static: true,
    shapes: [
      { type: 'capsule', r: 0.22, h: 2.4, pos: [-0.02, 1.5, -0.01] },
    ],
  },
};
