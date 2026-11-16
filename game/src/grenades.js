// Thrown grenades: a small pool of projectiles that arc, bounce off the
// world, and then do their one job — frag bursts, flash pops, smoke
// blooms. Both damage and blinding are line-of-sight checked, so a
// container wall is real cover from all three.

import * as THREE from 'three';
import { raycastWorld, lineOfSight } from './physics.js';
import { lookDir } from './player.js';

const FUSE_SECONDS = { frag: 1.5, flash: 1.35, smoke: 1.1 };
const SHELL_COLORS = { frag: 0x3a4148, flash: 0xb9c0c7, smoke: 0x4d6b57 };
const THROW_POWER = 16.5;
const GRAVITY = 12.5;
const POOL_SIZE = 10;

class GrenadePool {
  constructor(g) {
    this.g = g;
    const geo = new THREE.SphereGeometry(0.09, 10, 8);
    this.slots = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: SHELL_COLORS.frag, roughness: 0.5, metalness: 0.4,
      }));
      mesh.visible = false;
      mesh.castShadow = true;
      g.scene.add(mesh);
      this.slots.push({
        mesh, live: false, type: 'frag', owner: null,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0, bounces: 0,
      });
    }
  }

  throw(actor, type, dir) {
    const n = this.slots.find((s) => !s.live) ?? this.slots[0];
    const eye = actor.eyeAt();
    n.live = true;
    n.type = type;
    n.owner = actor;
    n.x = eye.x + dir.x * 0.35;
    n.y = eye.y + dir.y * 0.35;
    n.z = eye.z + dir.z * 0.35;
    n.vx = dir.x * THROW_POWER + actor.vx * 0.5;
    n.vy = dir.y * THROW_POWER + 2.2;
    n.vz = dir.z * THROW_POWER + actor.vz * 0.5;
    n.fuse = FUSE_SECONDS[type];
    n.bounces = 0;
    n.mesh.material.color.setHex(SHELL_COLORS[type]);
    n.mesh.visible = true;
  }

  // One integration slice: gravity, then a swept move that reflects off
  // the first surface in the way instead of tunnelling through it.
  integrate(n, h) {
    n.vy -= GRAVITY * h;
    const from = { x: n.x, y: n.y, z: n.z };
    const step = { x: n.vx * h, y: n.vy * h, z: n.vz * h };
    const dist = Math.hypot(step.x, step.y, step.z);
    const hit = dist > 1e-5 ? raycastWorld(from, step, 1) : null;
    if (hit && hit.dist <= 1) {
      n.x = hit.x - step.x * 0.02;
      n.y = hit.y - step.y * 0.02;
      n.z = hit.z - step.z * 0.02;
      const vn = n.vx * hit.nx + n.vy * hit.ny + n.vz * hit.nz;
      if (vn < 0) {
        // Reflect the normal component with losses; scrub some tangent.
        n.vx -= 1.45 * vn * hit.nx;
        n.vy -= 1.45 * vn * hit.ny;
        n.vz -= 1.45 * vn * hit.nz;
        n.vx *= 0.82;
        n.vy *= 0.82;
        n.vz *= 0.82;
        n.bounces += 1;
      }
    } else {
      n.x += step.x;
      n.y += step.y;
      n.z += step.z;
    }
    if (n.y < 0.1) {
      n.y = 0.1;
      if (n.vy < 0) n.vy = -n.vy * 0.42;
      n.vx *= 0.78;
      n.vz *= 0.78;
      n.bounces += 1;
    }
  }

  step(dt) {
    for (const n of this.slots) {
      if (!n.live) continue;
      n.fuse -= dt;
      this.integrate(n, dt / 2);
      this.integrate(n, dt / 2);
      n.mesh.position.set(n.x, n.y, n.z);

      const speed = Math.hypot(n.vx, n.vy, n.vz);
      const settled = n.bounces > 0 && speed < 1.1;
      if (n.type === 'smoke' && (n.fuse <= 0 || settled)) {
        this.detonate(n);
      } else if (n.fuse <= 0) {
        this.detonate(n);
      }
    }
  }

  detonate(n) {
    n.live = false;
    n.mesh.visible = false;
    if (n.type === 'frag') this.burstFrag(n);
    else if (n.type === 'flash') this.popFlash(n);
    else {
      this.g.fx.spawnSmoke(n.x, 0, n.z);
      this.g.audio.smokePop();
    }
  }

  burstFrag(n) {
    const g = this.g;
    const c = { x: n.x, y: n.y + 0.25, z: n.z };
    g.fx.explosion(c, false);
    const dPlayer = Math.hypot(c.x - g.player.x, c.z - g.player.z);
    g.audio.frag(Math.max(0.1, Math.min(1, 10 / (dPlayer + 3))));
    if (dPlayer < 9) g.shake = Math.max(g.shake || 0, 0.35 * (1 - dPlayer / 9));
    for (const a of g.actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - c.x, a.z - c.z);
      if (d > 5.6) continue;
      if (!lineOfSight(c, { x: a.x, y: a.y + 1.0, z: a.z })) continue;
      const dmg = Math.round(6 + 92 * Math.pow(1 - d / 5.6, 1.25));
      a.takeDamage(dmg, { head: false, from: n.owner, weapon: 'frag' });
      if (a.isPlayer) g.audio.hurt();
    }
  }

  popFlash(n) {
    const g = this.g;
    const c = { x: n.x, y: n.y + 0.2, z: n.z };
    g.fx.explosion(c, false);
    g.fx.burst(c.x, c.y, c.z, 14, 0xffffff, 2.5, 1.2, 1);
    if (Math.hypot(c.x - g.player.x, c.z - g.player.z) < 22) g.audio.flashPop();
    for (const a of g.actors) {
      if (!a.alive) continue;
      const eye = a.eyeAt();
      const d = Math.hypot(eye.x - c.x, eye.y - c.y, eye.z - c.z);
      if (d > 20) continue;
      if (!lineOfSight(c, eye)) continue;
      // How directly is this actor looking at the pop?
      const look = lookDir(a);
      const toFlash = { x: c.x - eye.x, y: c.y - eye.y, z: c.z - eye.z };
      const tl = Math.hypot(toFlash.x, toFlash.y, toFlash.z) || 1;
      const facing = (look.x * toFlash.x + look.y * toFlash.y + look.z * toFlash.z) / tl;
      const rangeT = 1 - d / 20;
      const seconds = (facing > 0.45 ? 2.9 : facing > -0.1 ? 1.3 : 0.45) * rangeT;
      if (seconds > 0.15) a.blindUntil = Math.max(a.blindUntil, g.time + seconds);
    }
  }
}

export function createGrenades(g) {
  const pool = new GrenadePool(g);
  return {
    throw: (actor, type, dir) => pool.throw(actor, type, dir),
    step: (dt) => pool.step(dt),
  };
}
