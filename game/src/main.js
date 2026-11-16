// NIGHTHAUL — boot and the main loop.
//
// This module owns the renderer, the camera, and the one shared state
// object `g` that every other module reads. The simulation runs on a
// fixed 60 Hz step and rendering only reads state, so the game plays
// identically at any refresh rate. A `?shot=` query parameter stages
// deterministic scenes for the entry's screenshots.

import * as THREE from 'three';
import { buildMaterials } from './palette.js';
import { buildWorld } from './world.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { FX } from './fx.js';
import { createActor } from './actor.js';
import { createBot, stepBot, botMesh, BOT_NAMES } from './bots.js';
import { createPlayerView, stepPlayer, fireWeapon } from './player.js';
import { createGrenades } from './grenades.js';
import { createMatch } from './match.js';
import { createHud } from './hud.js';
import { raycastWorld } from './physics.js';
import { resolveShot } from './weapons.js';

const shotMode = new URLSearchParams(location.search).get('shot'); // menu|buy|action|plant

// ---------------------------------------------------------------------------
// Renderer, scene, camera.

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 420);
camera.rotation.order = 'YXZ';
scene.add(camera);

// A warm fill rides with the camera so the viewmodel and close-up
// geometry never fall to pure black in the night palette.
const fill = new THREE.PointLight(0xffe2bb, 2.6, 5, 1.7);
fill.position.set(0.35, 0.05, -0.6);
camera.add(fill);

const mats = buildMaterials();
buildWorld(scene, mats);

// ---------------------------------------------------------------------------
// The shared state object and its subsystems.

const g = {
  time: 0,
  scene,
  camera,
  mats,
  events: [],
  actors: [],
  bots: [],
  player: null,
  scoped: false,
  shake: 0,
  raycastWorld,
  resolveShot,
  shotMode,
  calls: null, // team coordination clocks, (re)built by the bot planner
};
g.input = createInput(renderer.domElement);
g.audio = createAudio();
g.fx = new FX(scene);
if (shotMode) g.fx.tracerLife = 0.4; // hold tracers so a still frame catches them

// The cast: the player plus nine bots, five a side.
const player = createActor('sentinel', 'YOU', true);
g.player = player;
g.actors.push(player);
for (const team of ['sentinel', 'runner']) {
  for (const name of BOT_NAMES[team]) {
    const actor = createActor(team, name);
    const bot = createBot(actor, mats);
    bot.mesh.group.position.set(actor.x, 0, actor.z);
    scene.add(bot.mesh.group);
    g.bots.push(bot);
    g.actors.push(actor);
  }
}
g.view = createPlayerView(camera, mats);
g.view.setWeapon(player.weapon().def);
g.grenades = createGrenades(g);
g.match = createMatch(g);
g.hud = createHud(g);
window.__game = g; // dev handle: the screenshot/soak tooling reads state here

// After the halftime swap, bot bodies need their new team's colours.
g.onTeamsChanged = () => {
  for (const bot of g.bots) {
    scene.remove(bot.mesh.group);
    bot.mesh = botMesh(bot.actor.team, mats);
    scene.add(bot.mesh.group);
  }
};

// ---------------------------------------------------------------------------
// Start / pause overlay flow.

const overlay = document.getElementById('overlay');
const playBtn = document.getElementById('play');
const ovTitle = document.getElementById('ov-title');
let started = false;

g.startMatch = () => {
  started = true;
  overlay.hidden = true;
  document.getElementById('hud').hidden = false;
  g.audio.resume();
  g.audio.ambient();
  g.match.start();
  g.view.setWeapon(g.player.weapon().def);
  if (!shotMode) g.input.lock();
};
playBtn.addEventListener('click', () => {
  if (!started) {
    g.startMatch();
  } else {
    overlay.hidden = true;
    g.audio.resume();
    g.input.lock();
  }
});
document.addEventListener('pointerlockchange', () => {
  const inRound = ['buy', 'live', 'roundEnd', 'halftime'].includes(g.match.phase);
  if (!document.pointerLockElement && started && !g.hud.buyOpen && !shotMode && inRound) {
    ovTitle.textContent = 'PAUSED';
    playBtn.textContent = 'Resume';
    overlay.hidden = false;
  }
});
renderer.domElement.addEventListener('click', () => {
  if (started && !g.input.locked && !g.hud.buyOpen && overlay.hidden && g.match.phase !== 'matchEnd') {
    g.input.lock();
  }
});

// ---------------------------------------------------------------------------
// Screenshot poses: deterministic stagings for the four entry shots.

