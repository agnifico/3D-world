#!/usr/bin/env node
// Asset cataloguer — walks 3DResources/ (the messy master shelf, never served,
// never reorganized) and produces world/assets/catalogue.json: a single
// tagged manifest of every model, whether or not it's actually used by the
// game today. Separately, it copies only the USED subset (families the
// current scatter recipes reference — see the USED list below) into
// world/assets/nature/, which IS served.
//
// Re-run this script any time a new family is added to USED — that's the
// whole update path, nothing else needs to change by hand.
import { readdirSync, statSync, mkdirSync, copyFileSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, extname, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SHELF_DIR = join(ROOT, '3DResources');
const CATALOGUE_OUT = join(ROOT, 'world', 'assets', 'catalogue.json');
const NATURE_OUT = join(ROOT, 'world', 'assets', 'nature');

// ---------------------------------------------------------------------------
// USED — the families actually referenced by a zone's scatter recipe today.
// Only variants belonging to one of these (set, family[, category]) get
// copied into world/assets/nature/; everything else stays on the shelf,
// catalogued but unused. Add a row here + re-run to pull a new family in.
// ---------------------------------------------------------------------------
const USED = [
  { set: 'BIGNature', family: 'CommonTree' },
  { set: 'BIGNature', family: 'PineTree' },
  { set: 'BIGNature', family: 'BirchTree' },
  { set: 'BIGNature', family: 'Willow' },
  { set: 'BIGNature', family: 'Rock' },
  { set: 'BIGNature', family: 'Bush' },
  { set: 'BIGNature', family: 'BushBerries' },
  { set: 'Simple_Nature', family: 'Grass' },
  { set: 'Simple_Nature', family: 'Bush' },
  { set: 'pirates', family: 'PalmTree', category: 'Environment' },
  { set: 'pirates', family: 'Rock', category: 'Environment' },
  { set: 'BIGNature', family: 'PalmTree' },                      // derived — lagoon/bindings.js
  { set: 'BIGNature', family: 'Plant' },                         // derived — lagoon/bindings.js, open-sea/bindings.js
  { set: 'kenney-models', family: 'boat-fishing-small' },        // derived — core/boats.js, grassland/edits.js
  { set: 'kenney-models', family: 'boat-row-small' },            // derived — core/boats.js, grassland/edits.js
  { set: 'kenney-models', family: 'bridge-draw' },               // derived — core/collider-catalogue.js, grassland/edits.js
  { set: 'kenney-models', family: 'fence-doorway' },             // derived — grassland/edits.js
  { set: 'kenney-models', family: 'fence-fortified' },           // derived — grassland/edits.js
  { set: 'kenney-models', family: 'fountain-square-detail' },    // derived — grassland/edits.js
  { set: 'kenney-models', family: 'pillar-stone' },              // derived — grassland/edits.js
  { set: 'kenney-models', family: 'siege-ram' },                 // derived — grassland/edits.js
  { set: 'kenney-models', family: 'siege-tower' },               // derived — grassland/edits.js
  { set: 'kenney-models', family: 'stall' },                     // derived — grassland/edits.js
  { set: 'kenney-models', family: 'tower-hexagon-base' },        // derived — grassland/edits.js
  { set: 'kenney-models', family: 'tower-hexagon-mid' },         // derived — grassland/edits.js
  { set: 'kenney-models', family: 'windmill' },                  // derived — grassland/edits.js
  { set: 'kenney-models', family: 'workbench-anvil' },           // derived — grassland/edits.js
  { set: 'kenney-models', family: 'workbench-grind' },           // derived — grassland/edits.js
  { set: 'kenney-models', family: 'workbench' },                 // derived — grassland/edits.js
  { set: 'NNK Style', family: 'Clover' },                        // derived — grassland/edits.js
  { set: 'NNK Style', family: 'Mushroom_Laetiporus' },           // derived — grassland/edits.js
  { set: 'NNK Style', family: 'Plant_1_Big' },                   // derived — grassland/edits.js
  { set: 'NNK Style', family: 'Plant_7_Big' },                   // derived — grassland/edits.js
  { set: 'NNK Style', family: 'Plant' },                         // derived — grassland/edits.js
  { set: 'NNK Style', family: 'TwistedTree' },                   // derived — grassland/edits.js
  { set: 'pirates', family: 'Cliff', category: 'Environment' },  // derived — grassland/edits.js
  { set: 'pirates', family: 'Dock_Broken', category: 'Environment' }, // derived — core/collider-catalogue.js, grassland/edits.js
  { set: 'pirates', family: 'Dock_Pole', category: 'Environment' }, // derived — core/collider-catalogue.js, grassland/edits.js
  { set: 'pirates', family: 'Dock', category: 'Environment' },   // derived — core/collider-catalogue.js, grassland/edits.js
  { set: 'pirates', family: 'Large', category: 'Ship' },         // derived — core/boats.js, grassland/edits.js
];

// ---------------------------------------------------------------------------
// Filename → semantic fields. Tolerant of ordering/casing: strip a trailing
// variant number, then strip recognized modifier tokens (autumn/snow/dead/
// moss) from what's left — whatever remains is the family name. A small
// fixed set of category prefixes (pirates' Environment_/Prop_/Weapon_/...)
// is peeled off first when present, since pirates' convention is
// Category_Family_Variant rather than nature's bare Family_Season_Variant.
// ---------------------------------------------------------------------------
const CATEGORY_PREFIXES = ['Environment', 'Prop', 'Weapon', 'UI', 'Characters', 'Ship', 'Enemy'];
const SEASON_TOKENS = new Set(['autumn', 'snow']);
const STATE_TOKENS = new Set(['dead']);

// Filenames separate words with '_'/'-' (both \w chars in JS regex, so plain
// \b never fires at those boundaries — "Corn_1" would silently fail to match
// \bcorn\b, and "Environment_Rock_1" would fail \brock\b too) OR jam a
// variant number straight on with no separator at all ("Cliff1"). ww() treats
// only actual letters as "inside a word", so digits/underscores/hyphens/
// string-edges all count as valid boundaries — "Corn_1" matches, "Corner"
// (letter follows) does not.
const ww = (word) => `(?<![a-zA-Z])${word}(?![a-zA-Z])`;

const KEYWORD_TAGS = [
  [/palm/i, ['tree', 'palm', 'tropical']],
  [/pine/i, ['tree', 'conifer']],
  [/birch/i, ['tree', 'deciduous']],
  [/maple/i, ['tree', 'deciduous']],
  [/willow/i, ['tree', 'deciduous']],
  [/deadtree/i, ['tree', 'dead']],
  [/commontree/i, ['tree', 'deciduous']],
  [/^tree\d*$/i, ['tree']],
  [/treestump|stump/i, ['stump', 'deadwood']],
  [new RegExp(`woodlog|${ww('log')}`, 'i'), ['log', 'deadwood']],
  [/cactus/i, ['cactus', 'desert']],
  [/bushberries/i, ['bush', 'berries', 'harvestable']],
  [/bush/i, ['bush']],
  [/grass/i, ['grass', 'groundcover']],
  [/flower|petal|clover/i, ['flower']],
  [new RegExp(`${ww('wheat')}|${ww('corn')}`, 'i'), ['crop', 'harvestable']],
  [/lilypad/i, ['lilypad', 'aquatic']],
  [/mushroom/i, ['mushroom']],
  [new RegExp(ww('plant'), 'i'), ['plant']],
  [/coral/i, ['coral', 'reef']],
  [/seagrass/i, ['seagrass', 'aquatic']],
  [/kelp|seaweed/i, ['kelp', 'aquatic']],
  [/shell/i, ['shell']],
  [/reed/i, ['reed', 'aquatic']],
  [/rock|pebble|cliff|boulder/i, ['rock']],
  [/wall|floor|roof|door|window|corner|stair|overhang|chimney|fence|gate/i, ['building']],
  [/ship|boat|dock|anchor|cannon|sail/i, ['nautical']],
  [/sword|axe|dagger|pistol|rifle|cutlass|weapon|musket|shotgun/i, ['weapon']],
  [/characters?_|skeleton|barbarossa|sharky|tentacle|shark/i, ['character']],
  [/chest|barrel|bucket|coin|gold|bomb|bottle|skull|bone/i, ['prop']],
];

function tagsFor(basenameNoExt) {
  const tags = new Set();
  for (const [re, ts] of KEYWORD_TAGS) if (re.test(basenameNoExt)) for (const t of ts) tags.add(t);
  return tags;
}

function parseFilename(fileBase, set) {
  // 1. trailing variant number (with or without a separator)
  let remainder = fileBase, variant = null;
  const vm = fileBase.match(/^(.*?)[_-]?(\d+)$/);
  if (vm && vm[1].length) { remainder = vm[1]; variant = parseInt(vm[2], 10); }

  // 2. category prefix (pirates-style Category_Family_Variant)
  let tokens = remainder.split('_').filter(Boolean);
  let category = null;
  if (tokens.length > 1 && CATEGORY_PREFIXES.includes(tokens[0])) {
    category = tokens[0];
    tokens = tokens.slice(1);
  }

  // 3. strip recognized modifier tokens; whatever's left is the family
  const modifiers = [];
  const familyTokens = [];
  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (SEASON_TOKENS.has(low) || STATE_TOKENS.has(low) || low === 'moss') modifiers.push(low);
    else familyTokens.push(tok);
  }
  const family = familyTokens.length ? familyTokens.join('_') : (tokens.join('_') || remainder);

  const season = modifiers.includes('autumn') ? 'autumn' : modifiers.includes('snow') ? 'snow' : 'normal';
  const state = modifiers.includes('dead') ? 'dead' : 'alive';
  const extra = modifiers.filter(m => m !== 'autumn' && m !== 'snow' && m !== 'dead');

  const tags = tagsFor(fileBase);
  if (season !== 'normal') tags.add(season);
  if (state === 'dead') tags.add('dead');
  for (const e of extra) tags.add(e);

  return { set, category, family, season, state, extra, variant, tags: [...tags] };
}

