# PROJECT-STATE.md

(Initialized 2026-07-27 — this file didn't exist before; the sections below
reflect current reality as of this session, not a full project history.)

## Done
- COLLISION-PAINTER-SESSION (2026-07-31) — Editor v2 phase 1: a "Collision"
  tab in the backtick World Editor to SEE (translucent shape overlays),
  EDIT (same T/R/Y gizmo, model-local coordinate space), ADD/DELETE, and
  EXPORT (per-model `collider-catalogue.js` or per-instance `edits.js`)
  colliders visually instead of authoring them blind. Fixes the grassland
  dock's floating-deck bug as its own built-in proof. See detail below.
- COLLISION-FOUNDATION-SESSION (2026-07-31) — `collide` on a `placed[]` row
  goes from inert schema to real colliders: `core/colliders.js` (the
  box/sphere/capsule/cone/deck primitive registrar, static-bake vs
  dynamic-live) + `core/collider-catalogue.js` (per-catalogueId spec table)
  + `core/world-edits.js`'s `applyEdits` wiring. Proved on the grassland
  dock (Dock/Dock_Broken/Dock_Pole) — see detail below.
- Brief 9 — asset cataloguer + tagged manifest + catalogue-driven variant
  instancing (Grassland trees/rocks/bushes, Lagoon palms/seaweed/reef).
- Brief 10 — nature material normalization (metalness/roughness) + per-family
  scale correction (willows up, bushes down).
- Catalogue integrity (Track A) — see detail below.
- Terrain-from-map — Lagoon retrofit (2026-07-29) — see detail below.
- RESOLVER-BINDING-SESSION (2026-07-28/29) — asset resolver + per-zone
  binding tables + per-pack material/scale policy — see detail below.
- World Editor, Phases 0-5 (2026-07-29) — Layer-4 finetune tool: 3-axis
  rotation, edits.js data layer, edit mode + gizmo, object inspector,
  scatter reach, HUD + `WORLD-EDITOR-GUIDE.md` — see detail below. Built
  entirely from a compressed order-of-operations in the session prompt
  (`WORLD-EDITOR-BRIEF.md` doesn't exist in the repo); not eyeballed in a
  browser this session — see the Phase 5 entry's closing note for the
  concrete first thing to check next.
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
- Grassland dock collider (`world/core/collider-catalogue.js`'s three Dock
  entries) is REASONED, not eyeballed: the footprint/height numbers come
  from real measured GLB bounds (a one-off Node script parsing each .glb's
  accessor min/max directly, no browser needed), but WHERE inside that
  measured envelope the walkable plank surface actually sits is a
  first-pass estimate (deck at local y=1.0 of a ~3.0-tall model) — this was
  this session's OWN motivating bug report ("the dock's walkable surface
  floats above the planks"). Now fixable BY EYE instead of by more guessing:
  select the dock in the World Editor (backtick), press **X** for the
  Collision tab, drag the green deck box down onto the visible planks,
  Export, paste over `collider-catalogue.js`. See this session's own
  write-up below.
- Lagoon `shoreBush` scale (`world/zones/lagoon/catalogue-flora.js`'s
  shoreBush loop) is UNVERIFIED in-browser: re-tuned this session against
  NNK Bush_Common's measured native bbox (the old 2-2.6 range was tuned for
  a completely different model and would read 3-4u tall). Eyeball and
  adjust the jitter range or `bindings.js`'s optional `scale` override if
  it reads wrong.
