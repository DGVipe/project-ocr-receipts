import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import main


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "API_KEY", "test-key")
    return TestClient(main.app)


def png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (400, 600), "white").save(buf, format="PNG")
    return buf.getvalue()


def test_rejects_missing_key(client):
    res = client.post("/scan", files={"file": ("r.png", png_bytes(), "image/png")})
    assert res.status_code == 401


def test_rejects_wrong_key(client):
    res = client.post(
        "/scan",
        files={"file": ("r.png", png_bytes(), "image/png")},
        headers={"X-API-Key": "nope"},
    )
    assert res.status_code == 401


def test_rejects_non_image(client, monkeypatch):
    res = client.post(
        "/scan",
        files={"file": ("r.png", b"not an image", "image/png")},
        headers={"X-API-Key": "test-key"},
    )
    assert res.status_code == 400


def test_rejects_oversized_upload(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 10)
    res = client.post(
        "/scan",
        files={"file": ("r.png", png_bytes(), "image/png")},
        headers={"X-API-Key": "test-key"},
    )
    assert res.status_code == 413


def test_scan_returns_parsed_fields(client, monkeypatch):
    monkeypatch.setattr(
        main, "ocr_passes", lambda _data: iter(["CRUZ VERDE\n01/02/2025\nTOTAL 12.34\n"])
    )
    res = client.post(
        "/scan",
        files={"file": ("r.png", png_bytes(), "image/png")},
        headers={"X-API-Key": "test-key"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["store_name"] == "Cruz Verde"
    assert body["total_amount"] == 12.34
    assert body["purchase_date"] == "2025-01-02"


def test_scan_combines_passes_and_stops_when_confident(client, monkeypatch):
    seen = []

    def passes(_data):
        for text in ["TOTAL $ 64.820\nTAR DEB 54.820", "Fecha: 07/08/2026\nTOTAL $ 54.820", "never read"]:
            seen.append(text)
            yield text

    monkeypatch.setattr(main, "ocr_passes", passes)
    res = client.post(
        "/scan",
        files={"file": ("r.png", png_bytes(), "image/png")},
        headers={"X-API-Key": "test-key"},
    )
    body = res.json()
    assert body["total_amount"] == 54820
    assert body["purchase_date"] == "2026-08-07"
    assert len(seen) == 2
