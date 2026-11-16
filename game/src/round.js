// round.js — the match itself: two teams of five, first to 7 rounds. It owns
// the phase machine (buy → live → planted → end), the economy (kill, plant and
// round rewards, loss bonus), the plant/defuse channels, team strategy
// (which site, who carries, who anchors where) and the fixed-step simulation
// order that every other module plugs into.

import * as THREE from 'three';
import { G, CFG, TEAM, makeActor, setSeed, rand, randRange } from './state.js';
import { SPAWNS, SITES, insideSite } from './map.js';
import { freshLoadout, WEAPONS } from './weapons.js';
import { updateCombat, dropBomb } from './combat.js';
import { stepPlayer } from './player.js';
import { stepBot, botBuy, buildBotMesh } from './bots.js';
import { input } from './input.js';
import { sfx } from './audio.js';

export function makeBrain(role, site, hold, face) {
  return {
    role, site, hold, faceYaw: face ? Math.atan2(-(face.x - hold.x), -(face.z - hold.z)) : 0,
    target: null, lastSeen: null, seenNow: false, reactT: 0,
    reaction: randRange(0.26, 0.48), aimErr: randRange(0.014, 0.042),
    thinkT: rand() * 0.15, path: [], pathI: 0, pathT: 0,
    strafeT: 0, strafeDir: 1, burstLeft: 3, pauseT: 0,
    alertPos: null, alertT: -99, planNadeT: 0, stuckT: 0, seed: rand() * 20,
  };
}
const ATK_BOTS = [['Vex', 'entry'], ['Rook', 'support'], ['Sable', 'lurk'], ['Havoc', 'awp']];
const DEF_BOTS = [
  ['Bastion', 'anchor', { x: -16, z: -24 }, { x: -24, z: -13 }],
  ['Warden', 'anchor', { x: -26, z: -26 }, { x: -20, z: -12 }],
  ['Cipher', 'anchor', { x: 16, z: 15 }, { x: 20, z: 12 }],
  ['Mira', 'anchor', { x: 25, z: 23 }, { x: 21, z: 25.5 }],
  ['Onyx', 'rotate', { x: 2, z: 12 }, { x: 0, z: 0 }],
];
export function setupMatch(scene, mats) {
  setSeed(G.seed);
  G.actors.length = 0;
  const player = makeActor(TEAM.ATK, 'YOU', true);
  player.brain = makeBrain('entry', 'A', SPAWNS.atk[0], { x: 0, z: 0 });
  G.player = player; G.actors.push(player);
  for (const [name, role] of ATK_BOTS) {
    const b = makeActor(TEAM.ATK, name); b.brain = makeBrain(role, 'A', null, null);
    scene.add(buildBotMesh(b, mats)); G.actors.push(b);
  }
  for (const [name, role, hold, face] of DEF_BOTS) {
    const b = makeActor(TEAM.DEF, name); b.brain = makeBrain(role, null, hold, face);
    scene.add(buildBotMesh(b, mats)); G.actors.push(b);
  }
  G.score = { atk: 0, def: 0 }; G.round = 0;
  startRound();
}

