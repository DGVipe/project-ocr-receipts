# CLAUDE.md

Guidance for Claude Code in this repository. Keep this file short: details live in `.claude/docs/` and are read only when the task needs them.

## 1. Know the Project

**Receipt photo → browser OCR → store, date, total → Convex.**

- Next.js 16 (App Router, Tailwind v4, shadcn/ui) at the repo root, deployed to Vercel. Convex backend in `convex/`.
- OCR runs in the browser with Tesseract.js, self-hosted from `public/tesseract/` (generated, gitignored). There is no OCR server and no CDN. The image never leaves the browser.
- Key files:
  - [`src/lib/ocr/scan.ts`](src/lib/ocr/scan.ts): OCR engine and passes
  - [`src/lib/ocr/parser.ts`](src/lib/ocr/parser.ts): field extraction
  - [`src/app/api/scan/route.ts`](src/app/api/scan/route.ts): validation, identity, limits
  - [`convex/scans.ts`](convex/scans.ts): rate limits and storing receipts
  - [`convex/limits.ts`](convex/limits.ts): every tunable limit

## 2. Read Docs on Demand

**Open only the doc that matches the task.**

| Task touches… | Read |
| ------------- | ---- |
| `/api/*`, Convex functions, limits, identity | [`.claude/docs/architecture.md`](.claude/docs/architecture.md) |
| OCR, preprocessing, parser rules, parser tests | [`.claude/docs/ocr.md`](.claude/docs/ocr.md) |
| Components, styling, i18n strings, Next.js APIs | [`.claude/docs/ui.md`](.claude/docs/ui.md) and `node_modules/next/dist/docs/` |
| Setup, env vars, deployment | [`README.md`](README.md), [`.env.example`](.env.example) |
| Hooks, permissions, plugins | [`.claude/settings.json`](.claude/settings.json) (shared); `.claude/settings.local.json` (personal, gitignored) |

If a doc is wrong or missing something you had to discover, update it in the same change.

## 3. Ask Before Guessing

**Ambiguous request? Ask, don't assume.**

- If the request could reasonably mean two different things, ask one short question that names the options.
- Ask when the answer changes the code: which field, which receipt format, which limit, UI vs. parser.
- Don't ask what the code or docs already answer. Look it up first.
- When a small assumption is safe, make it and state it in your reply.

## 4. Respect the Invariants

**These break things silently if ignored.**

- Never let Tesseract.js fall back to jsDelivr. Paths must point at `/tesseract/*`.
- Keep `parser.ts` / `preprocess.ts` free of DOM/Node APIs and of TS syntax that type stripping can't run (enums, parameter properties, namespaces). Files in `src/lib/ocr/` import each other with explicit `.ts` extensions.
- Write and identity-taking Convex functions require the `secret` arg (`assertServer()`). Public queries never return `userKey`.
- Parser fields are `null` rather than a guess. Currency is only `USD`, `CLP` or `null`.
- Base UI, not Radix: use `render={<Button />}`, not `asChild`. Don't add `export const runtime`.

## 5. Verify Before Done

**Run the checks that cover what you changed.**

```bash
npx tsc --noEmit        # always
npm run lint            # always
npm test                # parser/preprocess changes; add a case in parser.test.ts
node --test --test-name-pattern="US receipt" src/lib/ocr/parser.test.ts   # one test
npm run dev             # UI changes (needs `npx convex dev` running)
```

---

**These guidelines are working if:** changes stay small and in the right file, docs are read only when relevant, ambiguous requests get one clarifying question instead of a wrong guess, and checks pass before the work is reported done.
