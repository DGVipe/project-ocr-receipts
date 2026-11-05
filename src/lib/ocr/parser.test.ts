// Run with `npm test` (Node's built-in test runner, which strips the types).
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import {
  analyze as analyzeWith,
  combine,
  extractDate,
  extractTotal,
  isConfident,
  matchStore as matchStoreWith,
  parseNumber,
  parseReceipt as parseReceiptWith,
  parserConfig,
  similarity,
} from "./parser.ts";

// A sample of the `stores` table, which holds the real list.
const TEST_STORES: [name: string, aliases: string[]][] = [
  // Samples
  ["Supermercado La Magia de la Economía", ["la magia de la economia"]],
  ["Farmacias Ahumada", ["farmacias ahumada", "farmacia ahumada"]],
  ["Abarrotes Económicos", ["abarrotes economicos"]],
  ["Barnes & Noble Booksellers", ["barnes & noble booksellers"]],
  // Supermarkets
  ["Lider", ["hiper lider", "express de lider", "supermercado lider", "lider express"]],
  ["Walmart Chile", ["walmart chile"]],
  ["Jumbo", ["jumbo"]],
  ["Santa Isabel", ["santa isabel"]],
  ["Unimarc", ["unimarc"]],
  ["Tottus", ["tottus"]],
  ["Acuenta", ["acuenta"]],
  ["Mayorista 10", ["mayorista 10"]],
  ["Alvi", ["supermercado alvi", "alvi supermercados"]],
  ["OK Market", ["ok market"]],
  // Local markets
  ["Prolog F y V Limitada", ["prolog f y v limitada"]],
  // Pharmacies
  ["Cruz Verde", ["cruz verde"]],
  ["Salcobrand", ["salcobrand"]],
  ["Dr. Simi", ["farmacias similares", "dr simi"]],
  // Home improvement / department stores
  ["Sodimac", ["sodimac", "homecenter"]],
  ["Easy", ["easy retail", "tiendas easy"]],
  ["Construmart", ["construmart"]],
  ["Falabella", ["falabella"]],
  ["Ripley", ["ripley"]],
  ["Paris", ["tiendas paris"]],
  // Fuel / convenience
  ["Copec", ["copec"]],
  ["Shell", ["enex", "shell"]],
  ["Petrobras", ["petrobras", "aramco"]],
];

const STORES = TEST_STORES.map(([name, aliases]) => ({ name, aliases }));
const analyze = (text: string) => analyzeWith(text, STORES);
const parseReceipt = (text: string) => parseReceiptWith(text, STORES);
const matchStore = (lines: string[]) => matchStoreWith(lines, STORES);

const US_RECEIPT = `
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
`;

const CHILE_RECEIPT = `
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
`;

const EURO_RECEIPT = `
Café Central
Calle Mayor 1, Madrid
Factura simplificada
12 de marzo de 2024
Café con leche      2,50
Croissant           1,80
Subtotal            4,30
Total a pagar       4,30 €
Tarjeta             4,30
`;

// Excerpts of real Tesseract output from photographed Chilean boletas, OCR
// misreads included.
const MAGIA_OCR = `
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
`;

const AHUMADA_OCR = `
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
`;

const ABARROTES_OCR = `
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
`;

const approx = (actual: number | null, expected: number) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-6, `${actual} ≈ ${expected}`);

test("US receipt", () => {
  const r = parseReceipt(US_RECEIPT);
  assert.equal(r.storeName, null); // not in the known-stores list
  assert.equal(r.currency, "USD");
  approx(r.totalAmount, 6.98);
  assert.equal(r.purchaseDate, "2025-04-25");
});

test("Chile receipt with thousands and no decimals", () => {
  const r = parseReceipt(CHILE_RECEIPT);
  assert.equal(r.storeName, "Lider");
  assert.equal(r.totalAmount, 2340);
  assert.equal(r.currency, "CLP");
  assert.equal(r.purchaseDate, "2025-04-25");
});

test("Euro receipt with comma decimals and a Spanish month", () => {
  const r = parseReceipt(EURO_RECEIPT);
  approx(r.totalAmount, 4.3);
  assert.equal(r.currency, "CLP"); // Spanish receipt; only USD/CLP are used
  assert.equal(r.purchaseDate, "2024-03-12");
});

test("grand total and month-name date", () => {
  const r = parseReceipt("Joe's Diner\nApr 3, 2025\nGRAND TOTAL $42.10\nTIP 5.00");
  approx(r.totalAmount, 42.1);
  assert.equal(r.purchaseDate, "2025-04-03");
});

describe("real Chilean boletas", () => {
  for (const [name, text, store, total, day] of [
    ["La Magia", MAGIA_OCR, "Supermercado La Magia de la Economía", 4470, "2026-08-22"],
    ["Ahumada", AHUMADA_OCR, "Farmacias Ahumada", 47683, "2026-10-11"],
    ["Abarrotes", ABARROTES_OCR, "Abarrotes Económicos", 54820, "2026-08-07"],
  ] as const) {
    test(name, () => {
      const r = parseReceipt(text);
      assert.deepEqual([r.storeName, r.totalAmount, r.purchaseDate], [store, total, day]);
      assert.equal(r.currency, "CLP");
    });
  }
});

test("card payment and IVA support the total", () => {
  // plain TOTAL (2) + matching TAR DEB (1) + consistent IVA 8.753 (1)
  assert.deepEqual(analyze(ABARROTES_OCR).totals, new Map([[54820, 4]]));
});

test("strong total beats plain", () => {
  approx(extractTotal(["TOTAL 99.00", "Total a pagar 45.00"])[0], 45);
});

