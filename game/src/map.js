// map.js — Breakwater Depot: an original harbor yard. Two plant sites (A the
// crane yard, B the warehouse), a mid plaza, and the lanes and links between
// them. This module owns the world's boxes: it builds the meshes, keeps the
// collider list, answers ray and line-of-sight questions, moves actors through
// the world, and holds the waypoint graph the bots navigate by.

import * as THREE from 'three';
import { G, TEAM, rand } from './state.js';
import { makeMaterials, labelTexture } from './textures.js';

export const SITES = {
  A: { x: -21, z: -21, r: 6.5, name: 'CRANE YARD' },
  B: { x: 21, z: 19, r: 6.5, name: 'WAREHOUSE' },
};
export const SPAWNS = {
  atk: [[-27, 27], [-24, 28], [-21, 27], [-25, 24], [-28, 24]].map(([x, z]) => ({ x, z })),
  def: [[27, -27], [24, -28], [21, -27], [25, -24], [28, -24]].map(([x, z]) => ({ x, z })),
};
export const colliders = []; // {x0,y0,z0,x1,y1,z1}
let mats = null;

function addBox(x, z, w, d, h, mat, { y = 0, collide = true, cast = true } = {}) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(w, h, d); m.position.set(x, y + h / 2, z);
  m.castShadow = cast; m.receiveShadow = true;
  scene.add(m);
  if (collide) colliders.push({ x0: x - w / 2, y0: y, z0: z - d / 2, x1: x + w / 2, y1: y + h, z1: z + d / 2 });
  return m;
}
let scene = null, boxGeo = null;

