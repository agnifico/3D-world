#!/usr/bin/env node
// ---------------------------------------------------------------------------
// partlist-to-edits.mjs — turn a Design part-list JSON into placed[] rows for
// a zone's edits.js, so a kit-bashed building can be viewed and nudged in-game
// with the World Editor that already exists.
//
//   node tools/partlist-to-edits.mjs blacksmith_forge.json --at 40,-20
//   node tools/partlist-to-edits.mjs blacksmith_forge.json --at 40,-20 --rot 1.571 --prefix forge
//
// Options
//   --at X,Z      where the building's floor centre lands in world space (required)
//   --y Y         extra vertical offset (default 0 — the zone's terrainHeight is used
//                 when y is omitted from a row, so 0 means "sit on the ground")
//   --rot R       rotate the whole building about its own origin, radians
//   --prefix P    id prefix for the rows (default: the part list's own id)
//   --locked      emit locked: true so the editor won't grab pieces by accident
//   --validate C  path to catalogue.json; every catalogueId is checked against it
//
// Emits a JSON array. Paste it into the `placed` array of the target zone's
// edits.js. Every row is a normal placed row — the World Editor can select,
// move, rotate and re-export them like anything else.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const file = argv.find(a => !a.startsWith('--'));
const opt = (name, def = null) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? def : argv[i + 1];
};
const flag = name => argv.includes('--' + name);

if (!file) {
  console.error('usage: partlist-to-edits.mjs <partlist.json> --at X,Z [--y Y] [--rot R] [--prefix P] [--locked] [--validate catalogue.json]');
  process.exit(1);
}

const list = JSON.parse(readFileSync(file, 'utf8'));
const parts = list.parts ?? [];
if (!parts.length) { console.error('No `parts` array in ' + file); process.exit(1); }

const at = opt('at');
if (!at) { console.error('--at X,Z is required (where the floor centre goes in world space)'); process.exit(1); }
const [ox, oz] = at.split(',').map(Number);
const oy = Number(opt('y', 0));
const rot = Number(opt('rot', 0));
const prefix = opt('prefix', list.id || 'building');
const locked = flag('locked');

// --- optional catalogue check ----------------------------------------------
let known = null;
const catPath = opt('validate');
if (catPath) {
  known = new Set(JSON.parse(readFileSync(catPath, 'utf8')).entries.map(e => e.id));
}

// --- rotate the building about its own origin, then translate ---------------
const cos = Math.cos(rot), sin = Math.sin(rot);
const round = n => Math.round(n * 1000) / 1000;

const rows = [];
const missing = new Set();

// anchored leaves (doors, opening shutters) are placed too — in-game you want
// to see them; the baked GLB will leave them out.
const all = [
  ...parts.map(p => ({ p, anchor: false })),
  ...(list.anchors ?? []).map(a => ({ p: { ...a, catalogueId: a.part }, anchor: true })),
];

all.forEach(({ p, anchor }, i) => {
  const cid = p.catalogueId;
  if (known && !known.has(cid)) missing.add(cid);

  const lx = p.x ?? 0, lz = p.z ?? 0;
  const wx = ox + lx * cos - lz * sin;
  const wz = oz + lx * sin + lz * cos;

  rows.push({
    id: `${prefix}-${anchor ? 'anchor' : 'p'}${String(i).padStart(2, '0')}`,
    catalogueId: cid,
    variant: null,
    x: round(wx),
    y: round(oy + (p.y ?? 0)),
    z: round(wz),
    rot: [0, round((p.rotY ?? 0) + rot), 0],
    scale: p.scale ?? 1,
    tint: null,
    materialPolicy: null,
    locked,
    collide: 'none',
  });
});

if (missing.size) {
  console.error(`\n${missing.size} catalogueId(s) not in the catalogue:`);
  for (const m of missing) console.error('  ' + m);
  console.error('');
  process.exit(2);
}

console.error(`${rows.length} rows  (${parts.length} parts + ${(list.anchors ?? []).length} anchored)  at ${ox},${oz}${rot ? ` rot ${rot}` : ''}`);
console.log(JSON.stringify(rows, null, 2));
