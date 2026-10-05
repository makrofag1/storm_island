# Storm Island

A fan-made, single-player **battle royale** (genre homage; not affiliated with or endorsed by any game publisher), running entirely in the browser
(Three.js + vanilla ES modules). You drop from a flying bus onto a procedurally generated island,
loot weapons from chests and the floor, harvest materials, build walls / floors / stairs / roofs,
and fight up to **99 AI bots — 100 players** (10–99 configurable; phones start with 49) while the storm
shrinks over 8 phases.

Everything is original and procedural: no third-party models, textures, sounds, logos or names.
Geometry is built from primitives, textures are generated in shaders, audio is synthesized with
the Web Audio API.

## Running

It's a static site — no backend, no accounts. Any static file server works:

```bash
node server.mjs          # zero-dependency server -> http://localhost:5173
npm run start:https      # same over https://<your PC's LAN IP>:5174 (self-signed) — needed for VR on a Quest
npx serve .              # or
python -m http.server 5173
```

Open the URL and click **PLAY**. Click the game view to capture the mouse (Pointer Lock).

**GitHub Pages**: push the repository and enable Pages (Settings → Pages → Deploy from a branch, root
folder). All paths are relative, so it works under `https://<user>.github.io/<repo>/`; `.nojekyll`
skips the Jekyll step. `dist/storm-island.html` is a single self-contained file that also works on
its own (e.g. `https://<user>.github.io/<repo>/dist/storm-island.html`). `node_modules/` is not needed.