- Lagoon `mainShip`'s placement (25,-25) and rotation (0.4 rad) are a
  reasonable numeric guess (open water, clear of every islet/sandbar/
  portal — checked against terrain.js's own terrainHeight/depthAt) but
  UNVERIFIED in-browser. Nudge `bindings.js`'s `where`/`rotation` if it
  reads wrong.

## Queue
1. Eyeball-verify the two RESOLVER-BINDING-SESSION proof bindings above
   (shoreBush scale, mainShip placement) and adjust in `bindings.js` if
   needed — no code change either way, just constants.
2. Lagoon reed/groundcover as its own catalogue flora entry — placement/
   design pass, not pipeline work. [surfaced pre-RESOLVER-BINDING-SESSION as
   the next flora-content item once catalogue integrity was confirmed clean]
3. Promote script (`npm run promote`, shelf -> served) and the area
   designer — both explicitly deferred out of RESOLVER-BINDING-SESSION's
   scope; the area designer needs the binding tables below to exist first,
   which they now do.
4. Consider whether `pirates` pack policy (`world/core/asset-policy.js`)
   should flip from 'flat-matte' to 'authored' — direct GLB inspection this
   session found it carries a real texture atlas (same class as NNK), but it
   was kept flat-matte to avoid changing the already-served PalmTree/Rock
   look without Agni eyeballing first. One-line edit either way.
5. The in-engine PAINTER tool (terrain layer of the Track C world editor;
   live 3D preview is its killer feature) — explicitly out of scope for the
   terrain-from-map session, next tooling session's target.
6. Same-map scatter masks (seaweed in WADE, corals in REEF, driven off
   `bandAt()` instead of raw depth) — v2, explicitly deferred; huge win once
   the gallery-driven recipe pass lands. `catalogueBands`/`scatterRecipe`'s
   depth ranges in `terrain.js` were left untouched against the new
   map-driven terrain (not a coverage/density audit this session — they'll
   just naturally re-distribute against the new heightfield).
7. Ship hookup (COLLISION-FOUNDATION-SESSION's own explicit follow-up, not a
   blocker): once the Jackdaw/mainShip is a composite of named parts (the
   parallel Design brief), author a `static: false` collider spec for it —
   a `deck` box over the walkable surface, `box` blockers along the rails, a
   step/wedge for stairs — wired from wherever the boat's live transform
   lives (`core/boats.js`), replacing the current `deckOffset`/`deckInset`
   single-rectangle approximation. `core/colliders.js` already supports
   `static: false`; nothing consumes it yet.
8. Extend `world/core/collider-catalogue.js` to more placed catalogue
   models as they come up (buildings, other dock pieces) — the seam is
   ready, each new entry is a data-only addition, no code change.
9. ~~The in-editor collision PAINTER UI~~ — done, COLLISION-PAINTER-SESSION
   (2026-07-31), see below.
10. Editor v2 later phases (COLLISION-PAINTER-SESSION's own explicit
    out-of-scope list, logged not built): batch collider ops across many
    models at once, a collider shape "preset library" (common shapes
    ready to drop in), the parametric bell/taper/skew primitive shaping,
    a standalone (out-of-game) version of the editor.
11. Collision tab family-target edits only live-update the ONE object being
    edited — a sibling placement of the same model already in the scene
    keeps its old collider until it's individually reopened in the tab or
    the zone reloads (see WORLD-EDITOR-GUIDE.md's Known gaps). Worth a
    "reregister every live sibling too" pass if this friction shows up in
    practice; skipped this session since Export+reload already fully
    resolves it and touching every sibling live adds real complexity for a
    workflow (batch multi-instance retuning) nobody's hit yet.

## RESOLVER-BINDING-SESSION — 2026-07-28/29 (asset reference layer)
Built the promised "use any of my 1,903 models by name, anywhere, without
touching code" as three layers:

1. **Layer 1 — resolver** (`world/core/catalogue.js`): `resolveAsset(manifest,
   catalogueId, variant?)` returns `{ url, pack, entry, policy }` — served
   path if the entry is `used`, else its shelf `source` path (same
   served-or-shelf logic the NNK smoke test proved out), plus the pack's
   Layer 3 policy. `parseCatalogueId(id)` is a new pure string decode (no
   manifest needed) of the documented canonical id shape
   `${set}:${category||''}:${family}:${season}:${state}:${extra}` — this is
   what lets a zone's SYNC placement pass read a binding's pack before the
   (async) catalogue.json fetch could possibly resolve. `findEntries` no
   longer hard-filters to `used===true` (checked: its only two callers,
   grassland/lagoon catalogue-flora.js, both now resolve served-or-shelf
   themselves) — this is what makes shelf-only bindings (NNK, the pirates
   ship) actually work through the existing scatter/placement pipeline
   instead of silently reporting "no catalogue entry". `resolveAssetUrl`
   (the smoke test's narrower helper) is retired; `resolveAsset` supersedes
   it.
2. **Layer 2 — per-zone binding tables**: `world/zones/{grassland,lagoon,
   highland}/bindings.js`, same row shape everywhere — `{ family, id,
   count?, scale?, rotation?, tint?, where? }`. Grassland/lagoon's existing
   hardcoded `{set:'BIGNature',...}` literals in catalogue-flora.js's
   placement loops now read `PACK[family]` (parsed once from the binding's
   id) instead — a repoint is a one-line edit to bindings.js, no other code
   changes. Highland's is intentionally empty (structural only): its own
   terrain.js scatterRecipe is still `held: true`, unrelated to and not
   unpaused by this session.
   - **shoreBush fix** (`lagoon/bindings.js`): was `{set:'Simple_Nature',
     family:'Grass'}` (comment said bush, code placed grass), then — found
     already mid-edit, uncommitted, in the working tree at session start —
     `{set:'NNK Style', family:'Bush'}` (closer, but 'Bush' isn't a real NNK
     family, so it silently resolved to nothing). Fixed to the real family,
     `NNK Style::Bush_Common:normal:alive:` — this is also this session's
     "bind one NNK family into a zone" proof, landed as a real scatter
     species rather than a one-off static prop.
   - **mainShip** (`lagoon/bindings.js`, new): `pirates:Ship:Large:normal:
     alive:` — a single hand-placed prop (not a scatter species), placed at
     (25,-25) in open water via a new `placeMainShip()` in lagoon/catalogue-
     flora.js. This is the session's main proof: a shelf-only, never-before-
     served model reachable purely by editing a data file.
3. **Layer 3 — per-pack policy** (`world/core/asset-policy.js`, new):
   `{ material: 'authored'|'flat-matte', scaleFactor }` per pack, default
   (absent) = pass-through authored/1x. This REPLACES the unconditional
   flatShading/metalness/roughness override that used to apply to every
   loaded model in `core/gltf-assets.js` regardless of pack — confirmed via
   direct GLB inspection this session that BIGNature/Simple_Nature carry
   solid untextured materials (the override's actual intended target, kept
   flat-matte) while NNK/pirates/ghibli_nature carry a real baseColorTexture
   atlas the override was never validated against (NNK authored per the
   smoke test's own finding; pirates deliberately kept flat-matte anyway —
   see Queue item 4 — to avoid changing the already-served palm/rock look
   without a human eyeballing it first). `gltf-assets.js`'s
   `loadTintedTemplate`/`loadRaw` now take a `policy` param (default
   pass-through, not the old hardcoded override) — every caller updated:
   both catalogue-flora.js files, gallery/zone.js's two call sites (keyed
   off each room's pack, so Gallery v4's shelf walk gets correct-per-pack
   treatment too, not just the two placement zones).

**Verified** (agent-checkable, no browser needed): every binding id parses
to the exact real catalogue.json entry (set/category/family match
exactly); `resolveAsset` produces correct served-vs-shelf URLs for a served
entry (BIGNature CommonTree), a shelf .glb (pirates Ship_Large), and a
shelf .gltf+.bin+texture (NNK Bush_Common) — all three files confirmed to
exist on disk at the exact resolved paths, including the NNK gltf's
separately-referenced .bin and .png. `node --check` clean on every new/
edited file. grassland's migration is a confirmed no-op (every BIGNature
policy scaleFactor is 1, so the new `PACK[family].policy.scaleFactor`
multiplier changes nothing already shipping).

**Not verified** (needs Agni, eyeball-only per the session brief — this is
deterministic plumbing, failure is a visible 404 or an obviously-wrong
scale, nothing subtle): the ship actually appearing in Lagoon at a sane
size with its texture visible; shoreBush's re-tuned scale reading right;
whether pirates' flat-matte call (Queue item 4) is the one Agni wants.

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

## Terrain-from-map — 2026-07-29 (Lagoon retrofit)
Built `world/core/terrain-from-map.js` (new, zone-agnostic, zero imports):
loads a hand-painted band-map PNG via offscreen canvas, classifies every
pixel to its nearest legend color (RGB distance, tolerance 60px-equivalent;
unclassified label/anti-aliasing pixels inherit their nearest classified
neighbor via a multi-source BFS flood-fill — same result as a per-pixel
outward spiral search, O(N) instead of O(N * radius)), sliding-window
box-blurs the resulting band-height grid (O(1)/pixel regardless of radius —
~35x faster than a naive fixed-tap repeat at an equivalent soft-edge width),
adds per-band low-frequency noise on top (selected by each cell's
*pre-blur* band, so e.g. WADE/SHALLOW can stay flat while LAND/REEF/DEEP
get texture), and returns `{ terrainHeight(x,z), bandAt(x,z) }` sampled
bilinearly from the precomputed grid. Browser-only (image decode is
inherently async) — no three import, but no Node-testability claim either;
that's a real, deliberate trade against the old procedural terrain.js's
"stays testable in Node" discipline, made because the session's own spec
called for reading the map via canvas.

Retrofitted `world/zones/lagoon/terrain.js` onto it from `lunalaguna.png`
(now `zones/lagoon/map.png`, already in place at session start), deleting
the old procedural fbm/islet/shelf/reef-ring math entirely rather than
dual-pathing it (recoverable from git history, per the session brief).
`WATER_Y` and the `terrainHeight`/`depthAt`/`terrainNormal` export
signatures are unchanged, so the zone contract, height registry, collision,
and water fx all keep working untouched. Loaded via a top-level `await`
inside terrain.js (plain ESM feature, no bundler involved — already safe
given this project's importmap-based module setup): every consumer still
sees a plain synchronous `terrainHeight` by the time it's actually called,
at the cost of the whole app's module graph waiting on one image load at
boot (measured 637ms in headless Chromium for
fetch+decode+classify+BFS+blur+noise over the 1000x1000 map — a one-time
hit, since `main.js` statically imports all three zones up front; not a
per-frame cost, and sampling itself is now a single bilinear lookup,
cheaper than the old live fbm stack).

Band heights are DERIVED from `character/controller.js`'s real footing
constants (`WADE_START=0.45`, `SWIM_DEPTH=1.2`), not guessed:
`LAND +0.8 | SHALLOW -0.22 | WADE -0.82 | REEF -2.6 | DEEP -16.0`. REEF/DEEP
have no controller threshold of their own (both already read "swim" once
depth passes `SWIM_DEPTH`) — they reuse the old procedural design's own
`SHELF_Y` (-2.6) and `DEEP_FLOOR_Y` (-16.0) as the closest existing
precedent for where this game already drew that line. Orientation
convention (documented in `terrain-from-map.js`'s header, "one convention,
forever"): image row 0/top = world north = -Z; image column 0/left = world
west = -X. Blur tuned to `blurRadius:4, blurPasses:3` specifically so the
resulting ~2.5-world-unit transition band stays narrower than the smallest
painted landmark's footprint (the "one single big rock" islet, ~3-unit
radius) — a wider/softer blur read fine everywhere else but started
washing that islet flat.

Spawn points MOVED: `SHORE_XZ`/`BOAT_XZ` were tuned to the old procedural
islets and both landed in open DEEP water under the real lunalaguna map
(confirmed via `terrainHeight`/`bandAt` against the actual loaded grid, not
eyeballed) — would have spawned/floated the player mid-ocean with no shore
in sight. Relocated to the SW atoll cluster (the map's largest landmass +
its lagoon interior, found via connected-component analysis of the
classified band grid): shore now `(-40,52)` on that atoll's beach, boat now
`(-15,10)` afloat in its reef interior. Portal `drowned-arch` `(6,20)` did
NOT need to move — checked under the new terrain too, still lands in REEF
at ~2.7-2.8 units deep (noise-dependent), same "solidly submerged" reading
as before, lucky coincidence rather than by design. Incidentally re-checked
the still-open `mainShip` placement `(25,-25)` (Known bugs/OPEN, above)
against the new terrain too: still open DEEP water (17.3u deep), so that
placement is unaffected by this session even though its original
"checked against terrain.js" note was checked against the terrain this
session just deleted.

`ISLETS`/`SANDBARS`/`LAGOON_CX`/`LAGOON_CZ`/`DROP_BEARING`/`REEF_RADIUS`
are kept as plain literal exports in `terrain.js` (`zone.js` still imports
these names into its `landmarks` field) but no longer feed `terrainHeight`
— and, checked, `landmarks` itself isn't read anywhere downstream either
(not in `lagoon-fx.js`, not elsewhere). Left alone rather than churned:
genuinely inert data now, zero behavioral effect either way, not something
this session was asked to touch.

**Verified** (agent-checkable):
- Band coverage over the real map (nearest-color classify, tolerance 60) ≈
  58.6% DEEP / 21.9% REEF / 11.5% WADE / 2.9% SHALLOW / 5.1% LAND — matches
  the session brief's own expected ≈58/21/11/3/5 split; the 0.96% of
  pixels that were labels/anti-aliasing fringe are fully absorbed by the
  BFS fill (checked pre- and post-fill counts), zero holes remain.
- Ran the actual shipped code (not a model of it) in headless Chromium
  against the real dev server: `world/index.html` loads end-to-end with
  zero console/page errors, canvas + controller debug hooks present.
  Direct `terrainHeight`/`bandAt` calls confirm LAND classifies dry, WADE
  classifies wade (not run, not swim), REEF and DEEP both classify swim
  (they're only visually distinguished — floor-visible vs high-sea — not a
  movement-behavior difference, matching the legend's own design intent);
  zero NaN across a 41x41 sanity grid spanning the whole map.
- `node --check` clean on both new/edited modules.

**Not verified** (needs Agni, eyeball-only): the actual visual read — flat
Caribbean-cay feel, the three named clusters reading as painted (reef bar
NW, atoll ring SW, long sandbars E), the tiny islet reading as a landmark
and not just a bump; whether the new shore/boat spawn `lookAt` framing is
actually a good view over the lagoon rather than just numerically-safe.

## WORLD EDITOR SESSION — 2026-07-29 (in progress, autonomous, phase commits)
No `WORLD-EDITOR-BRIEF.md` exists in the repo (checked: not on disk, never
committed in git history) — worked from the compressed order-of-operations
given directly in the session prompt instead, same adaptation as the
missing `docs/brief.md` in RESOLVER-BINDING-SESSION.

**Phase 0 — 3-axis rotation engine fix.** `grassland/scatter.js`'s and
lagoon `catalogue-flora.js`'s own local `mtx()` helpers both only ever built
a Y-axis quaternion (`setFromAxisAngle`), even though a genuinely
free-standing placed prop (not upright flora) needs full pitch/roll too.
Both now route through a small `rotQuat(rot)`: a plain number still gets the
exact original Y-only path (byte-identical for every existing scatter call
site — trees/rocks/bushes/palms/seaweed/reef all still pass a scalar,
zero behavior change), an `[x,y,z]` array gets a full `THREE.Euler` quaternion
instead. `lagoon/catalogue-flora.js`'s `placeMainShip` and its binding row
switched from a Y-only `rotation` scalar to a `rot:[x,y,z]` array — using
this session's own prescribed proof vector `[0.3,0,0.2]` exactly, which
**drops the previous Y=0.4 heading** rather than blending it in (a real,
flagged tradeoff: the ship now visibly lists/pitches instead of just facing
a chosen heading — re-tune both once the World Editor's gizmo lands in
Phase 2, not by hand-editing bindings.js/edits.js).
- Verified: `node --check` clean; the scalar branch of `rotQuat` is the
  original expression verbatim (not just equivalent), so backward
  compatibility is exact by inspection, not just by test.
- Not verified (needs Agni, eyeball-only, no browser available here): the
  ship actually rendering visibly tilted at (25,-25) in Lagoon.

**Phase 1 — edits.js data layer + applyEdits.** New `core/world-edits.js`:
`applyEdits(ctx, scene, zone, editsModule)`, the one place that understands
the edits.js schema (full spec in the file's own header) — `placed[]` (id,
catalogueId, variant, x/y/z with `y:null` terrain-snapping, `rot:[x,y,z]`,
`scale` number-or-array multiplying onto the resolved pack's own
policy.scaleFactor, optional tint/materialPolicy overrides, `locked`),
`familyOverrides`/`scatterEdits` (schema defined, NOT consumed yet — that's
Phase 4's "scatter reach" job; catalogue-flora.js doesn't read either one
yet). Resolves ids via the existing `resolveAsset`/`loadCatalogue`, same
served-or-shelf + per-pack-policy path every other consumer uses. Every
zone (grassland/lagoon/highland) now has an `edits.js` and calls
`applyEdits` from `build()`, fire-and-forget, same convention as
`instantiateCatalogueFlora` — grassland/highland's are empty (`placed: []`)
for now, structural uniformity only.

Moved lagoon's `mainShip` out of `bindings.js` into `lagoon/edits.js`'s
`placed[]`; `bindings.js` is back to pure family->pack scatter slots only,
and `catalogue-flora.js`'s dedicated `placeMainShip()` is deleted (its job
is now the generic `applyEdits` path). Checked field-by-field against the
old call: same catalogueId, same resolved policy (pirates -> flat-matte,
scaleFactor 1), same `rot:[0.3,0,0.2]`, and `y` is an EXPLICIT `-0.15`
(WATER_Y-0.15, the boats.js floating-draft convention) rather than `null` —
`null` would have terrain-snapped it to the seafloor (~-6.15u down there),
sinking it instead of floating it. Same tint (null), same variant
(undefined -> the entry's sole variant). This should be a byte-for-byte
render-identical swap.
- Verified: `node --check` clean on every new/edited file; no dangling
  references to `placeMainShip`/`bindings.mainShip` anywhere (grepped).
  Every field in the new `placed[]` row traced by hand against the deleted
  function's old computation — confirmed equivalent (see above).
- Not verified (needs Agni, eyeball-only, no browser available here): the
  ship still rendering identically in Lagoon via the new path.

**Phase 2 — edit mode + transform gizmo.** New `core/world-editor.js` (the
engine: raycasting, TransformControls, selection) + `core/world-editor-
panel.js` (DOM: catalogue picker, toolbar, minimal status line — the full
per-object property inspector is Phase 3). Backtick (`` ` ``) toggles,
lazy-loaded via `import()` on first press (not a static top-level import),
memory-stable across open/close (own AbortController dropped in one shot on
close; the DOM panel is created once and just hides — see its own header
comment for why that's equivalent, not a shortcut). Disabled inside any
overlay or the catalogue-gallery zone (`` ` `` no-ops there — no edits.js
concept to edit); `main.js`'s `loadZone()` force-closes it on every zone
change so a stale selection never points at a just-disposed object.

Click selects (raycast against `world-edits.js`'s live placed[] registry,
skipping locked ones); **T/R/Y** set translate/rotate/scale; place-new
walks the SAME catalogue enumeration the gallery uses (`gallery/rooms.js`'s
`loadRooms()` — added `entryId`/`variant` per slot, purely additive, the
gallery itself never reads them) via a room-then-variant `<select>` pair,
armed by a "Place" button, dropped on the next canvas click (ray -> a
horizontal plane, iterated 3x against `zone.terrainHeight` to converge on
the real ground point under the cursor — no per-zone terrain-mesh
raycasting needed). Duplicate (button or Ctrl/Cmd+D)/Delete (button or Del/
Backspace)/Lock (checkbox, locked = unselectable) all live on
`core/world-edits.js`'s extended API (`removePlacedObject`,
`addPlacedObject`, `duplicatePlacedObject`, `serializePlaced`,
`genPlacedId`). Ground-snap is a toggleable checkbox (default on) applied
ONLY after a translate drag ends — a real bug caught during self-review:
the first draft snapped Y after ANY drag including rotate/scale, which
would've slammed a floating object (the ship) down to its seafloor
`terrainHeight` the instant it was rotated. Save serializes every live
placed object's CURRENT transform (position/rotation read straight off the
object; scale divides the resolved pack's `policyScaleFactor` back out
first, so save->reload never compounds it) plus whatever's currently in the
zone's `familyOverrides`/`scatterEdits` (not hardcoded empty — reads the
live editsModule via a new `getEditsModule()`, so Phase 4 can mutate those
in place without Save silently dropping them) into `export const edits =
{...}` text, downloaded as `<zone>-edits.js` + copied to clipboard (same
Blob+anchor+clipboard pattern `gallery/zone.js`'s `exportMarks` already
uses). "Load-back on entry" is Phase 1's `applyEdits` — already true,
nothing new needed for the round trip.

