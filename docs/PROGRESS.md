# PROGRESS — Web version (Three.js)

Read with `DECISIONS.md`. Plan: `PROMPTS_Wahiba_WebGame.md` (Section A → B → W1…W6). Machine: i5-10400, Intel UHD 630 (integrated), 16 GB.

## Status

| Phase | Status | Evidence |
|---|---|---|
| A — cleanup | DONE | 970.6 MB freed; "maybe" list below |
| B — reuse GIS | DONE | `Tools/Web/export_web.py` → `public/terrain/*`; `CLAUDE.md` rewritten for web |
| W1 — world | DONE | tests green, screenshots `docs/evidence/w1_*.png`, FPS below |
| W2 — sand | DONE | tests green (29), `docs/evidence/w2_*.png`, benchmark in DECISIONS W2.1 |
| W3 — vehicle | DONE | tests green (43), `docs/evidence/w3_*.png`, metrics table below |
| W4 — audio | DONE | tests green (50), `tests/measure_audio.mjs`, demos `docs/evidence/w4_demo_*.wav` |
| W5 — graphics | DONE (High < 30 FPS here) | tests green (53), `docs/evidence/w5_*.png`, `tests/measure_flicker.mjs` |
| W6 — gameplay | not started | |

## Section A — cleanup (2026-11-16)

Deleted ("sure": installer leftovers of the 2026-11-15 Unreal/Visual Studio attempt, all in `%TEMP%`):

| Path | Size |
|---|---|
| `%TEMP%\iazwsong` (Windows 11 SDK installer payload) | 834 MB |
| `%TEMP%\dd_*.log` (630 Visual Studio setup logs, 2026-11-15/16) | 96 MB |
| `%TEMP%\windowssdk` (SDK setup logs) | 40.6 MB |
| `%TEMP%\VSLogs` | 0.1 MB |
| **Total freed** | **970.6 MB** (C: free space grew 972.4 MB) |

Not touched: Epic Games Launcher, its config/logins, Fortnite, Epic Online Services (all user-installed 2026-11-13).

**"Maybe" leftovers — NOT deleted, for you to review:**

| Path | Size | Why it is only "maybe" |
|---|---|---|
| Visual Studio Community 2022 (`C:\Program Files\Microsoft Visual Studio` 6.4 GB, `C:\ProgramData\Microsoft\VisualStudio\Packages` 3.4 GB, `C:\Program Files (x86)\Microsoft Visual Studio` 0.3 GB) | ~10.1 GB | Installed 2026-11-15 for Unreal. It is an installed program: remove it with the Visual Studio Installer (Uninstall), not by deleting folders. You may want to keep it. |
| `C:\Program Files (x86)\Windows Kits` (Windows SDK 10.0.26100) | 2.2 GB | Installed with VS on 2026-11-15. Remove via Apps & features if VS goes. |
| .NET 8/9 SDK/targeting packs installed 2026-11-15 by VS | (inside the above) | Other apps may use them. |
| `C:\Dev\WahibaOffroad` | 0.6 GB | Copy of this project + a Godot attempt from 2026-11-15 (Godot game code, docs, evidence). Obsolete, but it is prior work, not a cache. |
| Godot (winget package `GodotEngine.GodotEngine…` 173 MB, `%APPDATA%\Godot` + `%LOCALAPPDATA%\Godot` 6 MB) | 0.18 GB | Installed 2026-11-15 by the earlier attempt. Uninstall with `winget uninstall GodotEngine.GodotEngine` if unwanted. |
| `Data/GIS/work/height_final_m.npy` | 62 MB | Reproducible, but the GIS `osm` step and the web test fixture read it; deleting it forces the 5-minute rebuild. Kept. |

## Section B — reuse

- Consumed `Data/GIS/out` as-is (no GIS rerun). `Tools/Web/export_web.py` writes `public/terrain/`: `height_u16.bin` (32.5 MB, same 16-bit values as the PNG), `masks.png` (R loose sand, G crest, B slip face; 2017²), `ripple.png`, `osm.json` (1002 road pieces, 90 buildings, 23 POIs, 1 power line, in metres), `manifest.json`, and `tests/fixtures/height_samples.json`.
- Command: `uv run --directory Tools/GIS python ../Web/export_web.py` (or `npm run data`).

## W1 — world (DONE)

Run: `npm run dev` → http://localhost:5173/?mode=fly&debug

**Height accuracy (Vitest, `tests/terrain.test.ts`, vs the float source heightmap `height_final_m.npy`):**