* `?debug=1` adds the test panel (` or F2): god mode, give loot, teleport by clicking the map,
  spawn a bot, storm x8 / skip phase, eliminate bots / yourself.
* `npm test` runs the logic tests (Node 18+, no extra dependencies).
* `?touch=1` forces the on-screen touch controls (handy for testing on a desktop), `?touch=0` disables them.

### Single-file build (share it anywhere)

```bash
npm install            # once (installs esbuild, the only dev dependency)
npm run build:single
```

produces `dist/storm-island.html` — one self-contained ~0.75 MB HTML file with the game code,
Three.js and CSS inlined. Open it directly (double-click), host it on any static host, or send it
to someone. `dist/storm-island-artifact.html` is the same build without the `<html>/<head>/<body>`
skeleton, for page hosts that add their own (it is what the published claude.ai artifact uses).

If the page is embedded somewhere that blocks mouse capture (Pointer Lock), the game switches to
**free-mouse look** automatically: move the mouse over the game to turn, rest it at the left/right
edge to keep turning, arrow keys look around, Esc pauses.

Three.js **r169** is vendored in `vendor/three.module.js` (pinned via import map) so the game works offline.

### Using the dedicated GPU (laptops with Intel/AMD + NVIDIA)

A web page can only *request* the fast GPU — Storm Island creates its WebGL context with
`powerPreference: "high-performance"` — but on dual-GPU Windows laptops **Windows assigns the GPU per
program**, so the browser itself must be set to use the NVIDIA card. The main menu shows which GPU is
actually used (orange warning if it's integrated or software rendering); click it for instructions:

1. **Windows**: Settings → System → Display → Graphics settings → *Desktop app* → Browse →
   `chrome.exe` / `msedge.exe` / `brave.exe` / `firefox.exe` → Options → **High performance** → Save.
   (Claude desktop app: choose *Microsoft Store app* → Claude.)
   Shortcut: `npm run gpu:nvidia` (or `powershell -ExecutionPolicy Bypass -File tools\use-nvidia-gpu.ps1`)
   sets this for all installed browsers for the current user; `-Undo` reverts it.
2. **or NVIDIA Control Panel** → Manage 3D settings → Program Settings → add the browser →
   *High-performance NVIDIA processor*.
3. Optional: `chrome://flags/#force-high-performance-gpu` → Enabled (Chrome/Edge/Brave).
4. Fully restart the browser, keep the laptop plugged in, verify in the menu / F3 / `chrome://gpu`.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Shift | Sprint |
| Space | Jump · jump out of the bus · deploy glider |
| C (Ctrl in fullscreen) | Crouch. Ctrl+W closes a browser tab and pages can't block it, so Ctrl only crouches in fullscreen (FULLSCREEN button), where Chrome / Edge let the game capture Ctrl+W via the Keyboard Lock API. Mid-match the page also asks before it can be closed |
| Mouse | Look |
| LMB | Fire / swing pickaxe / use item / place build piece |
| RMB | Aim down sights (sniper: scope) · in build mode: switch material |
| E | Pick up / open chest or ammo box |
| R | Reload · build: rotate stairs · edit: reset |
| 1 or F | Pickaxe |
| 2 – 6 | Item slots 1–5 |
| Mouse wheel | Cycle slots / build pieces |
| Q | Toggle build mode (then 1–4 = wall, floor, stairs, roof) |
| Z / X / T / Y | Quick build: wall / floor / stairs / roof |
| G | Edit one of your walls/floors (LMB toggles 3×3 tiles, G to finish) |
| V | Swap shoulder |
| B | Emote |
| M / Tab | Full map (click = marker, right-click = clear) |
| Esc | Pause / settings |
| F3 | Debug overlay (FPS, timings, draw calls, entities, GPU, selected bot, nav grid) |

All keys can be rebound in **Settings → Key bindings**. Freefall: look down + W to dive, S to slow down.

### Touch controls (iOS Safari / Android Chrome, phones and tablets)

Detected automatically (Settings → Touch controls: Auto / Always on / Off). Auto starts with touch
controls only when the primary pointer is a finger (phones/tablets — PCs and laptops with a
touchscreen start with mouse & keyboard) and then follows what you actually use: touching the screen
switches to touch controls, a mouse click or a game key switches back. Play in landscape — the
game asks you to rotate in portrait. On Android, **FULLSCREEN** in the menu also locks landscape; on
iPhone use *Share → Add to Home Screen* for a full-screen web app.

| Control | Action |
|---|---|
| Left half of the screen | Floating joystick — push to the rim to sprint |
| Right half | Drag to look around |
| FIRE | Shoot / swing / use item / place piece — drag the button to aim while firing |
| Left FIRE | Second fire button above the joystick: shoot with the left thumb while the right thumb keeps aiming (Settings → Touch: left FIRE button) |
| AIM | Toggle aim down sights · build mode: switch material |
| JUMP | Jump · DROP from the bus · deploy GLIDER |
| CROUCH | Toggle crouch |
| RELOAD | Reload · build mode: rotate stairs |
| USE | Appears next to loot and chests |
| BUILD / EDIT | Top row next to MAP / MENU: build mode (tap hotbar slots for wall/floor/stairs/roof) / edit your wall or floor |
| Hotbar | Tap a slot to select it |
| MAP / ⏸ | Map (tap to place a marker, tap it again to clear) / pause & settings |

Touch aiming helpers (each can be turned off in Settings):

* **Auto-fire** — the gun fires by itself while the crosshair rests on an enemy (70 ms settle; semi-auto
  guns re-fire as soon as they are ready), so you never have to lift the aiming thumb to press FIRE.
* **Aim assist** — near an enemy the look speed drops (friction) and, while you move or look, the
  crosshair follows part of the enemy's movement and is pulled gently toward its centre; pressing AIM
  snaps most of the way onto an enemy close to the crosshair. Only visible enemies count. In a test
  (bot strafing at 8 m/s 22 m away, you strafing, no aiming input) assist + auto-fire landed 5–8 hits
  in 6 s versus 0 without — it helps, but you still have to keep tracking.

First launch on a phone defaults to the Low quality preset; Settings → Touch look sensitivity tunes aiming.

### VR — Meta Quest 3 (WebXR immersive-vr)

Full first-person VR in the **Meta Quest Browser**: stereo rendering with 6DOF head tracking, the gun
in your hand (you aim with the controller — shots leave the muzzle you see), real walking in your play
space, physical crouching, Touch controller buttons, haptics, a wrist HUD and comfort options.

**Open it on the headset** — WebXR only runs on secure (`https://`) pages:

* **GitHub Pages** (recommended): `https://<user>.github.io/<repo>/` → **PLAY IN VR**.
* **From your PC on the home network**: `npm run start:https`, then open the printed
  `https://192.168.x.x:5174` address in the Quest Browser. The certificate is self-signed (created in
  `.cert/` with the openssl that ships with Git for Windows), so the browser warns once — *Advanced →
  Proceed*. Plain `http://192.168…` pages cannot start VR.
* Embedded pages (e.g. the claude.ai artifact) usually block VR; the menu then explains where to open it.

**Controls** (right-handed; *Settings → VR dominant hand* mirrors everything):

| Controller | Action |
|---|---|
| Left stick | Move (analog) · click = sprint toggle · *teleport mode*: push forward to aim the arc, release to jump (8 m, ground only) |
| Right stick ← → | Snap turn (30/45/90°) or smooth turn |
| Right stick ↑ ↓ | Next / previous slot · build mode: next / previous piece |
| Right trigger | Fire / use item / place piece · grenades are thrown on **release** with your real hand speed |
| Swing the pickaxe | A fast swing of the right hand hits (the trigger works too) |
| Left trigger | Aim down sights (tighter spread) · build mode: switch material |
| Right grip | Grab loot near your hand, open a chest you touch, or pick up what the gun points at |
| A | Jump · jump from the bus · deploy glider |
| B | Reload · build mode: rotate stairs |
| X | Build mode on / off |
| Y | Pause menu (resume, turn / move / vignette options, reset height, exit VR, leave match) |
| Right stick click | Crouch toggle · build mode: edit the wall / floor you point at |
| Left grip (hold) | Enlarge the wrist HUD (minimap) |
| Duck in real life | Crouch (off in *seated* mode) |

**Don't know the controller?** Raise a controller in front of your eyes: a card next to it lists what
each button does *right now* (it changes in build mode, while skydiving, spectating...) and yellow
badges mark the A/B/X/Y buttons. The cards are also shown for the first 20 s of a match, and *pause
(Y) → CONTROLS* lists the whole layout. *Settings → VR controller hints*: when you look at a controller
(default) / always / off.

**Aiming down the sights**: every gun has real sights — a rear notch and a front post with a glowing
dot — and shots travel exactly along that sight line. Bring the gun up to your eye (rear sight within
~20 cm, barrel pointing where you look) and you aim down sights automatically (tighter spread, like
holding the left trigger). The sniper has a working **scope**: its lens shows a magnified (~6.5°)
picture of the world with a reticle.

**Glider**: when you open it (A while skydiving) a striped canopy unfolds above your head with lines
down to your hands; it banks into turns, sways, and folds away when you land.

**After you are eliminated** the camera follows your killer in third person (behind them, turning
with them; you can still look around freely). Trigger / A switches to the next player, Y opens the
menu (leave match).

**HUD**: look at your left wrist — health / shield, ammo, materials, hotbar, minimap, storm timer and
kill feed. Announcements, pickup prompts (*GRIP: Pick up…*) and toasts appear low in your view, red
arcs show where damage comes from, and a laser + dot from the muzzle turns red on enemies.

**Comfort**: snap turn by default, optional smooth turn (speed adjustable), smooth stick movement or
teleport, a tunnelling vignette during artificial motion (off / low / strong), your view is always at
the character's eye height (measured from your real height at the start; *Reset height* in the pause
menu), real steps are blocked by walls just like stick movement, and the view never shakes or recoils
(the gun in your hand kicks instead). Panels are clicked with the controller laser or a hand-tracking
pinch; gameplay needs the Touch controllers (putting them down pauses the game).

