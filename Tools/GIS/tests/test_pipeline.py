"""Unit tests (fast, synthetic data) + an integration check on real pipeline outputs when present.

Run:  uv run --directory Tools/GIS pytest -q
"""
import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wahiba_gis import detail, ue_export  # noqa: E402
from wahiba_gis.config import PROJECT_ROOT  # noqa: E402
from wahiba_gis.dem import Grid, required_tiles, tile_name, utm_epsg  # noqa: E402

OUT = PROJECT_ROOT / "Data" / "GIS" / "out"


# ---- UE scale / encoding --------------------------------------------------------------------
def test_ue_scale_matches_engine_convention():
    sc = ue_export.ue_scale(0.0, 472.0, 20.0, 5.0, 4033)
    assert sc["scale_z"] == 100.0 and sc["z_range_m"] == pytest.approx(512.0)  # Z=100 <-> 512 m
    assert sc["scale_x"] == 500.0
    assert sc["z_step_m"] == pytest.approx(100.0 / 128.0 / 100.0)
    assert sc["location_cm"][0] == pytest.approx(-(4033 - 1) / 2 * 500.0)
    assert (sc["quads_per_section"] * sc["sections_per_component"] * sc["components_per_side"] + 1) == 4033


def test_encode_decode_roundtrip_and_engine_formula():
    rng = np.random.default_rng(0)
    h = rng.uniform(262.0, 447.0, (64, 64))
    sc = ue_export.ue_scale(h.min(), h.max(), 20.0, 5.0, 4033)
    u = ue_export.encode_height(h, sc)
    assert np.abs(ue_export.decode_height(u, sc) - h).max() <= sc["z_step_m"] / 2 + 1e-9
    # World Z computed the way the engine does must equal real elevation in cm.
    assert np.abs(ue_export.ue_world_z_cm(u, sc) / 100.0 - ue_export.decode_height(u, sc)).max() < 1e-6


def test_encode_rejects_out_of_range():
    sc = ue_export.ue_scale(0.0, 100.0, 5.0, 5.0, 505)
    with pytest.raises(ValueError):
        ue_export.encode_height(np.array([[1000.0]]), sc)


# ---- grid / tiles ---------------------------------------------------------------------------
def test_utm_zone_and_tile_names():
    assert utm_epsg(22.38, 58.78) == 32640
    assert utm_epsg(-33.9, 18.4) == 32734
    assert tile_name(22, 58) == "Copernicus_DSM_COG_10_N22_00_E058_00_DEM"
    assert tile_name(-1, -70) == "Copernicus_DSM_COG_10_S01_00_W070_00_DEM"
    assert required_tiles((58.9, 21.9, 59.1, 22.1)) == [tile_name(a, b) for a in (21, 22) for b in (58, 59)]


def test_grid_axes_x_east_y_south():
    g = Grid(32640, 4033, 5.0, 683000.0, 2476000.0)
    assert g.extent_m == 20160.0
    col, row = g.en_to_colrow(g.center_e, g.center_n)
    assert col == row == 2016.0
    x, y = g.en_to_ue_cm(g.center_e + 100.0, g.center_n + 100.0)  # 100 m east and north
    assert x == 10000.0 and y == -10000.0
    t = g.transform  # pixel centers are vertices
    assert t @ (0.5, 0.5) ==(g.center_e - g.half_extent, g.center_n + g.half_extent)


# ---- detail ---------------------------------------------------------------------------------
def test_relax_to_repose_clamps_slope_and_conserves_mass():
    res = 5.0
    h = np.zeros((80, 80), np.float32)
    h[30:50, 30:50] = 40.0  # vertical cliffs
    total = float(h.sum(dtype=np.float64))
    detail.relax_to_repose(h, res, 33.0, max_iter=3000, tol_m=1e-3)
    assert float(h.sum(dtype=np.float64)) == pytest.approx(total, rel=1e-5)
    limit = np.tan(np.radians(33.0)) * res
    assert np.abs(np.diff(h, axis=0)).max() <= limit + 0.01
    assert np.abs(h[1:, 1:] - h[:-1, :-1]).max() <= limit * np.sqrt(2) + 0.01


