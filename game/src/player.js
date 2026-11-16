// player.js — the human's body and eyes: pointer-lock look, acceleration-based
// movement with friction, crouch and jump, weapon handling inputs, and the
// procedural first-person viewmodel (built from boxes per weapon class, with
// bob, sway, recoil kick and aim-down-sights). Movement feel and the accuracy
// model in combat.js are tuned together: fast is loud and wild, still is exact.

import * as THREE from 'three';
import { G, CFG, TEAM, actorHeight, clamp, lerp } from './state.js';
import { input } from './input.js';
import { moveActor } from './map.js';
import { WEAPONS } from './weapons.js';
import { tryFire, startReload, throwGrenade, curGun, curWeaponDef } from './combat.js';
import { sfx } from './audio.js';

export const player = { vm: null, vmParts: {}, fov: 75, bobT: 0, landDip: 0, lastWeapon: 'secondary' };

export function applyLook(dx, dy) {
  const a = G.player; if (!a || !a.alive) return;
  const sens = 0.0021 * (a.adsT > 0.5 ? 0.55 : 1);
  a.yaw -= dx * sens;
  a.pitch = clamp(a.pitch - dy * sens, -1.45, 1.45);
}

const _wish = new THREE.Vector3();
export function stepPlayer(dt) {
  const a = G.player;
  if (!a.alive) return;
  const canAct = G.phase === 'live' || G.phase === 'planted';
  const canMove = canAct || G.phase === 'buy';
  // crouch (hold) — the accuracy and profile trade
  const wantCrouch = (input.keys['ControlLeft'] || input.keys['KeyC']) && a.onGround;
  a.crouch = clamp(a.crouch + ((wantCrouch ? 1 : 0) - a.crouch) * Math.min(1, dt * 11), 0, 1);
  // wish direction from keys, in yaw space
  let f = 0, r = 0;
  if (canMove) {
    if (input.keys['KeyW']) f += 1;
    if (input.keys['KeyS']) f -= 1;
    if (input.keys['KeyD']) r += 1;
    if (input.keys['KeyA']) r -= 1;
  }
  const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
  _wish.set(-sy * f + cy * r, 0, -cy * f - sy * r);
  const hasWish = _wish.lengthSq() > 0;
  if (hasWish) _wish.normalize();
  const def = curWeaponDef(a);
  const walking = input.keys['ShiftLeft'] || input.keys['ShiftRight'];
  let maxSpeed = 5.25 * (def?.move ?? 1) * (1 - a.crouch * 0.45) * (a.adsT > 0.3 ? 0.55 : 1);
  if (walking) maxSpeed = Math.min(maxSpeed, 2.55);
  if (a.channel) maxSpeed = 0;
  const prevVy = a.vel.y;
  if (a.onGround) {
    // friction, then accelerate toward the wish velocity
    const fr = hasWish ? 2.2 : 10;
    a.vel.x -= a.vel.x * Math.min(1, fr * dt); a.vel.z -= a.vel.z * Math.min(1, fr * dt);
    a.vel.x += _wish.x * 46 * dt; a.vel.z += _wish.z * 46 * dt;
    const sp = Math.hypot(a.vel.x, a.vel.z);
    if (sp > maxSpeed) { a.vel.x *= maxSpeed / sp; a.vel.z *= maxSpeed / sp; }
    if (input.keys['Space'] && !a.channel) { a.vel.y = 8.1; sfx.jump(); input.keys['Space'] = false; }
  } else {
    a.vel.x += _wish.x * 7 * dt; a.vel.z += _wish.z * 7 * dt;
    const sp = Math.hypot(a.vel.x, a.vel.z), cap = Math.max(maxSpeed, sp);
    if (sp > cap + 1.2) { a.vel.x *= (cap + 1.2) / sp; a.vel.z *= (cap + 1.2) / sp; }
  }
  const wasAir = !a.onGround;
  moveActor(a, dt, actorHeight(a));
  if (wasAir && a.onGround && prevVy < -7) { player.landDip = 0.14; sfx.land(); }
  // footsteps are sound, and sound is information for the other team
  const speed = Math.hypot(a.vel.x, a.vel.z);
  if (a.onGround && speed > 3.3 && !walking && a.crouch < 0.5) {
    a.stepT -= dt;
    if (a.stepT <= 0) { a.stepT = 0.34; G.noises.push({ x: a.pos.x, z: a.pos.z, radius: 11, team: a.team, kind: 'step' }); }
  }
  // --- weapon inputs
  if (!canAct) return;
  if (input.pressed['Digit1'] && a.loadout.primary) switchTo(a, 'primary');
  if (input.pressed['Digit2']) switchTo(a, 'secondary');
  if (input.pressed['Digit3']) switchTo(a, 'melee');
  if (input.pressed['Digit4'] && a.loadout.nades.length) switchTo(a, 'nade');
  if (input.pressed['KeyQ']) switchTo(a, player.lastWeapon);
  if (input.wheel !== 0) { cycleWeapon(a, Math.sign(input.wheel)); input.wheel = 0; }
  for (const k in input.pressed) delete input.pressed[k]; // first sim step of the frame consumes the key edges
  if (input.pressed['KeyR']) startReload(a);
  if (input.pressed['KeyG'] && a.loadout.nades.length) throwGrenade(a, a.loadout.nades[0]);
  const wantThrow = a.current === 'nade' && input.mouseClicked;
  if (wantThrow && a.loadout.nades.length) throwGrenade(a, a.loadout.nades[0]);
  const gun = curGun(a);
  if (gun && a.reloadT <= 0) {
    if (def.auto ? input.mouseDown : input.mouseClicked) tryFire(a, dt);
  } else if (a.current === 'melee' && input.mouseClicked) tryFire(a, dt);
}
export function switchTo(a, slot) {
  if (a.current === slot) return;
  if (slot !== 'nade') player.lastWeapon = a.current === 'nade' ? player.lastWeapon : a.current;
  a.current = slot; a.reloadT = 0;
  buildViewmodel(a);
}
function cycleWeapon(a, dir) {
  const order = ['primary', 'secondary', 'melee'].filter((s) => s === 'melee' || (s === 'primary' ? a.loadout.primary : true));
  let i = order.indexOf(a.current); if (i === -1) i = 1;
  switchTo(a, order[(i + dir + order.length) % order.length]);
}