Two other bugs caught during self-review, before they shipped: (1) T/R/Y
and Delete/Ctrl+D were on a window-level keydown listener with no focused-
element guard — typing to search in the catalogue picker's native
`<select>` would have hijacked the gizmo mode; both this listener and
main.js's own Backquote toggle now skip while an INPUT/SELECT/TEXTAREA has
focus. (2) A rapid double-press of Backquote could race the dynamic
import (both calls seeing the module as "not yet loaded") and double-
initialize the DOM panel; guarded with a `worldEditorLoading` flag.

Known, accepted, out-of-scope overlap: grassland's OWN pre-existing Area
Designer (`L` key, editor.js/editor-panel.js, a completely separate system
keyed to `props.js`'s native/Kenney registry) can technically be open at
the same time as this new editor — untouched per CLAUDE.md ("don't touch
what you weren't asked to"), and their registries are disjoint (no object
can be selected by both), so the only real collision is two independent
TransformControls gizmos potentially visible at once if a user deliberately
opens both. Not fixed — not asked for, and needs a human opening both
deliberately to ever hit.
- Verified: `node --check` clean on every new/edited file. Every field/
  schema path traced by hand (id uniqueness across a zone revisit within
  one session, scale round-trip through policyScaleFactor, variant:null
  resolving correctly for shelf-only single-variant entries — checked
  resolveAsset's own fallback logic against catalogue.json's actual stored
  `variant: null` shape).
- Not verified (needs Agni, eyeball-only, no browser available here): the
  actual in-browser feel — gizmo dragging, click-to-place accuracy on
  Highland's steeper terraces (the 3-iteration ray/terrain convergence is
  reasoned, not measured), whether T/R/Y read as natural, whether 5+ open/
  close cycles really hold at zero geometry growth (reasoned from following
  grassland/editor.js's proven-stable pattern exactly, not independently
  re-measured this session).

