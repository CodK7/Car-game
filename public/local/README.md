# public/local (git-ignored)

Imported body models that you own a copy of but that are **not** original or CC0. They stay on this machine
only: everything in this folder except this README is ignored by git and must not be committed or published.

| File | Used by | Made with |
|---|---|---|
| `patrol_vtc.glb` | `bodies.json` → `patrol.model` | `Tools/Models/convert.py` from the BeamNG mod "Patrol Y61" by kn0z (config `4800VTC (A).pc`) |

If a file is missing the game silently uses the procedural body.

Rebuild (needs Python via uv and Node):

```bash
uv run --no-project --with numpy --with pillow python Tools/Models/convert.py <mod>/vehicles/kn0z_y61 "<mod>/vehicles/kn0z_y61/4800VTC (A).pc" public/local/patrol_vtc.glb
```
