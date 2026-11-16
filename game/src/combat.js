// combat.js — gunfire, damage, grenades and the charge. Hits are resolved
// against the world's boxes and against two hit volumes per actor (a head
// sphere above a body box), with distance falloff, armor and a headshot
// multiplier. Accuracy is a resource: spread grows with the shooter's speed,
// airtime and sustained fire (bloom), and shrinks to a point when crouched and
// still — so the sim rewards stopping to shoot, the tactical shooter's core.

import * as THREE from 'three';
import { G, CFG, TEAM, actorHeight, clamp, lerp, rand } from './state.js';
import { WEAPONS, NADES } from './weapons.js';
import { rayColliders, losClear } from './map.js';
import { sfx } from './audio.js';

let scene = null;
const _dir = new THREE.Vector3(), _org = new THREE.Vector3(), _tmp = new THREE.Vector3();
export const curGun = (a) => (a.current === 'primary' ? a.loadout.primary : a.current === 'secondary' ? a.loadout.secondary : null);
export const curWeaponDef = (a) => (a.current === 'melee' ? WEAPONS.knife : WEAPONS[curGun(a)?.id]);

export function aimDir(a, spread, out) {
  const s = spread * (rand() * 2 - 1), s2 = spread * (rand() * 2 - 1);
  out.set(-Math.sin(a.yaw) * Math.cos(a.pitch), Math.sin(a.pitch), -Math.cos(a.yaw) * Math.cos(a.pitch));
  // perturb by spread in the perpendicular plane
  _tmp.set(Math.cos(a.yaw), 0, -Math.sin(a.yaw));
  out.addScaledVector(_tmp, s); out.y += s2; out.normalize();
  return out;
}
export function spreadOf(a, def) {
  const speed = Math.hypot(a.vel.x, a.vel.z);
  let s = def.spread + (a.loadout ? (curGun(a)?.bloom ?? 0) : 0);
  s += def.spreadMove * clamp(speed / 5.2, 0, 1.4);
  if (!a.onGround) s += 0.09;
  if (a.crouch > 0.5) s *= 0.62;
  if (a === G.player && a.adsT > 0.5) s *= 0.55;
  return s;
}

// ---------- damage & death
export function damage(t, dmg, part, from, gunId) {
  if (!t.alive || G.phase === 'end' || G.phase === 'matchover') return;
  let eff = dmg;
  if (t.loadout.armor > 0) {
    const pen = WEAPONS[gunId]?.pen ?? 0.5;
    eff = dmg * (1 - 0.5 * pen);
    if (part === 'head' && t.loadout.helmet) eff *= 0.6;
    t.loadout.armor = Math.max(0, t.loadout.armor - dmg * 0.4);
    t.armor = t.loadout.armor;
  }
  t.hp -= eff;
  t.dmgFrom = from; t.dmgFromT = G.time;
  if (t.isPlayer) sfx.hurt();
  if (t.hp <= 0) kill(t, from, gunId, part);
}
export function kill(t, from, gunId, part) {
  t.hp = 0; t.alive = false; t.deaths++; t.channel = null;
  if (from && from !== t) {
    from.kills++;
    const reward = WEAPONS[gunId]?.killReward ?? 300;
    from.money = Math.min(CFG.maxMoney, from.money + reward);
  }
  G.feed.push({ text: `${from ? from.name : '—'} ▸ ${WEAPONS[gunId]?.name ?? ''} ▸ ${t.name}${part === 'head' ? ' ⌖' : ''}`, t: G.time, team: t.team });
  if (t.hasBomb) { t.hasBomb = false; dropBomb(t.pos); }
  if (t.isPlayer) G.playerDiedT = G.time;
}

