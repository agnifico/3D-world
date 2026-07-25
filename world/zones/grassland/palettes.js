// Grassland zone — day/night PALETTES: pure-data tables (this file is handed
// to a design tool afterward that edits palette *values* only — keep every
// tunable number here, zero logic mixed in). Day/Night changes ONLY
// lighting & colors — the world content (flora mix, objects) is identical
// in both. The blend engine itself (applyLighting) is now shared shell code
// — see core/lighting.js — this file supplies only the data + the
// dayCycle keyframe order it expects.
export const PALETTES = {
  day: {
    name: 'Grassland',
    sky: 0x9ed2e8,
    fog: { color: 0x9ed2e8, near: 70, far: 250 },
    hemi: { sky: 0xbfe3f2, ground: 0x7a9455, intensity: 0.9 },
    sun: { color: 0xfff2d8, intensity: 1.6, offset: { x: 35, y: 55, z: 20 } },
    water: { color: 0x4aa8b8, opacity: 0.82, roughness: 0.35, metalness: 0.05 },
    terrain: { g1: 0x7cb356, g2: 0xa8c66c, sand: 0xcdbb8a, bed: 0x3d6b5e },
    grass: { accent: 0xc4c96a },
    flowerGlow: 0,
    lantern: { color: 0xffc37a, intensity: 0 },
    // inert stretch data for a later design/post-processing pass — not wired,
    // no bloom pipeline exists and building one isn't a trivial addition here
    bloom: { strength: 0, radius: 0.4, threshold: 0.85 },
  },
  night: {
    name: 'Grassland — Night',
    sky: 0x0e0b26,                                   // deep indigo-violet (also fog/horizon colour)
    fog: { color: 0x0e0b26, near: 26, far: 150 },    // denser + blue-shifted vs day
    hemi: { sky: 0x2f356b, ground: 0x161d2a, intensity: 0.55 },
    sun: { color: 0xb7c4ec, intensity: 0.72, offset: { x: 35, y: 55, z: 20 } }, // moonlight: desaturated blue-white, low
    water: { color: 0x123f49, opacity: 0.94, roughness: 0.44, metalness: 0.05 }, // dark blue-green; soft diffuse moon sheen, not a mirror (no bloom orb)
    terrain: { g1: 0x2a4750, g2: 0x37545b, sand: 0x3f4560, bed: 0x0b232e },      // cooler; warm dirt path (baked separately) still reads
    grass: { accent: 0x4f9ea0 },
    flowerGlow: 0.6,
    lantern: { color: 0xffc37a, intensity: 30 },
    bloom: { strength: 0.5, radius: 0.5, threshold: 0.82 },                        // gentle halo on the moon/windows/fireflies only — not the whole lit ground
  },
};
export const dayCycle = [{ t: 0, key: 'day' }, { t: 1, key: 'night' }];
export const modeKey = new URLSearchParams(location.search).get('mode') === 'night' ? 'night' : 'day';