**Phase 3 — object inspector panel.** Extends the selected-object status
line into a full property panel: position/rotation(°)/scale (uniform-or-
per-axis toggle) numeric fields, recolor (click a material-name swatch,
then a native `<input type=color>`), a material-policy select (pack
default / authored / flat-matte), and a model-swap picker (same room-then-
variant catalogue enumeration as place-new). Live preview — every field
mutates the selected THREE object directly; Save reads the live transform
at export time (already true since Phase 2).

A real correctness fix, caught during this phase's own design rather than
after the fact: `core/gltf-assets.js`'s template caches (`_templateCache`/
`_tintedCache`) were keyed by URL alone, on the RESOLVER-BINDING-SESSION
invariant "policy is a pure function of the pack, so one url only ever
needs one policy." Phase 3's per-object material-policy override breaks
that invariant outright — the SAME url can now legitimately be requested
under two different policies (one placed object's inspector override vs.
everything else still on the pack default) — so both cache keys now fold
in `policy.material` too. Transparent to every existing caller (their
policy is still a pure function of pack, so they still get exactly one
cache entry per url); only a policy-overridden object gets a second,
correctly-isolated entry.

Two more bugs caught during this phase's self-review, before shipping:
(1) the first draft's numeric position/rotation/scale fields called
`notify()` on every keystroke, which rebuilds the whole inspector (matching
grassland/editor-panel.js's own render pattern) — recreating a focused
`<input>` on every character would have stolen focus/cursor position out
from under the user mid-type. Fixed by NOT calling notify() from those
setters (grassland's own numField sidesteps the identical issue the same
way — its `set()` callbacks mutate the object directly, bypassing editor.js
entirely); the 3D view still updates live regardless, since the render
loop runs every frame independent of any DOM re-render. The recolor
color-picker has the same fix for the same reason (dragging a native color
wheel fires `oninput` continuously). (2) The per-axis scale fields
originally captured the other two axes' values once at panel-build time —
editing X after having already edited Y would have silently reverted Y
back to its stale build-time value. Fixed by re-reading all three axes
fresh (`Editor.getSelectedUserScale()`) at the moment each field's own
setter actually fires, not once when the fields were built.

Model swap and the material-policy toggle both route through one new
`core/world-edits.js` primitive, `rebuildPlacedObject(scene, zone, id,
patch)`: reads the object's CURRENT live transform (not the stale row
captured at build/last-rebuild time), merges `patch` over it, loads the
replacement, and only swaps it into the scene/registry once the new one
has actually loaded — a failed swap (bad id, load error) leaves the
original completely untouched, never a half-applied state.
- Verified: `node --check` clean on every edited file. Cache-key fix
  confirmed transparent by inspection (every existing caller's policy is
  still 1:1 with its pack, so the widened key can only ever produce
  additional cache entries, never fewer/different ones for existing code
  paths). The recolor clone-then-set-color technique matches core/gltf-
  assets.js's own loadTintedTemplate remap exactly, so it inherits that
  code's already-established "don't mutate a shared cached material"
  correctness rather than re-deriving it.
