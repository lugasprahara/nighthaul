// NIGHTHAUL's port, as data. A 64 x 64 metre freight yard: x grows east,
// z grows south, y is up. This module is the single source of truth for the
// layout — world.js extrudes the solids into meshes, physics.js collides
// and raycasts against them, bots path over the waypoint graph, and the
// HUD minimap redraws the same boxes.
//
// A solid is an axis-aligned box { x0, x1, z0, z1, y0, y1, mat } where mat
// names a material in palette.js. A solid with y0 above head height (the
// dock canopy) shades and blocks shots but never blocks walking.

export const WORLD_SIZE = 64;

// Box shorthand so the yard reads like a survey, not a spreadsheet.
const box = (x0, x1, z0, z1, y0, y1, mat) => ({ x0, x1, z0, z1, y0, y1, mat });
const wall = (x0, x1, z0, z1, mat = 'concrete') => box(x0, x1, z0, z1, 0, 4.5, mat);
const can = (x0, x1, z0, z1, mat) => box(x0, x1, z0, z1, 0, 2.6, mat); // one container
const can2 = (x0, x1, z0, z1, lo, hi) => [can(x0, x1, z0, z1, lo), box(x0, x1, z0, z1, 2.6, 5.2, hi)];
const crate = (x0, x1, z0, z1, tall = 1.2) => box(x0, x1, z0, z1, 0, tall, 'crate');

export const SOLIDS = [
  // Perimeter.
  wall(-33, 33, -33, -32), wall(-33, 33, 32, 33),
  wall(-33, -32, -32, 32), wall(32, 33, -32, 32),

  // Warehouse (east) — Site A is its loading dock.
  // West wall, dock door open between z 3 and z 8.
  box(17.6, 18.4, -3, 3, 0, 5, 'concrete'),
  box(17.6, 18.4, 8, 17, 0, 5, 'concrete'),
  // North wall, personnel door open between x 24 and x 26.
  box(18.4, 24, -3.4, -2.6, 0, 5, 'concrete'),
  box(26, 32, -3.4, -2.6, 0, 5, 'concrete'),
  // South wall, unbroken.
  box(18.4, 32, 16.6, 17.4, 0, 5, 'concrete'),
  // Dock canopy: a slab on four pillars, overhead only.
  box(19, 31, 1, 14, 4.1, 4.45, 'concrete'),
  box(19.2, 19.7, 1.2, 1.7, 0, 4.1, 'metal'),
  box(30.3, 30.8, 1.2, 1.7, 0, 4.1, 'metal'),
  box(19.2, 19.7, 13.3, 13.8, 0, 4.1, 'metal'),
  box(30.3, 30.8, 13.3, 13.8, 0, 4.1, 'metal'),
  // Cover inside the dock.
  can(21, 27.1, 9.6, 12.1, 'containerTeal'),
  crate(27.8, 29.0, 3.4, 4.6),
  crate(20.2, 21.4, 4.2, 5.4),
  box(20.2, 21.4, 4.2, 5.4, 1.2, 1.8, 'crateHalf'),

  // A-long: the east road from Runner spawn to the dock doors.
  ...can2(20.5, 26.6, -16.5, -14, 'containerRust', 'containerSlate'),
  can(27.5, 30, -9, -3, 'containerSand'),
  can(13.5, 16, -11, -5, 'containerTeal'),

  // Mid: a container canyon running north-south.
  can(-6.4, -3.9, -15, -9, 'containerSlate'),
  can(-6.4, -3.9, -6, 0.5, 'containerRust'),
  can(-6.4, -3.9, 4, 11, 'containerTeal'),
  can(3.9, 6.4, -13, -6.5, 'containerSand'),
  can(3.9, 6.4, -3.5, 3, 'containerTeal'),
  can(3.9, 6.4, 6.5, 13, 'containerRust'),
  // Mid doors: a wall across the canyon at z ~ 0, double door 1.8 m wide.
  box(-3.9, -0.9, -0.4, 0.4, 0, 3.1, 'concreteDark'),
  box(0.9, 3.9, -0.4, 0.4, 0, 3.1, 'concreteDark'),
  crate(-1.6, -0.4, -8.6, -7.4),
  crate(0.6, 1.8, 9.2, 10.4),
  box(0.6, 1.8, 9.2, 10.4, 1.2, 1.8, 'crateHalf'),

  // Dock link: mid-top east, feeding the warehouse's north door.
  can(8, 14.1, -4.4, -1.9, 'containerRust'),
  can(9, 11.5, 3.5, 9.5, 'containerSlate'),

  // B plaza (west) — Site B among the container rows.
  ...can2(-27.5, -21.4, -8.5, -6, 'containerTeal', 'containerRust'),
  can(-19.5, -17, -1.5, 4.5, 'containerSand'),
  can(-28, -25.5, 1, 7, 'containerSlate'),
  crate(-23.8, -22.6, -3.4, -2.2),
  crate(-21.2, -20, -11.6, -10.4),

  // B-main: the west road from Runner spawn to the plaza.
  can(-16.5, -10.4, -19.5, -17, 'containerSlate'),
  can(-26.6, -24.1, -13, -7, 'containerRust'),

  // Service cut: mid-west into B's south entrance.
  can(-13, -10.5, -1, 5, 'containerTeal'),
  can(-15.5, -13, 8.5, 14.5, 'containerSand'),

  // South yard, Sentinel ground between the spawns and the sites.
  can(9.5, 15.6, 18, 20.5, 'containerSlate'),
  can(-15.6, -9.5, 18, 20.5, 'containerTeal'),
  crate(12, 13.2, 9, 10.2),
  crate(-13.2, -12, 9, 10.2),
  box(-1.2, 0, 19.5, 20.7, 0, 0.6, 'crateHalf'),
];

