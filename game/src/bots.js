// Bot brains and bodies.
//
// Every bot is an actor plus a planner. The planner works in layers:
// perception (what can this bot genuinely see — line of sight, field of
// view, smoke), a role assigned at round start, and a team call system:
// the first runner to make contact starts an "execute" clock for the
// whole attack, and the first sentinel contact starts the rotation.
//
// Roles — runners: the carrier is the ENTRY and leads the hit; a SUPPORT
// trails to trade the entry's fights; a LURKER works the far lane
// quietly and pinches once the execute is called. Sentinels: ANCHORS
// hold a site each, and with a full roster a ROTATOR holds mid and
// swings to wherever contact is called.
//
// Bots shoot through the same fireWeapon as the player, with human-like
// reaction time and an aim error that settles while they track.

import * as THREE from 'three';
import { findRoute, NODES, SITES } from './mapdata.js';
import { lineOfSight, moveBody } from './physics.js';
import { smokeBlocks } from './fx.js';
import { fireWeapon, startReload } from './player.js';

export const BOT_NAMES = {
  sentinel: ['HAVEN', 'BULWARK', 'MOORING', 'SIGNAL'],
  runner: ['RIPTIDE', 'BALLAST', 'CURRENT', 'SQUALL', 'UNDERTOW'],
};

const nodeById = new Map(NODES.map((n) => [n.id, n]));

// Where a runner stages before the execute is called, per site: the
// doorway just outside the plant radius.
const STAGE_NODE = { A: 'a_door_w', B: 'b_main_e' };
// Where each sentinel pair anchors, per site, plus the rotator's post.
const ANCHOR_NODES = { A: ['a_hold', 'a_approach'], B: ['b_hold', 'b_main_e'] };
const ROTATOR_NODE = 'mid_hold';

export function botMesh(team, mats) {
  const g = new THREE.Group();
  const suit = team === 'sentinel' ? mats.sentinel : mats.runner;
  const dark = team === 'sentinel' ? mats.sentinelDark : mats.runnerDark;
  const part = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const legL = part(0.17, 0.8, 0.21, -0.11, 0.4, 0, dark);
  const legR = part(0.17, 0.8, 0.21, 0.11, 0.4, 0, dark);
  const torso = part(0.48, 0.6, 0.27, 0, 1.09, 0, suit);
  const armL = part(0.11, 0.48, 0.14, -0.31, 1.13, -0.06, dark);
  const armR = part(0.11, 0.48, 0.14, 0.31, 1.13, -0.06, dark);
  const head = part(0.25, 0.27, 0.25, 0, 1.56, 0, mats.skin);
  const cap = part(0.28, 0.1, 0.28, 0, 1.72, 0, dark);
  const gun = part(0.07, 0.13, 0.6, 0.17, 1.25, -0.28, mats.dark);
  // A chest lamp so teammates read as friendly shapes in the dark.
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.05, 0.02),
    new THREE.MeshBasicMaterial({ color: team === 'sentinel' ? 0x63e6ff : 0xffb35c }),
  );
  lamp.position.set(0, 1.22, -0.15);
  g.add(lamp);
  return { group: g, legL, legR, torso, armL, armR, head, cap, gun };
}

let rosterSeq = 0;

export function createBot(actor, mats) {
  const mesh = botMesh(actor.team, mats);
  const skill = 0.75 + (rosterSeq % 5) * 0.09; // 0.75 .. 1.11 across the roster
  rosterSeq += 1;
  return {
    actor,
    mesh,
    skill,
    reaction: 0.52 - skill * 0.18, // seconds before the first shot
    aimFloor: 0.034 - skill * 0.016, // settled aim error, radians

    // Plan state.
    planRole: null, // 'entry' | 'support' | 'lurk' | 'anchor' | 'rotate'
    state: 'advance',
    route: [],
    routeI: 0,
    objective: null, // { x, z, kind: 'site'|'hold'|'bomb'|'hunt'|'guard' }
    holdNode: null,
    watchYaw: 0,
    rotateTo: null,
    lurkUntil: 0,
    intent: null, // 'plant' | 'defuse' | null — read by match.js channels
    heard: null, // { x, z, at } — noise to face, set by match.noise

    // Combat state.
    target: null,
    targetSince: 0,
    engageSince: 0,
    lastSeen: null, // { x, y, z, at }
    aimErr: 0.1,
    burstLeft: 0,
    nextBurstAt: 0,
    strafeDir: 1,
    strafeFlipAt: 0,
    lastHp: 100,
    hurtAt: -9,

    // Housekeeping.
    thinkAt: Math.random() * 0.1,
    stuckT: 0,
    walkPhase: 0,
    deathT: 0,
    stepAcc: 0,

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
      this.stepAcc = 0;
      this.mesh.group.rotation.set(0, 0, 0);
      this.mesh.group.visible = true;
    },

    setObjective(x, z, kind) {
      this.objective = { x, z, kind };
      this.route = findRoute(this.actor.x, this.actor.z, x, z);
      this.routeI = 0;
      // A fresh objective always means travelling: leaving 'engage' here
      // is what lets a bot that lost its target start moving again
      // instead of standing frozen with a route it never follows.
      this.state = 'advance';
    },
  };
}

