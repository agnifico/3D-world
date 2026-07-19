# Project Brief — Grassland World (drop-in context)

Read this fully before generating anything. It defines the project, the tech constraints, and the art direction. Everything you produce must comply with it.

## What this project is

A long-term solo 3D game project, built incrementally in weekly "arcs." The current phase is a browser-based grassland world: open terrain, a water body, and a placeholder third-person character. Each session adds or upgrades one small piece — assets, animation, or environment. Nothing is throwaway: every asset and system built here will be reused in the eventual full game.

I am a designer-engineer with strong frontend skills (Svelte/SvelteKit) but new to 3D. Explain non-obvious 3D concepts briefly when you use them, but don't over-tutorialize.

## Tech constraints (non-negotiable)

- **Vanilla Three.js**, latest stable, loaded as ES modules via importmap from a CDN (`three` and `three/addons/`). No build step, no framework, no bundler. Output must run as a single HTML file (or one HTML + one JS module max).
- Use `GLTFLoader` for external models. Assume custom models arrive as `.glb` files. When a model isn't available yet, build a **procedural placeholder** from Three.js primitives grouped in a `THREE.Group` — never block on missing assets.
- Every reusable object must be a **factory function returning a `THREE.Group`** (e.g. `createPineTree(scale)`), so it can be instanced and later ported to Threlte/SvelteKit unchanged.
- Standard loop: `renderer.setAnimationLoop`, delta-time based movement (`THREE.Clock`), window resize handled.
- No external libraries beyond Three.js and its addons unless I explicitly ask.
- No localStorage/sessionStorage. Keep state in memory.

## World conventions

- **Scale: 1 unit = 1 meter.** Character ≈ 1.7u tall, trees 4–10u, houses 4–8u.
- **Y-up.** Ground plane at y = 0. Object pivots at base-center so `position.y = 0` places things on the ground.
- **Lighting rig (default every scene):** one `HemisphereLight` (sky/ground tint) + one warm `DirectionalLight` with shadows (`shadowMap` PCFSoft, tight shadow camera bounds). Soft distance fog matching sky color.
- **Camera:** third-person follow/orbit behind the character, ~55° FOV, unless the session is about a specific asset (then a slow turntable view).

## Art direction: Natural stylized low-poly

- Flat-shaded, faceted look: `flatShading: true` on `MeshStandardMaterial`, or vertex colors. **No image textures** unless explicitly requested — color comes from materials.
- Palette: warm meadow greens (#7cb356, #a8c66c), earthy browns (#8b6f47, #6b4f35), sky blue (#9ed2e8), water teal (#4aa8b8), sun-warm accents (#e8c468). Slightly desaturated, cohesive, cheerful. Think Monument Valley meets a low-poly nature pack — NOT neon, NOT dark/gothic.
- Silhouette over detail: shapes must read clearly at a distance. Prefer 10 well-placed polygons over 100 noisy ones.
- Subtle idle life: gentle vertex/rotation sway on vegetation, soft water movement. Nothing frantic.

## Performance budget

Target 60fps on a mid-range laptop. Per-asset guide: props ≤ 300 tris, trees ≤ 800, houses ≤ 1,500, character ≤ 3,000. Use instancing (`InstancedMesh`) for anything repeated 10+ times (grass, rocks). Keep total draw calls under ~150.

## Working style

- Deliver runnable code first, explanation after, in brief.
- When I ask for an asset, also show it in a minimal viewer scene with the standard lighting rig.
- If a request conflicts with this brief, flag it and propose the compliant version.

## Current status

> **Update this line each session.**
> Arcs 0–2 done: terrain, stream + lake, hamlet, landmarks, instanced trees/grass/flowers/rocks with wind sway, dirt path, day/night lighting (pulled forward from the bench), asset gallery (G key).
> Arc 3 partial: VRoid GLB with a frozen procedural rig — to be replaced by a self-modeled character + Mixamo clips.
> This session's goal: —
