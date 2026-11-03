# Receipt Scanner

Upload a photo of a purchase receipt. OCR extracts the **store name**, **date** and **total amount**, and the result is saved to Convex. The **View all receipts** button opens a modal that lists every stored receipt in a scrolling, infinitely loading table.

```
Browser ──upload──▶ Next.js on Vercel (/api/scan) ──image──▶ OCR service (FastAPI + pytesseract, Docker)
                          │                                         │
                          │◀──────── store / date / total ──────────┘
                          ▼
                       Convex (receipts, rate-limit events)  ◀── modal reads receipts in real time
```

| Folder         | What it is                                                                 |
| -------------- | -------------------------------------------------------------------------- |
| `web/`         | Next.js 16 app (App Router, Tailwind v4, shadcn/ui) and the `convex/` backend |
| `ocr-service/` | Python FastAPI service that runs Tesseract through pytesseract             |

Vercel's serverless functions can't install the Tesseract binary, so the OCR runs as a separate Docker service (Render, Railway, Fly.io…). The Next.js server is the only thing that talks to it, using a shared API key.

## Limits

All limits live in [`web/convex/limits.ts`](web/convex/limits.ts):

| Limit                         | Default | Purpose                                         |
| ----------------------------- | ------- | ----------------------------------------------- |
| `USER_SCANS_PER_WINDOW`       | 5 / hour | Scans per browser (anonymous cookie id)         |
| `IP_SCANS_PER_WINDOW`         | 15 / hour | Scans per IP address, so clearing cookies doesn't bypass the limit |
| `MAX_CONCURRENT_SCANS_PER_USER` | 1     | One scan in flight per user at a time           |
| `MAX_RECEIPTS_PER_USER`       | 25      | Receipts a single user can store                |
| `MAX_TOTAL_RECEIPTS`          | 1000    | Whole-database cap; new scans are rejected once full |

There is no login. Users get a random id in an httpOnly cookie, and both that id and the IP address are HMAC-hashed before they are stored. Failed scans still count toward the rate limit. Images aren't stored; only the three extracted fields are. The server rejects uploads over 4 MB, and the browser downsizes photos before uploading.

Write mutations require `CONVEX_SERVER_SECRET`, so only the Next.js server can create receipts. The receipt list is public, but it never includes user keys.

## Local development

Prerequisites: Node 20+, Python 3.12+, [uv](https://docs.astral.sh/uv/) (or pip), and Tesseract (`sudo apt install tesseract-ocr tesseract-ocr-spa`, or `brew install tesseract tesseract-lang`), or Docker instead of a local Tesseract.

**1. OCR service**

```bash
cd ocr-service
uv venv && uv pip install -r requirements-dev.txt
OCR_API_KEY=dev-key .venv/bin/uvicorn app.main:app --port 8000
# or: docker build -t receipt-ocr . && docker run -p 8000:8000 -e OCR_API_KEY=dev-key receipt-ocr
```

Run the tests with `.venv/bin/python -m pytest`.

**2. Convex and Next.js**

```bash
cd web
npm install
npx convex dev            # log in and create a project; writes .env.local; keep it running
npx convex env set CONVEX_SERVER_SECRET "$(openssl rand -hex 32)"
```

Add the following to `web/.env.local` (see `.env.example`). `CONVEX_SERVER_SECRET` must be the same value you just set in Convex.

```
CONVEX_SERVER_SECRET=<same value>
OCR_SERVICE_URL=http://127.0.0.1:8000
OCR_API_KEY=dev-key
```

Then run `npm run dev` and open http://localhost:3000.

## Deployment

**OCR service.** On Render, use **New → Blueprint** with this repo; [`render.yaml`](render.yaml) builds `ocr-service/Dockerfile` and generates `OCR_API_KEY`. Any Docker host works. Note the public URL and the key.

Free Render instances sleep when idle, and the first scan after a sleep can take 30–60 s. `/api/scan` allows up to 60 s. Use a paid instance if that's too slow.

**Convex.** Run `npx convex deploy` from `web/` (or let Vercel do it, below). Then set the secret on the production deployment: `npx convex env set CONVEX_SERVER_SECRET <value> --prod`.

**Vercel.** Import the repo and set **Root Directory** to `web`. Then:

- Build command: `npx convex deploy --cmd 'npm run build'`
- Environment variables:
  - `CONVEX_DEPLOY_KEY`: a production deploy key from the Convex dashboard
  - `CONVEX_SERVER_SECRET`: the same value as on Convex prod
  - `OCR_SERVICE_URL`: for example `https://receipt-ocr.onrender.com`
  - `OCR_API_KEY`: the same value as on the OCR service

## OCR service configuration

| Env var               | Default    | Notes                                                   |
| --------------------- | ---------- | ------------------------------------------------------- |
| `OCR_API_KEY`         | (required) | Shared with the Next.js app                             |
| `DATE_ORDER`          | `AUTO`     | How ambiguous dates like `03/04/2025` are read. `AUTO` reads day-first on Spanish receipts and month-first otherwise; `DMY`/`MDY` force an order |
| `TESSERACT_LANG`      | `eng+spa`  | Tesseract language packs (installed in the Dockerfile)  |
| `MAX_CONCURRENT_OCR`  | `2`        | Parallel Tesseract jobs                                 |
| `OCR_TIMEOUT_SECONDS` | `30`       | Time budget for all OCR passes of one image             |
| `MAX_UPLOAD_BYTES`    | 5 MB       |                                                         |

The OCR ([`ocr-service/app/ocr.py`](ocr-service/app/ocr.py)) upscales the photo, removes shadows, and runs Tesseract on up to three differently preprocessed versions. It stops as soon as the total and date are confidently found. The parser ([`ocr-service/app/parser.py`](ocr-service/app/parser.py)) reads line by line:

- **Total:** taken from lines containing "total". "Total Boleta" and "Total a pagar" outrank a plain "TOTAL", and Sub-Total, Total Neto/Afecto/Exento/IVA/Dcto and item-count lines are ignored. A card payment line (T.Debito, Transbank…) with the same amount, or an IVA line consistent with 19%, adds confidence. The passes vote, so a digit misread in one pass is outvoted.
- **Date:** taken from lines containing "Fecha"/"Emisión"/"Date". SII stamp dates ("Resolución 80 del …") are ignored.
- **Currency:** the receipt's language is detected from its words. Spanish gives `CLP` and English gives `USD`, unless `US$`/`CLP` is printed on it.
- **Store:** only reported when the receipt matches a store in [`ocr-service/app/stores.py`](ocr-service/app/stores.py). Add a store there to recognize it.

Amounts like `1,234.56`, `1.234,56` and peso-style `$12.990` are all handled. Any field it isn't confident about comes back empty.
