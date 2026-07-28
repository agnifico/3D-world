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
