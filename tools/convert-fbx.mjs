#!/usr/bin/env node
// FBX -> GLB conversion, hardened (Track A, catalogue-integrity session).
//
// Why this exists: the shelf's original FBX->GLB pass was an ad hoc terminal
// loop, not a committed script — nothing enforced a per-file exit code, so a
// failure mid-batch just scrolled past in the output and produced a
// half-converted set (no on-disk trace, no manifest, nothing to grep for
// afterward). This replaces that with a script that can be re-run, and that
// is structurally incapable of swallowing a failure: every file is converted
// one at a time, its real child-process exit code is checked, and a
// PASS/FAIL line is appended to conversion-manifest.txt before moving on to
// the next file. The process exits non-zero if anything failed, so it can't
// be mistaken for a clean run by anything (a human OR a script) that only
// glances at the exit code.
//
// Usage:
//   node tools/convert-fbx.mjs <file.fbx> [<file.fbx> ...]
//   node tools/convert-fbx.mjs --dir 3DResources/SomePack       (all .fbx under dir missing a sibling .glb/.gltf)
//   node tools/convert-fbx.mjs --dir 3DResources/SomePack --force   (reconvert even if a sibling already exists)
import { existsSync, appendFileSync, realpathSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MANIFEST = join(__dirname, 'conversion-manifest.txt');

// Same resolution FBX2glTF's own npm wrapper (facebookincubator/FBX2glTF via
// the `fbx2gltf` npm package) uses internally — that package has no `bin`
// entry point of its own (only a `require()`-able JS wrapper) and isn't a
// dependency of this repo, so this script talks to the platform binary
// directly instead of pulling in the wrapper. Override via FBX2GLTF_BIN if
// it lives somewhere else.
function resolveBinary() {
  if (process.env.FBX2GLTF_BIN && existsSync(process.env.FBX2GLTF_BIN)) return process.env.FBX2GLTF_BIN;
  const osDir = { darwin: 'Darwin', linux: 'Linux', win32: 'Windows_NT' }[process.platform];
  const guesses = [
    `/opt/homebrew/lib/node_modules/fbx2gltf/bin/${osDir}/FBX2glTF${process.platform === 'win32' ? '.exe' : ''}`,
    `/usr/local/lib/node_modules/fbx2gltf/bin/${osDir}/FBX2glTF${process.platform === 'win32' ? '.exe' : ''}`,
  ];
  for (const g of guesses) if (existsSync(g)) return g;
  return null;
}

function findFbxUnder(dir, force, out) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { findFbxUnder(full, force, out); continue; }
    if (!e.isFile() || !/\.fbx$/i.test(e.name)) continue;
    const base = full.slice(0, -4);
    if (force || (!existsSync(base + '.glb') && !existsSync(base + '.gltf'))) out.push(full);
  }
}

function convertOne(bin, fbxPath) {
  const destBase = fbxPath.slice(0, -4); // FBX2glTF wants the output path WITHOUT extension; --binary appends .glb itself
  const res = spawnSync(bin, ['--input', fbxPath, '--output', destBase, '--binary'], { encoding: 'utf8' });
  if (res.error) return { ok: false, reason: res.error.message };
  if (res.status !== 0) {
    const tail = (res.stderr || res.stdout || '').trim().split('\n').slice(-3).join(' | ');
    return { ok: false, reason: `exit ${res.status}: ${tail || '<no output>'}` };
  }
  if (!existsSync(destBase + '.glb')) return { ok: false, reason: 'exit 0 but no .glb produced' };
  return { ok: true };
}

function main() {
  const args = process.argv.slice(2);
  const bin = resolveBinary();
  if (!bin) {
    console.error('FBX2glTF binary not found. Install via `npm install -g fbx2gltf` or set FBX2GLTF_BIN to the binary path.');
    process.exit(1);
  }

  let files = [];
  const dirIdx = args.indexOf('--dir');
  const force = args.includes('--force');
  if (dirIdx !== -1) {
    const dir = args[dirIdx + 1];
    if (!dir || !existsSync(dir)) { console.error('--dir target does not exist:', dir); process.exit(1); }
    findFbxUnder(dir, force, files);
  } else {
    files = args.filter(a => a !== '--force');
  }

  if (!files.length) {
    console.log('Nothing to convert (no .fbx files missing a sibling .glb/.gltf).');
    return;
  }

  console.log(`Converting ${files.length} file(s) via ${bin}\n`);
  appendFileSync(MANIFEST, `\n=== run ${new Date().toISOString()} (${files.length} files) ===\n`);

  let pass = 0, fail = 0;
  for (const f of files) {
    const rel = relative(ROOT, realpathSync(f));
    const result = convertOne(bin, f);
    if (result.ok) {
      pass++;
      console.log(`PASS  ${rel}`);
      appendFileSync(MANIFEST, `PASS  ${rel}\n`);
    } else {
      fail++;
      console.log(`FAIL  ${rel} -- ${result.reason}`);
      appendFileSync(MANIFEST, `FAIL  ${rel} -- ${result.reason}\n`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed. Manifest: ${relative(ROOT, MANIFEST)}`);
  if (fail > 0) process.exit(1);
}

main();
