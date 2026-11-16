// Builds the three.js scene for Nighthaul from mapdata.js: ground, every
// solid as a box with its palette material, barrels, floodlights, the two
// painted bomb sites, a night sky dome and a silhouette skyline. Lighting is
// one cold directional moon (with shadows) plus a dim hemisphere fill, with
// sodium work lights over the sites.

import * as THREE from 'three';
import { PAL, sitePaintTexture } from './palette.js';
import { SOLIDS, BARRELS, SITES } from './mapdata.js';

const MAT_FOR = {
  crateHalf: 'crate',
};

export function buildWorld(scene, mats) {
  const group = new THREE.Group();
  scene.add(group);

  scene.fog = new THREE.Fog(PAL.fog, 40, 130);

  // Sky dome: a big inverted sphere with a vertical gradient shader, sodium
  // haze at the horizon and deep blue up top.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(PAL.sky) },
        low: { value: new THREE.Color(PAL.skyLow) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 low; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(low, top, pow(h, 0.65)), 1.0); }',
    }),
  );
  group.add(sky);

  // Lights.
  const hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 0.75);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(PAL.sun, 1.5);
  moon.position.set(-26, 40, 30);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.left = -42;
  moon.shadow.camera.right = 42;
  moon.shadow.camera.top = 42;
  moon.shadow.camera.bottom = -42;
  moon.shadow.camera.far = 130;
  moon.shadow.bias = -0.0006;
  scene.add(moon);
  scene.add(moon.target);

  // Ground.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(66, 66), mats.asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Painted port lines: a centre stripe and crosswalks, thin planes that sit
  // a hair above the asphalt so they never z-fight.
  const lineMat = new THREE.MeshBasicMaterial({ color: PAL.asphaltLine, transparent: true, opacity: 0.5 });
  const lineGeo = new THREE.PlaneGeometry(1, 1);
  function paintLine(x, z, w, d) {
    const m = new THREE.Mesh(lineGeo, lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, z);
    m.scale.set(w, d, 1);
    group.add(m);
  }
  paintLine(0, -24, 0.35, 14);
  paintLine(0, 24, 0.35, 12);
  paintLine(24, -14, 0.35, 10);
  paintLine(-21, -16, 0.35, 10);
  paintLine(11, 0, 12, 0.35);

  // Solids: one box each, palette material per the map data.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const s of SOLIDS) {
    const mat = mats[MAT_FOR[s.mat] ?? s.mat] ?? mats.concrete;
    const m = new THREE.Mesh(boxGeo, mat);
    m.scale.set(s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0);
    m.position.set((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2);
    m.castShadow = s.y1 > 1;
    m.receiveShadow = true;
    group.add(m);
  }

  // Barrels.
  const barrelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.92, 12);
  for (const [x, z] of BARRELS) {
    const b = new THREE.Mesh(barrelGeo, mats.barrel);
    b.position.set(x, 0.46, z);
    b.castShadow = true;
    group.add(b);
  }

  // Floodlight poles at the four corners of the playable area.
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 7.5, 8);
  const headGeo = new THREE.BoxGeometry(0.9, 0.3, 0.4);
  for (const [x, z] of [[-14, -14], [14, 14], [-14, 14], [14, -14]]) {
    const pole = new THREE.Mesh(poleGeo, mats.metal);
    pole.position.set(x, 3.75, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(headGeo, mats.lamp);
    head.position.set(x, 7.5, z);
    head.lookAt(0, 7.5, 0);
    group.add(head);
    // No real light per pole: the emissive heads read as floodlights, and
    // the port is lit by the moon, the hemisphere and the two site lights.
  }

  // Bomb site floor paint: ring + letter, from the site textures.
  for (const s of Object.values(SITES)) {
    const tex = sitePaintTexture(s.id, s.id === 'A' ? PAL.siteA : PAL.siteB);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(s.r * 2, s.r * 2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(s.x, 0.03, s.z);
    group.add(m);
    // A work light over each site: the dock sits under a canopy and the
    // plaza in container shadow, and both must stay readable at night.
    const work = new THREE.PointLight(s.id === 'A' ? 0xff9a2a : 0xa8d4e6, 26, 19, 1.7);
    work.position.set(s.x, 3.6, s.z);
    group.add(work);
  }

  // Distant skyline: dark warehouse silhouettes and a crane outside the
  // walls, so looking outward still reads as a working port at night.
  const silMat = new THREE.MeshBasicMaterial({ color: 0x0a121c });
  const silGeo = new THREE.BoxGeometry(1, 1, 1);
  const skyline = [
    [-70, -60, 40, 14, 18], [30, -75, 55, 18, 22], [75, 10, 20, 12, 30],
    [-78, 30, 24, 16, 14], [55, 62, 48, 10, 16], [-40, 72, 60, 12, 20],
  ];
  for (const [x, z, w, h, d] of skyline) {
    const m = new THREE.Mesh(silGeo, silMat);
    m.scale.set(w, h, d);
    m.position.set(x, h / 2, z);
    group.add(m);
  }
  // Crane: two legs, a jib and a hanging container.
  const crane = new THREE.Group();
  const legGeo = new THREE.BoxGeometry(0.8, 26, 0.8);
  for (const dx of [-9, 9]) {
    const leg = new THREE.Mesh(legGeo, silMat);
    leg.position.set(dx, 13, 0);
    crane.add(leg);
  }
  const jib = new THREE.Mesh(new THREE.BoxGeometry(30, 1.2, 1.2), silMat);
  jib.position.set(0, 26, 0);
  crane.add(jib);
  const hang = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.4), silMat);
  hang.position.set(5, 20, 0);
  crane.add(hang);
  crane.position.set(-58, 0, -48);
  crane.rotation.y = 0.5;
  group.add(crane);

  return { group, moon };
}
