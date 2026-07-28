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
//
// Canonical catalogue ID shape (RESOLVER-BINDING-SESSION, Layer 1): every
// entry.id is `${set}:${category||''}:${family}:${season}:${state}:${extra}`
// — six ':'-joined fields (tools/catalogue-assets.mjs builds it as
// [set, category||'', family, season, state, extraTags.sort().join('+')]
// joined on '|', then '|' -> ':'). category/extra read as '' when the entry
// has none (e.g. "NNK Style::CommonTree:normal:alive:" — the empty category
// is the doubled '::'). parseCatalogueId below decodes this WITHOUT the
// (async) manifest — the id string alone carries set/category/family, which
// is what lets a zone's SYNC placement pass (must run before the manifest
// fetch can possibly resolve — see grassland/catalogue-flora.js's header)
// read a binding's pack synchronously.
import { getPackPolicy } from './asset-policy.js';

const WORLD_BASE = new URL('../', import.meta.url);

let _manifestPromise = null;
export function loadCatalogue() {
  if (!_manifestPromise) {
    _manifestPromise = fetch(new URL('assets/catalogue.json', WORLD_BASE)).then(r => r.json());
  }
  return _manifestPromise;
}

// entries whose (set, family[, category]) match, optionally narrowed by
// season/state. Used to require e.used===true (findEntries only ever
// returned served entries) — relaxed for RESOLVER-BINDING-SESSION: a zone's
// binding table can now point a family slot at a shelf-only pack (e.g.
// lagoon's shoreBush -> NNK Style), and both of this function's callers
// (grassland/lagoon catalogue-flora.js) already resolve each returned
// entry's variant served-or-shelf themselves (see their servedURL/sourceURL
// fallback) — checked at time of this change, these are its only two
// callers in the codebase, so relaxing the filter here doesn't surprise
// anything else.
export function findEntries(manifest, { set, family, category, season, state } = {}) {
  return manifest.entries.filter(e => {
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

// Resolves a catalogue variant's `source` path (repo-root-relative, e.g.
// "3DResources/BIGNature/Cactus_1.glb" — the untouched shelf file, never
// copied into world/assets/) to an absolute fetchable URL. One level further
// up than servedURL since source paths are rooted at the repo, not at
// world/, and the dev server roots at the repo — this is the gallery's
// shelf-browsing path (Gallery v4), every other consumer only ever wants
// servedURL/findEntries' used-only results.
export function sourceURL(source) { return new URL('../' + source, WORLD_BASE).href; }

// Pure string decode of a catalogue id — see the file header for the shape.
// No manifest lookup, no fetch: this is what lets a slot's bound id be read
// synchronously (set/category/family) before the catalogue.json fetch could
// possibly have resolved.
export function parseCatalogueId(id) {
  const [set, category, family, season, state, extra] = id.split(':');
  return { set, category: category || null, family, season, state, extra: extra || '' };
}

// Resolves ONE catalogue entry (by its `id`) to a load descriptor — served
// path if it's in the used/served set, else its shelf `source` path (the
// same served-or-shelf logic proved out by the NNK smoke test), PLUS the
// pack's Layer 3 policy (material treatment + scale factor, core/asset-
// policy.js) so callers don't separately import and look that up. This is
// the binding-table resolver: a zone's bindings.js maps a slot to a
// catalogue id; this turns that id into everything core/gltf-assets.js's
// loader and a placement matrix need. `variant` defaults to the entry's
// first (many shelf entries carry a single variant numbered `null`, not `1`).
export function resolveAsset(manifest, catalogueId, variant) {
  const entry = manifest.entries.find(e => e.id === catalogueId);
  if (!entry) return null;
  const v = (variant !== undefined ? entry.variants.find(x => x.variant === variant) : null) || entry.variants[0];
  if (!v) return null;
  const url = v.served ? servedURL(v.served) : sourceURL(v.source);
  return { url, pack: entry.set, entry, policy: getPackPolicy(entry.set) };
}

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
