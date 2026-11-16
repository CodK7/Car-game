"""CLI.  One command for everything:  uv run --directory Tools/GIS python -m wahiba_gis all"""
from __future__ import annotations

import argparse
import json
import sys
import time

import numpy as np
from PIL import Image

from . import detail, osm, ue_export
from .config import load_config
from .dem import Grid, error_vs_source, fetch_tiles, load_source_mosaic, reproject_to_grid


def _write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)


def cmd_fetch_dem(cfg, grid):
    manifest = fetch_tiles(cfg, grid)
    _write_json(cfg["_paths"]["work"] / "dem_manifest.json", manifest)
    print(f"[fetch-dem] {len(manifest)} tile(s), {sum(m['bytes'] for m in manifest) / 1e6:.1f} MB: "
          + ", ".join(m["tile"] for m in manifest))
    return manifest


def cmd_build(cfg, grid):
    out, work = cfg["_paths"]["out"], cfg["_paths"]["work"]
    manifest = json.loads((work / "dem_manifest.json").read_text(encoding="utf-8"))
    res = grid.res
    bounds = grid.lonlat_bounds()
    src, src_t, src_crs = load_source_mosaic([m["path"] for m in manifest], bounds)
    base = reproject_to_grid(src, src_t, src_crs, grid, cfg["dem"]["resampling"])
    reproj_err = error_vs_source(base, grid, src, src_t, src_crs)  # pure import fidelity
    if cfg["dem"]["denoise_sigma_m"] > 0:
        # Radar speckle at the DEM's own sample spacing is not terrain; it would drive as washboard.
        base = detail.gauss(base, cfg["dem"]["denoise_sigma_m"] / res)
    final, masks, dstats = detail.apply_detail(base, res, cfg["detail"], cfg["seed"])
    np.save(work / "height_final_m.npy", final)

    sc = ue_export.ue_scale(float(final.min()), float(final.max()), cfg["z_margin_m"], res, grid.size)
    u16 = ue_export.encode_height(final, sc)
    hm_path = out / f"Wahiba_Height_{grid.size}.png"
    ue_export.save_png16(hm_path, u16)

    # --- verification (pre-editor): read the file back exactly as UE will ---------------
    back = ue_export.load_png16(hm_path)
    decoded = ue_export.decode_height(back, sc)
    ue_z_m = ue_export.ue_world_z_cm(back, sc) / 100.0
    verify = {
        "quantization_max_abs_m": float(np.abs(decoded - final).max()),
        "ue_formula_vs_elevation_max_abs_m": float(np.abs(ue_z_m - decoded).max()),
        "reprojection_vs_source_dem": reproj_err,
        "base_vs_source_dem": error_vs_source(base, grid, src, src_t, src_crs),  # after denoise
        "final_vs_source_dem": error_vs_source(decoded.astype(np.float32), grid, src, src_t, src_crs),
    }

    # --- landscape layer weightmaps + PCG rule maps ---------------------------------------
    compact = masks["interdune"]
    ue_export.save_mask8(out / "Layer_SandCompact.png", compact)
    ue_export.save_mask8(out / "Layer_SandLoose.png", 1.0 - compact)
    ue_export.save_mask8(out / "Mask_Crest.png", masks["crest"])
    ue_export.save_mask8(out / "Mask_SlipFace.png", masks["slipface"])
    ue_export.save_mask8(out / "Mask_Slope_0_45deg.png", masks["slope_deg"] / 45.0)
    ue_export.save_scaled16(out / "Map_HeightAboveLocalMin_0_200m.png", masks["halm_m"], 200.0)
    ue_export.save_scaled16(out / "Map_CrestDistance_0_2000m.png", masks["crest_dist_m"], 2000.0)
    # Wind/dune flow map: megadune crest axis as a doubled-angle vector (RG), coherence (B).
    crest_axis = masks["phi"] + np.pi / 2
    flow = np.dstack([np.cos(2 * crest_axis) * 0.5 + 0.5, np.sin(2 * crest_axis) * 0.5 + 0.5, masks["coherence"]])
    Image.fromarray(np.clip(np.rint(flow * 255), 0, 255).astype(np.uint8)).save(out / "Map_DuneAxisFlow.png")

    rip_h, rip_n = detail.ripple_tile(cfg["ripple_tile"], cfg["seed"])
    amp = cfg["ripple_tile"]["amplitude_m"]
    ue_export.save_png16(out / "T_SandRipple_H.png", np.rint((rip_h / amp * 0.5 + 0.5) * 65535))
    Image.fromarray(np.rint((rip_n * 0.5 + 0.5) * 255).astype(np.uint8)).save(out / "T_SandRipple_N.png")

    ue_export.save_preview(out / "preview_overview.jpg", final, res, step=4)
    c = grid.size // 2
    ue_export.save_preview(out / "preview_center_5km_base.jpg", base[c - 500:c + 500, c - 500:c + 500], res)
    ue_export.save_preview(out / "preview_center_5km_detail.jpg", final[c - 500:c + 500, c - 500:c + 500], res)

    signature = detail.dune_signature(base, res, masks["phi"], masks["coherence"], masks)
    west, south, east, north = bounds
    meta = {
        "heightmap": hm_path.name, "crs": f"EPSG:{grid.epsg}",
        "center_lonlat": [cfg["center_lon"], cfg["center_lat"]],
        "center_en": [grid.center_e, grid.center_n],
        "bounds_lonlat_wsen": [west, south, east, north],
        "resolution_m": res, "landscape": sc,
        "layers": {"SandCompact": "Layer_SandCompact.png", "SandLoose": "Layer_SandLoose.png"},
        "axes": "image col -> UE +X (east), image row -> UE +Y (south); world Z cm = elevation AMSL m * 100",
        "dem_source": cfg["dem"]["source"], "dem_tiles": [m["tile"] for m in manifest],
        "detail": dstats, "dune_signature": signature, "verification": verify,
        "attribution": "DEM: (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018 provided "
                       "under COPERNICUS by the European Union and ESA; all rights reserved.",
    }
    _write_json(out / "landscape_meta.json", meta)

    print(f"[build] grid {grid.size}x{grid.size} @ {res} m = {grid.extent_m / 1000:.2f} km, EPSG:{grid.epsg}, "
          f"elev {sc['data_z_min_m']:.1f}..{sc['data_z_max_m']:.1f} m")
    print(f"[build] UE scale X/Y/Z = {sc['scale_x']:.0f}/{sc['scale_y']:.0f}/{sc['scale_z']:.0f}  "
          f"(range {sc['z_range_m']:.2f} m, step {sc['z_step_m'] * 1000:.2f} mm), "
          f"location cm = {[round(v, 1) for v in sc['location_cm']]}")
    r, b, f = reproj_err, verify["base_vs_source_dem"], verify["final_vs_source_dem"]
    print(f"[verify] quantization max {verify['quantization_max_abs_m'] * 1000:.2f} mm | "
          f"reprojection vs DEM max {r['max_abs_m']:.2f} m rms {r['rms_m']:.3f} m (n={r['n_points']}) | "
          f"denoised vs DEM max {b['max_abs_m']:.2f} m rms {b['rms_m']:.3f} m | "
          f"final vs DEM max {f['max_abs_m']:.2f} m rms {f['rms_m']:.3f} m")
    print(f"[detail] range {dstats['detail_min_m']:.2f}..{dstats['detail_max_m']:.2f} m rms {dstats['detail_rms_m']:.2f} m, "
          f"max slope {dstats['max_slope_deg']:.1f} deg (axis {dstats['max_axis_slope_deg']:.1f}), "
          f"repose iters {dstats.get('repose_iterations', 0)}")
    print(f"[dunes] spacing {signature['megadune_spacing_m']:.0f} m, crest azimuth "
          f"{signature['megadune_crest_azimuth_tensor_deg']:.0f} deg (fft {signature['megadune_crest_azimuth_fft_deg']:.0f}), "
          f"relief p50/p95/max {signature['relief_m_p50']:.0f}/{signature['relief_m_p95']:.0f}/{signature['relief_m_max']:.0f} m, "
          f"interdune {signature['interdune_area_fraction'] * 100:.0f}%")
    return meta


