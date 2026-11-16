"""Convert Data/GIS/out (GIS pipeline outputs) into web-friendly assets for the Three.js game.

Run from the project root:
    uv run --directory Tools/GIS python ../Web/export_web.py

Does NOT regenerate the GIS data; it only re-encodes it:
    public/terrain/height_u16.bin   raw little-endian uint16, row-major, same values as the 16-bit PNG
    public/terrain/masks.png        RGB, half resolution: R = loose-sand weight, G = crest, B = slip face
    public/terrain/ripple.png       RGB tile: RG = ripple normal xy, B = ripple height
    public/terrain/osm.json         roads/places/buildings/power lines/POIs in local metres (x east, z south)
    public/terrain/manifest.json    sizes, height decoding, attribution
    tests/fixtures/height_samples.json  reference heights for the in-game sampler test
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "Data" / "GIS" / "out"
DST = ROOT / "public" / "terrain"
FIX = ROOT / "tests" / "fixtures"


def load_gray(name: str) -> np.ndarray:
    return np.asarray(Image.open(SRC / name))


def half(a: np.ndarray, size: int) -> Image.Image:
    return Image.fromarray(a).resize((size, size), Image.Resampling.BOX)


def main() -> int:
    DST.mkdir(parents=True, exist_ok=True)
    FIX.mkdir(parents=True, exist_ok=True)
    meta = json.loads((SRC / "landscape_meta.json").read_text(encoding="utf-8"))
    ls = meta["landscape"]
    n = int(ls["size_px"])
    res = float(meta["resolution_m"])
    z0 = float(ls["z0_m"])
    zstep = float(ls["z_step_m"])

    # --- heights -----------------------------------------------------------
    h16 = load_gray(meta["heightmap"])
    assert h16.shape == (n, n), h16.shape
    h16 = h16.astype("<u2")
    (DST / "height_u16.bin").write_bytes(h16.tobytes())
    hm = z0 + h16.astype(np.float64) * zstep

    # --- masks (half resolution) --------------------------------------------
    mh = (n + 1) // 2
    loose = load_gray("Layer_SandLoose.png")
    crest = load_gray("Mask_Crest.png")
    slip = load_gray("Mask_SlipFace.png")
    rgb = Image.merge("RGB", [half(loose, mh), half(crest, mh), half(slip, mh)])
    rgb.save(DST / "masks.png", optimize=True)

    # --- ripple tile ---------------------------------------------------------
    rn = Image.open(SRC / "T_SandRipple_N.png").convert("RGB")
    rh = Image.open(SRC / "T_SandRipple_H.png")
    rh8 = np.asarray(rh)
    if rh8.dtype != np.uint8:
        rh8 = (rh8.astype(np.float64) / 257.0).round().astype(np.uint8)
    r, g, _ = rn.split()
    Image.merge("RGB", [r, g, Image.fromarray(rh8).convert("L")]).save(DST / "ripple.png", optimize=True)

    # --- OSM -----------------------------------------------------------------
    osm = json.loads((SRC / "osm_features.json").read_text(encoding="utf-8"))
    half_ext = (n - 1) * res / 2.0

    def inside(x: float, z: float) -> bool:
        return abs(x) <= half_ext and abs(z) <= half_ext

    def xz(p):
        return round(p[0] / 100.0, 1), round(p[1] / 100.0, 1)

    roads = []
    for rd in osm["roads"]:
        run: list[float] = []
        for p in rd["points"]:
            x, z = xz(p)
            if inside(x, z):
                run += [x, z]
            else:
                if len(run) >= 4:
                    roads.append({"c": rd.get("highway"), "s": rd.get("surface"), "p": run})
                run = []
        if len(run) >= 4:
            roads.append({"c": rd.get("highway"), "s": rd.get("surface"), "p": run})

    def pts_of(e):
        for key in ("points", "polygon", "outline", "ring"):
            if key in e:
                return e[key]
        return None

    buildings = []
    for b in osm.get("buildings", []):
        c = b.get("center")
        if not c:
            continue
        x, z = xz(c)
        if inside(x, z):
            # OSM export keeps only the centroid; footprint size is assigned in-game (ASSUMPTION).
            buildings.append([x, z])

    def point_of(e):
        for key in ("point", "pos", "location", "xyz"):
            if key in e:
                return e[key]
        pts = pts_of(e)
        if pts:
            a = np.array([[p[0], p[1]] for p in pts]).mean(axis=0)
            return [float(a[0]), float(a[1])]
        if "x" in e and "y" in e:
            return [e["x"], e["y"]]
        return None

    places = []
    for p in osm.get("places", []):
        q = point_of(p)
        if q is None:
            continue
        x, z = xz(q)
        t = p.get("tags") or {}
        places.append({"n": t.get("name:en") or p.get("name"), "ar": t.get("name:ar") or t.get("name"),
                       "k": t.get("place"), "x": x, "z": z,
                       "in": inside(x, z)})
    pois = []
    for p in osm.get("pois", []):
        q = point_of(p)
        if q is None:
            continue
        x, z = xz(q)
        if inside(x, z):
            t = p.get("tags") or {}
            pois.append({"n": t.get("name:en") or p.get("name"),
                         "k": t.get("tourism") or t.get("amenity") or t.get("shop") or "poi", "x": x, "z": z})
    power = []
    for pl in osm.get("power_lines", []):
        run = []
        for p in pts_of(pl) or []:
            x, z = xz(p)
            if inside(x, z):
                run += [x, z]
        if len(run) >= 4:
            power.append(run)

    (DST / "osm.json").write_text(json.dumps({
        "license": osm["meta"]["license"], "roads": roads, "buildings": buildings, "places": places,
        "pois": pois, "power": power}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # --- manifest --------------------------------------------------------------
    manifest = {
        "size": n, "resolution_m": res, "extent_m": (n - 1) * res,
        "z0_m": z0, "z_step_m": zstep,
        "height_min_m": float(hm.min()), "height_max_m": float(hm.max()),
        "height": "height_u16.bin", "masks": "masks.png", "masks_size": mh, "ripple": "ripple.png",
        "ripple_tile_m": 2.0, "osm": "osm.json",
        "center_lonlat": meta["center_lonlat"], "crs": meta["crs"],
        "axes": "x = east, y = up (elevation AMSL, m), z = south; texel (col,row) centre -> x=(col-(n-1)/2)*res, z=(row-(n-1)/2)*res",
        "attribution": [meta["attribution"], osm["meta"]["license"]],
        "counts": {"roads": len(roads), "buildings": len(buildings), "places": len(places), "pois": len(pois),
                   "power": len(power)},
    }
    (DST / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")

    # --- reference samples for the sampler test ----------------------------------
    rng = np.random.default_rng(1407)
    npy = ROOT / "Data" / "GIS" / "work" / "height_final_m.npy"
    ref = np.load(npy).astype(np.float64) if npy.exists() else hm
    cols = rng.uniform(2, n - 3, 1500)
    rows = rng.uniform(2, n - 3, 1500)
    c0 = np.floor(cols).astype(int)
    r0 = np.floor(rows).astype(int)
    fc = cols - c0
    fr = rows - r0
    bil = (ref[r0, c0] * (1 - fc) * (1 - fr) + ref[r0, c0 + 1] * fc * (1 - fr)
           + ref[r0 + 1, c0] * (1 - fc) * fr + ref[r0 + 1, c0 + 1] * fc * fr)
    ic = rng.integers(0, n, 500)
    ir = rng.integers(0, n, 500)
    c = (n - 1) / 2.0
    fixture = {
        "source": "height_final_m.npy (float metres)" if npy.exists() else "decoded 16-bit PNG",
        "bilinear": [[round(float((a - c) * res), 4), round(float((b - c) * res), 4), round(float(h), 4)]
                     for a, b, h in zip(cols, rows, bil)],
        "exact": [[float((a - c) * res), float((b - c) * res), round(float(ref[b, a]), 5)] for a, b in zip(ic, ir)],
    }
    (FIX / "height_samples.json").write_text(json.dumps(fixture, separators=(",", ":")), encoding="utf-8")

    for f in sorted(DST.iterdir()):
        print(f"{f.name}: {f.stat().st_size / 1e6:.2f} MB")
    print("counts:", manifest["counts"], "height range:", round(manifest["height_min_m"], 2), round(manifest["height_max_m"], 2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
