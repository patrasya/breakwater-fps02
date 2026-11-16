// main.js — boot, rendering, and the frame loop. The simulation runs on a
// fixed 60 Hz accumulator, fully decoupled from rendering: the same inputs
// always produce the same match, and a slow display can never slow the game.
// Also hosts the deterministic screenshot scenes (?shot=<name>&seed=<n>) used
// to produce the entry's screenshots: fixed seed, staged state, no input.

import * as THREE from 'three';
import { G, CFG, TEAM } from './state.js';
import { input, initInput, lockPointer, clearFrameInput } from './input.js';
import { buildMap, SITES } from './map.js';
import { initCombat, tryFire, clearEffects } from './combat.js';
import { setupMatch, stepSim } from './round.js';
import { initView, syncView, buildViewmodel, applyLook, player } from './player.js';
import { syncBotMesh, botBuy } from './bots.js';
import { initHud, updateHud, showMenu, hideMenu } from './hud.js';
import { initAudio } from './audio.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
if (params.get('seed')) G.seed = parseInt(params.get('seed'), 10) || 1;
G.shotMode = SHOT;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
document.body.prepend(renderer.domElement);
initInput(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2e4048);
scene.fog = new THREE.Fog(0x2e4048, 55, 150);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 400);
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xcfe4ea, 0x4a4238, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffb36b, 3.0);
sun.position.set(-42, 34, -14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
sun.shadow.camera.far = 140; sun.shadow.bias = -0.0006;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x7fb4c4, 0.9);
fill.position.set(30, 20, 40); scene.add(fill);

const mats = buildMap(scene);
initCombat(scene);
setupMatch(scene, mats);
initView(camera, mats);
buildViewmodel(G.player);
initHud();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- menu / pause flow (skipped entirely in screenshot mode)
let mode = SHOT ? 'shot' : 'menu';
const MENU_HTML = `5v5 tactical FPS — plant the Charge, or hold the sites.<br>
<b>WASD</b> move · <b>Mouse</b> aim · <b>Click</b> fire · <b>RMB</b> aim down sights · <b>Shift</b> walk silent · <b>Ctrl</b> crouch<br>
<b>1–4 / wheel / Q</b> weapons · <b>R</b> reload · <b>G</b> grenade · <b>E</b> plant (in a site) · <b>Tab</b> scoreboard<br>
Stop moving to shoot straight. Headshots quadruple. First to ${CFG.winTarget} rounds.<br>
<span class="go">CLICK TO PLAY</span>`;
if (!SHOT) showMenu('BREAKWATER', MENU_HTML);
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && mode === 'playing' && G.phase !== 'matchover')
    { mode = 'menu'; showMenu('PAUSED', MENU_HTML); }
});
addEventListener('mousedown', () => {
  if (SHOT) return;
  initAudio();
  if (mode === 'menu') {
    if (G.phase === 'matchover') setupMatch(scene, mats);
    hideMenu(); mode = 'playing'; lockPointer();
  }
});

