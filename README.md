# BREAKWATER

A 5v5 tactical FPS built with three.js, in the shape of the classic
bomb-defusal shooter: buy weapons and gear each round, plant the Charge at
one of two sites — or hold the sites against the plant — and take the match,
first to 7 rounds. One human (you, on the attacking Strikers) and nine bots
with ears, eyes and plans of their own.

Everything is procedural: the map, the textures, the gun models, the sounds
(synthesized live with WebAudio). No asset is ever fetched; the only library
is the vendored three.js 0.187.0 under `game/vendor/three/`.

## Play it

```sh
node serve.ts          # Node >= 22, no dependencies
# open http://localhost:8080 and click to play
```

Or serve the `game/` folder with any static file server. The match starts in
the buy phase; click captures the mouse (pointer lock), Esc pauses.

## Controls

| Input | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Left click | Fire (hold for automatics) |
| Right mouse (hold) | Aim down sights — the Longbow gets a true scope |
| Shift | Walk: slow, and silent — footsteps are information |
| Ctrl or C | Crouch: smaller target, tighter spread |
| Space | Jump |
| 1 / 2 / 3 / 4, wheel, Q | Primary / sidearm / knife / grenade, cycle, last weapon |
| R | Reload |
| G | Throw the first grenade you carry |
| E (hold, in a site) | Plant the Charge |
| 1–9 (buy phase) | Buy menu: rifles, armor, grenades |
| Tab | Scoreboard |

## How a round works

- **Buy (12s):** spend what you have. You start with $800 and a P9 sidearm.
  Kills, plants and round results pay out; losers get a loss bonus, so nobody
  is priced out for long. Gear you survive with is gear you keep.
- **Live (100s):** Strikers push a lane to Site A (the crane yard) or Site B
  (the warehouse) and plant; Sentinels hold angles, rotate on sound and
  information, and retake. Elimination also ends the round.
- **Planted (40s fuse):** Sentinels must defuse (5s, 2.5s with a kit) or the
  Charge detonates. If every Striker dies after the plant, the round still
  plays out — the fuse doesn't care.
- **Match:** first to 7 rounds, at most 13.

## Gunplay rules worth knowing

- Hits are resolved against a **head sphere and a body box**; headshots deal
  **4×** damage (3× on the pump shotgun). Armor absorbs a penetration-scaled
  share; a helmet further blunts headshots.
- **Spread is a model, not a dice roll:** every weapon has a base spread that
  grows with your speed, with airtime and with sustained fire (bloom), and
  shrinks when you crouch — and when you simply stop. Run-and-gun sprays;
  stop-and-pop kills. The crosshair draws your true spread.
- Every weapon has distance falloff, its own noise radius (bots hear shots
  and sprinting footsteps), and a kill reward that shapes the economy —
  shotgun and SMG kills pay a bounty, the Longbow barely pays for itself.
- Grenades are tools, not fireworks: **frag** (area damage, blocked by
  walls), **flash** (blinds by facing and distance — it works on you too),
  **smoke** (a volume that genuinely blocks vision, for bots as well as you).

## The bots

Each bot perceives on a think tick through a vision cone plus line of sight,
hears gunfire and footsteps inside their noise radius, and remembers last
known positions. Defenders anchor sites and rotate on calls; attackers pick
a site as a team, escort the carrier, throw an opening flash, plant, and set
up a crossfire; after a plant they guard, and the Sentinels retake — one on
the defuse, the rest covering. In a fight they manage range for their
weapon, strafe in bursts, crouch at distance, and reload out of sight.

## Layout of the code

The simulation runs on a **fixed 60 Hz step**, decoupled from rendering, and
all match state lives in one object (`G` in `state.js`). One module, one job:

```
main.ts                  harness entry (program/v1): publishes game/ + screenshots/ + dossier.json
serve.ts                 tiny static server for local play
shots.json               the deterministic screenshot scenes
game/
  index.html             HUD DOM + the import map ("three" -> vendored build)
  style.css              HUD styling
  package.json           {"type":"module"} for local tooling
  vendor/three/          three.js 0.187.0, byte-for-byte from the kit
  src/
    state.js             G, config, seeded RNG, the shared actor shape
    input.js             keyboard/mouse state and pointer lock
    audio.js             WebAudio-synthesized sound effects (no audio files)
    textures.js          canvas-painted textures and the material palette
    map.js               Breakwater Depot: geometry, colliders, nav graph, physics
    weapons.js           weapon/grenade/gear data, loadouts, the buy rules
    combat.js            hitscan, damage model, grenades, the Charge, effects pools
    player.js            human controller, camera, procedural viewmodels
    bots.js              bot meshes and the tactical AI
    round.js             phases, economy, plant/defuse channels, the sim step
    hud.js               crosshair, vitals, buy menu, scoreboard, banners
    main.js              boot, lights, fixed-step loop, ?shot= scenes
```

Effects (tracers, impact puffs, muzzle light) come from fixed pools — the hot
loops allocate nothing per frame. Rendering is three.js with one shadowed
directional light; the whole game source is small enough to be read end to
end.

## Screenshots

`screenshots/` holds real renders of this build, produced headlessly from
the deterministic scenes in `shots.json` (the game accepts
`?shot=<scene>&seed=<n>` and signals `window.__shotReady` when the staged
frame is stable):

1. `1-menu.jpg` — the title over Breakwater Depot
2. `2-buy.jpg` — buy phase at Striker spawn, buy menu open
3. `3-combat.jpg` — a mid-round duel: hitmarker, damage direction, return fire
4. `4-plant.jpg` — the Charge planted at Site A, a Sentinel on the defuse

## License

MIT — see `LICENSE`. three.js is MIT-licensed by its authors; its license
ships at `game/vendor/three/LICENSE`.
