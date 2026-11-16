// The human's body and the gunplay both sides share.
//
// stepPlayer turns input into movement for the player's actor. The
// firing routine lives here too, deliberately: player and bots pull the
// same trigger (fireWeapon / startReload), so a bot's rifle obeys
// exactly the rules the player's does — rate, spread, bloom, cycle time.

import * as THREE from 'three';
import { moveBody } from './physics.js';
import { currentSpread, resolveShot } from './weapons.js';

const WALK_SPEED = 4.6;
const GRAVITY = 16;
const JUMP_VELOCITY = 5.6;

export function lookDir(a) {
  const cp = Math.cos(a.pitch);
  return {
    x: -Math.sin(a.yaw) * cp,
    y: Math.sin(a.pitch),
    z: -Math.cos(a.yaw) * cp,
  };
}

export function startReload(g, actor) {
  const w = actor.weapon();
  if (!w || actor.reloading) return;
  if (w.mag >= w.def.mag || w.reserve <= 0) return;
  actor.reloading = true;
  actor.reloadUntil = g.time + w.def.reload;
  if (actor.isPlayer) g.audio.reload();
}

// Can this actor discharge its weapon right now?
function triggerReady(g, actor) {
  return actor.alive
    && g.match.phase === 'live'
    && !actor.blinded(g.time)
    && g.time >= actor.nextShotAt
    && g.time >= actor.cycleUntil
    && g.time >= actor.switchUntil
    && !actor.reloading;
}

export function fireWeapon(g, actor, w) {
  const def = w.def;
  if (w.mag <= 0) {
    if (actor.isPlayer) g.audio.dryFire();
    actor.nextShotAt = g.time + 0.28;
    startReload(g, actor);
    return false;
  }
  w.mag -= 1;
  actor.lastShotAt = g.time;
  actor.nextShotAt = g.time + 60 / def.rpm;
  if (def.cycle > 0) actor.cycleUntil = g.time + def.cycle;
  actor.bloom = Math.min(def.bloomMax, actor.bloom + def.bloom);

  const scoped = actor.isPlayer && g.scoped && !!def.scope;
  const origin = actor.eyeAt();
  const base = lookDir(actor);
  const spread = currentSpread(def, {
    speed: actor.speed2d,
    grounded: actor.grounded,
    crouched: actor.crouched,
    scoped,
    bloom: actor.bloom,
  });

  // Orthonormal frame around the aim direction, for cone offsets.
  const side = { x: -base.z, y: 0, z: base.x };
  const sl = Math.hypot(side.x, side.z) || 1;
  side.x /= sl;
  side.z /= sl;
  const upv = {
    x: base.y * side.z - base.z * side.y,
    y: base.z * side.x - base.x * side.z,
    z: base.x * side.y - base.y * side.x,
  };

  if (actor.isPlayer) {
    g.view.shootKick(def);
    g.audio.shot(def.kind, 0.9);
    const m = g.view.muzzleWorld(new THREE.Vector3());
    g.fx.muzzle({ x: m.x, y: m.y, z: m.z }, base);
  } else {
    const d = Math.hypot(origin.x - g.player.x, origin.z - g.player.z);
    g.audio.shot(def.kind, Math.max(0.04, Math.min(0.55, 7 / (d + 3))));
    const ahead = {
      x: origin.x + base.x * 0.55,
      y: origin.y - 0.12 + base.y * 0.55,
      z: origin.z + base.z * 0.55,
    };
    g.fx.muzzle(ahead, base);
  }
  g.match.noise(actor.x, actor.z, 26, actor);

  const world = { raycast: g.raycastWorld };
  let anyHit = false;
  let anyHead = false;
  let anyKill = false;
  for (let p = 0; p < def.pellets; p++) {
    const a1 = (Math.random() * 2 - 1) * spread;
    const a2 = (Math.random() * 2 - 1) * spread;
    const dir = {
      x: base.x + side.x * a1 + upv.x * a2,
      y: base.y + side.y * a1 + upv.y * a2,
      z: base.z + side.z * a1 + upv.z * a2,
    };
    const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
    dir.x /= dl;
    dir.y /= dl;
    dir.z /= dl;
    const r = resolveShot(world, g.actors, actor, origin, dir, def, g.fx);
    if (r.hit) {
      anyHit = true;
      anyHead = anyHead || r.head;
      anyKill = anyKill || r.died;
    }
  }
  if (actor.isPlayer && anyHit) {
    g.audio.hit(anyHead);
    g.hud.hitmarker(anyHead, anyKill);
    if (anyKill) g.audio.kill();
  }
  return true;
}

