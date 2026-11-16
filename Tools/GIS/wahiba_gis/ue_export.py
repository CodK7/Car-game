"""UE Landscape encoding: scale math, 16-bit heightmap, weightmaps, previews.

UE stores landscape height as uint16; local Z = (h16 - 32768) / 128 (LANDSCAPE_ZSCALE = 1/128),
world Z = Location.Z + local Z * Scale.Z  [cm]. So one 16-bit step is Scale.Z / 128 cm and the
full range is 65536 steps = 5.12 m * Scale.Z  (Scale.Z = 100 -> 512 m).
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image

# (quads per section, sections per component side, components per side) for recommended sizes.
RECOMMENDED_LAYOUTS = {
    8129: (127, 2, 32), 4033: (63, 2, 32), 2017: (63, 2, 16), 1009: (63, 2, 8), 505: (63, 2, 4),
}


def ue_scale(z_min_data: float, z_max_data: float, margin_m: float, res_m: float, size: int) -> dict:
    raw_range = (z_max_data - z_min_data) + 2.0 * margin_m
    scale_z = math.ceil(raw_range * 100.0 / 512.0)  # integer Z scale: easy to type, exact to encode
    range_m = scale_z * 5.12
    step_m = scale_z / 12800.0
    z0 = (z_max_data + z_min_data) / 2.0 - range_m / 2.0  # elevation encoded as h16 == 0
    half_cm = (size - 1) / 2.0 * res_m * 100.0
    layout = RECOMMENDED_LAYOUTS.get(size)
    return {
        "scale_x": res_m * 100.0, "scale_y": res_m * 100.0, "scale_z": float(scale_z),
        "z_range_m": range_m, "z_step_m": step_m, "z0_m": z0,
        # World Z (cm) == real elevation AMSL (m) * 100; landscape centered on the world origin.
        "location_cm": [-half_cm, -half_cm, z0 * 100.0 + 256.0 * scale_z],
        "data_z_min_m": z_min_data, "data_z_max_m": z_max_data, "margin_m": margin_m,
        "size_px": size, "extent_m": (size - 1) * res_m,
        "quads_per_section": layout[0] if layout else None,
        "sections_per_component": layout[1] if layout else None,
        "components_per_side": layout[2] if layout else None,
    }


def encode_height(h: np.ndarray, sc: dict) -> np.ndarray:
    u = np.rint((h.astype(np.float64) - sc["z0_m"]) / sc["z_step_m"])
    if u.min() < 0 or u.max() > 65535:
        raise ValueError("height outside the encodable range; increase z_margin_m")
    return u.astype(np.uint16)


def decode_height(u: np.ndarray, sc: dict) -> np.ndarray:
    return sc["z0_m"] + u.astype(np.float64) * sc["z_step_m"]


def ue_world_z_cm(u: np.ndarray, sc: dict) -> np.ndarray:
    """Exactly what the engine computes for a vertex."""
    return sc["location_cm"][2] + (u.astype(np.float64) - 32768.0) / 128.0 * sc["scale_z"]


def save_png16(path: Path, u: np.ndarray) -> None:
    Image.fromarray(u.astype(np.uint16)).save(path, compress_level=6)


def load_png16(path: Path) -> np.ndarray:
    Image.MAX_IMAGE_PIXELS = None
    return np.asarray(Image.open(path)).astype(np.uint16)


def save_mask8(path: Path, m: np.ndarray) -> None:
    Image.fromarray(np.clip(np.rint(m * 255.0), 0, 255).astype(np.uint8)).save(path)


def save_scaled16(path: Path, a: np.ndarray, max_value: float) -> None:
    save_png16(path, np.clip(np.rint(a / max_value * 65535.0), 0, 65535))


def hillshade(h: np.ndarray, res: float, sun_az_deg: float = 315.0, sun_alt_deg: float = 30.0) -> np.ndarray:
    gy, gx = np.gradient(h.astype(np.float32), res)
    az, alt = np.radians(sun_az_deg), np.radians(sun_alt_deg)
    # Light vector in image axes (x east, y south, z up).
    lx, ly, lz = np.sin(az) * np.cos(alt), -np.cos(az) * np.cos(alt), np.sin(alt)
    shade = (-gx * lx - gy * ly + lz) / np.sqrt(gx * gx + gy * gy + 1.0)
    return np.clip(shade, 0.0, 1.0)


def save_preview(path: Path, h: np.ndarray, res: float, step: int = 1) -> None:
    hs = hillshade(h[::step, ::step], res * step)
    tint = np.array([226, 168, 104], np.float32)  # preview only; not the game's sand color
    Image.fromarray((hs[..., None] ** 0.8 * tint).astype(np.uint8)).save(path, quality=90)