// ---------------------------------------------------------------------------
// Walk the shelf: collect one canonical file per (dir, basenameNoExt) group —
// prefer .glb, fall back to .gltf only when no .glb sibling exists, never
// pick .fbx/.obj/.blend masters.
// ---------------------------------------------------------------------------
function walk(dir, out) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const groups = new Map(); // basenameNoExt -> { glb?, gltf? }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { walk(full, out); continue; }
    if (!e.isFile()) continue;
    const ext = extname(e.name).toLowerCase();
    if (ext !== '.glb' && ext !== '.gltf') continue;
    const nameNoExt = e.name.slice(0, -ext.length);
    if (!groups.has(nameNoExt)) groups.set(nameNoExt, {});
    groups.get(nameNoExt)[ext.slice(1)] = full;
  }
  for (const [nameNoExt, g] of groups) {
    const chosen = g.glb || g.gltf;
    out.push({ dir, nameNoExt, path: chosen, ext: g.glb ? 'glb' : 'gltf' });
  }
}

const files = [];
walk(SHELF_DIR, files);

// ---------------------------------------------------------------------------
// Collapse parallel format exports. walk() prefers .glb over .gltf within one
// directory, but some packs ship the SAME model twice in sibling format dirs:
// every Kenney kit carries both "Models/FBX format/x.glb" (FBX2glTF, texture
// embedded) and "Models/GLB format/x.glb" (UnityGLTF, external atlas). Left
// alone those become two variants of one entry, and the resolver would pick
// between two different exports of the same object at random.
//
// The tie is broken toward "GLB format" deliberately, not arbitrarily: that
// UnityGLTF export is the one that has actually been shipping (it won the
// old flat copy's last-write-wins overwrite), so the meshes that placements
// and hand-tuned colliders were measured against stay exactly as they are.
// The FBX2glTF sibling is self-contained and would save copying the atlas,
// but it is a different export with its own axis/scale conventions — that is
// an asset swap, not a bug fix, so it is not made silently here.
// ---------------------------------------------------------------------------
const FORMAT_DIR = /^(fbx|obj|glb|gltf)( format| \(unity\))?$/i;
const FORMAT_RANK = (dir) => {
  const seg = dir.split(sep).find(s => FORMAT_DIR.test(s)) || '';
  return /^glb/i.test(seg) ? 0 : /^gltf/i.test(seg) ? 1 : seg ? 3 : 2;
};
const byAsset = new Map();
for (const f of files) {
  // Identity = the path with the format-dir segment dropped, so this only
  // ever merges format twins — never two same-named models in different kits.
  const key = [relative(SHELF_DIR, f.dir).split(sep).filter(s => !FORMAT_DIR.test(s)).join('/'), f.nameNoExt].join('/');
  const prev = byAsset.get(key);
  if (!prev || FORMAT_RANK(f.dir) < FORMAT_RANK(prev.dir)) byAsset.set(key, f);
}
files.length = 0;
files.push(...byAsset.values());

