import json
import os

from xds.browser import prune_cache


def test_prune_keeps_recent_and_current(tmp_path):
    cache = tmp_path / "cache"
    keys = cache / "slide-keys"
    keys.mkdir(parents=True)
    for i, h in enumerate(["a", "b", "c", "d"]):  # a oldest … d newest
        (cache / h / "slides").mkdir(parents=True)
        os.utime(cache / h, (1000 + i, 1000 + i))
        (keys / f"k{h}.json").write_text(json.dumps({"hash": h}))

    gone = prune_cache(tmp_path, "a", keep=2)

    assert gone == ["b", "c"]
    assert sorted(p.name for p in cache.iterdir()) == ["a", "d", "slide-keys"]
    assert sorted(p.stem for p in keys.iterdir()) == ["ka", "kd"]


def test_prune_without_cache(tmp_path):
    assert prune_cache(tmp_path, "x") == []
