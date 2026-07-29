// Lagoon — World Editor (Layer 4) data: hand-placed catalogue props living
// OUTSIDE bindings.js's scatter slots. See core/world-edits.js's header for
// the full schema. `mainShip` moved here this phase (was bindings.js's
// mainShip row + lagoon/catalogue-flora.js's dedicated placeMainShip()) —
// bindings.js is back to pure family->pack scatter slots only.
export const edits = {
  placed: [
    {
      id: 'mainShip',
      catalogueId: 'pirates:Ship:Large:normal:alive:',
      variant: undefined,
      x: 25, z: -25,
      // NOT terrain-snapped (y stays an explicit number, not null): this
      // floats at the waterline (WATER_Y=0, -0.15 draft — the same
      // convention core/boats.js uses for every sailable boat spawn), not
      // the seafloor terrainHeight(25,-25) would resolve to (-6.15u down).
      y: -0.15,
      rot: [0.3, 0, 0.2], // world-editor Phase 0's proof vector — tune via the editor once Phase 2 lands
      scale: 1,
      tint: null,
      materialPolicy: null,
      locked: false,
      collide: 'auto', // data only — no collider is actually generated from this yet, see core/world-edits.js's header
    },
  ],
  familyOverrides: {},
  scatterEdits: {},
};