// ---------- firing
export function tryFire(a, dt) {
  const def = curWeaponDef(a);
  if (!def || a.channel) return;
  if (def.slot === 'melee') { meleeSwing(a, def); return; }
  const gun = curGun(a);
  if (!gun || G.time < gun.nextT || a.reloadT > 0) return;
  if (gun.mag <= 0) { if (a.isPlayer) sfx.dryFire(); gun.nextT = G.time + 0.3; startReload(a); return; }
  gun.mag--; gun.nextT = G.time + 60 / def.rpm;
  a.lastShotT = G.time;
  gun.bloom = Math.min(0.05, gun.bloom + def.bloom);
  a.recoil = (a.recoil || 0) + def.recoil;
  a.pitch += def.recoil * 0.0035; // muzzle climb the player must pull against
  const dist0 = a.isPlayer ? 0 : a.pos.distanceTo(G.player.pos);
  sfx.shot(def.kind, a.isPlayer ? 0 : dist0);
  G.noises.push({ x: a.pos.x, z: a.pos.z, radius: def.noise, team: a.team, kind: 'shot' });
  const eye = _org.set(a.pos.x, a.pos.y + actorHeight(a) - 0.14, a.pos.z);
  spawnMuzzle(a, eye);
  const pellets = def.pellets || 1;
  for (let p = 0; p < pellets; p++) resolvePellet(a, def, eye, gun);
  if (gun.mag === 0) startReload(a);
}
function resolvePellet(a, def, eye, gun) {
  const dir = aimDir(a, spreadOf(a, def), new THREE.Vector3());
  const maxD = 140;
  const wallT = rayColliders(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, maxD);
  let bestT = wallT, hitActor = null, part = null;
  for (const t of G.actors) {
    if (t === a || !t.alive || t.team === a.team) continue;
    const h = actorHeight(t);
    // head sphere
    const hx = t.pos.x - eye.x, hy = (t.pos.y + h - 0.10) - eye.y, hz = t.pos.z - eye.z;
    const b = hx * dir.x + hy * dir.y + hz * dir.z;
    if (b > 0) {
      const c = hx * hx + hy * hy + hz * hz - b * b, r = 0.17;
      if (c < r * r) { const th = b - Math.sqrt(r * r - c); if (th > 0 && th < bestT) { bestT = th; hitActor = t; part = 'head'; } }
    }
    // body box
    const tBody = rayBox(eye, dir, t.pos.x - 0.37, t.pos.y, t.pos.z - 0.37, t.pos.x + 0.37, t.pos.y + h - 0.22, t.pos.z + 0.37);
    if (tBody !== null && tBody < bestT) { bestT = tBody; hitActor = t; part = 'body'; }
  }
  const end = _tmp.copy(dir).multiplyScalar(bestT).add(eye);
  spawnTracer(eye, end, a.team);
  if (hitActor) {
    const fall = bestT < def.fallFrom ? 1 : bestT > def.fallTo ? def.fallMul : lerp(1, def.fallMul, (bestT - def.fallFrom) / (def.fallTo - def.fallFrom));
    damage(hitActor, def.dmg * fall * (part === 'head' ? def.head : 1), part, a, gun.id);
    spawnHitPuff(end, true);
    if (a.isPlayer) { sfx.hit(); G.hitmarkT = G.time; G.hitmarkKill = !hitActor.alive; }
  } else if (bestT < maxD) spawnHitPuff(end, false);
}
function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
  let t0 = 0, t1 = Infinity;
  const axes = [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]];
  for (const [oo, dd, mn, mx] of axes) {
    if (Math.abs(dd) < 1e-9) { if (oo < mn || oo > mx) return null; }
    else { let ta = (mn - oo) / dd, tb = (mx - oo) / dd; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return null; }
  }
  return t0;
}
function meleeSwing(a, def) {
  if (G.time < (a.meleeT || 0)) return;
  a.meleeT = G.time + 60 / def.rpm;
  const eye = _org.set(a.pos.x, a.pos.y + actorHeight(a) - 0.14, a.pos.z);
  const dir = aimDir(a, 0, new THREE.Vector3());
  for (const t of G.actors) {
    if (t === a || !t.alive || t.team === a.team) continue;
    if (t.pos.distanceTo(a.pos) < def.range + 0.4) {
      _tmp.copy(t.pos).setY(t.pos.y + 1).sub(eye).normalize();
      if (_tmp.dot(dir) > 0.5) damage(t, def.dmg, 'body', a, 'knife');
    }
  }
}
export function startReload(a) {
  const gun = curGun(a); if (!gun || a.reloadT > 0) return;
  const def = WEAPONS[gun.id];
  if (gun.reserve <= 0 || gun.mag >= def.mag) return;
  a.reloadT = def.reload; if (a.isPlayer) sfx.reload();
}
export function finishReload(a) {
  const gun = curGun(a); if (!gun) return;
  const def = WEAPONS[gun.id];
  const take = Math.min(def.mag - gun.mag, gun.reserve);
  gun.mag += take; gun.reserve -= take;
}

