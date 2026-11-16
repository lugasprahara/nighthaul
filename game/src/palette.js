// NIGHTHAUL palette and surface library.
//
// One place decides what the port looks like after dark: deep blue shadow,
// sodium-orange work light, cold moonlight from above. Colours live in PAL;
// the canvas painters below turn them into the game's only textures, so the
// build ships zero image assets. Materials are built once and shared.

import * as THREE from 'three';

export const PAL = {
  // Sky and air.
  sky: 0x0a1526, // zenith, almost black blue
  skyLow: 0x4a2f16, // horizon glow from the port's own lights
  fog: 0x0c1622,
  moonlight: 0xa8c4e0,
  hemiSky: 0x2e4258,
  hemiGround: 0x171310,
  // Ground and structure.
  asphalt: 0x272b31,
  linePaint: 0xd98a2b, // worn orange yard markings
  concrete: 0x6e747c,
  concreteDark: 0x484d54,
  // Containers and props.
  boxTeal: 0x22465c,
  boxRust: 0x8a4a24,
  boxSlate: 0x39434f,
  boxSand: 0x8a744e,
  crateWood: 0x7d6242,
  steel: 0x565d66,
  barrelBlue: 0x2c4250,
  // Teams and signals.
  sentinel: 0x5f9fd0,
  sentinelDeep: 0x2c4f6e,
  runner: 0xe07b2e,
  runnerDeep: 0x7e4416,
  accent: 0xff9a2a,
  danger: 0xe5484d,
  siteA: 0xffa02e,
  siteB: 0x4fb8d8,
  skin: 0xc9a189,
  gunmetal: 0x23262b,
  lampGlow: 0xffb36b,
};

