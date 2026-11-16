// Shared physics for every body in the port: the player, the bots, and
// the rays their guns fire. The world is a list of axis-aligned boxes
// (mapdata's SOLIDS), so everything here is circle-vs-box on the ground
// plane, step-up heights, and ray-vs-box slab tests. No state is kept:
// callers own their positions and velocities.

import { SOLIDS } from './mapdata.js';

export const STEP = 0.62; // a ledge this high or lower is walked onto, not into
export const BODY_HEIGHT = 1.78; // a standing body's vertical extent

// Does a solid block a body whose feet are at y? Low tops are floors to
// step onto; high bases (the dock canopy) pass overhead.
function blocksBody(s, y) {
  return s.y1 > y + STEP && s.y0 < y + BODY_HEIGHT;
}

// The highest walkable surface under (x, z) for feet currently at feetY.
export function groundHeightAt(x, z, feetY) {
  let top = 0;
  for (const s of SOLIDS) {
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
    if (s.y1 <= feetY + STEP && s.y1 > top) top = s.y1;
  }
  return top;
}

// Resolve a circle (centre p.x/p.z, feet height y, radius r) against every
// blocking solid. Mutates p and returns it.
export function collideCircle(p, y, r) {
  for (const s of SOLIDS) {
    if (!blocksBody(s, y)) continue;
    const nearX = Math.min(Math.max(p.x, s.x0), s.x1);
    const nearZ = Math.min(Math.max(p.z, s.z0), s.z1);
    let dx = p.x - nearX;
    let dz = p.z - nearZ;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-9) {
      const inv = r / Math.sqrt(d2);
      p.x = nearX + dx * inv;
      p.z = nearZ + dz * inv;
      continue;
    }
    // The centre is inside the box footprint: exit through the face that
    // costs the least travel.
    const exits = [
      { cost: p.x - s.x0, apply: () => { p.x = s.x0 - r; } },
      { cost: s.x1 - p.x, apply: () => { p.x = s.x1 + r; } },
      { cost: p.z - s.z0, apply: () => { p.z = s.z0 - r; } },
      { cost: s.z1 - p.z, apply: () => { p.z = s.z1 + r; } },
    ];
    exits.sort((a, b) => a.cost - b.cost)[0].apply();
    dx = 0;
    dz = 0;
  }
  return p;
}

// Advance a body one tick: slide along x, then z (axis separation is what
// lets bodies slip along container faces instead of sticking), then rest
// the feet on the ground. Gravity and jump impulses are the caller's job;
// body is { x, y, z, vx, vy, vz, grounded }.
export function moveBody(body, dt) {
  body.x += body.vx * dt;
  collideCircle(body, body.y, 0.35);
  body.z += body.vz * dt;
  collideCircle(body, body.y, 0.35);

  const floor = groundHeightAt(body.x, body.z, body.y);
  if (body.vy <= 0 && body.y <= floor) {
    body.y = floor;
    body.vy = 0;
    body.grounded = true;
  } else {
    body.grounded = body.y <= floor + 0.001;
  }
}

// One axis of the slab test. Returns [tNear, tFar, nearSign] or null when
// the ray runs parallel outside the slab.
function slab(o, d, lo, hi) {
  if (Math.abs(d) < 1e-9) {
    return o < lo || o > hi ? null : [-Infinity, Infinity, 0];
  }
  const inv = 1 / d;
  let tA = (lo - o) * inv;
  let tB = (hi - o) * inv;
  let sign = -Math.sign(d);
  if (tA > tB) {
    const t = tA;
    tA = tB;
    tB = t;
    sign = -sign;
  }
  return [tA, tB, sign];
}

// Cast a ray against every solid. o and d are {x, y, z}; the returned
// dist is measured in units of d (normalise d to get metres). The hit
// carries the entry point and the face normal.
export function raycastWorld(o, d, maxDist) {
  let hit = null;
  for (const s of SOLIDS) {
    const sx = slab(o.x, d.x, s.x0, s.x1);
    if (!sx) continue;
    const sy = slab(o.y, d.y, s.y0, s.y1);
    if (!sy) continue;
    const sz = slab(o.z, d.z, s.z0, s.z1);
    if (!sz) continue;

    let tNear = 0;
    let axis = -1;
    let sign = 0;
    const axes = [sx, sy, sz];
    for (let i = 0; i < 3; i++) {
      if (axes[i][0] > tNear) {
        tNear = axes[i][0];
        axis = i;
        sign = axes[i][2];
      }
    }
    const tFar = Math.min(sx[1], sy[1], sz[1], maxDist);
    if (axis < 0 || tNear > tFar || tNear > maxDist) continue;
    if (hit && tNear >= hit.dist) continue;
    hit = {
      dist: tNear,
      x: o.x + d.x * tNear,
      y: o.y + d.y * tNear,
      z: o.z + d.z * tNear,
      nx: axis === 0 ? sign : 0,
      ny: axis === 1 ? sign : 0,
      nz: axis === 2 ? sign : 0,
    };
  }
  return hit;
}

// True when nothing solid stands between two points.
export function lineOfSight(a, b) {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  if (Math.hypot(d.x, d.y, d.z) < 1e-6) return true;
  const hit = raycastWorld(a, d, 1);
  return hit === null || hit.dist >= 0.999;
}
