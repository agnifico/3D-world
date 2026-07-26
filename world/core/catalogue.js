// World Shell — reads world/assets/catalogue.json (written by
// tools/catalogue-assets.mjs) and exposes lookup by family/tag. Only
// entries with `used: true` carry a `served` path per variant (the ones
// actually copied into world/assets/nature/) — everything else on the
// manifest is shelf-only metadata for future work, never fetchable at
// runtime, so query helpers here only ever return served variants.
// `served` paths in catalogue.json (e.g. "assets/nature/BIGNature/
// CommonTree_1.glb") are written relative to world/ — the same convention
// temp-real-palms.js used for "assets/temp-models/..." — so the base here is
// world/ itself (core/catalogue.js lives at world/core/), NOT world/assets/.
const WORLD_BASE = new URL('../', import.meta.url);

let _manifestPromise = null;
export function loadCatalogue() {
  if (!_manifestPromise) {
    _manifestPromise = fetch(new URL('assets/catalogue.json', WORLD_BASE)).then(r => r.json());
  }
  return _manifestPromise;
}

// entries whose (set, family[, category]) match, optionally narrowed by
// season/state, and that actually have served (copied) variants.
export function findEntries(manifest, { set, family, category, season, state } = {}) {
  return manifest.entries.filter(e => {
    if (!e.used) return false;
    if (set !== undefined && e.set !== set) return false;
    if (family !== undefined && e.family !== family) return false;
    if (category !== undefined && e.category !== category) return false;
    if (season !== undefined && e.season !== season) return false;
    if (state !== undefined && e.state !== state) return false;
    return true;
  });
}

// Resolves a catalogue entry's `served` path to an absolute fetchable URL.
export function servedURL(served) { return new URL(served, WORLD_BASE).href; }

// Flattened {variant, url} list across one or more entries.
export function variantURLs(entries) {
  const out = [];
  for (const e of entries) for (const v of e.variants) {
    if (!v.served) continue;
    out.push({ url: servedURL(v.served), variant: v.variant, entry: e });
  }
  return out;
}

// Deterministic weighted pick — `rng()` a caller-seeded 0..1 generator (this
// codebase's mulberry32), `weights` parallel to `items` (defaults uniform).
export function weightedPick(items, rng, weights) {
  if (!items.length) return null;
  if (!weights) return items[(rng() * items.length) | 0];
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}