// ---------- grenades
const nades = []; // live projectiles { mesh, vel, kind, owner, t, rest }
export function throwGrenade(a, kind) {
  const def = NADES[kind];
  const idx = a.loadout.nades.indexOf(kind);
  if (idx === -1 || G.time < (a.throwCd || 0)) return false;
  a.loadout.nades.splice(idx, 1); a.throwCd = G.time + 0.55;
  const eye = new THREE.Vector3(a.pos.x, a.pos.y + actorHeight(a) - 0.05, a.pos.z);
  const dir = aimDir(a, 0.004, new THREE.Vector3());
  const mesh = new THREE.Mesh(nadeGeo, nadeMats[kind]);
  mesh.position.copy(eye); scene.add(mesh);
  nades.push({ mesh, vel: dir.multiplyScalar(19).add(new THREE.Vector3(0, 3.2, 0)), kind, owner: a, t: 0, rest: false });
  sfx.throwNade();
  if (a.current === 'nade') a.current = a.loadout.primary ? 'primary' : 'secondary';
  return true;
}
function updateNades(dt) {
  for (let i = nades.length - 1; i >= 0; i--) {
    const n = nades[i]; n.t += dt;
    if (!n.rest) {
      n.vel.y -= 22 * dt;
      const p = n.mesh.position;
      p.addScaledVector(n.vel, dt);
      // bounce off world boxes and floor with a cheap AABB sweep
      if (p.y < 0.12) { p.y = 0.12; n.vel.y *= -0.38; n.vel.x *= 0.7; n.vel.z *= 0.7; if (Math.abs(n.vel.y) < 1.2) n.rest = true; }
      const wt = rayColliders(p.x, p.y, p.z, Math.sign(n.vel.x), 0, 0, 0.14);
      if (wt < 0.14) { n.vel.x *= -0.4; p.x += Math.sign(n.vel.x) * 0.05; }
      const wtz = rayColliders(p.x, p.y, p.z, 0, 0, Math.sign(n.vel.z), 0.14);
      if (wtz < 0.14) { n.vel.z *= -0.4; p.z += Math.sign(n.vel.z) * 0.05; }
      if (n.vel.lengthSq() < 0.4 && p.y <= 0.13) n.rest = true;
    }
    const fuse = n.kind === 'frag' ? 1.7 : n.kind === 'flash' ? 1.45 : 1.1;
    if (n.t >= fuse || (n.rest && n.kind === 'smoke')) { detonate(n); scene.remove(n.mesh); nades.splice(i, 1); }
  }
}
function detonate(n) {
  const p = n.mesh.position, def = NADES[n.kind];
  if (n.kind === 'frag') {
    sfx.frag(n.owner.isPlayer ? 6 : p.distanceTo(G.player.pos));
    spawnExplosion(p);
    for (const t of G.actors) {
      if (!t.alive) continue;
      const d = t.pos.distanceTo(p);
      if (d > def.radius + 1) continue;
      _tmp.set(t.pos.x, t.pos.y + 0.9, t.pos.z);
      if (!losClear({ x: p.x, y: p.y + 0.2, z: p.z }, _tmp)) continue;
      const dmg = def.dmg * clamp(1 - d / (def.radius + 1.5), 0.08, 1);
      damage(t, dmg, 'body', n.owner === t ? null : n.owner, 'frag');
    }
    G.noises.push({ x: p.x, z: p.z, radius: 40, team: n.owner.team, kind: 'boom' });
  } else if (n.kind === 'flash') {
    sfx.flash(p.distanceTo(G.player.pos));
    spawnFlashPop(p);
    for (const t of G.actors) {
      if (!t.alive || t === n.owner) continue;
      const d = t.pos.distanceTo(p);
      if (d > def.radius) continue;
      _tmp.set(t.pos.x, t.pos.y + actorHeight(t) - 0.1, t.pos.z);
      if (!losClear({ x: p.x, y: p.y, z: p.z }, _tmp)) continue;
      // facing factor: looking at the pop blinds fully, back turned barely
      const fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw);
      _dir.set(p.x - t.pos.x, 0, p.z - t.pos.z).normalize();
      const facing = fx * _dir.x + fz * _dir.z;
      const full = clamp((facing + 0.45) / 1.45, 0.06, 1);
      t.blindT = Math.max(t.blindT, full * 4.2 * clamp(1 - d / (def.radius * 1.6), 0.25, 1));
    }
  } else { // smoke
    sfx.smoke(p.distanceTo(G.player.pos));
    const s = { pos: p.clone().setY(1.3), r: def.radius, t: def.dur, mesh: makeSmokeCloud(p) };
    G.smokes.push(s);
  }
}

