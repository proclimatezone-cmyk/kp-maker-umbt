import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOURCE_FILE = path.join(__dirname, '..', '..', 'старый прайс 03.08.2026.xlsx');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'old-price.json');

// Служебные листы — сводная таблица и архивная V8, не часть актуального прайса.
const SKIP_SHEETS = new Set(['汇总表', 'OLD V8']);

function findCol(row, regex) {
  if (!row) return -1;
  for (let c = 0; c < row.length; c++) {
    if (regex.test(String(row[c] || ''))) return c;
  }
  return -1;
}

/**
 * Раскладка заголовков «плавает» между листами: где-то весь заголовок в первой
 * строке, где-то первая строка — коэффициент скидки (0.38), а реальные подписи
 * колонок («Midea model», «Цена со скидкой 62%») — во второй. Ищем нужные колонки
 * сперва в строке 0; то, что там не нашлось, доищем в строке 1 и, если нашли,
 * считаем данные начинающимися после неё.
 */
function locateHeader(row0, row1) {
  let modelCol = findCol(row0, /midea\s*mode/i);
  let priceCol = findCol(row0, /скидкой\s*62/i);
  let codeCol = findCol(row0, /code/i);
  let seriesCol = findCol(row0, /^series$/i);

  let headerRows = 1;
  if (modelCol === -1) { modelCol = findCol(row1, /midea\s*mode/i); if (modelCol !== -1) headerRows = 2; }
  if (priceCol === -1) { priceCol = findCol(row1, /скидкой\s*62/i); if (priceCol !== -1) headerRows = 2; }
  if (codeCol === -1) { codeCol = findCol(row1, /code/i); if (codeCol !== -1) headerRows = 2; }
  if (seriesCol === -1) { seriesCol = findCol(row1, /^series$/i); if (seriesCol !== -1) headerRows = 2; }

  return { modelCol, priceCol, codeCol, seriesCol, headerRows };
}

function parseSheet(sheetName, rows) {
  const { modelCol, priceCol, codeCol, seriesCol, headerRows } = locateHeader(rows[0], rows[1]);

  if (modelCol === -1 || priceCol === -1) {
    console.warn(`  [пропущен] "${sheetName}": не нашёл колонку модели/цены (модель=${modelCol}, цена=${priceCol})`);
    return [];
  }

  const items = [];
  let currentSeries = '';
  let skippedNoModel = 0;
  let skippedNoPrice = 0;

  for (let i = headerRows; i < rows.length; i++) {
    const r = rows[i] || [];
    const seriesRaw = seriesCol !== -1 ? String(r[seriesCol] || '').trim() : '';
    if (seriesRaw) currentSeries = seriesRaw.split('\r\n')[0].split('\n')[0];

    const model = String(r[modelCol] || '').trim();
    if (!model) { skippedNoModel++; continue; }

    const priceRaw = r[priceCol];
    const price = typeof priceRaw === 'number' ? priceRaw : parseFloat(String(priceRaw || '').replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(price) || price <= 0) { skippedNoPrice++; continue; }

    items.push({
      category: sheetName.trim(),
      series: currentSeries,
      model,
      articleCode: codeCol !== -1 ? String(r[codeCol] || '').trim() : '',
      price,
    });
  }

  console.log(`  "${sheetName}": ${items.length} позиций (без модели: ${skippedNoModel}, без цены: ${skippedNoPrice})`);
  return items;
}

export function parseOldPrice() {
  if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error(`Файл не найден: ${SOURCE_FILE}`);
  }

  const wb = XLSX.readFile(SOURCE_FILE);
  const hiddenSheets = new Set(
    (wb.Workbook?.Sheets || []).filter((s) => s.Hidden).map((s) => s.name)
  );

  const all = [];
  for (const sheetName of wb.SheetNames) {
    if (SKIP_SHEETS.has(sheetName.trim()) || hiddenSheets.has(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    all.push(...parseSheet(sheetName, rows));
  }

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(all, null, 2), 'utf8');
  console.log(`Готово: ${all.length} позиций → ${path.relative(process.cwd(), OUTPUT_FILE)}`);
  return all;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  parseOldPrice();
}
