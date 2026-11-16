// Weapon definitions and the gunplay model. Hitscan with a spread cone:
// standing still and crouched is accurate, moving and spraying is not —
// the spread grows with speed, air time and consecutive shots, and shrinks
// back when you stop. Headshots multiply damage; armour absorbs a share.

export const WEAPONS = {
  nightowl: {
    id: 'nightowl', name: 'Nightowl P9', slot: 'sidearm', price: 0, kind: 'pistol',
    damage: 34, headMult: 2.4, rpm: 380, auto: false, mag: 12, reserve: 48,
    reload: 1.6, range: 42, pellets: 1, moveSpeed: 1.0,
    spreadBase: 0.006, spreadMove: 0.05, spreadAir: 0.09, bloom: 0.010, bloomMax: 0.05,
    recoil: 0.011, cycle: 0,
  },
  gull: {
    id: 'gull', name: 'Gull M870', slot: 'primary', price: 1100, kind: 'shotgun',
    damage: 9, headMult: 1.6, rpm: 68, auto: false, mag: 6, reserve: 24,
    reload: 2.6, range: 16, pellets: 8, moveSpeed: 0.94,
    spreadBase: 0.035, spreadMove: 0.05, spreadAir: 0.07, bloom: 0.0, bloomMax: 0.0,
    recoil: 0.05, cycle: 0.5,
  },
  rook: {
    id: 'rook', name: 'Rook SMG', slot: 'primary', price: 1250, kind: 'smg',
    damage: 26, headMult: 2.0, rpm: 800, auto: true, mag: 32, reserve: 96,
    reload: 2.1, range: 34, pellets: 1, moveSpeed: 1.0,
    spreadBase: 0.011, spreadMove: 0.055, spreadAir: 0.1, bloom: 0.006, bloomMax: 0.045,
    recoil: 0.007, cycle: 0,
  },
  vandal: {
    id: 'vandal', name: 'Vandal AR', slot: 'primary', price: 2700, kind: 'rifle',
    damage: 40, headMult: 2.5, rpm: 600, auto: true, mag: 30, reserve: 90,
    reload: 2.4, range: 60, pellets: 1, moveSpeed: 0.93,
    spreadBase: 0.004, spreadMove: 0.06, spreadAir: 0.11, bloom: 0.008, bloomMax: 0.05,
    recoil: 0.013, cycle: 0,
  },
  osprey: {
    id: 'osprey', name: 'Osprey .338', slot: 'primary', price: 4300, kind: 'sniper',
    damage: 112, headMult: 2.0, rpm: 44, auto: false, mag: 5, reserve: 20,
    reload: 3.1, range: 120, pellets: 1, moveSpeed: 0.88,
    spreadBase: 0.0008, spreadMove: 0.12, spreadAir: 0.16, bloom: 0.0, bloomMax: 0.0,
    recoil: 0.09, cycle: 1.25, scope: 3.2,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag grenade', price: 300 },
  flash: { id: 'flash', name: 'Flashbang', price: 200 },
  smoke: { id: 'smoke', name: 'Smoke grenade', price: 300 },
};

export const ARMOR = {
  vest: { id: 'vest', name: 'Kevlar vest', price: 650 },
  full: { id: 'full', name: 'Vest + helmet', price: 1000 },
};

// Damage after armour: a vest halves body damage, a helmet also cuts head
// damage. Armour wears out as it absorbs hits (durability tracked per actor).
export function armourAdjusted(actor, raw, head) {
  if (!actor.armor || actor.armorHp <= 0) return raw;
  let out = raw;
  if (!head) out = raw * 0.5;
  else if (actor.helmet) out = raw * 0.55;
  else return raw;
  actor.armorHp = Math.max(0, actor.armorHp - (raw - out));
  return out;
}

// Damage falloff with distance (the sniper ignores it).
export function falloff(def, dist) {
  if (def.kind === 'sniper') return 1;
  if (dist <= 16) return 1;
  const t = Math.min(1, (dist - 16) / 46);
  return 1 - t * 0.45;
}

// The spread cone (radians) for a shooter in this state. `bloom` is the
// shooter's accumulated spray penalty from recent shots.
export function currentSpread(def, st) {
  let s = def.spreadBase;
  const speedT = Math.min(1, st.speed / 4.6);
  s += def.spreadMove * speedT * speedT;
  if (!st.grounded) s += def.spreadAir;
  if (st.crouched) s *= 0.62;
  if (st.scoped) s = def.spreadBase * (st.grounded && speedT < 0.05 ? 1 : 14);
  s += st.bloom || 0;
  return s;
}

// One hitscan pellet: find the nearest of (world, enemy heads, enemy
// bodies) along the ray and apply damage. Actors expose headAt()/bodyBox()
// and takeDamage(). fx gets the tracer and impact. Returns a result object.
export function resolveShot(world, actors, shooter, origin, dir, def, fx) {
  const worldHit = world.raycast(origin, dir, def.range + 30);
  const limit = worldHit ? worldHit.dist : def.range + 30;
  let best = null;

  for (const a of actors) {
    if (!a.alive || a === shooter || a.team === shooter.team) continue;
    // Head sphere.
    const h = a.headAt();
    const hx = h.x - origin.x;
    const hy = h.y - origin.y;
    const hz = h.z - origin.z;
    const th = hx * dir.x + hy * dir.y + hz * dir.z;
    if (th > 0 && th < limit) {
      const px = origin.x + dir.x * th - h.x;
      const py = origin.y + dir.y * th - h.y;
      const pz = origin.z + dir.z * th - h.z;
      if (px * px + py * py + pz * pz <= 0.21 * 0.21) {
        if (!best || th < best.dist) best = { actor: a, head: true, dist: th };
      }
    }
    // Body: a vertical capsule approximated by a box test on the ray.
    const cx = a.pos.x - origin.x;
    const cz = a.pos.z - origin.z;
    const tc = cx * dir.x + cz * dir.z;
    if (tc > 0 && tc < limit) {
      const px = origin.x + dir.x * tc;
      const pz = origin.z + dir.z * tc;
      const dx = px - a.pos.x;
      const dz = pz - a.pos.z;
      if (dx * dx + dz * dz <= 0.38 * 0.38) {
        const y = origin.y + dir.y * tc;
        const top = a.pos.y + (a.crouched ? 1.28 : 1.5);
        if (y > a.pos.y + 0.05 && y < top) {
          if (!best || tc < best.dist) best = { actor: a, head: false, dist: tc };
        }
      }
    }
  }

  const endDist = best ? best.dist : limit;
  const end = {
    x: origin.x + dir.x * endDist,
    y: origin.y + dir.y * endDist,
    z: origin.z + dir.z * endDist,
  };
  if (fx) fx.tracer(origin, end, shooter.isPlayer ? 0xffd9a0 : 0xff9a6b);
  if (!best && worldHit && fx) fx.impact(worldHit);
  if (!best) return { hit: false, point: end };

  const raw = def.damage * (best.head ? def.headMult : 1) * falloff(def, best.dist);
  const dealt = Math.max(1, Math.round(armourAdjusted(best.actor, raw, best.head)));
  const died = best.actor.takeDamage(dealt, { head: best.head, from: shooter, weapon: def.id });
  if (fx) fx.impact({ x: end.x, y: end.y, z: end.z, nx: -dir.x, ny: -dir.y, nz: -dir.z }, true);
  return { hit: true, actor: best.actor, head: best.head, damage: dealt, died, point: end, dist: best.dist };
}
