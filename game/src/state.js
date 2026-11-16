// state.js — the one place game state lives. Every module reads and writes through
// G; nothing keeps a private copy of match state. Also the seeded RNG (so demo and
// screenshot scenes are reproducible) and the noise/event channels bots perceive.

import * as THREE from 'three';

export const TEAM = { ATK: 'atk', DEF: 'def' };
export const TEAM_NAME = { atk: 'STRIKERS', def: 'SENTINELS' };
export const otherTeam = (t) => (t === TEAM.ATK ? TEAM.DEF : TEAM.ATK);

// mulberry32: small deterministic PRNG. The match is seeded once per scene.
let _s = 1234567;
export function setSeed(n) { _s = n >>> 0; }
export function rand() {
  _s = (_s + 0x6d2b79f5) >>> 0;
  let t = _s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const randRange = (a, b) => a + rand() * (b - a);
export const randPick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Match-wide tuning.
export const CFG = {
  roundTime: 100,        // seconds of live play before the plant
  plantTime: 3.0,        // channel time to plant the charge
  defuseTime: 5.0,       // channel time to defuse (2.5 with a kit)
  defuseKitTime: 2.5,
  fuseTime: 40,          // seconds from plant to detonation
  buyTime: 12,           // freeze/buy phase length
  endTime: 5.5,          // round-end banner time
  winTarget: 7,          // rounds to win the match
  maxRounds: 13,
  startMoney: 800,
  maxMoney: 16000,
  killReward: 300,
  plantBonus: 300,       // to the planter
  winReward: 2700,
  winByPlantReward: 3000,
  lossBonus: 1900,
  gravity: 24,
  stepHeight: 0.56,
};

export const G = {
  phase: 'menu',         // menu | buy | live | planted | end | matchover
  timer: 0,              // seconds left in the current phase
  banner: null,          // { title, sub, t } shown by the HUD
  hitmarkT: -99, hitmarkKill: false,
  lookDX: 0, lookDY: 0,  // per-frame look deltas, for viewmodel sway
  round: 0,
  score: { atk: 0, def: 0 },
  roundWinner: null,
  roundEndReason: '',
  actors: [],            // player + bots, see makeActor
  player: null,
  bomb: null,            // { state, pos, carrier, site }
  noises: [],            // { x, z, radius, team, kind } heard this tick
  feed: [],              // killfeed lines { text, t }
  smokes: [],            // active smoke volumes { pos, r, t }
  flashes: [],           // recent flash detonations { pos, t }
  time: 0,               // sim clock, seconds
  paused: false,
  shotMode: null,        // null, or the ?shot= scene name
  autoPlayer: false,     // shot scenes drive the player with the bot brain
  buyOpen: false,
  tabOpen: false,
  lastAttackerSite: 'A', // strikers' chosen site this round
};

// An actor is the shared shape for the player and every bot: feet position in
// pos (THREE.Vector3), velocity in vel, facing yaw/pitch in radians.
export function makeActor(team, name, isPlayer) {
  return {
    team, name, isPlayer: !!isPlayer,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
    hp: 100, armor: 0, alive: true,
    crouch: 0, onGround: true, adsT: 0, recoil: 0,
    radius: 0.34,
    money: CFG.startMoney,
    loadout: null,       // built by weapons.freshLoadout
    current: 'secondary',
    hasBomb: false, hasKit: false,
    kills: 0, deaths: 0,
    // AI brain (bots and the screenshot-mode auto-player), mesh handle, timers
    brain: null, mesh: null, deathT: 0,
    fireT: 0, reloadT: 0, throwCd: 0, meleeT: 0, stepT: 0,
    lastShotT: -99, dmgFrom: null, dmgFromT: -99, blindT: 0,
    channel: null,       // { type: 'plant'|'defuse', t, need }
    wantChannel: null, channelSite: null,
  };
}
export const actorHeight = (a) => 1.72 - 0.5 * a.crouch;
export const eyePos = (a, out) => out.set(a.pos.x, a.pos.y + actorHeight(a) - 0.14, a.pos.z);
