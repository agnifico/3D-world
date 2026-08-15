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
// Auto-exported by the World Editor's Collision tab — paste over world/core/collider-catalogue.js
// Replaces the WHOLE table — this file's own hand-written header comments
// aren't round-tripped; copy back whichever ones you still want to keep.
export const COLLIDER_SPECS = {
  "pirates:Environment:Dock:normal:alive:": {
    "static": true,
    "shapes": [
      {
        "type": "deck",
        "size": [
          1.9,
          2.064
        ],
        "pos": [
          -0.09,
          0.437,
          0.012
        ],
        "rot": [
          0,
          0,
          0
        ]
      }
    ]
  },
  "pirates:Environment:Dock_Broken:normal:alive:": {
    "static": true,
    "shapes": [
      {
        "type": "deck",
        "size": [
          2,
          2.07
        ],
        "pos": [
          0,
          0.446,
          -0.02
        ],
        "rot": [
          0,
          0,
          0
        ]
      }
    ]
  },
  "pirates:Environment:Dock_Pole:normal:alive:": {
    "static": true,
    "shapes": [
      {
        "type": "capsule",
        "r": 0.22,
        "h": 2.4,
        "pos": [
          -0.02,
          1.5,
          -0.01
        ]
      }
    ]
  },
  "kenney-models::bridge-draw:normal:alive:": {
    "static": true,
    "shapes": [
      {
        "type": "box",
        "size": [
          1.052,
          0.059,
          1
        ],
        "pos": [
          -0.493,
          0,
          0.16
        ],
        "rot": [
          0,
          0,
          0
        ]
      }
    ]
  }
};