export function startRound() {
  G.round++;
  G.phase = 'buy'; G.timer = CFG.buyTime; G.feed.length = 0; G.noises.length = 0;
  for (const s of G.smokes) s.t = 0; // updateCombat will sweep them out
  // team strategy: one site call for the whole attack
  const site = rand() < 0.55 ? 'A' : 'B';
  for (const a of G.actors) if (a.brain && a.team === TEAM.ATK) a.brain.site = site;
  // the charge goes to the entry fragger, sometimes to you
  const atk = G.actors.filter((a) => a.team === TEAM.ATK);
  const carrier = rand() < 0.3 ? G.player : atk.find((a) => a.brain?.role === 'entry') || atk[1];
  G.bomb = { state: 'carried', carrier, site: null, pos: new THREE.Vector3(), timer: 0, beepT: 0 };
  atk.forEach((a, i) => resetActor(a, SPAWNS.atk[i], carrier === a));
  G.actors.filter((a) => a.team === TEAM.DEF).forEach((a, i) => resetActor(a, SPAWNS.def[i], false));
  for (const a of G.actors) if (!a.isPlayer) botBuy(a);
  for (const a of G.actors) if (a.brain) a.brain.planNadeT = a.brain.role === 'entry' || a.brain.role === 'support' ? G.time + randRange(3, 7) : 0;
  G.banner = { title: `ROUND ${G.round}`, sub: carrier === G.player ? 'You carry the Charge — plant at ' + site : `Plant the Charge at Site ${site}`, t: G.time };
  if (G.player.alive) sfx.plantStart();
}
function resetActor(a, spawn, hasBomb) {
  const survived = a.alive && G.round > 1;
  a.pos.set(spawn.x + randRange(-0.8, 0.8), 0, spawn.z + randRange(-0.8, 0.8));
  a.vel.set(0, 0, 0);
  a.yaw = Math.atan2(a.pos.x, a.pos.z); // face map center
  a.pitch = 0; a.hp = 100; a.alive = true; a.crouch = 0; a.blindT = 0; a.channel = null;
  a.reloadT = 0; a.hasBomb = hasBomb; a.dmgFrom = null;
  if (!survived) { a.loadout = freshLoadout(); a.armor = 0; a.hasKit = false; }
  else { // winners keep their kit; top the magazine off from the reserve
    for (const s of ['primary', 'secondary']) {
      const g = a.loadout[s]; if (!g) continue;
      const def = WEAPONS[g.id]; const take = Math.min(def.mag - g.mag, g.reserve);
      g.mag += take; g.reserve -= take; g.bloom = 0;
    }
    a.armor = a.loadout.armor;
  }
  a.current = a.loadout.primary ? 'primary' : 'secondary';
}

function endRound(winner, reason) {
  G.phase = 'end'; G.timer = CFG.endTime; G.endReason = reason;
  G.score[winner === TEAM.ATK ? 'atk' : 'def']++;
  const planted = G.bomb.state === 'planted' || G.bomb.state === 'exploded' || reason.includes('defused');
  for (const a of G.actors) {
    if (a.team === winner) a.money = Math.min(CFG.maxMoney, a.money + (reason.includes('detonated') ? CFG.winByPlantReward : CFG.winReward));
    else a.money = Math.min(CFG.maxMoney, a.money + CFG.lossBonus + (planted && a.team === TEAM.ATK ? 800 : 0));
    a.channel = null;
  }
  if (G.bomb.planter && winner === TEAM.ATK) { /* plant bonus already paid at plant time */ }
  G.banner = { title: winner === TEAM.ATK ? 'STRIKERS TAKE THE ROUND' : 'SENTINELS TAKE THE ROUND', sub: reason, t: G.time };
  if (winner === TEAM.ATK) sfx.roundWin(); else sfx.roundLose();
}
function checkWin() {
  const atkAlive = G.actors.some((a) => a.team === TEAM.ATK && a.alive);
  const defAlive = G.actors.some((a) => a.team === TEAM.DEF && a.alive);
  if (G.bomb.state === 'exploded') return endRound(TEAM.ATK, 'The Charge detonated');
  if (G.bomb.state === 'defused') return endRound(TEAM.DEF, 'The Charge was defused');
  if (!defAlive) return endRound(TEAM.ATK, 'Sentinels eliminated');
  if (!atkAlive && G.bomb.state !== 'planted') return endRound(TEAM.DEF, 'Strikers eliminated');
  if (G.phase === 'live' && G.timer <= 0) return endRound(TEAM.DEF, 'Time expired — site held');
}

