import pytest

from app import parser
from app.parser import (
    analyze,
    combine,
    extract_date,
    extract_total,
    is_confident,
    match_store,
    parse_number,
    parse_receipt,
)

US_RECEIPT = """
WALMART SUPERCENTER
Welcome
1234 MAIN ST, SPRINGFIELD
TEL (555) 123-4567
ST# 1234 OP# 00001 TE# 12
BANANAS          0.59
MILK 1GAL        3.48
BREAD            2.50
SUBTOTAL         6.57
TAX 1  6.250 %   0.41
TOTAL            6.98
CASH            20.00
CHANGE DUE      13.02
04/25/2025 14:32:01
THANK YOU FOR SHOPPING
"""

CHILE_RECEIPT = """
Supermercado Lider
RUT 76.042.014-K
Av. Siempre Viva 742
BOLETA ELECTRONICA N 123456
Fecha: 25/04/2025  Hora: 18:22
PAN AMASADO        $1.290
LECHE ENTERA       $1.050
NETO               $1.966
IVA                  $374
TOTAL              $2.340
EFECTIVO           $5.000
VUELTO             $2.660
"""

EURO_RECEIPT = """
Café Central
Calle Mayor 1, Madrid
Factura simplificada
12 de marzo de 2024
Café con leche      2,50
Croissant           1,80
Subtotal            4,30
Total a pagar       4,30 €
Tarjeta             4,30
"""

# Excerpts of real Tesseract output from photographed Chilean boletas, OCR
# misreads included.
MAGIA_OCR = """
———K= TOTAL RENDIDO $
R.U.T. 76.052.070-5
BOLETA ELECTRONICA
SUPERMERCADO LA MAGIA DE LA ECONOMIA
GENERAL LAGOS 845, VICTORIA
Fecha Emisión: 22-08-2026 14:01:14
CODIGO DESCRIPCION VALOR
7805040001306 LAVALOZAS VIRGINIA LIMON 50¢ 1.080
7804655191372 PINTURA PARA PISOS DONA GAE 3.390
TOTAL _ __ $4,470
El IVA de esta boleta es: $ 714
T.DEBITO $ 4.470
Resolucion. 80 del 22-08-2014
"""

AHUMADA_OCR = """
FARMACIAS AHUMADA SpA
Av. Sarita Clara 684
BOLETA ELECTRONICA No 369230907
FECHA DE EMISION: 11/10/2026 HORA: .16:53 SON
ARTICULO VALOR DS Sy is
__PRECIO UNITARIO CANTIDAD TOTAL SIRS ai
CARDIO 20/12,5.X40COMP. 2 57.798 ASS
(É 28.299,00 c/u) : ANS
Sub-Total Boleta $ 57.798 ES
total Deto Ahumada Contigo $ 10.115 9
Total Neto 40.070
I.V.A. 19% $ 7.613
“otal Bolats 47.683
TRANSBANK $ 47.683
RES «es. 141 del 30-08-2010
"""

ABARROTES_OCR = """
ABARROTES ECONOMICOS S.A.
AV.PDTE.EDO.FREI MONTALVA 8301 QUILICURA
VTA. POR CTA. DE WALMART CHILE S.A
Fecha: 07/08/2026 Hora: 10:20:55
2X1.000 MANJAR $ 2.000
SUBTOTAL 54,820
TOTAL AFECTO $ 46,067
TOTAL EXENTO $ 0
TOTAL IVAC19.0%)$ 8.753
TOTAL $ 54.820
TAR DEB/PREP 54.820
TOTAL NUMERO DE ARTIC VEND = 62
"""


def test_us_receipt():
    r = parse_receipt(US_RECEIPT)
    assert r.store_name is None  # not in the known-stores list
    assert r.currency == "USD"
    assert r.total_amount == pytest.approx(6.98)
    assert r.purchase_date == "2025-04-25"


def test_chile_receipt_thousands_without_decimals():
    r = parse_receipt(CHILE_RECEIPT)
    assert r.store_name == "Lider"
    assert r.total_amount == 2340
    assert r.currency == "CLP"
    assert r.purchase_date == "2025-04-25"


def test_euro_receipt_comma_decimals_and_spanish_month():
    r = parse_receipt(EURO_RECEIPT)
    assert r.total_amount == pytest.approx(4.30)
    assert r.currency == "CLP"  # Spanish receipt; only USD/CLP are used
    assert r.purchase_date == "2024-03-12"


def test_grand_total_and_month_name_date():
    r = parse_receipt("Joe's Diner\nApr 3, 2025\nGRAND TOTAL $42.10\nTIP 5.00")
    assert r.total_amount == pytest.approx(42.10)
    assert r.purchase_date == "2025-04-03"


@pytest.mark.parametrize(
    "text,store,total,day",
    [
        (MAGIA_OCR, "Supermercado La Magia de la Economía", 4470, "2026-08-22"),
        (AHUMADA_OCR, "Farmacias Ahumada", 47683, "2026-10-11"),
        (ABARROTES_OCR, "Abarrotes Económicos", 54820, "2026-08-07"),
    ],
)
def test_real_chilean_boletas(text, store, total, day):
    r = parse_receipt(text)
    assert (r.store_name, r.total_amount, r.purchase_date) == (store, total, day)
    assert r.currency == "CLP"


