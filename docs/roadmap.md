# Grassland World — Roadmap, Steps & Session Prompts

Your working doc. The brief goes to Claude Design; this one is for you. Each arc lists the goal, what to build in Blender vs code, and copy-paste prompts. Always paste the brief first, update its "Current status" line, then use the prompt.

---

## Week One — Arc 0: The Base Scene

**Goal:** grassland + water + placeholder character walking around. This is the foundation every later arc plugs into. Also: prove the Blender → GLB → browser pipeline once, even trivially.

**Setup (one-time, ~1 hour):**
1. Install Blender (blender.org, free). Do the "delete the default cube" ritual. Learn only: navigate viewport (middle-mouse orbit, scroll zoom), G/R/S (grab/rotate/scale), Tab (edit mode), E (extrude).
2. Make the dumbest possible model — a mushroom, a fence post. Apply a material color, no textures.
3. Export: File → Export → glTF 2.0 (.glb). Settings: +Y up (default), Apply Modifiers on.
4. Load it in the browser scene with GLTFLoader. When your mushroom appears in your grassland, the entire pipeline is proven. Everything after is repetition.

**Prompt — base scene:**
> Build the base scene per the brief: a gently undulating grassland terrain (~200×200u, subtle noise-displaced plane, meadow-green flat shading), a lake occupying roughly a quarter of the map with a simple animated water material, and a placeholder character (capsule + sphere head, ~1.7u) with WASD movement, smooth rotation toward movement direction, and the third-person follow camera. Standard lighting rig, sky-colored fog. Character stays on terrain height and can't yet enter water (invisible boundary is fine).

**Prompt — pipeline test:**
> Here's a GLB I modeled [attach/describe]. Add a loader utility to the base scene that loads it, places it on the terrain at a given position, and logs its bounding box size so I can sanity-check my Blender export scale.

**Done when:** you can walk the capsule around a green world with water, and one Blender-made object exists in it.

---

## Arc 1: Trees, Houses, Landmarks

**Goal:** 5 distinct trees, 3 house types, 3–4 large landmark objects (e.g. watchtower, windmill, stone bridge, ruined arch).

**Blender share:** houses and landmarks — best modeling practice (box modeling: start from cube, extrude). One per sitting, 30–60 min each. Ugly is fine; silhouette is everything.
**Code share:** trees are ideal procedural targets (cone/icosphere canopies on cylinder trunks, randomized per instance) — you get 5 species and infinite variation cheaply.

**Prompts:**
> Create 5 procedural tree factory functions per the brief — pine (stacked cones), oak (icosphere clusters), birch (tall, sparse, pale trunk), willow (drooping lobes), dead tree (bare branches). Each accepts a seed/scale and randomizes proportions slightly. Show all 5 on a turntable, then scatter ~80 across the terrain with InstancedMesh where possible, avoiding the lake.

> Here are my house GLBs. Add a placement system: a simple array of {model, position, rotation} definitions, snapped to terrain height. Arrange the 3 houses into a small hamlet near the lake shore.

**Done when:** the world has a treeline, a hamlet, and at least 2 landmarks you can walk to.

---

## Arc 2: Ground Decorations

**Goal:** the layer that makes a world feel inhabited — grass tufts, rocks, flowers, bushes, mushrooms, a dirt path.

**Blender share:** 2–3 hero props (well, cart, signpost).
**Code share:** everything mass-scattered. This arc is really about **instancing** — grass needs thousands of copies at near-zero cost.

**Prompt:**
> Add a ground decoration pass per the brief: instanced grass tufts (thousands, cheap crossed-plane or tri-blade geometry, gentle wind sway in a vertex shader or via per-instance rotation), scattered rocks (3 procedural variants), flowers with random palette-accent colors, and bushes. Density falls off near the path and hamlet. Add a winding dirt path (darkened terrain vertex colors or a flattened ribbon mesh) connecting hamlet to lake.

**Done when:** standing still in the world feels pleasant. That's the actual test.

---

## Arc 3: Character Model Upgrade

**Goal:** replace the capsule with a real (still simple) character. **This is the rigging arc.**

**Steps:**
1. Model a chunky low-poly humanoid in Blender in T-pose (arms out, legs slightly apart), ≤3,000 tris. Keep hands as mittens, face minimal.
2. Export GLB → upload to Mixamo → auto-rig → download with 3 animations: Idle, Walk, Run (download once per animation, "with skin" for the first, "without skin" for the rest; FBX, then convert/combine in Blender and re-export one GLB with all clips). Archive every download locally — Mixamo's future isn't guaranteed.
3. If Mixamo fights you: fallback is Blender's Rigify addon + manual keyframing of a simple walk cycle, or Quaternius' free pre-rigged characters as a stopgap.

**Prompt:**
> Replace the placeholder capsule with this rigged GLB containing Idle/Walk/Run clips. Wire AnimationMixer to the movement controller: idle when still, walk at normal speed, run on Shift, with 0.2s crossfades between states. Keep the same follow camera and terrain-height logic.

**Done when:** your own character walks your world with blended animations.

---

## Arc 4: Jump + Swimming

**Goal:** vertical movement and water entry.

**Notes before prompting:** jumping means a tiny physics model (vertical velocity + gravity + grounded check against terrain height) — no physics engine needed yet. Swimming is a state machine: on entering water below a depth threshold, switch movement mode (slower, no gravity, buoyancy bob) and animation set. Grab Mixamo's jump and swim/treading clips in the same way as Arc 3.

**Prompt:**
> Add jump (Space): vertical velocity + gravity, grounded check vs terrain height, jump animation clip with proper state transitions. Then swimming: when the character moves into water deeper than 1u, switch to swim state — reduced speed, character bobs at surface level, swim animation loops, camera lowers slightly. Exiting to shallow ground returns to normal locomotion. Implement locomotion as a clean state machine (idle/walk/run/jump/swim) so future states slot in.

**Done when:** you can leap off the bridge into the lake and swim across it.

---

## Arc 5: Water Upgrade

**Goal:** make the lake beautiful. Your first real shader arc.

**Notes:** this is the classic stylized-water stack — moving vertex waves, depth-based color gradient (shallow teal → deep blue), foam line at shores, sparkle highlights. Expect to iterate; water is feel-driven.

**Prompt:**
> Upgrade the lake to stylized low-poly water per the brief: gentle animated vertex waves (sine layers), depth-based color blend from shallow #4aa8b8 to a deeper blue, a soft foam edge where water meets terrain, and subtle specular glints. Keep it flat-shaded and cohesive with the palette — stylized, not realistic. Character swim bob should follow the wave height.

**Done when:** screenshots of the lake are portfolio-worthy on their own.

---

## Beyond Arc 5 — a bench of future arcs

Day/night cycle and lighting moods · birds/butterflies (simple boids) · sound (footsteps, ambience) · NPC villager with a wander loop · doors that open / enterable house · weather (rain, cloud shadows) · a first gameplay verb (pick up items? talk?) · performance pass (LODs, frustum checks) · port shell to SvelteKit/Threlte.

## Weekly rhythm

One arc ≠ one week necessarily — an arc is done when it's done. The weekly unit is a **session**: brief pasted, status line updated, one scoped goal, something visibly better at the end. Keep a `/assets` folder of every GLB with a naming scheme (`tree_pine_01.glb`, `house_a.glb`) from day one — this folder *is* the long-term game resource library you described.
