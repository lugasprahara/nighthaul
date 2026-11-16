// NIGHTHAUL: the map as data. One freight depot, 64 x 64 metres, x east,
// z south. Everything that needs the map reads it from here: world.js builds
// the meshes, the physics uses `solids` for collision and raycasts, bots
// walk the waypoint graph, and the minimap draws the same boxes.
//
// A solid is a 3D box: { x0, x1, z0, z1, y0, y1, mat } — mat names a material
// from palette.js (containers also name their texture variant).

export const WORLD_SIZE = 64;

export const SOLIDS = [
  // Perimeter walls.
  { x0: -33, x1: 33, z0: -33, z1: -32, y0: 0, y1: 4.5, mat: 'concrete' },
  { x0: -33, x1: 33, z0: 32, z1: 33, y0: 0, y1: 4.5, mat: 'concrete' },
  { x0: -33, x1: -32, z0: -32, z1: 32, y0: 0, y1: 4.5, mat: 'concrete' },
  { x0: 32, x1: 33, z0: -32, z1: 32, y0: 0, y1: 4.5, mat: 'concrete' },

  // --- Warehouse (east): Site A is its loading dock. ---
  // West wall with a wide dock door (z 3..8 open).
  { x0: 17.6, x1: 18.4, z0: -3, z1: 3, y0: 0, y1: 5, mat: 'concrete' },
  { x0: 17.6, x1: 18.4, z0: 8, z1: 17, y0: 0, y1: 5, mat: 'concrete' },
  // North wall with a personnel door (x 24..26 open).
  { x0: 18.4, x1: 24, z0: -3.4, z1: -2.6, y0: 0, y1: 5, mat: 'concrete' },
  { x0: 26, x1: 32, z0: -3.4, z1: -2.6, y0: 0, y1: 5, mat: 'concrete' },
  // South wall, solid.
  { x0: 18.4, x1: 32, z0: 16.6, z1: 17.4, y0: 0, y1: 5, mat: 'concrete' },
  // Canopy slab over the dock on four pillars (overhead only: y0 = 4.1).
  { x0: 19, x1: 31, z0: 1, z1: 14, y0: 4.1, y1: 4.45, mat: 'concrete' },
  { x0: 19.2, x1: 19.7, z0: 1.2, z1: 1.7, y0: 0, y1: 4.1, mat: 'metal' },
  { x0: 30.3, x1: 30.8, z0: 1.2, z1: 1.7, y0: 0, y1: 4.1, mat: 'metal' },
  { x0: 19.2, x1: 19.7, z0: 13.3, z1: 13.8, y0: 0, y1: 4.1, mat: 'metal' },
  { x0: 30.3, x1: 30.8, z0: 13.3, z1: 13.8, y0: 0, y1: 4.1, mat: 'metal' },
  // Inside the dock: a container and crates as cover.
  { x0: 21, x1: 27.1, z0: 9.6, z1: 12.1, y0: 0, y1: 2.6, mat: 'containerTeal' },
  { x0: 27.8, x1: 29.0, z0: 3.4, z1: 4.6, y0: 0, y1: 1.2, mat: 'crate' },
  { x0: 20.2, x1: 21.4, z0: 4.2, z1: 5.4, y0: 0, y1: 1.2, mat: 'crate' },
  { x0: 20.2, x1: 21.4, z0: 4.2, z1: 5.4, y0: 1.2, y1: 1.8, mat: 'crateHalf' },

  // --- A-long: the east road from Runner spawn down to the dock doors. ---
  { x0: 20.5, x1: 26.6, z0: -16.5, z1: -14, y0: 0, y1: 2.6, mat: 'containerRust' },
  { x0: 20.5, x1: 26.6, z0: -16.5, z1: -14, y0: 2.6, y1: 5.2, mat: 'containerSlate' },
  { x0: 27.5, x1: 30, z0: -9, z1: -3, y0: 0, y1: 2.6, mat: 'containerSand' },
  { x0: 13.5, x1: 16, z0: -11, z1: -5, y0: 0, y1: 2.6, mat: 'containerTeal' },

  // --- Mid: a container canyon running north-south, cut by mid doors. ---
  { x0: -6.4, x1: -3.9, z0: -15, z1: -9, y0: 0, y1: 2.6, mat: 'containerSlate' },
  { x0: -6.4, x1: -3.9, z0: -6, z1: 0.5, y0: 0, y1: 2.6, mat: 'containerRust' },
  { x0: -6.4, x1: -3.9, z0: 4, z1: 11, y0: 0, y1: 2.6, mat: 'containerTeal' },
  { x0: 3.9, x1: 6.4, z0: -13, z1: -6.5, y0: 0, y1: 2.6, mat: 'containerSand' },
  { x0: 3.9, x1: 6.4, z0: -3.5, z1: 3, y0: 0, y1: 2.6, mat: 'containerTeal' },
  { x0: 3.9, x1: 6.4, z0: 6.5, z1: 13, y0: 0, y1: 2.6, mat: 'containerRust' },
  // Mid doors: a wall across the canyon at z ~ 0 with a 1.8 m double door.
  { x0: -3.9, x1: -0.9, z0: -0.4, z1: 0.4, y0: 0, y1: 3.1, mat: 'concreteDark' },
  { x0: 0.9, x1: 3.9, z0: -0.4, z1: 0.4, y0: 0, y1: 3.1, mat: 'concreteDark' },
  // Crates in mid.
  { x0: -1.6, x1: -0.4, z0: -8.6, z1: -7.4, y0: 0, y1: 1.2, mat: 'crate' },
  { x0: 0.6, x1: 1.8, z0: 9.2, z1: 10.4, y0: 0, y1: 1.2, mat: 'crate' },
  { x0: 0.6, x1: 1.8, z0: 9.2, z1: 10.4, y0: 1.2, y1: 1.8, mat: 'crateHalf' },

  // --- Dock link: mid-top east into the warehouse's north door. ---
  { x0: 8, x1: 14.1, z0: -4.4, z1: -1.9, y0: 0, y1: 2.6, mat: 'containerRust' },
  { x0: 9, x1: 11.5, z0: 3.5, z1: 9.5, y0: 0, y1: 2.6, mat: 'containerSlate' },

  // --- B plaza (west): Site B among container rows. ---
  { x0: -27.5, x1: -21.4, z0: -8.5, z1: -6, y0: 0, y1: 2.6, mat: 'containerTeal' },
  { x0: -27.5, x1: -21.4, z0: -8.5, z1: -6, y0: 2.6, y1: 5.2, mat: 'containerRust' },
  { x0: -19.5, x1: -17, z0: -1.5, z1: 4.5, y0: 0, y1: 2.6, mat: 'containerSand' },
  { x0: -28, x1: -25.5, z0: 1, z1: 7, y0: 0, y1: 2.6, mat: 'containerSlate' },
  { x0: -23.8, x1: -22.6, z0: -3.4, z1: -2.2, y0: 0, y1: 1.2, mat: 'crate' },
  { x0: -21.2, x1: -20, z0: -11.6, z1: -10.4, y0: 0, y1: 1.2, mat: 'crate' },

  // --- B-main: the west road from Runner spawn to the plaza. ---
  { x0: -16.5, x1: -10.4, z0: -19.5, z1: -17, y0: 0, y1: 2.6, mat: 'containerSlate' },
  { x0: -26.6, x1: -24.1, z0: -13, z1: -7, y0: 0, y1: 2.6, mat: 'containerRust' },

  // --- Service cut: mid-west into B's south entrance. ---
  { x0: -13, x1: -10.5, z0: -1, z1: 5, y0: 0, y1: 2.6, mat: 'containerTeal' },
  { x0: -15.5, x1: -13, z0: 8.5, z1: 14.5, y0: 0, y1: 2.6, mat: 'containerSand' },

  // --- South yard between the spawns and the sites (Sentinel ground). ---
  { x0: 9.5, x1: 15.6, z0: 18, z1: 20.5, y0: 0, y1: 2.6, mat: 'containerSlate' },
  { x0: -15.6, x1: -9.5, z0: 18, z1: 20.5, y0: 0, y1: 2.6, mat: 'containerTeal' },
  { x0: 12, x1: 13.2, z0: 9, z1: 10.2, y0: 0, y1: 1.2, mat: 'crate' },
  { x0: -13.2, x1: -12, z0: 9, z1: 10.2, y0: 0, y1: 1.2, mat: 'crate' },
  { x0: -1.2, x1: 0, z0: 19.5, z1: 20.7, y0: 0, y1: 0.6, mat: 'crateHalf' },
];