def test_card_payment_and_iva_support_the_total():
    ev = analyze(ABARROTES_OCR)
    # plain TOTAL (2) + matching TAR DEB (1) + consistent IVA 8.753 (1)
    assert ev.totals == {54820: 4.0}


def test_strong_total_beats_plain():
    lines = ["TOTAL 99.00", "Total a pagar 45.00"]
    assert extract_total(lines)[0] == pytest.approx(45.00)


def test_header_total_does_not_take_next_item_line():
    lines = ["PRECIO UNITARIO CANTIDAD TOTAL", "CARDIO 20MG 2 57.798", "Total Boleta 47.683"]
    assert extract_total(lines)[0] == 47683


def test_card_payment_used_when_total_line_unreadable():
    lines = ["TOTAL En", "ali 54,470.", "T.DEBITO $ 4.470"]
    assert extract_total(lines)[0] == 4470


def test_passes_vote_on_total():
    good = analyze("TOTAL $ 54.820\nTAR DEB/PREP 54.820")
    misread = analyze("TOTAL $ 64.820\nTAR DEB/PREP 54.820")
    assert combine([misread, good]).total_amount == 54820


def test_confidence_needs_total_and_dated_keyword():
    assert not is_confident([analyze("TOTAL 10.00\n01/02/2025")])
    assert is_confident([analyze("Total a pagar 10.00\nFecha: 01/02/2025")])


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("12.34", (12.34, True)),
        ("12,34", (12.34, True)),
        ("1,234.56", (1234.56, True)),
        ("1.234,56", (1234.56, True)),
        ("12.990", (12990.0, False)),
        ("1290", (1290.0, False)),
    ],
)
def test_parse_number(raw, expected):
    assert parse_number(raw) == pytest.approx(expected)


def test_total_on_next_line():
    assert extract_total(["TOTAL", "15.75", "CASH 20.00"]) == (pytest.approx(15.75), "USD")


def test_ocr_confused_total_keyword():
    assert extract_total(["T0TAL 9.99"])[0] == pytest.approx(9.99)
    assert extract_total(["TOTAL $ 4.47O"])[0] == 4470


def test_excludes_subtotal_and_item_counts():
    lines = ["SUBTOTAL 50.00", "TOTAL ITEMS 3", "TOTAL SAVINGS 10.00", "TOTAL 45.00"]
    assert extract_total(lines)[0] == pytest.approx(45.00)


def test_fallback_ignores_payment_lines():
    lines = ["Coffee 3.50", "Muffin 2.25", "CASH 10.00"]
    assert extract_total(lines)[0] == pytest.approx(3.50)


def test_ambiguous_date_respects_order(monkeypatch):
    monkeypatch.setattr(parser, "DATE_ORDER", "DMY")
    assert extract_date(["03/04/2025"]) == "2025-04-03"
    monkeypatch.setattr(parser, "DATE_ORDER", "MDY")
    assert extract_date(["03/04/2025"]) == "2025-03-04"


def test_auto_date_order_follows_language(monkeypatch):
    monkeypatch.setattr(parser, "DATE_ORDER", "AUTO")
    assert extract_date(["Fecha: 07/08/2026"]) == "2026-08-07"
    assert extract_date(["Date: 07/08/2026"]) == "2026-07-08"


def test_date_keyword_line_wins():
    lines = ["Exp 01/01/2030", "Ref 2025-01-01", "Date: 2025-02-14"]
    assert extract_date(lines) == "2025-02-14"


def test_ignores_sii_resolution_date():
    assert extract_date(["Resolucion. 80 del 22-08-2014"]) is None


def test_rejects_implausible_dates():
    assert extract_date(["Ref 99/99/9999", "Store 1999/13/40"]) is None


@pytest.mark.parametrize(
    "lines,expected",
    [
        (["FARMACIAS AHUMACLA SpA"], "Farmacias Ahumada"),  # OCR typo
        (["ABARROTES ECONOMICOS S.A.", "VTA. POR CTA. DE WALMART CHILE"], "Abarrotes Económicos"),
        (["Cafe Central"], None),
        (["JUMBOTRON"], None),  # short aliases must match whole words
    ],
)
def test_match_store(lines, expected):
    assert match_store(lines) == expected


@pytest.mark.parametrize(
    "text,currency",
    [
        ("BOLETA ELECTRONICA\nFecha: 07/08/2026\nTOTAL $ 4.470", "CLP"),
        ("Thank you for shopping\nDate 07/08/2026\nTOTAL $12.50\nCASH 20.00", "USD"),
        # No "$" sign at all: the language alone decides.
        ("RECEIPT\nSUBTOTAL 10.00\nTAX 0.80\nTOTAL 10.80", "USD"),
        # A printed code beats the language.
        ("Fecha 01/02/2026\nTotal a pagar US$ 25.00", "USD"),
        ("Thank you\nTOTAL CLP 4.470", "CLP"),
        ("12345", None),
    ],
)
def test_currency_from_language(text, currency):
    assert parse_receipt(text).currency == currency


def test_currency_kept_without_total():
    assert parse_receipt("Boleta electronica\nFecha: 07/08/2026").currency == "CLP"


def test_language_votes_across_passes():
    passes = [analyze("Fecha boleta vuelto"), analyze("Fecha boleta"), analyze("the receipt")]
    assert combine(passes).currency == "CLP"


def test_empty_text():
    r = parse_receipt("")
    assert r.to_dict() == {
        "store_name": None,
        "total_amount": None,
        "currency": None,
        "purchase_date": None,
    }