**Performance**: VR matches use their own preset (320 m draw distance, 1024 shadow map over 35 m, sparse
grass, fixed foveated rendering, 90 Hz requested) and 49 bots by default (*Settings → VR bots*).
*VR performance → Performance* drops shadows and grass and runs at 72 Hz. If the frame rate still stays
below ~60 fps, the game turns off shadows, then grass, automatically.

**Testing without a headset**: `?vrsim=1` runs the same VR code on a flat screen (head = mouse look, hands
in front of the camera; WASD = left stick, Q/E = turn, wheel = slots, LMB/RMB = triggers, Space = A,
R = B, B = X, P = Y, F = grip, C = stick click, Shift = sprint, M = map, H = swing hand, G = duck).

## Settings

| Setting | Notes |
|---|---|
| Mouse / ADS sensitivity, invert Y | applied immediately |
| Field of view | 60–100 |
| Graphics quality | Low / Medium / High. High adds 1.25× supersampling, 4096 soft shadows over 120 m, 2 m terrain mesh, ~5× denser swaying grass, 1150 m draw distance, ACES filmic tone mapping and MSAA (after reload) |
| Master / effects / music volume | |
| Bots | 10–99 (+ you = up to 100 players, next match) |
| Bot difficulty | Easy / Medium / Hard / Expert / Mixed (default) |
| Map seed | blank = random; same seed + same map options = same island |
| VR | Movement (stick / teleport), move direction (head / off-hand controller), snap or smooth turning, snap angle, smooth turn speed, comfort vignette, dominant hand, controller hints, seated play, bots in VR matches (default 49), performance mode |
| Map generation | Island size (small/normal/large), terrain (flat/hills/mountains — adds a 2nd peak), season / biome (summer/autumn/winter/desert — terrain, trees, grass, sky, fog, snowy roofs), water (lake / no lake / archipelago with swimmable sea channels), buildings (few/normal/many) and vegetation (sparse/normal/dense); each can be Random, or Randomize all |

