# PROGRESS — Web version (Three.js)

Read with `DECISIONS.md`. Plan: `PROMPTS_Wahiba_WebGame.md` (Section A → B → W1…W6). Machine: i5-10400, Intel UHD 630 (integrated), 16 GB.

## Status

| Phase | Status | Evidence |
|---|---|---|
| A — cleanup | DONE | 970.6 MB freed; "maybe" list below |
| B — reuse GIS | DONE | `Tools/Web/export_web.py` → `public/terrain/*`; `CLAUDE.md` rewritten for web |
| W1 — world | DONE | tests green, screenshots `docs/evidence/w1_*.png`, FPS below |
| W2 — sand | not started | |
| W3 — vehicle | not started | |
| W4 — audio | not started | |
| W5 — graphics | not started | |
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
