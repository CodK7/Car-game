# DECISIONS

Why each choice was made. `ASSUMPTION` = picked without a hard source; revisit with better evidence.
GIS decisions D1–D7 come from the earlier (Unreal-plan) session and still hold; Unreal-only numbers are dropped.

## GIS (kept from the earlier attempt)

- **D1 DEM = Copernicus GLO-30** (newest epoch, best documented accuracy, open licence with attribution). SRTM/NASADEM (2000, login), ALOS (weak on sand), FABDEM (non-commercial) rejected.
- **D2 Area** 4033² at 5 m = 20.16 km, centred 22.38 N 58.78 E (verified from the DEM: N–S megadunes, 8° azimuth, 2.23 km spacing, relief up to 108 m). UTM 40N.
- **D4 Denoise σ = 10 m** (ASSUMPTION: 30 m bumps are radar speckle). **D5 Detail layer**: crest sharpening, secondary dunes (1 m σ, 60–160 m, 70° to the axis), 33° repose clamp — all ASSUMPTION. **D6 Masks** (loose/compact, crest, slip face) thresholds ASSUMPTION. **D7 OSM** via Overpass, ODbL credit in game.

## Section A / B

- **A1** Only `%TEMP%` installer payloads/logs of the 2026-11-15 attempt were "sure". Installed programs (Visual Studio, Windows SDK, Godot) need their uninstallers and might be wanted → "maybe", listed in PROGRESS. `C:\Dev\WahibaOffroad` holds prior work (a Godot attempt) → "maybe".
- **B1** Web terrain format: raw little-endian `uint16` (`height_u16.bin`) instead of a 16-bit PNG, because browsers decode PNGs to 8 bits per channel. Same values as the GIS PNG; uploaded as an `R16UI` texture and also used on the CPU. Masks packed into one RGB PNG at half resolution (10 m texels; they are smooth fields).
- **B2** `public/terrain/` is committed so the game runs with only `npm install && npm run dev` (no Python needed).

## W1 — world

