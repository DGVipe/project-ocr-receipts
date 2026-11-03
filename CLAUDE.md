# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Receipt scanner: users upload a receipt photo, OCR extracts **store name, date, total**, and the result is stored in Convex. A modal lists every stored receipt with infinite scroll. Two deployables:

- `web/` — Next.js 16 (App Router, Tailwind v4, shadcn/ui) deployed to Vercel, plus the Convex backend in `web/convex/`.
- `ocr-service/` — Python FastAPI + pytesseract in Docker (Render via `render.yaml`, or any Docker host). It exists separately because Vercel functions can't install the Tesseract binary.

## Commands

Web (run from `web/`):

```bash
npm run dev                # Next.js dev server
npx convex dev             # Convex dev deployment; regenerates convex/_generated (keep running)
npx tsc --noEmit           # type-check
npm run lint               # eslint (convex/_generated is ignored)
npm run build
npx convex env set CONVEX_SERVER_SECRET <value>   # must equal CONVEX_SERVER_SECRET in .env.local
```

OCR service (run from `ocr-service/`; venv is managed with `uv` because the system Python has no pip/venv):

```bash
uv venv && uv pip install -r requirements-dev.txt
OCR_API_KEY=dev-key .venv/bin/uvicorn app.main:app --port 8000
.venv/bin/python -m pytest                                   # all tests
.venv/bin/python -m pytest tests/test_parser.py::test_us_receipt   # single test
docker build -t receipt-ocr . && docker run -p 8000:8000 -e OCR_API_KEY=dev-key receipt-ocr
```

Check that Tesseract 5 (eng+spa) is installed on this dev machine. The API tests monkeypatch `main.ocr_passes`, so they run without it.

## Next.js version caveat

`web/AGENTS.md`: this is Next.js 16 and APIs/conventions differ from older versions. Read the relevant guide in `web/node_modules/next/dist/docs/` before writing Next.js code. Cache Components is enabled, so don't add `export const runtime` to routes (Edge is deprecated).

shadcn here uses the **base-nova** style built on **Base UI**, not Radix. Use `render={<Button />}` instead of `asChild`. `cn` is imported from the `cn` package (shadcn's own; `src/lib/utils.ts` re-exports it). `Table` has a local `containerClassName` prop that lets sticky headers work inside `ScrollArea`.

## Scan request flow (spans several files)

1. `src/components/receipt-scanner.tsx` downsizes and re-encodes the image to JPEG in the browser (`src/lib/prepare-image.ts`) to stay under Vercel's 4.5 MB body limit, then POSTs to `/api/scan`.
2. `src/app/api/scan/route.ts` checks same-origin, size and MIME type, then calls `getIdentity()` (`src/lib/server/identity.ts`). That function gives the browser a random UUID in the httpOnly `receipt_uid` cookie and HMAC-hashes both the cookie id and the IP with `CONVEX_SERVER_SECRET` into `userKey` / `ipKey`. Raw IPs are never stored.
3. `api.scans.reserve` (Convex mutation) enforces every limit and inserts a `pending` row in `scanEvents`. Convex mutations are serializable, which is what makes the concurrency and cap checks race-safe.
4. `src/lib/server/ocr.ts` sends the image to `${OCR_SERVICE_URL}/scan` with an `X-API-Key` header and maps the service's snake_case response to camelCase.
5. If all three fields come back null, `scans.fail` runs and the route returns 422. Otherwise `scans.complete` re-checks the storage caps, inserts into `receipts`, increments the `stats` singleton, and marks the event `done`. Failed scans still count toward the rate limit.

`/api/quota` returns the same numbers via `scans.getQuota` so the UI can show remaining scans.

## Convex conventions

- All tunable limits live in `convex/limits.ts`: per-user and per-IP scans per hourly window, 1 concurrent scan per user, per-user and global receipt caps, and the modal page size. Client code imports `LIST_PAGE_SIZE` from there too.
- Write and identity-taking functions are public Convex functions guarded by a `secret` arg checked by `assertServer()` in `convex/lib.ts`. Only the Next.js server, which holds the secret, can call them. `receipts.list` and `receipts.summary` are public with no secret and must never return `userKey`.
- The global receipt count is kept in the `stats` table (`name: "global"`) instead of counting rows; keep it in sync if you add deletion.
- `crons.ts` runs `scans.pruneOldEvents` hourly to delete `scanEvents` older than the window.
- Import Convex code from the frontend through the `@convex/*` path alias (tsconfig maps it to `./convex/*`).

## OCR service

- `app/ocr.py`: `ocr_passes()` is a generator yielding Tesseract text (`--oem 1 --psm 4`) for up to 3 preprocessing variants of the image: shadow-removed + Otsu-binarized, shadow-removed grayscale, plain grayscale. All are scaled to a ~3200px long side. `OCR_TIMEOUT_SECONDS` is the budget for all passes together. Languages come from `TESSERACT_LANG` (default `eng+spa`, installed in the Dockerfile).
- `app/parser.py`: pure, line-based heuristics, covered by `tests/test_parser.py` (which includes real Tesseract output from Chilean boletas). `analyze(text)` turns one pass into scored `Evidence`, `combine()` sums the evidence across passes, and `is_confident()` decides when to stop running passes.
  - Totals: the amount on a line containing "total". "Strong" qualifiers (total boleta, total a pagar, grand total…) score 3 and a plain "total" scores 2. Sub-Total, Total Neto/Afecto/Exento/IVA/Dcto, item-count and `%` lines are excluded. A matching card-payment line (T.Debito, Transbank, Tar Deb…) adds +1, and so does an IVA line consistent with 19%. If no total line is found it falls back to the largest money-like amount not on a payment line.
  - Amounts: handles `1,234.56`, `1.234,56` and peso-style `$12.990`.
  - Dates: a date on a Fecha/Emisión/Date line beats other dates. Resolución/vencimiento lines are skipped. Ambiguous numeric dates use `DATE_ORDER`: `AUTO` (default) is DMY when the text looks Spanish, otherwise MDY.
  - Store name: only names listed in `app/stores.py`, matched fuzzily. The highest-printed match wins.
  - Language/currency: `detect_language` counts Spanish vs English receipt words (`SPANISH_WORDS`/`ENGLISH_WORDS`), and passes vote. `es` → `CLP`, `en` → `USD`. A printed `US$`/`USD`/`CLP` overrides it. Currency is only ever `USD`, `CLP` or `null` (`web/src/lib/server/ocr.ts` enforces this too). The language also drives the `AUTO` date order.
  - Every field is `None` rather than a guess.
- `app/main.py`: API-key check with `hmac.compare_digest`, an upload size cap, and an asyncio semaphore (`MAX_CONCURRENT_OCR`) around `extract()`, which runs passes in the threadpool until `is_confident`.

## Environment

`web/.env.local` (template in `web/.env.example`): `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_SERVER_SECRET`, `OCR_SERVICE_URL`, `OCR_API_KEY`. Server env is read lazily via `src/lib/server/env.ts`, so `next build` works without secrets. The OCR service needs `OCR_API_KEY`, which must match the web app's key. On Vercel, set Root Directory to `web` and the build command to `npx convex deploy --cmd 'npm run build'`.
