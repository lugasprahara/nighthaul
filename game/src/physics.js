// Shared physics: circle-vs-box collision on the ground plane, ground
// heights for step-ups and landings, and ray-vs-box tests for bullets and
// lines of sight. Plain math on the solids from mapdata.js; used by the
// player, the bots and the weapons alike.

import { SOLIDS } from './mapdata.js';

export const STEP = 0.62; // tallest ledge a body steps onto without jumping
export const BODY_HEIGHT = 1.78;

// Highest walkable top under (x, z) that a body standing at feetY can use.
export function groundHeightAt(x, z, feetY) {
  let g = 0;
  for (const s of SOLIDS) {
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) {
      if (s.y1 <= feetY + STEP && s.y1 > g) g = s.y1;
    }
  }
  return g;
}

// Push a circle (centre x/z, feet at y, radius r) out of every solid that
// blocks a body of BODY_HEIGHT standing at that height. Mutates and returns
// the {x, z} object passed in.
export function collideCircle(p, y, r) {
  for (const s of SOLIDS) {
    if (s.y1 <= y + STEP) continue; // walkable top, not a wall
    if (s.y0 >= y + BODY_HEIGHT) continue; // overhead (the dock canopy)
    const nx = Math.max(s.x0, Math.min(p.x, s.x1));
    const nz = Math.max(s.z0, Math.min(p.z, s.z1));
    const dx = p.x - nx;
    const dz = p.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      p.x = nx + (dx / d) * r;
      p.z = nz + (dz / d) * r;
    } else {
      // Centre inside the box: leave by the shallowest face.
      const left = p.x - s.x0;
      const right = s.x1 - p.x;
      const top = p.z - s.z0;
      const bottom = s.z1 - p.z;
      const m = Math.min(left, right, top, bottom);
      if (m === left) p.x = s.x0 - r;
      else if (m === right) p.x = s.x1 + r;
      else if (m === top) p.z = s.z0 - r;
      else p.z = s.z1 + r;
    }
  }
  return p;
}

// Move a body: integrate horizontal velocity for dt, resolve collisions,
// then settle the feet on the ground. `body` is {x, y, z, vx, vz, vy,
// grounded}. Gravity and jumping live in the callers; this only keeps the
// body out of walls and on the floor.
export function moveBody(body, dt) {
  body.x += body.vx * dt;
  collideCircle(body, body.y, 0.35);
  body.z += body.vz * dt;
  collideCircle(body, body.y, 0.35);
  const g = groundHeightAt(body.x, body.z, body.y);
  if (body.vy <= 0 && body.y <= g) {
    body.y = g;
    body.vy = 0;
    body.grounded = true;
  } else if (body.y > g + 0.001) {
    body.grounded = false;
  } else {
    body.grounded = true;
  }
}

// Ray vs every solid (3D slab test). o and d are {x, y, z}; d need not be
// normalised but dist is measured in its units. Returns the nearest hit
// { dist, x, y, z, nx, ny, nz } or null.
export function raycastWorld(o, d, maxDist) {
  let best = null;
  for (const s of SOLIDS) {
    let tmin = 0;
    let tmax = maxDist;
    let axis = -1;
    let sign = 0;
    // X slab
    if (Math.abs(d.x) < 1e-9) {
      if (o.x < s.x0 || o.x > s.x1) continue;
    } else {
      let t1 = (s.x0 - o.x) / d.x;
      let t2 = (s.x1 - o.x) / d.x;
      let sg = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sg = 1; }
      if (t1 > tmin) { tmin = t1; axis = 0; sign = sg; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Y slab
    if (Math.abs(d.y) < 1e-9) {
      if (o.y < s.y0 || o.y > s.y1) continue;
    } else {
      let t1 = (s.y0 - o.y) / d.y;
      let t2 = (s.y1 - o.y) / d.y;
      let sg = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sg = 1; }
      if (t1 > tmin) { tmin = t1; axis = 1; sign = sg; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Z slab
    if (Math.abs(d.z) < 1e-9) {
      if (o.z < s.z0 || o.z > s.z1) continue;
    } else {
      let t1 = (s.z0 - o.z) / d.z;
      let t2 = (s.z1 - o.z) / d.z;
      let sg = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sg = 1; }
      if (t1 > tmin) { tmin = t1; axis = 2; sign = sg; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (axis < 0 || tmin > maxDist) continue;
    if (!best || tmin < best.dist) {
      best = {
        dist: tmin,
        x: o.x + d.x * tmin,
        y: o.y + d.y * tmin,
        z: o.z + d.z * tmin,
        nx: axis === 0 ? sign : 0,
        ny: axis === 1 ? sign : 0,
        nz: axis === 2 ? sign : 0,
      };
    }
  }
  return best;
}

// Is the straight line from a to b (both {x, y, z}) free of world geometry?
export function lineOfSight(a, b) {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const dist = Math.hypot(d.x, d.y, d.z);
  if (dist < 1e-6) return true;
  const hit = raycastWorld(a, d, 1);
  return hit === null || hit.dist >= 0.999;
}