// Decorative barrels (no collision): clusters near walls and corners.
export const BARRELS = [
  [16.8, -6.5], [17.5, -5.6], [-8.2, -12.5], [8.6, 12.8], [-18.6, -14.8],
  [28.6, 15.2], [-29.5, -2.5], [5.2, -19.5], [-5.8, 22.5], [22.5, -21.5],
];

export const SITES = {
  A: { id: 'A', name: 'Pier 7', x: 25, z: 6.5, r: 5.2 },
  B: { id: 'B', name: 'Quay 3', x: -23.5, z: -4.5, r: 5.2 },
};

export const SPAWNS = {
  sentinel: [
    { x: -4, z: 27 }, { x: -2, z: 28 }, { x: 0, z: 27 }, { x: 2, z: 28 }, { x: 4, z: 27 },
  ],
  runner: [
    { x: -4, z: -27 }, { x: -2, z: -28 }, { x: 0, z: -27 }, { x: 2, z: -28 }, { x: 4, z: -27 },
  ],
};

// Waypoint graph for the bots. `hold` nodes are good defensive angles;
// `site` nodes sit inside a bomb site; routes are found by breadth-first
// search over `links`. Every link's straight line has been checked against
// the solids above: a link that crosses a container would strand a bot
// against its face, so links route around corners, through the door gaps
// in the warehouse walls (dock door z 3..8, north door x 24..26) and
// through the gap in mid's west containers (z 0.5..4).
export const NODES = [
  { id: 'j_spawn', x: 0, z: -26 },
  { id: 'j_split', x: 0, z: -19 },
  { id: 'a_long_top', x: 17, z: -21 },
  { id: 'a_long', x: 22, z: -21 },
  { id: 'a_long_w', x: 18.5, z: -15 },
  { id: 'a_long_mid', x: 19.8, z: -8 },
  { id: 'a_door_n', x: 25, z: -4.5 },
  { id: 'a_door', x: 25, z: -0.5 },
  { id: 'a_site', x: 25, z: 6.5, site: 'A' },
  { id: 'a_door_w', x: 18, z: 5.5 },
  { id: 'a_in_w', x: 20.2, z: 8.5 },
  { id: 'a_hold', x: 20.6, z: 14.6, hold: true },
  { id: 'dock_link_top', x: 11, z: -13.5 },
  { id: 'dock_top_e', x: 17.5, z: -12.8 },
  { id: 'dock_link_nw', x: 7.3, z: -6.2 },
  { id: 'dock_link_w', x: 7.5, z: -3.5 },
  { id: 'mid_top', x: 0, z: -16 },
  { id: 'mid_up', x: 0, z: -8 },
  { id: 'mid_doors', x: 0, z: 0 },
  { id: 'mid_west', x: -5.2, z: 2.6 },
  { id: 'mid_low', x: 0, z: 8.5 },
  { id: 'mid_bot', x: 0, z: 15.5 },
  { id: 'cut_w', x: -9, z: 2.5 },
  { id: 'cut_s', x: -9, z: 9 },
  { id: 'b_link_w', x: -15.8, z: 6.8 },
  { id: 'b_south', x: -21, z: 6.5 },
  { id: 'b_site_e', x: -20.8, z: -3.2 },
  { id: 'b_site', x: -23.5, z: -4.5, site: 'B' },
  { id: 'b_ne', x: -20.2, z: -5.2 },
  { id: 'b_hold', x: -18.9, z: -8.6, hold: true },
  { id: 'b_main_e', x: -19.6, z: -12.8 },
  { id: 'b_main_bot', x: -21.5, z: -13.5 },
  { id: 'b_main_top', x: -19, z: -21.5 },
  { id: 'w_split', x: 0, z: 21 },
  { id: 'w_spawn', x: 0, z: 26.5 },
  { id: 'w_to_a', x: 11, z: 14.5 },
  { id: 'w_to_b', x: -11, z: 14.5 },
  { id: 'a_approach', x: 15.5, z: 8 },
  { id: 'mid_hold', x: -2.2, z: 12.4, hold: true },
];

