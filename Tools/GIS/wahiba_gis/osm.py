"""OpenStreetMap tracks/roads/settlements via Overpass -> UE-space polylines (JSON)."""
from __future__ import annotations

import json
import urllib.parse
import urllib.request

import numpy as np
from rasterio.warp import transform as warp_transform
from scipy import ndimage as ndi

from .dem import USER_AGENT, Grid


def build_query(bounds, timeout_s: int) -> str:
    west, south, east, north = bounds
    bb = f"{south:.6f},{west:.6f},{north:.6f},{east:.6f}"
    return (f"[out:json][timeout:{timeout_s}];("
            f'way["highway"]({bb});node["place"]({bb});way["building"]({bb});'
            f'way["power"="line"]({bb});node["tourism"]({bb});way["tourism"]({bb});'
            f'node["natural"="tree"]({bb});way["landuse"]({bb});'
            f");out tags geom;")


def fetch_overpass(cfg: dict, bounds) -> tuple[dict, str]:
    query = build_query(bounds, cfg["osm"]["timeout_s"])
    data = urllib.parse.urlencode({"data": query}).encode()
    errors = []
    for url in cfg["osm"]["endpoints"]:
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=cfg["osm"]["timeout_s"] + 30) as r:
                return json.loads(r.read().decode("utf-8")), url
        except Exception as ex:  # try the next mirror
            errors.append(f"{url}: {type(ex).__name__}: {ex}")
    raise RuntimeError("all Overpass endpoints failed:\n" + "\n".join(errors))


def lonlat_to_ue(grid: Grid, lons, lats, height: np.ndarray | None):
    """-> list of [x_cm, y_cm, z_cm, inside]. z is real elevation (cm) sampled from the landscape."""
    e, n = warp_transform("EPSG:4326", f"EPSG:{grid.epsg}", list(lons), list(lats))
    x, y = grid.en_to_ue_cm(np.array(e), np.array(n))
    c, r = grid.en_to_colrow(np.array(e), np.array(n))
    inside = (c >= 0) & (c <= grid.size - 1) & (r >= 0) & (r <= grid.size - 1)
    z = np.zeros_like(x)
    if height is not None:
        z = ndi.map_coordinates(height, [np.clip(r, 0, grid.size - 1), np.clip(c, 0, grid.size - 1)],
                                order=1) * 100.0
    return [[round(float(a), 1), round(float(b), 1), round(float(d), 1), bool(i)]
            for a, b, d, i in zip(x, y, z, inside)]


def convert(raw: dict, grid: Grid, height: np.ndarray | None, cfg: dict, endpoint: str) -> dict:
    roads, places, buildings, power, pois, landuse = [], [], [], [], [], []
    for el in raw.get("elements", []):
        tags = el.get("tags", {})
        if el["type"] == "node":
            pt = lonlat_to_ue(grid, [el["lon"]], [el["lat"]], height)[0]
            item = {"id": el["id"], "name": tags.get("name:en") or tags.get("name"), "point": pt, "tags": tags}
            (places if "place" in tags else pois).append(item)
            continue
        geom = el.get("geometry") or []
        if len(geom) < 2:
            continue
        pts = lonlat_to_ue(grid, [g["lon"] for g in geom], [g["lat"] for g in geom], height)
        if not any(p[3] for p in pts):
            continue
        base = {"id": el["id"], "name": tags.get("name:en") or tags.get("name"), "points": pts}
        if "highway" in tags:
            roads.append({**base, "highway": tags["highway"], "surface": tags.get("surface"),
                          "tracktype": tags.get("tracktype")})
        elif "building" in tags:
            xy = np.array([p[:3] for p in pts]).mean(axis=0)
            buildings.append({"id": el["id"], "building": tags["building"],
                              "center": [round(float(v), 1) for v in xy]})
        elif tags.get("power") == "line":
            power.append(base)
        elif "landuse" in tags:
            landuse.append({**base, "landuse": tags["landuse"]})
        else:
            pois.append({**base, "tags": tags})
    by_class: dict[str, int] = {}
    length_km = 0.0
    for r in roads:
        by_class[r["highway"]] = by_class.get(r["highway"], 0) + 1
        p = np.array([q[:2] for q in r["points"]])
        length_km += float(np.hypot(*np.diff(p, axis=0).T).sum()) / 1e5
    return {
        "meta": {
            "source": "OpenStreetMap via Overpass API", "endpoint": endpoint,
            "license": "ODbL 1.0 - (c) OpenStreetMap contributors",
            "crs": f"EPSG:{grid.epsg}", "center_en": [grid.center_e, grid.center_n],
            "units": "UE cm; X east, Y south, Z = elevation AMSL; 4th value = inside landscape",
            "road_corridor_half_width_m": cfg["osm"]["road_corridor_half_width_m"],
            "counts": {"roads": len(roads), "places": len(places), "buildings": len(buildings),
                       "power_lines": len(power), "pois": len(pois), "landuse": len(landuse)},
            "roads_by_class": by_class, "road_length_km": round(length_km, 2),
        },
        "roads": roads, "places": places, "buildings": buildings,
        "power_lines": power, "pois": pois, "landuse": landuse,
    }