// Decorative barrel clusters (no collision, pure dressing).
export const BARRELS = [
  [16.8, -6.5], [17.5, -5.6], [-8.2, -12.5], [8.6, 12.8], [-18.6, -14.8],
  [28.6, 15.2], [-29.5, -2.5], [5.2, -19.5], [-5.8, 22.5], [22.5, -21.5],
];

// The two plant sites. A is the warehouse dock (Pier 7), B the container
// plaza (Quay 3).
export const SITES = {
  A: { id: 'A', name: 'Pier 7', x: 25, z: 6.5, r: 5.2 },
  B: { id: 'B', name: 'Quay 3', x: -23.5, z: -4.5, r: 5.2 },
};

// Round-start lines, five per side. Sentinels south, Runners north.
export const SPAWNS = {
  sentinel: [
    { x: -4, z: 27 }, { x: -2, z: 28 }, { x: 0, z: 27 }, { x: 2, z: 28 }, { x: 4, z: 27 },
  ],
  runner: [
    { x: -4, z: -27 }, { x: -2, z: -28 }, { x: 0, z: -27 }, { x: 2, z: -28 }, { x: 4, z: -27 },
  ],
};

// ---------------------------------------------------------------------------
// Waypoint graph. Bots travel node to node; a route is a breadth-first walk
// over LINKS. `hold` marks a strong defensive angle, `site` the node inside
// each plant site. Every link's straight line has been audited against the
// solids: links thread the dock door (z 3..8), the warehouse's north door
// (x 24..26), the mid doors (x -0.9..0.9) and the gap in mid's west wall
// (z 0.5..4) rather than crossing container faces.

const NODE_ROWS = [
  // id, x, z, flags
  ['j_spawn', 0, -26], ['j_split', 0, -19],
  ['a_long_top', 17, -21], ['a_long', 22, -21], ['a_long_w', 18.5, -15],
  ['a_long_mid', 19.8, -8], ['a_door_n', 25, -4.5], ['a_door', 25, -0.5],
  ['a_site', 25, 6.5, 'A'], ['a_door_w', 18, 5.5], ['a_in_w', 20.2, 8.5],
  ['a_hold', 20.6, 14.6, 'hold'],
  ['dock_link_top', 11, -13.5], ['dock_top_e', 17.5, -12.8],
  ['dock_link_nw', 7.3, -6.2], ['dock_link_w', 7.5, -3.5],
  ['mid_top', 0, -16], ['mid_up', 0, -8], ['mid_doors', 0, 0],
  ['mid_west', -5.2, 2.6], ['mid_low', 0, 8.5], ['mid_bot', 0, 15.5],
  ['cut_w', -9, 2.5], ['cut_s', -9, 9],
  ['b_link_w', -15.8, 6.8], ['b_south', -21, 6.5],
  ['b_site_e', -20.8, -3.2], ['b_site', -23.5, -4.5, 'B'],
  ['b_ne', -20.2, -5.2], ['b_hold', -18.9, -8.6, 'hold'],
  ['b_main_e', -19.6, -12.8], ['b_main_bot', -21.5, -13.5], ['b_main_top', -19, -21.5],
  ['w_split', 0, 21], ['w_spawn', 0, 26.5],
  ['w_to_a', 11, 14.5], ['w_to_b', -11, 14.5],
  ['a_approach', 15.5, 8], ['mid_hold', -2.2, 12.4, 'hold'],
];

