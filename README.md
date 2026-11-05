# Receipt Scanner

Upload a photo of a purchase receipt. OCR running in the browser extracts the **store name**, **date** and **total amount**, and the result is saved to Convex. The **View all receipts** button opens a modal that lists every stored receipt in a scrolling, infinitely loading table.

```
Browser: photo ──▶ Tesseract.js (WebAssembly) ──▶ parser ──store / date / total──▶ Next.js on Vercel (/api/scan)
                                                                                         │
                                                                                         ▼
                                    modal reads receipts in real time ──▶ Convex (receipts, rate-limit events)
```

It's a single Next.js 16 app (App Router, Tailwind v4, shadcn/ui), with its Convex backend in `convex/`.

The OCR runs on the user's device with [Tesseract.js](https://github.com/naptha/tesseract.js), so there is no OCR server to host. The Tesseract.js worker, its WebAssembly core and the English + Spanish language data (about 9 MB on first use, then cached by the browser) are copied from `node_modules` into `public/tesseract/` by [`scripts/copy-tesseract-assets.mjs`](scripts/copy-tesseract-assets.mjs) before `npm run dev` and `npm run build`. They're served from the app's own domain, not a CDN. Only the three extracted fields are sent to the server.

## Limits

All limits live in [`convex/limits.ts`](convex/limits.ts):

| Limit                         | Default | Purpose                                         |
| ----------------------------- | ------- | ----------------------------------------------- |
| `USER_SCANS_PER_WINDOW`       | 5 / hour | Scans per browser (anonymous cookie id)         |
| `IP_SCANS_PER_WINDOW`         | 15 / hour | Scans per IP address, so clearing cookies doesn't bypass the limit |
| `MAX_CONCURRENT_SCANS_PER_USER` | 1     | One scan in flight per user at a time           |
| `MAX_RECEIPTS_PER_USER`       | 25      | Receipts a single user can store                |
| `MAX_TOTAL_RECEIPTS`          | 1000    | Whole-database cap; new scans are rejected once full |

There is no login. Users get a random id in an httpOnly cookie, and both that id and the IP address are HMAC-hashed before they are stored. Failed scans still count toward the rate limit. Images never leave the browser; only the three extracted fields are sent and stored. Because the browser does the OCR, the server can't verify that the fields came from a real photo. It does check that each one is a value the parser could have produced.

Write mutations require `CONVEX_SERVER_SECRET`, so only the Next.js server can create receipts. The receipt list is public, but it never includes user keys.

## Local development

Prerequisites: Node 22.18+ (the parser tests run on Node's built-in TypeScript support).

```bash
npm install
npx convex dev            # log in and create a project; writes .env.local; keep it running
npx convex env set CONVEX_SERVER_SECRET "$(openssl rand -hex 32)"
```

Add the following to `.env.local` (see `.env.example`). `CONVEX_SERVER_SECRET` must be the same value you just set in Convex.

```
CONVEX_SERVER_SECRET=<same value>
```

Then run `npm run dev` and open http://localhost:3000. Run the parser tests with `npm test`.

## Deployment

**Convex.** Run `npx convex deploy` (or let Vercel do it, below). Then set the secret on the production deployment: `npx convex env set CONVEX_SERVER_SECRET <value> --prod`.

**Vercel.** Import the repo, keeping the default Root Directory (the repo root). Then:

- Build command: `npx convex deploy --cmd 'npm run build'`
- Environment variables:
  - `CONVEX_DEPLOY_KEY`: a production deploy key from the Convex dashboard
  - `CONVEX_SERVER_SECRET`: the same value as on Convex prod
  - `NEXT_PUBLIC_DATE_ORDER` (optional): see below

## OCR

The OCR ([`src/lib/ocr/scan.ts`](src/lib/ocr/scan.ts)) upscales the photo, removes shadows ([`preprocess.ts`](src/lib/ocr/preprocess.ts)), and runs Tesseract on up to three differently preprocessed versions within a 30 s budget. It stops as soon as the total and date are confidently found. The parser ([`src/lib/ocr/parser.ts`](src/lib/ocr/parser.ts)) reads line by line:

- **Total:** taken from lines containing "total". "Total Boleta" and "Total a pagar" outrank a plain "TOTAL", and Sub-Total, Total Neto/Afecto/Exento/IVA/Dcto and item-count lines are ignored. A card payment line (T.Debito, Transbank…) with the same amount, or an IVA line consistent with 19%, adds confidence. The passes vote, so a digit misread in one pass is outvoted.
- **Date:** taken from lines containing "Fecha"/"Emisión"/"Date". SII stamp dates ("Resolución 80 del …") are ignored.
- **Currency:** the receipt's language is detected from its words. Spanish gives `CLP` and English gives `USD`, unless `US$`/`CLP` is printed on it.
- **Store:** only reported when the receipt matches a store in the Convex `stores` table. Run `npx convex run stores:seed` once to load the built-in list from [`convex/storeSeed.ts`](convex/storeSeed.ts), then add more with `npx convex run stores:upsert '{"name":"...","aliases":["..."]}'` or in the Convex dashboard. A scan missing the store, date or total isn't saved, and the UI says which one.

Amounts like `1,234.56`, `1.234,56` and peso-style `$12.990` are all handled. Any field it isn't confident about comes back empty.

Ambiguous dates like `03/04/2025` follow `NEXT_PUBLIC_DATE_ORDER`. `AUTO` (the default) reads day-first on Spanish receipts and month-first otherwise, and `DMY`/`MDY` force an order. It's read at build time.
