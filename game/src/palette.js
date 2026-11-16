// Nighthaul palette: a container port at night. Deep blue dark, sodium-orange
// floodlights, cold moonlight. Every material in the game comes from here so
// the whole scene keeps one chosen palette.

import * as THREE from 'three';

export const PAL = {
  sky: 0x0a1526,
  skyLow: 0x4a2f16,
  fog: 0x0c1622,
  sun: 0xa8c4e0,
  hemiSky: 0x2e4258,
  hemiGround: 0x171310,
  asphalt: 0x272b31,
  asphaltLine: 0xd98a2b,
  concrete: 0x6e747c,
  concreteDark: 0x484d54,
  containerTeal: 0x22465c,
  containerRust: 0x8a4a24,
  containerSlate: 0x39434f,
  containerSand: 0x8a744e,
  crate: 0x7d6242,
  metal: 0x565d66,
  barrel: 0x2c4250,
  sentinel: 0x5f9fd0,
  runner: 0xe07b2e,
  accent: 0xff9a2a,
  danger: 0xe5484d,
  siteA: 0xffa02e,
  siteB: 0x4fb8d8,
};

// Canvas-generated textures: cheap, original, and they keep the game free of
// external assets. Each returns a THREE.CanvasTexture set to repeat.
function canvasTexture(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noise(ctx, w, h, base, fleck, n = 2600) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = fleck[(i * 2654435761 >>> 8) % fleck.length];
    ctx.globalAlpha = 0.05 + ((i * 40503 >>> 4) % 10) / 90;
    ctx.fillRect((i * 48271) % w, (i * 69621) % h, 2, 2);
  }
  ctx.globalAlpha = 1;
}

export function asphaltTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    noise(ctx, w, h, '#272b31', ['#2e333a', '#20242a', '#343a42']);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo((i * 67) % w, 0);
      ctx.lineTo((i * 67 + 30) % w, h);
      ctx.stroke();
    }
  }, 24, 24);
}

export function concreteTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    noise(ctx, w, h, '#676d75', ['#6e747c', '#5f656d', '#767c84']);
    ctx.strokeStyle = 'rgba(40,42,46,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  }, 2, 1);
}

// Corrugated container side with a stencilled line label and number.
export function containerTexture(hex, label, number) {
  const base = `#${hex.toString(16).padStart(6, '0')}`;
  return canvasTexture(512, 256, (ctx, w, h) => {
    noise(ctx, w, h, base, ['#00000022', '#ffffff22'], 900);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let x = 16; x < w; x += 32) ctx.fillRect(x, 0, 10, h);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (let x = 28; x < w; x += 32) ctx.fillRect(x, 0, 3, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.fillText(label, 28, 66);
    ctx.font = '28px ui-monospace, monospace';
    ctx.fillText(number, 28, 108);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, h - 34, w, 34);
  });
}

export function crateTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    noise(ctx, w, h, '#7d6242', ['#6f5739', '#8a6f4b'], 500);
    ctx.strokeStyle = 'rgba(70,52,28,0.8)';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.beginPath();
    ctx.moveTo(4, 4);
    ctx.lineTo(w - 4, h - 4);
    ctx.moveTo(w - 4, 4);
    ctx.lineTo(4, h - 4);
    ctx.stroke();
  });
}

export function sitePaintTexture(letter, hex) {
  const col = `#${hex.toString(16).padStart(6, '0')}`;
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = col;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 96, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.font = 'bold 150px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, w / 2, h / 2 + 8);
  });
}

// Shared materials (created once; the renderer reuses them everywhere).
export function buildMaterials() {
  const std = (opts) => new THREE.MeshStandardMaterial(opts);
  return {
    asphalt: std({ map: asphaltTexture(), roughness: 0.96, metalness: 0.0 }),
    concrete: std({ map: concreteTexture(), roughness: 0.9, metalness: 0.02 }),
    concreteDark: std({ color: PAL.concreteDark, roughness: 0.92 }),
    metal: std({ color: PAL.metal, roughness: 0.55, metalness: 0.6 }),
    crate: std({ map: crateTexture(), roughness: 0.85 }),
    barrel: std({ color: PAL.barrel, roughness: 0.6, metalness: 0.35 }),
    containerTeal: std({ map: containerTexture(PAL.containerTeal, 'NIGHTHAUL LINES', 'NH 2210'), roughness: 0.62, metalness: 0.3 }),
    containerRust: std({ map: containerTexture(PAL.containerRust, 'NIGHTHAUL LINES', 'NH 0874'), roughness: 0.66, metalness: 0.3 }),
    containerSlate: std({ map: containerTexture(PAL.containerSlate, 'PIERLINE', 'PL 5531'), roughness: 0.62, metalness: 0.3 }),
    containerSand: std({ map: containerTexture(PAL.containerSand, 'PIERLINE', 'PL 1190'), roughness: 0.7, metalness: 0.25 }),
    sentinel: std({ color: PAL.sentinel, roughness: 0.8 }),
    sentinelDark: std({ color: 0x2c4f6e, roughness: 0.85 }),
    runner: std({ color: PAL.runner, roughness: 0.8 }),
    runnerDark: std({ color: 0x7e4416, roughness: 0.85 }),
    skin: std({ color: 0xc9a189, roughness: 0.75 }),
    dark: std({ color: 0x23262b, roughness: 0.7, metalness: 0.3 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffb36b }),
    siteA: std({ color: PAL.siteA, roughness: 0.8, emissive: PAL.siteA, emissiveIntensity: 0.12 }),
    siteB: std({ color: PAL.siteB, roughness: 0.8, emissive: PAL.siteB, emissiveIntensity: 0.12 }),
  };
}
