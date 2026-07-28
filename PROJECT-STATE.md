# PROJECT-STATE.md

(Initialized 2026-07-27 — this file didn't exist before; the sections below
reflect current reality as of this session, not a full project history.)

## Done
- Brief 9 — asset cataloguer + tagged manifest + catalogue-driven variant
  instancing (Grassland trees/rocks/bushes, Lagoon palms/seaweed/reef).
- Brief 10 — nature material normalization (metalness/roughness) + per-family
  scale correction (willows up, bushes down).
- Catalogue integrity (Track A) — see detail below.
- Gallery v3 (2026-07-28) — paginated catalogue gallery, restored as a full
  zone (`world/zones/gallery/`) on the **K** hotkey (`G` still opens
  Grassland's own procedural-factory overlay, untouched). Groups all 131
  served catalogue variants into 11 family rooms; `[`/`]` page between them,
  fully disposing the previous room's models each time (verified stable at
  ~197 geometries across 5 K in/out cycles + a full double pass through all
  11 rooms — no growth). Walk near a model, **M** cycles
  unmarked→keep→fix→cut (label recolors white/green/amber/red); a failed
  load auto-marks `loadfail` (red wireframe box) with the caught error
  string. **X** downloads one `gallery-marks.json` covering every served
  entry, visited or not, plus a best-effort clipboard copy. **R** toggles
  the per-family Brief-10 scale correction off for the current room (native
  1:1 scale) to compare against the shipping look. Marks persist to
  `localStorage` (`gallery-marks`) — the one sanctioned exception to
  CLAUDE.md's no-storage rule, confirmed with the user; see the hard-
  constraints section there. Verified end-to-end with a headless-Chromium
  Playwright driver (not just `node --check`): room paging, marking,
  raw-scale toggle, export schema, and a forced load-failure (aborted GLB
  request) all behave correctly, zero console errors.
  - One real bug caught during verification, fixed before shipping:
    `main.js`'s `handleCharacterChanged` (fires whenever the character's
    async GLB finishes loading, independent of zone) overwrites
    `hudText.innerHTML` with the generic per-zone HUD. If that lands after
    the gallery's own last HUD write, the custom room/totals HUD would stay
    clobbered indefinitely. Fixed entirely inside `zone.js` — HUD is
    re-rendered unconditionally every frame instead of on a dirty flag, so
    it always wins the last write. No changes needed elsewhere.
  - Grid spacing per room is measured from ONE representative variant's
    bounding box (rooms are single-family, so variants are similar-scale),
    not the true max across all variants — a deliberate, cheap tradeoff to
    avoid either guessing flat spacing or reflowing an already-visible grid.
  - No collision registered for gallery props (walk-through by design — a
    showroom, not a placement rehearsal).

## Known bugs / OPEN
- `world/zones/lagoon/catalogue-flora.js:99-102` — the `shoreBush` band is
  commented "Shore bushes — Simple_Nature bush, small vegetation" but the
  code requests `{ set: 'BIGNature', category: null, family: 'Rock' }`,
  i.e. it actually places BIGNature rocks, not Simple_Nature bushes. Reads
  like a copy/paste leftover from the reefRock band just above it. Not
  fixed this session — it's a recipe/content bug, not a pipeline-integrity
  one, and Track A was scoped to the catalogue/conversion/runtime pipeline
  only. Flagging for a follow-up session.

## Queue
1. Fix the `shoreBush` family mismatch above (small, isolated).
2. Lagoon reed/groundcover as its own catalogue flora entry — placement/
   design pass, not pipeline work. [surfaced this session as the next
   flora-content item once catalogue integrity was confirmed clean]

## Catalogue integrity — 2026-07-27 (Track A)
**Root cause: not present in the current repo.** Audited all 1903 catalogue
variants in `world/assets/catalogue.json` against disk (both `source` in
`3DResources/` and `served` in `world/assets/nature/`), and separately
walked every `.fbx` in every pack under `3DResources/` checking for a
converted `.glb`/`.gltf` sibling. Zero gaps, in either direction. The
"FBX→GLB batch silently dropped files, cataloguer wrote a `served` path
nothing backs" scenario this session was scoped around does not reproduce
against this repo's current state — every family in BIGNature (including
ones never added to the USED list — Grass, Plant, Cactus, Corn, Wheat,
Flowers, Lilypad, TreeStump, WoodLog) already has a complete, matching
`.glb` for every `.fbx`. Full detail in `catalogue-audit.txt` at repo root.

The failure mode is real in *shape* even though it isn't currently
triggered — nothing previously verified disk state at any of the three
layers (conversion, cataloguer, runtime), so a future asset drop could
reintroduce it silently. Hardened all three anyway:

1. **`tools/convert-fbx.mjs`** (new) — per-file, exit-code-checked FBX→GLB
   conversion via the FBX2glTF binary (talks to it directly; the `fbx2gltf`
   npm package has no runnable `bin` entry and isn't a repo dependency).
   Appends PASS/FAIL + reason to `tools/conversion-manifest.txt`; exits
   non-zero if anything failed. No reusable/auditable conversion script
   existed before this session — the original pass was an ad hoc terminal
   loop, which is *why* a batch failure could scroll past unnoticed in the
   first place. Tested against a real FBX (pass) and a corrupt one (fail,
   manifest recorded, non-zero exit) — both paths verified working.
2. **`tools/catalogue-assets.mjs`** — now checks the source file exists
   before `copyFileSync`; a missing source is skipped (no phantom `served`
   entry gets written), reported in a loud end-of-run summary, and sets a
   non-zero exit code. Previously an unexpectedly-missing source would have
   thrown mid-copy and aborted the whole run without writing the catalogue
   at all — not silent, but also not informative about *what* was missing
   or safe to re-run partially.
3. **`world/core/asset-diagnostics.js`** (new) — shared
   `reportMissingAsset(path, context)`: `console.error`s the exact path +
   which recipe/family referenced it, and shows an on-screen
   "missing assets: N" badge (bottom-right, only appears once something is
   actually missing). Wired into both `zones/grassland/catalogue-flora.js`
   and `zones/lagoon/catalogue-flora.js`: a `GLTFLoader` failure for one
   group is now caught **per iteration** instead of propagating as an
   uncaught rejection through the shared `await` loop — previously, one bad
   file would have silently dropped every group placed *after* it in the
   same pass (trees/rocks/bushes, or palms/seaweed/rocks/bushes,
   depending on iteration order), which is exactly the "most grass/bush
   models don't work" shape described in the session brief. No hard throw:
   one missing model no longer blanks the whole zone build.

**Verified** (all agent-checkable, no eyeballing needed):
- Cataloguer re-run is byte-identical except `generatedAt` — 28 used
  entries, 131 served variants, 0 skipped.
- All 131 served URLs return HTTP 200 against the running dev server
  (`localhost:8000`) — checked via direct fetch, not just filesystem
  existence.
- `node --check` clean on every edited/new module.

Not verified (needs a human): actually opening Grassland + Lagoon in a
browser and confirming grass/shrubbery reads as expected visually — no
regression in what's already there, since nothing in the currently-served
131 files changed.
