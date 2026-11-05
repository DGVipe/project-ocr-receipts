# UI style guide

## Next.js 16

Next.js 16 APIs and conventions differ from older versions. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (see [`AGENTS.md`](../../AGENTS.md)). Cache Components is on, so don't add `export const runtime` to routes (Edge is deprecated).

## Components

- shadcn uses the **base-nova** style built on **Base UI**, not Radix ([`components.json`](../../components.json)). Use `render={<Button />}`, not `asChild`.
- Add primitives with the shadcn CLI into [`src/components/ui/`](../../src/components/ui/). App components go in `src/components/`.
- `cn` comes from the `cn` package. [`src/lib/utils.ts`](../../src/lib/utils.ts) re-exports it.
- `Table` has a local `containerClassName` prop so that sticky headers work inside `ScrollArea`.
- Icons: `lucide-react`. Toasts: `sonner`. Theme: `next-themes` ([`theme-provider.tsx`](../../src/components/theme-provider.tsx)).
- Tailwind v4, configured in CSS ([`globals.css`](../../src/app/globals.css)), with no `tailwind.config`.

## Text and i18n

- All user-facing strings go in [`src/lib/i18n/messages.ts`](../../src/lib/i18n/messages.ts), with both `en` and `es` entries. Read them with `const { t } = useI18n()`.
- The locale is stored in the `locale` cookie so the server renders the right language from the first byte ([`locale.ts`](../../src/lib/i18n/locale.ts)).

## Loading

[`page-skeleton.tsx`](../../src/components/page-skeleton.tsx) mirrors the real header and layout. Update it whenever the header changes. Set `SKELETON_DELAY_MS` in dev to inspect it.
