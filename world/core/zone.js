// World Shell — the Zone contract every zone module implements. This file
// is documentation-as-code plus a light shape check; there's no heavy
// runtime here on purpose (the shell just calls the methods below directly).
//
// A zone module's default export (or a named `zone` export) must look like:
//
//   {
//     id: 'grassland',            // stable string, used as portal targetZone
//     name: 'Grassland',          // display name
//     worldExtent: 100,           // world spans roughly ±worldExtent on X/Z
//     WATER_Y: -0.9,              // this zone's water surface height
//     terrainHeight(x, z),        // PURE function, no three import, Node-testable
//     surfaceHeightAt(x, z),      // OPTIONAL — absolute world Y of the water
//                                 // surface at (x,z) THIS FRAME. Zones with a
//                                 // flat plane don't implement it; validateZone
//                                 // installs a `() => WATER_Y` default for any
//                                 // zone that omits it. A zone with real waves
//                                 // (open-sea) overrides it with the live swell.
//     surfaceNormalAt(x, z),      // OPTIONAL companion — the surface slope at
//                                 // (x,z), for boats/objects that should pitch
//                                 // and roll with real waves instead of a flat
//                                 // cosmetic bob. No default is installed for
//                                 // this one; callers must guard its absence.
//     PALETTES: { day: {...}, night: {...}, ... },   // keyframe-name -> palette
//     dayCycle: [{ t: 0, key: 'day' }, { t: 1, key: 'night' }],  // ascending t
//     spawnPoints: { [name]: { position:[x,y,z], lookAt:[x,y,z], eyeHeight } },
//     portals: [{ id, x, z, targetZone, targetPortal }],
//     usesBloomComposer: true,    // OPTIONAL, default true — set false if this
//                                 // zone's shaders weren't built for the shared
//                                 // EffectComposer/UnrealBloomPass path (e.g.
//                                 // Lagoon: hand-authored sRGB encoding, tuned
//                                 // against a plain renderer.render()) even if
//                                 // its palette carries a non-trivial bloom field
//

//     // Builds this zone's THREE content into ctx.scene and registers its
//     // height contributors / colliders / boats / interactables into the
//     // systems ctx provides. Returns the zone's root THREE.Group (added to
//     // the scene already, or returned for the shell to add — build() adds
//     // it itself, matching how every existing zone module builds directly
//     // into a passed-in scene).
//     build(ctx): THREE.Group,
//
//     // Per-frame zone work (waves, particles, scatter sway, minimap bake,
//     // etc). Must NOT own scene.fog/scene.background/lights — those are
//     // driven only via ctx.lighting (core/lighting.js). Called every frame
//     // while this zone is active, AFTER the shell's own per-frame work.
//     update(dt, camera),
//
//     // Releases every GPU resource this zone created (geometries,
//     // materials, textures), removes its group from the scene, and calls
//     // ctx.abortController.abort() to drop every DOM listener it attached
//     // during build(). Does NOT need to reset the shared height/collision/
//     // boat/interactable registries itself — the shell resets those right
//     // before the NEXT zone's build() runs (see core/height-registry.js,
//     // core/collision.js, core/boats.js, core/interactables.js).
//     dispose(),
//   }
//
// `ctx`, passed into build(), carries:
//   { scene, animated, heightRegistry, collisionRegistry, lighting, fx, audio,
//     abortController }
// where `animated` is THIS ZONE's own per-frame callback array (separate
// from the shell's persistent sharedAnimated list) — the shell iterates it
// every frame while the zone is active and simply drops the reference on
// dispose, so a zone never needs to manually unregister its own animated
// callbacks.

import * as Interactables from './interactables.js';

export function validateZone(zone) {
  const required = ['id', 'name', 'worldExtent', 'WATER_Y', 'terrainHeight', 'PALETTES', 'dayCycle', 'spawnPoints', 'portals', 'build', 'update', 'dispose'];
  const missing = required.filter(k => zone[k] === undefined);
  if (missing.length) throw new Error(`[zone] "${zone.id || '?'}" is missing: ${missing.join(', ')}`);
  // Absolute world Y of the water surface at (x,z) this frame. Optional —
  // zones with a flat plane don't implement it, so they fall back to WATER_Y.
  if (!zone.surfaceHeightAt) zone.surfaceHeightAt = () => zone.WATER_Y;
  return zone;
}

// Highest of the three seeded interaction priorities (see
// core/interactables.js) — a portal must win over disembarking so a
// boat-borne crossing actually fires on E instead of hopping the rider out.
const PORTAL_PRIORITY = 100;
const PORTAL_RADIUS = 5;

// Registers a zone's portals as interactables (E to enter, in range) — one
// shared implementation so Grassland and Lagoon don't each duplicate the
// "portal is just an interactable" wiring. `ctx.onPortalEnter(portal)` is
// the shell's crossPortal hook; the zone itself doesn't know or care what
// crossing a portal actually does.
export function registerPortals(ctx, portals) {
  for (const portal of portals) {
    const distToPortal = (character) => Math.hypot(character.position.x - portal.x, character.position.z - portal.z);
    Interactables.register({
      id: `portal-${portal.id}`,
      priority: PORTAL_PRIORITY,
      inRange: (character) => distToPortal(character) < PORTAL_RADIUS,
      distanceTo: distToPortal,
      label: () => `Enter ${portal.targetZone}`,
      key: 'KeyE',
      onActivate: () => ctx.onPortalEnter?.(portal),
    });
  }
}

// IMPORTANT: `ctx.scene` handed to build() must be a private THREE.Group the
// shell creates per zone-build (added to the real scene once), NOT the real
// THREE.Scene itself. Every zone submodule just calls scene.add(x) on
// whatever it's given, unaware it's a subgroup — that's what makes
// disposeGroup() below a complete, generic dispose() for ANY zone,
// regardless of which of its own submodules created what: traverse once,
// free every geometry/material/texture THIS ZONE OWNS, then remove the group
// from the real scene. Catalogue content (anything template.clone(true)'d
// from core/gltf-assets.js's _templateCache/_tintedCache, or an InstancedMesh
// built straight off a shared template's geometry/material by
// core/instancing.js) is cross-zone and loader-owned — those resources carry
// a `__sharedAsset` mark (gltf-assets.js's markShared) and are skipped here,
// left for the cache to keep handing out. Only zone-local procedural content
// — terrain, water, fx, portal arches, everything built fresh per build() —
// actually gets freed. Things that must NOT go through ctx.scene: the
// character (shell-owned, persists across crossings — added straight to the
// real scene by character/controller.js) and shared fx like ripples/splash
// (also added to the real scene, once, at shell startup).
export function disposeGroup(realScene, group) {
  group.traverse(o => {
    if (o.isInstancedMesh) o.dispose(); // frees instanceMatrix/instanceColor only — geometry/material are borrowed, handled below
    if (o.geometry && !o.geometry.userData.__sharedAsset) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || m.userData.__sharedAsset) continue;
        for (const key of ['map', 'alphaMap', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap']) {
          if (m[key] && !m[key].userData.__sharedAsset) m[key].dispose();
        }
        m.dispose();
      }
    }
  });
  realScene.remove(group);
}
