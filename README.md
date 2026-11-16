# nighthaul

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/lugasprahara/nighthaul/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/lugasprahara/nighthaul/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS for the browser, built with three.js. Five
Sentinels hold a container port at night; five Runners try to plant a
breach charge on site A (Pier 7 warehouse dock) or site B (the Quay 3
container rows). Short rounds, money for kills and round wins, a buy
menu between rounds, a halftime break where the sides swap, and
overtime if twelve rounds end dead level. First team to seven rounds
takes the port.

Single player against bots. No build step, no network requests: open the
page and play.

## Run it

```sh
node serve.ts        # then open http://localhost:8080
```

Click **Deploy**, shop during the buy phase (the menu opens on its own),
and play the round.

## Play

| Keys | Action |
| --- | --- |
| W A S D / mouse | Move / look |
| Click / right-click | Fire / scope (Osprey) |
| R | Reload |
| 1 / 2 / Q | Primary / sidearm / last weapon |
| Ctrl or C | Crouch — steadier aim, quieter |
| Shift | Walk — slower and quieter |
| Space | Jump |
| B | Buy menu (buy phase) |
| E (hold) | Plant or defuse the charge |
| 3 / 4 / 5 (or F) | Throw frag / flash / smoke grenade |

## The game

- **Gunplay that rewards stopping.** Hitscan weapons with a spread cone
  that grows with movement, air time and sustained fire, and shrinks when
  you stop and crouch. Headshots multiply damage; kevlar halves body
  damage and a helmet softens headshots. Five weapons: Nightowl P9 pistol,
  Gull pump shotgun, Rook SMG, Vandal rifle, Osprey bolt-action sniper.
- **An objective, not just kills.** The Runners' carrier plants the charge
  at a site (hold E); it detonates in 40 seconds unless a Sentinel defuses
  it (hold E). Elimination, detonation, defuse and time all end rounds.
- **Economy.** $800 start, $300 a kill, win/loss bonuses that scale with
  consecutive losses. Rifles, armour and grenades come from the buy menu.
- **Bots with roles and a plan.** Each round the bots take roles: the
  charge carrier leads as ENTRY, a SUPPORT trails to trade their fights,
  a LURKER works the far lane quietly and pinches late, while Sentinel
  ANCHORS hold each site and a ROTATOR swings to trouble. The first
  contact starts the team's execute clock — a beat later the hit commits
  together. Bots route over a waypoint graph, hold angles, react to
  gunfire and footsteps, lose you in smoke, push last-known positions,
  plant, guard, retake and defuse. Their reaction time and aim error are
  human-shaped: they miss more when you move.
- **A match with a shape.** Twelve regulation rounds, first to seven.
  Round 7 opens with a halftime phase — play freezes, the teams trade
  ends and re-kit on a fresh $800, and the score so far is announced.
  At 6–6 the match goes to overtime: fresh stakes, first to two rounds.
- **An original map.** NIGHTHAUL is a night container port with two sites,
  a mid canyon cut by double doors, a dock link into the Pier 7 warehouse,
  and a service cut to B — lanes, corners and crossfires, drawn from one
  data file that also drives collision, bot navigation and the minimap.
  Sodium floodlights and cold moonlight do the lighting; the fog keeps
  sightlines short and tense after dark.
- **Sound from code.** Every effect — gunfire per weapon, footsteps,
  reloads, the charge's accelerating beeps, round stingers — is
  synthesised with WebAudio. There are no audio files.

## Layout

- `main.ts` — the entry program: copies `game/` and `screenshots/` to the
  output directory and writes `dossier.json` with the vendored library.
- `game/index.html` — the page, HUD structure and all CSS.
- `game/src/` — one module per job:
  - `main.js` boot, fixed-step loop, camera, screenshot poses
  - `mapdata.js` the map as data: solids, sites, spawns, waypoint graph
  - `world.js` builds the three.js scene from the map data
  - `physics.js` circle-vs-box movement, ground heights, ray-vs-box tests
  - `player.js` the human controller, the shared firing routine, viewmodel
  - `bots.js` bot bodies and brains (roles, team calls, perception, combat)
  - `match.js` rounds, phases (buy/live/halftime/overtime), economy, the charge
  - `weapons.js` weapon table and the spread/damage model
  - `grenades.js` thrown grenades: frag, flash, smoke
  - `fx.js` pooled tracers, particles, muzzle flash, smoke clouds
  - `hud.js` DOM HUD, killfeed, buy menu, minimap
  - `audio.js` synthesised sound effects
  - `actor.js` shared combatant state (health, armour, loadout)
  - `palette.js` the night palette, canvas textures, shared materials
  - `input.js` keyboard, mouse and pointer lock
- `game/vendor/three/` — three.js 0.187.0, vendored per the bounty rules.
- `screenshots/` — real renders of this game (`?shot=` poses in
  `game/src/main.js` compose them deterministically).

MIT licensed (LICENSE). three.js is MIT licensed by its authors
(`game/vendor/three/LICENSE`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=aes5np1n&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
