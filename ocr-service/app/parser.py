"""Line-based heuristics that pull the store, purchase date and total out of receipt OCR text.

Each OCR pass is turned into *evidence*: candidate values with a score.

- Total: a line containing "total" proposes the amount on that line. "Total
  Boleta" / "Total a pagar" outrank a plain "TOTAL"; "Sub-Total", "Total Neto",
  "Total IVA", "Total Dcto"... are ignored. A card payment line repeating the
  amount, or an IVA line consistent with it, adds support.
- Date: a line containing "Fecha"/"Date" proposes the date on that line; other
  dates are weak candidates. SII stamp lines ("Resolución 80 del ...") are ignored.
- Store: only names from ``stores.STORES`` are reported.
- Currency: "CLP" for Spanish receipts, "USD" for English ones, unless a code
  ("US$", "CLP") is printed. The language also decides day- vs month-first dates.

Evidence from several OCR passes of the same image is summed, so a digit misread
in one pass is outvoted by the others. Every field is ``None`` when nothing
plausible is found.
"""

from __future__ import annotations

import os
import re
import unicodedata
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from datetime import date
from difflib import SequenceMatcher

from .stores import STORES

# "AUTO" (default): day-first when the receipt looks Spanish, else month-first.
# "MDY" or "DMY" force an order. Only matters for ambiguous dates like 03/04/2025.
DATE_ORDER = os.environ.get("DATE_ORDER", "AUTO").upper()

# Chilean IVA. A total T is consistent with an IVA line V when V ≈ T * 19 / 119.
IVA_RATE = 0.19


@dataclass
class ReceiptData:
    store_name: str | None
    total_amount: float | None
    currency: str | None
    purchase_date: str | None  # ISO YYYY-MM-DD

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Evidence:
    """Scored candidates found in one OCR pass."""

    totals: dict[float, float] = field(default_factory=dict)
    dates: dict[str, float] = field(default_factory=dict)
    store: str | None = None
    # Last-resort total guess (largest money-like amount), used only if no pass
    # found anything better.
    fallback_total: float | None = None
    language: str | None = None  # "es" or "en"
    # Currency code printed on the receipt ("CLP", "US$"), which beats the language.
    explicit_currency: str | None = None


# Scores
STRONG_TOTAL = 3.0  # "Total Boleta", "Total a pagar", "Grand total"
PLAIN_TOTAL = 2.0  # "TOTAL"
SUPPORT = 1.0  # card payment line with the same amount, or matching IVA
KEYWORD_DATE = 3.0  # date on a "Fecha"/"Date" line
OTHER_DATE = 1.0  # any other date

# Stop running more OCR passes once both fields reach these scores.
CONFIDENT_TOTAL = 3.0
CONFIDENT_DATE = 3.0


def parse_receipt(text: str) -> ReceiptData:
    return combine([analyze(text)])


def analyze(text: str) -> Evidence:
    lines = [ln.strip() for ln in text.splitlines()]
    lines = [_fix_digits(ln) for ln in lines if ln]
    ev = Evidence(
        store=match_store(lines),
        language=detect_language(text),
        explicit_currency=explicit_currency(text),
    )
    _score_totals(lines, ev)
    _score_dates(lines, _date_order(ev.language), ev)
    return ev


def combine(evidence: Iterable[Evidence]) -> ReceiptData:
    evidence = list(evidence)
    totals = _sum_scores(ev.totals for ev in evidence)
    dates = _sum_scores(ev.dates for ev in evidence)
    stores = _sum_scores({ev.store: 1.0} for ev in evidence if ev.store)

    total = _best(totals)
    if total is None:
        fallbacks = [ev.fallback_total for ev in evidence if ev.fallback_total is not None]
        total = max(fallbacks) if fallbacks else None

    explicit = _best(_sum_scores({ev.explicit_currency: 1.0} for ev in evidence if ev.explicit_currency))
    language = _best(_sum_scores({ev.language: 1.0} for ev in evidence if ev.language))
    return ReceiptData(
        store_name=_best(stores),
        total_amount=total,
        currency=explicit or LANGUAGE_CURRENCY.get(language),
        purchase_date=_best(dates),
    )


