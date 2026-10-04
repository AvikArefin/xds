import warnings

import pytest

warnings.filterwarnings("ignore", category=DeprecationWarning)
from fastapi.testclient import TestClient  # noqa: E402

from xds.api import create_app  # noqa: E402


@pytest.fixture
def client(blank):
    with TestClient(create_app(blank, watch=False, serve_studio=False)) as c:
        yield c


def test_get_project(client):
    d = client.get("/api/project").json()
    assert d["ok"] and d["apiVersion"] == 2 and not d["readOnly"]
    assert d["check"] == {"ok": True, "findings": []}
    assert d["guide"]["m"] == 64 and d["project"]["slides"][0]["id"] == "s1"


def test_save_then_conflict(client):
    d = client.get("/api/project").json()
    doc = d["project"]
    doc["name"] = "Changed"
    r = client.put("/api/project", json={"project": doc, "baseHash": d["fileHash"]})
    assert r.status_code == 200 and r.json()["fileHash"] != d["fileHash"]
    r = client.put("/api/project", json={"project": doc, "baseHash": d["fileHash"]})
    assert r.status_code == 409
    assert r.json() == {"ok": False, "error": {"code": "SAVE_CONFLICT", "message": r.json()["error"]["message"],
                                               "details": r.json()["error"]["details"]}}


def test_invalid_save_is_422(client):
    d = client.get("/api/project").json()
    doc = d["project"]
    doc["slides"][0]["nodes"] = [{"id": "x", "layer": "type"}]
    r = client.put("/api/project", json={"project": doc, "baseHash": d["fileHash"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_FAILED"


def test_broken_project_opens_read_only(client, blank):
    (blank / "project.json").write_text('{"schemaVersion": 2, "id": "x"}')
    d = client.get("/api/project").json()
    assert d["ok"] and d["readOnly"] and not d["check"]["ok"]


def test_files_are_contained(client):
    assert client.get("/api/files/project.json").status_code == 200
    assert client.get("/api/files/..%2F..%2Fetc%2Fpasswd").status_code in (400, 404)
    assert client.get("/api/files/assets/missing.png").status_code == 404


def test_formats(client):
    d = client.get("/api/formats", params={"preset": "instagram-story"}).json()
    assert any(f["key"] == "instagram-story" for f in d["catalog"])
    assert d["guide"]["margins"]["bottom"] == 340


def test_projects_listing(client, blank, monkeypatch):
    monkeypatch.setenv("XDS_PROJECTS_DIR", str(blank.parent))
    d = client.get("/api/projects").json()
    assert [p["active"] for p in d["projects"]] == [True]


def test_library_models_by_reference(client, blank):
    models = client.get("/api/library").json()["models"]
    assert {m["id"] for m in models} >= {"iphone-17-pro", "macbook-pro-14"}
    r = client.post("/api/models/library", json={"model": "iphone-17-pro", "slide": "s1"}).json()
    assert r["result"]["asset"] == "xds:models/iphone-17-pro/model.glb"
    # the studio's fileUrl() encodes the colon
    glb = client.get("/api/files/xds%3Amodels/iphone-17-pro/model.glb")
    assert glb.status_code == 200 and glb.content[:4] == b"glTF"
    assert client.get("/api/files/xds%3A..%2Fcli.py").status_code == 400
