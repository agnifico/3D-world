// World Shell — Layer 3 of the resolver/binding system (RESOLVER-BINDING-
// SESSION): per-pack material + scale policy, applied by the resolver
// (core/catalogue.js's resolveAsset) and enforced by core/gltf-assets.js's
// loader. Replaces the old global override in gltf-assets.js that forced
// flatShading/matte roughness onto EVERY loaded model regardless of pack —
// the NNK smoke test found that treatment destroys NNK's authored canopy
// detail, and direct GLB inspection this session confirmed why: BIGNature/
// Simple_Nature carry solid untextured per-part materials (the override was
// tuned for exactly these, and still is), while NNK/pirates/ghibli_nature
// carry a real baseColorTexture atlas the override was never validated
// against.
//
// 'flat-matte' = the old normalizeNatureMaterial treatment (metalness 0,
// roughness 0.9, flatShading true) — Quaternius nature's built-for look.
// 'authored'   = leave the GLB's exported material exactly as loaded.
//
// Default when a pack has no row here = pass-through: authored, scale 1 —
// absence of a rule must never corrupt a model (the catalogue's own
// "can't lie" discipline, extended to policy).
export const PACK_POLICY = {
  // Prescribed by the session brief, backed by the smoke-test finding.
  'NNK Style': { material: 'authored', scaleFactor: 0.4 }, // Pine measured ~7u vs BIGNature CommonTree's ~2.9u

  // Prescribed by the session brief ("the current override is fine" / "its
  // built-for look") — both also confirmed textureless (solid
  // baseColorFactor, no baseColorTexture) by direct GLB inspection, so
  // flat-matte is the correct class for them, not just an inherited default.
  'BIGNature': { material: 'flat-matte', scaleFactor: 1.5 },
  // Not yet routed through this resolver — grassland/assets.js's own Kenney
  // pipeline loads these directly (see core/gltf-assets.js's header). Row
  // kept for when/if that pipeline migrates onto resolveAsset.
  'kenney-models': { material: 'flat-matte', scaleFactor: 2 },

  // Left open by the brief ("sensible default, easy to edit"); set here
  // from direct GLB inspection. Simple_Nature's Grass material has no
  // baseColorTexture (solid per-part color, same class as BIGNature), so
  // flat-matte reproduces its current shipped seaweed look exactly.
  'Simple_Nature': { material: 'flat-matte', scaleFactor: 1 },
  // pirates (Ship/PalmTree/Rock) DOES carry a real baseColorTexture atlas —
  // same authored class as NNK, not BIGNature's flat class — but 2 of its
  // entries (PalmTree, Rock) already ship in Lagoon today under the old
  // blind override. Kept at flat-matte here so those don't visibly change
  // out from under Agni mid-session; the texture atlas still reads under
  // flat-matte (only shading smoothness/roughness change, not the texture
  // itself), so the new Ship binding still shows its real paint job. Flip
  // to 'authored' after eyeballing if the richer look is preferred — a
  // one-line edit here, not a code change.
  'pirates': { material: 'flat-matte', scaleFactor: 1 },
  // ghibli_nature: no row — falls through to DEFAULT_POLICY below.
  // Inspected the same way (Flower_*_Clump.glb carries a real
  // baseColorTexture) and 'authored' is already the correct treatment for
  // it, so no override is needed.
};

export const DEFAULT_POLICY = { material: 'authored', scaleFactor: 1 };
export function getPackPolicy(pack) { return PACK_POLICY[pack] || DEFAULT_POLICY; }