def is_confident(evidence: Iterable[Evidence]) -> bool:
    """True once more OCR passes are unlikely to change the total or date."""
    evidence = list(evidence)
    totals = _sum_scores(ev.totals for ev in evidence)
    dates = _sum_scores(ev.dates for ev in evidence)
    return (
        max(totals.values(), default=0) >= CONFIDENT_TOTAL
        and max(dates.values(), default=0) >= CONFIDENT_DATE
    )


def _sum_scores(maps: Iterable[dict]) -> dict:
    out: dict = {}
    for m in maps:
        for key, score in m.items():
            out[key] = out.get(key, 0.0) + score
    return out


def _best(scores: dict):
    # Dicts keep insertion order, so ties go to the candidate seen first.
    return max(scores, key=lambda k: scores[k]) if scores else None


def _fold(s: str) -> str:
    """Lowercase and strip accents so 'Emisión' matches 'emision'."""
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def _fix_digits(line: str) -> str:
    """Undo common OCR letter-for-digit swaps inside numbers ('4.47O' -> '4.470')."""
    line = re.sub(r"(?<=\d)[Oo](?=[\d.,/-]|\b)|(?<=\d[.,/-])[Oo]", "0", line)
    return re.sub(r"(?<=\d)[lI|](?=\d)", "1", line)


# --------------------------------------------------------------------------
# Store
# --------------------------------------------------------------------------

FUZZY_STORE_RATIO = 0.85
FUZZY_MIN_LEN = 8  # shorter aliases must match exactly


