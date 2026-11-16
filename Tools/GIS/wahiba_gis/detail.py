"""Procedural dune detail driven by dune orientation derived from the DEM itself.

All arrays use image axes: axis 1 = +X (east), axis 0 = +Y (south). Angles are measured in that
frame (atan2(y, x)); use `azimuth_deg` to convert a direction to a compass bearing.
"""
from __future__ import annotations

import numpy as np
from scipy import fft as sfft
from scipy import ndimage as ndi


def smoothstep(lo: float, hi: float, x):
    t = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(np.float32)


def gauss(a: np.ndarray, sigma_px: float) -> np.ndarray:
    return ndi.gaussian_filter(a, sigma_px, mode="nearest")


def upsample(a: np.ndarray, shape) -> np.ndarray:
    return ndi.zoom(a, (shape[0] / a.shape[0], shape[1] / a.shape[1]), order=1, mode="nearest")


def azimuth_deg(angle_img):
    """Image-frame direction angle -> compass bearing (deg clockwise from north)."""
    return np.degrees(np.arctan2(np.cos(angle_img), -np.sin(angle_img))) % 360.0


def slope_deg(h: np.ndarray, res: float) -> np.ndarray:
    gy, gx = np.gradient(h, res)
    return np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)


def orientation_field(h: np.ndarray, res: float, presmooth_m: float, integration_m: float, ds: int = 4):
    """Structure-tensor dune orientation.

    Returns (phi, coherence) at full resolution. phi is the across-crest direction (dominant
    gradient axis, defined mod pi); the megadune crest line runs along phi + pi/2.
    """
    hs = gauss(h, presmooth_m / res)[::ds, ::ds]
    gy, gx = np.gradient(hs, res * ds)
    s = integration_m / (res * ds)
    jxx, jxy, jyy = gauss(gx * gx, s), gauss(gx * gy, s), gauss(gy * gy, s)
    c2, s2 = jxx - jyy, 2.0 * jxy
    coherence = np.sqrt(c2 ** 2 + s2 ** 2) / (jxx + jyy + 1e-12)
    # Interpolate the doubled-angle vector (continuous across the mod-pi wrap), not the angle.
    c2u, s2u = upsample(c2, h.shape), upsample(s2, h.shape)
    return (0.5 * np.arctan2(s2u, c2u)).astype(np.float32), upsample(coherence, h.shape).astype(np.float32)


def terrain_masks(h: np.ndarray, res: float, window_m: float) -> dict:
    """Morphological masks used by the detail pass, landscape layers and PCG rules."""
    w = int(round(window_m / res)) * 2 + 1
    lo = ndi.minimum_filter1d(ndi.minimum_filter1d(h, w, axis=0, mode="nearest"), w, axis=1, mode="nearest")
    hi = ndi.maximum_filter1d(ndi.maximum_filter1d(h, w, axis=0, mode="nearest"), w, axis=1, mode="nearest")
    sig = window_m / res / 2.0
    lo, hi = np.minimum(gauss(lo, sig), h), np.maximum(gauss(hi, sig), h)
    relief = hi - lo
    halm = h - lo  # height above local minimum
    tpi = halm / np.maximum(relief, 1e-3)
    slope = slope_deg(h, res)
    duneness = smoothstep(10.0, 35.0, relief)
    crest = smoothstep(0.70, 0.92, tpi) * smoothstep(8.0, 20.0, relief)
    interdune = (1.0 - smoothstep(0.08, 0.25, tpi)) * (1.0 - smoothstep(4.0, 10.0, slope))
    interdune = np.maximum(interdune, (1.0 - duneness) * (1.0 - smoothstep(4.0, 10.0, slope)))
    slipface = smoothstep(24.0, 30.0, slope)
    crest_dist = (ndi.distance_transform_edt(crest < 0.5) * res).astype(np.float32)
    return {"slope_deg": slope, "relief_m": relief.astype(np.float32), "halm_m": halm.astype(np.float32),
            "tpi": tpi.astype(np.float32), "duneness": duneness, "crest": crest.astype(np.float32),
            "interdune": interdune.astype(np.float32), "slipface": slipface, "crest_dist_m": crest_dist}


