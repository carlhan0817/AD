import json

from PIL import Image

from ad_pipeline.imageio import load_gray, to_gray32
from ad_pipeline.build_index import build_index_from_files


def _make_png(path, color, size=(64, 64)):
    Image.new("RGB", size, color).save(path)


def test_load_gray_keeps_native_resolution(tmp_path):
    p = tmp_path / "x.png"
    _make_png(p, (10, 20, 30), size=(48, 40))
    g = load_gray(p)
    assert len(g) == 40 and len(g[0]) == 48  # H×W,未缩放


def test_to_gray32_routes_through_shared_resize(tmp_path):
    p = tmp_path / "x.png"
    _make_png(p, (10, 20, 30))
    g = to_gray32(p)
    assert len(g) == 32 and len(g[0]) == 32 and all(isinstance(v, int) for v in g[0])


def test_build_index_writes_entries(tmp_path):
    a = tmp_path / "mirana_starfall.png"
    _make_png(a, (200, 50, 50))
    h = tmp_path / "mirana.png"
    _make_png(h, (50, 50, 200))
    entries = [
        {"valveId": 5051, "shortName": "mirana_starfall", "path": str(a)},
        {"valveId": -9, "shortName": "mirana", "path": str(h)},
    ]
    out = tmp_path / "phash_index.json"
    build_index_from_files(entries, out)
    data = json.loads(out.read_text())
    by_id = {e["valveId"]: e for e in data}
    assert set(by_id) == {5051, -9}
    assert len(by_id[5051]["phash"]) == 16