def _norm_words(s: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", _fold(s)))


_STORE_ALIASES = [(name, _norm_words(alias)) for name, aliases in STORES for alias in aliases]


def _alias_in(alias: str, line: str) -> bool:
    if f" {alias} " in f" {line} ":
        return True
    if len(alias) < FUZZY_MIN_LEN:
        return False
    words, n = line.split(), len(alias.split())
    for size in {n, n + 1, max(n - 1, 1)}:  # OCR may split or merge a word
        for i in range(len(words) - size + 1):
            window = " ".join(words[i : i + size])
            if SequenceMatcher(None, alias, window).ratio() >= FUZZY_STORE_RATIO:
                return True
    return False


def match_store(lines: list[str]) -> str | None:
    """The known store mentioned highest on the receipt, if any."""
    for line in lines:
        norm = _norm_words(line)
        if not norm:
            continue
        for name, alias in _STORE_ALIASES:
            if _alias_in(alias, norm):
                return name
    return None


# --------------------------------------------------------------------------
# Amounts
# --------------------------------------------------------------------------

_NUM = r"\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?"
# Thousands-grouped (1,234 / 1.234,56) or plain (1234 / 12.34 / 12,34) numbers,
# not glued to more digits and not a percentage.
AMOUNT_RE = re.compile(
    r"(?<![\d.,])(?P<cur>[$€£¥])?\s*(?P<num>" + _NUM + r")(?![\d]|[.,]\d|\s*%)"
)
# A line holding nothing but an amount (OCR often puts a column on its own line).
AMOUNT_ONLY_RE = re.compile(r"^[\W_]*[$€£¥]?\s*(?:" + _NUM + r")[\W_]*$")


@dataclass
class Amount:
    value: float
    has_decimals: bool
    symbol: str | None


def parse_number(num: str) -> tuple[float, bool]:
    """Turn '1.234,56', '1,234.56', '12,50' or '12.990' into a float.

    Returns (value, had_decimal_part).
    """
    m = re.search(r"[.,](\d{2})$", num)
    if m:
        integer = re.sub(r"[.,]", "", num[: m.start()])
        return float(f"{integer or 0}.{m.group(1)}"), True
    return float(re.sub(r"[.,]", "", num)), False


def find_amounts(line: str) -> list[Amount]:
    out = []
    for m in AMOUNT_RE.finditer(line):
        value, has_dec = parse_number(m.group("num"))
        out.append(Amount(value, has_dec, m.group("cur")))
    return out


def _money_like(a: Amount) -> bool:
    return a.has_decimals or a.symbol is not None


def _amount_on_line(lines: list[str], i: int, start: int = 0) -> float | None:
    """Right-most amount on ``lines[i]`` after ``start``; failing that, the next
    line if it holds nothing but an amount."""
    amounts = [a for a in find_amounts(lines[i][start:]) if a.value > 0]
    if amounts:
        return amounts[-1].value
    if i + 1 < len(lines) and AMOUNT_ONLY_RE.match(lines[i + 1]):
        amounts = [a for a in find_amounts(lines[i + 1]) if a.value > 0]
        if amounts:
            return amounts[-1].value
    return None


# --------------------------------------------------------------------------
# Language and currency
# --------------------------------------------------------------------------

# Receipts are either Chilean (Spanish, pesos) or US (English, dollars).
LANGUAGE_CURRENCY = {"es": "CLP", "en": "USD"}

# Words typical of each language's receipts. Words shared by both ("total",
# "visa") are left out. Matched on accent-folded, lowercased text.
SPANISH_WORDS = frozenset("""
    fecha hora boleta electronica emision rut giro sucursal caja cajero cajera vendedor
    iva neto exento afecto vuelto efectivo pagar tarjeta debito credito compra venta
    precio cantidad codigo descripcion articulo articulos unidad valor descuento dcto
    ahorro cliente gracias documento timbre resolucion verifique comuna supermercado
    farmacia farmacias abarrotes de del la las los el por para con su
""".split())
ENGLISH_WORDS = frozenset("""
    date time receipt subtotal tax cash change due balance amount thank thanks you
    your store cashier customer item items qty quantity price each sale purchase
    payment card debit credit approved auth member savings register order paid
    tendered tip the and for with of at to is
""".split())
# Explicit currency markers. "US$"/"USD" or "CLP"/"pesos" printed on a receipt
# beat the language guess.
USD_RE = re.compile(r"\b(?:usd|us\s?\$|u\.s\.\s?dollars?|dollars?)", re.I)
CLP_RE = re.compile(r"\b(?:clp|pesos?\s+chilenos?|\$\s?clp)\b", re.I)


def detect_language(text: str) -> str | None:
    """'es' or 'en' depending on which language's receipt words dominate."""
    words = re.findall(r"[a-z]+", _fold(text))
    es = sum(w in SPANISH_WORDS for w in words)
    en = sum(w in ENGLISH_WORDS for w in words)
    if es == en:
        return None
    return "es" if es > en else "en"


def explicit_currency(text: str) -> str | None:
    usd, clp = bool(USD_RE.search(text)), bool(CLP_RE.search(text))
    if usd == clp:  # neither, or contradictory
        return None
    return "USD" if usd else "CLP"


# --------------------------------------------------------------------------
# Total
# --------------------------------------------------------------------------

# "total" plus common OCR confusions (T0TAL, TOTA1, 7OTAL, a dropped first
# letter), optionally preceded by "sub"/"sub-"/"sub " so subtotals are caught.
TOTAL_KW_RE = re.compile(
    r"(?:(?P<sub>sub)\s*[-.]?\s*|(?<![a-z0-9]))[t7]?[o0][t7][a4][l1i|](?:es)?(?![a-z])"
)
# Text right after "total" that makes it the grand total.
STRONG_AFTER = ("bol", "a pagar", "pagar", "venta", "compra", "due", "general", "final", "factura", "document", "operac")
# Word right before "total" that makes it the grand total.
STRONG_BEFORE = ("grand", "monto", "importe")
# Stems of the word right after "total" that mean it is *not* the grand total.
EXCLUDE_AFTER = (
    "neto", "afect", "exent", "iva", "i.v.a", "tax", "impuest",
    "item", "artic", "numer", "unidad", "cant", "qty", "quant",
    "saving", "ahorr", "desc", "dcto", "deto", "dto", "discount", "rebaj",
    "propin", "tip", "punto", "point",
)
# Word right before "total" that means it is *not* the grand total.
EXCLUDE_BEFORE = ("iva", "tax", "neto", "impuesto")

# Card payments repeat the amount actually charged, i.e. the total.
CARD_RE = re.compile(
    r"\b(?:t\.?\s*deb\w*|tar\.?\s*deb\w*|debit\w*|credit\w*|tarjeta|transbank|redcompra|webpay"
    r"|visa|mastercard|amex|maestro)\b"
)
# Lines whose amounts are never the total (cash handed over, change, tips, card charges).
PAYMENT_RE = re.compile(
    r"\b(?:cash|change|tendered|efectivo|vuelto|cambio|tip|propina)\b|" + CARD_RE.pattern
)
# No trailing boundary: OCR often glues the next char on ("IVAC19.0%").
IVA_RE = re.compile(r"(?<![a-z])(?:i\.\s*v\.\s*a\.?|iva)")


def _words(s: str) -> list[str]:
    return re.findall(r"[a-z][a-z.]*", s)


def _classify_total(folded: str, m: re.Match) -> float | None:
    """Score for a "total" keyword match, or None if it isn't the grand total."""
    # Subtotals, and tax-rate lines like "TOTAL IVA (19%)" however garbled.
    if m.group("sub") or "%" in folded:
        return None
    before = _words(folded[: m.start()])
    after_text = folded[m.end() :].lstrip(" :.-_")
    after = _words(after_text)
    prev_word = before[-1].strip(".") if before else ""
    next_word = after[0] if after else ""

    if prev_word in EXCLUDE_BEFORE or any(next_word.startswith(s) for s in EXCLUDE_AFTER):
        return None
    if prev_word in STRONG_BEFORE or any(after_text.startswith(s) for s in STRONG_AFTER):
        return STRONG_TOTAL
    return PLAIN_TOTAL


def _score_totals(lines: list[str], ev: Evidence) -> None:
    card_amounts: list[float] = []
    iva_amounts: list[float] = []
    keyword: dict[float, float] = {}

    for i, line in enumerate(lines):
        folded = _fold(line)

        if m := TOTAL_KW_RE.search(folded):
            score = _classify_total(folded, m)
            if score is not None:
                value = _amount_on_line(lines, i, m.end())
                if value is not None:
                    keyword[value] = max(keyword.get(value, 0.0), score)

        if m := CARD_RE.search(folded):
            value = _amount_on_line(lines, i, m.end())
            if value is not None:
                card_amounts.append(value)

        if m := IVA_RE.search(folded):
            value = _amount_on_line(lines, i, m.end())
            if value is not None:
                iva_amounts.append(value)

    for value, score in keyword.items():
        if any(abs(value * IVA_RATE / (1 + IVA_RATE) - iva) <= 1.5 for iva in iva_amounts):
            score += SUPPORT
        ev.totals[value] = score
    # The card charge is a vote for its amount, whether or not a total line agrees
    # (the total line itself may be misread, or missing).
    for value in set(card_amounts):
        ev.totals[value] = ev.totals.get(value, 0.0) + SUPPORT

    candidates = [
        a.value
        for line in lines
        if not PAYMENT_RE.search(_fold(line))
        for a in find_amounts(line)
        if _money_like(a) and a.value > 0
    ]
    ev.fallback_total = max(candidates) if candidates else None


def extract_total(lines: list[str]) -> tuple[float | None, str | None]:
    r = parse_receipt("\n".join(lines))
    return r.total_amount, r.currency


# --------------------------------------------------------------------------
# Date
# --------------------------------------------------------------------------

MONTHS = {
    "jan": 1, "january": 1, "ene": 1, "enero": 1,
    "feb": 2, "february": 2, "febrero": 2,
    "mar": 3, "march": 3, "marzo": 3,
    "apr": 4, "april": 4, "abr": 4, "abril": 4,
    "may": 5, "mayo": 5,
    "jun": 6, "june": 6, "junio": 6,
    "jul": 7, "july": 7, "julio": 7,
    "aug": 8, "august": 8, "ago": 8, "agosto": 8,
    "sep": 9, "sept": 9, "september": 9, "septiembre": 9, "setiembre": 9,
    "oct": 10, "october": 10, "octubre": 10,
    "nov": 11, "november": 11, "noviembre": 11,
    "dec": 12, "december": 12, "dic": 12, "diciembre": 12,
}
_MONTH = r"(?P<mon>" + "|".join(sorted(MONTHS, key=len, reverse=True)) + r")\.?"
_SEP = r"(?:\s?[-/]\s?|\.)"

DATE_PATTERNS = [
    # 2025-04-25, 2025/04/25
    ("ymd", re.compile(r"(?<!\d)(?P<y>\d{4})" + _SEP + r"(?P<a>\d{1,2})" + _SEP + r"(?P<b>\d{1,2})(?!\d)")),
    # 25/04/2025, 04-25-25, 25.04.2025
    ("num", re.compile(r"(?<![\d.,])(?P<a>\d{1,2})" + _SEP + r"(?P<b>\d{1,2})" + _SEP + r"(?P<y>\d{4}|\d{2})(?![\d]|[.,]\d)")),
    # 25 Apr 2025, 25 de abril de 2025, 25-Apr-2025
    ("dmy", re.compile(r"(?<!\d)(?P<d>\d{1,2})[\s\-/]*(?:de\s+)?" + _MONTH + r"[\s\-/,]*(?:de(?:l)?\s+)?(?P<y>\d{4}|\d{2})(?!\d)")),
    # Apr 25, 2025
    ("mdy", re.compile(r"\b" + _MONTH + r"\s+(?P<d>\d{1,2})(?:st|nd|rd|th)?,?\s+(?P<y>\d{4}|\d{2})(?!\d)")),
]
# "Fecha", "Fecha Emisión", "F. Emision", "Date", plus OCR-mangled "Fecba".
DATE_KEYWORD_RE = re.compile(r"\b(?:fe[cs][hb]\w*|f\.?\s*emision|emision|emitid\w*|date|issued|fch)\b")
# Dates that are not the purchase date: the SII stamp's "Resolución 80 del
# 22-08-2014", expiry dates, etc.
NOT_PURCHASE_DATE_RE = re.compile(
    r"\b(?:resol\w*|res|venc\w*|vence|exp\w*|valid\w*|caduc\w*|nacim\w*|desde|hasta)\b"
)
def _date_order(language: str | None) -> str:
    if DATE_ORDER in ("MDY", "DMY"):
        return DATE_ORDER
    return "DMY" if language == "es" else "MDY"


def _year(y: str) -> int:
    n = int(y)
    return 2000 + n if n < 100 else n


def _valid(y: int, m: int, d: int) -> date | None:
    try:
        result = date(y, m, d)
    except ValueError:
        return None
    if not (1990 <= result.year <= date.today().year + 1):
        return None
    return result


def _dates_in(line: str, order: str) -> list[date]:
    folded = _fold(line)
    found: list[date] = []
    for kind, pattern in DATE_PATTERNS:
        for m in pattern.finditer(folded):
            g = m.groupdict()
            if kind == "ymd":
                d = _valid(int(g["y"]), int(g["a"]), int(g["b"]))
            elif kind == "num":
                a, b, y = int(g["a"]), int(g["b"]), _year(g["y"])
                if a > 12:
                    d = _valid(y, b, a)
                elif b > 12:
                    d = _valid(y, a, b)
                elif order == "DMY":
                    d = _valid(y, b, a)
                else:
                    d = _valid(y, a, b)
            else:
                d = _valid(_year(g["y"]), MONTHS[g["mon"]], int(g["d"]))
            if d:
                found.append(d)
    return found


def _score_dates(lines: list[str], order: str, ev: Evidence) -> None:
    for i, line in enumerate(lines):
        folded = _fold(line)
        if NOT_PURCHASE_DATE_RE.search(folded):
            continue
        dates = _dates_in(line, order)
        if DATE_KEYWORD_RE.search(folded):
            # The value may have been split onto the next line.
            if not dates and i + 1 < len(lines):
                dates = _dates_in(lines[i + 1], order)
            if dates:
                iso = dates[0].isoformat()
                ev.dates[iso] = max(ev.dates.get(iso, 0.0), KEYWORD_DATE)
        elif dates:
            ev.dates.setdefault(dates[0].isoformat(), OTHER_DATE)


def extract_date(lines: list[str]) -> str | None:
    return parse_receipt("\n".join(lines)).purchase_date
