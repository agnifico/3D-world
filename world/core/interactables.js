// World Shell — shared interaction resolver. Any candidate interaction
// (portal crossing, boat boarding, disembarking, and future ones — dive,
// debris, gather...) registers itself here; each frame the resolver picks
// ONE winner by numeric priority (ties broken by nearest distance). Adding a
// new interaction is always a one-object registration — this module never
// grows new cases or pairwise special-casing (e.g. "portal beats disembark"
// is just two numbers, not an if-chain).
//
// Each candidate: {
//   id,                          // stable string, for debugging/dedup
//   priority,                    // number — higher wins; ties -> nearest distanceTo
//   inRange(character) -> bool,
//   distanceTo(character) -> number,
//   label() -> string,           // drives the on-screen prompt for the winner
//   key,                         // KeyboardEvent.code this candidate fires on
//                                // (e.g. 'KeyE') — per-candidate, not global,
//                                // so a future G-vs-E split needs no resolver change
//   onActivate(),
//   persistent,                  // optional — survives reset() (see below)
// }
//
// A single shell-wide list (there's only ever one "what's nearby" concept).
// reset() is called by the shell right before building a new zone, so a
// disposed zone's interactables (portals, boats — backed by freed objects)
// never linger into the next one. Character-level interactions that persist
// across zone crossings (disembark) register with `persistent: true` so
// reset() leaves them alone instead of needing to re-register every swap.
let items = [];

export function register(item) {
  items.push(item);
  return () => { const i = items.indexOf(item); if (i !== -1) items.splice(i, 1); };
}
export function reset() { items = items.filter((it) => it.persistent); }
export function all() { return items; }

// Resolves the single winning candidate for `character` this frame, or null
// if nothing is in range. Highest priority wins; ties go to whichever is
// nearest.
export function resolve(character) {
  let best = null, bestPriority = -Infinity, bestDist = Infinity;
  for (const it of items) {
    if (!it.inRange(character)) continue;
    const p = it.priority ?? 0;
    const d = it.distanceTo(character);
    if (p > bestPriority || (p === bestPriority && d < bestDist)) {
      best = it; bestPriority = p; bestDist = d;
    }
  }
  return best;
}
