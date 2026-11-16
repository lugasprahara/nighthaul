// NIGHTHAUL — boot and the main loop. Owns the renderer, the camera and
// the one shared game-state object `g` that every module reads. Simulation
// runs on a fixed 60 Hz step; rendering happens every animation frame and
// only reads state, so the game plays the same at any refresh rate.

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

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot'); // menu | buy | action | plant (screenshots)

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

// A soft fill light rides with the camera so the viewmodel gun and whatever
// the player is looking at up close never fall to pure black at dusk.
const fill = new THREE.PointLight(0xffe2bb, 2.6, 5, 1.7);
fill.position.set(0.35, 0.05, -0.6);
camera.add(fill);

const mats = buildMaterials();
buildWorld(scene, mats);

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
};
g.input = createInput(renderer.domElement);
g.audio = createAudio();
g.fx = new FX(scene);
if (shotMode) g.fx.tracerLife = 0.4; // hold tracers so a still frame can catch them

// --- Cast: the player plus nine bots, five a side.
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

// After the half-time swap, bot bodies need their new team's colours.
g.onTeamsChanged = () => {
  for (const bot of g.bots) {
    scene.remove(bot.mesh.group);
    bot.mesh = botMesh(bot.actor.team, mats);
    scene.add(bot.mesh.group);
  }
};

// --- Start / pause overlay flow.
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
  if (!document.pointerLockElement && started && !g.hud.buyOpen && !shotMode
    && (g.match.phase === 'buy' || g.match.phase === 'live' || g.match.phase === 'roundEnd')) {
    ovTitle.innerHTML = 'PAUSED';
    playBtn.textContent = 'Resume';
    overlay.hidden = false;
  }
});
renderer.domElement.addEventListener('click', () => {
  if (started && !g.input.locked && !g.hud.buyOpen && overlay.hidden && g.match.phase !== 'matchEnd') {
    g.input.lock();
  }
});

// --- Screenshot poses: deterministic scenes for the entry's screenshots.
function poseShot() {
  const m = g.match;
  if (shotMode === 'menu') return; // the idle orbit camera is the shot
  g.startMatch();
  overlay.hidden = true;
  document.getElementById('hud').hidden = false;
  if (shotMode === 'buy') {
    g.hud.setBuy(true);
    return;
  }
  // Skip the buy phase for the action poses.
  m.phase = 'live';
  m.phaseAt = g.time;
  const p = g.player;
  if (shotMode === 'action') {
    p.x = 0; p.z = -3.4; p.yaw = 0.12; p.pitch = 0.01;
    p.giveWeapon('vandal');
    p.current = 'primary';
    g.view.setWeapon(p.weapon().def);
    const foes = g.bots.filter((b) => b.actor.team === 'runner');
    const f0 = foes[0].actor;
    f0.x = 1.8; f0.z = -12.5; f0.yaw = Math.PI;
    const f1 = foes[1].actor;
    f1.x = -3.4; f1.z = -10.8; f1.yaw = Math.PI - 0.4;
    const mate = g.bots.find((b) => b.actor.team === 'sentinel').actor;
    mate.x = -2.2; mate.z = -1.2; mate.yaw = -0.2;
    for (const b of g.bots) b.mesh.group.position.set(b.actor.x, 0, b.actor.z);
    // Trade fire once the round banner has cleared, so the captured frame
    // has tracers and a muzzle flash mid-fight. (Sim time, not wall time:
    // a software renderer may run slower than real time.)
    const iv = setInterval(() => {
      if (g.time < 3.4) return;
      clearInterval(iv);
      const bot = g.bots.find((b) => b.actor === f0);
      bot.target = p;
      bot.targetSince = -9;
      bot.aimErr = 0.01;
      fireWeapon(g, f0, f0.weapon());
      fireWeapon(g, p, p.weapon());
      requestAnimationFrame(() => { window.__shotReady = true; });
    }, 90);
  } else if (shotMode === 'plant') {
    const carrier = g.bots.find((b) => b.actor.team === 'runner').actor;
    m.carrier = carrier;
    carrier.x = 25.5; carrier.z = 8.6;
    m.plantBomb(carrier);
    const guard = g.bots.filter((b) => b.actor.team === 'runner')[1].actor;
    guard.x = 22.3; guard.z = 3.1; guard.yaw = 2.6;
    p.x = 15.2; p.z = 6.4;
    p.yaw = Math.atan2(-(25 - p.x), -(6.5 - p.z));
    p.pitch = -0.02;
    for (const b of g.bots) b.mesh.group.position.set(b.actor.x, 0, b.actor.z);
    setTimeout(() => { window.__shotReady = true; }, 500);
  }
}

// --- Fixed-step simulation.
const SIM_DT = 1 / 60;
let acc = 0;
let last = performance.now();
let menuCamT = 0;

function step(dt) {
  g.time += dt;
  g.match.step(dt);
  if (g.match.phase !== 'idle') {
    stepPlayer(g, dt);
    if (!shotMode || shotMode === 'buy') {
      for (const bot of g.bots) stepBot(g, bot, dt);
    }
    g.grenades.step(dt);
  }
  g.view.update(dt, g.player, g.player.speed2d > 0.6);
}

function updateCamera(dt) {
  const p = g.player;
  if (g.match.phase === 'idle' || shotMode === 'menu') {
    // Slow orbit over the yard for the menu backdrop.
    menuCamT += dt * 0.045;
    const r = 27;
    camera.position.set(Math.cos(menuCamT) * r, 10.5, Math.sin(menuCamT) * r);
    camera.lookAt(0, 0.5, 0);
    camera.fov += (58 - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
    return;
  }
  if (p.alive) {
    const eye = p.eyeAt();
    g.shake = Math.max(0, g.shake - dt * 1.4);
    const sh = g.shake * g.shake * 0.05;
    camera.position.set(
      eye.x + (Math.random() - 0.5) * sh,
      eye.y + (Math.random() - 0.5) * sh,
      eye.z,
    );
    camera.rotation.set(p.pitch, p.yaw, 0);
  } else {
    // Spectate the first living teammate from just behind their shoulder.
    const mate = g.actors.find((a) => a.alive && a.team === p.team && !a.isPlayer)
      ?? g.actors.find((a) => a.alive && !a.isPlayer);
    if (mate) {
      const back = { x: Math.sin(mate.yaw) * 3.4, z: Math.cos(mate.yaw) * 3.4 };
      camera.position.lerp(
        new THREE.Vector3(mate.x + back.x, mate.y + 2.1, mate.z + back.z),
        Math.min(1, dt * 5),
      );
      camera.lookAt(mate.x - Math.sin(mate.yaw) * 6, mate.y + 1.3, mate.z - Math.cos(mate.yaw) * 6);
    }
  }
  const targetFov = g.scoped ? 74 / 3.2 : 74;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 11);
    camera.updateProjectionMatrix();
  }
}

function frame(nowMs) {
  const dtR = Math.min(0.25, (nowMs - last) / 1000);
  last = nowMs;
  acc += dtR;
  let steps = 0;
  while (acc >= SIM_DT && steps < 10) {
    step(SIM_DT);
    acc -= SIM_DT;
    steps++;
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
  poseShot();
  if (shotMode === 'menu' || shotMode === 'buy') {
    setTimeout(() => { window.__shotReady = true; }, 900);
  }
}
requestAnimationFrame(frame);
