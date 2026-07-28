// Gallery zone — groups every SERVED catalogue entry (the same 28 used
// entries / 131 variants Grassland and Lagoon place through Brief 9's
// pipeline) into one room per (set,family) pair, so the paginated gallery
// covers exactly what the game could place, one family at a time. Pure data
// derived from catalogue.json — no THREE import — zone.js turns a room's
// slot list into actual placed models.
import { loadCatalogue } from '../../core/catalogue.js';

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
      const byFamily = new Map(); // "set/family" -> room
      for (const entry of manifest.entries) {
        if (!entry.used) continue;
        const key = `${entry.set}/${entry.family}`;
        let room = byFamily.get(key);
        if (!room) { room = { key, set: entry.set, family: entry.family, slots: [] }; byFamily.set(key, room); }
        for (const v of entry.variants) {
          if (!v.served) continue;
          room.slots.push({ name: displayName(entry, v.variant), family: key, served: v.served });
        }
      }
      const rooms = [...byFamily.values()].sort((a, b) => a.key.localeCompare(b.key));
      const totalSlots = rooms.reduce((n, r) => n + r.slots.length, 0);
      console.log(`[gallery] ${rooms.length} rooms, ${totalSlots} served slots total`);
      return rooms;
    });
  }
  return _roomsPromise;
}
