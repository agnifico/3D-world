#!/usr/bin/env node
// ---------------------------------------------------------------------------
// derive-used.mjs — work out which catalogue families the code ACTUALLY
// references, and emit the USED table for tools/catalogue-assets.mjs.
//
// Why: USED is hand-maintained and drifted. It lists eleven scatter-flora
// families and knows nothing about boats, the Xiriya, or anything placed via
// a zone's edits.js. Unlisted families never get copied into world/assets/,
// never get a `served` path, and fall back to 3DResources/ — which works
// locally (the dev server is rooted at the repo root) and 404s on Pages.
//
// Run from the repo root:
//   node tools/derive-used.mjs           # report + printable USED block
//   node tools/derive-used.mjs --write   # splice it into catalogue-assets.mjs (.bak kept)
//
// This only ever ADDS. Existing USED rows are preserved even if nothing
// references them any more — dropping a row would delete a served file that
// something might still reach for, and that is not this script's call.
// ---------------------------------------------------------------------------

import { readdirSync, statSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DERIVE_ROOT || join(__dirname, '..');
const WORLD_DIR = process.env.DERIVE_WORLD || join(ROOT, 'world');
const CATALOGUE = process.env.DERIVE_CATALOGUE || join(WORLD_DIR, 'assets', 'catalogue.json');
const CATALOGUER = join(__dirname, 'catalogue-assets.mjs');
const WRITE = process.argv.includes('--write');

// A catalogueId is  set:category:family:season:state:  with category often
// empty ("BIGNature::BirchTree:normal:alive:"). Set names may contain spaces
// ("Medieval Village") and hyphens ("kenney-models"); families may contain
// underscores and hyphens ("boat-fishing-small", "Wall_Plaster_Straight").
const ID_RE = /['"`]([A-Za-z0-9 _#-]+):([A-Za-z0-9 _#-]*):([A-Za-z0-9 _#-]+):([a-z]*):([a-z]*):['"`]/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (extname(p) === '.js') out.push(p);
  }
  return out;
}

// --- read the catalogue -----------------------------------------------------
if (!existsSync(CATALOGUE)) {
  console.error(`No catalogue at ${CATALOGUE}. Run catalogue-assets.mjs first.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const byId = new Map(manifest.entries.map(e => [e.id, e]));

// --- scan the source --------------------------------------------------------
const refs = new Map();   // catalogueId -> [{file, line}]
for (const file of walk(WORLD_DIR)) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    // skip whole-line comments so dropped zones' commented-out ids don't count
    if (/^\s*(\/\/|\*)/.test(line)) return;
    let m;
    ID_RE.lastIndex = 0;
    while ((m = ID_RE.exec(line)) !== null) {
      const id = `${m[1]}:${m[2]}:${m[3]}:${m[4]}:${m[5]}:`;
      if (!refs.has(id)) refs.set(id, []);
      refs.get(id).push({ file: relative(ROOT, file), line: i + 1 });
    }
  });
}

// --- classify ---------------------------------------------------------------
const known = [], unknown = [];
for (const [id, where] of refs) {
  const entry = byId.get(id);
  (entry ? known : unknown).push({ id, where, entry });
}

// --- existing USED ----------------------------------------------------------
const cataloguerSrc = readFileSync(CATALOGUER, 'utf8');
const usedMatch = cataloguerSrc.match(/const USED = \[([\s\S]*?)\n\];/);
if (!usedMatch) {
  console.error('Could not find `const USED = [ ... ];` in catalogue-assets.mjs.');
  process.exit(1);
}
const existing = [];
for (const m of usedMatch[1].matchAll(/set:\s*'([^']+)',\s*family:\s*'([^']+)'(?:,\s*category:\s*'([^']+)')?/g)) {
  existing.push({ set: m[1], family: m[2], category: m[3] });
}
const key = r => `${r.set}|${r.family}|${r.category ?? ''}`;
const existingKeys = new Set(existing.map(key));

// --- derive rows ------------------------------------------------------------
const derived = new Map();
for (const { entry, where } of known) {
  const row = { set: entry.set, family: entry.family, category: entry.category || undefined };
  const k = key(row);
  if (!derived.has(k)) derived.set(k, { row, where: [], ids: new Set() });
  derived.get(k).where.push(...where);
  derived.get(k).ids.add(entry.id);
}
const added = [...derived.values()].filter(d => !existingKeys.has(key(d.row)));

// --- report -----------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);
console.log(`\nScanned ${walk(WORLD_DIR).length} .js files under ${relative(ROOT, WORLD_DIR)}/`);
console.log(`Found ${refs.size} distinct catalogueId references -> ${derived.size} families.\n`);

console.log(`EXISTING USED rows: ${existing.length}`);
console.log(`ALREADY COVERED:    ${derived.size - added.length}`);
console.log(`MISSING (to add):   ${added.length}\n`);

if (added.length) {
  console.log('--- families referenced by code but NOT in USED -------------------');
  for (const d of added.sort((a, b) => key(a.row).localeCompare(key(b.row)))) {
    const cat = d.row.category ? `${d.row.category}/` : '';
    const files = [...new Set(d.where.map(w => w.file))];
    console.log(`  ${pad(d.row.set + '::' + cat + d.row.family, 46)} <- ${files[0]}${files.length > 1 ? ` (+${files.length - 1} more)` : ''}`);
  }
  console.log('');
}

if (unknown.length) {
  console.log('--- referenced ids NOT PRESENT in catalogue.json ------------------');
  console.log('    (typo, renamed asset, or the shelf changed under the code)\n');
  for (const u of unknown.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  ${pad(u.id, 46)} <- ${u.where[0].file}:${u.where[0].line}`);
  }
  console.log('');
}

// --- emit -------------------------------------------------------------------
const rowLine = (r, note) => {
  const parts = [`set: '${r.set}'`, `family: '${r.family}'`];
  if (r.category) parts.push(`category: '${r.category}'`);
  return `  { ${parts.join(', ')} },${note ? `${' '.repeat(Math.max(1, 58 - parts.join(', ').length))}// ${note}` : ''}`;
};

const allRows = [
  ...existing.map(r => ({ r, note: null })),
  ...added.map(d => ({ r: d.row, note: `derived — ${[...new Set(d.where.map(w => w.file.split('/').slice(-2).join('/')))].slice(0, 2).join(', ')}` })),
];
const block = `const USED = [\n${allRows.map(({ r, note }) => rowLine(r, note)).join('\n')}\n];`;

if (!WRITE) {
  console.log('--- paste this over the USED array in tools/catalogue-assets.mjs ---\n');
  console.log(block);
  console.log('\n(run again with --write to splice it in automatically)\n');
} else {
  copyFileSync(CATALOGUER, CATALOGUER + '.bak');
  writeFileSync(CATALOGUER, cataloguerSrc.replace(/const USED = \[[\s\S]*?\n\];/, block));
  console.log(`Wrote ${added.length} new row(s) into ${relative(ROOT, CATALOGUER)} (backup: catalogue-assets.mjs.bak)`);
  console.log('Now re-run:  node tools/catalogue-assets.mjs\n');
}

if (unknown.length) {
  console.log(`\x1b[31m${unknown.length} referenced id(s) resolve to nothing — fix these before deploying.\x1b[0m\n`);
}
