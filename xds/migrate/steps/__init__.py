"""Explicit migration steps: one module per schema version, applied in order.

A step is a module named `mNNNN_<what>.py` in this package, where NNNN is the schemaVersion it
produces (`m0002_v1_to_v2.py` upgrades a version-1 file to version 2). It defines one pure
function:

    def upgrade(doc: dict, report: Report) -> dict:
        '''Return the upgraded document. Don't touch the disk; record notes with
        report.notes.append(...) and anything it cannot convert with
        report.unresolve(json_path, message).'''

The runner sets `schemaVersion` after each step, then runs the conform pass
(`migrate/conform.py`), which fills defaults, applies alias renames and drops unknown fields, so a
step only needs the structural changes no default or alias can express.

Steps: `m0002_v1_to_v2.py` (XDS 1 files, `"schemaVersion": "1.0"`). It also reads
`scene-data.json` and `designs/*.svg`, which the runner passes in the document, and may ask the
runner to rewrite design files (`report.files`) and fetch fonts (`report.fonts`).
"""

from __future__ import annotations

import importlib
import pkgutil
import re
from collections.abc import Callable
from typing import Any

Step = Callable[[dict[str, Any], Any], dict[str, Any]]


def registry() -> dict[int, tuple[str, Step]]:
    """target version → (module name, upgrade function), discovered from this package."""
    out: dict[int, tuple[str, Step]] = {}
    for info in pkgutil.iter_modules(__path__):
        m = re.fullmatch(r"m(\d{4})_\w+", info.name)
        if not m:
            continue
        module = importlib.import_module(f"{__name__}.{info.name}")
        version = int(m.group(1))
        if version in out:
            raise RuntimeError(f"two migration steps produce version {version}")
        out[version] = (info.name, module.upgrade)
    return dict(sorted(out.items()))
