// Visual effects on a strict no-allocation budget: every tracer, spark
// and flash is drawn from pools built once at startup, because effects
// fire in the middle of gunfights where a GC hitch reads as lag.
//
// Smoke is the exception that matters beyond looks: a smoke cloud is
// also a data record in `smokes`, and the bots' vision tests consult it
// (smokeBlocks), so a smoke wall genuinely hides movement.

import * as THREE from 'three';

const PARTICLE_CAP = 900;
const TRACER_POOL = 48;

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  // A blobby puff: several overlapping radial gradients read as one cloud.
  const blobs = [[64, 64, 46], [42, 52, 30], [86, 54, 32], [56, 84, 30], [80, 82, 26]];
  for (const [x, y, r] of blobs) {
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, 'rgba(196,202,208,0.32)');
    g.addColorStop(1, 'rgba(160,166,172,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.tracerLife = 0.055;

    // --- Tracers: stretched additive slivers with a fade-out.
    this.tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
    this.tracers = [];
    for (let i = 0; i < TRACER_POOL; i++) {
      const mesh = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      mesh.visible = false;
      scene.add(mesh);
      this.tracers.push({ mesh, born: -1, life: 0 });
    }
    this.tracerCursor = 0;

    // --- Particles: one Points cloud, CPU-simulated with drag.
    this.pPos = new Float32Array(PARTICLE_CAP * 3);
    this.pCol = new Float32Array(PARTICLE_CAP * 3);
    this.pVel = new Float32Array(PARTICLE_CAP * 3);
    this.pAge = new Float32Array(PARTICLE_CAP).fill(1); // age >= span = dead
    this.pSpan = new Float32Array(PARTICLE_CAP).fill(1);
    this.pGrav = new Float32Array(PARTICLE_CAP);
    this.pCursor = 0;
    for (let i = 0; i < PARTICLE_CAP; i++) this.pPos[i * 3 + 1] = -60;
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(pGeo, new THREE.PointsMaterial({
      size: 0.085, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    // --- Muzzle flash: two crossed additive planes plus a point light.
    this.flashGroup = new THREE.Group();
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffc46b, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const planeGeo = new THREE.PlaneGeometry(0.4, 0.4);
    const pA = new THREE.Mesh(planeGeo, flashMat);
    const pB = new THREE.Mesh(planeGeo, flashMat);
    pB.rotation.y = Math.PI / 2;
    this.flashGroup.add(pA, pB);
    this.flashGroup.visible = false;
    scene.add(this.flashGroup);
    this.flashMat = flashMat;
    this.flashLight = new THREE.PointLight(0xffb36b, 0, 9, 2);
    scene.add(this.flashLight);
    this.flashUntil = 0;

    // --- Explosion fireball.
    this.boomMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0xffa03c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.boomMesh.visible = false;
    scene.add(this.boomMesh);
    this.boomBorn = -1;
    this.boomSpan = 0.28;
    this.boomScale = 5;

    // --- Smoke clouds.
    this.puff = puffTexture();
    this.smokes = [];
  }

  tracer(a, b, color = 0xffd9a0) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.5) return;
    const slot = this.tracers[this.tracerCursor++ % TRACER_POOL];
    slot.mesh.visible = true;
    slot.mesh.material.color.setHex(color);
    slot.mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    slot.mesh.scale.set(1, 1, len);
    slot.mesh.lookAt(b.x, b.y, b.z);
    slot.born = this.time;
    slot.life = this.tracerLife;
  }

  burst(x, y, z, n, color, speed, up, grav) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.pCursor++ % PARTICLE_CAP;
      const i3 = i * 3;
      this.pPos[i3] = x;
      this.pPos[i3 + 1] = y;
      this.pPos[i3 + 2] = z;
      const th = Math.random() * Math.PI * 2;
      const sp = speed * (0.25 + Math.random() * 0.75);
      this.pVel[i3] = Math.cos(th) * sp;
      this.pVel[i3 + 1] = up * (0.35 + Math.random() * 0.9);
      this.pVel[i3 + 2] = Math.sin(th) * sp;
      this.pCol[i3] = c.r;
      this.pCol[i3 + 1] = c.g;
      this.pCol[i3 + 2] = c.b;
      this.pAge[i] = 0;
      this.pSpan[i] = 0.3 + Math.random() * 0.45;
      this.pGrav[i] = grav;
    }
  }

  impact(hit, flesh = false) {
    if (flesh) this.burst(hit.x, hit.y, hit.z, 7, 0x8e2323, 1.1, 0.8, 3.5);
    else this.burst(hit.x, hit.y, hit.z, 6, 0xb8a888, 1.4, 1.1, 4.5);
  }

  muzzle(pos, dir) {
    this.flashGroup.visible = true;
    this.flashGroup.position.set(pos.x, pos.y, pos.z);
    this.flashGroup.lookAt(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z);
    this.flashGroup.rotation.z = Math.random() * Math.PI;
    this.flashMat.opacity = 0.95;
    this.flashLight.position.set(pos.x, pos.y, pos.z);
    this.flashLight.intensity = 14;
    this.flashUntil = this.time + 0.045;
  }

  explosion(pos, big = false) {
    this.boomMesh.visible = true;
    this.boomMesh.position.set(pos.x, pos.y + 0.4, pos.z);
    this.boomScale = big ? 5.2 : 2.6;
    this.boomBorn = this.time;
    this.flashLight.position.set(pos.x, pos.y + 0.6, pos.z);
    this.flashLight.intensity = 60;
    this.flashUntil = this.time + 0.25;
    this.burst(pos.x, pos.y + 0.3, pos.z, big ? 46 : 22, 0xff8c3a, big ? 7 : 4.5, 3.4, 5);
    this.burst(pos.x, pos.y + 0.3, pos.z, 18, 0x55483a, 3, 2.2, 2.5);
  }

  spawnSmoke(x, y, z) {
    const cloud = { x, y: y + 1.1, z, r: 3.1, until: this.time + 13, sprites: [] };
    for (let i = 0; i < 13; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.puff, transparent: true, opacity: 0, depthWrite: false });
      const s = new THREE.Sprite(mat);
      const ang = (i / 13) * Math.PI * 2;
      const rr = (i % 4) * 0.55;
      s.position.set(x + Math.cos(ang) * rr, y + 0.7 + (i % 3) * 0.55, z + Math.sin(ang) * rr);
      s.scale.setScalar(3.6 + (i % 5) * 0.7);
      this.scene.add(s);
      cloud.sprites.push(s);
    }
    this.smokes.push(cloud);
    return cloud;
  }

  update(dt) {
    this.time += dt;

    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      const age = this.time - t.born;
      if (age >= t.life) {
        t.mesh.visible = false;
      } else {
        t.mesh.material.opacity = 0.85 * (1 - age / t.life);
      }
    }

    if (this.flashGroup.visible && this.time > this.flashUntil) {
      this.flashGroup.visible = false;
      this.flashLight.intensity = 0;
    }

    if (this.boomMesh.visible) {
      const age = this.time - this.boomBorn;
      if (age >= this.boomSpan) {
        this.boomMesh.visible = false;
      } else {
        const t = age / this.boomSpan;
        this.boomMesh.scale.setScalar(this.boomScale * (0.5 + t));
        this.boomMesh.material.opacity = 0.9 * (1 - t);
      }
    }

    const drag = Math.max(0, 1 - 1.6 * dt);
    for (let i = 0; i < PARTICLE_CAP; i++) {
      if (this.pAge[i] >= this.pSpan[i]) continue;
      this.pAge[i] += dt;
      const i3 = i * 3;
      if (this.pAge[i] >= this.pSpan[i]) {
        this.pPos[i3 + 1] = -60;
        continue;
      }
      this.pVel[i3] *= drag;
      this.pVel[i3 + 2] *= drag;
      this.pVel[i3 + 1] -= this.pGrav[i] * dt;
      this.pPos[i3] += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;
      if (this.pPos[i3 + 1] < 0.03) this.pPos[i3 + 1] = 0.03;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const cloud = this.smokes[i];
      const remain = cloud.until - this.time;
      if (remain <= 0) {
        for (const s of cloud.sprites) {
          this.scene.remove(s);
          s.material.dispose();
        }
        this.smokes.splice(i, 1);
        continue;
      }
      const target = remain < 2 ? (remain / 2) * 0.66 : 0.66;
      for (const s of cloud.sprites) {
        s.material.opacity += (target - s.material.opacity) * Math.min(1, dt * 2.5);
        s.position.y += dt * 0.05;
        s.position.x += dt * 0.11; // the night breeze pushes smoke east
      }
      cloud.x += dt * 0.11;
    }
  }
}