def test_oriented_noise_is_oriented_and_unit_variance():
    rng = np.random.default_rng(1)
    n = detail.oriented_noise((256, 256), 5.0, [60.0, 160.0], 0.0, 8, rng)  # wave vector along +X
    assert n.std() == pytest.approx(1.0, abs=1e-3)
    gy, gx = np.gradient(n)
    assert (gx ** 2).mean() > 4.0 * (gy ** 2).mean()  # varies along X, crests run along Y


def test_orientation_field_recovers_known_ridges():
    y, x = np.mgrid[0:400, 0:400].astype(np.float32) * 5.0
    h = 40.0 * np.sin(2 * np.pi * x / 2000.0)  # ridges running north-south
    phi, coh = detail.orientation_field(h, 5.0, 60.0, 400.0)
    assert np.abs(np.sin(phi[100:300, 100:300])).max() < 0.05  # gradient axis is +-X
    assert detail.azimuth_deg(np.median(phi) + np.pi / 2) % 180.0 == pytest.approx(0.0, abs=3.0) or \
        detail.azimuth_deg(np.median(phi) + np.pi / 2) % 180.0 == pytest.approx(180.0, abs=3.0)
    assert coh[100:300, 100:300].mean() > 0.9


def test_detail_amplitude_zero_is_identity():
    rng = np.random.default_rng(2)
    base = detail.gauss(rng.standard_normal((200, 200)).astype(np.float32) * 30.0, 12.0)
    dcfg = json.loads((Path(__file__).resolve().parents[1] / "config.json").read_text())["detail"]
    dcfg["detail_amplitude"] = 0.0
    h, _, stats = detail.apply_detail(base, 5.0, dcfg, 1)
    assert np.array_equal(h, base) and stats["detail_rms_m"] == 0.0


def test_ripple_tile_is_tileable():
    hgt, nrm = detail.ripple_tile({"size_px": 256, "tile_size_m": 2.0, "wavelength_m": [0.08, 0.13],
                                   "amplitude_m": 0.008}, 3)
    assert np.abs(hgt).max() == pytest.approx(0.008, rel=1e-4)
    seam = np.abs(hgt[:, 0] - hgt[:, -1]).mean()
    interior = np.abs(np.diff(hgt, axis=1)).mean()
    assert seam < 3.0 * interior  # wrap-around step looks like any interior step
    assert np.allclose(np.linalg.norm(nrm, axis=2), 1.0, atol=1e-4)


# ---- integration: real outputs (skipped on a checkout that has not run the pipeline) --------
@pytest.mark.skipif(not (OUT / "landscape_meta.json").exists(), reason="pipeline outputs not built")
def test_real_outputs_are_consistent():
    meta = json.loads((OUT / "landscape_meta.json").read_text(encoding="utf-8"))
    sc, v = meta["landscape"], meta["verification"]
    u = ue_export.load_png16(OUT / meta["heightmap"])
    assert u.shape == (sc["size_px"], sc["size_px"]) and u.dtype == np.uint16
    assert v["quantization_max_abs_m"] <= sc["z_step_m"] / 2 + 1e-9
    # Import fidelity (reprojection only) is tight; denoise + detail are intentional, bounded edits.
    assert v["reprojection_vs_source_dem"]["rms_m"] < 0.25 and v["reprojection_vs_source_dem"]["max_abs_m"] < 3.0
    assert v["final_vs_source_dem"]["rms_m"] < 1.5
    assert meta["detail"]["max_axis_slope_deg"] <= 34.0
    z = ue_export.decode_height(u, sc)
    assert sc["data_z_min_m"] - 0.01 <= z.min() and z.max() <= sc["data_z_max_m"] + 0.01
    sig = meta["dune_signature"]  # Wahiba: N-S megadunes, km-scale spacing, ~100 m relief
    assert 1000.0 < sig["megadune_spacing_m"] < 4000.0
    assert min(sig["megadune_crest_azimuth_tensor_deg"], 180 - sig["megadune_crest_azimuth_tensor_deg"]) < 25.0
    from PIL import Image
    a = np.asarray(Image.open(OUT / "Layer_SandCompact.png")).astype(int)
    b = np.asarray(Image.open(OUT / "Layer_SandLoose.png")).astype(int)
    assert np.abs(a + b - 255).max() <= 1