- Not verified (needs Agni, eyeball-only, no browser available here): the
  actual in-browser feel of the inspector fields, whether the recolor
  swatches read as expected across a textured (authored) vs. solid-color
  (flat-matte) material, whether a model swap's carried-over scale/rotation
  ever looks obviously wrong against a wildly different replacement model's
  proportions (a deliberate choice — see rebuildPlacedObject's own comment
  — not a defect if so, just a starting point to then re-tune live).

**Phase 4 — scatter reach.** New `core/scatter-registry.js`: maps a raycast
hit on a scattered `InstancedMesh` (mesh + THREE's own per-hit
`instanceId`) to a deterministic `Family#NNNN` id and back. Both
`catalogue-flora.js` files now assign these ids inside their sync
placement loop, in true placement order — the id counter (one per family,
shared across every season/state/moss group of that family) advances for
EVERY candidate that clears the rejection-sampling checks, hidden or not,
so hiding an instance can never renumber anything after it. `core/world-
editor.js`'s click-to-select now does ONE combined raycast against placed
objects AND every registered scatter mesh, so whichever is actually closer
under the cursor wins (not "placed always beats scatter"); a scattered hit
gets a lightweight inspector (no gizmo — an `InstancedMesh` instance isn't
its own `Object3D`, see the code's own comment on why a proxy-object
mechanism was scoped out) with a **Hide this instance** action and an
**apply to whole family** section (retint, material-policy).

A serious bug caught and fixed DURING this phase's own build, before it
ever ran: the first draft checked `scatterEdits[id]?.hidden` and skipped
the REST of that placement's own scale/rotation/variant RNG draws when
hidden. Since every zone uses ONE seeded generator advancing through the
entire placement pass, skipping draws for a hidden instance would shift
every subsequent RNG call — meaning hiding one tree would silently
re-shuffle the position/species/scale of every tree placed after it on the
next rebuild, not just remove the hidden one. Fixed by making every RNG
draw for a candidate unconditional (variant, scale, rotation all computed
whether or not it ends up hidden) and gating ONLY the final `addToGroup`
call (what actually renders) on the hidden check.

A second bug caught the same way: a multi-part template (a tree's separate
trunk/leaves meshes) registers several `InstancedMesh`es sharing one id
list, but DIFFERENT groups of the same family (e.g. `Rock:normal` vs.
`Rock:snow`) are separate meshes with their OWN independent index space.
Hiding "index N in every mesh of this family" would have zeroed out an
unrelated instance in a different group that happened to share that
number. Fixed with `getSiblingMeshes(mesh, index)`, which only matches
meshes where the SAME id (not just the same index) appears at that index —
safe because ids are family-global, so an id match can only ever mean a
true sibling part-mesh of one specific placement.

**Scoped out this phase** (the 15-minute-budget allowance, applied
surgically to specific sub-features rather than the whole phase):
- Per-instance position/rotation/scale editing beyond hide — would need a
  proxy-Object3D-plus-`setMatrixAt` mechanism (no native gizmo support for
  one `InstancedMesh` instance); hide (matrix -> zero scale) needed no such
  proxy.
- `familyOverrides[family].catalogueId` (whole-family model swap) and
  `.scale` (whole-family scale multiplier) — the schema already documents
  both (Phase 1) and nothing rejects them if hand-authored into edits.js,
  but catalogue-flora.js doesn't consult either this session. Tint and
  materialPolicy were prioritized since neither touches phase 1's placement
  math at all (pure phase-2 concerns), unlike catalogueId/scale which would
  ripple into the sync pass.
