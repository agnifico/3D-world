// Gallery zone — keep/fix/cut verdicts, keyed by each variant's stable
// marksKey (its served path if the game already ships it, else its shelf
// source path — see rooms.js), persisted to localStorage so a judging pass
// can span multiple short sittings (the session brief's explicit ask,
// confirmed with the user as a sanctioned exception to CLAUDE.md's "no
// localStorage" rule — that rule governs runtime game state; this is
// dev-inspection tooling that never ships). Keying on the stable path
// (rather than e.g. a served-only path) means a shelf model's "keep" mark
// survives its later promotion into the served/USED set unchanged.
const STORAGE_KEY = 'gallery-marks';
const CYCLE = ['unmarked', 'keep', 'fix', 'cut'];

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
let marks = load(); // marksKey -> { verdict, error? }

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(marks)); }
  catch (e) { console.warn('[gallery] could not persist marks:', e.message); }
}

export function getVerdict(key) { return marks[key]?.verdict || 'unmarked'; }
export function getError(key) { return marks[key]?.error; }

// Manual cycle — a no-op on 'loadfail' (nothing to judge on something that
// never rendered); fixing the underlying asset and revisiting the room is
// what clears it, not cycling past it.
export function cycleMark(key) {
  const cur = getVerdict(key);
  if (cur === 'loadfail') return cur;
  const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
  marks[key] = { verdict: next };
  persist();
  return next;
}

export function setLoadFail(key, error) {
  marks[key] = { verdict: 'loadfail', error };
  persist();
}

export function totals(allSlots) {
  const t = { keep: 0, fix: 0, cut: 0, loadfail: 0, unmarked: 0 };
  for (const s of allSlots) t[getVerdict(s.marksKey)]++;
  return t;
}

// ONE file covering every catalogue variant across every room, visited or
// not (served AND shelf) — unvisited entries simply read 'unmarked' since
// they were never given a verdict. `used`/`loadUrl` (Gallery v4) let a
// later promotion pass tell served-vs-shelf apart and know exactly which
// path a shelf "keep" was actually loaded from.
export function exportAll(allRooms) {
  const out = [];
  for (const room of allRooms) for (const slot of room.slots) {
    const error = getError(slot.marksKey);
    out.push({
      name: slot.name, family: slot.family, served: slot.marksKey, used: slot.used, loadUrl: slot.loadUrl,
      verdict: getVerdict(slot.marksKey), ...(error ? { error } : {}),
    });
  }
  return out;
}