// ---------- the charge (bomb)
export const bombMesh = { mesh: null };
export function initBomb(sceneRef) {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.16), new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.5, metalness: 0.5 }));
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.03), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
  light.position.set(0.1, 0.08, 0.09);
  grp.add(body, light); grp.visible = false; sceneRef.add(grp);
  bombMesh.mesh = grp; bombMesh.light = light;
}
export function dropBomb(pos) {
  G.bomb.state = 'ground'; G.bomb.pos.set(pos.x, 0.16, pos.z); G.bomb.carrier = null;
}
export function updateBomb(dt) {
  const b = G.bomb; if (!b) return;
  if (b.state === 'carried' && b.carrier) { b.pos.copy(b.carrier.pos); if (bombMesh.mesh) bombMesh.mesh.visible = false; }
  else if (b.state === 'ground' || b.state === 'planted') {
    if (bombMesh.mesh) { bombMesh.mesh.visible = true; bombMesh.mesh.position.copy(b.pos); }
  } else if (bombMesh.mesh) bombMesh.mesh.visible = false;
  if (b.state === 'planted') {
    b.timer -= dt;
    b.beepT -= dt;
    const rate = b.timer < 10 ? 0.25 : b.timer < 20 ? 0.5 : 1;
    if (b.beepT <= 0) { b.beepT = rate; if (bombMesh.light) bombMesh.light.material.color.setHex(b.timer < 10 ? 0xff2222 : 0xffaa00); if (G.player.pos.distanceTo(b.pos) < 30) sfx.bombSite(); }
    if (b.timer <= 0) { b.state = 'exploded'; spawnExplosion(b.pos.clone().setY(1)); sfx.explosion(); }
  }
}