// ---------------------------------------------------------------------------
// Round planning: roles, holds and the team-call clocks. match.js calls
// this once per round, after spawns and the carrier are decided.

export function planRound(g) {
  const calls = {
    runner: { contactAt: 0, executeAt: 0, site: null },
    sentinel: { contactAt: 0, executeAt: 0, site: null },
  };
  g.calls = calls;
  const now = g.time;

  const sentinels = g.bots.filter((b) => b.actor.team === 'sentinel');
  const runners = g.bots.filter((b) => b.actor.team === 'runner');

  // Sentinels: nearest bots anchor each site in turn; a fifth rotates.
  const bySiteDist = (site) => (b1, b2) =>
    Math.hypot(b1.actor.x - site.x, b1.actor.z - site.z)
    - Math.hypot(b2.actor.x - site.x, b2.actor.z - site.z);
  const pool = [...sentinels];
  const takeNearest = (site) => {
    pool.sort(bySiteDist(site));
    return pool.shift();
  };
  const anchorA = takeNearest(SITES.A);
  const anchorB = takeNearest(SITES.B);
  const anchorA2 = pool.length > 2 ? takeNearest(SITES.A) : null;
  const anchorB2 = pool.length > 1 ? takeNearest(SITES.B) : null;
  const assignments = [
    [anchorA, 'A', 0], [anchorB, 'B', 0], [anchorA2, 'A', 1], [anchorB2, 'B', 1],
  ];
  for (const [bot, site, slot] of assignments) {
    if (!bot) continue;
    bot.planRole = 'anchor';
    bot.holdNode = ANCHOR_NODES[site][slot];
    const n = nodeById.get(bot.holdNode);
    if (n) bot.watchYaw = yawFacing(n);
  }
  for (const bot of pool) {
    bot.planRole = 'rotate';
    bot.holdNode = ROTATOR_NODE;
    const n = nodeById.get(ROTATOR_NODE);
    if (n) bot.watchYaw = yawFacing(n);
  }

  // Runners: carrier leads as entry, nearest teammate supports, the
  // farthest works the lurk. With only two bots it is entry + support.
  const carrier = g.match.carrier;
  const entryBot = runners.find((b) => b.actor === carrier) ?? null;
  const others = runners.filter((b) => b !== entryBot);
  // Support and lurk are picked by distance to the carrier they play off.
  const anchor = carrier ?? g.player;
  others.sort((b1, b2) =>
    Math.hypot(b1.actor.x - anchor.x, b1.actor.z - anchor.z)
    - Math.hypot(b2.actor.x - anchor.x, b2.actor.z - anchor.z));
  if (entryBot) entryBot.planRole = 'entry';
  // Runners hold their gaze on the objective while travelling/planting.
  const planSite = g.match.plan.site;
  for (const bot of runners) {
    bot.watchYaw = Math.atan2(-(planSite.x - bot.actor.x), -(planSite.z - bot.actor.z));
  }
  if (others[0]) others[0].planRole = 'support';
  if (others[1]) {
    others[1].planRole = 'lurk';
    others[1].lurkUntil = now + 26; // buy window + a slow walk up the far lane
  }
  for (const bot of others.slice(2)) bot.planRole = 'support';
  // If the player carries, the nearest bot becomes the de-facto entry.
  if (!entryBot && others[0]) others[0].planRole = 'entry';
}

