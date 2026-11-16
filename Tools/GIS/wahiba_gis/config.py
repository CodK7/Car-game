"""Config loading and project paths."""
from __future__ import annotations

import json
from pathlib import Path

GIS_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[3]


def load_config(path: str | Path | None = None) -> dict:
    cfg_path = Path(path) if path else GIS_DIR / "config.json"
    with open(cfg_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    cfg["_paths"] = {k: PROJECT_ROOT / v for k, v in cfg["paths"].items()}
    for p in cfg["_paths"].values():
        p.mkdir(parents=True, exist_ok=True)
    return cfg