export function buildMap(scn) {
  scene = scn; boxGeo = new THREE.BoxGeometry(1, 1, 1);
  mats = makeMaterials();
  // --- ground & sky dressing
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(76, 76), mats.asphalt);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(15.5, 15.5), mats.sand);
  apron.rotation.x = -Math.PI / 2; apron.position.set(SITES.A.x, 0.01, SITES.A.z); apron.receiveShadow = true; scene.add(apron);
  // distant harbor silhouettes (visual only, outside the walls)
  for (const [x, z, w, h, d] of [[-58, -30, 30, 16, 10], [52, -44, 36, 22, 12], [58, 26, 26, 12, 10], [-52, 34, 30, 10, 10], [0, -58, 60, 14, 8]]) {
    const m = new THREE.Mesh(boxGeo, mats.ink); m.scale.set(w, h, d); m.position.set(x, h / 2, z); scene.add(m);
  }
  // --- perimeter
  addBox(0, -34.5, 71, 1.5, 5.5, mats.concreteDark); addBox(0, 34.5, 71, 1.5, 5.5, mats.concreteDark);
  addBox(-34.5, 0, 1.5, 71, 5.5, mats.concreteDark); addBox(34.5, 0, 1.5, 71, 5.5, mats.concreteDark);
  // --- warehouse (site B shell, three door gaps)
  const W = mats.concrete;
  addBox(15, 11, 6, 1, 4.2, W); addBox(26, 11, 8, 1, 4.2, W);
  addBox(12.5, 19, 1, 15, 4.2, W);
  addBox(29.5, 15.5, 1, 8, 4.2, W); addBox(29.5, 25, 1, 5, 4.2, W);
  addBox(16, 27.5, 8, 1, 4.2, W); addBox(26.5, 27.5, 7, 1, 4.2, W);
  addBox(21, 11, 18, 0.35, 0.3, mats.ink, { y: 4.2, collide: false }); // lintel beam
  addBox(21, 19, 5.4, 2.4, 2.6, mats.steelBlue);                      // inside container
  addBox(16.5, 23.5, 2.4, 2.4, 1.2, mats.timber); addBox(16.5, 23.5, 1.8, 1.8, 1.1, mats.timber, { y: 1.2 });
  // --- crane over site A (legs collide, beam is dressing)
  addBox(-27.5, -27.5, 1.1, 1.1, 11, mats.orange); addBox(-14.5, -27.5, 1.1, 1.1, 11, mats.orange);
  addBox(-27.5, -14.5, 1.1, 1.1, 11, mats.orange); addBox(-14.5, -14.5, 1.1, 1.1, 11, mats.orange);
  const beam = new THREE.Mesh(boxGeo, mats.orange); beam.scale.set(17, 1.2, 1.6); beam.position.set(-21, 11.4, -21); beam.castShadow = true; scene.add(beam);
  const cable = new THREE.Mesh(boxGeo, mats.ink); cable.scale.set(0.12, 5.5, 0.12); cable.position.set(-19, 8.4, -21); scene.add(cable);
  const hook = new THREE.Mesh(boxGeo, mats.steelRust); hook.scale.set(3.4, 2.2, 2.2); hook.position.set(-19, 4.6, -21); hook.castShadow = true; scene.add(hook);
  colliders.push({ x0: -20.7, y0: 3.5, z0: -22.1, x1: -17.3, y1: 5.7, z1: -19.9 });
  // --- containers & crates: the cover language of every lane
  const C = (x, z, vert, mat, stack = 1) => addBox(x, z, vert ? 2.4 : 6, vert ? 6 : 2.4, 2.6 * stack, mat);
  C(-13, -26, false, mats.steel, 2); C(-27, -14, true, mats.steelRust); C(-14, -12.5, false, mats.steelBlue);
  C(-25, 10, false, mats.steel); C(26, 2, true, mats.steelRust); C(8, 26, false, mats.steelBlue);
  C(0, -6.5, false, mats.steelRust); C(-3, 7, true, mats.steel); C(26, -10, true, mats.steel, 2);
  C(-30, 18, true, mats.steelBlue); C(14, -18, false, mats.steel); C(-8, -24, false, mats.steelBlue);
  const K = (x, z, n = 2) => { addBox(x, z, 2.4, 2.4, 1.2 * n, mats.timber); };
  K(-26, -2); K(6, 2, 3); K(-12, 3); K(17, 6); K(-6, 26, 1); K(24, -20); K(-18, -6, 1); K(11, -12, 2); K(-24, 20, 1);
  const B = (x, z, vert) => addBox(x, z, vert ? 0.55 : 2.2, vert ? 2.2 : 0.55, 1.05, mats.concrete); // jersey barrier
  B(-18, 20); B(18, -20); B(-2, -1); B(3, -1); B(12, 16); B(-16, -16); B(24, 12); B(-10, 14); B(8, -20);
  // light poles (visual rhythm + screenshot depth)
  for (const [x, z] of [[-30, -30], [30, -30], [-30, 30], [30, 30], [0, 12], [-12, -12]]) {
    addBox(x, z, 0.25, 0.25, 6.5, mats.ink);
    const lamp = new THREE.Mesh(boxGeo, mats.cream); lamp.scale.set(1.4, 0.18, 0.5); lamp.position.set(x, 6.5, z); scene.add(lamp);
  }
  // --- site markings & labels
  for (const [id, S] of Object.entries(SITES)) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(S.r - 0.5, S.r, 40),
      new THREE.MeshBasicMaterial({ color: id === 'A' ? 0xd96c27 : 0x2e8fa3, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(S.x, 0.02, S.z); scene.add(ring);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({ map: labelTexture(id), transparent: true, opacity: 0.9 }));
    label.rotation.x = -Math.PI / 2; label.position.set(S.x, 0.03, S.z); scene.add(label);
  }
  buildNav();
  return mats;
}