- `familyOverrides[family].materialPolicy` is PERSISTED (written, and
  consumed on the next zone build) but not LIVE-applied — doing that live
  would mean rebuilding every group of the family (same reason a single
  placed object's policy toggle needs `rebuildPlacedObject`, just fanned
  out across N groups instead of one object). Reload the zone to see it.
- Live hide doesn't retract the ORIGINAL collision circle grassland
  registered for that tree/rock at build time (lagoon has no collision
  system at all, so this only affects grassland) — walking through a
  hidden-but-not-yet-rebuilt tree/rock will still collide with it until the
  next full zone build. Noted, not fixed.
- Verified: `node --check` clean on every new/edited file. RNG-determinism
  fix confirmed by re-reading every placement loop in both files line by
  line to check EVERY draw happens outside the hidden-conditional. Id
  uniqueness confirmed by construction (one counter per family, incremented
  once per accepted candidate, never reset mid-pass).
- Not verified (needs Agni, eyeball-only, no browser available here): that
  a click actually resolves to the right scattered instance, that hiding
  reads as "gone" rather than glitchy, that a family-wide retint applies
  cleanly across every currently-visible group of that family.

**Phase 5 — HUD + Design handoff.** A top bar (`core/world-editor-panel.js`,
separate from the left-side property panel, always visible while the
editor is open): zone id, current selection, gizmo mode, an unsaved-changes
dot, "Copy selection JSON", and a Save button. New `core/world-editor.js`
dirty-tracking (`markDirty`/`isDirty`/`onDirty`/`clearDirty`) — since typed
numeric edits deliberately don't call the heavy `notify()` (Phase 3's own
focus-preserving fix), the dot needed its OWN lightweight signal wired into
every mutating function separately (place/duplicate/delete/rebuild/recolor/
transform/hide/family-override), not just the ones that already notify.
`copySelectionAsJSON()`: the live `placed[]` row for a placed selection, or
`{id, family, scatterEdit}` for a scattered one.

The `collide` field this phase adds is explicitly DATA ONLY, per the
session brief's own instruction: `'auto' | 'none' | {type, r, h}`,
documented in `core/world-edits.js`'s schema header and present on every
placed[] row (defaulted to `'auto'` for new placements), but nothing reads
it — no collider is generated from it. The parametric bell-collider itself
is explicitly out of scope this session (a separate future one); this just
keeps the schema seam ready so that session doesn't need a breaking schema
change to add the field.

New `WORLD-EDITOR-GUIDE.md` (repo root): hotkeys, the full data model
(`bindings.js` + `edits.js` schemas, catalogue id shape, `Family#NNNN`
scatter-id stability), the end-to-end workflow, and explicit rules for
Claude Design (or any future automated editor): edit `edits.js`/
`bindings.js` only, catalogue ids only (never hardcode a served/shelf file
path), never bypass the policy system, `collide` is inert data not a
feature yet, ids are assigned by the tool and never hand-invented, and the
same schema shape applies to every zone (Highland's near-empty files are a
scope choice, not a gap to fill in).