Settings and bindings are stored in `localStorage`.

## Gameplay overview

* **Island** (~1.5 × 1.5 km): fBm heightmap with an island mask, beaches, meadows, forests, a snowy
  mountain and a lake. 10 named POIs (Rusty Docks, Pine Hollow, Neon Heights, Salvage Yard, Frost Peak,
  Sunny Acres, Mossy Mill, Crater Camp, Lakeside Lodge, Copper Quarry) plus lone cabins, camps,
  watchtowers and wrecks. Multi-storey buildings have enterable interiors and stairs (towers have a
  switchback stairwell up to the roof).
* **Destruction & harvesting**: trees (wood), rocks (brick), building parts and cars (by material)
  can be pickaxed; hitting the blue weak spot doubles the yield. Bullets and explosions damage
  structures too.
* **Weapons**: Assault Rifle, Pump Shotgun, SMG, Sniper (projectile with drop), Pistol, Rocket
  Launcher, Grenades; 5 rarities (grey → gold) scale damage, reload time and accuracy. Bloom grows
  with firing/moving/jumping and shrinks when crouching/aiming; recoil, headshots (×2–2.5), damage
  falloff, ammo types (light / medium / heavy / shells / rockets).
* **Health**: 100 HP + 100 shield. Bandages (to 75 HP), Med Kit, Small Shield (+25 up to 50),
  Shield Potion (+50 up to 100). Using items takes time and is interrupted by damage.
* **Building**: 4 × 4 × 3 m grid, wall / floor / stairs / roof in wood (150 HP) / brick (300) /
  metal (450), 10 mats each. Pieces start weak and harden over time, show cracks, shatter into debris,
  and unsupported structures collapse. Walls and floors can be edited (3 × 3 tiles: doors, windows).
* **Storm**: 8 phases (wait → shrink), damage 1 → 15/s ignoring shields. White circle = current safe
  zone, blue = next. Purple wall, fog/sky tint, vignette and drone sound inside.
* **Match flow**: Menu → Lobby → Sky Bus → In match → Spectate (follow your killer / next player) →
  Results (STORM CHAMPION screen or placement, eliminations, damage, survival time, materials, accuracy,
  structures built) → Play again without reloading. A match lasts roughly 10–12 minutes.

## Architecture

