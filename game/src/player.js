// The human player's controller: mouse look, acceleration-based movement
// with crouch and jump, weapon handling (fire, reload, switch, scope),
// grenade throws and the first-person viewmodel with bob and recoil.

import * as THREE from 'three';
import { WEAPONS, currentSpread } from './weapons.js';
import { moveBody } from './physics.js';

const WALK = 4.6;
const GRAV = 16;
const JUMP_V = 5.6;

function gunMesh(def, mats) {
  // A low-poly gun from boxes, sized per weapon kind. Muzzle at -Z.
  const g = new THREE.Group();
  const dark = mats.dark;
  const metal = mats.metal;
  const add = (w, h, d, x, y, z, mat = dark) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  if (def.kind === 'pistol') {
    add(0.055, 0.09, 0.21, 0, 0.02, -0.08);
    add(0.05, 0.11, 0.07, 0, -0.07, 0.03);
    add(0.02, 0.03, 0.02, 0, 0.085, -0.17, metal);
  } else if (def.kind === 'shotgun') {
    add(0.06, 0.08, 0.52, 0, 0.01, -0.2);
    add(0.055, 0.05, 0.2, 0, -0.045, -0.18, mats.crate);
    add(0.05, 0.1, 0.16, 0, -0.03, 0.14);
  } else if (def.kind === 'smg') {
    add(0.06, 0.09, 0.4, 0, 0.01, -0.14);
    add(0.045, 0.16, 0.06, 0, -0.11, -0.05);
    add(0.05, 0.1, 0.14, 0, -0.03, 0.13);
    add(0.03, 0.04, 0.1, 0, 0.075, -0.1, metal);
  } else if (def.kind === 'sniper') {
    add(0.055, 0.08, 0.78, 0, 0.01, -0.3);
    add(0.02, 0.02, 0.3, 0, 0.02, -0.62, metal);
    add(0.05, 0.06, 0.16, 0, 0.09, -0.12, dark); // scope
    add(0.045, 0.15, 0.06, 0, -0.1, 0.02);
    add(0.05, 0.09, 0.2, 0, -0.02, 0.3);
  } else {
    // rifle
    add(0.06, 0.09, 0.5, 0, 0.01, -0.18);
    add(0.045, 0.17, 0.06, 0, -0.115, -0.04);
    add(0.05, 0.1, 0.17, 0, -0.03, 0.16);
    add(0.025, 0.05, 0.03, 0, 0.085, -0.3, metal);
    add(0.04, 0.04, 0.12, 0, 0.08, 0.02, dark); // carry handle / sight
  }
  return g;
}

export function createPlayerView(camera, mats) {
  const holder = new THREE.Group();
  camera.add(holder);
  let current = null;
  let currentId = null;
  let kick = 0;
  let raise = 1; // 0 just switched, eases to 1
  let bobT = 0;

  return {
    holder,
    setWeapon(def) {
      if (current) holder.remove(current);
      currentId = def ? def.id : null;
      current = def ? gunMesh(def, mats) : null;
      if (current) holder.add(current);
      raise = 0;
    },
    shootKick(def) { kick = Math.min(1, kick + 0.35 + def.recoil * 6); },
    update(dt, actor, moving) {
      if (!current) return;
      raise = Math.min(1, raise + dt * 3.2);
      kick = Math.max(0, kick - dt * 7);
      bobT += dt * (moving ? 8.5 : 0);
      const bobY = moving ? Math.sin(bobT * 2) * 0.008 : 0;
      const bobX = moving ? Math.cos(bobT) * 0.006 : 0;
      const dip = (1 - raise) * -0.24;
      current.position.set(0.235 + bobX, -0.225 + bobY + dip, -0.42 + kick * 0.055);
      current.rotation.set(kick * 0.06 + (1 - raise) * 0.5, 0, 0);
    },
    muzzleWorld(out) {
      if (!current) return null;
      out.set(0.1, 0.03, -0.55);
      return current.localToWorld(out);
    },
    get weaponId() { return currentId; },
  };
}