def relax_to_repose(h: np.ndarray, res: float, repose_deg: float, max_iter: int = 300, tol_m: float = 5e-3) -> int:
    """In-place mass-conserving talus relaxation: no axis-neighbor slope may exceed the angle of
    repose. Returns the number of iterations used."""
    t = float(np.tan(np.radians(repose_deg)) * res)
    s = slice(None)
    # (higher-index view, lower-index view, distance factor): 2 axis + 2 diagonal neighbor pairs.
    pairs = [((slice(1, None), s), (slice(None, -1), s), 1.0),
             ((s, slice(1, None)), (s, slice(None, -1)), 1.0),
             ((slice(1, None), slice(1, None)), (slice(None, -1), slice(None, -1)), np.sqrt(2.0)),
             ((slice(1, None), slice(None, -1)), (slice(None, -1), slice(1, None)), np.sqrt(2.0))]
    for it in range(max_iter):
        worst = 0.0
        for a, b, dist in pairs:
            d = h[a] - h[b]
            ex = (np.clip(np.abs(d) - t * dist, 0.0, None) * np.sign(d) * 0.25).astype(np.float32)
            worst = max(worst, float(np.abs(ex).max()))
            h[a] -= ex
            h[b] += ex
        if worst < tol_m:
            return it + 1
    return max_iter


def _vonmises2(delta, s: float):
    """Orientation (mod pi) window: 1 at delta=0, falls off with angular width ~s/2 rad."""
    return np.exp((np.cos(2.0 * delta) - 1.0) / (s * s))


def oriented_noise(shape, pixel_m: float, wavelength_m, wavevec_angle, n_bins: int,
                   rng: np.random.Generator, ang_width: float = 0.5) -> np.ndarray:
    """Band-limited noise whose wave vector follows `wavevec_angle` (scalar or per-pixel field,
    mod pi). Built as a bank of FFT-filtered orientations blended per pixel; unit variance."""
    p = sfft.next_fast_len(max(shape), real=True)
    spec = sfft.rfft2(rng.standard_normal((p, p), dtype=np.float32), workers=-1)
    fy = sfft.fftfreq(p, d=pixel_m)[:, None].astype(np.float32)
    fx = sfft.rfftfreq(p, d=pixel_m)[None, :].astype(np.float32)
    f = np.hypot(fx, fy)
    lam_lo, lam_hi = wavelength_m
    f0, sig_r = 1.0 / np.sqrt(lam_lo * lam_hi), np.log(lam_hi / lam_lo) / 2.5
    with np.errstate(divide="ignore"):
        radial = np.exp(-0.5 * (np.log(np.maximum(f, 1e-12) / f0) / sig_r) ** 2).astype(np.float32)
    radial[0, 0] = 0.0
    ang = np.arctan2(fy, fx)

    def one(theta):
        n = sfft.irfft2(spec * (radial * _vonmises2(ang - theta, ang_width)).astype(np.float32),
                        s=(p, p), workers=-1)[:shape[0], :shape[1]]
        return (n / n.std()).astype(np.float32)

    if np.isscalar(wavevec_angle):
        return one(float(wavevec_angle))
    out = np.zeros(shape, np.float32)
    norm = np.zeros(shape, np.float32)
    for k in range(n_bins):
        theta = k * np.pi / n_bins
        w = _vonmises2(wavevec_angle - theta, ang_width).astype(np.float32)
        out += w * one(theta)
        norm += w * w
    return out / np.sqrt(norm)


def skew_profile(n: np.ndarray, skew: float, limit: float = 2.0) -> np.ndarray:
    """Sharper crests / flatter troughs (n is unit-variance). Gaussian tails are soft-limited to
    +-`limit` sigma first so the result is bounded to [-(limit+skew), limit*(1+skew*limit)-skew]."""
    n = limit * np.tanh(n / limit)
    return n + skew * (n * n - 1.0)