// Vision test: does the segment a→b pass through the dense core of any
// live smoke cloud?
export function smokeBlocks(a, b, smokes) {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  if (len2 < 1e-6) return false;
  for (const c of smokes) {
    // Closest approach of the segment to the cloud centre.
    let t = ((c.x - a.x) * ab.x + (c.y - a.y) * ab.y + (c.z - a.z) * ab.z) / len2;
    t = Math.min(1, Math.max(0, t));
    const dx = a.x + ab.x * t - c.x;
    const dy = a.y + ab.y * t - c.y;
    const dz = a.z + ab.z * t - c.z;
    const core = c.r * 0.82;
    if (dx * dx + dy * dy + dz * dz < core * core) return true;
  }
  return false;
}

// The breach charge prop: a squat dark case, a keypad that glows teal,
// and the amber beacon the match logic blinks via userData.bulb.
export function makeCharge(mats) {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.34), mats.dark);
  shell.position.y = 0.08;
  shell.castShadow = true;
  group.add(shell);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.04, 0.36), mats.metal);
  trim.position.y = 0.02;
  group.add(trim);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xff3524 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), bulbMat);
  bulb.position.set(0.14, 0.19, 0);
  group.add(bulb);
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.12),
    new THREE.MeshBasicMaterial({ color: 0x2ee6a8 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(-0.08, 0.165, 0);
  group.add(pad);
  group.userData.bulb = bulbMat;
  return group;
}
