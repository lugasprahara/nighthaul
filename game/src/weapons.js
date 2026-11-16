// The armoury and the gunplay model.
//
// The table is the game's balance contract — prices, damage, timings —
// and everything else in this module is rules built on it: armour
// absorption, range falloff, the spread cone, and hitscan resolution.
// Fire is hitscan with a cone: planted feet and a crouch shoot straight,
// sprinting or spraying opens the cone up, and every shot blooms it a
// little further until the shooter gives it a moment to settle.

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

// What a hit actually costs the target. A vest halves body shots; the
// helmet in the full kit also blunts headshots. Whatever the armour soaks
// up comes off its durability pool, so gear wears out over a round.
export function armourAdjusted(actor, raw, head) {
  if (!actor.armor || actor.armorHp <= 0) return raw;
  if (head && !actor.helmet) return raw;
  const kept = head ? raw * 0.55 : raw * 0.5;
  actor.armorHp = Math.max(0, actor.armorHp - (raw - kept));
  return kept;
}

// Damage falloff past pistol range; the sniper rifle is exempt.
export function falloff(def, dist) {
  if (def.kind === 'sniper' || dist <= 16) return 1;
  const t = Math.min(1, (dist - 16) / 46);
  return 1 - 0.45 * t;
}

// The half-angle of the spread cone (radians) for a shooter in state st:
// { speed, grounded, crouched, scoped, bloom }.
export function currentSpread(def, st) {
  if (st.scoped) {
    // Through the glass the cone collapses — but only from a settled stance.
    const settled = st.grounded && st.speed < 0.23;
    return def.spreadBase * (settled ? 1 : 14) + (st.bloom || 0);
  }
  let cone = def.spreadBase;
  const speedT = Math.min(1, st.speed / 4.6);
  cone += def.spreadMove * speedT * speedT;
  if (!st.grounded) cone += def.spreadAir;
  if (st.crouched) cone *= 0.62;
  return cone + (st.bloom || 0);
}

const HEAD_R = 0.21;
const BODY_R = 0.38;

// Where does this pellet's ray first meet the target? Checks the head
// sphere, then the torso column. Returns { head, dist } or null.
function rayVsActor(origin, dir, a, limit) {
  const head = a.headAt();
  const hx = head.x - origin.x;
  const hy = head.y - origin.y;
  const hz = head.z - origin.z;
  const tHead = hx * dir.x + hy * dir.y + hz * dir.z;
  if (tHead > 0 && tHead < limit) {
    const missX = origin.x + dir.x * tHead - head.x;
    const missY = origin.y + dir.y * tHead - head.y;
    const missZ = origin.z + dir.z * tHead - head.z;
    if (missX * missX + missY * missY + missZ * missZ <= HEAD_R * HEAD_R) {
      return { head: true, dist: tHead };
    }
  }
  // Torso: project onto the ray in the ground plane, then check the
  // height band the body occupies.
  const cx = a.pos.x - origin.x;
  const cz = a.pos.z - origin.z;
  const tBody = cx * dir.x + cz * dir.z;
  if (tBody <= 0 || tBody >= limit) return null;
  const px = origin.x + dir.x * tBody - a.pos.x;
  const pz = origin.z + dir.z * tBody - a.pos.z;
  if (px * px + pz * pz > BODY_R * BODY_R) return null;
  const y = origin.y + dir.y * tBody;
  const top = a.pos.y + (a.crouched ? 1.28 : 1.5);
  if (y <= a.pos.y + 0.05 || y >= top) return null;
  return { head: false, dist: tBody };
}

// Resolve one hitscan pellet: the nearest of wall, head or body along the
// ray takes it. Damage is applied here; the tracer and impact are handed
// to fx. `world` only needs a raycast(origin, dir, maxDist).
export function resolveShot(world, actors, shooter, origin, dir, def, fx) {
  const wall = world.raycast(origin, dir, def.range + 30);
  const limit = wall ? wall.dist : def.range + 30;

  let victim = null;
  let strike = null;
  for (const a of actors) {
    if (!a.alive || a === shooter || a.team === shooter.team) continue;
    const s = rayVsActor(origin, dir, a, limit);
    if (s && (!strike || s.dist < strike.dist)) {
      victim = a;
      strike = s;
    }
  }

  const endDist = strike ? strike.dist : limit;
  const end = {
    x: origin.x + dir.x * endDist,
    y: origin.y + dir.y * endDist,
    z: origin.z + dir.z * endDist,
  };
  if (fx) fx.tracer(origin, end, shooter.isPlayer ? 0xffd9a0 : 0xff9a6b);
  if (!strike) {
    if (wall && fx) fx.impact(wall);
    return { hit: false, point: end };
  }

  const raw = def.damage * (strike.head ? def.headMult : 1) * falloff(def, strike.dist);
  const dealt = Math.max(1, Math.round(armourAdjusted(victim, raw, strike.head)));
  const died = victim.takeDamage(dealt, { head: strike.head, from: shooter, weapon: def.id });
  if (fx) fx.impact({ x: end.x, y: end.y, z: end.z, nx: -dir.x, ny: -dir.y, nz: -dir.z }, true);
  return { hit: true, actor: victim, head: strike.head, damage: dealt, died, point: end, dist: strike.dist };
}
