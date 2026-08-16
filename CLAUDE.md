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
- Old price list: `старый прайс 03.08.2026.xlsx` → `node src/scripts/parse-old-price.mjs` → `src/data/old-price.json` (regenerate manually if a newer price file is supplied; not auto-synced).
