// Bot brains and bodies. Each bot is an actor plus a small state machine:
// advance along the waypoint graph to an objective, hold an angle, engage
// what it can genuinely see (line of sight, field of view, smoke blocks
// vision), plant or defuse when its team needs it. Bots fire through the
// same fireWeapon path as the player, with human-like reaction time and
// aim error that settles the longer they track a target.

import * as THREE from 'three';
import { findRoute, NODES } from './mapdata.js';
import { lineOfSight, moveBody } from './physics.js';
import { smokeBlocks } from './fx.js';
import { fireWeapon, startReload } from './player.js';

export const BOT_NAMES = {
  sentinel: ['BEACON', 'ANCHOR', 'HARBOR', 'LANTERN'],
  runner: ['TIDAL', 'DRIFT', 'SURGE', 'WAKE', 'KEEL'],
};

const nodeById = new Map(NODES.map((n) => [n.id, n]));

export function botMesh(team, mats) {
  const g = new THREE.Group();
  const suit = team === 'sentinel' ? mats.sentinel : mats.runner;
  const dark = team === 'sentinel' ? mats.sentinelDark : mats.runnerDark;
  const mk = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const legL = mk(0.16, 0.78, 0.2, -0.11, 0.39, 0, dark);
  const legR = mk(0.16, 0.78, 0.2, 0.11, 0.39, 0, dark);
  const torso = mk(0.46, 0.62, 0.26, 0, 1.09, 0, suit);
  const armL = mk(0.11, 0.5, 0.14, -0.3, 1.12, -0.05, dark);
  const armR = mk(0.11, 0.5, 0.14, 0.3, 1.12, -0.05, dark);
  const head = mk(0.24, 0.26, 0.24, 0, 1.56, 0, mats.skin);
  const cap = mk(0.27, 0.09, 0.27, 0, 1.72, 0, dark);
  const gun = mk(0.07, 0.12, 0.62, 0.16, 1.24, -0.3, mats.dark);
  return { group: g, legL, legR, torso, armL, armR, head, cap, gun };
}

let botSeq = 0;

export function createBot(actor, mats) {
  const mesh = botMesh(actor.team, mats);
  const skill = 0.75 + (botSeq % 5) * 0.09; // 0.75 .. 1.11 across the roster
  botSeq++;
  return {
    actor,
    mesh,
    skill,
    reaction: 0.52 - skill * 0.18, // seconds before the first shot
    aimFloor: 0.034 - skill * 0.016, // settled aim error, radians
    state: 'advance',
    route: [],
    routeI: 0,
    objective: null, // {x, z, kind}
    holdNode: null,
    watchYaw: 0,
    target: null, // enemy actor currently visible
    targetSince: 0,
    lastSeen: null, // {x, y, z, at}
    aimErr: 0.1,
    burstLeft: 0,
    nextBurstAt: 0,
    thinkAt: Math.random() * 0.1,
    strafeDir: 1,
    strafeFlipAt: 0,
    stuckT: 0,
    walkPhase: 0,
    deathT: 0,
    intent: null, // 'plant' | 'defuse' | null — read by match.js channels
    heard: null, // {x, z, at} noise to investigate

    reset() {
      this.state = 'advance';
      this.route = [];
      this.routeI = 0;
      this.target = null;
      this.lastSeen = null;
      this.heard = null;
      this.rotateTo = null;
      this.intent = null;
      this.aimErr = 0.1;
      this.burstLeft = 0;
      this.deathT = 0;
      this.mesh.group.rotation.set(0, 0, 0);
      this.mesh.group.visible = true;
    },

    setObjective(x, z, kind) {
      this.objective = { x, z, kind };
      this.route = findRoute(this.actor.x, this.actor.z, x, z);
      this.routeI = 0;
      // A fresh objective always means travelling: leaving 'engage' here is
      // what lets a bot that lost its target start moving again instead of
      // standing frozen with a route it never follows.
      this.state = 'advance';
    },
  };
}