// ---------------------------------------------------------------------------
// Parse + group into catalogue entries.
// ---------------------------------------------------------------------------
const entriesByKey = new Map();
for (const f of files) {
  const set = relative(SHELF_DIR, f.dir).split(/[\\/]/)[0];
  const parsed = parseFilename(f.nameNoExt, set);
  const key = [set, parsed.category || '', parsed.family, parsed.season, parsed.state, parsed.extra.slice().sort().join('+')].join('|');
  let entry = entriesByKey.get(key);
  if (!entry) {
    entry = {
      id: key.replace(/\|/g, ':'),
      set, category: parsed.category, family: parsed.family,
      season: parsed.season, state: parsed.state, tags: parsed.tags,
      variants: [],
    };
    entriesByKey.set(key, entry);
  }
  entry.variants.push({ variant: parsed.variant, source: relative(ROOT, f.path) });
}
for (const entry of entriesByKey.values()) entry.variants.sort((a, b) => (a.variant ?? 0) - (b.variant ?? 0));

const entries = [...entriesByKey.values()].sort((a, b) => a.id.localeCompare(b.id));

// ---------------------------------------------------------------------------
// USED subset → copy into world/assets/nature/<set>/<original filename>.
// ---------------------------------------------------------------------------
function isUsed(entry) {
  return USED.some(u => u.set === entry.set && u.family === entry.family && (u.category === undefined ? true : u.category === entry.category));
}

