# KP Maker for UMBT - Project Instructions

This project is a web-based tool for generating Commercial Proposals (КП - Коммерческое Предложение) for UMBT.

## Technical Stack
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Vanilla CSS (CSS Variables in `src/app/globals.css`)
- **Data Source**: Google Sheets (Synced to local JSON)
  - Requires `nazgul-bot-492304-aaf16fd328d9.json` (Service account key)
  - Spreadsheet ID: `1-f_Z-Y1d5Nq4X_D8a_l6l94U5z_W2i_h8h8Y-8Yk`
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
- **Data Sync**: Always verify `nazgul-bot-492304-aaf16fd328d9.json` exists before running sync scripts.
- **PDF Generation**: Note that PDF generation depends on local Word installation on Windows. If it fails, the app provides the `.docx` file as fallback.

## Implementation Details
- The main UI allows selecting products, setting manager info, and calculating totals.
- Generated documents use `final_template.docx` as a base.
- Product IDs are generated from model names: `(model).toLowerCase().replace(/[^a-z0-9]/g, '-')`.
