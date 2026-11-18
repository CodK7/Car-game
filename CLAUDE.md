# Project: Wahiba Sands Off-Road — Web (TypeScript + Vite + Three.js)

> Source of truth for the phase prompts: `PROMPTS_Wahiba_WebGame.md` (never edit its prompts).
> `PROMPTS_Wahiba_Offroad.md` is the old Unreal plan: obsolete, kept for history only.
> Memory between phases: `docs/PROGRESS.md` + `docs/DECISIONS.md` — read both before starting any work.

## Goal
A realistic open-world dune-bashing ("تطعيس") game set in Ramlat Al Wahiba (Sharqiya Sands), Oman, at real-world 1:1 scale
(20.16 km square centred on 22.38N, 58.78E, from the Copernicus GLO-30 DEM). It runs in the browser.

## Platform rules (non-negotiable)
- Web app only: TypeScript + Vite + Three.js on WebGL2. No Unreal, Epic, Unity, Godot, emulators or native installs. No paid services.
- Must run with `npm install && npm run dev` and open in the Claude Code Browser pane, any browser, and from VS Code (`.vscode/`).
- Floor hardware is this machine's integrated GPU (Intel UHD 630): 30+ FPS on the Low preset; presets Low / Medium / High / Auto.
- Legal: original or CC0 assets only. Meshes and audio are procedural. No real car logos/models, no copyrighted audio.
  Credits required: Copernicus DEM attribution and "© OpenStreetMap contributors" (both in `public/terrain/manifest.json`).

## Commands
| What | Command |
|---|---|
| Run the game | `npm run dev` then open http://localhost:5173 (`?debug` shows the tuning panel + FPS) |
| Unit tests (Vitest) | `npm test` |
| Headless smoke test (loads the game in Edge/Chrome, fails on console errors) | `npm run smoke` |
| Type-check + production build | `npm run build` |
| Multiplayer server | `npm run server` (WebSocket, port 8787) |
| Shareable zip for friends (no install; never includes public/local) | `npm run share` → `release/WahibaSands.zip` |
| Re-encode GIS outputs for the web | `uv run --directory Tools/GIS python ../Web/export_web.py` |
| GIS pipeline (do NOT rerun unless a parameter changes, ~5-7 min) | `uv run --directory Tools/GIS python -m wahiba_gis all` |

## Layout
- `src/` — game code. `core/` (params, input, debug panel), `world/` (terrain, sky, props, roads), `sand/` (sink model, deformation, particles),
  `vehicle/` (physics, powertrain, cameras), `audio/`, `gfx/` (post, quality presets), `game/` (recovery, garage, missions, save, net).
- `src/config/*.json` — all tuning data (vehicles, sand, quality, time of day, parts, missions). No magic numbers in code.
- `public/terrain/` — web terrain assets produced by `Tools/Web/export_web.py` from `Data/GIS/out` (committed so the game runs without Python).
- `server/` — Node WebSocket multiplayer server. `tests/` — Vitest unit tests + `smoke.mjs`.
- `Tools/GIS/` — DEM/OSM pipeline (Python, uv). `Data/GIS/out/` — its outputs (consumed as-is). `Tools/Web/` — GIS-to-web converter.
- `docs/` — PROGRESS.md, DECISIONS.md, MORNING_REPORT.md, `evidence/` screenshots.

## Conventions
- World axes: x = east, y = up (real elevation AMSL in metres), z = south. Heightmap texel (col,row) -> x=(col-2016)*5, z=(row-2016)*5.
- Physics is pure TypeScript on a fixed 120 Hz step and must not import DOM/WebGL code (so Vitest can run it in Node).
- Every system is data-driven (JSON in `src/config`), tunable from the `?debug` panel / URL params, and covered by a Vitest test or a measure script.
- Uncertain real-world figures: mark `// ASSUMPTION:` and list them in `docs/DECISIONS.md`. Never claim success without evidence; write "unverified".
- Keep `npm run build` and `npm test` green at the end of every change. Commit after each phase.
- Language: code and comments in English. Talk to the user in Arabic (Gulf-friendly), technical terms in English, short replies.
