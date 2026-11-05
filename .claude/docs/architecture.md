# Architecture: scan flow and Convex

## Scan request flow

1. [`receipt-scanner.tsx`](../../src/components/receipt-scanner.tsx) calls `scanReceipt(file, stores)` ([`scan.ts`](../../src/lib/ocr/scan.ts)). OCR runs in the browser, then the extracted fields are POSTed as JSON to `/api/scan`. Selecting a file calls `loadOcrEngine()` early so the download overlaps with the preview. The image never leaves the browser.
2. [`api/scan/route.ts`](../../src/app/api/scan/route.ts) checks same-origin, then `readResult()` sanitizes the untrusted fields. Anything invalid becomes `null`:
   - store: must be a name in the Convex `stores` table (`api.stores.list`)
   - total: a finite number > 0
   - currency: `USD` or `CLP`
   - date: `YYYY-MM-DD`
3. `getIdentity()` ([`identity.ts`](../../src/lib/server/identity.ts)) sets a random UUID in the httpOnly `receipt_uid` cookie and HMAC-hashes the cookie id and the IP with `CONVEX_SERVER_SECRET` into `userKey` / `ipKey`. Raw IPs are never stored.
4. `scans.reserve` enforces every limit and inserts a `pending` row in `scanEvents`. Convex mutations are serializable, which makes the concurrency and cap checks race-safe.
5. If the store, total or date is null, `scans.fail` runs and the route returns 422 `missing_fields` with a `missing` array. The UI names each field. Otherwise `scans.complete` re-checks the caps, inserts into `receipts`, increments `stats`, and marks the event `done`. Failed scans still count toward the rate limit.

`/api/quota` returns the same numbers through `scans.getQuota`.

## Convex conventions

- All tunable limits are in [`convex/limits.ts`](../../convex/limits.ts), including `LIST_PAGE_SIZE`, which the client imports too.
- Write and identity-taking functions are public but take a `secret` arg checked by `assertServer()` ([`convex/lib.ts`](../../convex/lib.ts)). Only the Next.js server holds the secret.
- `receipts.list` and `receipts.summary` are public with no secret and must never return `userKey`.
- The global receipt count lives in the `stats` singleton (`name: "global"`). Keep it in sync if you add deletion.
- [`crons.ts`](../../convex/crons.ts) runs `scans.pruneOldEvents` hourly.
- `stores.upsert` is internal: `npx convex run stores:upsert '{"name":"...","aliases":["..."]}'` or the dashboard. The table starts empty.
- Import Convex code from the frontend through `@convex/*` (maps to `./convex/*`).
- Modals page over `usePaginatedQuery` through the shared `usePages` hook ([`page-controls.tsx`](../../src/components/page-controls.tsx)).
