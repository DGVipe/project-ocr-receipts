"""OCR microservice: receives a receipt image, returns the extracted fields.

Only the Next.js backend should call this; requests must carry the shared
``X-API-Key`` header.
"""

from __future__ import annotations

import asyncio
import hmac
import os

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from .ocr import InvalidImageError, OcrTimeoutError, ocr_passes, tesseract_version
from .parser import ReceiptData, analyze, combine, is_confident

API_KEY = os.environ.get("OCR_API_KEY", "")
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(5 * 1024 * 1024)))
# Tesseract is CPU-bound; cap parallel jobs so a burst can't exhaust the box.
MAX_CONCURRENT_OCR = int(os.environ.get("MAX_CONCURRENT_OCR", "2"))
QUEUE_WAIT_SECONDS = 20

app = FastAPI(title="Receipt OCR", docs_url=None, redoc_url=None, openapi_url=None)
_ocr_slots = asyncio.Semaphore(MAX_CONCURRENT_OCR)


def extract(data: bytes) -> tuple[ReceiptData, list[str]]:
    """Run OCR passes until the total and date are confidently found, then vote."""
    evidence, texts = [], []
    for text in ocr_passes(data):
        texts.append(text)
        evidence.append(analyze(text))
        if is_confident(evidence):
            break
    return combine(evidence), texts


@app.get("/health")
def health() -> dict:
    return {"ok": True, "tesseract": tesseract_version()}


@app.post("/scan")
async def scan(
    file: UploadFile = File(...),
    x_api_key: str | None = Header(default=None),
) -> dict:
    if not API_KEY:
        raise HTTPException(500, "OCR_API_KEY is not configured")
    if not hmac.compare_digest((x_api_key or "").encode(), API_KEY.encode()):
        raise HTTPException(401, "Unauthorized")

    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image is too large")
    if not data:
        raise HTTPException(400, "Empty file")

    try:
        await asyncio.wait_for(_ocr_slots.acquire(), timeout=QUEUE_WAIT_SECONDS)
    except TimeoutError:
        raise HTTPException(503, "OCR service is busy, try again shortly") from None
    try:
        receipt, texts = await run_in_threadpool(extract, data)
    except InvalidImageError:
        raise HTTPException(400, "The file is not a readable image") from None
    except OcrTimeoutError:
        raise HTTPException(504, "OCR took too long") from None
    finally:
        _ocr_slots.release()

    result = receipt.to_dict()
    result["raw_text"] = "\n\n".join(texts)
    return result