export const LINKS = [
  ['j_spawn', 'j_split'],
  ['j_split', 'a_long_top'], ['j_split', 'mid_top'], ['j_split', 'b_main_top'],
  ['a_long_top', 'a_long'], ['a_long', 'a_long_w'], ['a_long_w', 'a_long_mid'],
  ['a_long_mid', 'a_door_n'], ['a_door_n', 'a_door'],
  ['a_door', 'a_site'],
  ['dock_link_w', 'dock_link_nw'], ['dock_link_nw', 'dock_link_top'], ['mid_up', 'dock_link_w'],
  ['dock_link_top', 'dock_top_e'], ['dock_top_e', 'a_long_mid'],
  ['a_long_mid', 'a_door_n'],
  ['a_site', 'a_in_w'], ['a_site', 'a_door_w'], ['a_door_w', 'a_approach'], ['a_in_w', 'a_hold'], ['a_in_w', 'a_door_w'],
  ['mid_top', 'mid_up'], ['mid_up', 'mid_doors'], ['mid_doors', 'mid_low'],
  ['mid_doors', 'mid_west'], ['mid_west', 'cut_w'], ['cut_w', 'cut_s'],
  ['cut_s', 'b_link_w'], ['b_link_w', 'b_south'], ['b_south', 'b_site_e'], ['b_site_e', 'b_site'],
  ['b_site', 'b_ne'], ['b_ne', 'b_hold'], ['b_ne', 'b_main_e'], ['b_main_e', 'b_main_bot'],
  ['b_main_bot', 'b_main_top'],
  ['mid_low', 'mid_bot'], ['mid_low', 'mid_hold'], ['mid_hold', 'mid_bot'],
  ['mid_bot', 'w_split'],
  ['w_split', 'w_spawn'], ['w_split', 'w_to_a'], ['w_split', 'w_to_b'],
  ['w_to_a', 'a_approach'],
  ['w_to_b', 'cut_s'],
];

