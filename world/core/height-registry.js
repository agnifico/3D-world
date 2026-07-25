// World Shell — shared height-contributor registry. Zones register their
// terrain/prop/boat height functions here (via ctx.heightRegistry, passed
// into build()) instead of owning a private module-level singleton the way
// grassland/world.js used to. The shell calls reset() immediately before
// building a new zone, so a disposed zone's contributors can never leak into
// the next one — that's what makes dispose() verifiably clean instead of
// hoping nothing was missed. Pure logic, no THREE import.
export function createHeightRegistry() {
  let contributors = []; // { fn, label }

  function register(fn, label) {
    const rec = { fn, label: label || fn.name || 'unknown' };
    contributors.push(rec);
    return () => { const i = contributors.indexOf(rec); if (i !== -1) contributors.splice(i, 1); };
  }

  function groundHeight(x, z) {
    let h = -Infinity;
    for (const c of contributors) { const v = c.fn(x, z); if (v > h) h = v; }
    return h;
  }

  // Same max-over-contributors computation as groundHeight, but also reports
  // which one won (debug HUDs), and — when feetY/stepUp are both given —
  // ignores any contributor more than stepUp above feetY, so e.g. a swimmer
  // passing under a bridge deck doesn't get yanked onto it just because the
  // deck is the tallest thing at that (x,z). Falls back to the unfiltered
  // max if every contributor gets filtered out (an out-of-band feetY, e.g.
  // right after a teleport/zone-spawn, would otherwise resolve to -Infinity
  // forever).
  function resolveSupport(x, z, feetY, stepUp) {
    let h = -Infinity, contributor = null;
    for (const c of contributors) {
      const v = c.fn(x, z);
      if (feetY !== undefined && stepUp !== undefined && v > feetY + stepUp) continue;
      if (v > h) { h = v; contributor = c.label; }
    }
    if (h === -Infinity && feetY !== undefined && stepUp !== undefined) return resolveSupport(x, z);
    return { height: h, contributor };
  }

  function reset() { contributors = []; }

  return { register, groundHeight, resolveSupport, reset };
}