- **W1.1 Terrain technique = CDLOD quadtree** with instanced 32×32 grid nodes (one draw call per node size), heights fetched in the vertex shader, morphing between levels, min/max pyramid (160 m blocks) for frustum culling. Chosen over a clipmap because the quadtree culls hidden dunes and the far terrain costs very little; over pre-built mesh chunks because a 20 km × 5 m mesh is 16 M vertices. Measured: Low 0.34 M tris at 75 FPS (vsync cap) on UHD 630.
- **W1.2 Bicubic (Catmull-Rom) height interpolation** on CPU and GPU (same code). Exact at texels (tested 1.68 mm), smooth slopes for the vehicle (bilinear creases at every 5 m texel would be felt by the suspension).
- **W1.3 Camera-relative rendering**: vertices are built relative to a snapped origin so float32 precision holds across 20 km (no shimmer at the map edges).
- **W1.4 Lighting model** is a small custom shader set (not three's PBR): sun Lambert + hemisphere ambient + height fog + baked terrain shadow, shared by every material. Keeps the per-pixel cost predictable on an integrated GPU.
- **W1.5 Terrain shadows** baked on the GPU by ray-marching the heightfield towards the sun (56 steps, ×1.11 growth), soft penumbra = 1.2° (sun disc + haze, ASSUMPTION). Re-baked only when the sun moves. Object shadows come later (W5).
- **W1.6 Sun position** from latitude 22.38 N and solar declination −18.5° (mid-November) — real geometry, not a hand-placed light. Sky colours are keyframes by sun elevation in `src/config/tod.json` (ASSUMPTION: artistic, matched to photos of Wahiba at noon/golden hour by eye).
- **W1.7 Placement rules** (`src/config/world.json`): Ghaf trees only on interdune floors (slope ≤ 6°, loose ≤ 0.35, no crest, ≥ 12 m from roads); shrubs ≤ 12°; grass ≤ 16°. ASSUMPTION: spacing/probabilities set for a sparse look. Deterministic per grid cell (same props when the window moves; tested).
- **W1.8 Houses**: OSM has only 90 buildings and no footprints for Al Mintarib, so residential streets get procedural houses (one per 30 m per side, 35 % skipped). ASSUMPTION; easy to turn off (`props.building.street.max = 0`).
- **W1.9 Quality presets** (`src/config/quality.json`): Low = render scale 0.6, coarser LOD, no post; Auto starts at Low and climbs only after two 4-s windows above 55 FPS (integrated GPU is the floor).

## W2 — sand

- **W2.1 Deformation technique = CPU-authoritative toroidal grid + dirty-rect upload** (not a GPU render target). The physics must read the ruts every 120 Hz step, so a GPU RT would need a readback. Measured on UHD 630 (`node tests/measure_deform_gpu.mjs`, `tests/sandVehicle.test.ts`):

  | Size (cell) | CPU grid: 8 stamps + slump + half-float pack / frame | GPU RT: 4 stamp passes | GPU RT: 64×64 sync readback |
  |---|---|---|---|
  | 512 (15.6 cm, 80 m) | **0.07 ms** | 0.34 ms | 0.91 ms (pipeline stall) |
  | 1024 (10.9 cm, 112 m) | **0.10 ms** | 0.11 ms | 1.61 ms |
  | 2048 (8.6 cm, 176 m) | **0.25 ms** | 0.12 ms | 6.40 ms |

  The GPU stamps are cheap but the readback stalls the pipeline (1–6 ms) and async PBO readback lags 1–3 frames (the wheel would sit in last frame's rut). The CPU grid is the single source of truth for physics and rendering; only changed texels are uploaded (`texSubImage2D`, RG16F; measured 0.1–0.3 ms, ~1 k texels/frame). Final cost while driving: ≈0.2–0.5 ms CPU, 1–16 MB GPU depending on preset (Low 512, Medium 1024, High 2048 via `quality.json`). The grid scrolls toroidally with the car (no copy when it recentres).
- **W2.2 Terrain shader** displaces vertices by the grid height and takes the normal from 4 texture taps; the second channel ("disturbed") darkens and kills ripples in the ruts. Edge of the window fades to 0 so there is no seam.
- **W2.3 Sink model = Bekker pressure–sinkage** z = (p/k)^(1/n), ground pressure from tyre pressure + carcass stiffness, k blended loose↔compact from the mask. Digging rate ∝ loose² × slip × low-speed term × pressure term; rolling out lifts the wheel. Rolling resistance = hard term + bulldozing √(z/D). Beached = dug > 0.28 m at low speed. All constants in `src/config/sand.json`, ASSUMPTION (tuned to plausible Wahiba behaviour: 40 psi spins and digs on a moderate loose slope, 15 psi climbs it).
- **W2.4 Grooves** are stamped per physics step as a capsule from the previous to the current contact (±0.62 r along the tyre), profile −d(1−u⁴), sand pushed into side berms (45 % of the volume, ASSUMPTION); slumping limits walls to the 33° angle of repose; slow wind fill erases old tracks.
- **W2.5 Spray** = instanced quads with analytic ballistic motion in the vertex shader (CPU only writes spawn records in a ring buffer) → cost is O(spawns). Budget per preset, emission fades out between 25–160 m from the camera.
- **W2.6 Spawn on slopes**: `VehicleSim.reset` aligns the body to the fitted ground plane (was: flat, dropped from above, which pivoted the car on steep dunes).

## W3 — vehicle

- **W3.1 Presets & sources** (also in `src/config/vehicles.json` → `sources`). Patrol-class: TB48DE 185 kW @ 4800 / 420 Nm @ 3600 (auto-data.net Y61 4.8, 245/251 hp), wheelbase 2970 mm (carexpert). Kerb mass set to **2500 kg** — the prompt says "~2.2 t" but published Y61 4.8 wagons weigh 2410–2640 kg, so the source wins (deviation logged). LC70-class: 1VD-FTV 151 kW @ 3400 / 430 Nm, manual ratios 4.529/2.464/1.490/1.000/0.881, kerb ~2200 kg (Toyota LC79 spec sheet). ASSUMPTION: Patrol 5AT ratios (RE5R05A family) and final drives, LC70 transfer 2.488 / final 4.3 / reverse 4.22.
- **W3.2 Auto by default on both** (the real LC79 is manual-only): easier for keyboard players; `M` switches to manual with clutch/limiter/engine braking.
- **W3.3 Driveline = implicit solve** of engine + driveshaft + wheels per 120 Hz step (A·Δω = b with the torque-converter and tyre Jacobians). The explicit converter was unstable at high ratios (wheelspin ran away to NaN). Converter: K-factor from the full-load curve at the stall rpm, torque ratio 1.9 at stall (ASSUMPTION), lock-up above 1.25× stall in 2nd+.
- **W3.4 Tyre pressure model** (ASSUMPTION): vertical stiffness ∝ psi + carcass term; patch length = area / (0.6 × width); sidewall bulge drawn from the static deflection. 8–40 psi.
- **W3.5 Turbo** = torque limit peak·(NA fraction + (1−NA)·boost), boost follows a first-order lag (ASSUMPTION time constants). Idle governor holds 1.05× idle.
- **W3.6 Thermal derate** (ASSUMPTION): coolant heats ∝ power fraction, cools ∝ airflow; power falls up to 35 % between 105–125 °C. Long full-load climbs in 38 °C air lose ~10 % after 2.5 min.
- **W3.7 Braked static anchor**: below 0.4 m/s a braked wheel is held by a spring-damper to its contact point (capped by μ·load), removing the regularised-tyre creep on slopes.
- **W3.8 TCU shift logic** uses the ground-speed-clamped turbine rpm and a 1.2 s minimum time in gear (wheelspin used to cause 1↔2 hunting).
- **W3.9 Bodies** are original procedural low-poly shapes (extruded side profile with arch cut-outs + boxes), not copies of any real model; no logos. ~2–4 k triangles each, 8 draw calls. LHD cockpit (Oman drives on the right).
- **W3.10 Cameras**: chase (mouse / right-stick orbit, eases back), bonnet and cockpit from the body layout; FOV widens with speed; impact shake toggle (V, or debug panel).

## W4 — audio

- **W4.1 Engine = firing-order pulse synthesis in an AudioWorklet**, not granular samples: the brief forbids copyrighted samples and wants firing-order awareness; pulses through bank formants give the I6/V8 character with ~5 % CPU. The DSP is pure TS so Vitest checks firing rate, bank unevenness, clicks and cost in Node.
- **W4.2 Firing orders** (ASSUMPTION): I6 1-5-3-6-2-4 (the common inline-6 order, Nissan TB48 included); V8 1-8-7-3-6-5-4-2 with odd/even banks (Toyota UR/VD family). Formant frequencies are by ear-free estimate (pipe lengths 1.5–2.5 m) — ASSUMPTION.
- **W4.3 Doppler is done in the synth** (pitch factor from radial velocities), because PannerNode no longer applies Doppler in current browsers. HF damping by a distance-driven low-pass (ASSUMPTION ≈3 kHz at 100 m).
- **W4.4 Reverb**: a generated sparse impulse (7 early reflections, short thin tail, send 0.12). Open desert has almost no reverberation; a long hall IR would sound like a cave.
- **W4.5 Autoplay**: AudioContext is created on the first pointer/key/touch; `?mute` keeps master at 0 (used by automated screenshots).
- **W4.6 CPU measurement** = OfflineAudioContext render of the full graph timed on the main thread (Chrome/Edge have no stable live audio-thread load API).

## W5 — graphics
- **W5.1 Own cascaded shadow maps** instead of three.js shadow maps: all terrain/props use custom ShaderMaterials, so the shadow lookup lives in the shared ATMO_GLSL; one depth atlas, bounding-sphere fit with texel snapping (stable edges), cascades updated every 1/2/4 frames to fit the UHD 630 budget.
- **W5.2 Terrain self-shadow stays baked** (W1 shadowBake); only objects use shadow maps. Casters are limited to ~160 m above a cascade slice.
- **W5.3 One post pass, no TAA**: shimmer + haze + lens dust + contrast + ACES in a single full-screen shader over a half-float target. No temporal accumulation, so no ghosting and nothing to tune for motion.
- **W5.4 Heat shimmer model**: strength = clamp((sun elevation − 8°)/30°), only beyond ~80 m; offset rejected if it would sample a nearer surface (no halo around the car). ASSUMPTION: visual estimate, not physical refraction.
- **W5.5 Haze** = exponential extinction (density 1.1e-4 /m, thicker near the horizon) towards a dust colour derived from the sky horizon, brighter towards the sun. ASSUMPTION: visual estimate of Sharqiya dust.
- **W5.6 Sand wisps** reuse the W1 crest wind-streak shader instead of a particle system (zero extra draw calls).
- **W5.7 High preset** = renderScale 0.85, finest terrain cell 0.625 m, 3 cascades at 2048: 25–31 FPS on the UHD 630 after two attempts; documented as a discrete-GPU preset instead of cutting its features further.

## W6 — gameplay

- **W6.1 Rope model**: one linear spring-damper per rope.
  - Stiffness: EA = MBS / elongation-at-MBS; k = EA / rest length.
  - Damping ζ is based on the effective two-body mass m_eff = mA·mB/(mA+mB). The rope is mass-aware: a heavy pair stretches it more, and stores more energy at the same closing speed.
  - The rope only pulls, never pushes. It breaks above MBS.
  - The force is applied at the hook points, so pulling off-centre yaws the car.
  - The maths lives in the import-free `ropeCore.ts`, shared by the game and the server.
- **W6.2 Rope catalogue** (ASSUMPTION, typical market figures):

  | Rope | Length | MBS | Elongation at MBS | ζ |
  |---|---|---|---|---|
  | Kinetic strap | 9 m | 78 kN | 20 % | 0.12 |
  | Tow rope | 6 m | 60 kN | 8 % | 0.35 |
  | Winch synthetic line | 28 m | 95 kN | 3.5 % | 0.4 |

  - Winch (≈5.4 t class): line speed 0.15 m/s with no load, falling linearly to 0 at a 53 kN stall.
  - Sand anchor: holds 70 kN, then drags at 45 kN.
- **W6.3 "Recoverable only by…" rule**: while `beached`, R (reset) is refused outside `?debug`. The only ways out are the five that have a mechanism in the simulation:
  - Lower the pressure (`[`).
  - Rock the car (throttle and reverse).
  - Dig: G, 4 s, lowers `dug` and removes sand under the belly in the deformation grid.
  - Strap tow from the partner car (T).
  - Winch to an anchor (H, then J/U).
  - Tests prove the car stays stuck without these and gets out with each one.
- **W6.4 Partner car**: an AI LC70 spawned 4 m behind, facing away, in 4L at 18 psi.
  - It drives straight away at a held 2.5 m/s (P-controller on throttle). A snatch therefore comes from slack plus speed.
  - It is a gameplay helper, not a path-finding AI.
- **W6.5 Parts are data**: `parts.json` ops (mul / add / set / setIfNull / mulCurve) applied to a deep-cloned vehicle spec. The presets are never touched.
  - Every number is an ASSUMPTION, sized to the published difference of each kind of part. Examples: balloon tyre width +30 %, turbo +30 % torque above 2000 rpm, crawler low range ×1.4.
  - The test writes the full effect table, and proves the effects with driving tests instead of only checking the numbers.
- **W6.6 Missions**: one JSON file. Gates and spawn points sit on real terrain near the spawn: the west and east dune faces from W2/W3, plus an interdune loop.
  - The convoy mission is timed checkpoints, a simplification: no AI convoy cars.
  - Rewards in credits; a gold time pays ×1.5.
- **W6.7 Multiplayer authority** (also written at the top of `server/server.mjs`):
  - **Server-authoritative**:
    - Room membership (max 8) and player ids.
    - Rope connections: who is tied to whom, which hooks, kind, rest length.
    - Rope tension and breaking, computed at every 20 Hz tick from the latest states, extrapolated by velocity.
    - The clock.
  - **Client-authoritative**: each player's own vehicle physics at 120 Hz (this is the client-side prediction), sent 20×/s.
  - Remote cars are shown 150 ms in the past using Hermite interpolation, with up to 0.5 s of dead-reckoning when packets are lost.
  - Each client applies the rope force to its own car with the shared rope maths and the server's rest length, and obeys the server's `broken` flag.
  - Chosen over a fully server-simulated physics model: the server would need the terrain, the sand grid and two physics simulations per player, and 2–8 players over a hobby link do not justify it.
  - Cost: under lag the two ends feel slightly different forces.
  - Every snapshot carries the full state, so packet loss only delays facts and never loses them.
- **W6.8 Save game**: localStorage key `wahiba.save.v1` holds credits, owned parts, builds per vehicle, livery, best times, finished missions and odometer.
  - Saved every 20 s, on a win, and on page close.
  - `?nosave` disables saving (automated tests).
  - Start credits: 3000.
- **W6.9 Photo mode** freezes the simulation, hides the HUD and keeps the orbit camera. Enter saves a PNG of the canvas, read back after the render so the WebGL buffer is valid.

## U1 — language and new cars (2026-11-18)

- **U1.1 Real model names, no logos.** The user asked for named real cars, so the menu uses their real names as descriptions (Toyota Camry, Land Cruiser, Nissan Patrol). The meshes are original approximations from public dimensions. There are no logos, badges or copied designs.
- **U1.2 No downloaded 3D models.** "Even from outside" was offered by the user. Not taken: free real-car models are almost never CC0 (the project rule), and downloads need approval. Detail comes from the procedural loft generator instead (bodies.json).
- **U1.3 Camry 2020 GCC V6** (sources: autodata1.com XV70 3.5 V6; motormatchup.com 2020 XLE V6; auto123.com 2020 XLE V6):
  - 3.5 2GR-FKS: 301 hp, 362 Nm @ 4700.
  - 8AT ratios 5.519 / 3.184 / 2.05 / 1.492 / 1.235 / 1.0 / 0.801 / 0.673.
  - Mass 1610 kg; wheelbase 2.825 m; 4885 × 1840 × 1445 mm.
  - ASSUMPTION: final drive 2.56 (sources disagree: 2.56 vs 3.46).
  - ASSUMPTION: front weight 61 %, cg 0.54 m.
  - ASSUMPTION: TCS slip 12 %, gain 4.
- **U1.4 Land Cruiser 300 GXR 2026 = 4.0 V6.** The user wrote "GXR4", read as the GCC 4.0 V6 (sources: toyota.iq 24MY LC300 spec sheet; drivearabia.com 2026 prices; one dubicars.com listing disagrees).
  - 1GR-FE: 271 hp (202 kW @ 5200), 385 Nm @ 4400.
  - 6AT ratios 3.333 / 1.96 / 1.353 / 1.0 / 0.728 / 0.588; final 3.909; low 2.618.
  - Mass 2480 kg; wheelbase 2.85 m.
  - Full-time 4WD (modes 4H/4L).
  - ASSUMPTION: no lockers on GXR.
- **U1.5 Patrol VTC** ("فتك") = Y61 Super Safari 4.8 (TB48DE): the existing `patrol` preset, relabelled; its physics are unchanged.
- **U1.6 FWD / modes / TCS are data**: `driveline.fwd`, `driveline.modes`, `driveline.tc` in vehicles.json. The controller refuses unavailable modes (message `ctl.noMode`), and the sim setter clamps them.
- **U1.7 Lock-up clutch fix**:
  - The lock-up state is held for 0.6 s and stays open while TCS cuts.
  - The slipping clutch switches to the implicit locked model when Irel·|Δω|/dt < capacity.
  - Before this, the explicit ±capacity torque flipped sign each step on light FWD wheels (wheel hop, 0–100 in 14 s). The 4x4 presets keep their results; all tests pass.
- **U1.8 Start screen is skipped for automation** (`navigator.webdriver` or `?play`) so smoke and measure scripts are unchanged. The browser default language is Arabic and Node defaults to English, so tests run in English.
- **U1.9 Digits**: Arabic strings use Western digits (0-9). Arabic-Indic digits mixed with Latin model codes (V6, GXR) rendered out of order in RTL.

## U2 — local Patrol VTC model (2026-11-18)

- **U2.1 Local-only exception to "original or CC0".** The user supplied a third-party BeamNG mod and chose "local only". The GLB and the mod never enter git (`public/local/*` ignored, README kept). Only the converter code (ours) is committed. Shots of it go to `tests/tmp`, not `docs/evidence`.
- **U2.2 Emblems/lettering dropped** by part name; the `NISSAN_LOG` material is dropped. The grille badge that is modelled into the grille itself stays (local copy only).
- **U2.3 DTS v26 notes**:
  - Details are 13 ints.
  - Quaternions are Quat16 (x, y, z, w)/32767 in the standard (non-conjugated) convention, checked on the tilted steering-wheel node.
  - Prim flags: 0x40000000 strip, 0x80000000 fan, 0x10000000 no material.
  - Skins use the second UV set.
- **U2.4 Axes**: game = (−bx, bz − oz, by − oy), with the origin at the hub midpoint (fw1l/rw1l). The mirror needs reversed winding (U2 bug).
- **U2.5 Skin bake** = lerp(baseColorMap, R·p1 + G·p2 + B·p3 (normalised), clamp(R+G+B)), BeamNG's palette rule as understood. ASSUMPTION: exact BeamNG blend.
- **U2.6 Decimation**:
  - Paint 0.55, chrome/black 0.4, interior 0.22, gauges 1.0; meshoptimizer error 1 %.
  - The model adds ~256 k triangles. Low stays at 64 FPS on the UHD 630, so there is no LOD yet.
- **U2.7 Procedural wheels kept** under the model: they carry the sim's spin, steer and suspension travel.

## U3 — shareable zip (2026-11-18)

- **U3.1 Zip + PowerShell server**, chosen by the user over a hosted link. A raw `index.html` cannot run from `file://` (ES modules, `fetch` of terrain, AudioWorklet need http). PowerShell `TcpListener` needs no admin rights (an `HttpListener` URL reservation might).
- **U3.2 Bound to 127.0.0.1 only**, with no LAN exposure. The port starts at 8080 and the next free one is taken.
- **U3.3 The shared build never contains `public/local`.** It is deleted after the build, a `.glb` check stops the script, and Vite mode `share` disables the model probe.

## U4 — settings + phones/tablets (2026-11-19)

- Settings are per browser (localStorage), separate from the save game. URL parameters override them for automation.
- FPS limit skips rAF callbacks with a phase-keeping limiter (1 ms tolerance), instead of setTimeout pacing. It stays smooth on 60/120/144 Hz displays.
- Resolution = render scale × min(devicePixelRatio, maxDpr). maxDpr is 1.5 on mobile, which keeps phones from rendering at 3× DPR.
- Mobile defaults are Low + 30 FPS cap. ASSUMPTION: phone GPUs are around or below the UHD 630 floor, and 30 FPS saves battery and heat.
- Touch controls are DOM buttons over the canvas, using pointer events (multi-touch). They feed the same Input class as the keyboard. Auto shows them on a coarse pointer / iPadOS, or after the first touch.
- No new "phone" quality preset yet: we wait for a real-device measurement before adding one.
- `npm run dev` still listens on 127.0.0.1 only. `npm run dev:lan` opens the dev server to the local network for phone testing.

## Autonomous decisions (overnight run, no user available)

1. Tool versions: Three.js 0.170, Vite 8, TypeScript 7, Vitest 5 (installed today's stable versions).
2. Browser tests drive the installed **Edge** through `puppeteer-core` (no browser download). FPS numbers come from a real (non-headless) Edge window on the UHD 630.
3. Spawn point: interdune corridor at x 1650, z −2350 (south of Al Mintarib, near a track).
4. Default time of day 16:24 (golden-hour-ish, Nov sun); change with `?tod=12.3`.
5. Patrol mass 2500 kg instead of the prompt's ~2.2 t (sources say 2410–2640 kg).
6. Both vehicles default to automatic (the real LC79 is manual-only).
7. Audio is judged by tests/spectra only (no one to listen overnight); demo WAVs saved for the morning.
8. High preset left below 30 FPS on this GPU (W5.7) instead of removing its effects; Low/Medium carry the 30+ FPS target.
9. Multiplayer authority split (W6.7): clients own their own physics, the server owns ropes, membership and the clock.
10. Convoy mission done as timed checkpoints instead of AI convoy cars (W6.6).
11. Part prices, rope ratings and part effects are estimates (W6.2, W6.5), marked ASSUMPTION.
12. The R reset is disabled while beached (debug excepted), so recovery is required, as the W6 brief says.
