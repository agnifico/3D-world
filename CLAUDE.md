# Grassland World — working contract

Read `docs/brief.md` before any code work — it defines art direction, palette, and tech constraints. This file adds the operational rules.

## What this is
Solo 3D learning project: a browser grassland world in vanilla Three.js, built in weekly "arcs." Nothing is throwaway — every asset and system gets reused in the eventual full game.

## Hard constraints (never violate)
- Vanilla Three.js, pinned at the importmap version in `index.html`. No build step, no bundler, no framework, no npm dependencies. The game is `index.html` + `assets.js`, full stop.
- No libraries beyond `three` and `three/addons/` unless explicitly asked.
- Every reusable object is a factory function returning a `THREE.Group`, pivot at base-center. 1 unit = 1 meter, Y-up, ground at y = 0.
- No localStorage/sessionStorage — state lives in memory.
- Performance budget: 60fps on a mid-range laptop. Props ≤ 300 tris, trees ≤ 800, houses ≤ 1,500, character ≤ 3,000. `InstancedMesh` for anything repeated 10+ times. Keep draw calls under ~150.

## File map
- `index.html` — scene setup, terrain/world gen, character controller, camera, asset gallery, main loop
- `assets.js` — all asset factories + shared utils (`rng`, `mat`, `makeInstanced`, `addWind`, `prismGeometry`)
- `assets/` — exported GLBs. Naming: `tree_pine_01.glb`, `house_a.glb`, `char_main.glb`. `assets/mixamo_raw/` holds untouched Mixamo downloads.
- `blender/` — `.blend` source files, one per asset, name-matched to its GLB
- `docs/brief.md` — design brief (art direction, palette, constraints). `docs/roadmap.md` — arc plan and session prompts.

## Working rules
1. One scoped goal per session. If asked for something outside the current arc's scope, flag it and ask before building it.
2. Edit surgically. Never rewrite a file wholesale, never "clean up" or reformat code you weren't asked to touch.
3. Runnable code first, explanation after, kept brief. Explain non-obvious 3D concepts in a sentence, don't tutorialize.
4. If a request conflicts with `docs/brief.md`, say so and propose the compliant version.
5. Every new asset: add the factory to `assets.js` AND add it to the gallery `items` list in `index.html` so it shows up on the G-key inspection view.
6. End of session: update the "Current status" block at the bottom of `docs/brief.md`, then commit with message `arcN: <what changed>`. Tag `arc-N` when an arc completes.
7. Verify in the browser via a local static server (Live Server / `npx serve` / `python3 -m http.server`) — ES modules and GLBs don't load over `file://`.

## Known state / open decisions
- The procedural VRoid rig in `index.html` is **frozen**: it works, do not improve or extend it. Arc 3 proper replaces it with a self-modeled low-poly character + Mixamo clips (Idle/Walk/Run) via `AnimationMixer`. The VRoid model is earmarked to become an NPC villager later.
- Day/night lighting was pulled forward from the post-Arc-5 bench. Treat it as done; don't grow it.
- `createCrystal` exists ahead of plan — reserved for the Crystal Gather MVP loop (first gameplay verb).
