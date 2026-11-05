/**
 * Line-based heuristics that pull the store, purchase date and total out of
 * receipt OCR text.
 *
 * Each OCR pass is turned into *evidence*: candidate values with a score.
 *
 * - Total: a line containing "total" proposes the amount on that line. "Total
 *   Boleta" / "Total a pagar" outrank a plain "TOTAL"; "Sub-Total", "Total
 *   Neto", "Total IVA", "Total Dcto"... are ignored. A card payment line
 *   repeating the amount, or an IVA line consistent with it, adds support.
 * - Date: a line containing "Fecha"/"Date" proposes the date on that line;
 *   other dates are weak candidates. SII stamp lines ("Resolución 80 del ...")
 *   are ignored.
 * - Store: only names from the known-stores list (stored in Convex) are reported.
 * - Currency: "CLP" for Spanish receipts, "USD" for English ones, unless a code
 *   ("US$", "CLP") is printed. The language also decides day- vs month-first
 *   dates.
 *
 * Evidence from several OCR passes of the same image is summed, so a digit
 * misread in one pass is outvoted by the others. Every field is `null` when
 * nothing plausible is found.
 *
 * Pure functions with no browser or Node APIs, so it runs in the browser and in
 * `node --test`.
 */

export type Currency = "USD" | "CLP";
/** A known store: the name to report and the spellings to look for on the receipt. */
export type StoreEntry = { name: string; aliases: string[] };
type Language = "es" | "en";
type DateOrder = "AUTO" | "MDY" | "DMY";

export type ReceiptData = {
  storeName: string | null;
  totalAmount: number | null;
  currency: Currency | null;
  /** ISO YYYY-MM-DD */
  purchaseDate: string | null;
};

/** Scored candidates found in one OCR pass. */
export type Evidence = {
  totals: Map<number, number>;
  dates: Map<string, number>;
  store: string | null;
  /** Last-resort total guess (largest money-like amount), used only if no pass found anything better. */
  fallbackTotal: number | null;
  language: Language | null;
  /** Currency code printed on the receipt ("CLP", "US$"), which beats the language. */
  explicitCurrency: Currency | null;
};

export const parserConfig = {
  /**
   * "AUTO" (default): day-first when the receipt looks Spanish, else
   * month-first. "MDY" or "DMY" force an order. Only matters for ambiguous
   * dates like 03/04/2025.
   */
  dateOrder: (process.env.NEXT_PUBLIC_DATE_ORDER ?? "AUTO").toUpperCase() as DateOrder,
};

// Chilean IVA. A total T is consistent with an IVA line V when V ≈ T * 19 / 119.
const IVA_RATE = 0.19;

// Scores
const STRONG_TOTAL = 3; // "Total Boleta", "Total a pagar", "Grand total"
const PLAIN_TOTAL = 2; // "TOTAL"
const SUPPORT = 1; // card payment line with the same amount, or matching IVA
const KEYWORD_DATE = 3; // date on a "Fecha"/"Date" line
const OTHER_DATE = 1; // any other date

// Stop running more OCR passes once both fields reach these scores.
const CONFIDENT_TOTAL = 3;
const CONFIDENT_DATE = 3;

export function parseReceipt(text: string, stores: StoreEntry[]): ReceiptData {
  return combine([analyze(text, stores)]);
}

export function analyze(text: string, stores: StoreEntry[]): Evidence {
  const lines = text
    .split(/\r\n|[\n\r\v\f\x1c-\x1e\x85]/)
    .map((ln) => ln.trim())
    .filter(Boolean)
    .map(fixDigits);
  const ev: Evidence = {
    totals: new Map(),
    dates: new Map(),
    store: matchStore(lines, stores),
    fallbackTotal: null,
    language: detectLanguage(text),
    explicitCurrency: explicitCurrency(text),
  };
  scoreTotals(lines, ev);
  scoreDates(lines, dateOrder(ev.language), ev);
  return ev;
}

