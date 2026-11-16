// bots.js — the nine other guns in the match. Each bot is a box-built soldier
// (team-colored, animated legs, falls when killed) driven by a brain that
// perceives through a vision cone, line of sight and sound, then acts on a
// plan: attackers run a lane to their site and plant, defenders hold angles
// and retake, and anyone in a fight strafes in bursts, manages range for
// their weapon, reloads behind cover and uses grenades with intent.

import * as THREE from 'three';
import { G, CFG, TEAM, actorHeight, clamp, lerp, rand, randRange } from './state.js';
import { findPath, losClear, moveActor, SITES, insideSite } from './map.js';
import { WEAPONS, NADES, buyItem } from './weapons.js';
import { tryFire, startReload, throwGrenade, curGun, curWeaponDef } from './combat.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
function part(parent, mat, x, y, z, sx, sy, sz) {
  const m = new THREE.Mesh(BOX, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true;
  parent.add(m); return m;
}
export function buildBotMesh(a, mats) {
  const g = new THREE.Group();
  const teamMat = a.team === TEAM.ATK ? mats.atk : mats.def;
  const darkMat = a.team === TEAM.ATK ? mats.atkDark : mats.defDark;
  const legL = part(g, darkMat, -0.13, 0.42, 0, 0.17, 0.84, 0.2);
  const legR = part(g, darkMat, 0.13, 0.42, 0, 0.17, 0.84, 0.2);
  legL.geometry = BOX; legL.position.y = 0.42;
  const torso = part(g, teamMat, 0, 1.12, 0, 0.52, 0.58, 0.3);
  part(g, mats.ink, 0, 1.16, 0.02, 0.56, 0.4, 0.34); // vest
  const head = part(g, mats.skin, 0, 1.56, 0, 0.26, 0.28, 0.26);
  const cap = part(g, darkMat, 0, 1.68, 0, 0.3, 0.1, 0.3);
  const gunArm = new THREE.Group(); gunArm.position.set(0.2, 1.32, 0); g.add(gunArm);
  part(gunArm, teamMat, 0, -0.08, 0.05, 0.13, 0.34, 0.13);
  const gun = part(gunArm, mats.gunmetal, 0, 0.02, -0.3, 0.07, 0.1, 0.62);
  part(g, teamMat, -0.32, 1.28, 0, 0.13, 0.42, 0.13); // left arm
  a.mesh = { g, legL, legR, gunArm, gun, cap, walk: 0 };
  return g;
}
export function syncBotMesh(a, dt) {
  const m = a.mesh; if (!m) return;
  const speed = Math.hypot(a.vel.x, a.vel.z);
  m.walk += dt * speed * 2.4;
  const h = actorHeight(a);
  m.g.position.set(a.pos.x, a.pos.y, a.pos.z);
  m.g.rotation.set(0, a.yaw, 0);
  const swing = a.onGround ? Math.sin(m.walk) * 0.5 * clamp(speed / 5, 0, 1) : 0.25;
  m.legL.rotation.x = swing; m.legR.rotation.x = -swing;
  m.legL.position.y = 0.42 - (1 - h / 1.7) * 0.3; m.legR.position.y = m.legL.position.y;
  m.gunArm.rotation.x = -a.pitch;
  if (!a.alive) { // fall where shot
    a.deathT = (a.deathT || 0) + dt;
    const k = clamp(a.deathT / 0.45, 0, 1);
    m.g.rotation.x = -k * Math.PI / 2;
    m.g.position.y = a.pos.y + k * 0.25;
  } else a.deathT = 0;
  m.cap.visible = !!a.loadout.helmet;
}

// ---------- purchasing: role-flavored, budget-aware
export function botBuy(a) {
  const b = a.brain;
  const spend = (id) => buyItem(a, id) === null;
  if (b.role === 'awp' && a.money >= 4500) spend('longbow');
  else if (a.money >= 2700 && rand() < 0.8) spend('vk7');
  else if (a.money >= 1400) spend('vk9');
  else if (a.money >= 1100 && rand() < 0.35) spend('kestrel');
  if (a.money >= 1000) spend('helmet'); else if (a.money >= 650) spend('armor');
  if (a.team === TEAM.DEF && b.role === 'anchor' && a.money >= 200) spend('kit');
  const nadeWish = b.role === 'entry' ? ['flash', 'frag'] : b.role === 'anchor' ? ['smoke', 'frag'] : ['frag', 'smoke'];
  for (const n of nadeWish) if (a.money >= NADES[n].price + 200 && rand() < 0.7) spend(n);
  a.current = a.loadout.primary ? 'primary' : 'secondary';
}

// ---------- perception: sight cone + LOS + sound, on a think tick
function perceive(a) {
  const b = a.brain;
  b.thinkT = randRange(0.1, 0.17);
  const eyeY = a.pos.y + actorHeight(a) - 0.1;
  let bestT = null, bestD = 1e9;
  for (const e of G.actors) {
    if (e.team === a.team || !e.alive) continue;
    const d = a.pos.distanceTo(e.pos);
    if (d > 58) continue;
    // hearing a shot or a sprint is as good as seeing, briefly
    const heard = d < 20 && e.lastShotT && G.time - e.lastShotT < 0.4;
    if (d > 7 && !heard) {
      const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
      const dot = (fx * (e.pos.x - a.pos.x) + fz * (e.pos.z - a.pos.z)) / (d || 1);
      if (dot < 0.22) continue; // outside the vision cone
    }
    if (!losClear({ x: a.pos.x, y: eyeY, z: a.pos.z }, { x: e.pos.x, y: e.pos.y + actorHeight(e) - 0.3, z: e.pos.z })) continue;
    if (d < bestD) { bestD = d; bestT = e; }
  }
  if (bestT) {
    if (b.target !== bestT) b.reactT = G.time + b.reaction;
    b.target = bestT; b.lastSeen = { x: bestT.pos.x, z: bestT.pos.z, t: G.time }; b.seenNow = true;
  } else b.seenNow = false;
  if (a.dmgFrom && G.time - a.dmgFromT < 0.6 && a.dmgFrom.alive) {
    b.target = a.dmgFrom; b.lastSeen = { x: a.dmgFrom.pos.x, z: a.dmgFrom.pos.z, t: G.time };
    if (G.time > b.reactT) b.reactT = G.time;
  }
  // team-shared intel: a teammate's fresh sighting becomes a rotation hint
  for (const n of G.noises) {
    if (n.team !== a.team && Math.hypot(n.x - a.pos.x, n.z - a.pos.z) < n.radius) { b.alertPos = { x: n.x, z: n.z }; b.alertT = G.time; }
  }
}

// ---------- plans: what to do when nobody is being shot at right now
function objectiveFor(a) {
  const b = a.brain;
  if (G.bomb.state === 'planted') {
    return { x: G.bomb.pos.x, z: G.bomb.pos.z, mode: a.team === TEAM.DEF ? 'defuse' : 'guard' };
  }
  if (a.team === TEAM.ATK) {
    if (a.hasBomb) return { x: SITES[b.site].x, z: SITES[b.site].z, mode: 'plant' };
    // escort the carrier; lurker takes the long way to the other site
    if (b.role === 'lurk') { const s = SITES[b.site === 'A' ? 'B' : 'A']; return { x: s.x, z: s.z, mode: 'lurk' }; }
    const carrier = G.actors.find((x) => x.hasBomb);
    if (carrier && carrier !== a) return { x: carrier.pos.x, z: carrier.pos.z, mode: 'escort' };
    return { x: SITES[b.site].x, z: SITES[b.site].z, mode: 'go' };
  }
  // defenders: hold your site; rotate on a plant call or a loud alert
  if (b.alertPos && G.time - b.alertT < 6 && b.role === 'rotate')
    return { x: b.alertPos.x, z: b.alertPos.z, mode: 'investigate' };
  return { x: b.hold.x, z: b.hold.z, mode: 'hold' };
}

function setPath(a, tx, tz) {
  const b = a.brain;
  b.path = findPath(a.pos.x, a.pos.z, tx, tz);
  b.pathI = 0; b.pathT = G.time;
}
const RANGE = { sniper: [20, 40], rifle: [11, 26], smg: [7, 17], shotgun: [3.5, 9], pistol: [7, 18] };

export function stepBot(a, dt) {
  const b = a.brain;
  if (!a.alive) return;
  b.thinkT -= dt;
  if (b.thinkT <= 0) perceive(a);
  const gun = curGun(a);
  if (gun && G.time - (a.lastShotT || 0) < 99 && gun.mag === 0) startReload(a);
  a.wantChannel = null;

  const fighting = b.target && b.target.alive && G.time - (b.lastSeen?.t ?? -9) < 1.6 && G.time >= b.reactT;
  let moveX = 0, moveZ = 0, speed = 0, faceYaw = null;

  if (a.blindT > 0.6) { // flashed: freeze up, crouch, pray
    a.crouch = clamp(a.crouch + dt * 6, 0, 1);
  } else if (fighting) {
    const t = b.target, def = curWeaponDef(a);
    const [lo, hi] = RANGE[def.kind] || RANGE.rifle;
    const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    // aim with human-ish error that grows while the target moves
    const tSpeed = Math.hypot(t.vel.x, t.vel.z);
    const lead = clamp(dist / 60, 0, 0.35);
    const ax = t.pos.x + t.vel.x * lead - a.pos.x, az = t.pos.z + t.vel.z * lead - a.pos.z;
    const wantYaw = Math.atan2(-ax, -az);
    const err = b.aimErr * (1 + tSpeed * 0.22) * (b.seenNow ? 1 : 2.2);
    faceYaw = wantYaw + Math.sin(G.time * 1.7 + b.seed) * err;
    const wantPitch = Math.atan2((t.pos.y + actorHeight(t) * 0.72) - (a.pos.y + actorHeight(a) - 0.1), dist);
    a.pitch = lerp(a.pitch, clamp(wantPitch, -1.2, 1.2), Math.min(1, dt * 9));
    // range keeping + strafe duels
    b.strafeT -= dt;
    if (b.strafeT <= 0) { b.strafeT = randRange(0.6, 1.3); b.strafeDir = rand() < 0.5 ? -1 : 1; }
    const px = (-dz / dist) * b.strafeDir, pz = (dx / dist) * b.strafeDir;
    let toward = 0;
    if (dist > hi) toward = 1; else if (dist < lo) toward = -1;
    moveX = px * 0.8 + (dx / dist) * toward; moveZ = pz * 0.8 + (dz / dist) * toward;
    speed = dist > hi ? 4.9 : 3.4;
    a.crouch = clamp(a.crouch + (((def.kind === 'sniper' || def.kind === 'rifle') && dist > 14 ? 1 : 0) - a.crouch) * dt * 5, 0, 1);
    // fire discipline: bursts with pauses, none while the picture is stale
    if (b.seenNow && a.blindT <= 0) {
      if (b.pauseT > 0) b.pauseT -= dt;
      else {
        tryFire(a, dt);
        if (gun && gun.mag >= 0) { a.lastShotT = G.time; b.burstLeft--; }
        if (b.burstLeft <= 0) { b.burstLeft = def.auto ? (2 + (rand() * 4 | 0)) : 1; b.pauseT = randRange(0.25, 0.6); }
      }
      if (gun && gun.mag === 0) startReload(a);
      // a frag at a corner camper, a flash before re-peeking — occasionally
      if (a.loadout.nades.length && rand() < dt * 0.14) botThrow(a, a.loadout.nades[0], b.lastSeen);
    }
  } else {
    a.crouch = clamp(a.crouch - dt * 5, 0, 1);
    const obj = objectiveFor(a);
    const dObj = Math.hypot(obj.x - a.pos.x, obj.z - a.pos.z);
    if (obj.mode === 'plant' && insideSite(a.pos, b.site)) {
      a.wantChannel = 'plant'; faceYaw = b.faceYaw;
    } else if (obj.mode === 'defuse' && dObj < 1.6) {
      a.wantChannel = 'defuse'; faceYaw = Math.atan2(-(obj.x - a.pos.x), -(obj.z - a.pos.z));
    } else if (obj.mode === 'hold' && dObj < 1.2) {
      faceYaw = b.faceYaw; speed = 0; // posted up on an angle
      if (gun && gun.mag < (WEAPONS[gun.id].mag) * 0.5) startReload(a);
    } else {
      if (!b.path.length || G.time - b.pathT > 3 || dObj > 2 && Math.hypot(b.path[b.path.length - 1].x - obj.x, b.path[b.path.length - 1].z - obj.z) > 3) setPath(a, obj.x, obj.z);
      const wp = b.path[b.pathI];
      if (wp) {
        const dx = wp.x - a.pos.x, dz = wp.z - a.pos.z, d = Math.hypot(dx, dz);
        if (d < 1.1) b.pathI++;
        else { moveX = dx / d; moveZ = dz / d; faceYaw = Math.atan2(-dx, -dz); }
      }
      speed = obj.mode === 'escort' && dObj < 4 ? 2.6 : 4.95;
      // opening flash over the lane, smoke across mid — utility with a plan
      if (a.loadout.nades.length && b.planNadeT && G.time > b.planNadeT) {
        b.planNadeT = 0;
        botThrow(a, a.loadout.nades[0], { x: obj.x, z: obj.z });
      }
    }
    if (faceYaw === null && b.lastSeen && G.time - b.lastSeen.t < 2.5) faceYaw = Math.atan2(-(b.lastSeen.x - a.pos.x), -(b.lastSeen.z - a.pos.z));
  }

  // turn toward the facing direction smoothly, then walk
  if (faceYaw !== null) {
    let dy = faceYaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    a.yaw += clamp(dy, -dt * 7, dt * 7);
  }
  if (!fighting) a.pitch = lerp(a.pitch, 0, Math.min(1, dt * 6));
  const ml = Math.hypot(moveX, moveZ);
  if (ml > 0.01 && speed > 0) {
    moveX /= ml; moveZ /= ml;
    // gentle separation so teammates don't stack on one doorway
    for (const o of G.actors) {
      if (o === a || !o.alive) continue;
      const d = Math.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z);
      if (d > 0.01 && d < 0.9) { moveX += (a.pos.x - o.pos.x) / d * 0.7; moveZ += (a.pos.z - o.pos.z) / d * 0.7; }
    }
    const k = Math.min(1, dt * 10);
    a.vel.x = lerp(a.vel.x, moveX * speed, k); a.vel.z = lerp(a.vel.z, moveZ * speed, k);
  } else { a.vel.x = lerp(a.vel.x, 0, Math.min(1, dt * 12)); a.vel.z = lerp(a.vel.z, 0, Math.min(1, dt * 12)); }
  const wasAir = !a.onGround;
  moveActor(a, dt, actorHeight(a));
  void wasAir;
  if (a.onGround && speed > 3.3 && ml > 0.01) {
    a.stepT -= dt;
    if (a.stepT <= 0) { a.stepT = 0.34; G.noises.push({ x: a.pos.x, z: a.pos.z, radius: 11, team: a.team, kind: 'step' }); }
  }
  // stuck detection: if we're pushing but not moving, jump / repath
  b.stuckT = (Math.hypot(a.vel.x, a.vel.z) > 2 && Math.hypot(a.pos.x - (b.lastX ?? a.pos.x), a.pos.z - (b.lastZ ?? a.pos.z)) < dt * 0.4) ? (b.stuckT || 0) + dt : 0;
  b.lastX = a.pos.x; b.lastZ = a.pos.z;
  if (b.stuckT > 0.7) { b.stuckT = 0; if (a.onGround) a.vel.y = 7.6; b.path = []; }
}
function botThrow(a, kind, at) {
  const dx = at.x - a.pos.x, dz = at.z - a.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 4 || dist > 26) return;
  a.yaw = Math.atan2(-dx, -dz);
  a.pitch = clamp(Math.atan2(1.2 + dist * 0.14, dist), 0.08, 0.65);
  throwGrenade(a, kind);
}
