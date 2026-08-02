// Grassland — World Editor (Layer 4) data.
// Auto-exported by the World Editor — paste over world/zones/grassland/edits.js
// `boardable` (added by hand): names a boat class in core/boats.js BOAT_DEFS
// ('xiriya' | 'rowboat' | 'fishing' | 'speeder'). A flagged instance is
// registered as a real sailable boat; unflagged ships stay decor.
export const edits = {
  "placed": [
    {
      "id": "xiriya-main",
      "catalogueId": "pirates::Xiriya:normal:alive:",
      "variant": null,
      "x": 33.478, "y": -1.843, "z": 61.698,
      "rot": [0, -0.9609, 0],
      "scale": 1.37,
      "tint": { "Atlas": "#fefefe" },
      "materialPolicy": null,
      "locked": false,
      "collide": "auto",
      "boardable": "xiriya"
    },
    {
      "id": "boat-fishing-small-1",
      "catalogueId": "kenney-models::boat-fishing-small:normal:alive:",
      "variant": null,
      "x": 37.799, "y": -1.01, "z": 46.074,
      "rot": [0, 1.5616, 0],
      "scale": 0.75, "tint": null,
      "materialPolicy": null, "locked": false, "collide": "auto",
      "boardable": "fishing"
    },
    {
      "id": "boat-row-small-1",
      "catalogueId": "kenney-models::boat-row-small:normal:alive:",
      "variant": null,
      "x": 37.841, "y": -0.897, "z": 39.964,
      "rot": [0, 1.5665, 0],
      "scale": .75, "tint": null,
      "materialPolicy": null, "locked": false, "collide": "auto",
      "boardable": "rowboat"
    },
    {
      "id": "Dock-1",
      "catalogueId": "pirates:Environment:Dock:normal:alive:",
      "variant": null,
      "x": 31.629, "y": -0.515, "z": 34.267,
      "rot": [0, 0, 0], "scale": 1, "tint": null,
      "materialPolicy": null, "locked": false, "collide": "auto"
    },
    {
      "id": "Dock-2",
      "catalogueId": "pirates:Environment:Dock:normal:alive:",
      "variant": null,
      "x": 33.593, "y": -0.488, "z": 34.284,
      "rot": [0, 0, 0], "scale": 1, "tint": null,
      "materialPolicy": null, "locked": false, "collide": "auto"
    },
    {
      "id": "Dock_Broken-1",
      "catalogueId": "pirates:Environment:Dock_Broken:normal:alive:",
      "variant": null,
      "x": 35.589, "y": -0.489, "z": 34.303,
      "rot": [0, 0, 0], "scale": 1, "tint": null,
      "materialPolicy": null, "locked": false, "collide": "auto"
    },
    {
      "id": "Dock_Pole-1",
      "catalogueId": "pirates:Environment:Dock_Pole:normal:alive:",
      "variant": null,
      "x": 36.637, "y": -0.417, "z": 35.232,
      "rot": [0, 0, 0], "scale": 1, "tint": null,
      "materialPolicy": null, "locked": false, "collide": "auto"
    },
    {
      "id": "Dock_Pole-2",
      "catalogueId": "pirates:Environment:Dock_Pole:normal:alive:",
      "variant": null,
      "x": 36.683, "y": -0.417, "z": 33.342,
      "rot": [0, 0, 0], "scale": 1, "tint": null,
      "materialPolicy": null, "locked": false, "collide": "auto"
    },
  ],
  "familyOverrides": {},
  "scatterEdits": {}
};