# KP Maker for UMBT - Project Instructions

This project is a web-based tool for generating Commercial Proposals (КП - Коммерческое Предложение) for UMBT.

## Technical Stack
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Vanilla CSS (CSS Variables in `src/app/globals.css`)
- **Data Source**: Google Sheets (Synced to local JSON)
  - Auth: `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` env vars (service account `kp-maker@nazgul-bot-492304.iam.gserviceaccount.com`), falls back to OAuth refresh token (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN`) — see `src/lib/google-auth.ts`. No local key file is read directly.
  - Product catalog spreadsheet (sheet `для кп`, synced by `sync-sheets.mjs`): `1O5aeKAbSc_UkDk7expSqaDO5dpUaQLyqWI40Vhp4MhE`
  - Orders/stock spreadsheet (sheets `Заказы`, `Бронь`, `Объекты`, used by the `/reports` section): `1VfKkErXzc3qdDdlFMphmX6ysL60mpg5MGJWE1dYXIRk`
- **Document Generation**: 
  - Word: `docxtemplater`, `pizzip`
  - PDF: Local Word automation via `.vbs` scripts (Windows only)
- **Icons**: `lucide-react`

## Project Structure
- `src/app/`: Next.js pages and API routes.
- `src/scripts/`: Utilities for data syncing and testing.
  - `sync-sheets.js`: Fetches product data from Google Sheets API.
- `src/data/`: Static data files (e.g., `products.json`).
- `src/types/`: TypeScript definitions.
- `*.docx`: Templates for proposal generation.

## Key Commands
- `npm run dev`: Start development server.
- `node src/scripts/sync-sheets.js`: Update `products.json` from the master Google Sheet.
- `npm run build`: Build for production.

## Development Guidelines
- **Language**: Use English for code (variables, functions, filenames) and Russian for UI text/labels.
- **Components**: Use functional components with hooks.
- **Styling**: Prefer global CSS variables and semantic class names. Avoid inline styles where possible.
- **Data Sync**: Always verify `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_PRIVATE_KEY` (or the OAuth vars) are set in `.env.local` before running sync scripts.
- **PDF Generation**: Note that PDF generation depends on local Word installation on Windows. If it fails, the app provides the `.docx` file as fallback.

## Implementation Details
- The main UI allows selecting products, setting manager info, and calculating totals.
- Generated documents use `final_template.docx` as a base.
- Product IDs are generated from model names: `(model).toLowerCase().replace(/[^a-z0-9]/g, '-')`.

## Reports (`/reports`)
Single-user analytics dashboard (sales, active reservations, old-vs-current price comparison), gated by `REPORTS_ACCESS_EMAIL` env var — checked in `middleware.ts` against the `email` claim already present in the `umbt_auth` JWT. Not shown/reachable for any other whitelisted user (404 on the API, redirect on the page).
- `src/lib/reports/`: sheet parsing (`parse-matrix.ts` — shared layout for `Заказы`/`Бронь`), joins (`sales.ts`, `bookings.ts`, `price-comparison.ts`), and a 10-min in-memory cache (`cache.ts`), mirroring `products-cache.ts`.
- Known source-data gaps (intentional, not bugs): the `Объекты` registry only links a minority of `Заказы` order codes to a date/manager — unlinked sales show as "Не указано"; `Бронь` has no manager field and no history of closed reservations (rows are deleted when a booking closes), so that report is a live snapshot grouped by client, not by manager.
- **Аналитика продаж** (first tab, `/api/reports/managers` → `src/lib/reports/manager-analytics.ts`): orders from `Заказы` attributed to managers by order-code prefix (directory in `src/lib/reports/managers.ts` — MN Носиров, K Кузин, Э Ширинов, И Азаматов, КЖ Жалилов, …), KPs from the `все кпшки` archive (by KP-number initials, else login; test clients like «1»/«234» skipped). Order amount = contract sum if known, else current price list × qty. Order dates come from the `Журнал заказов` tab in the archive spreadsheet (`orders-journal.ts`): created on first run (registry dates + interpolated «оценка» for old orders), then new codes get their first-seen date; manual edits in that tab win. Kept up to date daily by `vercel.json` cron → `/api/cron/orders-journal` (needs `CRON_SECRET` env on Vercel).
- KP date auto-roll (`src/app/page.tsx`, `rollKpDateIfNewDay`): on the first visit of a new day (Asia/Tashkent; also checked every minute and on tab focus) the KP date becomes today and the DDMMYY part of the KP number is replaced; picking a date manually also updates the number.
- Old price list: `старый прайс 03.08.2026.xlsx` → `node src/scripts/parse-old-price.mjs` → `src/data/old-price.json` (regenerate manually if a newer price file is supplied; not auto-synced).