// ---------- effects (pooled: no per-frame allocation in hot loops)
let tracerPool = [], puffPool = [], muzzleLight = null, nadeGeo = null, nadeMats = {};
export function initCombat(scn) {
  scene = scn;
  nadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  for (const [k, v] of Object.entries(NADES)) nadeMats[k] = new THREE.MeshStandardMaterial({ color: v.color, roughness: 0.4, metalness: 0.4 });
  const tGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(tGeo, tMat.clone()); m.visible = false; scene.add(m); tracerPool.push({ m, t: 0 }); }
  const pGeo = new THREE.SphereGeometry(0.05, 6, 5);
  for (let i = 0; i < 90; i++) {
    const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    m.visible = false; scene.add(m);
    puffPool.push({ m, t: 0, life: 1, vel: new THREE.Vector3(), grav: 0, grow: 0 });
  }
  muzzleLight = new THREE.PointLight(0xffb36b, 0, 9); scene.add(muzzleLight);
  initBomb(scene);
}
let tracerIdx = 0, puffIdx = 0;
const _ta = new THREE.Vector3(), _tb = new THREE.Vector3();
function spawnTracer(a, b, team) {
  const s = tracerPool[tracerIdx++ % tracerPool.length];
  const len = a.distanceTo(b); if (len < 2) return;
  // Inset both ends: a tracer that starts at the shooter's eye would fill the
  // screen with its near cross-section, and one ending in the victim's eye
  // does the same from the other side. The muzzle puff marks the true origin.
  _ta.copy(b).sub(a).normalize();
  _tb.copy(a).addScaledVector(_ta, 0.85); // inset start point
  s.m.position.copy(_tb).addScaledVector(_ta, (len - 1.2) / 2); // segment midpoint
  s.m.lookAt(b); s.m.scale.set(1, 1, len - 1.2);
  s.m.material.color.setHex(team === TEAM.ATK ? 0xffc37a : 0x9fe8ff);
  s.m.visible = true; s.t = 0.05;
}
function puff(pos, color, n, speed, life, grav = 0, grow = 0, size = 1) {
  for (let i = 0; i < n; i++) {
    const p = puffPool[puffIdx++ % puffPool.length];
    p.m.position.copy(pos);
    p.vel.set((rand() - 0.5) * speed, rand() * speed * 0.8, (rand() - 0.5) * speed);
    p.m.material.color.setHex(color); p.m.material.opacity = 0.9;
    p.m.scale.setScalar(size * (0.6 + rand() * 0.8));
    p.t = 0; p.life = life * (0.6 + rand() * 0.7); p.grav = grav; p.grow = grow; p.m.visible = true;
  }
}
export function spawnHitPuff(pos, blood) { puff(pos, blood ? 0xb02020 : 0xd8c9a3, blood ? 7 : 5, 2.2, 0.4, -3, 0, 0.8); }
export function spawnExplosion(pos) { puff(pos, 0xff8c3a, 22, 7, 0.8, -2, 2.5, 2.2); puff(pos, 0x55483a, 14, 4, 1.3, 1.5, 3, 2.6); }
function spawnFlashPop(pos) { puff(pos, 0xffffff, 16, 3, 0.3, 0, 3, 1.6); }
function spawnMuzzle(a, eye) {
  const dir = aimDir(a, 0, _dir);
  _tmp.copy(eye).addScaledVector(dir, 0.55); _tmp.y -= 0.12;
  puff(_tmp, 0xffc36b, 2, 0.6, 0.06, 0, 0, 1.4);
  muzzleLight.position.copy(_tmp); muzzleLight.intensity = 14;
}
function makeSmokeCloud(p) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb9bec2, roughness: 1, transparent: true, opacity: 0.36, depthWrite: false });
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(1.5 + rand() * 1.1, 16, 12), mat);
    s.position.set((rand() - 0.5) * 2.6, rand() * 1.6, (rand() - 0.5) * 2.6);
    grp.add(s);
  }
  grp.position.copy(p).setY(0.4); scene.add(grp);
  return grp;
}
export function clearEffects() { // staging helper: freeze a clean frame
  for (const s of tracerPool) { s.t = 0; s.m.visible = false; }
  for (const p of puffPool) { p.t = 0; p.m.visible = false; }
  if (muzzleLight) muzzleLight.intensity = 0;
}
export function updateCombat(dt) {
  updateNades(dt); updateBomb(dt);
  for (const s of tracerPool) if (s.t > 0) { s.t -= dt; if (s.t <= 0) s.m.visible = false; }
  for (const p of puffPool) {
    if (!p.m.visible) continue;
    p.t += dt;
    if (p.t >= p.life) { p.m.visible = false; continue; }
    p.vel.y += p.grav * dt;
    p.m.position.addScaledVector(p.vel, dt);
    if (p.grow) p.m.scale.addScalar(p.grow * dt);
    p.m.material.opacity = 0.9 * (1 - p.t / p.life);
  }
  if (muzzleLight) muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 160);
  for (let i = G.smokes.length - 1; i >= 0; i--) {
    const s = G.smokes[i]; s.t -= dt;
    if (s.mesh) s.mesh.scale.setScalar(1 + (15 - Math.max(0, s.t)) * 0.012);
    if (s.t <= 0) { scene.remove(s.mesh); G.smokes.splice(i, 1); }
  }
  for (const a of G.actors) {
    const gun = curGun(a);
    if (gun && gun.bloom > 0) gun.bloom = Math.max(0, gun.bloom - dt * 0.028);
    if (a.reloadT > 0) { a.reloadT -= dt; if (a.reloadT <= 0) finishReload(a); }
    if (a.blindT > 0) a.blindT -= dt;
    a.recoil = Math.max(0, (a.recoil || 0) - dt * 9);
  }
}
