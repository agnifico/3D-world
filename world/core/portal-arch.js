// World Shell — shared portal-arch visual. Distinct from Grassland's
// decorative `createRuinedArch()` landmark (assets.js) — that one is a
// walk-through ruin at a fixed hamlet location; this one is the actual
// portal marker, sized wider/taller so a boat can pass under it, meant to
// stand in water at a zone's portal coordinates. Both zones use the same
// factory so a portal reads consistently from either side, without
// scope-creeping into zone-specific content dressing.
import * as THREE from 'three';

const STONE = 0x9a958a, STONE_DARK = 0x857f74;

export function createStoneArch() {
  const g = new THREE.Group();
  const mat = c => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.9 });
  const matStone = mat(STONE), matDark = mat(STONE_DARK);
  // Two pillar stacks, wider apart and taller than the decorative ruined
  // arch so a boat (rowboat/fishing boat scale) can pass between them.
  const PILLAR_X = 3.2, BLOCK_H = 1.05, BLOCKS = 4;
  for (const px of [-PILLAR_X, PILLAR_X]) {
    let y = 0;
    for (let i = 0; i < BLOCKS; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.3 - i * 0.05, BLOCK_H, 1.3 - i * 0.05), matStone);
      b.position.set(px, y + BLOCK_H / 2, 0);
      b.castShadow = b.receiveShadow = true;
      g.add(b);
      y += BLOCK_H;
    }
  }
  // Arch spanning the two pillars, tall enough to clear a small boat's mast/
  // rigging. TorusGeometry's default arc (0..PI, no extra rotation) sweeps
  // +X -> +Y -> -X in its local XY plane — exactly the top-half "doorway"
  // shape connecting the left pillar to the right one over the top.
  const archY = BLOCKS * BLOCK_H + 0.3;
  const arch = new THREE.Mesh(new THREE.TorusGeometry(PILLAR_X + 0.3, 0.55, 6, 12, Math.PI), matDark);
  arch.position.set(0, archY, 0);
  arch.castShadow = arch.receiveShadow = true;
  g.add(arch);
  g.userData.name = 'Stone arch (portal)';
  return g;
}
