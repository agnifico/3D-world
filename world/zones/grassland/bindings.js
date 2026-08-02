// Grassland — Layer 2 binding table (RESOLVER-BINDING-SESSION). One row per
// placement slot; `id` is the catalogue id (core/catalogue.js's
// resolveAsset/parseCatalogueId) that slot currently resolves to — repoint
// here to swap a family's source pack without touching scatter/placement
// code in catalogue-flora.js. Same row shape as every other zone's
// bindings.js: { family, id, count?, scale?, rotation?, tint?, where? }.
//
// `family` here doubles as BOTH the slot name and catalogue-flora.js's own
// internal group-spec family key (VARIANT_COUNT, FAMILY_SCALE, and the
// Rock/Bush collision-type branch in instantiateCatalogueFlora all key off
// it) — grassland's existing families (CommonTree, PineTree, ...) already
// read as perfectly good slot names, so this session didn't invent prettier
// aliases for them; renaming later is a mechanical find/replace, not a
// structural change.
//
// Every row below resolves to the SAME BIGNature entries the old hardcoded
// `{set:'BIGNature', category:null, family:X}` literals pointed at — this
// migration is a no-op for what's actually rendered; only the pipeline
// (data-driven vs. hardcoded) changed. Season/state/moss selection stays
// dynamic in catalogue-flora.js's own placement logic (season patches, dead-
// tree chance, moss chance) — the binding only decides WHICH pack+family a
// slot draws from, not which season/state variant of it.
export const bindings = {
  CommonTree:  { family: 'CommonTree',  id: 'BIGNature::CommonTree:normal:alive:' },
  PineTree:    { family: 'PineTree',    id: 'BIGNature::PineTree:normal:alive:' },
  BirchTree:   { family: 'BirchTree',   id: 'BIGNature::BirchTree:normal:alive:' },
  Willow:      { family: 'Willow',      id: 'BIGNature::Willow:normal:alive:' },
  Rock:        { family: 'Rock',        id: 'BIGNature::Rock:normal:alive:' },
  Bush:        { family: 'Bush',        id: 'BIGNature::Bush:normal:alive:' },
  BushBerries: { family: 'BushBerries', id: 'BIGNature::BushBerries:normal:alive:' },
};
