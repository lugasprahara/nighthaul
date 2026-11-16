// Grenade projectiles: thrown arcs with bouncing, then a frag explosion,
// a flash pop or a smoke cloud. Damage and blinding check line of sight,
// so cover genuinely protects you.

import * as THREE from 'three';
import { raycastWorld, lineOfSight } from './physics.js';
import { lookDir } from './player.js';

const FUSE = { frag: 1.5, flash: 1.35, smoke: 1.1 };
const MAT_COLORS = { frag: 0x3a4148, flash: 0xb9c0c7, smoke: 0x4d6b57 };

export function createGrenades(g) {
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const pool = [];
  for (let i = 0; i < 10; i++) {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.5, metalness: 0.4 }));
    mesh.visible = false;
    mesh.castShadow = true;
    g.scene.add(mesh);
    pool.push({ mesh, live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, type: 'frag', owner: null, fuse: 0, bounces: 0 });
  }

  function spawn(actor, type, dir) {
    const n = pool.find((p) => !p.live) ?? pool[0];
    const eye = actor.eyeAt();
    n.live = true;
    n.type = type;
    n.owner = actor;
    n.x = eye.x + dir.x * 0.35;
    n.y = eye.y + dir.y * 0.35;
    n.z = eye.z + dir.z * 0.35;
    const power = 16.5;
    n.vx = dir.x * power + actor.vx * 0.5;
    n.vy = dir.y * power + 2.2;
    n.vz = dir.z * power + actor.vz * 0.5;
    n.fuse = FUSE[type];
    n.bounces = 0;
    n.mesh.material.color.setHex(MAT_COLORS[type]);
    n.mesh.visible = true;
  }

  function explodeFrag(n) {
    const c = { x: n.x, y: n.y + 0.25, z: n.z };
    g.fx.explosion(c, false);
    const dP = Math.hypot(c.x - g.player.x, c.z - g.player.z);
    g.audio.frag(Math.max(0.1, Math.min(1, 10 / (dP + 3))));
    if (dP < 9) g.shake = Math.max(g.shake || 0, 0.35 * (1 - dP / 9));
    for (const a of g.actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - c.x, a.z - c.z);
      if (d > 5.6) continue;
      const chest = { x: a.x, y: a.y + 1.0, z: a.z };
      if (!lineOfSight(c, chest)) continue;
      const dmg = Math.round(6 + 92 * (1 - d / 5.6) ** 1.25);
      a.takeDamage(dmg, { head: false, from: n.owner, weapon: 'frag' });
      if (a.isPlayer) g.audio.hurt();
    }
  }

  function popFlash(n) {
    const c = { x: n.x, y: n.y + 0.2, z: n.z };
    g.fx.explosion(c, false);
    g.fx.burst(c.x, c.y, c.z, 14, 0xffffff, 2.5, 1.2, 1);
    const dP = Math.hypot(c.x - g.player.x, c.z - g.player.z);
    if (dP < 22) g.audio.flashPop();
    for (const a of g.actors) {
      if (!a.alive) continue;
      const eye = a.eyeAt();
      const d = Math.hypot(eye.x - c.x, eye.y - c.y, eye.z - c.z);
      if (d > 20) continue;
      if (!lineOfSight(c, eye)) continue;
      const look = lookDir(a);
      const to = { x: c.x - eye.x, y: c.y - eye.y, z: c.z - eye.z };
      const tl = Math.hypot(to.x, to.y, to.z) || 1;
      const dot = (look.x * to.x + look.y * to.y + look.z * to.z) / tl;
      const range = 1 - d / 20;
      let t = 0;
      if (dot > 0.45) t = 2.9 * range;
      else if (dot > -0.1) t = 1.3 * range;
      else t = 0.45 * range;
      if (t > 0.15) a.blindUntil = Math.max(a.blindUntil, g.time + t);
    }
  }

  function deploySmoke(n) {
    g.fx.spawnSmoke(n.x, 0, n.z);
    g.audio.smokePop();
  }

  return {
    throw: spawn,
    step(dt) {
      for (const n of pool) {
        if (!n.live) continue;
        n.fuse -= dt;
        // Physics in two substeps so fast throws do not tunnel.
        for (let s = 0; s < 2; s++) {
          const h = dt / 2;
          n.vy -= 12.5 * h;
          const from = { x: n.x, y: n.y, z: n.z };
          const delta = { x: n.vx * h, y: n.vy * h, z: n.vz * h };
          const dist = Math.hypot(delta.x, delta.y, delta.z);
          const hit = dist > 1e-5 ? raycastWorld(from, delta, 1) : null;
          if (hit && hit.dist <= 1) {
            n.x = hit.x - delta.x * 0.02;
            n.y = hit.y - delta.y * 0.02;
            n.z = hit.z - delta.z * 0.02;
            const vn = n.vx * hit.nx + n.vy * hit.ny + n.vz * hit.nz;
            if (vn < 0) {
              n.vx -= 1.45 * vn * hit.nx;
              n.vy -= 1.45 * vn * hit.ny;
              n.vz -= 1.45 * vn * hit.nz;
              n.vx *= 0.82;
              n.vy *= 0.82;
              n.vz *= 0.82;
              n.bounces++;
            }
          } else {
            n.x += delta.x;
            n.y += delta.y;
            n.z += delta.z;
          }
          if (n.y < 0.1) {
            n.y = 0.1;
            if (n.vy < 0) n.vy = -n.vy * 0.42;
            n.vx *= 0.78;
            n.vz *= 0.78;
            n.bounces++;
          }
        }
        n.mesh.position.set(n.x, n.y, n.z);
        const speed = Math.hypot(n.vx, n.vy, n.vz);
        if (n.type === 'smoke' && (n.fuse <= 0 || (n.bounces > 0 && speed < 1.1))) {
          deploySmoke(n);
          n.live = false;
          n.mesh.visible = false;
        } else if (n.fuse <= 0) {
          if (n.type === 'frag') explodeFrag(n);
          else if (n.type === 'flash') popFlash(n);
          n.live = false;
          n.mesh.visible = false;
        }
      }
    },
  };
}