// The yaw a holder at node n should keep: toward the nearer site, which
// is where trouble comes from.
function yawFacing(n) {
  const site = Math.hypot(SITES.A.x - n.x, SITES.A.z - n.z) < Math.hypot(SITES.B.x - n.x, SITES.B.z - n.z)
    ? SITES.A
    : SITES.B;
  return Math.atan2(-(site.x - n.x), -(site.z - n.z));
}

// First contact for a team: start its coordination clock. Runners get an
// execute moment a beat later; sentinels get a rotation to the site the
// contact happened nearest.
function callContact(g, team, enemy) {
  const calls = g.calls?.[team];
  if (!calls || calls.contactAt > 0) return;
  calls.contactAt = g.time;
  const site = nearestSite(enemy.x, enemy.z);
  calls.site = site;
  if (team === 'runner') {
    calls.executeAt = g.time + 1.35;
  } else {
    const rotator = g.bots.find((b) => b.actor.team === 'sentinel' && b.planRole === 'rotate' && b.actor.alive);
    if (rotator && site) rotator.rotateTo = { x: site.x, z: site.z };
  }
}

function nearestSite(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const s of Object.values(SITES)) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
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
    // A generous vision cone, plus a small "presence" radius inside it.
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
      callContact(g, a.team, best);
    }
    bot.lastSeen = { x: best.x, y: best.y, z: best.z, at: now };
  } else if (bot.target && (!bot.target.alive || now - (bot.lastSeen?.at ?? 0) > 0.3)) {
    bot.target = null;
  }
}

// Where a runner bot should be heading, given the round state and role.
function runnerGoal(g, bot) {
  const a = bot.actor;
  const bomb = g.match.bomb;
  if (bomb.state === 'planted') {
    // Guard the planted charge from a ring just off the site centre.
    const s = bomb.site;
    const ang = (a.id * 2.3) % (Math.PI * 2);
    return [s.x + Math.cos(ang) * 7.5, s.z + Math.sin(ang) * 7.5];
  }
  if (bomb.state === 'dropped') return [bomb.x, bomb.z];
  const site = g.match.plan.site;
  const calls = g.calls?.runner;
  const executing = calls && calls.executeAt > 0 && g.time >= calls.executeAt;

  if (bot.planRole === 'lurk') {
    // Quiet up the far lane until the execute is called or the timer
    // runs out, then pinch the site from wherever the lurk ended up.
    if (!executing && g.time < bot.lurkUntil) return [0, -16];
    return [site.x, site.z];
  }
  if (bot.planRole === 'support') {
    // Trail the entry: close enough to trade, never ahead of them.
    const entry = g.bots.find((b) => b.planRole === 'entry' && b.actor.alive);
    if (entry && entry.actor !== a) {
      const dEntry = Math.hypot(entry.actor.x - a.x, entry.actor.z - a.z);
      if (dEntry > 8) return [entry.actor.x, entry.actor.z];
    }
    return [site.x, site.z];
  }
  // Entry (and everyone without a role): stage at the site's door until
  // the execute is called, then commit to the site itself. The carrier
  // never stages — planting early is never wrong.
  if (!executing && a !== g.match.carrier) {
    const stage = nodeById.get(STAGE_NODE[site.id]);
    if (stage) return [stage.x, stage.z];
  }
  return [site.x, site.z];
}

