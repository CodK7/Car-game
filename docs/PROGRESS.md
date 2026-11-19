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
| W6 — gameplay | DONE | tests green (77), full loop in Edge (`tests/measure_loop.mjs`), MP `tests/measure_net.mjs`, `docs/evidence/w6_*.png` |
| U1 — language + cars | DONE | 86 tests, smoke 5/5, `docs/evidence/cars_*.png`, Low FPS 72–74 |
| U2 — local Patrol VTC model | DONE (local only) | 89 tests, smoke with and without the GLB, Low FPS 64 with the model |
| U3 — shareable zip | DONE | `npm run share` → `release/WahibaSands.zip` (34.7 MB), tested from a clean extract, 0 console errors |
| U4 — settings + phone/tablet | DONE (no real phone tested) | 97 tests, smoke 5/5, `tests/measure_fpscap.mjs`, phone-size check in the Browser pane |
| U5 — Patrol only, drift setup, Ultra/Legendary | DONE (Ultra/Legendary FPS unverified) | 90 tests, smoke 7/7, `tests/drift.test.ts` → `tests/tmp/drift_metrics.json`, `docs/evidence/u5_drift_hud.jpg` |

## U5 — Patrol only, drift / hajwala setup, Ultra + Legendary quality (DONE, 2026-11-19)

User request: remove every car except the Nissan, give it the best drift / hajwala ("تطعيس / هجولة") setup instead of the old one, and add Ultra / Legendary quality presets that only strong GPUs can run.

- **Cars:** Camry, LC300 and LC70 removed (`vehicles.json`, `bodies.json`, `audio.json`, meshes, recovery partner → patrol). Old saves / `?veh=lc70` fall back to the Patrol.
- **Drift setup (Patrol VTC):** steering lock 33° → 48° (angle kit, speed reduction 0.55 → 0.2), anti-roll bars F 26000 → 18000 / R 12000 → 32000 N·m/rad, rear spring 50000 → 58000, rear tyre grip ×0.95, handbrake 2600 → 6500 N·m, starts in 4H with the rear locker in (welded-diff style). Press 1 for 2H on hard ground; a start hint says so.
- **Drift assist** (settings → مساعد الدرفت, default on, `src/config/drift.json`): counter-steer by the body slip angle + a d(slip)/dt damping term, and the throttle eases off past 35° so a keyboard W does not spin the car. Off = fully manual.
- **Drift HUD:** angle, combo score with multiplier (×1…×5), last / best score.
- **Quality:** Ultra (DPR up to 2, terrain detail 2.3, 3072 shadow cascades, 5000 particles, trees to 6.5 km) and Legendary (render scale 1.5 = supersampling, DPR up to 3, terrain detail 3.4, 4096 shadow map, 4096 deformation grid, 12000 particles, trees to 10 km). Auto never selects them. The settings panel shows a warning under them. Resolution slider max 150 % → 200 %.

**Drift metrics** (`tests/drift.test.ts`, 60 km/h, full lock + handbrake 0.4 s, then full throttle + light inward steer for 5 s, 2H + locker; drift = slip > 15° at > 18 km/h, spin = slip > 100°):

| Run | drift time (s) | max angle | spun | avg km/h |
|---|---|---|---|---|
| asphalt, drift setup + assist | 4.55 | 52° | no | 38 |
| asphalt, drift setup, no assist | 0.81 | 90° | yes | 25 |
| asphalt, old setup, no assist | 0.86 | 90° | yes | 26 |
| asphalt, old setup + assist | 3.62 | 58° | no | 49 |
| loose sand (2H), drift setup + assist | 1.72 | 48° | no | 26 |

Parameter sweep (same scenario, with assist): 33° lock spins (the 48° lock is what makes long drifts possible); rear grip ×0.9 bled speed (3.18 s) vs ×0.95 (4.55 s); the stiff rear bar adds about 0.4 s; handbrake torque made no difference once the rears lock.

**Smoke 7/7:** fly, drive, medium (ar), high (en), ultra (9.9 M triangles), legendary (11.5 M triangles), old `veh=lc70` parameter. One earlier smoke run timed out loading the page after Legendary (software GPU in headless Edge); the rerun passed.
**Browser pane:** start screen lists only the Patrol. Settings show Ultra / Legendary + warning. Legendary renders the canvas at 1536×1152 for a 1024×768 view (1.5×) with no console errors. On the dunes: 4H → 2H at 55 km/h, A + Space flick → slide up to 78° that recovered, drift score 45.