| Check | Result |
|---|---|
| In-game height at 500 random texel centres | max error **1.68 mm** (16-bit quantisation) |
| Bicubic surface vs bilinear source between texels (1500 points) | max **0.085 m**, RMS 0.019 m |
| Source chain (from GIS phase) final vs Copernicus DEM | max 5.85 m, RMS 0.87 m (intentional smoothing + detail, see D4/D5) |

The GPU vertex shader uses the same Catmull-Rom formula on the same R16UI texture as `TerrainData.heightAt` (code-identical; visual check only, no GPU readback test).

**FPS — real Edge window, UHD 630, scripted fly-through (`node tests/bench.mjs low,medium,high 10`), 1920×1080 window (canvas = window × renderScale):**

| Preset | Canvas | Avg FPS | 1% low | Tris |
|---|---|---|---|---|
| Low | 1137×564 | **75** (vsync cap) | 74 | 0.34 M |
| Medium | 1516×752 | **75** (vsync cap) | 74 | 0.53 M |
| High | 1896×941 | **47** | 23 | 1.37 M |

Synchronous render timing in the browser pane (`__app.measure()`, medium): 7.5 ms/frame (≈133 FPS bound). Terrain shadow bake: 0.2–8 ms per sun move.

**Delivered:** CDLOD quadtree terrain (32×32 instanced nodes, geomorphing, min/max-pyramid frustum culling, height fog); sand shader (loose/compact colour from masks, crest tint, ripple normals rotated to wind, far mega-ripples, quartz sparkle with sub-pixel facets, wind streaks on crests); analytic sky + real sun position for 22.38 N (time of day, keyframed colours); GPU-baked soft terrain shadows; OSM roads/tracks as draped ribbons; instanced Ghaf trees / shrubs / grass streamed by rules (slope, loose sand, crest, road distance; seed + density per preset); 6764 houses (90 OSM + street-lined procedural), 12 camps (8 OSM + 4 generated), 211 shade shelters on tracks, 491 power poles on main roads.

**Open issues (W1):**
- Secondary dunes still read as fairly regular wrinkles from the air (GIS detail layer; needs `detail.*` re-tune + 7-min rebuild — not done).
- Opposition-effect hotspot shows faint radial ripple streaks from high altitude.
- Houses are plain boxes; power-line wires are not drawn.

## W5 — graphics (DONE, High preset below 30 FPS on the UHD 630)

Run: `npm run dev` → `?quality=low|medium|high|auto`, `?debug` for the Effects folder (object shadows, shimmer, haze, haze density, lens dust, contrast, sand wisps). `?noshadow` / `?nopost` switch the new passes off.

What was added:
- **Object shadows** (`src/gfx/shadows.ts`): cascaded shadow maps in one depth atlas (Low 1×512, Medium 2×1024, High 3×2048), stable bounding-sphere fit snapped to whole texels, cascade 0 every frame / 1 every 2nd / 2 every 4th, 15 % blend between cascades, 4×4 bilinear PCF. Vehicle, trees, shrubs and houses cast onto the terrain and each other (terrain self-shadow stays baked from W1).
- **Post pass** (`src/gfx/post.ts`, Medium/High): half-float HDR target + depth texture, then one full-screen pass: heat shimmer (distance-masked, grows with sun height, depth-checked so the car gets no halo; High only), dust haze (depth-based, forward-scattering towards the sun), lens dust (only when the sun is in/near the frame), gentle S-curve contrast, ACES, sRGB, dither.
- **Sand wisps** = the existing animated wind streaks on dune crests (terrain shader), now a toggle.
- Physics pause flag `drive.frozen` (used by the stability test, reused by photo mode in W6).

**Evidence (real Edge window 1600×900, patrol, `node tests/shots.mjs w5_<q> "quality=<q>&veh=patrol" tests/views/w5.json`):** `docs/evidence/w5_{low,medium,high}_{golden_chase,golden_sun,noon_chase,noon_far}.png`.

| Preset | golden_chase | golden_sun | noon_chase | noon_far |
|---|---|---|---|---|
| Low | 55.6 | 67.8 | 68.0 | 68.8 |
| Medium | 43.9 | 47.3 | 53.4 | 53.9 |
| High (renderScale 1.0, first run) | 21.3 | 23.3 | 24.4 | 25.0 |
| High (renderScale 0.85, finest cell 0.625 m — final) | 24.5 | 26.8 | 28.1 | 31.2 |

**Temporal stability** (`node tests/measure_flicker.mjs <q>`; parked car, physics frozen, static camera, shimmer off, 6 frames 250 ms apart, pixels changing by > 24/255): Medium max 0.008 %, High max 0.034 % (only animated crest wisps). No temporal accumulation is used, so ghosting cannot occur. With physics running, the idle body vibration moves all edges (~5 % of pixels) — that is the engine rock, not shadow flicker.

