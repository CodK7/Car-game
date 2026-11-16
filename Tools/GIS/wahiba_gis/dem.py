"""DEM acquisition (Copernicus GLO-30) and reprojection onto the UE landscape grid."""
from __future__ import annotations

import hashlib
import math
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject
from rasterio.warp import transform as warp_transform
from scipy import ndimage as ndi

USER_AGENT = "wahiba-gis/0.1"


def utm_epsg(lat: float, lon: float) -> int:
    zone = int((lon + 180.0) // 6) + 1
    return (32600 if lat >= 0 else 32700) + zone


def tile_name(lat_floor: int, lon_floor: int) -> str:
    ns = "N" if lat_floor >= 0 else "S"
    ew = "E" if lon_floor >= 0 else "W"
    return f"Copernicus_DSM_COG_10_{ns}{abs(lat_floor):02d}_00_{ew}{abs(lon_floor):03d}_00_DEM"


@dataclass(frozen=True)
class Grid:
    """Square landscape grid. Vertices sit at pixel centers; vertex [0,0] is the NW corner.

    Image/UE axes: column -> +X (east), row -> +Y (south).
    """

    epsg: int
    size: int
    res: float
    center_e: float
    center_n: float

    @classmethod
    def from_config(cls, cfg: dict) -> "Grid":
        lat, lon = cfg["center_lat"], cfg["center_lon"]
        epsg = utm_epsg(lat, lon)
        xs, ys = warp_transform("EPSG:4326", f"EPSG:{epsg}", [lon], [lat])
        res = float(cfg["resolution_m"])
        # Snap the center to the resolution lattice so vertex coordinates are clean numbers.
        return cls(epsg, int(cfg["landscape_size_px"]), res,
                   round(xs[0] / res) * res, round(ys[0] / res) * res)

    @property
    def half_extent(self) -> float:
        return (self.size - 1) / 2.0 * self.res

    @property
    def extent_m(self) -> float:
        return (self.size - 1) * self.res

    @property
    def transform(self) -> Affine:
        west_center = self.center_e - self.half_extent
        north_center = self.center_n + self.half_extent
        return Affine(self.res, 0.0, west_center - self.res / 2.0,
                      0.0, -self.res, north_center + self.res / 2.0)

    def en_to_colrow(self, e, n):
        """UTM easting/northing -> fractional (col, row) in vertex index space."""
        col = (np.asarray(e) - (self.center_e - self.half_extent)) / self.res
        row = ((self.center_n + self.half_extent) - np.asarray(n)) / self.res
        return col, row

    def en_to_ue_cm(self, e, n):
        """UTM -> UE world XY in cm (landscape centered on the world origin; X east, Y south)."""
        return (np.asarray(e) - self.center_e) * 100.0, (self.center_n - np.asarray(n)) * 100.0

    def lonlat_bounds(self, margin_m: float = 0.0):
        h = self.half_extent + margin_m
        t = np.linspace(-h, h, 65)
        e = np.concatenate([self.center_e + t, self.center_e + t,
                            np.full_like(t, self.center_e - h), np.full_like(t, self.center_e + h)])
        n = np.concatenate([np.full_like(t, self.center_n - h), np.full_like(t, self.center_n + h),
                            self.center_n + t, self.center_n + t])
        lon, lat = warp_transform(f"EPSG:{self.epsg}", "EPSG:4326", e.tolist(), n.tolist())
        return min(lon), min(lat), max(lon), max(lat)  # west, south, east, north


def required_tiles(bounds) -> list[str]:
    west, south, east, north = bounds
    return [tile_name(la, lo)
            for la in range(math.floor(south), math.floor(north) + 1)
            for lo in range(math.floor(west), math.floor(east) + 1)]


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_tiles(cfg: dict, grid: Grid) -> list[dict]:
    """Download the GLO-30 tiles covering the grid (idempotent). Returns a manifest."""
    raw = cfg["_paths"]["raw"] / "dem"
    raw.mkdir(parents=True, exist_ok=True)
    manifest = []
    for name in required_tiles(grid.lonlat_bounds(margin_m=500.0)):
        url = f"{cfg['dem']['base_url']}/{name}/{name}.tif"
        dst = raw / f"{name}.tif"
        if not dst.exists():
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            tmp = dst.with_suffix(".part")
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            tmp.replace(dst)
        manifest.append({"tile": name, "url": url, "bytes": dst.stat().st_size,
                         "sha256": _sha256(dst), "path": str(dst)})
    return manifest


def load_source_mosaic(tile_paths: list[str], bounds, pad_deg: float = 0.02):
    """Source DEM (EPSG:4326, EGM2008 heights) cropped to the lon/lat bounds."""
    west, south, east, north = bounds
    srcs = [rasterio.open(p) for p in tile_paths]
    try:
        mosaic, mt = merge(srcs, bounds=(west - pad_deg, south - pad_deg, east + pad_deg, north + pad_deg))
        crs = srcs[0].crs
    finally:
        for s in srcs:
            s.close()
    return mosaic[0].astype(np.float32), mt, crs


def reproject_to_grid(src: np.ndarray, src_transform, src_crs, grid: Grid, resampling: str = "cubic") -> np.ndarray:
    dst = np.zeros((grid.size, grid.size), dtype=np.float32)
    reproject(src, dst, src_transform=src_transform, src_crs=src_crs,
              dst_transform=grid.transform, dst_crs=f"EPSG:{grid.epsg}",
              resampling=getattr(Resampling, resampling))
    return dst


def error_vs_source(height: np.ndarray, grid: Grid, src: np.ndarray, src_transform, src_crs) -> dict:
    """Sample the landscape grid (bilinear, like UE collision) at every source-DEM pixel center
    inside the play area and compare with the source value. Independent of the reprojection path."""
    rows, cols = np.indices(src.shape)
    lon = src_transform.c + (cols + 0.5) * src_transform.a
    lat = src_transform.f + (rows + 0.5) * src_transform.e
    e, n = warp_transform(src_crs, f"EPSG:{grid.epsg}", lon.ravel().tolist(), lat.ravel().tolist())
    c, r = grid.en_to_colrow(np.array(e), np.array(n))
    inside = (c >= 8) & (c <= grid.size - 9) & (r >= 8) & (r <= grid.size - 9)
    sampled = ndi.map_coordinates(height, [r[inside], c[inside]], order=1)
    diff = sampled - src.ravel()[inside]
    return {"n_points": int(inside.sum()), "max_abs_m": float(np.abs(diff).max()),
            "rms_m": float(np.sqrt(np.mean(diff ** 2))), "mean_m": float(diff.mean()),
            "p99_abs_m": float(np.percentile(np.abs(diff), 99))}
