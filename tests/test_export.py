from PIL import Image

from xds.export import _write_pdf


def test_export_pdf_has_a_page_per_slide(tmp_path):
    pngs = []
    for i, mode in enumerate(["RGB", "RGBA"]):
        p = tmp_path / f"{i}.png"
        Image.new(mode, (1080, 1350), "red").save(p)
        pngs.append(p)
    _write_pdf(pngs, tmp_path / "deck.pdf")
    data = (tmp_path / "deck.pdf").read_bytes()
    assert data.startswith(b"%PDF")
    assert data.count(b"/Type /Page") - data.count(b"/Type /Pages") == 2
    assert b"/MediaBox [ 0 0 1080.0 1350.0 ]" in data
