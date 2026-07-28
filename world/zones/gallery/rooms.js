// Gallery zone — groups EVERY catalogue entry (Gallery v4: the full 1,903-
// variant shelf, not just the 131 the game currently serves) into one room
// per (set[,category],family), so a walk through the gallery doubles as a
// curation pass over everything Agni owns, not just what's already in the
// USED list. Pure data derived from catalogue.json — no THREE import —
// zone.js turns a room's slot list into actual placed models.
import { loadCatalogue, servedURL, sourceURL } from '../../core/catalogue.js';

function displayName(entry, variant) {
  const bits = [entry.family];
  if (entry.season && entry.season !== 'normal') bits.push(entry.season);
  if (entry.state && entry.state !== 'alive') bits.push(entry.state);
  if (entry.tags?.includes('moss')) bits.push('moss');
  bits.push(`v${variant}`);
  return bits.join(' ');
}

let _roomsPromise = null;
export function loadRooms() {
  if (!_roomsPromise) {
    _roomsPromise = loadCatalogue().then(manifest => {
      const byFamily = new Map(); // room key -> room
      for (const entry of manifest.entries) {
        // room key includes category only when it's actually needed to tell
        // two same-named families apart (checked against the current
        // manifest: only pirates/Tentacle splits into Characters/Enemy) —
        // every other family stays at the shorter, friendlier "set/family".
        const key = `${entry.set}/${entry.category ? entry.category + '/' : ''}${entry.family}`;
        let room = byFamily.get(key);
        if (!room) room = { key, set: entry.set, category: entry.category, family: entry.family, slots: [], servedCount: 0, shelfCount: 0 };
        byFamily.set(key, room);
        for (const v of entry.variants) {
          const used = !!v.served;
          const loadUrl = used ? servedURL(v.served) : sourceURL(v.source);
          // marksKey: a stable identity string for this exact variant,
          // survives across served/shelf status (a promotion later just
          // adds a `served` path — the marks.js verdict keyed on the
          // source path carries over rather than resetting to unmarked).
          room.slots.push({ name: displayName(entry, v.variant), family: key, used, loadUrl, marksKey: v.served || v.source });
          if (used) room.servedCount++; else room.shelfCount++;
        }
      }
      const rooms = [...byFamily.values()].sort((a, b) => a.key.localeCompare(b.key));
      const totalSlots = rooms.reduce((n, r) => n + r.slots.length, 0);
      const totalServed = rooms.reduce((n, r) => n + r.servedCount, 0);
      console.log(`[gallery] ${rooms.length} rooms, ${totalSlots} slots total (${totalServed} served, ${totalSlots - totalServed} shelf)`);
      return rooms;
    });
  }
  return _roomsPromise;
}
