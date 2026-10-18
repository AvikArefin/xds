# Device models: setup

The library's device models (`iphone-17-pro`, `macbook-pro-14`) are third-party 3D models, so
their `model.glb` files are not in this repository. Each folder keeps its `model.json`; xds lists a
library model only once its `model.glb` is present. Until then `xds model library` shows nothing
and the library tests are skipped. Everything else works without them.

If a task needs a device model and `xds/library/models/<id>/model.glb` is missing, set it up as below.

## 1. Get a source model

Look for a free download whose license allows use and redistribution in renders (CC0 or CC-BY are
ideal), for example on Sketchfab, Poly Pizza or the Blender community:

| id | look for | format |
| --- | --- | --- |
| `iphone-17-pro` | "iPhone 17 Pro" (any recent iPhone Pro works) | `.glb` / `.gltf` |
| `macbook-pro-14` | "MacBook Pro 14 inch" with a separate, openable lid | `.glb` / `.gltf` |

- If you can download it yourself (no login, license clearly stated), do so into a scratch folder,
  never into the repo.
- If the site needs an account or you can't confirm the license, **stop and ask the user** to
  download a model they are allowed to use and give you its path. Tell them which model and why.
- Never pick a model with an unclear, non-commercial or "editorial only" license without the
  user's explicit OK. Write the source URL, author and license down; the user should record them
  in `NOTICE`.

## 2. Normalize it

`scripts/build_library_models.py` turns a raw model into the library conventions (a separate
`Screen` mesh with 0–1 UVs facing +Z, origin at the bottom center, the MacBook `Lid` pivoted on
its hinge with joint limits, compressed textures). It runs inside Blender:

```bash
blender -b --factory-startup -P scripts/build_library_models.py -- iphone-17-pro SRC.glb xds/library/models/iphone-17-pro/model.glb
blender -b --factory-startup -P scripts/build_library_models.py -- macbook-pro-14 SRC.glb xds/library/models/macbook-pro-14/model.glb
```

The script was written for one particular source of each; a different source may name its
meshes differently. Read the script, adapt the mesh selection if needed, and ask the user if
Blender isn't installed.

## 3. Check it

```bash
uv run xds model inspect xds/library/models/<id>/model.glb   # ok, no warnings, a Screen with UVs
uv run pytest tests/test_library.py                           # the library conventions
```

The `Screen` aspect must match the device preset in `xds/screens.py` (`iphone-17-pro`, `macbook`),
and every part named in `model.json` must exist. `model.glb` is git-ignored: never commit it.
