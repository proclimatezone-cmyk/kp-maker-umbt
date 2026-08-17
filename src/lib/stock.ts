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

/**
 * Ищет строку заголовка и колонки. Структура таблицы «Склад UMBT»:
 * Наименование | Модель | Свободный остаток на складе | Общий приход | Отгружено | Бронь.
 * Модель — отдельная колонка, поэтому сопоставляем по ней напрямую,
 * а не вытаскиваем артикул из названия.
 */
function findColumns(rows: string[][]) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = (rows[i] || []).map(c => String(c ?? '').trim().toLowerCase());
    const model = cells.findIndex(c => c === 'модель' || c.startsWith('модель'));
    if (model === -1) continue;

    // Показываем именно свободный остаток (приход минус отгрузки и бронь).
    const qty = cells.findIndex(c => c.includes('свободн') && c.includes('остат'));
    if (qty === -1) continue;

    const name = cells.findIndex(c => c === 'товар' || c.startsWith('наимен'));
    return { headerRow: i, model, qty, name };
  }
  return null;
}

async function readSheet(): Promise<StockRow[]> {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });

  // gid из ссылки — это внутренний идентификатор листа, а values.get работает
  // с именем. Поэтому сначала спрашиваем метаданные книги.
  const meta = await sheets.spreadsheets.get({ spreadsheetId: STOCK_SHEET_ID, fields: 'sheets.properties' });
  const all = meta.data.sheets || [];
  // В книге несколько вкладок (Состояние склада, Приход, Заказы, Бронь) —
  // нужна «Состояние склада»: сначала по gid из ссылки, затем по названию.
  const sheet =
    all.find(s => s.properties?.sheetId === STOCK_SHEET_GID) ||
    all.find(s => /состоян/i.test(s.properties?.title || '')) ||
    all[0];
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
      `На листе «${title}» не найдены колонки «Модель» и «Свободный остаток». Проверьте шапку таблицы.`
    );
  }

  // «Наименование» заполнено точечно — только в первой строке серии, дальше
  // до следующей серии ячейка пустая (та же раскладка, что в «Заказы»/«Бронь»,
  // см. lib/reports/parse-matrix.ts). Без переноса вниз почти все позиции
  // в договоре шли голым артикулом вместо описания.
  const out: StockRow[] = [];
  let currentName = '';
  for (let i = cols.headerRow + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const model = String(row[cols.model] ?? '').trim();
    const rawName = cols.name !== -1 ? String(row[cols.name] ?? '').trim() : '';
    if (rawName && !/^итого/i.test(rawName)) currentName = rawName;
    if (!model) continue; // строки-категории («VRF») и «Итого» модели не имеют — пропускаем
    // Артикул для сопоставления берём из самой колонки «Модель».
    out.push({
      name: currentName || model,
      article: model,
      qty: toNumber(row[cols.qty]),
      unit: 'шт',
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

/**
 * Полные названия по артикулу. В договор позиции идут именно так, как
 * они записаны в инвентаризации, а не коротким артикулом из прайса.
 */
export function indexNamesByArticle(rows: StockRow[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of rows) {
    const key = stockKey(r.article);
    if (!key) continue;
    // Названия двуязычные через слэш — для договора берём русскую часть.
    // В ячейках попадаются переносы строк («2 трубный\nфанкойл») — схлопываем в пробелы.
    let ru = r.name.split(/\s*\/\s*/)[0].replace(/\s+/g, ' ').trim();
    // Название серии одно на всю группу моделей («VRF V8 кассетный 4-х
    // поточный блок») — без артикула в конце разные позиции в спецификации
    // выглядели бы одинаково. Добавляем модель, если её там ещё нет.
    if (ru && !stockKey(ru).includes(key)) ru = `${ru} ${r.article}`;
    if (ru && (!map[key] || ru.length > map[key].length)) map[key] = ru;
  }
  return map;
}