// plant / defuse channels: stand still, hold the action, finish the bar
function stepChannels(dt) {
  for (const a of G.actors) {
    if (!a.alive) continue;
    let want = a.wantChannel;
    if (a.isPlayer) {
      want = null;
      if (input.keys['KeyE'] && G.phase === 'live' && a.hasBomb) {
        for (const s of ['A', 'B']) if (insideSite(a.pos, s)) { want = 'plant'; a.channelSite = s; }
      }
    }
    if (!want) { if (a.channel && !a.isPlayer) a.channel = null; if (a.isPlayer) a.channel = null; continue; }
    const need = want === 'plant' ? CFG.plantTime : (a.hasKit ? CFG.defuseKitTime : CFG.defuseTime);
    if (!a.channel || a.channel.type !== want) a.channel = { type: want, t: 0 };
    a.channel.t += dt;
    a.channel.need = need;
    if (want === 'plant' && (a.channel.t * 2 | 0) !== ((a.channel.t - dt) * 2 | 0)) sfx.plantBeep(0);
    if (a.channel.t >= need) {
      a.channel = null;
      if (want === 'plant') completePlant(a);
      else completeDefuse(a);
    }
  }
}
function completePlant(a) {
  const site = a.channelSite || a.brain?.site || 'A';
  G.bomb.state = 'planted'; G.bomb.site = site; G.bomb.planter = a;
  G.bomb.pos.set(a.pos.x, 0.16, a.pos.z); G.bomb.timer = CFG.fuseTime; G.bomb.beepT = 0;
  a.hasBomb = false; a.money = Math.min(CFG.maxMoney, a.money + CFG.plantBonus);
  G.phase = 'planted';
  G.banner = { title: 'THE CHARGE IS PLANTED', sub: `Site ${site} — ${CFG.fuseTime} seconds`, t: G.time };
  sfx.bombSite();
  for (const d of G.actors) if (d.team === TEAM.DEF && d.brain) { d.brain.alertPos = { x: G.bomb.pos.x, z: G.bomb.pos.z }; d.brain.alertT = G.time; }
}
function completeDefuse(a) {
  G.bomb.state = 'defused'; sfx.defuse();
}

// the fixed-step simulation: one call = one 1/60s tick of game time
export function stepSim(dt) {
  G.time += dt;
  if (G.phase === 'buy' || G.phase === 'live') G.timer -= dt;
  if (G.phase === 'end') {
    G.timer -= dt;
    if (G.timer <= 0) {
      if (G.score.atk >= CFG.winTarget || G.score.def >= CFG.winTarget || G.round >= CFG.maxRounds) {
        G.phase = 'matchover';
        G.banner = { title: G.score.atk > G.score.def ? 'STRIKERS WIN THE MATCH' : G.score.def > G.score.atk ? 'SENTINELS WIN THE MATCH' : 'MATCH DRAWN', sub: `${G.score.atk} — ${G.score.def}`, t: G.time };
      } else startRound();
    }
  }
  if (G.phase === 'buy' && G.timer <= 0) { G.phase = 'live'; G.timer = CFG.roundTime; G.banner = { title: 'ROUND LIVE', sub: '', t: G.time }; }
  const active = G.phase === 'live' || G.phase === 'planted';
  if (active || G.phase === 'buy') {
    if (G.autoPlayer) stepBot(G.player, dt); else stepPlayer(dt);
    if (active) for (const a of G.actors) if (!a.isPlayer) stepBot(a, dt);
    // pick up a dropped charge by walking over it
    if (G.bomb.state === 'ground') {
      for (const a of G.actors) {
        if (a.team === TEAM.ATK && a.alive && Math.hypot(a.pos.x - G.bomb.pos.x, a.pos.z - G.bomb.pos.z) < 1.1) {
          G.bomb.state = 'carried'; G.bomb.carrier = a; a.hasBomb = true; break;
        }
      }
    }
    stepChannels(dt);
  }
  updateCombat(dt);
  if (active) checkWin();
  G.noises.length = 0;
  // trim the kill feed to what the HUD shows
  while (G.feed.length > 5) G.feed.shift();
}