**Tests:** `tests/shadows.test.ts` — cascade centre snaps to whole texels while the camera slides, projection size constant while turning, every cascade contains its frustum slice. Total 53 tests green, build + smoke pass.

**Open issues (W5):**
- High stays at 25–31 FPS on the UHD 630 after two fixes (render scale, terrain cell); it is meant for discrete GPUs. Auto picks Medium/Low here.
- Shadow correctness while the camera moves is covered by the snapping test and by eye on stills only, not measured live.
- No SSAO/bloom (the budget went to shadows and haze).

## W4 — audio (DONE)

All sound is procedural Web Audio (no samples). Click or press a key once to start it (browser autoplay policy). `?debug` panel → **Audio** (master volume, mute, offline CPU benchmark), **Audio layers** (gain per layer), **Audio audition** (override rpm/load/throttle/boost/speed/slip/loose/psi/cut/4L, buttons: belly impact, bottom-out, blow-off flutter, V8 drive-by with HRTF + Doppler).

| Layer | How |
|---|---|
| Engine | AudioWorklet (`src/audio/engineDsp.ts`): crank angle from rpm, cylinders fire in firing order (I6 1-5-3-6-2-4, cross-plane V8 1-8-7-3-6-5-4-2), raised-cosine exhaust pulses into per-bank formant resonators, banks panned → V8 burble, I6 smooth. Diesel knock, mechanical whirr, intake roar ∝ throttle·rpm |
| Limiter / overrun | fuel cut skips combustion + random exhaust pops, pop when fuel returns; overrun crackle when lifting above 2200 rpm (petrol strong, diesel weak) |
| Turbo | whine 2.4–7.8 kHz with boost, hiss, blow-off flutter on a sharp lift (LC70 turbo; Patrol is NA until a turbo part in W6) |
| Tyres / sand | scrub (band noise ∝ slip, pitch from loose + pressure), rolling rumble ∝ speed, spray hiss ∝ loose-sand slip |
| Driveline / chassis | straight-cut gear whine in 4L and reverse from driveshaft speed; belly impact and bump-stop clunk one-shots (synthesised buffers, 8-voice pool) |
| Environment | wind with two-LFO gusts ∝ speed, cockpit view muffles outside (low-pass 2.6 kHz); sparse open-air reverb (7 early reflections + 0.55 s thin tail, generated IR) |
| Spatial | remote vehicles: HRTF PannerNode, inverse rolloff, distance HF damping (≈3 kHz at 100 m), Doppler on the engine pitch, nearest-4 voice limit |

**Measured** (`node tests/measure_audio.mjs`, real Edge window, UHD 630 PC):

| What | Result |
|---|---|
| AudioContext after one click | `running`, 48 kHz, base latency 10 ms, both vehicles, no console errors |
| Main-thread `audio.update()` | 0.1–0.2 ms / frame (with a remote voice) |
| Audio-thread CPU, full graph (player engine + remote V8 HRTF + 4 noise layers + whine + reverb), offline 10 s | **55 ms per second = 5.5 % of one core** |
| Click check (max sample jump / mean jump) on the scripted demo | 5.3–6.4 (no outliers); DSP unit test with step changes every 0.25 s: 14 (noise-limited), peak < 0.3 |
| Node DSP alone (V8 + turbo) | 10.9 ms per second of audio |

Listening demos (8 s: rev sweeps, lift-off flutter/crackle, limiter bounce, a remote V8, tyre/wind beds): `docs/evidence/w4_demo_I6.wav`, `w4_demo_V8.wav`.

**Open issues (W4):** the sound is tuned by numbers and spectra only — **not verified by ear** (no listener overnight); levels between layers may need a mix pass. Sample slots (`audio.json → samples`) are wired but untested with real files.

## W3 — vehicle (DONE)

Run: `npm run dev` → http://localhost:5173/ (`?veh=lc70` for the pickup, `?box` for the old placeholder body). Keys: W/S, A/D, Space handbrake, 1/2/3 = 2H/4H/4L, L/K rear/front locker, [ ] tyre psi (8–40), M auto/manual, Q/E shift (manual), C camera (chase/bonnet/cockpit), V camera shake on/off, R reset. Gamepad: RT/LT analog throttle/brake, left stick steer, right stick orbit.

**Metrics** (`npm test` → `tests/vehicle.test.ts`, written to `tests/tmp/w3_metrics.json`; pure-TS sim, 120 Hz):

