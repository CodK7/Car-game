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

## Autonomous decisions (overnight run, no user available)

1. Tool versions: Three.js 0.170, Vite 8, TypeScript 7, Vitest 5 (installed today's stable versions).
2. Browser tests drive the installed **Edge** through `puppeteer-core` (no browser download). FPS numbers come from a real (non-headless) Edge window on the UHD 630.
3. Spawn point: interdune corridor at x 1650, z −2350 (south of Al Mintarib, near a track).
4. Default time of day 16:24 (golden-hour-ish, Nov sun); change with `?tod=12.3`.