def apply_detail(base: np.ndarray, res: float, dcfg: dict, seed: int) -> tuple[np.ndarray, dict, dict]:
    """Returns (detailed height, masks of the detailed surface, stats)."""
    amp = float(dcfg["detail_amplitude"])
    rng = np.random.default_rng(seed)
    phi, coherence = orientation_field(base, res, dcfg["orientation_presmooth_m"], dcfg["orientation_integration_m"])
    m = terrain_masks(base, res, dcfg["local_window_m"])
    h = base.copy()
    stats = {"detail_amplitude": amp}
    if amp > 0.0:
        # 1) Crest sharpening: a 30 m DEM rounds crests and under-steepens upper slip faces.
        sharp = base - gauss(base, dcfg["crest_sharpen_sigma_m"] / res)
        h += amp * dcfg["crest_sharpen_amount"] * gauss(m["crest"], 2.0) * sharp
        # 2) Secondary dunes riding the megadune flanks, oriented relative to the local megadune axis.
        sec = oriented_noise(h.shape, res, dcfg["secondary_dune_wavelength_m"],
                             phi + np.radians(dcfg["secondary_dune_angle_offset_deg"]),
                             dcfg["orientation_bins"], rng)
        floor_damp = 1.0 - 0.85 * m["interdune"]
        h += amp * dcfg["secondary_dune_amp_m"] * m["duneness"] * floor_damp * skew_profile(sec, dcfg["secondary_dune_skew"])
        # 3) Mega-ripple undulation at the smallest wavelengths the grid can carry; crests
        #    perpendicular to the megadune axis (wave vector along the crest line).
        lam = [x * res for x in dcfg["megaripple_wavelength_px"]]
        rip = oriented_noise(h.shape, res, lam, phi + np.pi / 2.0, dcfg["orientation_bins"], rng)
        h += amp * dcfg["megaripple_amp_m"] * (0.3 + 0.7 * m["duneness"]) * floor_damp * rip
        # 4) Physical clamp: dry sand cannot stand steeper than its angle of repose.
        stats["repose_iterations"] = relax_to_repose(h, res, dcfg["repose_angle_deg"])
        m = terrain_masks(h, res, dcfg["local_window_m"])
    d = h - base
    stats.update({"detail_min_m": float(d.min()), "detail_max_m": float(d.max()), "detail_rms_m": float(d.std()),
                  "max_slope_deg": float(m["slope_deg"].max()),
                  "max_axis_slope_deg": float(np.degrees(np.arctan(max(
                      np.abs(np.diff(h, axis=0)).max(), np.abs(np.diff(h, axis=1)).max()) / res)))})
    m["phi"], m["coherence"] = phi, coherence
    return h, m, stats


def dune_signature(h: np.ndarray, res: float, phi: np.ndarray, coherence: np.ndarray, masks: dict) -> dict:
    """Numbers used to sanity-check that the bbox really is the Wahiba megadune field."""
    ds = 4
    hp = (h - gauss(h, 3000.0 / res))[::ds, ::ds]
    hp = hp * np.outer(np.hanning(hp.shape[0]), np.hanning(hp.shape[1]))
    power = np.abs(sfft.rfft2(hp)) ** 2
    fy = sfft.fftfreq(hp.shape[0], d=res * ds)[:, None]
    fx = sfft.rfftfreq(hp.shape[1], d=res * ds)[None, :]
    f = np.hypot(fx, fy)
    power[(f < 1 / 6000.0) | (f > 1 / 500.0)] = 0.0
    iy, ix = np.unravel_index(np.argmax(power), power.shape)
    wavevec = np.arctan2(fy[iy, 0], fx[0, ix])
    w = coherence
    crest_axis = 0.5 * np.arctan2((w * np.sin(2 * phi)).mean(), (w * np.cos(2 * phi)).mean()) + np.pi / 2
    dune = masks["duneness"] > 0.5
    return {
        "megadune_spacing_m": float(1.0 / f[iy, ix]),
        "megadune_crest_azimuth_fft_deg": float(azimuth_deg(wavevec + np.pi / 2) % 180.0),
        "megadune_crest_azimuth_tensor_deg": float(azimuth_deg(crest_axis) % 180.0),
        "orientation_coherence_mean": float(coherence.mean()),
        "relief_m_p50": float(np.percentile(masks["relief_m"], 50)),
        "relief_m_p95": float(np.percentile(masks["relief_m"], 95)),
        "relief_m_max": float(masks["relief_m"].max()),
        "dune_area_fraction": float(dune.mean()),
        "interdune_area_fraction": float((masks["interdune"] > 0.5).mean()),
        "slope_deg_p50": float(np.percentile(masks["slope_deg"], 50)),
        "slope_deg_p99": float(np.percentile(masks["slope_deg"], 99)),
    }


def ripple_tile(rcfg: dict, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Tileable wind-ripple height (meters) + tangent-space normal for the sand material.
    Wind blows along +X of the tile; the material rotates it to the wind direction."""
    n_px, size_m = int(rcfg["size_px"]), float(rcfg["tile_size_m"])
    px = size_m / n_px
    rng = np.random.default_rng(seed + 7)
    n = oriented_noise((n_px, n_px), px, rcfg["wavelength_m"], 0.0, 1, rng, ang_width=0.22)
    grain = oriented_noise((n_px, n_px), px, [px * 3, px * 10], 0.0, 1, rng, ang_width=50.0)
    hgt = skew_profile(n, 0.25) + 0.06 * grain
    hgt = (hgt / np.abs(hgt).max() * rcfg["amplitude_m"]).astype(np.float32)
    gy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) / (2 * px)
    gx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) / (2 * px)
    nrm = np.dstack([-gx, -gy, np.ones_like(hgt)])
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    return hgt, nrm.astype(np.float32)
