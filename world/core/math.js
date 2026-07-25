// World Shell — shared pure-math helpers. Only what's a GENUINE duplicate
// across zones lives here; see the "not deduped" note below for what was
// deliberately left alone and why.
//
// mulberry32: confirmed identical in both zones (same magic constant, same
// Math.imul mixing, same >>>0/4294967296 normalization) — grassland/assets.js
// called it `rng`, lagoon/lagoon-fx.js called it `mulberry32`; both now
// import this one copy.
export function mulberry32(seed = 1) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// clamp01/lerp: trivial one-liners, identical behavior (including on NaN)
// wherever they appeared — grassland/world.js, lagoon/terrain.js, AND
// lagoon/lagoon-fx.js all had their own copy (Lagoon duplicated it against
// itself, not just against Grassland).
export const clamp01 = v => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// NOT deduped, deliberately:
// - Lagoon's smoothstep/fbm/vnoise/raisedCos/hash2 (terrain.js) have no real
//   Grassland equivalent. Grassland's terrain math (world.js's rawHeight) is
//   a hand-tuned sine stack — a completely different technique, not
//   value-noise/fbm at all. Grassland's closest analog, `fall(d,inner,outer)`
//   (a flipped cubic smoothstep: `1 - smoothstep`), is a DIFFERENT shape than
//   Lagoon's raised-cosine dome (`raisedCos`) — zero-slope at both ends vs.
//   a plain cubic ease. Unifying these would mean picking one shape and
//   re-tuning both zones' terrain constants against it, which risks
//   Grassland's bit-identical terrainHeight requirement for no real payoff
//   (each zone's terrain reads correctly with its own shape today) — left as
//   parallel inventions, not merged.
