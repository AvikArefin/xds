import json
import os

from xds.browser import prune_cache

A, B, C, D = (c * 16 for c in "abcd")  # source hashes: 16 hex characters


def test_prune_keeps_recent_and_current(tmp_path):
    cache = tmp_path / "cache"
    keys = cache / "slide-keys"
    keys.mkdir(parents=True)
    (cache / "grid").mkdir()  # not a hash dir: never pruned
    for i, h in enumerate([A, B, C, D]):  # A oldest … D newest
        (cache / h / "slides").mkdir(parents=True)
        os.utime(cache / h, (1000 + i, 1000 + i))
        (keys / f"k{h[0]}.json").write_text(json.dumps({"hash": h}))

    gone = prune_cache(tmp_path, A, keep=2)

    assert gone == [B, C]
    assert sorted(p.name for p in cache.iterdir()) == [A, D, "grid", "slide-keys"]
    assert sorted(p.stem for p in keys.iterdir()) == ["ka", "kd"]


def test_prune_without_cache(tmp_path):
    assert prune_cache(tmp_path, "x") == []