```
index.html, style.css, server.mjs, vendor/three.module.js
src/main.js              WebGL check + bootstrap
src/core/                Game (renderer, fixed 60 Hz loop + interpolated render, state machine),
                         Input (bindings, pointer lock), Settings, EventBus, seeded RNG, simplex noise,
                         config (tuning + quality presets), gpu (GPU detection)
src/world/               Heightmap, WorldGen (POIs, layout, sites, prop placement), Buildings
                         (generators with stair waypoint chains), Structures (destructible instanced
                         parts), InstancedShapes (pattern shader), Props (trees/rocks/bushes/grass,
                         region-culled), Loot (items, chests, ammo boxes), Colliders + SpatialHash,
                         Physics (raycasts, ground queries), TerrainView/Water/Sky, Models
src/player/              Character (shared state), Motor (capsule physics, step-up, slopes, swimming,
                         fall damage, freefall, glider), PlayerController, CameraRig (collision, ADS,
                         shoulder swap, shake), CharacterView (instanced procedural animation),
                         Inventory, Interactions
src/combat/              Items (weapons/consumables/loot tables), Damage (pure math), Combat
                         (hitscan, projectiles, explosions, pickaxe, consumables)
src/build/               grid (pure helpers), BuildSystem (placement, support graph, edit, ghost)
src/ai/                  NavGrid (2 m grid + A*), Navigator (time-budgeted queue + path cache),
                         Bot (utility FSM, perception, navigation, combat, building, looting),
                         Difficulty, Names
src/match/               Match (systems + flow), SkyBus, Storm (pure phase logic)
src/ui/                  HUD (bars, hotbar, minimap, compass, kill feed, map, damage numbers),
                         Menus, Icons, TouchControls (joystick, look, buttons)
src/audio/               AudioEngine (procedural SFX, loops, generated lobby music, 3D panning)
src/vfx/                 Effects (debris, glow particles, smoke, tracers, decals, storm wall)
src/xr/                  WebXR VR: XRManager (session, play-space rig, controllers, haptics, ?vrsim=1),
                         XRPlayer (first-person rig, room-scale walking, input mapping, held weapon,
                         grab / swing / throw, spectator camera), XRWeapons (held guns, iron sights,
                         scope), XRGlider (canopy animation), XRHints (controller button cards),
                         XRHud (wrist panel + head-locked messages), XRPanel (laser-clicked menus),
                         XRComfort (vignette, teleport arc), xrLogic (pure helpers)
src/debug/               DebugOverlay (F3), DebugTools (?debug=1) + nav-grid visualization
tests/                   node:test logic tests
tools/use-nvidia-gpu.ps1 assigns browsers to the high-performance GPU (Windows)
tools/build-single.mjs   single-file build (esbuild) -> dist/
```

* **Simulation vs rendering**: game state (characters, colliders, loot, builds, storm) is plain data
  updated at a fixed 60 Hz; views read it and interpolate. Systems talk through an `EventBus`
  (shots → audio/VFX/AI hearing, damage → HUD, builds/destruction → nav-grid updates...).
* **Player and bots share the same rules**: bots fill the same `intent` struct the player controller
  fills, and use the same motor, weapons, spread, building and loot code.
* **Rendering budget**: buildings, build pieces, characters (per body part), loot, props and particles
  are instanced (dozens of draw calls total); props are split into 16 regions for frustum / shadow /
  distance culling; the shadow map follows the player.

### Bot AI

* **States**: Drop → (Land) → Loot / Gather → Rotate → Hunt / Fight → Heal (retreat / box up) → Dead,
  chosen by utility scores (health, ammo, storm urgency, enemy distance, loadout) with hysteresis.
* **Fair perception**: 110° FOV, line-of-sight raycasts, view range by difficulty and target posture,
  hearing (shots, sprinting footsteps, building, pickaxe), damage reveals the attacker's rough
  position, memory of the last known position. Bots sometimes decide to avoid a fight while looting.