test("header total does not take the next item line", () => {
  const lines = ["PRECIO UNITARIO CANTIDAD TOTAL", "CARDIO 20MG 2 57.798", "Total Boleta 47.683"];
  assert.equal(extractTotal(lines)[0], 47683);
});

test("card payment used when the total line is unreadable", () => {
  assert.equal(extractTotal(["TOTAL En", "ali 54,470.", "T.DEBITO $ 4.470"])[0], 4470);
});

test("passes vote on the total", () => {
  const good = analyze("TOTAL $ 54.820\nTAR DEB/PREP 54.820");
  const misread = analyze("TOTAL $ 64.820\nTAR DEB/PREP 54.820");
  assert.equal(combine([misread, good]).totalAmount, 54820);
});

test("confidence needs a total and a keyword date", () => {
  assert.equal(isConfident([analyze("TOTAL 10.00\n01/02/2025")]), false);
  assert.equal(isConfident([analyze("Total a pagar 10.00\nFecha: 01/02/2025")]), true);
});

describe("parseNumber", () => {
  for (const [raw, expected] of [
    ["12.34", [12.34, true]],
    ["12,34", [12.34, true]],
    ["1,234.56", [1234.56, true]],
    ["1.234,56", [1234.56, true]],
    ["12.990", [12990, false]],
    ["1290", [1290, false]],
  ] as const) {
    test(raw, () => assert.deepEqual(parseNumber(raw), expected));
  }
});

test("total on the next line", () => {
  const [total, currency] = extractTotal(["TOTAL", "15.75", "CASH 20.00"]);
  approx(total, 15.75);
  assert.equal(currency, "USD");
});

test("OCR-confused total keyword", () => {
  approx(extractTotal(["T0TAL 9.99"])[0], 9.99);
  assert.equal(extractTotal(["TOTAL $ 4.47O"])[0], 4470);
});

test("excludes subtotal and item counts", () => {
  const lines = ["SUBTOTAL 50.00", "TOTAL ITEMS 3", "TOTAL SAVINGS 10.00", "TOTAL 45.00"];
  approx(extractTotal(lines)[0], 45);
});

test("fallback ignores payment lines", () => {
  approx(extractTotal(["Coffee 3.50", "Muffin 2.25", "CASH 10.00"])[0], 3.5);
});

describe("date order", () => {
  const original = parserConfig.dateOrder;
  afterEach(() => {
    parserConfig.dateOrder = original;
  });

  test("ambiguous date respects the configured order", () => {
    parserConfig.dateOrder = "DMY";
    assert.equal(extractDate(["03/04/2025"]), "2025-04-03");
    parserConfig.dateOrder = "MDY";
    assert.equal(extractDate(["03/04/2025"]), "2025-03-04");
  });

  test("AUTO follows the language", () => {
    parserConfig.dateOrder = "AUTO";
    assert.equal(extractDate(["Fecha: 07/08/2026"]), "2026-08-07");
    assert.equal(extractDate(["Date: 07/08/2026"]), "2026-07-08");
  });
});

test("date keyword line wins", () => {
  assert.equal(extractDate(["Exp 01/01/2030", "Ref 2025-01-01", "Date: 2025-02-14"]), "2025-02-14");
});

test("ignores the SII resolution date", () => {
  assert.equal(extractDate(["Resolucion. 80 del 22-08-2014"]), null);
});

test("rejects implausible dates", () => {
  assert.equal(extractDate(["Ref 99/99/9999", "Store 1999/13/40"]), null);
});

describe("matchStore", () => {
  for (const [lines, expected] of [
    [["FARMACIAS AHUMACLA SpA"], "Farmacias Ahumada"], // OCR typo
    [["ABARROTES ECONOMICOS S.A.", "VTA. POR CTA. DE WALMART CHILE"], "Abarrotes Económicos"],
    [["Cafe Central"], null],
    [["JUMBOTRON"], null], // short aliases must match whole words
  ] as const) {
    test(lines[0], () => assert.equal(matchStore([...lines]), expected));
  }
});

test("similarity matches difflib's ratio", () => {
  // Values from Python's difflib.SequenceMatcher(None, a, b).ratio().
  approx(similarity("farmacias ahumada", "farmacias ahumacla"), 0.9142857142857143);
  approx(similarity("abcd", "bcde"), 0.75);
  approx(similarity("", ""), 1);
});

describe("currency from language", () => {
  for (const [text, currency] of [
    ["BOLETA ELECTRONICA\nFecha: 07/08/2026\nTOTAL $ 4.470", "CLP"],
    ["Thank you for shopping\nDate 07/08/2026\nTOTAL $12.50\nCASH 20.00", "USD"],
    // No "$" sign at all: the language alone decides.
    ["RECEIPT\nSUBTOTAL 10.00\nTAX 0.80\nTOTAL 10.80", "USD"],
    // A printed code beats the language.
    ["Fecha 01/02/2026\nTotal a pagar US$ 25.00", "USD"],
    ["Thank you\nTOTAL CLP 4.470", "CLP"],
    ["12345", null],
  ] as const) {
    test(JSON.stringify(text), () => assert.equal(parseReceipt(text).currency, currency));
  }
});

test("currency kept without a total", () => {
  assert.equal(parseReceipt("Boleta electronica\nFecha: 07/08/2026").currency, "CLP");
});

test("language votes across passes", () => {
  const passes = [analyze("Fecha boleta vuelto"), analyze("Fecha boleta"), analyze("the receipt")];
  assert.equal(combine(passes).currency, "CLP");
});

test("empty text", () => {
  assert.deepEqual(parseReceipt(""), {
    storeName: null,
    totalAmount: null,
    currency: null,
    purchaseDate: null,
  });
});