**This closes out the World Editor session (Phases 0-5).** Everything
above is `node --check`-clean and reasoned through by hand at every step
(RNG-determinism, id-uniqueness, cache-key correctness, focus-preservation,
shared-material safety) — but NONE of it has been eyeballed in an actual
browser this session (no headless/Playwright driver was used, per the
session's own explicit instruction: "eyeball-only verification"). The
concrete first thing to do next session: open Grassland/Lagoon, press
`` ` ``, and walk through the guide's own workflow section once — place
something, drag it, recolor it, hide a scattered tree, Save, and paste the
result back over the real `edits.js` to confirm the whole loop actually
closes.

## COLLISION-FOUNDATION-SESSION — 2026-07-31 (collide: data -> real colliders)

World Editor Phase 5 left `collide` on every `placed[]` row as pure schema —
`'auto' | 'none' | {type,r,h}`, nothing read it, so a placed dock or building
was walk-through and the ship's deck-walking still used the old
`deckOffset`/`deckInset` single-rectangle hack. This session wires it up for
real, split along the perf line the brief made non-negotiable: STATIC
colliders (buildings, docks, decor) bake once at zone-load; DYNAMIC colliders
(ships — moving, walked-on) would be compound primitives only, never a mesh
collider — no caller actually needs the dynamic path yet (see Queue item 7),
but the primitive itself supports it now.

**The spec** (full header comment in `core/colliders.js`; schema doc also
updated in `core/world-edits.js`'s header): a resolved `collide` value is
`null` (no collider), an explicit `{ static, shapes:[...] }` object (a
per-placement override), or `'auto'`/missing, which looks up
`core/collider-catalogue.js`'s table by the row's `catalogueId` — a spec
authored once there propagates to every placement of that model, in every
zone, matching the "keyed per catalogue model" instruction. A deliberate,
flagged choice: unmapped catalogue ids stay exactly as walk-through as they
already were before this session (`resolveCollideSpec` returns `null`, not a
measured guess) — no live geometry-measurement fallback was built. This
keeps the change strictly additive (every already-placed prop that ISN'T the
dock — including Lagoon's `mainShip`, which has no collision system around
it at all today — renders identically to before), at the cost of leaving
"measure a footprint from geometry" (the schema comment's original,
never-implemented aspiration for `'auto'`) unbuilt; extending coverage is
now a pure data addition (a new `collider-catalogue.js` entry), not a code
change, so this isn't a dead end, just a narrower first cut than the literal
brief text technically asked for.

Each shape (`box`/`sphere`/`capsule`/`cone` = blockers; `deck` = a
height-only stand-on surface, never a `collisionRegistry` entry) has its
own local `pos`/`rot` composed with the placement's world transform once
(static) or on every query via a `live()` getter re-reading the object's
`matrixWorld` (dynamic) — same live-collider convention
`grassland/props.js`'s area-designer colliders already use for a movable
prop. `box`/`sphere`/`capsule` map onto `core/collision.js`'s existing
circle/OBB primitives (that engine is 2D-XZ + a vertical band, not true 3D —
a shape's pitch/roll only shapes itself before projecting to a Y-axis-only
`yaw`, flagged in `colliders.js`'s own header as a real limitation, not
silently wrong); `cone` is approximated as a vertical cylinder of its base
radius (no taper — the parametric taper/skew shaping is explicitly future
work per the brief). Two more limitations inherited from riding on top of
`collision.js` rather than extending it, both documented in `colliders.js`'s
header: a live collider's vertical band is fixed at registration time (fine
for anything that stays near-constant in Y while moving, like a floating
boat — the same assumption `boats.js`'s own `boatHeight` already makes), and
`collision.js`'s spatial hash buckets a collider into cells once at
registration and never re-buckets it as a dynamic `live()` position drifts
far away — a real gap for whoever wires up a ship that actually sails long
distances, not something this session's actual use (a static dock) can hit.

**Proved on the dock**: `pirates:Environment:Dock`/`Dock_Broken`/`Dock_Pole`
(the three catalogue models grassland's `edits.js` already has five `placed[]`
rows for, all `collide:'auto'`, previously inert) each got a hand-authored
static spec in `collider-catalogue.js` — a `deck` box for the two walkway
pieces, a `capsule` for the pole. The numbers come from the REAL GLB
geometry, not a guess: wrote a one-off Node script (scratchpad, not
committed) that parses each `.glb`'s JSON chunk directly and walks its node
hierarchy composing accessor `min`/`max` bounds through each node's TRS —
pure glTF-spec bounds reading, no three.js/DOM/WebGL needed, so real numbers
were available without a browser. Measured (post the runtime base-pivot
shift `core/gltf-assets.js`'s `loadRaw` already applies): Dock ~2.18×3.01×2.66
(x/y/z), Dock_Broken ~2.39×3.01×2.66, Dock_Pole ~0.37×3.01×0.38 — all three
share the same ~3.0 height, base at local y=0. Where the WALKABLE PLANK
SURFACE sits within that measured envelope isn't something bounds alone can
answer, so the deck's `y` (1.0, of ~3.0) is a first-pass estimate, flagged
in Known bugs/OPEN above as the concrete thing to eyeball first; the pole's
capsule deliberately spans almost the FULL measured height instead
(`h:2.4, r:0.22` centered at `y:1.5` → local band ≈[0.08, 2.92] against the
measured [0, 3.01]) specifically so "can't walk through the poles" doesn't
depend on guessing the same precise number — a wrong deck height just reads
as a visibly-floating-or-sunk character (an obvious, cheap-to-fix bug); a
too-short pole collider would have silently let the proof fail.

**Wired into `applyEdits`** (`core/world-edits.js`): after adding each
successfully-built, non-boardable placed object to the scene,
`resolveCollideSpec(row.collide, row.catalogueId)` -> `registerColliders`
runs in static mode against the live object. Boat rows (`row.boardable`)
`continue` past this entirely, same as before — they're spawned later via
`spawnFleetForZone`/`boats.js`, outside `applyEdits`'s own per-row loop, so
this session's static-only wiring structurally cannot touch them (nothing
new needed to keep the dynamic ship case out of scope). Colliders registered
this way are cleaned up "for free" by the shell's own existing
per-zone-build reset (`main.js`'s `resetForNewZone` calls
`collisionRegistry.reset()`/`heightRegistry.reset()` before every
`build(ctx)`, already relied on by every other collider source in this
codebase) — no new disposal path needed. A deliberate, flagged gap
(consistent with Phase 4's own "live hide doesn't retract the original
collision circle" precedent): placing/duplicating/rebuilding an object LIVE
via the World Editor does not register a collider — only `applyEdits`
(zone build/reload) does, since the session brief scoped wiring to
`applyEdits` specifically. Save + reload picks it up.

**Verified** (agent-checkable, no browser needed): `node --check` clean on
every new/edited file (`core/colliders.js`, `core/collider-catalogue.js`,
`core/world-edits.js`). The dock/pole vertical-band arithmetic was hand-
traced against the actual placed rows' world Y (grassland `WATER_Y=-0.9`,
Dock/Dock_Pole placements ~-0.4 to -0.5) and the character controller's own
`CHAR_HEIGHT=1.7`/`STEP_UP=0.5` constants (`character/controller.js`) to
confirm the pole's registered `[yLow,yHigh]` band actually overlaps a
standing character's `[feetY,headY]` band at that location — the specific
failure mode ("collider registered but never actually intersects the
player") a bounds-only check wouldn't catch on its own.

**Not verified** (needs Agni, eyeball-only, no browser available here): the
whole point of this session — stand on the grassland dock, confirm the
character actually rests ON the visible planks (not floating above or
sinking into them; retune `collider-catalogue.js`'s deck `y` if not) and is
blocked by the `Dock_Pole` poles rather than walking through them; confirm
FPS is unchanged (the static bake is one-time per zone-load, so it should
be, but only an eyeball/profiler check actually confirms it).

## COLLISION-PAINTER-SESSION — 2026-07-31 (Editor v2 phase 1 — see/edit colliders)

COLLISION-FOUNDATION-SESSION (same day, above) made `collide` real but left
every collider spec hand-authored blind against measured GLB bounds — the
grassland dock's own walkable-surface height was a reasoned guess, flagged
in that session's own Known-bugs entry as needing an eyeball pass. This
session builds the tool to DO that eyeball pass, as a new "Collision" tab
inside the existing backtick World Editor, then uses the grassland dock as
its own built-in proof.

**Storage model unchanged, per the brief's own explicit instruction**: this
session only ever READS/WRITES `core/collider-catalogue.js`'s
`COLLIDER_SPECS` table and a `placed[]` row's own `collide` field — the same
two places COLLISION-FOUNDATION-SESSION built. No change to
`core/colliders.js`'s engine (the box/sphere/capsule/cone/deck shape
vocabulary, `registerColliders`'s static/dynamic split) or to
`core/collision.js` underneath it. GLBs are never touched — colliders stay
separate data keyed by catalogue id, exactly as before.

**The coordinate-space trick** (the brief called this "critical," and it's
the part most likely to silently go wrong): a shape's `pos`/`rot`/size
fields are model-local, but `core/world-editor.js`'s existing gizmo
naturally manipulates whatever it's `attach()`ed to in THAT object's own
local space already (see `setSelectedPosition` et al. — for a placed object
parented directly under the zone's identity-transformed content group,
local numbers already equal world numbers, which is why those functions
never needed a conversion either). So every collider-shape overlay is added
as a literal THREE child of `selected.obj` — never the scene root — with its
own `.position`/`.rotation`/`.scale` set straight from the shape's fields.
THREE's own parent-child matrix composition then places it in the correct
WORLD spot for free, and — the actual payoff — `TransformControls`
dragging it mutates exactly the local numbers the spec wants. Verified by
hand, not just by inspection: derived the exact composition formula THREE
produces for a child's world position/rotation/scale under this parenting
(`worldPos = basePos + baseQuat.rotate(baseScale ⊙ shape.pos)`,
`worldQuat = baseQuat * shapeQuat`, `worldScale = baseScale ⊙ shape.scale`)
and confirmed it's IDENTICAL, term for term, to `core/colliders.js`'s own
`composeShape` function — meaning the overlay isn't just "close enough,"
it renders at the exact position/orientation/size the real registered
collider will occupy. This is also why editing one dock's collider and
setting the "family" export target correctly repositions on every OTHER
placement of the same model at a different position/rotation (the session
brief's own "place a second dock elsewhere" verify check) — the edited
numbers are genuinely model-local, not accidentally baked against the one
instance being dragged.

**Engine additions** (`core/world-editor.js`, ~350 new lines; no change to
its existing placement/scatter selection logic except two `O(1)` guards —
see below): a `SHAPE_KIND` table (one entry per box/sphere/capsule/cone/deck
— how to build a unit placeholder overlay mesh, how to read/write the
shape's own size fields as a 3-axis scale so resizing is just a scale-mode
gizmo drag) drives `buildShapeOverlay`/`refreshColliderOverlay`
(translucent orange for blockers, green for `deck`, a brighter yellow
wireframe highlight on whichever shape is selected) and the bidirectional
`syncColliderShapeFromGizmo`/`syncOverlayFromShape` pair (gizmo-drag ->
shape data, and back, respectively — the only two places this session's
code touches transforms at all). `loadColliderSpecForSelection` resolves
precedence (an existing per-instance `collide` override, else the
per-catalogueId `COLLIDER_SPECS` entry, else empty) into a deep-copied
WORKING array, so edits never touch the source of truth until an explicit
Export. `liveReregisterCollider` is the "see AND test in the real renderer"
half (Phase 2's own explicit ask): retracts whatever collider is currently
live for the selected object — the original zone-load one the FIRST time
(consuming a new `colliderDispose` field `core/world-edits.js`'s
`applyEdits` now stores per registry record, since it previously discarded
`registerColliders`'s own returned disposer entirely — nothing before this
session ever needed to retract a specific object's collider without a full
zone rebuild) — then this editor's own previous live version every time
after (`colliderLiveDispose`, same record) — then registers a fresh one
from the current working shapes. Both disposer slots live ON THE REGISTRY
RECORD, not a module-level variable, so switching selection between
objects (or between several dock pieces) never mixes up whose collider is
whose and needs no manual reset. Deliberately never runs just from opening
the tab or selecting a shape — only from an actual edit (drag-end, a
numeric field, add/delete, the static toggle) — so Phase 1's "SEE" really
is read-only, nothing about the live game world changes until you touch
something.

**Two real bugs caught during this session's own build, before shipping**,
both matching a class of bug this codebase has hit and fixed before in
adjacent code:
1. The overlay meshes, being real children of `selected.obj`, would also
   get swept up by the EXISTING `getSelectedParts`/`recolorSelectedPart`
   (`selected.obj.traverse(...)`, the Properties tab's recolor swatches) —
   without a guard, opening the Collision tab would pollute the recolor
   panel with bogus empty-named "material parts." Fixed by tagging every
   overlay mesh's `userData.__colliderOverlay = true` at creation and
   skipping it in both traversal call sites — an `O(1)` check per mesh, no
   ancestor walk needed.
2. The numeric position/rotation/size fields, closing over a `disp`
   snapshot captured when the panel was last built, would silently revert
   a sibling field's just-typed value the moment a DIFFERENT field on the
   same shape was edited next — the exact bug this file's own Phase 3
   write-up (World Editor session) already documented and fixed for
   `buildScaleSection`'s per-axis scale fields, recurring here one level
   down (collider shapes instead of placed objects) because it's a new,
   separate set of fields with the same "don't re-render every keystroke"
   discipline. Fixed the same way: every setter re-reads the CURRENT shape
   fresh via `Editor.getColliderShapeDisplay(idx)` at the moment it fires,
   never the stale build-time snapshot.
   - (A third, syntax-level slip caught immediately by re-running the
     syntax check after every edit, not left for review: a stray `#`
     character typo'd in place of `//` at the start of a comment line,
     which `node --check` on a plain `.js` file did NOT catch — only
     re-checking a `.mjs`-renamed copy, forcing strict ESM parsing,
     surfaced it. `.js` files in this project ARE loaded as ESM by the
     browser's own importmap, so a `.mjs` copy is the accurate check going
     forward for this codebase, not plain `node --check <file>.js`.)

