import { google } from 'googleapis';
import { getGoogleAuth } from './google-auth';
import { extractArticle, stockKey } from './stock-match';

export { extractArticle, stockKey };

const STOCK_SHEET_ID = process.env.STOCK_SHEET_ID || '1VfKkErXzc3qdDdlFMphmX6ysL60mpg5MGJWE1dYXIRk';
const STOCK_SHEET_GID = Number(process.env.STOCK_SHEET_GID || 1684029091);

const CACHE_TTL = 5 * 60 * 1000;

export interface StockRow {
  /** Полное название из инвентаризации */
  name: string;
  /** Артикул, вытащенный из названия — по нему сходимся с прайсом */
  article: string;
  qty: number;
  unit: string;
}

let cache: { rows: StockRow[]; at: number } | null = null;

function toNumber(value: unknown): number {
  const raw = String(value ?? '').replace(/\s| /g, '').replace(',', '.');
  const n = parseFloat(raw);
  return isFinite(n) ? n : 0;
}

/** Ищет строку заголовка и возвращает индексы нужных колонок. */
function findColumns(rows: string[][]) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = (rows[i] || []).map(c => String(c ?? '').trim().toLowerCase());
    const name = cells.findIndex(c => c === 'товар' || c.startsWith('наимен'));
    if (name === -1) continue;

    // «Кол-во по учету» — это остаток по документам; берём фактический.
    const qty = cells.findIndex((c, idx) => idx !== name && c.startsWith('кол-во') && !c.includes('учет'));
    if (qty === -1) continue;

    const unit = cells.findIndex(c => c === 'ед.' || c === 'ед' || c.startsWith('ед.изм'));
    return { headerRow: i, name, qty, unit };
  }
  return null;
}

async function readSheet(): Promise<StockRow[]> {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });

  // gid из ссылки — это внутренний идентификатор листа, а values.get работает
  // с именем. Поэтому сначала спрашиваем метаданные книги.
  const meta = await sheets.spreadsheets.get({ spreadsheetId: STOCK_SHEET_ID, fields: 'sheets.properties' });
  const sheet =
    meta.data.sheets?.find(s => s.properties?.sheetId === STOCK_SHEET_GID) || meta.data.sheets?.[0];
  const title = sheet?.properties?.title;
  if (!title) throw new Error('В таблице остатков не найдено ни одного листа');

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: STOCK_SHEET_ID,
    range: `'${title}'!A1:AZ2000`,
  });

  const rows = (res.data.values || []) as string[][];
  const cols = findColumns(rows);
  if (!cols) {
    throw new Error(
      `На листе «${title}» не найдены колонки «Товар» и «Кол-во». Проверьте шапку таблицы.`
    );
  }

  const out: StockRow[] = [];
  for (let i = cols.headerRow + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = String(row[cols.name] ?? '').trim();
    if (!name) continue;
    const article = extractArticle(name);
    if (!article) continue;
    out.push({
      name,
      article,
      qty: toNumber(row[cols.qty]),
      unit: String(row[cols.unit] ?? 'шт').trim() || 'шт',
    });
  }
  return out;
}

export async function getStock(force = false): Promise<StockRow[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL) return cache.rows;
  const rows = await readSheet();
  cache = { rows, at: Date.now() };
  return rows;
}

/** Остатки, сведённые по артикулу: одна модель может лежать несколькими строками. */
export function indexByArticle(rows: StockRow[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const r of rows) {
    const key = stockKey(r.article);
    if (!key) continue;
    map[key] = (map[key] || 0) + r.qty;
  }
  return map;
}