function angleTo(a, x, z) {
  return Math.atan2(-(x - a.x), -(z - a.z));
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnToward(a, wantYaw, wantPitch, dt, rate = 7.5) {
  a.yaw += Math.max(-rate * dt, Math.min(rate * dt, angleDiff(wantYaw, a.yaw)));
  a.pitch += Math.max(-rate * dt, Math.min(rate * dt, wantPitch - a.pitch));
  a.pitch = Math.max(-1.2, Math.min(1.2, a.pitch));
}

// One perception sweep: who can this bot actually see right now?
function perceive(g, bot) {
  const a = bot.actor;
  const now = g.time;
  if (a.blinded(now)) {
    bot.target = null;
    return;
  }
  const eye = a.eyeAt();
  let best = null;
  let bestD = Infinity;
  for (const e of g.actors) {
    if (!e.alive || e.team === a.team) continue;
    const d = Math.hypot(e.x - a.x, e.z - a.z);
    if (d > 72) continue;
    // Field of view: generous cone, plus a small "presence" radius.
    const ang = Math.abs(angleDiff(angleTo(a, e.x, e.z), a.yaw));
    if (ang > 1.65 && d > 4) continue;
    const chest = { x: e.x, y: e.y + 1.15, z: e.z };
    if (!lineOfSight(eye, chest)) continue;
    if (smokeBlocks(eye, chest, g.fx.smokes)) continue;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (best) {
    if (bot.target !== best) {
      bot.target = best;
      bot.targetSince = now;
      bot.engageSince = now;
      bot.aimErr = 0.085 + bestD * 0.0012;
      bot.burstLeft = 0;
    }
    bot.lastSeen = { x: best.x, y: best.y, z: best.z, at: now };
  } else if (bot.target && (!bot.target.alive || now - (bot.lastSeen?.at ?? 0) > 0.3)) {
    bot.target = null;
  }
}

export function stepBot(g, bot, dt) {
  const a = bot.actor;
  const now = g.time;
  const mesh = bot.mesh.group;

  if (!a.alive) {
    // Fall and settle as a corpse until the round resets.
    bot.deathT += dt;
    const t = Math.min(1, bot.deathT * 3.2);
    mesh.rotation.x = -t * Math.PI / 2;
    mesh.position.set(a.x, a.y + 0.12 * t, a.z);
    return;
  }

  mesh.position.set(a.x, a.y, a.z);
  mesh.rotation.y = a.yaw;

  // Reload completion, same rule as the player.
  const w = a.weapon();
  if (w && a.reloading && now >= a.reloadUntil) {
    const take = Math.min(w.def.mag - w.mag, w.reserve);
    w.mag += take;
    w.reserve -= take;
    a.reloading = false;
  }
  a.bloom = Math.max(0, a.bloom - dt * 0.06);

  const frozen = g.match.phase === 'buy';
  const active = !frozen && g.match.phase === 'live';

  // --- Perception on a staggered tick.
  if (now >= bot.thinkAt) {
    bot.thinkAt = now + 0.11 + Math.random() * 0.04;
    if (active) perceive(g, bot);
  }

  let moveX = 0;
  let moveZ = 0;
  let wantSpeed = 0;
  bot.intent = null;

  if (active && !a.blinded(now)) {
    const bomb = g.match.bomb;

    // --- Decide the objective when the situation changes.
    if (bot.target) {
      bot.state = 'engage';
    } else if (bot.state === 'engage') {
      // Lost them: push the last known position, then resume the plan.
      if (bot.lastSeen && now - bot.lastSeen.at < 2.4) {
        bot.setObjective(bot.lastSeen.x, bot.lastSeen.z, 'hunt');
      } else if (a.team === 'runner') {
        bot.setObjective(...runnerGoal(g, bot), 'site');
      } else {
        bot.setObjective(...sentinelGoal(g, bot), bomb.state === 'planted' ? 'bomb' : 'hold');
      }
    }

    if (bot.state !== 'engage') {
      // Team plans come from match.js assignments, refreshed as needed.
      if (!bot.objective || (bot.objective.kind === 'hold' && bomb.state === 'planted' && a.team === 'sentinel')) {
        if (a.team === 'runner') bot.setObjective(...runnerGoal(g, bot), bomb.state === 'planted' ? 'guard' : 'site');
        else bot.setObjective(...sentinelGoal(g, bot), bomb.state === 'planted' ? 'bomb' : 'hold');
      }
      // Follow the route.
      const pt = bot.route[bot.routeI];
      if (pt) {
        const dx = pt.x - a.x;
        const dz = pt.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.8) bot.routeI++;
        else {
          moveX = dx / d;
          moveZ = dz / d;
          wantSpeed = 4.35;
          if (bot.state !== 'hold') turnToward(a, angleTo(a, pt.x, pt.z), 0, dt, 5);
        }
      }
      if (bot.routeI >= bot.route.length && bot.objective) {
        // Arrived: settle into the role the objective implies.
        const dObj = Math.hypot(bot.objective.x - a.x, bot.objective.z - a.z);
        if (dObj < 2.2) {
          if (bot.objective.kind === 'site' && a.team === 'runner' && g.match.carrier === a && bomb.state === 'carried') {
            bot.intent = 'plant';
            bot.state = 'plant';
            turnToward(a, bot.watchYaw, 0, dt, 4);
          } else if (bot.objective.kind === 'bomb' && bomb.state === 'planted' && g.match.defuser === a) {
            bot.intent = 'defuse';
            bot.state = 'defuse';
            turnToward(a, angleTo(a, bomb.x, bomb.z), 0, dt, 4);
          } else if (bot.objective.kind === 'hunt') {
            // Reached the last known position and found nothing: re-plan.
            bot.objective = null;
            bot.state = 'advance';
          } else {
            bot.state = 'hold';
            turnToward(a, bot.watchYaw, 0, dt, 2.5);
            // Small reposition shuffle so holds do not look frozen.
            if (Math.random() < dt * 0.25) {
              bot.watchYaw += (Math.random() - 0.5) * 0.7;
            }
          }
        }
      }
    }

    // --- Combat.
    if (bot.state === 'engage' && bot.target && bot.target.alive) {
      const t = bot.target;
      const dist = Math.hypot(t.x - a.x, t.z - a.z);
      const aimY = Math.random() < 0.3 ? t.headAt() : { x: t.x, y: t.y + 1.15, z: t.z };
      const eye = a.eyeAt();
      const wantYaw = angleTo(a, aimY.x, aimY.z);
      const wantPitch = Math.atan2(aimY.y - eye.y, Math.max(0.001, Math.hypot(aimY.x - eye.x, aimY.z - eye.z)));
      turnToward(a, wantYaw, wantPitch, dt, 6.5);
      bot.aimErr = Math.max(bot.aimFloor, bot.aimErr - dt * 0.055);

      // Is the shot actually clear, or is only a sliver of the target
      // visible past a corner? Test two offset rays at chest height: if
      // neither clears, the bot pushes in instead of plinking at a wall.
      const perpX = Math.cos(a.yaw);
      const perpZ = -Math.sin(a.yaw);
      const chestL = { x: t.x + perpX * 0.3, y: t.y + 1.15, z: t.z + perpZ * 0.3 };
      const chestR = { x: t.x - perpX * 0.3, y: t.y + 1.15, z: t.z - perpZ * 0.3 };
      const clearShot = lineOfSight(eye, chestL) || lineOfSight(eye, chestR);
      // A duel that goes nowhere for a few seconds becomes a push.
      const staleDuel = now - (bot.engageSince ?? now) > 6.5;
      const hurtFresh = a.hp < (bot.lastHp ?? 100) || now - (bot.hurtAt ?? -9) < 2;
      if (a.hp < (bot.lastHp ?? 100)) bot.hurtAt = now;
      bot.lastHp = a.hp;

      // Strafe while fighting at range, step in when far, back off when close.
      // Exceptions: the charge carrier keeps pushing toward the site while
      // fighting from range (planting matters more than the duel), any bot
      // with only a sliver of target pushes in, and attackers at long range
      // who are not taking fire advance instead of trading plinks.
      if (now > bot.strafeFlipAt) {
        bot.strafeFlipAt = now + 0.5 + Math.random() * 0.9;
        bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      const px = perpX * bot.strafeDir;
      const pz = perpZ * bot.strafeDir;
      const pushing = a === g.match.carrier && bomb.state === 'carried' && dist > 15 && bot.objective;
      const advanceFight = !clearShot || staleDuel || (a.team === 'runner' && dist > 18 && !hurtFresh);
      if (pushing) {
        const dx = bot.objective.x - a.x;
        const dz = bot.objective.z - a.z;
        const dl = Math.hypot(dx, dz) || 1;
        moveX = dx / dl;
        moveZ = dz / dl;
        wantSpeed = 3.4;
      } else if (advanceFight) {
        moveX = (t.x - a.x) / (dist || 1);
        moveZ = (t.z - a.z) / (dist || 1);
        wantSpeed = 3.3;
      } else if (dist > 26) {
        moveX = (t.x - a.x) / dist;
        moveZ = (t.z - a.z) / dist;
        wantSpeed = 3.6;
      } else if (dist > 7) {
        moveX = px;
        moveZ = pz;
        wantSpeed = 2.1;
      } else {
        moveX = px * 0.6;
        moveZ = pz * 0.6;
        wantSpeed = 1.4;
        a.crouched = Math.random() < 0.006;
      }

      // Fire control: reaction delay, then bursts with pauses.
      const wNow = a.weapon();
      if (wNow && !a.reloading && now >= a.nextShotAt && now >= (a.switchUntil || 0)) {
        if (wNow.mag <= 0) {
          startReload(g, a);
        } else if (clearShot && now - bot.targetSince >= bot.reaction && bot.aimErr < 0.085) {
          if (bot.burstLeft <= 0 && now >= bot.nextBurstAt) {
            bot.burstLeft = 3 + Math.floor(Math.random() * 4);
          }
          if (bot.burstLeft > 0) {
            // Aim error becomes shot error: jitter the aim for this shot,
            // fire, then restore (the body keeps tracking smoothly).
            const jy = (Math.random() - 0.5) * 2 * bot.aimErr;
            const jp = (Math.random() - 0.5) * 2 * bot.aimErr;
            a.yaw += jy;
            a.pitch += jp;
            fireWeapon(g, a, wNow);
            a.yaw -= jy;
            a.pitch -= jp;
            bot.burstLeft--;
            if (bot.burstLeft <= 0) bot.nextBurstAt = now + 0.3 + Math.random() * 0.35;
          }
        }
      }
      if (wNow && wNow.mag <= 3 && !bot.target) startReload(g, a);
    }
  }

  // --- Integrate movement (frozen during the buy phase).
  const rate = a.grounded ? 10 : 1.6;
  const k = Math.min(1, rate * dt);
  a.vx += (moveX * wantSpeed - a.vx) * k;
  a.vz += (moveZ * wantSpeed - a.vz) * k;
  if (frozen || g.match.phase !== 'live') {
    a.vx = 0;
    a.vz = 0;
  }
  a.vy -= 16 * dt;
  moveBody(a, dt);
  a.speed2d = Math.hypot(a.vx, a.vz);

  // Stuck recovery: if a bot pushes against geometry without moving, skip
  // the current waypoint; if the route runs out, the planner re-routes.
  if (bot.state === 'advance' && wantSpeed > 0 && a.speed2d < 0.6 && bot.routeI < bot.route.length) {
    bot.stuckT += dt;
    if (bot.stuckT > 2) {
      bot.stuckT = 0;
      bot.routeI++;
      if (bot.routeI >= bot.route.length) bot.objective = null;
    }
  } else {
    bot.stuckT = 0;
  }

  // Footstep noise for the other team's ears.
  if (a.grounded && a.speed2d > 3.4) {
    bot.stepAcc = (bot.stepAcc || 0) + a.speed2d * dt;
    if (bot.stepAcc > 2.4) {
      bot.stepAcc = 0;
      g.match.noise(a.x, a.z, 9, a);
    }
  }

  // --- Animate the body: walk swing, crouch, gun up when fighting.
  bot.walkPhase += a.speed2d * dt * 2.4;
  const swing = Math.min(1, a.speed2d / 3) * 0.5;
  bot.mesh.legL.rotation.x = Math.sin(bot.walkPhase) * swing;
  bot.mesh.legR.rotation.x = -Math.sin(bot.walkPhase) * swing;
  const crouchDip = a.crouched ? 0.34 : 0;
  bot.mesh.torso.position.y = 1.09 - crouchDip;
  bot.mesh.head.position.y = 1.56 - crouchDip;
  bot.mesh.cap.position.y = 1.72 - crouchDip;
  bot.mesh.gun.position.y = 1.24 - crouchDip;
  bot.mesh.gun.rotation.x = -a.pitch;
  mesh.position.set(a.x, a.y, a.z);
}

// Where a runner bot should be heading, given the round state.
function runnerGoal(g, bot) {
  const bomb = g.match.bomb;
  if (bomb.state === 'planted') {
    // Guard the planted charge from just outside the site centre.
    const s = bomb.site;
    const ang = (bot.actor.id * 2.3) % (Math.PI * 2);
    return [s.x + Math.cos(ang) * 7.5, s.z + Math.sin(ang) * 7.5];
  }
  if (bomb.state === 'dropped') return [bomb.x, bomb.z];
  // The designated lurker delays at mid before committing to the site.
  if (bot.planRole === 'lurk' && g.time < (bot.lurkUntil ?? 0)) return [0, -16];
  const site = g.match.plan.site;
  return [site.x, site.z];
}

// Where a sentinel bot should be heading: its assigned hold, a rotation to
// the contested site, or the planted bomb.
function sentinelGoal(g, bot) {
  const bomb = g.match.bomb;
  if (bomb.state === 'planted') return [bomb.x, bomb.z];
  if (bot.rotateTo) return [bot.rotateTo.x, bot.rotateTo.z];
  if (bot.holdNode) {
    const n = nodeById.get(bot.holdNode);
    if (n) return [n.x, n.z];
  }
  return [bot.actor.x, bot.actor.z];
}
