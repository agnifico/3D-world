// Highland — Layer 2 binding table (RESOLVER-BINDING-SESSION). Same row
// shape as grassland/lagoon's bindings.js: { family, id, count?, scale?,
// rotation?, tint?, where? }, kept here for structural uniformity across all
// three zones even though highland has no catalogue-driven flora yet.
//
// terrain.js's own scatterRecipe is explicitly `held: true` — a procedural
// rock/scrub/pine intent, not wired to real GLBs (see its own comment:
// "highland-fx.js reads nothing from it until held flips false"). This
// session's blast radius only asked for the ship + one NNK binding
// "wherever's fastest" — both landed in Lagoon — so unholding highland's own
// content is a separate, later decision, not made here. Empty until then;
// the resolver (core/catalogue.js) and policy (core/asset-policy.js) layers
// underneath are already fully ready for whatever rows land here.
export const bindings = {};