// ---------------------------------------------------------------------------
// Sidecar closure. A .gltf is only half a model — its geometry lives in a
// sibling .bin and its textures in sibling .png/.jpg, referenced by relative
// URI from inside the JSON. Kenney's .glb files carry their geometry inline
// but still point at an external Textures/colormap.png. Copying the model
// alone therefore yields a file that 404s half its content at load time,
// which is the same "served path nothing backs" failure the block below
// exists to prevent — so the sidecars are resolved here and copied as part
// of the model, not left on the shelf.
// ---------------------------------------------------------------------------
function externalUris(modelAbs) {
  let json;
  if (extname(modelAbs).toLowerCase() === '.glb') {
    // GLB container: 12-byte header, then [len:u32][type:u32][data] chunks.
    // The first chunk is always the JSON one.
    const buf = readFileSync(modelAbs);
    json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  } else {
    json = JSON.parse(readFileSync(modelAbs, 'utf8'));
  }
  const uris = [];
  for (const list of [json.buffers, json.images]) {
    for (const item of list || []) {
      // Embedded base64 payloads need no file alongside the model.
      if (item.uri && !item.uri.startsWith('data:')) uris.push(decodeURIComponent(item.uri));
    }
  }
  return [...new Set(uris)];
}

// Catalogue integrity: the catalogue must be structurally incapable of
// lying about what's servable. A `served` path is only ever written once
// the file has actually been copied — if the source that walk() found a
// moment ago has since vanished (deleted, or a symlink that broke), or the
// copy itself fails, that variant is skipped and reported below instead of
// silently getting a `served` path nothing backs.
// A Set, not an array: one texture atlas is a sidecar of many models, so the
// same destination gets written repeatedly and should still be reported once.
const copied = new Set();
const skipped = [];
for (const entry of entries) {
  const used = isUsed(entry);
  entry.used = used;
  if (!used) continue;
  for (const v of entry.variants) {
    const srcAbs = join(ROOT, v.source);
    if (!existsSync(srcAbs)) { skipped.push({ entry: entry.id, variant: v.variant, source: v.source }); continue; }

    // Mirror the shelf's own layout under the set dir instead of flattening
    // it. Flat sets (BIGNature, pirates, ghibli_nature, ...) are unaffected —
    // their path relative to the set root already IS the bare filename. It
    // matters for the nested ones: kenney-models holds four kits that each
    // ship a DIFFERENT Textures/colormap.png, so flattening them would
    // collide four distinct atlases onto one path and paint three of the
    // four kits out of the wrong palette.
    const relFromSet = relative(join(SHELF_DIR, entry.set), srcAbs);
    const destAbs = join(NATURE_OUT, entry.set, relFromSet);
    const srcDir = dirname(srcAbs);

    let sidecars;
    try {
      sidecars = externalUris(srcAbs);
    } catch (e) {
      skipped.push({ entry: entry.id, variant: v.variant, source: v.source, reason: `unreadable (${e.message})` });
      continue;
    }
    // A model missing a buffer or texture is not servable, so it must not get
    // a `served` path — same discipline as a missing source file.
    const absent = sidecars.find(u => !existsSync(join(srcDir, u)));
    if (absent) {
      skipped.push({ entry: entry.id, variant: v.variant, source: v.source, reason: `missing sidecar ${absent}` });
      continue;
    }

    try {
      mkdirSync(dirname(destAbs), { recursive: true });
      copyFileSync(srcAbs, destAbs);
      for (const u of sidecars) {
        const sideDest = join(dirname(destAbs), u);
        mkdirSync(dirname(sideDest), { recursive: true });
        copyFileSync(join(srcDir, u), sideDest);
        copied.add(relative(ROOT, sideDest));
      }
    } catch (e) {
      skipped.push({ entry: entry.id, variant: v.variant, source: v.source, reason: e.message });
      continue;
    }
    v.served = `assets/nature/${entry.set}/${relFromSet.split(sep).join('/')}`;
    copied.add(relative(ROOT, destAbs));
  }
}