**UI** (`core/world-editor-panel.js`, ~180 new lines): a Properties/
Collision tab switcher with NO local "which tab" state of its own —
`Editor.isColliderTabOpen()` is the single source of truth, so clicking a
tab button and pressing X (the hotkey) can never drift out of sync. The
Collision view: catalogue id, a static checkbox, a target `<select>`
("ALL placements of `<model>`" / "Just this instance"), a scrollable shape
list (click to select, matching a 3D click), Add (a type picker + button)
/ Delete, the selected shape's numeric fields (pos/rot always; size fields
switch on shape type — box gets X/Y/Z, sphere gets Radius, capsule/cone get
Radius+Height, deck gets Size X/Z; rotation is hidden entirely for sphere
since it's a genuine no-op there in `core/colliders.js`'s own math, not
shown-but-inert), and an Export button + its own small dirty dot in the top
bar — deliberately separate from the existing placement Save dot, since the
two write to different files depending on target.

**Verified** (agent-checkable, no browser needed): `.mjs`-forced strict ESM
syntax check clean on every new/edited file (see the syntax-slip bug above
for why plain `node --check` on `.js` wasn't trusted alone this session).
Hand-traced the full dock workflow end to end against the actual code (not
a model of it): select Dock-1 -> open Collision tab -> resolves
`COLLIDER_SPECS['pirates:Environment:Dock:...']` (family target, since
Dock-1's own `collide` is still `'auto'`) -> overlay renders the `deck` box
at exactly `core/colliders.js`'s own registered position (confirmed via the
composeShape-equivalence proof above) -> drag it down -> `objectChange`
syncs the shape, drag-end retracts the ORIGINAL zone-load collider
(`selected.colliderDispose`, set by `applyEdits` at zone build) and
registers the edited one live -> Export (family target) applies the
working spec into `COLLIDER_SPECS` and downloads `collider-catalogue.js` ->
pasted over the real file and reloaded, the SAME edit now applies to EVERY
Dock-family row (Dock-1 AND Dock-2), each correctly composed against its
own distinct world position — confirming the model-local design propagates
correctly, not just for the one instance that was dragged. Also traced the
`Dock_Pole` capsule case by hand against the character controller's actual
`CHAR_HEIGHT`/`STEP_UP` constants to confirm a plausible edited collider
band still overlaps a standing character (same discipline
COLLISION-FOUNDATION-SESSION used to verify the original hand-authored
numbers).

**Not verified** (needs Agni, eyeball-only, no browser available here): the
actual in-browser feel — does the overlay read clearly against the model,
is dragging the gizmo on a small shape (the pole capsule especially)
comfortable at typical camera distances, does the tab switch feel
responsive, and the concrete payoff this whole session was built for:
opening the dock's Collision tab, seeing the deck box floating above the
planks, dragging it down, and confirming the character now stands exactly
on the visible surface.