export const NODES = NODE_ROWS.map(([id, x, z, flag]) => {
  const n = { id, x, z };
  if (flag === 'hold') n.hold = true;
  else if (flag) n.site = flag;
  return n;
});

export const LINKS = [
  ['j_spawn', 'j_split'],
  ['j_split', 'a_long_top'], ['j_split', 'mid_top'], ['j_split', 'b_main_top'],
  ['a_long_top', 'a_long'], ['a_long', 'a_long_w'], ['a_long_w', 'a_long_mid'],
  ['a_long_mid', 'a_door_n'], ['a_door_n', 'a_door'], ['a_door', 'a_site'],
  ['dock_link_w', 'dock_link_nw'], ['dock_link_nw', 'dock_link_top'],
  ['mid_up', 'dock_link_w'], ['dock_link_top', 'dock_top_e'], ['dock_top_e', 'a_long_mid'],
  ['a_site', 'a_in_w'], ['a_site', 'a_door_w'], ['a_door_w', 'a_approach'],
  ['a_in_w', 'a_hold'], ['a_in_w', 'a_door_w'],
  ['mid_top', 'mid_up'], ['mid_up', 'mid_doors'], ['mid_doors', 'mid_low'],
  ['mid_doors', 'mid_west'], ['mid_west', 'cut_w'], ['cut_w', 'cut_s'],
  ['cut_s', 'b_link_w'], ['b_link_w', 'b_south'], ['b_south', 'b_site_e'],
  ['b_site_e', 'b_site'], ['b_site', 'b_ne'], ['b_ne', 'b_hold'],
  ['b_ne', 'b_main_e'], ['b_main_e', 'b_main_bot'], ['b_main_bot', 'b_main_top'],
  ['mid_low', 'mid_bot'], ['mid_low', 'mid_hold'], ['mid_hold', 'mid_bot'],
  ['mid_bot', 'w_split'],
  ['w_split', 'w_spawn'], ['w_split', 'w_to_a'], ['w_split', 'w_to_b'],
  ['w_to_a', 'a_approach'], ['w_to_b', 'cut_s'],
];

// Index-based adjacency for the router.
const INDEX = new Map(NODES.map((n, i) => [n.id, i]));
const NEIGHBOURS = NODES.map(() => []);
for (const [a, b] of LINKS) {
  NEIGHBOURS[INDEX.get(a)].push(INDEX.get(b));
  NEIGHBOURS[INDEX.get(b)].push(INDEX.get(a));
}

export function nearestNode(x, z) {
  let pick = NODES[0];
  let pickD = Infinity;
  for (const n of NODES) {
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
    if (d < pickD) {
      pickD = d;
      pick = n;
    }
  }
  return pick;
}

// Route from (x0, z0) to (x1, z1): snap both ends to the graph, breadth-
// first between the snapped nodes, then finish at the exact target point.
// Returns a list of {x, z} waypoints.
export function findRoute(x0, z0, x1, z1) {
  const from = INDEX.get(nearestNode(x0, z0).id);
  const to = INDEX.get(nearestNode(x1, z1).id);
  if (from === to) return [{ x: x1, z: z1 }];

  const cameFrom = new Int32Array(NODES.length).fill(-1);
  cameFrom[from] = from;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur === to) break;
    for (const next of NEIGHBOURS[cur]) {
      if (cameFrom[next] === -1) {
        cameFrom[next] = cur;
        queue.push(next);
      }
    }
  }
  if (cameFrom[to] === -1) return [{ x: x1, z: z1 }];

  const chain = [];
  for (let cur = to; cur !== from; cur = cameFrom[cur]) chain.push(cur);
  chain.reverse();
  const pts = chain.map((i) => ({ x: NODES[i].x, z: NODES[i].z }));
  pts.push({ x: x1, z: z1 });
  return pts;
}

// The site whose circle holds the point, or null.
export function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz <= s.r * s.r) return s;
  }
  return null;
}
