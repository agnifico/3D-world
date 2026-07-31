# World Editor — user + Claude Design guide

The World Editor is the Layer-4 finetune tool: a zone-agnostic edit mode
over whatever zone is currently loaded (Grassland/Lagoon/Highland), for
placing, moving, recoloring, and swapping catalogue models by hand, without
touching code. It sits on top of the resolver/binding/policy system built
in the RESOLVER-BINDING-SESSION (`world/core/catalogue.js`,
`core/asset-policy.js`, each zone's `bindings.js`) and adds one more data
layer, `edits.js`, per zone.

## Opening it

Press **`` ` `` (backtick)** while in Grassland, Lagoon, or Highland.
Disabled inside any overlay and inside the catalogue gallery zone (`K`) —
neither has an `edits.js` to edit. Crossing a portal or opening the
gallery closes it automatically.

Gameplay (WASD, camera, Space, E) keeps working while the editor is open —
it's an overlay on top of the normal controller, not a separate mode.

## Hotkeys

| Key | Action |
|---|---|
| `` ` `` | Toggle the editor |
| Left click | Select (placed prop or scattered instance — whichever is closer under the cursor) |
| `T` / `R` / `Y` | Gizmo mode: translate / rotate / scale (placed objects only) |
| `Delete` / `Backspace` | Delete selected placed object, hide selected scattered instance, or (Collision tab open, a shape selected) delete that shape |
| `Ctrl`/`Cmd` + `D` | Duplicate selected placed object |
| `X` | Toggle the Collision tab for the selected placed object |
| `[` / `]` | Cycle the selected collider shape (Collision tab only) |
| `Esc` | Cancel an armed placement, deselect a collider shape, or deselect |

T/R/Y and Delete/Ctrl+D are suppressed while a `<select>`/`<input>` in the
panel has focus (so typing to search the catalogue picker doesn't hijack
the gizmo mode).

## Data model

Two data files per zone, both plain ES modules — no build step, edit them
directly or let the editor's Save regenerate them:

- **`world/zones/<zone>/bindings.js`** — `{ [slot]: { family, id, scale?,
  tint?, where? } }`. Maps a SCATTER SLOT (e.g. `CommonTree`, `shoreBush`)
  to the catalogue id it draws from. Repointing a slot here changes what
  every instance of that species/family uses, for every zone that shares
  the slot's placement logic. See `core/catalogue.js`'s header for the
  canonical id shape.

- **`world/zones/<zone>/edits.js`** — `export const edits = { placed,
  familyOverrides, scatterEdits }`. Full schema documented in
  `world/core/world-edits.js`'s own header (read that file — it's the
  source of truth, this doc is a summary):
  - `placed[]` — hand-placed, one-off catalogue props (a ship, a
    landmark rock, anything that isn't a repeated scatter species). Each
    row: `{ id, catalogueId, variant?, x, y, z, rot:[x,y,z], scale,
    tint?, materialPolicy?, locked, collide }`.
  - `familyOverrides[family]` — a zone-wide override for one scatter
    family (every season/state/variant group of it). This session wires
    up `tint` and `materialPolicy` (both consumed on the next zone
    build); `catalogueId` and `scale` overrides are schema-legal but not
    yet consumed anywhere (see Known gaps below).
  - `scatterEdits[id]` — a per-instance override for one specific
    scattered placement, keyed by its `Family#NNNN` id. This session only
    wires up `hidden: true`.

Catalogue ids (`catalogueId` everywhere above) are always the full id
string from `world/assets/catalogue.json` — e.g.
`'pirates:Ship:Large:normal:alive:'` or `'NNK Style::Bush_Common:normal:alive:'`.
Resolve one with `resolveAsset(manifest, catalogueId, variant)`
(`core/catalogue.js`) — it returns `{ url, pack, policy }`, handling
served-vs-shelf and the pack's material/scale policy for you.

`Family#NNNN` scatter ids are assigned in TRUE PLACEMENT ORDER by each
zone's `catalogue-flora.js`, one counter per family, advancing for every
candidate whether or not it ends up hidden — this is what keeps a saved
`scatterEdits[id]` pointing at the same physical placement across
rebuilds. Never hand-author a scatter id; only ids the game itself
generated are meaningful.

## Workflow

1. **Place something new**: pick a family/room and variant from the
   catalogue picker (same enumeration the catalogue gallery, `K`, uses),
   click "Place", then click a spot on the terrain. It drops there,
   selected, ready to transform.
2. **Move/rotate/scale**: select it, press T/R/Y, drag the gizmo. Ground-
   snap (a checkbox, on by default) re-snaps Y to terrain height after a
   translate drag — never after rotate/scale, so a floating object (like
   the ship) doesn't get slammed to the seafloor just for being rotated.
3. **Recolor**: click a material-name swatch, then pick a color — clones
   the material first, so a textured part keeps its texture and just gets
   tinted (never replace-with-flat-color; see `recolorSelectedPart`'s own
   comment for why that matters).
4. **Swap model / material policy**: the inspector's own pickers, live.
5. **Duplicate / Delete / Lock**: buttons or hotkeys; a locked object can't
   be selected or transformed until unlocked.
6. **Scattered instances**: click one to see its `Family#NNNN` id. "Hide
   this instance" removes just that one (persisted + live). "Apply to
   whole family" retints or changes material policy for every instance of
   that family currently on screen (tint is live; material policy takes
   effect on the next zone build/reload).
7. **Save**: downloads `<zone>-edits.js` and copies it to the clipboard.
   Paste it over the real `world/zones/<zone>/edits.js` to make it stick —
   there's no live write-to-disk from the browser. The top bar's dot is
   red while there are unsaved changes, green once Saved.
8. **Copy selection as JSON** (top bar): a quick single-object export —
   the live placed[] row, or `{id, family, scatterEdit}` for a scattered
   selection — for pasting into a chat/issue, not for the Save workflow.

## Collision tab (Editor v2 phase 1 — COLLISION-PAINTER-SESSION)

With a placed object selected, click **Collision** (next to **Properties**)
or press **X** to see and edit its collider — the same box/sphere/capsule/
cone/deck vocabulary `core/colliders.js` runs at zone-load, now visible and
draggable instead of authored blind. Shapes render as translucent overlays
on the model: orange for a blocker (box/sphere/capsule/cone), green for a
`deck` (walkable surface, not a wall).

1. **See**: opening the tab alone changes nothing live — it's read-only
   until you actually edit something. A misplaced collider (the grassland
   dock's deck box floating above its planks was the bug this tool exists
   to fix) is visible immediately.
2. **Edit**: click a shape (in 3D or the panel's shape list) to gizmo-attach
   it — T/R/Y cycle the SAME translate/rotate/scale modes as placement.
   Scale drags resize it directly (a box's size, a sphere/capsule/cone's
   radius/height, a deck's footprint). The numeric fields below do the same
   thing by typing. The FIRST edit on an object retracts whatever collider
   it already had (from zone-load or a prior edit this session) and
   registers the updated one immediately — walk onto/into it right away to
   check, no reload needed.
3. **Add / Delete**: pick a shape type, click "Add shape" — drops a
   default-sized one at the model's own origin, immediately selected.
   "Delete selected shape" (or `Delete`/`Backspace`) removes it.
4. **Static**: the whole spec's bake-once flag (buildings/docks/decor —
   everything today) vs. attached-and-tracked-live (a moving object — no
   real caller yet, see PROJECT-STATE.md's ship-hookup follow-up).
5. **Target**: "ALL placements of this model" (the default) writes
   `core/collider-catalogue.js`'s entry for this `catalogueId` — every
   placement of that model, in every zone, inherits it. "Just this
   instance" writes an explicit `collide` override onto this ONE
   `placed[]` row instead (`edits.js`).
6. **Export**: same idea as the top-bar Save, a separate button/dot because
   it can write a DIFFERENT file. Family target downloads
   `collider-catalogue.js` (paste over `world/core/collider-catalogue.js`).
   Instance target downloads this zone's `edits.js` (identical to clicking
   the top-bar Save — the data now lives in the row's own `collide` field).
   Either way: paste over the real file, reload to make it stick for good —
   the live edit already works in THIS session without that, same as every
   other live edit in this editor.

The model-local coordinate math (why a shape dragged on one placement of a
model also lands correctly on every OTHER placement, at a different
position/rotation) is documented in `core/world-editor.js`'s own header
comment above its `SHAPE_KIND` table — read that before touching this
tool's internals; getting it wrong silently breaks every collider the
moment a model is placed anywhere but the world origin.

## Rules for Claude Design (or any future automated editor)

1. **Edit data files only.** `edits.js` and `bindings.js` are the entire
   surface for placing/moving/retinting/swapping content. Never hardcode
   a position, rotation, model path, or tint directly into a zone's
   `zone.js` or `catalogue-flora.js` — if it's not expressible in one of
   these two files' schemas, that's a sign the schema needs a new field,
   not that the placement code needs a one-off special case.
2. **Catalogue ids only, never file paths.** Every model reference is a
   `catalogueId` string resolved through `resolveAsset`
   (`core/catalogue.js`). Never write a literal `assets/nature/...` or
   `3DResources/...` path into a data file or into code — the whole point
   of the resolver is that served-vs-shelf and per-pack policy are
   handled in exactly one place.
3. **Don't bypass the policy system.** Material treatment (authored vs.
   flat-matte) and scale normalization come from `core/asset-policy.js`,
   keyed by pack. An `edits.js` row's `materialPolicy` overrides it for
   that one object/family — that's the sanctioned escape hatch. Don't add
   a second, competing place that decides material treatment.
4. **`collide` is real — at zone-load, AND live via the Collision tab.**
   `'auto' | 'none' | { static, shapes:[...] }` on every `placed[]` row is
   registered into real colliders/height contributors by
   `core/colliders.js`, called from `core/world-edits.js`'s `applyEdits`
   (see that file's own header for the full shape vocabulary and
   `core/collider-catalogue.js` for the per-model spec table `'auto'` looks
   up) AND from this editor's own Collision tab (X, or the tab button) once
   you actually edit a shape. Plain placing/duplicating/rebuilding an
   object — without opening the Collision tab on it — still does NOT
   register a collider until the zone next reloads. Don't add a second,
   competing place that decides collision; extend `collider-catalogue.js`
   (by hand, or through the Collision tab) instead. The parametric
   taper/skew primitive shaping is still separate, future work (see
   PROJECT-STATE.md).
5. **Never reuse or hand-author an id.** `placed[]` ids and `Family#NNNN`
   scatter ids are both assigned by the editor (`genPlacedId` /
   catalogue-flora.js's placement-order counter). Hand-editing an
   `edits.js` row is fine; inventing a NEW id by hand for something the
   editor didn't generate is not — a collision (two rows sharing one id)
   silently breaks Save/select.
6. **Keep the same shape across zones.** `bindings.js` and `edits.js` use
   an identical schema in every zone specifically so tooling (this editor,
   or Design) doesn't need per-zone special cases. If Highland's files
   still look mostly empty, that's because its own content pass is still
   `held` (see `zones/highland/terrain.js`) — not a gap to "fix" by
   inventing content here.

## Known gaps (see PROJECT-STATE.md's Phase 3/4 write-ups for the full reasoning)

- No per-instance position/rotation/scale editing for scattered instances
  beyond hide (would need a proxy-object + `setMatrixAt` mechanism).
- `familyOverrides[family].catalogueId` (whole-family model swap) and
  `.scale` are schema-legal but not consumed by `catalogue-flora.js` yet.
- `familyOverrides[family].materialPolicy` applies on the next zone build,
  not live.
- Live-hiding a scattered instance doesn't retract its original collision
  circle in Grassland (Lagoon has no collision system at all until this
  session's dock spec adds its first entry) until the zone is rebuilt.
- Placing/duplicating a placed object, or swapping its model, live in this
  editor does NOT register a fresh collider for it on its own — open the
  Collision tab on it (even with zero edits, then Add a shape) to give it
  one live, or Save + reload to pick up whatever `collider-catalogue.js`
  already has for its `catalogueId`. Rebuild (model swap) DOES correctly
  retract whatever collider the OLD object had before replacing it, so this
  is "doesn't gain one automatically," not "leaks the old one" — see
  `core/world-edits.js`'s `rebuildPlacedObject`/`removePlacedObject`.
- The Collision tab's overlay/gizmo only edits ONE object's colliders at a
  time — even under "apply to ALL placements" target, a SIBLING placement
  of the same model that's already built into the scene keeps its OLD live
  collider (if it was ever live-edited itself) until that sibling is
  individually opened in the tab, or the zone reloads. Export + reload is
  the reliable way to see a family-wide edit everywhere at once.
- The parametric taper/skew primitive shaping (a tilted/curved collider):
  not built, by design — separate future work.
