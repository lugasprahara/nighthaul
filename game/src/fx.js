// Visual effects, all pooled so the hot loop never allocates: tracers,
// impact particles, muzzle flashes, explosions, smoke clouds and the
// planted charge. Smoke clouds are also data: bots check them when they
// test line of sight, so a smoke genuinely blocks vision.

import * as THREE from 'three';

function smokeTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(200,205,210,0.85)');
  g.addColorStop(0.6, 'rgba(170,176,182,0.45)');
  g.addColorStop(1, 'rgba(160,166,172,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAX_PARTICLES = 900;

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.tracerLife = 0.055;

    // Tracers: thin stretched boxes, additive, gone in a blink.
    this.tracers = [];
    const tGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(tGeo, new THREE.MeshBasicMaterial({
        color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.visible = false;
      scene.add(m);
      this.tracers.push({ mesh: m, until: 0 });
    }
    this.tracerIdx = 0;

    // Particles: one Points cloud, CPU-simulated, pooled.
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pGrav = new Float32Array(MAX_PARTICLES);
    this.pIdx = 0;
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(pGeo, new THREE.PointsMaterial({
      size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < MAX_PARTICLES; i++) this.pPos[i * 3 + 1] = -50;

    // Muzzle flash: one shared flash quad + light, moved to whoever fired.
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.34),
      new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb36b, 0, 9, 2);
    scene.add(this.flashLight);
    this.flashUntil = 0;

    // Smoke clouds: { x, y, z, r, until, sprites[] }.
    this.smokeTex = smokeTexture();
    this.smokes = [];

    // Explosion flash sphere, reused.
    this.boom = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffa03c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.boom.visible = false;
    scene.add(this.boom);
    this.boomUntil = 0;
    this.boomPos = new THREE.Vector3();
  }

  tracer(a, b, color = 0xffd9a0) {
    const t = this.tracers[this.tracerIdx++ % this.tracers.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.5) return;
    t.mesh.visible = true;
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 0.85;
    t.mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    t.mesh.scale.set(1, 1, len);
    t.mesh.lookAt(b.x, b.y, b.z);
    t.until = this.time + this.tracerLife;
  }

  burst(x, y, z, n, color, speed, up, grav) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.pIdx++ % MAX_PARTICLES;
      this.pPos[i * 3] = x;
      this.pPos[i * 3 + 1] = y;
      this.pPos[i * 3 + 2] = z;
      const th = Math.random() * Math.PI * 2;
      const sp = speed * (0.3 + Math.random() * 0.7);
      this.pVel[i * 3] = Math.cos(th) * sp;
      this.pVel[i * 3 + 1] = up * (0.4 + Math.random());
      this.pVel[i * 3 + 2] = Math.sin(th) * sp;
      this.pCol[i * 3] = c.r;
      this.pCol[i * 3 + 1] = c.g;
      this.pCol[i * 3 + 2] = c.b;
      this.pLife[i] = 0.35 + Math.random() * 0.4;
      this.pGrav[i] = grav;
    }
  }

  impact(hit, flesh = false) {
    if (flesh) this.burst(hit.x, hit.y, hit.z, 7, 0x8e2323, 1.1, 0.8, 3.5);
    else this.burst(hit.x, hit.y, hit.z, 6, 0xb8a888, 1.4, 1.1, 4.5);
  }

  muzzle(pos, dir) {
    this.flash.visible = true;
    this.flash.position.set(pos.x, pos.y, pos.z);
    this.flash.lookAt(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z);
    this.flash.material.opacity = 0.95;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flashLight.position.set(pos.x, pos.y, pos.z);
    this.flashLight.intensity = 14;
    this.flashUntil = this.time + 0.045;
  }

  explosion(pos, big = false) {
    this.boom.visible = true;
    this.boom.position.set(pos.x, pos.y + 0.4, pos.z);
    this.boom.scale.setScalar(big ? 5.2 : 2.6);
    this.boom.material.opacity = 0.9;
    this.boomPos.set(pos.x, pos.y, pos.z);
    this.boomUntil = this.time + 0.28;
    this.flashLight.position.set(pos.x, pos.y + 0.6, pos.z);
    this.flashLight.intensity = 60;
    this.flashUntil = this.time + 0.25;
    this.burst(pos.x, pos.y + 0.3, pos.z, big ? 46 : 22, 0xff8c3a, big ? 7 : 4.5, 3.4, 5);
    this.burst(pos.x, pos.y + 0.3, pos.z, 18, 0x55483a, 3, 2.2, 2.5);
  }

  spawnSmoke(x, y, z) {
    const cloud = { x, y: y + 1.1, z, r: 3.1, until: this.time + 13, sprites: [] };
    for (let i = 0; i < 13; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.smokeTex, transparent: true, opacity: 0, depthWrite: false,
      }));
      const a = (i / 13) * Math.PI * 2;
      const rr = (i % 4) * 0.55;
      s.position.set(x + Math.cos(a) * rr, y + 0.7 + (i % 3) * 0.55, z + Math.sin(a) * rr);
      s.scale.setScalar(3.4 + (i % 5) * 0.7);
      this.scene.add(s);
      cloud.sprites.push(s);
    }
    this.smokes.push(cloud);
    return cloud;
  }

  update(dt) {
    this.time += dt;
    for (const t of this.tracers) {
      if (t.mesh.visible && this.time > t.until) t.mesh.visible = false;
    }
    if (this.flash.visible && this.time > this.flashUntil) {
      this.flash.visible = false;
      this.flashLight.intensity = 0;
    }
    if (this.boom.visible) {
      const left = this.boomUntil - this.time;
      if (left <= 0) this.boom.visible = false;
      else this.boom.material.opacity = Math.min(0.9, left * 3.4);
    }
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        this.pPos[i * 3 + 1] = -50;
        continue;
      }
      this.pVel[i * 3 + 1] -= this.pGrav[i] * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      if (this.pPos[i * 3 + 1] < 0.03) this.pPos[i * 3 + 1] = 0.03;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const c = this.smokes[i];
      const remain = c.until - this.time;
      if (remain <= 0) {
        for (const s of c.sprites) {
          this.scene.remove(s);
          s.material.dispose();
        }
        this.smokes.splice(i, 1);
        continue;
      }
      const target = remain < 2 ? remain / 2 * 0.62 : 0.62;
      for (const s of c.sprites) {
        s.material.opacity += (target - s.material.opacity) * Math.min(1, dt * 2.5);
        s.position.y += dt * 0.05;
      }
    }
  }
}

// Does the segment a→b pass through any live smoke cloud's core?
export function smokeBlocks(a, b, smokes) {
  for (const c of smokes) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz;
    if (len2 < 1e-6) continue;
    let t = ((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const dx = a.x + abx * t - c.x;
    const dy = a.y + aby * t - c.y;
    const dz = a.z + abz * t - c.z;
    if (dx * dx + dy * dy + dz * dz < (c.r * 0.82) ** 2) return true;
  }
  return false;
}

// The planted charge: a small dark case with a blinking amber light and a
// keypad glow. Returns a group with a setBlink(rate) helper via userData.
export function makeCharge(mats) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.34), mats.dark);
  body.position.y = 0.08;
  body.castShadow = true;
  g.add(body);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xff3524 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), lightMat);
  bulb.position.set(0.14, 0.19, 0);
  g.add(bulb);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.12), new THREE.MeshBasicMaterial({ color: 0x2ee6a8 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(-0.08, 0.165, 0);
  g.add(pad);
  g.userData.bulb = lightMat;
  return g;
}