// Where a sentinel bot should be heading: its hold, a called rotation, or
// the planted charge.
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
      // Objectives come from the role plan, refreshed as the round moves.
      if (!bot.objective || (bot.objective.kind === 'hold' && bomb.state === 'planted' && a.team === 'sentinel')) {
        if (a.team === 'runner') bot.setObjective(...runnerGoal(g, bot), bomb.state === 'planted' ? 'guard' : 'site');
        else bot.setObjective(...sentinelGoal(g, bot), bomb.state === 'planted' ? 'bomb' : 'hold');
      }
      // A noise nearby turns a holder's head — information without
      // abandoning the post.
      if (bot.heard && now - bot.heard.at < 1.6 && bot.state === 'hold') {
        bot.watchYaw = angleTo(a, bot.heard.x, bot.heard.z);
      }
      // Follow the route.
      const pt = bot.route[bot.routeI];
      if (pt) {
        const dx = pt.x - a.x;
        const dz = pt.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.8) {
          bot.routeI += 1;
        } else {
          moveX = dx / d;
          moveZ = dz / d;
          wantSpeed = bot.planRole === 'lurk' && g.time < bot.lurkUntil ? 2.7 : 4.35;
          if (bot.state !== 'hold') turnToward(a, angleTo(a, pt.x, pt.z), 0, dt, 5);
        }
      }
      if (bot.routeI >= bot.route.length && bot.objective) {
        // Arrived: settle into what the objective implies.
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
            if (Math.random() < dt * 0.25) bot.watchYaw += (Math.random() - 0.5) * 0.7;
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
      const staleDuel = now - bot.engageSince > 6.5;
      if (a.hp < bot.lastHp) bot.hurtAt = now;
      bot.lastHp = a.hp;
      const hurtFresh = a.hp < 100 && now - bot.hurtAt < 2;

      if (now > bot.strafeFlipAt) {
        bot.strafeFlipAt = now + 0.5 + Math.random() * 0.9;
        bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      const px = perpX * bot.strafeDir;
      const pz = perpZ * bot.strafeDir;
      // The carrier keeps pushing toward the site while fighting from
      // range; a bot with only a sliver of target pushes in; attackers
      // at long range who are not taking fire advance to trade range.
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
            // fire, then restore — the body keeps tracking smoothly.
            const jy = (Math.random() - 0.5) * 2 * bot.aimErr;
            const jp = (Math.random() - 0.5) * 2 * bot.aimErr;
            a.yaw += jy;
            a.pitch += jp;
            fireWeapon(g, a, wNow);
            a.yaw -= jy;
            a.pitch -= jp;
            bot.burstLeft -= 1;
            if (bot.burstLeft <= 0) bot.nextBurstAt = now + 0.3 + Math.random() * 0.35;
          }
        }
      }
    }
    if (bot.state !== 'engage') {
      const wNow = a.weapon();
      if (wNow && wNow.mag <= 3) startReload(g, a);
    }
  }

  // --- Integrate movement (frozen outside the live phase).
  const rate = a.grounded ? 10 : 1.6;
  const blend = Math.min(1, rate * dt);
  a.vx += (moveX * wantSpeed - a.vx) * blend;
  a.vz += (moveZ * wantSpeed - a.vz) * blend;
  if (frozen || g.match.phase !== 'live') {
    a.vx = 0;
    a.vz = 0;
  }
  a.vy -= 16 * dt;
  moveBody(a, dt);
  a.speed2d = Math.hypot(a.vx, a.vz);

  // Stuck recovery: pushing against geometry without moving skips the
  // current waypoint; if the route runs out, the planner re-routes.
  if (bot.state === 'advance' && wantSpeed > 0 && a.speed2d < 0.6 && bot.routeI < bot.route.length) {
    bot.stuckT += dt;
    if (bot.stuckT > 2) {
      bot.stuckT = 0;
      bot.routeI += 1;
      if (bot.routeI >= bot.route.length) bot.objective = null;
    }
  } else {
    bot.stuckT = 0;
  }

  // Footstep noise for the other team's ears (the lurk walks quietly).
  if (a.grounded && a.speed2d > 3.4) {
    bot.stepAcc += a.speed2d * dt;
    if (bot.stepAcc > 2.4) {
      bot.stepAcc = 0;
      g.match.noise(a.x, a.z, 9, a);
    }
  }

  // --- Animate the body: walk swing, crouch dip, gun tracks the pitch.
  bot.walkPhase += a.speed2d * dt * 2.4;
  const swing = Math.min(1, a.speed2d / 3) * 0.5;
  bot.mesh.legL.rotation.x = Math.sin(bot.walkPhase) * swing;
  bot.mesh.legR.rotation.x = -Math.sin(bot.walkPhase) * swing;
  const crouchDip = a.crouched ? 0.34 : 0;
  bot.mesh.torso.position.y = 1.09 - crouchDip;
  bot.mesh.head.position.y = 1.56 - crouchDip;
  bot.mesh.cap.position.y = 1.72 - crouchDip;
  bot.mesh.gun.position.y = 1.25 - crouchDip;
  bot.mesh.gun.rotation.x = -a.pitch;
  mesh.position.set(a.x, a.y, a.z);
}