// Step the player for one fixed simulation tick. `g` is the shared game
// state (time, phase, actors, fx, audio, hud, input, grenades, match).
export function stepPlayer(g, dt) {
  const p = g.player;
  const input = g.input;
  const now = g.time;
  if (!p.alive) return;

  // --- Look (allowed whenever the pointer is locked, even while frozen).
  if (input.locked) {
    const { dx, dy } = input.takeLook();
    p.yaw -= dx * 0.0023;
    p.pitch -= dy * 0.0023;
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
  }

  const frozen = g.match.phase === 'buy';
  const canAct = !frozen && g.match.phase !== 'roundEnd' && g.match.phase !== 'matchEnd';

  // --- Movement.
  p.crouched = input.down('ControlLeft') || input.down('ControlRight') || input.down('KeyC');
  const w = p.weapon();
  const scoped = g.scoped && w && w.def.scope;
  let wishX = 0;
  let wishZ = 0;
  if (input.locked && canAct) {
    const ax = input.moveAxes();
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    // Forward is -Z rotated by yaw: forward = (-sin(yaw)? ) — yaw 0 faces -Z.
    wishX = (ax.x * cos - ax.z * sin);
    wishZ = (-ax.x * sin - ax.z * cos);
    const len = Math.hypot(wishX, wishZ);
    if (len > 1) { wishX /= len; wishZ /= len; }
  }
  let top = WALK * (w ? w.def.moveSpeed : 1) * (p.crouched ? 0.45 : 1) * (scoped ? 0.5 : 1);
  const slow = input.down('ShiftLeft') || input.down('ShiftRight');
  if (slow && !p.crouched) top *= 0.52;
  const rate = p.grounded ? 11 : 1.7;
  const k = Math.min(1, rate * dt);
  p.vx += (wishX * top - p.vx) * k;
  p.vz += (wishZ * top - p.vz) * k;
  if (frozen) { p.vx = 0; p.vz = 0; }

  const wasGrounded = p.grounded;
  const fallV = p.vy;
  if (input.locked && canAct && p.grounded && input.down('Space')) {
    p.vy = JUMP_V;
    p.grounded = false;
    g.audio.jump();
  }
  p.vy -= GRAV * dt;
  moveBody(p, dt);
  if (!wasGrounded && p.grounded && fallV < -3) g.audio.land();
  p.speed2d = Math.hypot(p.vx, p.vz);

  // Footsteps.
  if (p.grounded && p.speed2d > 0.6) {
    g.stepAcc = (g.stepAcc || 0) + p.speed2d * dt;
    const quiet = p.crouched || slow;
    const stride = quiet ? 3.6 : 2.3;
    if (g.stepAcc > stride) {
      g.stepAcc = 0;
      g.audio.footstep(!quiet);
      g.match.noise(p.x, p.z, quiet ? 4 : 10, p);
    }
  }

  // --- Weapon timers.
  p.bloom = Math.max(0, p.bloom - dt * 0.06);
  if (w && p.reloading && now >= p.reloadUntil) {
    const need = w.def.mag - w.mag;
    const take = Math.min(need, w.reserve);
    w.mag += take;
    w.reserve -= take;
    p.reloading = false;
  }
  g.scoped = !!(w && w.def.scope && input.aiming && input.locked && canAct);

  if (!input.locked || !canAct) return;

  // --- Switching.
  if (input.wasPressed('Digit1') && p.primary && p.current !== 'primary') switchTo(g, 'primary');
  if (input.wasPressed('Digit2') && p.sidearm && p.current !== 'sidearm') switchTo(g, 'sidearm');
  if (input.wasPressed('KeyQ')) switchTo(g, p.current === 'primary' ? 'sidearm' : 'primary');

  // --- Grenades: 4/5/6 throw at once toward the crosshair.
  const throwTypes = [['Digit4', 'frag'], ['Digit5', 'flash'], ['Digit6', 'smoke']];
  for (const [code, type] of throwTypes) {
    if (input.wasPressed(code) && p.grenades[type] > 0 && now >= (p.switchUntil || 0)) {
      p.grenades[type]--;
      const dir = lookDir(p);
      dir.y += 0.16;
      g.grenades.throw(p, type, dir);
      g.audio.throwWhoosh();
      p.switchUntil = now + 0.45;
    }
  }

  // --- Reload.
  if (w && input.wasPressed('KeyR')) startReload(g, p);

  // --- Fire.
  if (!w) return;
  const clickedNow = w.def.auto ? false : input.takeClick();
  if (p.reloading || now < (p.switchUntil || 0) || now < p.cycleUntil) return;
  const wantFire = w.def.auto ? input.firing : clickedNow;
  if (!wantFire) return;
  if (now < p.nextShotAt) return;
  if (w.mag <= 0) {
    g.audio.dryFire();
    p.nextShotAt = now + 0.3;
    startReload(g, p);
    return;
  }
  fireWeapon(g, p, w);
}