// Pull a pin and throw, if the actor carries that type.
function throwGrenade(g, actor, type) {
  if (g.match.phase !== 'live' || actor.grenades[type] <= 0) return;
  actor.grenades[type] -= 1;
  g.grenades.throw(actor, type, lookDir(actor));
  g.audio.throwWhoosh();
  actor.nextShotAt = Math.max(actor.nextShotAt, g.time + 0.45);
}

// ---------------------------------------------------------------------------
// The view model: a low-poly gun built from boxes, bobbing and kicking in
// the camera's hand. Each weapon class gets its own silhouette.

function gunMesh(kind, mats) {
  const gun = new THREE.Group();
  const body = (w, h, d, x, y, z, mat = mats.dark) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    gun.add(m);
    return m;
  };
  switch (kind) {
    case 'pistol':
      body(0.055, 0.09, 0.21, 0, 0, 0);
      body(0.05, 0.11, 0.06, 0, -0.09, 0.05);
      break;
    case 'shotgun':
      body(0.06, 0.08, 0.62, 0, 0, -0.1);
      body(0.07, 0.07, 0.16, 0, -0.03, -0.28, mats.crate);
      body(0.055, 0.12, 0.07, 0, -0.09, 0.16);
      break;
    case 'smg':
      body(0.06, 0.1, 0.44, 0, 0, -0.05);
      body(0.045, 0.16, 0.05, 0, -0.12, -0.02);
      body(0.05, 0.05, 0.14, 0, 0.02, -0.36, mats.metal);
      break;
    case 'sniper':
      body(0.055, 0.09, 0.78, 0, 0, -0.14);
      body(0.05, 0.07, 0.07, 0, 0.09, -0.1, mats.metal);
      body(0.03, 0.03, 0.2, 0, 0.01, -0.62, mats.metal);
      body(0.05, 0.13, 0.06, 0, -0.1, 0.14);
      break;
    default: // rifle
      body(0.06, 0.1, 0.56, 0, 0, -0.08);
      body(0.05, 0.15, 0.055, 0, -0.12, -0.04);
      body(0.065, 0.06, 0.2, 0, -0.02, -0.2, mats.crate);
      body(0.04, 0.09, 0.04, 0, 0.09, -0.12, mats.metal);
  }
  return gun;
}

export function createPlayerView(camera, mats) {
  const holder = new THREE.Group();
  camera.add(holder);
  let gun = null;
  let bobClock = 0;
  let kick = 0;
  let dip = 0;

  const view = {
    holder,
    weaponId: null,
    setWeapon(def) {
      if (gun) {
        holder.remove(gun);
        gun = null;
      }
      view.weaponId = def ? def.id : null;
      if (!def) return;
      gun = gunMesh(def.kind, mats);
      gun.position.set(0.24, -0.22, -0.45);
      holder.add(gun);
      dip = 1; // a fresh gun rises into view
    },
    shootKick(def) {
      kick = Math.min(0.14, kick + 0.04 + def.recoil * 1.6);
    },
    update(dt, actor, moving) {
      if (moving && actor.grounded) bobClock += dt * actor.speed2d * 1.55;
      kick = Math.max(0, kick - dt * 0.65);
      dip = Math.max(0, dip - dt * 3.2);
      if (gun) {
        const bobY = Math.abs(Math.sin(bobClock)) * 0.016;
        const reloadDip = actor.reloading ? -0.13 : 0;
        gun.position.set(
          0.24 + Math.sin(bobClock) * 0.008,
          -0.22 + bobY + reloadDip - dip * 0.16,
          -0.45 + kick,
        );
        gun.rotation.x = kick * 1.5 + (actor.reloading ? 0.5 : 0) + dip * 0.6;
      }
      return { x: Math.sin(bobClock) * 0.02, y: Math.abs(Math.cos(bobClock)) * 0.024 };
    },
    muzzleWorld(out) {
      if (gun) return gun.localToWorld(out.set(0, 0.03, -0.55));
      return out.set(0, 0, 0);
    },
  };
  return view;
}

// ---------------------------------------------------------------------------
// One tick of human control.

