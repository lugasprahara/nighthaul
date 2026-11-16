// NIGHTHAUL — entry program for the threejs-fps-01 bounty.
//
// The game is plain static files (game/: ES modules, three.js vendored,
// no build step). This program is the courier that assembles the
// deliverable: it mirrors game/ and screenshots/ into the output
// directory and writes dossier.json there with the kit's buildDossier,
// byte for byte the way the scorer rebuilds it.
//
// Run locally:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play locally: node serve.ts  (then open http://localhost:8080)

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Mirror the two payload trees into the output directory.
mkdirSync(outDir, { recursive: true });
cpSync(join(here, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// The caps mirror the scorer's gate, so a local run refuses anything the
// real gate would refuse: dossier text cap, at most 4 screenshots of at
// most 256 KiB each, game/ at most 993 entries and 48 MiB in total.
const LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, LIMITS));