function switchTo(g, slot) {
  const p = g.player;
  if (!p[slot] || p.current === slot) return;
  p.current = slot;
  p.switchUntil = g.time + 0.32;
  p.reloading = false;
  g.view.setWeapon(p.weapon().def);
}

export function startReload(g, actor) {
  const w = actor.weapon();
  if (!w || w.mag >= w.def.mag || w.reserve <= 0) return;
  if (actor.reloading) return;
  actor.reloadUntil = g.time + w.def.reload;
  actor.reloading = true;
  if (actor.isPlayer) g.audio.reload();
}

export function lookDir(a) {
  const cp = Math.cos(a.pitch);
  return {
    x: -Math.sin(a.yaw) * cp,
    y: Math.sin(a.pitch),
    z: -Math.cos(a.yaw) * cp,
  };
}

// Fire one shot (or one shotgun blast) for any actor; shared by the player
// here and by the bots, so both play by the same gunplay rules.
export function fireWeapon(g, actor, w) {
  const def = w.def;
  const now = g.time;
  w.mag--;
  actor.lastShotAt = now;
  actor.nextShotAt = now + 60 / def.rpm;
  if (def.cycle) actor.cycleUntil = now + def.cycle;
  actor.bloom = Math.min(def.bloomMax, actor.bloom + def.bloom);

  const eye = actor.eyeAt();
  const base = lookDir(actor);
  const spread = currentSpread(def, {
    speed: actor.speed2d,
    grounded: actor.grounded,
    crouched: actor.crouched,
    scoped: actor.isPlayer && g.scoped && !!def.scope,
    bloom: actor.bloom,
  });
  const world = { raycast: (o, d, m) => g.raycastWorld(o, d, m) };

  for (let i = 0; i < def.pellets; i++) {
    const dir = spreadDir(base, spread);
    const res = g.resolveShot(world, g.actors, actor, eye, dir, def, g.fx);
    if (actor.isPlayer && res.hit) {
      g.audio.hit(res.head);
      g.hud.hitmarker(res.head, res.died);
      if (res.died) g.audio.kill();
    }
  }

  // Sound and light: the shooter's own muzzle, quieter with distance for
  // everyone else (bots call this too; the gain split happens here).
  const muzzle = { x: eye.x + base.x * 0.5, y: eye.y - 0.08, z: eye.z + base.z * 0.5 };
  g.fx.muzzle(muzzle, base);
  if (actor.isPlayer) {
    g.audio.shot(def.kind, 1);
    g.view.shootKick(def);
    actor.pitch += def.recoil * (0.75 + Math.random() * 0.5);
    actor.yaw += (Math.random() - 0.5) * def.recoil * 0.35;
  } else {
    const d = Math.hypot(actor.x - g.player.x, actor.z - g.player.z);
    g.audio.shot(def.kind, Math.max(0.05, Math.min(0.8, 9 / (d + 4))));
  }
  g.match.noise(actor.x, actor.z, 26, actor);
}

function spreadDir(base, spread) {
  // Random point in the spread cone around the base direction.
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * spread;
  // Build an orthonormal basis around base.
  const up = Math.abs(base.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const tx = base.y * up.z - base.z * up.y;
  const ty = base.z * up.x - base.x * up.z;
  const tz = base.x * up.y - base.y * up.x;
  const tl = Math.hypot(tx, ty, tz) || 1;
  const ux = tx / tl;
  const uy = ty / tl;
  const uz = tz / tl;
  const vx = base.y * uz - base.z * uy;
  const vy = base.z * ux - base.x * uz;
  const vz = base.x * uy - base.y * ux;
  const ca = Math.cos(a) * r;
  const sa = Math.sin(a) * r;
  const x = base.x + ux * ca + vx * sa;
  const y = base.y + uy * ca + vy * sa;
  const z = base.z + uz * ca + vz * sa;
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}
