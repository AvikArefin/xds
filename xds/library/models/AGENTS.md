# Device models

`iphone-17-pro` and `macbook-pro-14` ship with xds: each folder holds the normalized `model.glb`
and its `model.json`. Both are CC BY 4.0 by their authors (sources and credits in `NOTICE`), so
keep the credit when you use or redistribute them.

## Rebuilding or adding one

`scripts/build_library_models.py` turns a raw download into the library conventions (a separate
`Screen` mesh with 0–1 UVs facing +Z, origin at the bottom center, the MacBook `Lid` pivoted on
its hinge with joint limits, WebP textures and Draco geometry). It runs inside Blender:

```bash
blender -b --factory-startup -P scripts/build_library_models.py -- iphone-17-pro SRC.glb xds/library/models/iphone-17-pro/model.glb
blender -b --factory-startup -P scripts/build_library_models.py -- macbook-pro-14 SRC.glb xds/library/models/macbook-pro-14/model.glb
```

The script was written for the sources in `NOTICE`; another source may name its meshes
differently, so read the script and adapt the mesh selection. Use only models whose license
allows redistribution (CC0 or CC BY), and add the source, author and license to `NOTICE`.

Then check:

```bash
uv run xds model inspect xds/library/models/<id>/model.glb   # ok, no warnings, a Screen with UVs
uv run pytest tests/test_library.py                           # the library conventions
```

The `Screen` aspect must match the device preset in `xds/screens.py` (`iphone-17-pro`, `macbook`),
and every part named in `model.json` must exist.