// ---------- navigation graph: nodes auto-linked by range + line of sight
export const nav = { nodes: [], edges: [] };
const NAV_POINTS = [
  [-24, 24], [-25, 14], [-26, 4], [-26, -6], [-24, -14], [-21, -16],           // A lane
  [-21, -21], [-16, -24], [-25, -25], [-12, -18],                              // site A + holds
  [-12, -25], [0, -26], [12, -25], [20, -22], [24, -24],                       // north lane
  [-16, -4], [-10, -4], [-2, -2], [0, -11], [4, 4], [10, 0],                   // links + mid
  [10, 8], [16, 8], [20, 13],                                                  // B link
  [26, -8], [26, 2], [25, 8], [27, 21],                                        // east lane
  [-12, 26], [2, 25], [12, 24], [21, 24],                                      // south lane
  [21, 19], [16, 15], [25, 23], [15, 21],                                      // site B + holds
  [2, 12], [-8, 12],                                                           // mid-south
];
function buildNav() {
  nav.nodes = NAV_POINTS.map(([x, z], i) => ({ i, x, z, edges: [] }));
  for (const a of nav.nodes) for (const b of nav.nodes) {
    if (a.i >= b.i) continue;
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d > 16) continue;
    if (!losClear({ x: a.x, y: 1.1, z: a.z }, { x: b.x, y: 1.1, z: b.z }, true)) continue;
    a.edges.push(b.i); b.edges.push(a.i);
  }
}
export function nearestNode(x, z) {
  let best = null, bd = 1e9;
  for (const n of nav.nodes) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } }
  return best;
}
// A* over the waypoint graph; returns a list of {x,z} waypoints (may be empty).
const _open = [], _came = new Map(), _gs = new Map();
export function findPath(sx, sz, tx, tz) {
  const start = nearestNode(sx, sz), goal = nearestNode(tx, tz);
  if (!start || !goal) return [];
  if (start === goal) return [{ x: tx, z: tz }];
  _came.clear(); _gs.clear(); _open.length = 0;
  _gs.set(start.i, 0); _open.push(start);
  const h = (n) => Math.hypot(n.x - goal.x, n.z - goal.z);
  while (_open.length) {
    let bi = 0;
    for (let i = 1; i < _open.length; i++)
      if ((_gs.get(_open[i].i) ?? 1e9) + h(_open[i]) < (_gs.get(_open[bi].i) ?? 1e9) + h(_open[bi])) bi = i;
    const cur = _open.splice(bi, 1)[0];
    if (cur === goal) {
      const path = []; let n = cur;
      while (n) { path.push({ x: n.x, z: n.z }); n = _came.get(n.i); }
      path.reverse(); path.push({ x: tx, z: tz });
      return path;
    }
    for (const ei of cur.edges) {
      const nb = nav.nodes[ei];
      const g = (_gs.get(cur.i) ?? 1e9) + Math.hypot(nb.x - cur.x, nb.z - cur.z);
      if (g < (_gs.get(nb.i) ?? 1e9)) { _gs.set(nb.i, g); _came.set(nb.i, cur); if (!_open.includes(nb)) _open.push(nb); }
    }
  }
  return [{ x: tx, z: tz }];
}