const nodeById = new Map(NODES.map((n) => [n.id, n]));
const adjacency = new Map(NODES.map((n) => [n.id, []]));
for (const [a, b] of LINKS) {
  adjacency.get(a).push(b);
  adjacency.get(b).push(a);
}

export function nearestNode(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const n of NODES) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

// Breadth-first route between two points (via their nearest nodes).
// Returns a list of {x, z} waypoints ending at the target point itself.
export function findRoute(x0, z0, x1, z1) {
  const start = nearestNode(x0, z0);
  const goal = nearestNode(x1, z1);
  if (start === goal) return [{ x: x1, z: z1 }];
  const prev = new Map([[start.id, null]]);
  const queue = [start.id];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === goal.id) break;
    for (const next of adjacency.get(cur)) {
      if (!prev.has(next)) {
        prev.set(next, cur);
        queue.push(next);
      }
    }
  }
  if (!prev.has(goal.id)) return [{ x: x1, z: z1 }];
  const ids = [];
  for (let cur = goal.id; cur !== null; cur = prev.get(cur)) ids.push(cur);
  ids.reverse();
  const pts = ids.map((id) => {
    const n = nodeById.get(id);
    return { x: n.x, z: n.z };
  });
  pts.push({ x: x1, z: z1 });
  return pts;
}

// Which site a point belongs to, if any.
export function siteAt(x, z) {
  for (const s of Object.values(SITES)) {
    if ((x - s.x) ** 2 + (z - s.z) ** 2 <= s.r * s.r) return s;
  }
  return null;
}
