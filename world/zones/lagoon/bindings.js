// Lagoon — Layer 2 binding table (RESOLVER-BINDING-SESSION). Same shape and
// role as grassland/bindings.js: { family, id, count?, scale?, rotation?,
// tint?, where? }. `family` doubles as catalogue-flora.js's own group-spec
// family key, same convention as grassland's table. Pure family->pack
// scatter slots only — every row here is placed by catalogue-flora.js's own
// placeBand loop (catalogueBands in terrain.js owns count/budget, so
// `count` stays unused on every row below). One-off hand-placed props (the
// former `mainShip` row) moved to edits.js's `placed[]` (World Editor
// session, Phase 1) — see core/world-edits.js for that schema.
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
// (Since re-pointed again, externally, to BIGNature::Plant — see the id
// below; that later call is Agni's own, not reverted here.)
export const bindings = {
  palmTree:  { family: 'PalmTree',    id: 'BIGNature::PalmTree:normal:alive:' },
  seaweed:   { family: 'Grass',       id: 'Simple_Nature::Grass:normal:alive:' },
  reefRock:  { family: 'Rock',        id: 'pirates:Environment:Rock:normal:alive:' },
  shoreBush: { family: 'Bush_Common', id: 'BIGNature::Plant:normal:alive:' },
};