export function combine(evidence: Evidence[]): ReceiptData {
  const totals = sumScores(evidence.map((ev) => ev.totals));
  const dates = sumScores(evidence.map((ev) => ev.dates));
  const stores = sumScores(evidence.filter((ev) => ev.store).map((ev) => new Map([[ev.store!, 1]])));

  let total = best(totals);
  if (total === null) {
    const fallbacks = evidence.map((ev) => ev.fallbackTotal).filter((v): v is number => v !== null);
    total = fallbacks.length ? Math.max(...fallbacks) : null;
  }

  const explicit = best(
    sumScores(evidence.filter((ev) => ev.explicitCurrency).map((ev) => new Map([[ev.explicitCurrency!, 1]]))),
  );
  const language = best(
    sumScores(evidence.filter((ev) => ev.language).map((ev) => new Map([[ev.language!, 1]]))),
  );
  return {
    storeName: best(stores),
    totalAmount: total,
    currency: explicit ?? (language ? LANGUAGE_CURRENCY[language] : null),
    purchaseDate: best(dates),
  };
}

/** True once more OCR passes are unlikely to change the total or date. */
export function isConfident(evidence: Evidence[]): boolean {
  const totals = sumScores(evidence.map((ev) => ev.totals));
  const dates = sumScores(evidence.map((ev) => ev.dates));
  return maxValue(totals) >= CONFIDENT_TOTAL && maxValue(dates) >= CONFIDENT_DATE;
}

function sumScores<K>(maps: Iterable<Map<K, number>>): Map<K, number> {
  const out = new Map<K, number>();
  for (const m of maps) {
    for (const [key, score] of m) out.set(key, (out.get(key) ?? 0) + score);
  }
  return out;
}

/** Highest-scoring key. Maps keep insertion order, so ties go to the candidate seen first. */
function best<K>(scores: Map<K, number>): K | null {
  let bestKey: K | null = null;
  let bestScore = -Infinity;
  for (const [key, score] of scores) {
    if (score > bestScore) {
      bestKey = key;
      bestScore = score;
    }
  }
  return bestKey;
}

function maxValue(scores: Map<unknown, number>): number {
  return Math.max(0, ...scores.values());
}

/** Lowercase and strip accents so 'Emisión' matches 'emision'. */
function fold(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Undo common OCR letter-for-digit swaps inside numbers ('4.47O' -> '4.470'). */
function fixDigits(line: string): string {
  line = line.replace(/(?<=\d)[Oo](?=[\d.,/-]|(?![\p{L}\p{N}_]))|(?<=\d[.,/-])[Oo]/gu, "0");
  return line.replace(/(?<=\d)[lI|](?=\d)/g, "1");
}

// --------------------------------------------------------------------------
// Store
// --------------------------------------------------------------------------

const FUZZY_STORE_RATIO = 0.85;
const FUZZY_MIN_LEN = 8; // shorter aliases must match exactly

function normWords(s: string): string {
  return (fold(s).match(/[a-z0-9]+/g) ?? []).join(" ");
}


/** Python's `difflib.SequenceMatcher(None, a, b).ratio()`. */
export function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const b2j = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const list = b2j.get(b[j]);
    if (list) list.push(j);
    else b2j.set(b[j], [j]);
  }
  // difflib's "autojunk": ignore very common characters in long strings.
  if (b.length >= 200) {
    const limit = Math.floor(b.length / 100) + 1;
    for (const [ch, list] of b2j) if (list.length > limit) b2j.delete(ch);
  }

  const longestMatch = (alo: number, ahi: number, blo: number, bhi: number) => {
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = next;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize++;
    }
    return [besti, bestj, bestsize] as const;
  };

  let matches = 0;
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = longestMatch(alo, ahi, blo, bhi);
    if (!k) continue;
    matches += k;
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  return (2 * matches) / (a.length + b.length);
}

