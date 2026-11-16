// A combatant. The player and every bot are actors: this module owns the
// state they share — body, health, armour, carried weapons, money, score
// line — and the rules that mutate it (round resets, taking damage). The
// controllers (player.js, bots.js) only decide where an actor moves and
// when it shoots; they never reach around these rules.

import { WEAPONS } from './weapons.js';

let issuedIds = 0;

function freshWeapon(id) {
  const def = WEAPONS[id];
  return { def, mag: def.mag, reserve: def.reserve };
}

function refill(w) {
  if (!w) return;
  w.mag = w.def.mag;
  w.reserve = w.def.reserve;
}

export function createActor(team, name, isPlayer = false) {
  const actor = {
    id: ++issuedIds,
    team,
    name,
    isPlayer,

    // Body: feet position plus velocity, the exact shape physics.moveBody
    // integrates. yaw/pitch are the facing (radians; yaw 0 looks along -z).
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    grounded: true,
    yaw: 0,
    pitch: 0,
    crouched: false,
    speed2d: 0,

    // Vitals and kit.
    alive: true,
    hp: 100,
    armor: false,
    helmet: false,
    armorHp: 0,
    money: 800,
    kills: 0,
    deaths: 0,

    // Carried guns, keyed by slot; `current` names the slot in hand.
    primary: null,
    sidearm: null,
    current: 'sidearm',
    grenades: { frag: 0, flash: 0, smoke: 0 },

    // Gunplay clocks (all in g.time seconds).
    bloom: 0,
    lastShotAt: -9,
    nextShotAt: 0,
    reloading: false,
    reloadUntil: 0,
    cycleUntil: 0,
    switchUntil: 0,
    blindUntil: 0,
    lastFrom: null,

    // Wired by match.js: (victim, killer, info) when this actor dies.
    onDeath: null,

    // Actors pose as their own position vector for the physics and
    // raycast helpers.
    get pos() { return this; },

    eyeHeight() { return this.crouched ? 1.18 : 1.62; },
    eyeAt() { return { x: this.x, y: this.y + this.eyeHeight(), z: this.z }; },
    headAt() { return { x: this.x, y: this.y + (this.crouched ? 1.24 : 1.56), z: this.z }; },

    weapon() {
      return this.current === 'primary' ? this.primary : this.sidearm;
    },

    giveWeapon(id) {
      const w = freshWeapon(id);
      if (w.def.slot === 'primary') this.primary = w;
      else this.sidearm = w;
      return w;
    },

    // Strip back to the standard issue: a Nightowl and nothing else.
    resetLoadout() {
      this.primary = null;
      this.sidearm = null;
      this.giveWeapon('nightowl');
      this.current = 'sidearm';
      this.grenades = { frag: 0, flash: 0, smoke: 0 };
      this.armor = false;
      this.helmet = false;
      this.armorHp = 0;
    },

    // Place the actor on its spawn for a new round. Guns and armour carry
    // over (their magazines refill); health and gunplay state do not.
    resetForRound(spawn, faceYaw) {
      this.alive = true;
      this.x = spawn.x;
      this.z = spawn.z;
      this.y = 0;
      this.vx = 0;
      this.vy = 0;
      this.vz = 0;
      this.yaw = faceYaw;
      this.pitch = 0;
      this.crouched = false;
      this.hp = 100;
      this.bloom = 0;
      this.blindUntil = 0;
      this.reloading = false;
      this.reloadUntil = 0;
      this.cycleUntil = 0;
      refill(this.primary);
      refill(this.sidearm);
      if (!this.sidearm) this.giveWeapon('nightowl');
      this.current = this.primary ? 'primary' : 'sidearm';
    },

    // Apply damage; returns true when this hit is the killing one. Kill
    // credit and the death hook run here so every damage source (bullets,
    // frags, falls) scores the same way.
    takeDamage(amount, info = {}) {
      if (!this.alive) return false;
      this.hp -= amount;
      if (info.from) this.lastFrom = info.from;
      if (this.hp > 0) return false;
      this.hp = 0;
      this.alive = false;
      this.deaths += 1;
      const killer = info.from ?? null;
      if (killer && killer !== this) killer.kills += 1;
      if (this.onDeath) this.onDeath(this, killer, info);
      return true;
    },

    blinded(now) { return now < this.blindUntil; },
  };

  actor.resetLoadout();
  return actor;
}