// ---------- deterministic screenshot scenes
function stageShot() {
  const P = G.player;
  if (SHOT === 'menu') {
    G.phase = 'menu'; // keep the cover clean: no buy panel or clock behind the title
    camera.position.set(27, 15, 31); camera.lookAt(-4, 0, -6);
    showMenu('BREAKWATER', '5v5 tactical FPS — plant the Charge, or hold the sites.<br><span class="go">A THREE.JS TACTICAL FPS</span>');
    return 'menu';
  }
  if (SHOT === 'buy') { // frozen in the buy phase, menu open, gun in hand
    P.yaw = Math.atan2(P.pos.x - 6, P.pos.z - 6);
    return 'fps';
  }
  if (SHOT === 'combat' || SHOT === 'plant') {
    G.phase = 'live'; G.timer = 83; G.autoPlayer = SHOT === 'combat';
    P.money = 6000; botBuy(P); // the auto-player shops like a bot: rifle + armor
    const steps = SHOT === 'combat' ? 60 * 7 : 60 * 2;
    for (let i = 0; i < steps; i++) stepSim(1 / 60);
    G.autoPlayer = false;
    if (SHOT === 'plant') {
      const S = SITES.A;
      const carrier = G.actors.find((a) => a.team === TEAM.ATK && a.alive) || P;
      G.bomb.state = 'planted'; G.bomb.site = 'A'; G.bomb.timer = 23.4;
      G.bomb.pos.set(S.x + 1.5, 0.16, S.z + 1);
      G.phase = 'planted';
      const def = G.actors.find((a) => a.team === TEAM.DEF && a.alive);
      if (def) { def.pos.set(S.x + 2.1, 0, S.z + 1.4); def.crouch = 1; def.yaw = Math.atan2(-(G.bomb.pos.x - def.pos.x), -(G.bomb.pos.z - def.pos.z)); }
      P.pos.set(S.x + 10, 0, S.z + 3); // clear line to the site, no crane leg in the way
      P.vel.set(0, 0, 0);
      P.yaw = Math.atan2(-(G.bomb.pos.x - P.pos.x), -(G.bomb.pos.z - P.pos.z));
      P.pitch = -0.03; P.current = P.loadout.primary ? 'primary' : 'secondary';
      G.banner = { title: 'THE CHARGE IS PLANTED', sub: 'Site A — a Sentinel is on the defuse', t: G.time };
      buildViewmodel(P);
    } else {
      // guarantee a readable duel: nearest living defender, squared up
      let best = null, bd = 1e9;
      for (const e of G.actors) {
        if (e.team !== TEAM.DEF || !e.alive) continue;
        const d = P.pos.distanceTo(e.pos); if (d < bd) { bd = d; best = e; }
      }
      if (best && P.alive) {
        const dx = P.pos.x - best.pos.x, dz = P.pos.z - best.pos.z, dl = Math.hypot(dx, dz) || 1;
        P.pos.set(best.pos.x + (dx / dl) * 9, 0, best.pos.z + (dz / dl) * 9);
        P.vel.set(0, 0, 0); best.vel.set(0, 0, 0); // standing still: tightest spread
        P.yaw = Math.atan2(-(best.pos.x - P.pos.x), -(best.pos.z - P.pos.z));
        P.pitch = Math.atan2(1.12 - 1.58, 9); // dead on the defender's chest
        best.yaw = Math.atan2(-(P.pos.x - best.pos.x), -(P.pos.z - best.pos.z));
        best.brain.target = P; best.brain.seenNow = true;
        P.current = P.loadout.primary ? 'primary' : 'secondary';
        const pg = P.loadout.primary || P.loadout.secondary; if (pg) pg.bloom = 0;
        buildViewmodel(P);
        tryFire(best); tryFire(P);
        clearEffects(); // no frozen particle balloons in the still
        G.hitmarkT = G.time;
      }
    }
    return 'fps';
  }
  return 'fps';
}
let shotFrames = 0, shotCam = null;
if (SHOT) shotCam = stageShot();

// ---------- frame loop: fixed-step sim, decoupled render
const STEP = 1 / 60;
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (mode === 'playing') {
    // look input is sampled once per frame, then the sim ticks on schedule
    G.lookDX = input.mouseDX; G.lookDY = input.mouseDY;
    applyLook(input.mouseDX, input.mouseDY);
    input.mouseDX = 0; input.mouseDY = 0;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) { stepSim(STEP); acc -= STEP; n++; }
    if (n === 5) acc = 0;
    if (G.phase === 'matchover' && document.pointerLockElement) {
      document.exitPointerLock();
      mode = 'menu';
      showMenu(G.banner.title, `${G.banner.sub} — final score<br><span class="go">CLICK TO PLAY AGAIN</span>`);
    }
  } else if (mode === 'menu' && !SHOT) {
    // slow harbor orbit behind the title
    const t = now / 1000;
    camera.position.set(Math.sin(t * 0.05) * 30, 14 + Math.sin(t * 0.13) * 2, Math.cos(t * 0.05) * 30);
    camera.lookAt(0, 1, 0);
    if (player.vm) player.vm.visible = false;
  }
  if (SHOT) {
    if (shotCam === 'fps') syncView(camera, 0);
    for (const a of G.actors) if (a.mesh) syncBotMesh(a, 0);
    if (++shotFrames > 12) window.__shotReady = true;
  } else if (mode === 'playing') {
    syncView(camera, dt);
    for (const a of G.actors) if (a.mesh) syncBotMesh(a, dt);
  }
  updateHud();
  renderer.render(scene, camera);
  clearFrameInput();
}
requestAnimationFrame(frame);
