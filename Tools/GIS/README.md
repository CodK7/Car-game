# Wahiba GIS pipeline

Turns open elevation + map data into Unreal-ready landscape inputs for the Wahiba Sands play area.

## Run (one command, from the project root)

```
uv run --directory Tools/GIS python -m wahiba_gis all
```

Needs only [uv](https://docs.astral.sh/uv/) and network access; uv creates the Python 3.11–3.13 env from `pyproject.toml`.
Sub-commands: `fetch-dem`, `build`, `osm`. Tests: `uv run --directory Tools/GIS pytest -q`.

## What it does

1. `fetch-dem` — downloads the Copernicus GLO-30 tiles covering the play area into `Data/GIS/raw/dem/` (idempotent, sha256 in `Data/GIS/work/dem_manifest.json`).
2. `build` — reprojects to UTM, resamples to the landscape grid, adds the procedural dune detail, exports and self-verifies.
3. `osm` — pulls roads/tracks/settlements from Overpass (cached in `Data/GIS/raw/osm_overpass.json`) and converts them to UE-space polylines.

## Outputs (`Data/GIS/out/`)

| File | Use |
|---|---|
| `Wahiba_Height_<N>.png` | 16-bit landscape heightmap |
| `landscape_meta.json` | UE Scale X/Y/Z, actor location, component layout, verification numbers |
| `Layer_SandCompact.png`, `Layer_SandLoose.png` | landscape layer weightmaps (sum to 255) |
| `Mask_Crest.png`, `Mask_SlipFace.png`, `Mask_Slope_0_45deg.png` | 8-bit rule masks |
| `Map_HeightAboveLocalMin_0_200m.png`, `Map_CrestDistance_0_2000m.png` | 16-bit PCG rule maps (value/65535 × max) |
| `Map_DuneAxisFlow.png` | RG = dune crest axis (doubled-angle vector), B = coherence |
| `T_SandRipple_H.png`, `T_SandRipple_N.png` | tileable wind-ripple height + normal (wind along +X) |
| `osm_features.json` | roads, places, buildings, power lines in UE cm |
| `preview_*.jpg` | hillshade previews for eyeballing |

## Conventions

- Vertices sit at pixel centers. Image column → UE **+X (east)**, image row → UE **+Y (south)**.
- The landscape is centered on the world origin; **world Z (cm) = real elevation AMSL (m) × 100**.
- UE height: `worldZ = Location.Z + (h16 − 32768) / 128 × Scale.Z`. One 16-bit step = `Scale.Z / 128` cm.

## Tuning (`config.json`)

- `landscape_size_px` + `resolution_m` set the world size: 4033 @ 5 m = 20.16 km (default); 8129 @ 2.5 m = 20.32 km; 8129 @ 5 m = 40.64 km.
- `detail.detail_amplitude` scales the whole procedural layer (0 = pure DEM).
- `dem.denoise_sigma_m` removes radar speckle at the DEM's sample spacing (0 = off).

## Licenses

- DEM: Copernicus GLO-30 — free for any use including commercial, attribution required (text in `landscape_meta.json`).
- OSM: ODbL 1.0 — credit "© OpenStreetMap contributors" in the game credits.