def cmd_osm(cfg, grid):
    out, work = cfg["_paths"]["out"], cfg["_paths"]["work"]
    raw_path = cfg["_paths"]["raw"] / "osm_overpass.json"
    if raw_path.exists():
        raw, endpoint = json.loads(raw_path.read_text(encoding="utf-8")), "cache"
    else:
        raw, endpoint = osm.fetch_overpass(cfg, grid.lonlat_bounds())
        _write_json(raw_path, raw)
    h_path = work / "height_final_m.npy"
    height = np.load(h_path) if h_path.exists() else None
    feats = osm.convert(raw, grid, height, cfg, endpoint)
    _write_json(out / "osm_features.json", feats)
    m = feats["meta"]
    print(f"[osm] {m['counts']} road_km={m['road_length_km']} classes={m['roads_by_class']} via {endpoint}")
    return feats


def main(argv=None):
    ap = argparse.ArgumentParser(prog="wahiba_gis")
    ap.add_argument("command", choices=["fetch-dem", "build", "osm", "all"])
    ap.add_argument("--config", default=None)
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    grid = Grid.from_config(cfg)
    t0 = time.time()
    if args.command in ("fetch-dem", "all"):
        cmd_fetch_dem(cfg, grid)
    if args.command in ("build", "all"):
        cmd_build(cfg, grid)
    if args.command in ("osm", "all"):
        try:
            cmd_osm(cfg, grid)
        except RuntimeError as ex:
            print(f"[osm] FAILED: {ex}", file=sys.stderr)
            return 2
    print(f"[done] {args.command} in {time.time() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
