# Handoff note — temporary real-model swap-ins over Lagoon's procedural flora

Not part of Brief 6 or its addendum. The user asked, out of band, for a quick
low-friction wire-in of some real 3D models (dropped under a top-level
`finalised/` folder) over specific procedural flora placeholders in Lagoon,
explicitly as a **temporary, throwaway placement** — not the real
asset-placement system, which is planned as separate future work. Read this
before touching flora/scatter placement in Lagoon, or before building that
real system, so the temporary bits don't get mistaken for permanent design.

## Current status

**Palms — ACTIVE.** `temp-real-palms.js` swaps the 3 real palm models
(`world/assets/temp-models/Environment_PalmTree_{1,2,3}.gltf`) over the
procedural `palm` scatter kind (see `terrain.js`'s `scatterRecipe`). Verified
working repeatedly, including the user's own real Firefox session.

**Seaweed/kelp — REVERTED, not active.** The same pattern was applied to
Lagoon's `kelp` scatter kind (the tall fronds — the real target for "seaweed",
not `seagrass`) using the 3 grass models (`Grass{1,2,3}.fbx`), with
non-uniform scaling (elongate height, thin width/depth) since the source
models are natively short round tufts, not thin fronds. **This was reverted
at the user's request after they reported the swap wasn't visible in their
own browser.** Notably: I could not reproduce the failure. I re-ran the
user's exact reported flow — load bare `http://localhost:8000/world/` (no
`?zone=lagoon`, defaulting to Grassland), then cross into Lagoon via the
in-game portal (not a debug zone-load) — in both Chromium and real Firefox
via Playwright automation, 4 separate attempts total, and every one showed
the swap working correctly (real model clones present, procedural mesh
hidden, zero console errors, screenshots confirming the visual). The user
also confirmed no console errors and no failed/404 network requests on their
end. The actual root cause was never identified.

**If you pick this back up:** the swap-in *pattern* itself (read the
positions/rotations/scales already baked into the procedural kind's
`InstancedMesh` via `getMatrixAt`, hide that mesh, clone+place real models at
each transform) worked reliably in every automated test — it's a reasonable
template to reuse. But given there's a real, unresolved discrepancy between
automated-browser testing and at least one live user session, don't fully
trust "works in my testing" alone if you re-attempt this — get eyes on the
user's actual live session (screen share / their own devtools open while you
watch) rather than iterating blind again.

## Files

- `temp-real-palms.js` — active, self-contained, safe to delete independently.
- `temp-real-seaweed.js` — deleted. Same structure as the palms version if
  reconstructing it (see git history / this note for the design: non-uniform
  `clone.scale.set(scaleXZ, scaleY, scaleXZ)`, `TARGET_WIDTH` constant
  independent of height).
- `world/assets/temp-models/` — copied from the top-level `finalised/`
  folder (kept inside `world/` so paths never reach outside the served app,
  same convention as `watercraft-pack`). Currently holds only the 3 palm
  GLTFs; the grass FBX models were removed when seaweed was reverted. The
  originals are untouched at repo-root `finalised/Grass{1,2,3}.fbx` if
  needed again.

## To fully revert the palms too

Delete `temp-real-palms.js`, remove its one `import` and one
`swapInRealPalms(...)` call in `zone.js` (both marked `// TEMP`), and the
procedural placeholder palms come back automatically (the swap only ever
hides that InstancedMesh, never removes or alters it).
