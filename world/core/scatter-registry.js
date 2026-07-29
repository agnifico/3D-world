// World Shell — scatter instance registry (World Editor Phase 4, "scatter
// reach"). Maps a raycast hit on a scattered InstancedMesh (the mesh +
// THREE's own per-hit `instanceId`) to the deterministic `Family#NNNN` id
// catalogue-flora.js's sync placement pass assigns (see grassland/lagoon
// catalogue-flora.js's own `nextInstanceId` — placement order, stable
// across rebuilds since the counter advances for every candidate whether
// or not it ends up hidden), and back (id -> which mesh/index/family). A
// multi-part template (e.g. a tree's separate trunk/leaves meshes) yields
// several InstancedMeshes that all share the SAME id list — register each
// part separately; the world-editor doesn't care which part it actually
// raycast-hit, only which logical placement that was.
//
// Zone-agnostic, reset per zone build — same discipline as core/height-
// registry.js et al (main.js's resetForNewZone() equivalent for THIS
// registry is catalogue-flora.js calling resetScatterRegistry() once at
// the top of its own instantiateCatalogueFlora, mirroring how that
// function already owns building the groups this registry describes).
let _byMesh = new Map(); // InstancedMesh -> { family, ids: string[] } (ids[i] is instance i's Family#NNNN)
let _byId = new Map(); // "Family#NNNN" -> { mesh, index, family }

export function resetScatterRegistry() { _byMesh = new Map(); _byId = new Map(); }

export function registerScatterMesh(mesh, family, ids) {
  _byMesh.set(mesh, { family, ids });
  ids.forEach((id, index) => _byId.set(id, { mesh, index, family }));
}

export function resolveScatterHit(mesh, instanceId) {
  const entry = _byMesh.get(mesh);
  if (!entry) return null;
  const id = entry.ids[instanceId];
  return id ? { id, family: entry.family } : null;
}

export function findScatterInstance(id) { return _byId.get(id) || null; }

// Every currently-registered InstancedMesh — what the World Editor raycasts
// against for scatter selection (alongside core/world-edits.js's placed[]
// registry).
export function getScatterMeshes() { return [..._byMesh.keys()]; }

// Every registered mesh belonging to one family — a family-wide override
// (retint, material-policy toggle) touches every part-mesh of every
// variant/season/state group that family currently has on screen, not just
// the one instance that happened to be clicked.
export function getScatterMeshesForFamily(family) {
  return [..._byMesh.entries()].filter(([, v]) => v.family === family).map(([mesh]) => mesh);
}

// Every mesh sharing THIS SPECIFIC instance's id at this SAME numeric index
// — i.e. the other part-meshes of the SAME placement (a tree's trunk vs.
// leaves InstancedMesh), not just anything in the same family. Necessary
// because different groups of one family (Rock:normal vs. Rock:snow, say)
// are separate InstancedMeshes with their OWN independent index space —
// naively touching "index N in every family mesh" would hit an unrelated
// instance in a different group that happens to share that number. Safe
// because ids are family-global (one counter per family, shared across
// every group), so matching on the id itself — not just the index — can
// only ever find true siblings of one placement.
export function getSiblingMeshes(mesh, instanceId) {
  const entry = _byMesh.get(mesh);
  if (!entry) return [];
  const id = entry.ids[instanceId];
  const out = [];
  for (const [m, v] of _byMesh.entries()) {
    if (v.family === entry.family && v.ids[instanceId] === id) out.push(m);
  }
  return out;
}