// ---------------------------------------------------------------------------
// Texture painters. A tiny seeded PRNG keeps every surface identical from
// load to load (no Math.random in texture space).

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h, painter, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  painter(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Weathered base coat: flat fill, then thousands of faint flecks and a few
// long scuffs dragged across the grain.
function weathered(ctx, w, h, base, flecks, seed, fleckCount = 2400) {
  const rnd = mulberry(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < fleckCount; i++) {
    ctx.fillStyle = flecks[Math.floor(rnd() * flecks.length)];
    ctx.globalAlpha = 0.04 + rnd() * 0.08;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = '#000';
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    const y = rnd() * h;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y + (rnd() - 0.5) * 22);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

const hexCss = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

function asphaltTexture() {
  return makeCanvas(256, 256, (ctx, w, h) => {
    weathered(ctx, w, h, hexCss(PAL.asphalt), ['#2e333a', '#20242a', '#343a42', '#191d22'], 101);
    // Tar seams wandering across the slab.
    ctx.strokeStyle = 'rgba(0,0,0,0.20)';
    ctx.lineWidth = 2;
    const rnd = mulberry(102);
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(rnd() * w, 0);
      ctx.bezierCurveTo(rnd() * w, h * 0.33, rnd() * w, h * 0.66, rnd() * w, h);
      ctx.stroke();
    }
  }, 24, 24);
}

function concreteTexture() {
  return makeCanvas(256, 256, (ctx, w, h) => {
    weathered(ctx, w, h, '#676d75', ['#6e747c', '#5f656d', '#767c84', '#585e65'], 201);
    // Formwork panel seams and a pour line.
    ctx.strokeStyle = 'rgba(38,40,44,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(30,32,36,0.25)';
    for (const [x, y] of [[42, 42], [214, 42], [42, 214], [214, 214]]) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 2, 1);
}

// Corrugated container skin: vertical ribs with light catching the ridge of
// each one, a stencilled line name and fleet number, grime along the sill.
function containerTexture(hex, line, fleetNo, seed) {
  return makeCanvas(512, 256, (ctx, w, h) => {
    weathered(ctx, w, h, hexCss(hex), ['#00000022', '#ffffff22', '#00000030'], seed, 1100);
    for (let x = 14; x < w; x += 32) {
      ctx.fillStyle = 'rgba(0,0,0,0.17)';
      ctx.fillRect(x, 0, 11, h);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x + 12, 0, 3, h);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 42px system-ui, sans-serif';
    ctx.fillText(line, 28, 64);
    ctx.font = '26px ui-monospace, monospace';
    ctx.fillText(fleetNo, 28, 104);
    const grime = ctx.createLinearGradient(0, h - 40, 0, h);
    grime.addColorStop(0, 'rgba(0,0,0,0)');
    grime.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = grime;
    ctx.fillRect(0, h - 40, w, 40);
  });
}

function crateTexture() {
  return makeCanvas(128, 128, (ctx, w, h) => {
    weathered(ctx, w, h, hexCss(PAL.crateWood), ['#6f5739', '#8a6f4b', '#5f4a2f'], 301, 600);
    ctx.strokeStyle = 'rgba(66,48,25,0.85)';
    ctx.lineWidth = 7;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(6, 6);
    ctx.lineTo(w - 6, h - 6);
    ctx.moveTo(w - 6, 6);
    ctx.lineTo(6, h - 6);
    ctx.stroke();
  });
}

// Painted site marker for the ground: a ring and the site letter, mostly
// worn through by forklift traffic.
export function sitePaintTexture(letter, hex) {
  return makeCanvas(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = hexCss(hex);
    ctx.lineWidth = 10;
    ctx.setLineDash([150, 26, 90, 20]);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 96, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = hexCss(hex);
    ctx.font = '700 148px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, w / 2, h / 2 + 6);
  });
}

// The shared material set. Keys are the vocabulary the rest of the game
// speaks in: mapdata names containerTeal/Rust/Slate/Sand, crate and
// concrete per solid; world and the actor meshes ask for the rest.
export function buildMaterials() {
  const std = (opts) => new THREE.MeshStandardMaterial(opts);
  return {
    asphalt: std({ map: asphaltTexture(), roughness: 0.96 }),
    concrete: std({ map: concreteTexture(), roughness: 0.9, metalness: 0.02 }),
    concreteDark: std({ color: PAL.concreteDark, roughness: 0.92 }),
    metal: std({ color: PAL.steel, roughness: 0.5, metalness: 0.65 }),
    crate: std({ map: crateTexture(), roughness: 0.85 }),
    barrel: std({ color: PAL.barrelBlue, roughness: 0.55, metalness: 0.4 }),
    containerTeal: std({ map: containerTexture(PAL.boxTeal, 'NIGHTHAUL LINES', 'NH 2210', 401), roughness: 0.62, metalness: 0.3 }),
    containerRust: std({ map: containerTexture(PAL.boxRust, 'NIGHTHAUL LINES', 'NH 0874', 402), roughness: 0.66, metalness: 0.3 }),
    containerSlate: std({ map: containerTexture(PAL.boxSlate, 'PIERLINE', 'PL 5531', 403), roughness: 0.62, metalness: 0.3 }),
    containerSand: std({ map: containerTexture(PAL.boxSand, 'PIERLINE', 'PL 1190', 404), roughness: 0.7, metalness: 0.25 }),
    sentinel: std({ color: PAL.sentinel, roughness: 0.8 }),
    sentinelDark: std({ color: PAL.sentinelDeep, roughness: 0.85 }),
    runner: std({ color: PAL.runner, roughness: 0.8 }),
    runnerDark: std({ color: PAL.runnerDeep, roughness: 0.85 }),
    skin: std({ color: PAL.skin, roughness: 0.75 }),
    dark: std({ color: PAL.gunmetal, roughness: 0.7, metalness: 0.3 }),
    lamp: new THREE.MeshBasicMaterial({ color: PAL.lampGlow }),
    siteA: std({ color: PAL.siteA, roughness: 0.8, emissive: PAL.siteA, emissiveIntensity: 0.12 }),
    siteB: std({ color: PAL.siteB, roughness: 0.8, emissive: PAL.siteB, emissiveIntensity: 0.12 }),
  };
}