| Metric | Patrol-class wagon (4.8 I6, auto) | LC70-class pickup (4.5 V8 TD, auto) | Real reference |
|---|---|---|---|
| 0–100 km/h | 12.1 s | 16.5 s | Y61 4.8 ≈ 11–12 s; LC79 V8 ≈ 14–17 s (press tests) |
| Top speed | 184 km/h | 152 km/h | ≈ 180 / 150–160 (speed limited) |
| Braking 100–0, hard ground | 45.1 m (3.76 s) | 43.7 m (3.80 s) | 40–48 m typical for ladder-frame 4×4 on A/T tyres |
| 30° compacted slope, 15 s from standstill | 4L: +56 m; 2H: rolls back 80 m | 4L: +19.6 m; 2H: rolls back 108 m | — |
| Rolling sinkage on loose sand 12 / 35 psi | 5.4 / 10.7 cm | 5.3 / 10.4 cm | airing down halves sinkage (field rule of thumb) |
| Contact patch length 12 / 35 psi | 25 / 12 cm | 19 / 10 cm | — |
| Tilt-table rollover | 42° (SSF → 44.6°) | 42° (SSF → 43.0°) | static stability factor angle, minus suspension roll |
| 20° side slope at 20 km/h, 8 s | drift 1.4 m, upright | drift 0.04 m, upright | — |
| Cross-axle pit (lc70, 2H) | — | open diff: stuck (−9.9 m, slides back); rear locker: +17.4 m | — |
| Heat soak: 150 s full load up 12° loose | coolant 112 °C, power ×0.89 | — | — |
| 60 s random inputs on dunes | min up.y 0.91, no NaN | — | — |

**Browser (real Edge window 1600×900, Low preset, real terrain at the spawn corridor):** `node tests/shots.mjs w3_patrol "quality=low&veh=patrol" tests/views/w3.json` (and `w3_lc70`).

| Shot | Patrol FPS | LC70 FPS |
|---|---|---|
| `*_body_front.png` (parked) | 60 | 54 |
| `*_body_rear.png` | 62 | 59 |
| `*_drive_chase.png` (auto-drive on the dunes, spray + ruts) | 68 | 68 |
| `*_drive_bonnet.png` | 69 | 68 |
| `*_drive_cockpit.png` | 68 | 68 |

(vsync cap 75 Hz.) `npm run smoke` passes (fly, drive, drive-medium; no console errors).

**Open issues (W3):**
- Full throttle in 2H on steep compacted slopes spins the open rear axle and rolls back (by design: no traction control); 4H/4L climb.
- Bodies are simple low-poly extrusions (original designs); no doors/interior detail beyond dash, wheel and cabin tub.
- LC70 at 35 psi, part throttle in deep loose sand shows a small periodic load oscillation (~0.6 s) — unverified in the browser at length.

## W2 — interactive sand (DONE)

Run: `npm run dev` → http://localhost:5173/?debug (drive mode is the default; `?veh=lc70`, `?deform=1024`). Keys in the on-screen help line.

**Evidence (real Edge window 1600×900, medium, `node tests/shots.mjs w2 "quality=medium&debug" tests/views/w2.json`):**

| Shot | What it shows | FPS |
|---|---|---|
| `w2_spray.png` | box vehicle driving in loose sand, spray from the rear wheels, ruts behind | 66 |
| `w2_tracks.png` | ruts with side berms, softened by slumping | 73 |
| `w2_bury.png` / `w2_bury_close.png` | 2H, 40 psi, full throttle up a 17–23° loose slope → `beached=true`, rear sink 0.28 / 0.56 m, belly on the sand (9 kN) | 73 |

Per-frame cost while driving (debug overlay): physics 0.1–0.5 ms, deformation upload 0.1–0.3 ms (~1.1 k texels), spray ≤ 2.5 k particles (medium).

**Tests (`tests/sand.test.ts`, `tests/sandVehicle.test.ts`):** airing down widens the patch and lowers sinkage; compact vs loose; low-speed wheelspin digs until stuck while rolling does not; groove + berm volume; slump softens walls; window recentre; 2H/40 psi on an 8° loose slope gets beached while 4H/15 psi climbs it; 20° compacted slope climbs in 4H; ruts left in the grid; grid CPU cost < 4 ms (measured 0.07–0.25 ms).

**Open issues (W2):**
- At idle on a slope the car creeps backwards slowly (~0.3 m/s braked on 20°) because the tyre model is regularised at low speed. Fix planned in W3 (static-friction anchor).
- Full throttle in 2H on a 20° *compacted* slope breaks traction and rolls back (open diff, tyre falloff past peak) — plausible but harsh; revisit with W3 tyre tuning.
- Placeholder box body only; real procedural bodies come in W3. → fixed in W3.
- Braked creep on slopes → fixed in W3 (static-friction anchor).