function aliasIn(alias: string, line: string): boolean {
  if (` ${line} `.includes(` ${alias} `)) return true;
  if (alias.length < FUZZY_MIN_LEN) return false;
  const words = line.split(" ");
  const n = alias.split(" ").length;
  for (const size of new Set([n, n + 1, Math.max(n - 1, 1)])) {
    // OCR may split or merge a word
    for (let i = 0; i + size <= words.length; i++) {
      if (similarity(alias, words.slice(i, i + size).join(" ")) >= FUZZY_STORE_RATIO) return true;
    }
  }
  return false;
}

/** The known store mentioned highest on the receipt, if any. */
export function matchStore(lines: string[], stores: StoreEntry[]): string | null {
  const aliases = stores.flatMap(({ name, aliases }) =>
    aliases.map((alias) => [name, normWords(alias)] as const).filter(([, alias]) => alias),
  );
  for (const line of lines) {
    const norm = normWords(line);
    if (!norm) continue;
    for (const [name, alias] of aliases) {
      if (aliasIn(alias, norm)) return name;
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// Amounts
// --------------------------------------------------------------------------

const NUM = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?`;
// Thousands-grouped (1,234 / 1.234,56) or plain (1234 / 12.34 / 12,34)
// numbers, not glued to more digits and not a percentage.
const AMOUNT_RE = new RegExp(
  String.raw`(?<![\d.,])(?<cur>[$€£¥])?\s*(?<num>${NUM})(?![\d]|[.,]\d|\s*%)`,
  "g",
);
// A line holding nothing but an amount (OCR often puts a column on its own line).
const AMOUNT_ONLY_RE = new RegExp(String.raw`^[^\p{L}\p{N}]*[$€£¥]?\s*(?:${NUM})[^\p{L}\p{N}]*$`, "u");

type Amount = { value: number; hasDecimals: boolean; symbol: string | null };

/**
 * Turn '1.234,56', '1,234.56', '12,50' or '12.990' into a number.
 * Returns [value, hadDecimalPart].
 */
export function parseNumber(num: string): [number, boolean] {
  const m = /[.,](\d{2})$/.exec(num);
  if (m) {
    const integer = num.slice(0, m.index).replace(/[.,]/g, "");
    return [Number(`${integer || 0}.${m[1]}`), true];
  }
  return [Number(num.replace(/[.,]/g, "")), false];
}

function findAmounts(line: string): Amount[] {
  return [...line.matchAll(AMOUNT_RE)].map((m) => {
    const [value, hasDecimals] = parseNumber(m.groups!.num);
    return { value, hasDecimals, symbol: m.groups!.cur ?? null };
  });
}

function moneyLike(a: Amount): boolean {
  return a.hasDecimals || a.symbol !== null;
}

/**
 * Right-most amount on `lines[i]` after `start`; failing that, the next line
 * if it holds nothing but an amount.
 */
function amountOnLine(lines: string[], i: number, start = 0): number | null {
  let amounts = findAmounts(lines[i].slice(start)).filter((a) => a.value > 0);
  if (amounts.length) return amounts[amounts.length - 1].value;
  if (i + 1 < lines.length && AMOUNT_ONLY_RE.test(lines[i + 1])) {
    amounts = findAmounts(lines[i + 1]).filter((a) => a.value > 0);
    if (amounts.length) return amounts[amounts.length - 1].value;
  }
  return null;
}

// --------------------------------------------------------------------------
// Language and currency
// --------------------------------------------------------------------------

// Receipts are either Chilean (Spanish, pesos) or US (English, dollars).
const LANGUAGE_CURRENCY: Record<Language, Currency> = { es: "CLP", en: "USD" };

// Words typical of each language's receipts. Words shared by both ("total",
// "visa") are left out. Matched on accent-folded, lowercased text.
const SPANISH_WORDS = new Set(
  `fecha hora boleta electronica emision rut giro sucursal caja cajero cajera vendedor
  iva neto exento afecto vuelto efectivo pagar tarjeta debito credito compra venta
  precio cantidad codigo descripcion articulo articulos unidad valor descuento dcto
  ahorro cliente gracias documento timbre resolucion verifique comuna supermercado
  farmacia farmacias abarrotes de del la las los el por para con su`.split(/\s+/),
);
const ENGLISH_WORDS = new Set(
  `date time receipt subtotal tax cash change due balance amount thank thanks you
  your store cashier customer item items qty quantity price each sale purchase
  payment card debit credit approved auth member savings register order paid
  tendered tip the and for with of at to is`.split(/\s+/),
);
// Explicit currency markers. "US$"/"USD" or "CLP"/"pesos" printed on a receipt
// beat the language guess.
const USD_RE = /\b(?:usd|us\s?\$|u\.s\.\s?dollars?|dollars?)/i;
const CLP_RE = /\b(?:clp|pesos?\s+chilenos?|\$\s?clp)\b/i;

/** 'es' or 'en' depending on which language's receipt words dominate. */
function detectLanguage(text: string): Language | null {
  const words = fold(text).match(/[a-z]+/g) ?? [];
  const es = words.filter((w) => SPANISH_WORDS.has(w)).length;
  const en = words.filter((w) => ENGLISH_WORDS.has(w)).length;
  if (es === en) return null;
  return es > en ? "es" : "en";
}

function explicitCurrency(text: string): Currency | null {
  const usd = USD_RE.test(text);
  const clp = CLP_RE.test(text);
  if (usd === clp) return null; // neither, or contradictory
  return usd ? "USD" : "CLP";
}

// --------------------------------------------------------------------------
// Total
// --------------------------------------------------------------------------

// "total" plus common OCR confusions (T0TAL, TOTA1, 7OTAL, a dropped first
// letter), optionally preceded by "sub"/"sub-"/"sub " so subtotals are caught.
const TOTAL_KW_RE = new RegExp(String.raw`(?:(?<sub>sub)\s*[-.]?\s*|(?<![a-z0-9]))[t7]?[o0][t7][a4][l1i|](?:es)?(?![a-z])`);
// Text right after "total" that makes it the grand total.
const STRONG_AFTER = ["bol", "a pagar", "pagar", "venta", "compra", "due", "general", "final", "factura", "document", "operac"];
// Word right before "total" that makes it the grand total.
const STRONG_BEFORE = ["grand", "monto", "importe"];
// Stems of the word right after "total" that mean it is *not* the grand total.
const EXCLUDE_AFTER = [
  "neto", "afect", "exent", "iva", "i.v.a", "tax", "impuest",
  "item", "artic", "numer", "unidad", "cant", "qty", "quant",
  "saving", "ahorr", "desc", "dcto", "deto", "dto", "discount", "rebaj",
  "propin", "tip", "punto", "point",
];
// Word right before "total" that means it is *not* the grand total.
const EXCLUDE_BEFORE = ["iva", "tax", "neto", "impuesto"];

// Card payments repeat the amount actually charged, i.e. the total.
const CARD_RE =
  /\b(?:t\.?\s*deb\w*|tar\.?\s*deb\w*|debit\w*|credit\w*|tarjeta|transbank|redcompra|webpay|visa|mastercard|amex|maestro)\b/;
// Lines whose amounts are never the total (cash handed over, change, tips, card charges).
const PAYMENT_RE = new RegExp(
  String.raw`\b(?:cash|change|tendered|efectivo|vuelto|cambio|tip|propina)\b|` + CARD_RE.source,
);
// No trailing boundary: OCR often glues the next char on ("IVAC19.0%").
const IVA_RE = /(?<![a-z])(?:i\.\s*v\.\s*a\.?|iva)/;

function words(s: string): string[] {
  return s.match(/[a-z][a-z.]*/g) ?? [];
}

/** Score for a "total" keyword match, or null if it isn't the grand total. */
function classifyTotal(folded: string, m: RegExpExecArray): number | null {
  // Subtotals, and tax-rate lines like "TOTAL IVA (19%)" however garbled.
  if (m.groups?.sub || folded.includes("%")) return null;
  const before = words(folded.slice(0, m.index));
  const afterText = folded.slice(m.index + m[0].length).replace(/^[ :.\-_]+/, "");
  const after = words(afterText);
  const prevWord = before.length ? before[before.length - 1].replace(/^\.+|\.+$/g, "") : "";
  const nextWord = after[0] ?? "";

  if (EXCLUDE_BEFORE.includes(prevWord) || EXCLUDE_AFTER.some((s) => nextWord.startsWith(s))) return null;
  if (STRONG_BEFORE.includes(prevWord) || STRONG_AFTER.some((s) => afterText.startsWith(s))) {
    return STRONG_TOTAL;
  }
  return PLAIN_TOTAL;
}

function scoreTotals(lines: string[], ev: Evidence): void {
  const cardAmounts: number[] = [];
  const ivaAmounts: number[] = [];
  const keyword = new Map<number, number>();

  lines.forEach((line, i) => {
    const folded = fold(line);

    let m = TOTAL_KW_RE.exec(folded);
    if (m) {
      const score = classifyTotal(folded, m);
      if (score !== null) {
        const value = amountOnLine(lines, i, m.index + m[0].length);
        if (value !== null) keyword.set(value, Math.max(keyword.get(value) ?? 0, score));
      }
    }

    m = CARD_RE.exec(folded);
    if (m) {
      const value = amountOnLine(lines, i, m.index + m[0].length);
      if (value !== null) cardAmounts.push(value);
    }

    m = IVA_RE.exec(folded);
    if (m) {
      const value = amountOnLine(lines, i, m.index + m[0].length);
      if (value !== null) ivaAmounts.push(value);
    }
  });

  for (const [value, score] of keyword) {
    const ivaMatches = ivaAmounts.some((iva) => Math.abs((value * IVA_RATE) / (1 + IVA_RATE) - iva) <= 1.5);
    ev.totals.set(value, ivaMatches ? score + SUPPORT : score);
  }
  // The card charge is a vote for its amount, whether or not a total line
  // agrees (the total line itself may be misread, or missing).
  for (const value of new Set(cardAmounts)) {
    ev.totals.set(value, (ev.totals.get(value) ?? 0) + SUPPORT);
  }

  const candidates = lines
    .filter((line) => !PAYMENT_RE.test(fold(line)))
    .flatMap(findAmounts)
    .filter((a) => moneyLike(a) && a.value > 0)
    .map((a) => a.value);
  ev.fallbackTotal = candidates.length ? Math.max(...candidates) : null;
}

export function extractTotal(lines: string[]): [number | null, Currency | null] {
  const r = parseReceipt(lines.join("\n"), []);
  return [r.totalAmount, r.currency];
}

// --------------------------------------------------------------------------
// Date
// --------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, ene: 1, enero: 1,
  feb: 2, february: 2, febrero: 2,
  mar: 3, march: 3, marzo: 3,
  apr: 4, april: 4, abr: 4, abril: 4,
  may: 5, mayo: 5,
  jun: 6, june: 6, junio: 6,
  jul: 7, july: 7, julio: 7,
  aug: 8, august: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septiembre: 9, setiembre: 9,
  oct: 10, october: 10, octubre: 10,
  nov: 11, november: 11, noviembre: 11,
  dec: 12, december: 12, dic: 12, diciembre: 12,
};
const MONTH = String.raw`(?<mon>${Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|")})\.?`;
const SEP = String.raw`(?:\s?[-/]\s?|\.)`;

const DATE_PATTERNS: ["ymd" | "num" | "named", RegExp][] = [
  // 2025-04-25, 2025/04/25
  ["ymd", new RegExp(String.raw`(?<!\d)(?<y>\d{4})${SEP}(?<a>\d{1,2})${SEP}(?<b>\d{1,2})(?!\d)`, "g")],
  // 25/04/2025, 04-25-25, 25.04.2025
  ["num", new RegExp(String.raw`(?<![\d.,])(?<a>\d{1,2})${SEP}(?<b>\d{1,2})${SEP}(?<y>\d{4}|\d{2})(?![\d]|[.,]\d)`, "g")],
  // 25 Apr 2025, 25 de abril de 2025, 25-Apr-2025
  ["named", new RegExp(String.raw`(?<!\d)(?<d>\d{1,2})[\s\-/]*(?:de\s+)?${MONTH}[\s\-/,]*(?:de(?:l)?\s+)?(?<y>\d{4}|\d{2})(?!\d)`, "g")],
  // Apr 25, 2025
  ["named", new RegExp(String.raw`\b${MONTH}\s+(?<d>\d{1,2})(?:st|nd|rd|th)?,?\s+(?<y>\d{4}|\d{2})(?!\d)`, "g")],
];
// "Fecha", "Fecha Emisión", "F. Emision", "Date", plus OCR-mangled "Fecba".
const DATE_KEYWORD_RE = /\b(?:fe[cs][hb]\w*|f\.?\s*emision|emision|emitid\w*|date|issued|fch)\b/;
// Dates that are not the purchase date: the SII stamp's "Resolución 80 del
// 22-08-2014", expiry dates, etc.
const NOT_PURCHASE_DATE_RE = /\b(?:resol\w*|res|venc\w*|vence|exp\w*|valid\w*|caduc\w*|nacim\w*|desde|hasta)\b/;

function dateOrder(language: Language | null): "MDY" | "DMY" {
  const configured = parserConfig.dateOrder;
  if (configured === "MDY" || configured === "DMY") return configured;
  return language === "es" ? "DMY" : "MDY";
}

function year(y: string): number {
  const n = Number(y);
  return n < 100 ? 2000 + n : n;
}

/** ISO date if it exists and is plausible for a receipt. */
function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  if (y < 1990 || y > new Date().getFullYear() + 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function datesIn(line: string, order: "MDY" | "DMY"): string[] {
  const folded = fold(line);
  const found: string[] = [];
  for (const [kind, pattern] of DATE_PATTERNS) {
    for (const m of folded.matchAll(pattern)) {
      const g = m.groups!;
      let d: string | null;
      if (kind === "ymd") {
        d = validDate(Number(g.y), Number(g.a), Number(g.b));
      } else if (kind === "num") {
        const a = Number(g.a);
        const b = Number(g.b);
        const y = year(g.y);
        if (a > 12) d = validDate(y, b, a);
        else if (b > 12) d = validDate(y, a, b);
        else if (order === "DMY") d = validDate(y, b, a);
        else d = validDate(y, a, b);
      } else {
        d = validDate(year(g.y), MONTHS[g.mon], Number(g.d));
      }
      if (d) found.push(d);
    }
  }
  return found;
}

function scoreDates(lines: string[], order: "MDY" | "DMY", ev: Evidence): void {
  lines.forEach((line, i) => {
    const folded = fold(line);
    if (NOT_PURCHASE_DATE_RE.test(folded)) return;
    let dates = datesIn(line, order);
    if (DATE_KEYWORD_RE.test(folded)) {
      // The value may have been split onto the next line.
      if (!dates.length && i + 1 < lines.length) dates = datesIn(lines[i + 1], order);
      if (dates.length) ev.dates.set(dates[0], Math.max(ev.dates.get(dates[0]) ?? 0, KEYWORD_DATE));
    } else if (dates.length && !ev.dates.has(dates[0])) {
      ev.dates.set(dates[0], OTHER_DATE);
    }
  });
}

export function extractDate(lines: string[]): string | null {
  return parseReceipt(lines.join("\n"), []).purchaseDate;
}