// ---------------------------------------------------------------------------
// Write catalogue.json
// ---------------------------------------------------------------------------
mkdirSync(dirname(CATALOGUE_OUT), { recursive: true });
const manifest = {
  generatedAt: new Date().toISOString(),
  sets: [...new Set(entries.map(e => e.set))].sort(),
  entries,
};
writeFileSync(CATALOGUE_OUT, JSON.stringify(manifest, null, 2));

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const tagCounts = {};
for (const e of entries) for (const t of e.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;

console.log(`\nCatalogued ${entries.length} entries (${files.length} source files) across ${manifest.sets.length} sets.`);
console.log(`Written: ${relative(ROOT, CATALOGUE_OUT)}\n`);
console.log('Tag counts:');
for (const [t, n] of Object.entries(tagCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(14)} ${n}`);
console.log(`\nCopied ${copied.size} files into ${relative(ROOT, NATURE_OUT)}/:`);
for (const c of [...copied].sort()) console.log(`  ${c}`);

if (skipped.length) {
  console.log(`\n\x1b[31m\x1b[1mSKIPPED ${skipped.length} used variant(s) — no phantom catalogue entry written:\x1b[0m`);
  for (const s of skipped) console.log(`  ${s.entry} variant ${s.variant ?? ''} -- ${s.source}${s.reason ? ` (${s.reason})` : ' (source not found on disk)'}`);
  console.log(`\x1b[31mRun tools/convert-fbx.mjs against the source FBX to fix, then re-run this script.\x1b[0m`);
  process.exitCode = 1;
} else {
  console.log(`\ncatalogue clean: ${entries.filter(e => e.used).length} used entries, 0 missing`);
}
