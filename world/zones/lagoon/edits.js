// Lagoon — World Editor (Layer 4) data: hand-placed catalogue props living
// OUTSIDE bindings.js's scatter slots. See core/world-edits.js's header for
// the full schema. `mainShip` moved here this phase (was bindings.js's
// mainShip row + lagoon/catalogue-flora.js's dedicated placeMainShip()) —
// bindings.js is back to pure family->pack scatter slots only.
export const edits = {
  "placed": [
    {
      "id": "mainShip",
      "catalogueId": "pirates:Ship:Large:normal:alive:",
      "x": 52.204,
      "z": -65.764,
      "y": 1.103,
      "rot": [
        -0.9547,
        1.1726,
        0.6367
      ],
      "scale": 1,
      "tint": null,
      "materialPolicy": null,
      "locked": false,
      "collide": "auto"
    },
    {
      "id": "boat-row-small-2",
      "catalogueId": "kenney-models::boat-row-small:normal:alive:",
      "variant": null,
      "x": -40,
      "y": -0.085,
      "z": 34,
      "rot": [
        0,
        0,
        0
      ],
      "scale": .75,
      "tint": null,
      "materialPolicy": null,
      "locked": false,
      "collide": "auto",
      "boardable": "rowboat"
    }
  ],
  "familyOverrides": {},
  "scatterEdits": {}
};