**Open issues (U5):**
- 2H from standstill on the soft dune spawn digs in (hence the 4H start). In 4H a handbrake entry barely rotates the car (the part-time transfer case ties the axles); drifting needs 2H.
- The stiff rear bar costs articulation: the old 1.2 m cross-axle pit test rolled the Patrol over; it now uses a 0.4 m pit.
- **Unverified:** Ultra / Legendary FPS on a strong GPU (only checked that they render here; the Browser pane was hidden, so no FPS number). Drift feel with a real keyboard / gamepad / touch by a human.

## U4 — settings button + phones and tablets (DONE, 2026-11-19)

User request: a settings button to control FPS and resolution, and the game should run on phone, iPad and PC.

- Gear button (⚙, top-left, also on the start screen) → `src/game/settingsUi.ts`. Saved in localStorage (`wahiba.settings.v1`, `src/core/settings.ts`).
  - Graphics quality: Auto / Low / Medium / High.
  - FPS limit: none / 30 / 45 / 60 / 90 / 120 (`FrameLimiter` in the rAF loop).
  - Resolution: Auto (preset) or 30–150 % render scale, with the real pixel size shown.
  - Also: FPS counter, touch controls Auto/On/Off, fullscreen (where the browser allows it), language, reset to defaults.
  - URL parameters `?quality` / `?scale` still win, so scripts and smoke tests are unchanged.
- Phones and tablets get lighter defaults (`src/config/settings.json`): Low, 30 FPS cap, DPR capped at 1.5 (desktop 1.25).
- Touch controls (`src/core/touch.ts`) are shown on touch devices, or after the first finger touch when set to Auto.
  - Left: floating steering stick (analog). Right: gas, brake/reverse, handbrake.
  - Top: menu, camera, reset, 4×4 mode cycle, tyre psi −/+. Bottom: winch, reel in (hold), recovery car, dig.
  - Dragging on empty screen orbits the camera.
  - The buttons feed `Input.virt` / `Input.hold(code)`, so the game logic did not change.
- Viewport meta for mobile: no pinch zoom, safe-area insets (notch), `touch-action: none` on the canvas. Smaller HUD on small screens.
- Phone on the same Wi-Fi: `npm run dev:lan`, then open `http://<PC IP>:5173` on the phone.
- Measured FPS limit (real Edge window, 60 Hz): cap 0/30/45/60 → 59.6 / 30.0 / 44.8 / 59.7 FPS (`tests/measure_fpscap.mjs`).
- Phone-size check (Browser pane, 740×360, Android UA): mobile defaults were applied and the touch controls showed. Synthetic touch input:
  - gas + stick → throttle 1, steer 0.72, the car moved; both returned to 0 on release.
  - the 4×4 button cycled 4H → 4L, and the camera button switched chase → bonnet.
- **Unverified:** no real phone or iPad was tested (FPS, memory for the 32 MB heightmap, iOS Safari WebGL2/half-float, audio). Fullscreen is not available on iPhone Safari.

## U3 — shareable zip for friends (DONE, 2026-11-18)

User request: share the game with friends to play on their own PCs (not online play), as a zip.

- `npm run share` (`Tools/Share/make_zip.mjs`): type-check → production build in Vite mode `share` → `release/WahibaSands/game/`.
  - It deletes `local/`, refuses to finish if any `.glb` is left, adds the launchers and zips with Windows' `tar.exe`.
  - `release/` is git-ignored.
- Friends: Extract All → double-click `Play.bat`. It runs `serve.ps1`, a ~70-line static server on 127.0.0.1 written in PowerShell (ships with Windows, nothing to install), and opens the default browser. A served page is needed because browsers block a site's module scripts and data fetches from `file://`.
- macOS/Linux: `sh play.sh` (python3 http.server). `README.txt` covers both in Arabic and English, plus the Copernicus/OSM credits.
- In mode `share`, `modelBody` skips the local-model probe (no 404s in the console).

**Evidence:** extracted the zip into an empty folder and ran `serve.ps1 -NoBrowser` there; headless Edge loaded patrol and camry with 0 console errors (59/72 FPS headless). `/local/patrol_vtc.glb` → 404, and the zip contains no `.glb`.
**Unverified:** Play.bat double-click on another PC (SmartScreen may show "Windows protected your PC" for a downloaded .bat; the README says how to continue). The start screen itself is skipped under automation, so it was not seen in this test.

## U2 — user's own Patrol VTC model, local only (DONE, 2026-11-18)

User request: add the car in `nissan_ftk.zip` (a BeamNG mod, "Patrol Y61" by kn0z). It is not CC0, so the user chose **local only**: the converted model lives in `public/local/` (git-ignored, never committed or published), and a clean checkout uses the procedural body.

