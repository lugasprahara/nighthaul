// One combatant: the human player or a bot. Shared state and rules live
// here (health, armour, weapons carried, money, damage), so the player
// controller and the bot brains only decide movement and shots.

import { WEAPONS } from './weapons.js';

let nextId = 1;

export function createActor(team, name, isPlayer = false) {
  const a = {
    id: nextId++,
    team,
    name,
    isPlayer,
    alive: true,
    // Feet position and velocity (physics.moveBody works on these fields).
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true,
    yaw: 0, pitch: 0,
    crouched: false,
    hp: 100,
    armor: false,
    helmet: false,
    armorHp: 0,
    money: 800,
    kills: 0,
    deaths: 0,
    // Carried weapons: { def, mag, reserve } or null. current = slot name.
    primary: null,
    sidearm: null,
    current: 'sidearm',
    grenades: { frag: 0, flash: 0, smoke: 0 },
    // Gunplay state.
    bloom: 0,
    lastShotAt: -9,
    nextShotAt: 0,
    reloading: false,
    reloadUntil: 0,
    cycleUntil: 0, // bolt/pump weapons cannot fire again before this
    switchUntil: 0,
    speed2d: 0,
    blindUntil: 0,
    // Set by match.js: called with (victim, killer, info) when this dies.
    onDeath: null,

    get pos() { return this; }, // actors double as their position {x, y, z}

    eyeHeight() { return this.crouched ? 1.18 : 1.62; },
    eyeAt() { return { x: this.x, y: this.y + this.eyeHeight(), z: this.z }; },
    headAt() { return { x: this.x, y: this.y + (this.crouched ? 1.24 : 1.56), z: this.z }; },

    weapon() {
      return this.current === 'primary' ? this.primary : this.sidearm;
    },

    giveWeapon(id) {
      const def = WEAPONS[id];
      const w = { def, mag: def.mag, reserve: def.reserve };
      if (def.slot === 'primary') this.primary = w;
      else this.sidearm = w;
      return w;
    },

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
      // Armour and weapons persist between rounds unless resetLoadout ran.
      for (const w of [this.primary, this.sidearm]) {
        if (w) {
          w.mag = w.def.mag;
          w.reserve = w.def.reserve;
        }
      }
      if (!this.sidearm) this.giveWeapon('nightowl');
      this.current = this.primary ? 'primary' : 'sidearm';
    },

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

    // Returns true when this hit killed the actor.
    takeDamage(amount, info = {}) {
      if (!this.alive) return false;
      this.hp -= amount;
      if (info.from) this.lastFrom = info.from;
      if (this.hp > 0) return false;
      this.hp = 0;
      this.alive = false;
      this.deaths++;
      if (info.from && info.from !== this) info.from.kills++;
      if (this.onDeath) this.onDeath(this, info.from ?? null, info);
      return true;
    },

    blinded(now) { return now < this.blindUntil; },
  };
  a.resetLoadout();
  return a;
}
