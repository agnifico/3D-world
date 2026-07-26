# Retired — temporary real-model swap-ins over Lagoon's procedural flora

Both swap-ins this note used to track are now retired. This file stays as a
pointer + a flagged risk for whoever next touches Lagoon's seaweed.

## What replaced them

Brief 9 built the real, permanent asset-placement system: a tagged catalogue
(`world/assets/catalogue.json`, built by `tools/catalogue-assets.mjs`) and
`zones/lagoon/catalogue-flora.js`, which places real Pirates palms and
Simple_Nature grass-as-seaweed (plus reef rocks and shore bushes) as properly
INSTANCED `InstancedMesh` content — one draw call per distinct geometry part,
not one clone per placed instance the way the old swap-ins worked.

- `temp-real-palms.js` — **deleted**. Its one `import` + call in `zone.js`
  are gone too; `terrain.js`'s procedural `palm` scatterRecipe kind (what it
  swapped over) is also removed — see `catalogueBands.palm` there instead.
- `temp-real-seaweed.js` — was already deleted before this (see the old
  handoff note below); the procedural `kelp` scatterRecipe kind it would have
  swapped over is now also removed — see `catalogueBands.seaweed`.
- `world/assets/temp-models/` — no longer referenced; safe to delete.

## Unresolved risk worth carrying forward

The original seaweed swap-in (`temp-real-seaweed.js`) was built, verified
working in 4/4 automated Chromium+Firefox tests reproducing the user's exact
reported flow (bare `/world/` → in-game portal → Lagoon), but the user
reported it wasn't visible in their own real Firefox session — no console
errors, no failed network requests on their end either. **The root cause was
never identified**, and it was reverted rather than debugged blind.

The new seaweed (Simple_Nature grass, catalogue-driven) is a different code
path — real GLTFLoader + InstancedMesh via `core/gltf-assets.js`/
`core/instancing.js`, not a clone-per-instance swap over a hidden procedural
mesh — so the old bug may not apply. But it's the same underlying asset
category (grass models stretched into fronds) that had the unexplained
discrepancy before. If a user reports Lagoon's seaweed isn't rendering for
them despite a clean console: don't assume "works in my testing" is
sufficient — get eyes on their actual live session before spending long
debugging blind, per the history above.