// ---------- view: camera + viewmodel, called once per rendered frame
export function initView(camera, mats) {
  player.camera = camera;
  player.vm = new THREE.Group();
  camera.add(player.vm);
  player.vm.position.set(0.24, -0.22, -0.45);
  player.mats = mats;
}
const VM_GEO = new THREE.BoxGeometry(1, 1, 1);
function part(parent, mat, x, y, z, sx, sy, sz, rx = 0) {
  const m = new THREE.Mesh(VM_GEO, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.x = rx;
  parent.add(m); return m;
}
export function buildViewmodel(a) {
  if (!player.vm) return;
  while (player.vm.children.length) player.vm.remove(player.vm.children[0]);
  const M = player.mats, gun = M.gunmetal, acc = a.team === TEAM.ATK ? M.orange : M.teal;
  const g = new THREE.Group(); player.vm.add(g); player.vmGun = g;
  const kind = a.current === 'melee' ? 'knife' : a.current === 'nade' ? 'nade' : (WEAPONS[curGun(a)?.id]?.kind ?? 'rifle');
  if (kind === 'knife') {
    part(g, M.ink, 0, -0.05, -0.1, 0.035, 0.05, 0.16);
    part(g, M.steel, 0, -0.03, -0.28, 0.012, 0.055, 0.24);
  } else if (kind === 'nade') {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), M.ink);
    s.position.set(0, -0.04, -0.16); g.add(s);
  } else {
    const L = kind === 'sniper' ? 0.78 : kind === 'rifle' ? 0.62 : kind === 'smg' ? 0.5 : kind === 'shotgun' ? 0.6 : 0.3;
    part(g, gun, 0, 0, -L / 2, 0.075, 0.11, L);                       // receiver
    part(g, gun, 0, 0.015, -L - 0.08, 0.045, 0.045, 0.22);            // barrel
    part(g, acc, 0, -0.005, -L * 0.45, 0.082, 0.05, L * 0.4);         // team accent shroud
    if (kind !== 'pistol') part(g, gun, 0, -0.11, -L * 0.42, 0.05, 0.13, 0.09, 0.25); // magazine
    part(g, gun, 0, -0.09, 0.06, 0.06, 0.12, 0.08, 0.3);               // grip
    if (kind === 'sniper') { const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.16, 10), gun); sc.rotation.x = Math.PI / 2; sc.position.set(0, 0.095, -0.3); g.add(sc); }
    else part(g, gun, 0, 0.085, -L * 0.4, 0.02, 0.045, 0.02);          // front post
  }
  // hands
  part(g, M.skin, 0.01, -0.13, -0.02, 0.07, 0.07, 0.12);
  if (kind !== 'knife' && kind !== 'nade') part(g, M.skin, -0.01, -0.1, -0.34, 0.065, 0.065, 0.11);
}
export function syncView(camera, dt) {
  const a = G.player; if (!a) return;
  const h = actorHeight(a);
  const speed = Math.hypot(a.vel.x, a.vel.z);
  player.bobT += dt * speed * 1.6;
  const bobY = a.onGround ? Math.sin(player.bobT * 2) * 0.018 * clamp(speed / 5, 0, 1) : 0;
  player.landDip = Math.max(0, player.landDip - dt * 0.5);
  // ADS: right mouse raises the gun to center and narrows the field of view
  const def = curWeaponDef(a);
  const wantAds = input.mouseRDown && a.alive && a.current !== 'melee' && a.current !== 'nade';
  a.adsT = clamp(a.adsT + ((wantAds ? 1 : 0) - a.adsT) * Math.min(1, dt * 10), 0, 1);
  if (!a.alive) {
    // death cam: rest where you fell, turned toward whoever got you
    camera.position.set(a.pos.x, a.pos.y + 1.1, a.pos.z);
    const k = a.dmgFrom;
    if (k && k.pos) camera.lookAt(k.pos.x, k.pos.y + 1.2, k.pos.z);
    player.vm.visible = false;
    return;
  }
  player.vm.visible = true;
  camera.position.set(a.pos.x, a.pos.y + h - 0.12 + bobY - player.landDip, a.pos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(a.pitch + (a.recoil || 0) * 0.012, a.yaw, clamp(-(input.strafeLean || 0), -0.02, 0.02));
  const targetFov = lerp(75, def?.scoped ? 26 : 52, a.adsT);
  if (Math.abs(camera.fov - targetFov) > 0.1) { camera.fov = lerp(camera.fov, targetFov, Math.min(1, dt * 12)); camera.updateProjectionMatrix(); }
  // viewmodel: sway from look velocity, kick from recoil, lower while sprinting-ish
  const vm = player.vm;
  const kick = (a.recoil || 0) * 0.011;
  const adsX = lerp(0.24, 0, a.adsT), adsY = lerp(-0.22, -0.148, a.adsT);
  vm.position.set(adsX + clamp(-G.lookDX * 0.00012, -0.02, 0.02), adsY + bobY * 0.6 + clamp(-G.lookDY * 0.00012, -0.015, 0.015), -0.45 + kick);
  vm.rotation.set(kick * 1.6, 0, 0);
  if (player.vmGun) player.vmGun.visible = !(def?.scoped && a.adsT > 0.75); // scoped: eye to the glass
}
