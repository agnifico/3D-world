// Gallery zone — keep/fix/cut verdicts, keyed by served path, persisted to
// localStorage so a judging pass can span multiple short sittings (the
// session brief's explicit ask, confirmed with the user as a sanctioned
// exception to CLAUDE.md's "no localStorage" rule — that rule governs
// runtime game state; this is dev-inspection tooling that never ships).
const STORAGE_KEY = 'gallery-marks';
const CYCLE = ['unmarked', 'keep', 'fix', 'cut'];

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
let marks = load(); // served path -> { verdict, error? }

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(marks)); }
  catch (e) { console.warn('[gallery] could not persist marks:', e.message); }
}

export function getVerdict(served) { return marks[served]?.verdict || 'unmarked'; }
export function getError(served) { return marks[served]?.error; }

// Manual cycle — a no-op on 'loadfail' (nothing to judge on something that
// never rendered); fixing the underlying asset and revisiting the room is
// what clears it, not cycling past it.
export function cycleMark(served) {
  const cur = getVerdict(served);
  if (cur === 'loadfail') return cur;
  const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
  marks[served] = { verdict: next };
  persist();
  return next;
}

export function setLoadFail(served, error) {
  marks[served] = { verdict: 'loadfail', error };
  persist();
}

export function totals(allSlots) {
  const t = { keep: 0, fix: 0, cut: 0, loadfail: 0, unmarked: 0 };
  for (const s of allSlots) t[getVerdict(s.served)]++;
  return t;
}

// ONE file covering every served entry across every room, visited or not —
// unvisited entries simply read 'unmarked' since they were never given a
// verdict.
export function exportAll(allRooms) {
  const out = [];
  for (const room of allRooms) for (const slot of room.slots) {
    const error = getError(slot.served);
    out.push({ name: slot.name, family: slot.family, served: slot.served, verdict: getVerdict(slot.served), ...(error ? { error } : {}) });
  }
  return out;
}