// ---------- physics: rays, sight lines, actor movement
const _o = { x: 0, y: 0, z: 0 }, _d = { x: 0, y: 0, z: 0 };
export function rayColliders(ox, oy, oz, dx, dy, dz, maxD) {
  let best = maxD;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    let t0 = 0, t1 = best;
    // slab test per axis
    if (Math.abs(dx) < 1e-9) { if (ox < c.x0 || ox > c.x1) continue; }
    else { let ta = (c.x0 - ox) / dx, tb = (c.x1 - ox) / dx; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) continue; }
    if (Math.abs(dy) < 1e-9) { if (oy < c.y0 || oy > c.y1) continue; }
    else { let ta = (c.y0 - oy) / dy, tb = (c.y1 - oy) / dy; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) continue; }
    if (Math.abs(dz) < 1e-9) { if (oz < c.z0 || oz > c.z1) continue; }
    else { let ta = (c.z0 - oz) / dz, tb = (c.z1 - oz) / dz; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) continue; }
    if (t0 < best && t0 >= 0) best = t0;
  }
  return best;
}
export function losClear(a, b, forNav = false) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.001) return true;
  const t = rayColliders(a.x, a.y, a.z, dx / dist, dy / dist, dz / dist, dist);
  if (t < dist - 0.15) return false;
  if (!forNav) { // smoke blocks sight
    for (const s of G.smokes) {
      const mx = (a.x + b.x) / 2 - s.pos.x, my = (a.y + b.y) / 2 - s.pos.y, mz = (a.z + b.z) / 2 - s.pos.z;
      if (mx * mx + my * my + mz * mz < s.r * s.r) {
        // cheap segment check: sample the midpoint region only once more near smoke center
        const px = s.pos.x - a.x, py = s.pos.y - a.y, pz = s.pos.z - a.z;
        const u = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / (dist * dist)));
        const qx = a.x + dx * u - s.pos.x, qy = a.y + dy * u - s.pos.y, qz = a.z + dz * u - s.pos.z;
        if (qx * qx + qy * qy + qz * qz < s.r * s.r) return false;
      }
    }
  }
  return true;
}
function overlaps(e, c, half, h) {
  return e.pos.x + half > c.x0 && e.pos.x - half < c.x1 &&
         e.pos.z + half > c.z0 && e.pos.z - half < c.z1 &&
         e.pos.y + h > c.y0 && e.pos.y < c.y1;
}
// Moves an actor by its velocity for one step, resolving against the world's
// boxes axis by axis, with step-up onto low cover and landing on box tops.
export function moveActor(e, dt, height) {
  const half = e.radius, g = 24;
  e.vel.y -= g * dt;
  // Y axis
  e.pos.y += e.vel.y * dt;
  e.onGround = false;
  for (const c of colliders) {
    if (!overlaps(e, c, half, height)) continue;
    if (e.vel.y <= 0 && e.pos.y < c.y1 && e.pos.y > c.y1 - 0.6) { e.pos.y = c.y1; e.vel.y = 0; e.onGround = true; }
    else if (e.vel.y > 0) { e.pos.y = c.y0 - height; e.vel.y = 0; }
  }
  if (e.pos.y <= 0) { e.pos.y = 0; e.vel.y = 0; e.onGround = true; }
  // X axis
  e.pos.x += e.vel.x * dt;
  for (const c of colliders) {
    if (!overlaps(e, c, half, height)) continue;
    if (c.y1 - e.pos.y <= 0.56 && headroom(e, c.y1, half, height)) { e.pos.y = c.y1; continue; }
    e.pos.x = e.vel.x > 0 ? c.x0 - half - 0.001 : c.x1 + half + 0.001;
  }
  // Z axis
  e.pos.z += e.vel.z * dt;
  for (const c of colliders) {
    if (!overlaps(e, c, half, height)) continue;
    if (c.y1 - e.pos.y <= 0.56 && headroom(e, c.y1, half, height)) { e.pos.y = c.y1; continue; }
    e.pos.z = e.vel.z > 0 ? c.z0 - half - 0.001 : c.z1 + half + 0.001;
  }
  e.pos.x = Math.max(-33.6, Math.min(33.6, e.pos.x));
  e.pos.z = Math.max(-33.6, Math.min(33.6, e.pos.z));
}
function headroom(e, y, half, height) {
  for (const c of colliders) {
    if (c === null) continue;
    if (e.pos.x + half > c.x0 && e.pos.x - half < c.x1 && e.pos.z + half > c.z0 && e.pos.z - half < c.z1 &&
        y + height > c.y0 && y < c.y1 && c.y1 > y + 0.01) return false;
  }
  return true;
}
export function insideSite(pos, site) {
  const S = SITES[site];
  return Math.hypot(pos.x - S.x, pos.z - S.z) <= S.r;
}
export { TEAM };
