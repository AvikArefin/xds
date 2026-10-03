import json
from pathlib import Path

import pytest

from xds import project as proj


@pytest.fixture
def blank(tmp_path: Path) -> Path:
    """A freshly scaffolded project."""
    return proj.init(tmp_path / "p", name="Test")


def edit(root: Path, fn) -> dict:
    """Apply `fn` to the raw project.json and write it back (like an agent editing the file)."""
    path = root / "project.json"
    doc = json.loads(path.read_text())
    fn(doc)
    path.write_text(json.dumps(doc, indent=2))
    return doc
