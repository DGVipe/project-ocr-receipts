# OCR and parser (`src/lib/ocr/`, browser-only)

## Engine: [`scan.ts`](../../src/lib/ocr/scan.ts)

- `loadOcrEngine()` lazily creates one shared Tesseract.js worker: `OEM.LSTM_ONLY`, `PSM.SINGLE_COLUMN` (`--oem 1 --psm 4`), eng+spa.
- `workerPath` / `corePath` / `langPath` point at `/tesseract/*`. Never let it fall back to its jsDelivr defaults. The assets are copied by [`copy-tesseract-assets.mjs`](../../scripts/copy-tesseract-assets.mjs).
- `scanReceipt()` decodes the photo with EXIF rotation, converts it to grayscale at a ~3200px long side, and runs passes until `isConfident`. The first pass always completes. Later passes are skipped near the 30 s budget.

## Preprocessing: [`preprocess.ts`](../../src/lib/ocr/preprocess.ts)

Pure pixel ops on `GrayImage` that mirror Pillow. `preprocessVariants()` yields, in order:

1. shadow-removed + Otsu-binarized
2. shadow-removed grayscale, sharpened
3. plain grayscale, autocontrast + sharpen

## Parser: [`parser.ts`](../../src/lib/ocr/parser.ts)

A port of the former Python parser. `analyze(text, stores)` turns one pass into scored `Evidence` (Maps, so ties go to the first candidate seen). `combine()` sums the passes and `isConfident()` decides when to stop. Every field is `null` rather than a guess.

| Field | Rule |
| ----- | ---- |
| Total | Amount on a "total" line. Strong qualifiers (total boleta, total a pagar, grand total…) score 3, plain "total" scores 2. Sub-Total, Total Neto/Afecto/Exento/IVA/Dcto, item-count and `%` lines are excluded. A matching card-payment line (T.Debito, Transbank, Tar Deb…) adds +1, and so does an IVA line consistent with 19%. Fallback: the largest money-like amount not on a payment line |
| Amounts | `1,234.56`, `1.234,56`, `$12.990` |
| Date | Fecha/Emisión/Date lines win. Resolución/vencimiento lines are skipped. Ambiguous dates use `parserConfig.dateOrder` (`NEXT_PUBLIC_DATE_ORDER`, inlined at build): `AUTO` = DMY on Spanish text, else MDY |
| Store | Fuzzy match against the stores passed in. `similarity()` reimplements `difflib.SequenceMatcher.ratio()`. The highest-printed match wins |
| Language / currency | `detectLanguage` counts `SPANISH_WORDS` vs `ENGLISH_WORDS` and the passes vote. `es` → `CLP`, `en` → `USD`. A printed `US$`/`USD`/`CLP` overrides it. Only `USD`, `CLP` or `null` |

## Tests: [`parser.test.ts`](../../src/lib/ocr/parser.test.ts)

Run with `node:test` using Node's TS type stripping. Includes real Tesseract output from Chilean boletas. Add a case for every parser change.