- **Converter** `Tools/Models/` (Python via uv + Node): `dts.py` reads the Torque3D DTS v26 `*.cached.dts` (all three memory sections, node transforms, strips/fans, material list), `jbeam.py` resolves the parts tree from the `.pc` config, `mats.py` reads the material JSON, `simplify.mjs` decimates each material group with meshoptimizer, and `convert.py` writes a GLB in the game's body frame.
  - It bakes the config's paint design (skin + colour palette, paints 1/2/3) into one 2048² JPEG on UV1.
  - It drops engine-bay parts, emblems, lettering and stickers.
  - Result: 609 k → 256 k triangles, 10.7 MB.
- **Game side**: `src/vehicle/modelBody.ts` (new). `bodies.json` gives `patrol.model` = `{url, yOffset, pitchDeg, fitWheelbase, eye}`.
  - The model is placed so its axle line lands on the sim's rest wheel centres, scaled along z to the preset wheelbase.
  - The procedural children are hidden; the procedural wheels stay (they spin and steer).
  - Missing file → the procedural body, silently.
  - `objMaterial` gained an optional albedo `map` (on `uv`).
  - Cockpit eye comes from the model.
- **Bug found on the way**: the BeamNG→game x mirror flipped the triangle winding, so the double-sided shader flipped the normals inward (grey, dented-looking paint). The converter now reverses the index order.

**Evidence:** screenshots kept out of the repo (`tests/tmp/vtc_*.png`, third-party look).
- Low preset, real Edge window, UHD 630, with the model: 64.3 FPS (1 % low 37), 0 errors.
- `npm run smoke` passes with and without `public/local/patrol_vtc.glb`.
- `tests/modelBody.test.ts`: placement maths, Node fallback, URLs under `local/`.