export function stepPlayer(g, dt) {
  const p = g.player;
  const input = g.input;
  const phase = g.match.phase;

  if (!p.alive) {
    p.vx = 0;
    p.vz = 0;
    return;
  }

  // Look. The scope slows the hand; pitch is clamped to sane angles.
  const look = input.takeLook();
  const sens = g.scoped ? 0.00075 : 0.0021;
  p.yaw -= look.dx * sens;
  p.pitch -= look.dy * sens;
  p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
  g.scoped = false;

  const wantCrouch = input.down('ControlLeft') || input.down('KeyC');
  p.crouched = wantCrouch;
  const walking = input.down('ShiftLeft') && !wantCrouch;

  // Movement, expressed in the facing frame then rotated to the world.
  const axes = input.moveAxes();
  const w = p.weapon();
  const pace = WALK_SPEED
    * (w ? w.def.moveSpeed : 1)
    * (wantCrouch ? 0.45 : 1)
    * (walking ? 0.52 : 1)
    * (g.scoped ? 0.45 : 1);
  const len = Math.hypot(axes.x, axes.z) || 1;
  const wishX = axes.x / len;
  const wishZ = axes.z / len;
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  const hasInput = axes.x !== 0 || axes.z !== 0;
  const dirX = hasInput ? (wishX * cos - wishZ * sin) * pace : 0;
  const dirZ = hasInput ? (-wishZ * cos - wishX * sin) * pace : 0;
  const accel = p.grounded ? 11 : 1.7;
  p.vx += (dirX - p.vx) * Math.min(1, accel * dt);
  p.vz += (dirZ - p.vz) * Math.min(1, accel * dt);

  const wasAirborne = !p.grounded;
  const fallSpeed = p.vy;
  p.vy -= GRAVITY * dt;
  if (input.wasPressed('Space') && p.grounded && !wantCrouch) {
    p.vy = JUMP_VELOCITY;
    p.grounded = false;
    g.audio.jump();
  }
  moveBody(p, dt);
  if (wasAirborne && p.grounded) {
    if (fallSpeed < -6) g.audio.land();
    g.shake = Math.max(g.shake || 0, Math.min(0.12, -fallSpeed * 0.012));
  }
  p.speed2d = Math.hypot(p.vx, p.vz);

  // Footsteps, timed to stride length, and loud enough to give away.
  const moving = p.speed2d > 0.6 && p.grounded;
  if (moving) {
    stepPlayer.strideAcc = (stepPlayer.strideAcc || 0) + p.speed2d * dt;
    const stride = walking || wantCrouch ? 3.4 : 2.5;
    if (stepPlayer.strideAcc > stride) {
      stepPlayer.strideAcc = 0;
      g.audio.footstep(!walking && !wantCrouch);
      if (!walking && !wantCrouch) g.match.noise(p.x, p.z, 11, p);
    }
  }

  // Scoped aim: hold right mouse with a scoped rifle.
  if (input.aiming && w && w.def.scope && phase === 'live') g.scoped = true;

  // Weapon switching.
  if (input.wasPressed('Digit1') && p.primary) {
    p.current = 'primary';
    p.switchUntil = g.time + 0.35;
    g.view.setWeapon(p.weapon().def);
  }
  if (input.wasPressed('Digit2')) {
    p.current = 'sidearm';
    p.switchUntil = g.time + 0.35;
    g.view.setWeapon(p.weapon().def);
  }
  if (input.wasPressed('KeyQ')) {
    const other = p.current === 'primary' ? 'sidearm' : 'primary';
    if (other === 'sidearm' || p.primary) {
      p.current = other;
      p.switchUntil = g.time + 0.35;
      g.view.setWeapon(p.weapon().def);
    }
  }

  if (input.wasPressed('KeyR')) startReload(g, p);
  if (p.reloading && g.time >= p.reloadUntil) {
    p.reloading = false;
    const cw = p.weapon();
    const take = Math.min(cw.def.mag - cw.mag, cw.reserve);
    cw.mag += take;
    cw.reserve -= take;
  }

  if (input.wasPressed('Digit3')) throwGrenade(g, p, 'frag');
  if (input.wasPressed('Digit4') || input.wasPressed('KeyF')) throwGrenade(g, p, 'flash');
  if (input.wasPressed('Digit5')) throwGrenade(g, p, 'smoke');

  // The trigger. (The buy menu's B key is the HUD's business.)
  if (phase === 'live' && !g.hud.buyOpen && w && triggerReady(g, p)) {
    if (w.def.auto ? input.firing : input.takeClick()) fireWeapon(g, p, w);
  }

  // Plant / defuse need no code here: the match reads the held E key (and
  // bot intents) itself, so the channel rules live in exactly one place.
}
