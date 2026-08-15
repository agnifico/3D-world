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
  g.name = "MyProp";

  const group = new THREE.Group();
  group.name = "Group";
  group.position.set(-0.66, 2.979, 0.389);
  group.scale.set(2, 2, 2);
  g.add(group);

  const pillar = new THREE.Group();
  pillar.name = "Pillar";
  pillar.position.set(-0.994, -0.05, 0.011);
  group.add(pillar);

  const cylinderGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 8, 1, false);
  const cylinderMat = new THREE.MeshStandardMaterial({
    color: 0xD8CDB8,
    roughness: 1,
    metalness: 0.3,
    flatShading: true,
    emissive: 0xEBD4A5,
    emissiveIntensity: 0.05,
    side: THREE.DoubleSide
  });
  const cylinder = new THREE.Mesh(cylinderGeo, cylinderMat);
  cylinder.name = "Cylinder";
  cylinder.position.set(-0.131, -0.185, 0);
  cylinder.scale.set(0.9, 0.9, 0.9);
  cylinder.castShadow = true;
  cylinder.receiveShadow = true;
  pillar.add(cylinder);

  const cylinderCopyGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 8, 1, false);
  const cylinderCopyMat = new THREE.MeshStandardMaterial({
    color: 0xD8CDB8,
    roughness: 1,
    metalness: 0.3,
    flatShading: true,
    emissive: 0xEBD4A5,
    emissiveIntensity: 0.05,
    side: THREE.DoubleSide
  });
  const cylinderCopy = new THREE.Mesh(cylinderCopyGeo, cylinderCopyMat);
  cylinderCopy.name = "Cylinder copy";
  cylinderCopy.position.set(-0.181, -0.642, 0);
  cylinderCopy.castShadow = true;
  cylinderCopy.receiveShadow = true;
  pillar.add(cylinderCopy);

  const cylinderCopy2Geo = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 8, 1, false);
  const cylinderCopy2Mat = new THREE.MeshStandardMaterial({
    color: 0xD8CDB8,
    roughness: 1,
    metalness: 0.3,
    flatShading: true,
    emissive: 0xEBD4A5,
    emissiveIntensity: 0.05,
    side: THREE.DoubleSide
  });
  const cylinderCopy2 = new THREE.Mesh(cylinderCopy2Geo, cylinderCopy2Mat);
  cylinderCopy2.name = "Cylinder copy";
  cylinderCopy2.position.set(-0.081, 0.228, 0);
  cylinderCopy2.scale.set(0.8, 0.8, 0.8);
  cylinderCopy2.castShadow = true;
  cylinderCopy2.receiveShadow = true;
  pillar.add(cylinderCopy2);

  const cylinderCopyCopyGeo = new THREE.CylinderGeometry(0.3, 0.5, 0.5, 8, 1, false);
  const cylinderCopyCopyMat = new THREE.MeshStandardMaterial({
    color: 0xD8CDB8,
    roughness: 1,
    metalness: 0.3,
    flatShading: true,
    emissive: 0xEBD4A5,
    emissiveIntensity: 0.05,
    side: THREE.DoubleSide
  });
  const cylinderCopyCopy = new THREE.Mesh(cylinderCopyCopyGeo, cylinderCopyCopyMat);
  cylinderCopyCopy.name = "Cylinder copy copy";
  cylinderCopyCopy.position.set(-0.031, 0.599, 0);
  cylinderCopyCopy.scale.set(0.7, 0.7, 0.7);
  cylinderCopyCopy.castShadow = true;
  cylinderCopyCopy.receiveShadow = true;
  pillar.add(cylinderCopyCopy);

  const cylinderCopyCopy2Geo = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 8, 1, false);
  const cylinderCopyCopy2Mat = new THREE.MeshStandardMaterial({
    color: 0xD8CDB8,
    roughness: 1,
    metalness: 0.3,
    flatShading: true,
    emissive: 0xEBD4A5,
    emissiveIntensity: 0.05,
    side: THREE.DoubleSide
  });
  const cylinderCopyCopy2 = new THREE.Mesh(cylinderCopyCopy2Geo, cylinderCopyCopy2Mat);
  cylinderCopyCopy2.name = "Cylinder copy copy";
  cylinderCopyCopy2.position.set(-0.231, -1.17, -0.021);
  cylinderCopyCopy2.scale.set(1.1, 1.1, 1.1);
  cylinderCopyCopy2.castShadow = true;
  cylinderCopyCopy2.receiveShadow = true;
  pillar.add(cylinderCopyCopy2);

  const group2 = new THREE.Group();
  group2.name = "Group";
  group2.position.set(0.018, -0.33, -0.022);
  group.add(group2);

  const torusGeo = new THREE.TorusGeometry(0.8, 0.3, 8, 22, 6.283);
  const torusMat = new THREE.MeshStandardMaterial({
    color: 0xD8CDB8,
    roughness: 1,
    metalness: 0.3,
    flatShading: true,
    emissive: 0xEBD4A5,
    emissiveIntensity: 0.05,
    side: THREE.DoubleSide
  });
  const torus = new THREE.Mesh(torusGeo, torusMat);
  torus.name = "Torus";
  torus.position.set(-0.034, 0.033, 0.033);
  torus.castShadow = true;
  torus.receiveShadow = true;
  group2.add(torus);

  const planeGeo = new THREE.PlaneGeometry(1.15, 1.15, 1, 1);
  const planeMat = new THREE.MeshStandardMaterial({
    color: 0xD8C48A,
    roughness: 0.85,
    metalness: 0.04,
    flatShading: true,
    transparent: true,
    opacity: 0.78,
    emissive: 0xEBD4A5,
    emissiveIntensity: 0.05,
    side: THREE.DoubleSide
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.name = "Plane";
  plane.position.set(0.034, -0.033, -0.033);
  plane.castShadow = true;
  plane.receiveShadow = true;
  group2.add(plane);

  const pillarCopy = new THREE.Group();
  pillarCopy.name = "Pillar copy";
  pillarCopy.position.set(0.963, -0.05, 0.016);
  pillarCopy.scale.set(-1, 1, 1);
  group.add(pillarCopy);

  const cylinderCopy3Geo = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 8, 1, false);
  const cylinderCopy3Mat = new THREE.MeshStandardMaterial({
    color: 0xD8CDB8,
    roughness: 1,
    metalness: 0.3,
    flatShading: true,
    emissive: 0xEBD4A5,
    emissiveIntensity: 0.05,
    side: THREE.DoubleSide
  });
  const cylinderCopy3 = new THREE.Mesh(cylinderCopy3Geo, cylinderCopy3Mat);
  cylinderCopy3.name = "Cylinder copy";
  cylinderCopy3.position.set(-0.131, -0.185, 0);
  cylinderCopy3.scale.set(0.9, 0.9, 0.9);
  cylinderCopy3.castShadow = true;
  cylinderCopy3.receiveShadow = true;
  pillarCopy.add(cylinderCopy3);

  const cylinderCopyCopy3Geo = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 8, 1, false);
  const cylinderCopyCopy3Mat = new THREE.MeshStandardMaterial({
    color: 0xD8CDB8,
    roughness: 1,
    metalness: 0.3,
    flatShading: true,
    emissive: 0xEBD4A5,
    emissiveIntensity: 0.05,
    side: THREE.DoubleSide
  });
  const cylinderCopyCopy3 = new THREE.Mesh(cylinderCopyCopy3Geo, cylinderCopyCopy3Mat);
  cylinderCopyCopy3.name = "Cylinder copy copy";
  cylinderCopyCopy3.position.set(-0.181, -0.642, 0);
  cylinderCopyCopy3.castShadow = true;
  cylinderCopyCopy3.receiveShadow = true;
  pillarCopy.add(cylinderCopyCopy3);

  const cylinderCopyCopy4Geo = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 8, 1, false);
  const cylinderCopyCopy4Mat = new THREE.MeshStandardMaterial({
    color: 0xD8CDB8,
    roughness: 1,
    metalness: 0.3,
    flatShading: true,
    emissive: 0xEBD4A5,
    emissiveIntensity: 0.05,
    side: THREE.DoubleSide
  });
  const cylinderCopyCopy4 = new THREE.Mesh(cylinderCopyCopy4Geo, cylinderCopyCopy4Mat);
  cylinderCopyCopy4.name = "Cylinder copy copy";
  cylinderCopyCopy4.position.set(-0.081, 0.228, 0);
  cylinderCopyCopy4.scale.set(0.8, 0.8, 0.8);
  cylinderCopyCopy4.castShadow = true;
  cylinderCopyCopy4.receiveShadow = true;
  pillarCopy.add(cylinderCopyCopy4);

  const cylinderCopyCopyCopyGeo = new THREE.CylinderGeometry(0.3, 0.5, 0.5, 8, 1, false);
  const cylinderCopyCopyCopyMat = new THREE.MeshStandardMaterial({
    color: 0xD8CDB8,
    roughness: 1,
    metalness: 0.3,
    flatShading: true,
    emissive: 0xEBD4A5,
    emissiveIntensity: 0.05,
    side: THREE.DoubleSide
  });
  const cylinderCopyCopyCopy = new THREE.Mesh(cylinderCopyCopyCopyGeo, cylinderCopyCopyCopyMat);
  cylinderCopyCopyCopy.name = "Cylinder copy copy copy";
  cylinderCopyCopyCopy.position.set(-0.031, 0.599, 0);
  cylinderCopyCopyCopy.scale.set(0.7, 0.7, 0.7);
  cylinderCopyCopyCopy.castShadow = true;
  cylinderCopyCopyCopy.receiveShadow = true;
  pillarCopy.add(cylinderCopyCopyCopy);

  const cylinderCopyCopyCopy2Geo = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 8, 1, false);
  const cylinderCopyCopyCopy2Mat = new THREE.MeshStandardMaterial({
    color: 0xD8CDB8,
    roughness: 1,
    metalness: 0.3,
    flatShading: true,
    emissive: 0xEBD4A5,
    emissiveIntensity: 0.05,
    side: THREE.DoubleSide
  });
  const cylinderCopyCopyCopy2 = new THREE.Mesh(cylinderCopyCopyCopy2Geo, cylinderCopyCopyCopy2Mat);
  cylinderCopyCopyCopy2.name = "Cylinder copy copy copy";
  cylinderCopyCopyCopy2.position.set(-0.231, -1.17, -0.021);
  cylinderCopyCopyCopy2.scale.set(1.1, 1.1, 1.1);
  cylinderCopyCopyCopy2.castShadow = true;
  cylinderCopyCopyCopy2.receiveShadow = true;
  pillarCopy.add(cylinderCopyCopyCopy2);

  return g;
}