**Open issues (U2):**
- The grille badge is part of the grille mesh in the mod (separate emblem meshes are removed). Fine for the user's local copy only.
- Parts the mod borrows from BeamNG base content (some door cards, sun visors, grille insert variants) are not in the DTS and are missing.
- Paint gloss is generic (the mod's PBR and clear coat are not ported); the body reads slightly bright at noon.
- High preset still < 30 FPS (as before).

## U1 — Arabic/English, high-detail bodies, three new cars (DONE, 2026-11-18)

User request: pick Arabic or English before the game starts; higher detail on the wagon and the pickup; add a 2020 GCC Camry V6, a 2026 Land Cruiser GXR (4.0 V6) and a Nissan Patrol VTC.

- **Language**: start screen (title, language, car picker, Start button) before the game; the choice is saved (`wahiba.lang`) and can also be changed in the B menu. All UI text is in `src/config/strings.json` (en/ar, same keys + placeholders, tested). Config entries carry `*_ar` fields. The UI is RTL in Arabic. Automation skips the screen (`navigator.webdriver` or `?play`); `?lang=ar|en`.
- **Cars** (`src/config/vehicles.json`): `patrol` is now labelled Patrol Super Safari VTC (Y61 4.8, same physics), plus `lc300` (GXR 4.0 V6, 6AT, full-time 4WD, 4H/4L only), `camry` (3.5 V6, 8AT, FWD, 2H only, traction control) and `lc70`. The menu and start screen list every preset.
- **Bodies** (`src/vehicle/vehicleMeshes.ts`, designs in `src/config/bodies.json`): lofted shells from smooth profiles, with exact wheel-arch cut-outs, glass and pillars, an interior (seats, dash, gauges, steering wheel), lamps, grilles, bumpers, mirrors, seams, handles, flares, roof rails, steps, snorkel and a pickup bed. About 37 k triangles per body. **Wheels** (`src/vehicle/wheelMesh.ts`): lathed tyre with AT blocks or highway grooves, multi-spoke / 6-spoke / steel faces, brake disc, lug nuts; about 6–8.5 k triangles each. Original shapes; no logos or badges.
- **Physics changes**: `driveline.fwd` (primary axle = front), `driveline.modes` (allowed transfer modes), `driveline.tc` (throttle-cut traction control). Lock-up clutch: held state (0.6 s) and stays open while TCS cuts; the slipping clutch locks implicitly whenever it can sync in one step. This fixed a lock-up chatter / wheel-hop limit cycle that the FWD Camry exposed.

**Evidence:** `docs/evidence/cars_{camry,lc300,patrol,lc70}_{front34,rear34,side,nose,cockpit}.png` (`node tests/shots.mjs cars_<veh> "mode=drive&quality=high&nosave&veh=<veh>&lang=ar&play" tests/views/cars.json`). Low preset, real Edge window, UHD 630 (`node tests/bench.mjs low 10 "mode=drive&autodrive&nosave&play&veh=<veh>"`): patrol 72.7, camry 73.6, lc300 71.9 FPS (1 % low 33–37). 0–100 km/h on flat hard ground (sim): Camry 7.1 s (real ~6 s), LC300 ~10 s.

**Open issues (U1):**
- Camry 0–100 is ~1 s slower than the real car (the final drive is uncertain: 2.56 vs 3.46, see DECISIONS U1.3).
- Bodies are good procedural approximations, not scans: no external 3D models were downloaded, because real-car models online are almost never CC0 and the project allows only original or CC0 assets.
- The High preset is still below 30 FPS on this GPU (unchanged from W5).

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

## W6 — gameplay (DONE)

Run: `npm run dev` → http://localhost:5173. Multiplayer: `npm run server` in a second terminal, then open http://localhost:5173/?mp in two browser windows (`?server=ws://host:8787` for another machine). Keys are in the help line; **B** opens the menu (missions, vehicle, garage, livery), **P** is photo mode (Enter saves a PNG, `,` `.` change the time of day).

**Milestones (6 of the 8 allowed):** M1 rope/winch/anchor maths · M2 recovery in game (winch, strap partner car, dig, HUD tension bar, beached-only rules) · M3 garage (data-driven parts) · M4 missions + save · M5 photo mode + menu · M6 multiplayer server + client.

**Full loop in a real Edge window** (`node tests/measure_loop.mjs`, medium, results `tests/tmp/loop.json`, 0 console errors):

| Step | Result | Evidence |
|---|---|---|
| Drive up the east dune face in 2H at 40 psi | beached after 11 s (41 FPS) | `w6_stuck.png` |
| Press R while beached | refused ("air down, rock it, dig, winch or call the recovery car"), moved 0.1 m | — |
| Winch to a sand anchor (H, hold J) | car pulled 4.03 m, free (beached=false), peak 6.4 kN, 46 FPS | `w6_winch.png` |
| Garage: buy balloon tyres | credits 3000 → 2100, tyre width 0.275 → 0.358 m, mass +40 kg | `w6_garage.png` |
| Recovery mission (strap + snatch on the stranded red Patrol) | stranded car beached at start, won in 5 s, credits → 3300 | `w6_snatch.png`, `w6_rescued.png` |
| Photo mode | simulation frozen, HUD hidden | `w6_photo.png` |
| Reload page | save kept (credits 3300, mission done, balloon tyres) | — |

**Recovery numbers (`tests/recovery.test.ts`, Node):**
- Strap snatch at 3 m/s: 11.25 kJ stored, peak 27 kN.
- Strap snatch at 9 m/s: breaks (over the 78 kN MBS).
- Winch stall pull: 53 kN.
- Beached car alone: moves only 0.36 m.
- Winch alone: 4.05 m.
- Snatch: 5.52 m.
- Dig: rear dug 0.27 m → 0, belly load 10.5 kN → 0; then 15 psi + reverse drives out 33.7 m.

**Garage (`tests/garage.test.ts`):**
- The full parts × effects table is in [`docs/evidence/w6_parts_table.md`](evidence/w6_parts_table.md), generated by the test.
- Turbo kit adds more than 20 % peak power (188 → 245 kW).
- Paddles climb a 14° loose slope in 2H at 22 psi (29.7 m), where highway tyres roll back.
- Full load at 18° covers less than 0.85× the distance of an empty car.
- Turbo at 16° covers more than 1.15× the distance of stock.

**Missions (`tests/missions.test.ts`):** save round trip, part fitting with credits, all gates on real terrain, time attack timing, convoy checkpoints, free-roam km credits, rescue won in 5.5 s (31 kN strap).

**Multiplayer (`tests/net.test.ts` + `node tests/measure_net.mjs`):**
- Interpolation under 120 ± 40 ms lag and 10 % loss, vehicle circling at 10 m/s: mean error 0.00 m, max 0.039 m against the delayed truth. Dead-reckoning is capped at 0.5 s.
- Server run with 60 ± 30 ms lag and 10 % loss:
  - 8 players admitted, the 9th gets `full`.
  - Strap created by the server (rest 9 m).
  - Slow pull: 6.1 kN.
  - Fast yank: the server breaks the strap and the break reaches the client.
- Browser test: two Edge windows on a server with 80 ± 30 ms lag and 5 % loss.
  - Both players see each other ("online · 2 players").
  - Strap created; the LC70 pulls the Patrol 1.7 m.
  - Server peak 28 kN vs client peak 4.5 kN.
  - 0 console errors (`w6_mp.png`).

**Open issues (W6):**
- Convoy mission = timed checkpoints, not AI convoy cars (one AI partner is used only for recovery).
- Multiplayer tested only on this machine (localhost, simulated loss). Each client owns its own physics, so under lag the two clients feel different rope forces. In the browser test the server peak was 28 kN and the client peak 4.5 kN. The server's break decision is final.
- The partner car's pulling AI is simple (drives straight away, holds 2.5 m/s); it does not path-find around dunes.
- Livery is a flat paint colour (no decals).

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
