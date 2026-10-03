import shutil

import pytest

from xds import schema


@pytest.mark.skipif(not shutil.which("npx"), reason="needs node")
def test_generated_types_are_current():
    assert schema.check(), "run `uv run xds schema --emit-types`"