* **Navigation**: 2 m nav grid from the heightmap + colliders (updated when things are built or
  destroyed), time-sliced A* (a search pauses when the per-frame budget is used up and resumes next
  frame, so it never causes hitches) with a binary heap, partial paths and smoothing, path cache, waypoint chains for stairs/upper floors, separation, and stuck recovery (jump → re-path →
  break the obstacle → build a ramp → step back onto the nearest walkable cell and pick a new goal).
  Bots keep walking toward the goal while a path is being searched, retry failed searches with a
  back-off, drop unreachable objectives (loot on a floor they can't reach, blocked rotate spots), and
  an idle watchdog re-plans any bot that stands still for ~5 s without a reason (fighting, healing,
  harvesting and hiding count as reasons).
* **Combat**: weapon choice by distance, reaction time, aim error that settles over time, burst fire,
  strafing, jumping, crouching, ADS, walls when shot, ramps toward high enemies, boxing up to heal.
* **Tactics**: target leading (velocity prediction; sniper/rocket flight time and bullet drop),
  taking cover behind trees/rocks/walls (a spot verified to be out of the enemy's line of sight) to
  reload or heal, retreating from lost fights, grenades lobbed along a simulated arc at enemies hiding
  nearby, shooting (or rocketing) the builds an enemy hides behind — never their own cover, they peek
  around it instead — and chasing to where a fleeing target is heading.
* **Difficulty** (Easy / Medium / Hard / Expert / Mixed): reaction 0.7 → 0.11 s, aim error, how long the
  aim takes to settle after spotting someone, pauses between bursts, turn speed, fire rate, aggression
  and how reliably they take a fight, build chance, looting smarts, view distance, hearing, memory,
  target leading, use of cover, grenades and build-breaking. Duel benchmark (bot with an AR vs a
  player strafing at 6 m/s, 20 m): Hard ≈ 33% accuracy, first hit ≈ 1.5 s; Expert ≈ 39%, ≈ 0.7 s.
* **Drop**: every bot first picks a landing spot anywhere within glide reach of the bus route (named
  POIs, small sites, lone buildings or open land; crowded spots are picked less often), then jumps
  when the bus passes closest to it — the lobby spreads over the island instead of one big cluster.
* **Personalities** (`src/ai/Personality.js`), on top of difficulty, shown in the kill feed and the
  spectate bar:
  | | Personality | Play style |
  |---|---|---|
  | 🔨 | Builder | builds walls/ramps on almost every hit and before the shots land, harvests 2× more materials |
  | 🎯 | Sharpshooter | ~40% less aim error, more headshots, always ADS, loves snipers/ARs, keeps distance |
  | ⚡ | Rusher | aggressive, faster reactions, shotguns/SMGs, closes in, rarely retreats, chases by sound |
  | 🛡 | Survivor | avoids fights, heals early, uses cover, rotates ~25 s earlier, retreats sooner |
  | 💣 | Tactician | grenades during fights, breaks enemy builds, loves rocket launchers |
  | | All-rounder | the plain difficulty preset |
* **LOD**: decisions at ~12 Hz near the player, ~4.5 Hz mid-range, ~2 Hz far away.

## Design decisions & simplifications

* Characters collide as vertical cylinders; bullets test a head sphere + body cylinder.
* Loot has simple physics: dropped weapons / ammo arc out, tumble in the air, bounce off floors and
  walls, and anything resting on a floor, build piece or crate that gets destroyed (items and chests)
  falls down instead of floating.
* Stairs/roofs are wedge/pyramid colliders (smooth slopes); building interiors use ramps.
* The pickaxe is on key 1 (and F) and the five item slots on 2–6, so all slots have number keys.
* Building levels snap to a global 3 m grid; on slopes walls choose the level that leaves at most
  ~2 m buried and ~1 m gap.
* Far-away bot fights are simulated fully (no statistical shortcut) — the simulation is cheap enough
  (~0.3 ms per tick for 50 characters).
* Post-processing (storm vignette / tint) is done with fog, sky tint and a CSS overlay instead of a
  render-target pass, to stay fast on integrated GPUs.
* Ctrl crouches as requested only in fullscreen with the Keyboard Lock API (Chrome / Edge); outside it
  browsers can't block Ctrl+W, so C is the default and pressing Ctrl in-game shows a warning.

## Tests

`npm test` covers: seeded RNG + deterministic heightmap, shield/health damage, headshot/rarity/falloff,
healing caps, loot tables, inventory stacking/swapping, all storm phases (circles nested, closes),
storm interpolation, A* (straight, around walls, partial paths), ramp surfaces, build-grid keys/bounds/
helpers, GPU renderer-string detection, and the VR helpers (controller button mapping with edges and
hysteresis, snap / smooth turn direction, turning around the head, physical crouch, teleport targets,
hand velocity, context-dependent controller hints incl. left-handed button letters).