function stageShot() {
  if (shotMode === 'menu') return; // the idle orbit camera is the shot
  const m = g.match;
  g.startMatch();
  overlay.hidden = true;
  document.getElementById('hud').hidden = false;
  if (shotMode === 'buy') {
    g.hud.setBuy(true);
    return;
  }
  // Action poses skip the buy window.
  m.phase = 'live';
  m.phaseAt = g.time;
  const p = g.player;
  const place = (actor, x, z, yaw) => {
    actor.x = x;
    actor.z = z;
    if (yaw !== undefined) actor.yaw = yaw;
  };
  if (shotMode === 'action') {
    place(p, 0, -3.4);
    p.yaw = 0.12;
    p.pitch = 0.01;
    p.giveWeapon('vandal');
    p.current = 'primary';
    g.view.setWeapon(p.weapon().def);
    const foes = g.bots.filter((b) => b.actor.team === 'runner').map((b) => b.actor);
    place(foes[0], 1.8, -12.5, Math.PI);
    place(foes[1], -3.4, -10.8, Math.PI - 0.4);
    const mate = g.bots.find((b) => b.actor.team === 'sentinel').actor;
    place(mate, -2.2, -1.2, -0.2);
    for (const b of g.bots) b.mesh.group.position.set(b.actor.x, 0, b.actor.z);
    // Trade fire once the round banner clears, timed in sim time (a
    // software renderer may run slower than wall clock), so the frame
    // catches tracers and muzzle flash mid-fight.
    const iv = setInterval(() => {
      if (g.time < 3.4) return;
      clearInterval(iv);
      const bot = g.bots.find((b) => b.actor === foes[0]);
      bot.target = p;
      bot.targetSince = -9;
      bot.aimErr = 0.01;
      fireWeapon(g, foes[0], foes[0].weapon());
      fireWeapon(g, p, p.weapon());
      requestAnimationFrame(() => { window.__shotReady = true; });
    }, 90);
  } else if (shotMode === 'plant') {
    const carrier = g.bots.find((b) => b.actor.team === 'runner').actor;
    m.carrier = carrier;
    place(carrier, 25.5, 8.6);
    m.plantBomb(carrier);
    const guard = g.bots.filter((b) => b.actor.team === 'runner')[1].actor;
    place(guard, 22.3, 3.1, 2.6);
    place(p, 15.2, 6.4);
    p.yaw = Math.atan2(-(25 - p.x), -(6.5 - p.z));
    p.pitch = -0.02;
    for (const b of g.bots) b.mesh.group.position.set(b.actor.x, 0, b.actor.z);
    setTimeout(() => { window.__shotReady = true; }, 500);
  }
}

// ---------------------------------------------------------------------------
// Fixed-step simulation and the frame loop.

const SIM_DT = 1 / 60;
let acc = 0;
let last = performance.now();
let menuCamT = 0;
let viewBob = { x: 0, y: 0 };

function step(dt) {
  g.time += dt;
  g.match.step(dt);
  if (g.match.phase === 'idle') return;
  stepPlayer(g, dt);
  if (!shotMode || shotMode === 'buy') {
    for (const bot of g.bots) stepBot(g, bot, dt);
  }
  g.grenades.step(dt);
  viewBob = g.view.update(dt, g.player, g.player.speed2d > 0.6);
}

function updateCamera(dt) {
  const p = g.player;
  if (g.match.phase === 'idle' || shotMode === 'menu') {
    // A slow orbit over the yard backs the menu.
    menuCamT += dt * 0.045;
    const r = 27;
    camera.position.set(Math.cos(menuCamT) * r, 10.5, Math.sin(menuCamT) * r);
    camera.lookAt(0, 0.5, 0);
    easeFov(58, dt, 3);
    return;
  }
  if (p.alive) {
    const eye = p.eyeAt();
    g.shake = Math.max(0, g.shake - dt * 1.4);
    const sh = g.shake * g.shake * 0.05;
    camera.position.set(
      eye.x + viewBob.x * 0.4 + (Math.random() - 0.5) * sh,
      eye.y + viewBob.y + (Math.random() - 0.5) * sh,
      eye.z,
    );
    camera.rotation.set(p.pitch, p.yaw, 0);
  } else {
    // Spectate a living teammate from just behind their shoulder.
    const mate = g.actors.find((a) => a.alive && a.team === p.team && !a.isPlayer)
      ?? g.actors.find((a) => a.alive && !a.isPlayer);
    if (mate) {
      camera.position.lerp(
        new THREE.Vector3(mate.x + Math.sin(mate.yaw) * 3.4, mate.y + 2.1, mate.z + Math.cos(mate.yaw) * 3.4),
        Math.min(1, dt * 5),
      );
      camera.lookAt(mate.x - Math.sin(mate.yaw) * 6, mate.y + 1.3, mate.z - Math.cos(mate.yaw) * 6);
    }
  }
  easeFov(g.scoped ? 74 / 3.2 : 74, dt, 11);
}

function easeFov(target, dt, rate) {
  if (Math.abs(camera.fov - target) <= 0.05) return;
  camera.fov += (target - camera.fov) * Math.min(1, dt * rate);
  camera.updateProjectionMatrix();
}

function frame(nowMs) {
  const dtR = Math.min(0.25, (nowMs - last) / 1000);
  last = nowMs;
  acc += dtR;
  let steps = 0;
  while (acc >= SIM_DT && steps < 10) {
    step(SIM_DT);
    acc -= SIM_DT;
    steps += 1;
  }
  if (steps === 10) acc = 0; // very slow frame: drop time rather than spiral
  g.fx.update(dtR);
  updateCamera(dtR);
  if (started || shotMode) g.hud.update(dtR);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

if (shotMode) {
  stageShot();
  if (shotMode === 'menu' || shotMode === 'buy') {
    setTimeout(() => { window.__shotReady = true; }, 900);
  }
}
requestAnimationFrame(frame);
