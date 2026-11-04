"""Image preprocessing and Tesseract invocation.

Phone photos of receipts have shadows, small text and faded thermal print, and
no single preprocessing works best for all of them. ``ocr_passes`` therefore
yields the text of several differently-preprocessed versions of the image, and
the caller stops as soon as it has what it needs.
"""

from __future__ import annotations

import io
import os
import time
from collections.abc import Callable, Iterator

import pytesseract
from PIL import Image, ImageChops, ImageFilter, ImageOps, UnidentifiedImageError

# Refuse decompression bombs (a tiny file that expands to a huge bitmap).
Image.MAX_IMAGE_PIXELS = 40_000_000

TESSERACT_LANG = os.environ.get("TESSERACT_LANG", "eng+spa")
# Total time budget for all passes of one image.
OCR_TIMEOUT_SECONDS = int(os.environ.get("OCR_TIMEOUT_SECONDS", "30"))
# --psm 4: a single column of text of variable sizes, which suits receipts.
TESSERACT_CONFIG = "--oem 1 --psm 4"

# Receipt text OCRs best at roughly 30 px x-height. Phone photos downsized by the
# browser (max 2400 px) are well below that, so scale the long side to this.
TARGET_LONG_SIDE = int(os.environ.get("OCR_TARGET_LONG_SIDE", "3200"))
MAX_UPSCALE = 3.0
# Don't start another pass with less time than this left.
MIN_PASS_SECONDS = 3


class InvalidImageError(ValueError):
    pass


class OcrTimeoutError(RuntimeError):
    pass


def load_image(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise InvalidImageError("Unsupported or corrupt image") from exc
    return img


def normalize(img: Image.Image) -> Image.Image:
    """Upright, grayscale, scaled to a good size for Tesseract."""
    img = ImageOps.exif_transpose(img)  # phone photos are often stored rotated
    img = img.convert("L")
    w, h = img.size
    scale = min(TARGET_LONG_SIDE / max(w, h), MAX_UPSCALE)
    if abs(scale - 1.0) > 0.05:
        img = img.resize((round(w * scale), round(h * scale)), Image.Resampling.LANCZOS)
    return img


def remove_shadows(img: Image.Image) -> Image.Image:
    """Flatten uneven lighting: subtract an estimate of the paper's brightness.

    The background is estimated on a small copy: a max filter erases the dark
    text, a blur smooths it. Paper becomes white everywhere, so shadows across
    the receipt no longer swallow the print.
    """
    small = img.resize((max(img.width // 4, 1), max(img.height // 4, 1)))
    bg = small.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(8))
    bg = bg.resize(img.size, Image.Resampling.BILINEAR)
    return ImageOps.invert(ImageChops.subtract(bg, img))


def otsu_threshold(img: Image.Image) -> Image.Image:
    """Binarize at the threshold that best separates ink from paper."""
    hist = img.histogram()
    total = sum(hist)
    sum_all = sum(i * n for i, n in enumerate(hist))
    w_bg = sum_bg = 0
    best_var, threshold = -1.0, 128
    for t in range(256):
        w_bg += hist[t]
        if not w_bg:
            continue
        w_fg = total - w_bg
        if not w_fg:
            break
        sum_bg += t * hist[t]
        mean_bg, mean_fg = sum_bg / w_bg, (sum_all - sum_bg) / w_fg
        var = w_bg * w_fg * (mean_bg - mean_fg) ** 2
        if var > best_var:
            best_var, threshold = var, t
    return img.point(lambda p: 255 if p > threshold else 0)


def preprocess_variants(img: Image.Image) -> Iterator[Image.Image]:
    """Preprocessed versions of the image, most generally useful first."""
    base = normalize(img)
    flat = ImageOps.autocontrast(remove_shadows(base), cutoff=1)
    # 1. Shadow-free, black and white: best on most thermal receipts.
    yield otsu_threshold(flat)
    # 2. Shadow-free grayscale: keeps faint or dot-matrix strokes binarization breaks.
    yield flat.filter(ImageFilter.SHARPEN)
    # 3. Untouched grayscale: for when shadow removal eats light print.
    yield ImageOps.autocontrast(base, cutoff=1).filter(ImageFilter.SHARPEN)


def _tesseract(img: Image.Image, timeout: float) -> str:
    return pytesseract.image_to_string(
        img, lang=TESSERACT_LANG, config=TESSERACT_CONFIG, timeout=timeout
    )


def ocr_passes(data: bytes, clock: Callable[[], float] = time.monotonic) -> Iterator[str]:
    """Yield the OCR text of each preprocessing variant, within one time budget.

    Raises ``InvalidImageError`` for unreadable input and ``OcrTimeoutError`` if
    not even the first pass finishes in time. Later passes are skipped when the
    budget runs out.
    """
    img = load_image(data)
    deadline = clock() + OCR_TIMEOUT_SECONDS
    for n, variant in enumerate(preprocess_variants(img)):
        remaining = deadline - clock()
        if n > 0 and remaining < MIN_PASS_SECONDS:
            return
        try:
            text = _tesseract(variant, timeout=max(remaining, 1))
        except RuntimeError as exc:
            if "timeout" not in str(exc).lower():
                raise
            if n == 0:
                raise OcrTimeoutError("OCR took too long") from exc
            return
        yield text


def tesseract_version() -> str | None:
    try:
        return str(pytesseract.get_tesseract_version())
    except Exception:  # binary missing
        return None
