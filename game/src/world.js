// Builds the port. Everything three.js in the scene that is not a person
// or an effect is assembled here from mapdata: the ground and its painted
// lines, one box per solid wearing its palette material, instanced
// barrels, floodlight towers, the painted plant sites with their work
// lights, and — beyond the walls — a night sky, a skyline and a crane so
// the yard sits inside a working port.
//
// Light rig: a cold directional moon (the only shadow caster), a dim
// hemisphere fill, and one warm point light over each site so both plant
// spots stay readable in the dark.

import * as THREE from 'three';
import { PAL, sitePaintTexture } from './palette.js';
import { SOLIDS, BARRELS, SITES } from './mapdata.js';

// mapdata's half-crates share the full crate's material.
const MATERIAL_ALIAS = { crateHalf: 'crate' };

function buildSky(group) {
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(300, 28, 14),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: new THREE.Color(PAL.sky) },
        horizon: { value: new THREE.Color(PAL.skyLow) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 zenith;
        uniform vec3 horizon;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y * 1.7, 0.0, 1.0);
          vec3 col = mix(horizon, zenith, pow(h, 0.6));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  group.add(dome);

  // Stars: fixed points on the upper dome, dimmed near the horizon glow.
  const starCount = 420;
  const pos = new Float32Array(starCount * 3);
  let s = 1234567;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < starCount; i++) {
    const az = rnd() * Math.PI * 2;
    const el = 0.12 + rnd() * 1.35;
    const r = 285;
    pos[i * 3] = Math.cos(az) * Math.cos(el) * r;
    pos[i * 3 + 1] = Math.sin(el) * r;
    pos[i * 3 + 2] = Math.sin(az) * Math.cos(el) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xbdd2ea, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.75, fog: false,
  }));
  group.add(stars);

  // The moon: a pale disc high in the south-east.
  const moonDisc = new THREE.Mesh(
    new THREE.CircleGeometry(11, 24),
    new THREE.MeshBasicMaterial({ color: 0xdfe9f5, fog: false }),
  );
  moonDisc.position.set(120, 165, 190);
  moonDisc.lookAt(0, 0, 0);
  group.add(moonDisc);
}

function buildLights(scene) {
  scene.add(new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 0.75));
  const moon = new THREE.DirectionalLight(PAL.moonlight, 1.5);
  moon.position.set(-26, 40, 30);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  Object.assign(moon.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, far: 130 });
  moon.shadow.bias = -0.0006;
  scene.add(moon);
  scene.add(moon.target);
  return moon;
}

function buildGround(group, mats) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(66, 66), mats.asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Worn traffic paint, floating a breath above the asphalt.
  const paint = new THREE.MeshBasicMaterial({ color: PAL.linePaint, transparent: true, opacity: 0.5 });
  const unit = new THREE.PlaneGeometry(1, 1);
  const stripe = (x, z, w, d) => {
    const m = new THREE.Mesh(unit, paint);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, z);
    m.scale.set(w, d, 1);
    group.add(m);
  };
  stripe(0, -24, 0.35, 14);
  stripe(0, 24, 0.35, 12);
  stripe(24, -14, 0.35, 10);
  stripe(-21, -16, 0.35, 10);
  stripe(11, 0, 12, 0.35);
}

function buildSolids(group, mats) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  // Group by material so the scene graph reads like the yard's zones.
  const byMat = new Map();
  for (const s of SOLIDS) {
    const key = MATERIAL_ALIAS[s.mat] ?? s.mat;
    if (!byMat.has(key)) {
      const g = new THREE.Group();
      g.name = `solids:${key}`;
      byMat.set(key, g);
      group.add(g);
    }
    const mesh = new THREE.Mesh(geo, mats[key] ?? mats.concrete);
    mesh.scale.set(s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0);
    mesh.position.set((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2);
    mesh.castShadow = s.y1 > 1;
    mesh.receiveShadow = true;
    byMat.get(key).add(mesh);
  }
}

function buildProps(group, mats) {
  // Barrels as one instanced mesh.
  const barrelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.92, 12);
  const barrels = new THREE.InstancedMesh(barrelGeo, mats.barrel, BARRELS.length);
  const m4 = new THREE.Matrix4();
  BARRELS.forEach(([x, z], i) => {
    m4.makeTranslation(x, 0.46, z);
    barrels.setMatrixAt(i, m4);
  });
  barrels.castShadow = true;
  group.add(barrels);

  // Floodlight towers on the yard's diagonals: pole, crossbar, lamp head.
  // The heads are emissive only — the working light comes from the moon,
  // the hemisphere fill and the site lights.
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 7.5, 8);
  const headGeo = new THREE.BoxGeometry(0.95, 0.3, 0.42);
  for (const [x, z] of [[-14, -14], [14, 14], [-14, 14], [14, -14]]) {
    const pole = new THREE.Mesh(poleGeo, mats.metal);
    pole.position.set(x, 3.75, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(headGeo, mats.lamp);
    head.position.set(x, 7.55, z);
    head.lookAt(0, 7.55, 0);
    group.add(head);
  }
}

function buildSites(group) {
  for (const site of Object.values(SITES)) {
    const tex = sitePaintTexture(site.id, site.id === 'A' ? PAL.siteA : PAL.siteB);
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(site.r * 2, site.r * 2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(site.x, 0.03, site.z);
    group.add(decal);
    const workLight = new THREE.PointLight(site.id === 'A' ? 0xff9a2a : 0xa8d4e6, 26, 19, 1.7);
    workLight.position.set(site.x, 3.6, site.z);
    group.add(workLight);
  }
}

function buildSkyline(group) {
  const sil = new THREE.MeshBasicMaterial({ color: 0x0a121c });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const blocks = [
    [-70, -60, 40, 14, 18], [30, -75, 55, 18, 22], [75, 10, 20, 12, 30],
    [-78, 30, 24, 16, 14], [55, 62, 48, 10, 16], [-40, 72, 60, 12, 20],
  ];
  for (const [x, z, w, h, d] of blocks) {
    const m = new THREE.Mesh(geo, sil);
    m.scale.set(w, h, d);
    m.position.set(x, h / 2, z);
    group.add(m);
  }
  // A gantry crane watching over the north-west corner, mid-lift.
  const crane = new THREE.Group();
  const legGeo = new THREE.BoxGeometry(0.8, 26, 0.8);
  for (const dx of [-9, 9]) {
    const leg = new THREE.Mesh(legGeo, sil);
    leg.position.set(dx, 13, 0);
    crane.add(leg);
  }
  const jib = new THREE.Mesh(new THREE.BoxGeometry(30, 1.2, 1.2), sil);
  jib.position.y = 26;
  crane.add(jib);
  const cable = new THREE.Mesh(new THREE.BoxGeometry(0.12, 5, 0.12), sil);
  cable.position.set(5, 23, 0);
  crane.add(cable);
  const load = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.4), sil);
  load.position.set(5, 19, 0);
  crane.add(load);
  crane.position.set(-58, 0, -48);
  crane.rotation.y = 0.5;
  group.add(crane);
}

export function buildWorld(scene, mats) {
  const group = new THREE.Group();
  scene.add(group);
  scene.fog = new THREE.Fog(PAL.fog, 40, 130);

  buildSky(group);
  const moon = buildLights(scene);
  buildGround(group, mats);
  buildSolids(group, mats);
  buildProps(group, mats);
  buildSites(group);
  buildSkyline(group);

  return { group, moon };
}
