import { google } from 'googleapis';

/**
 * Сверяет цены в листе «для кп» с эталонным прайсом владельца —
 * https://docs.google.com/spreadsheets/d/1F1BooKFUs41IilaM6NtEiqMivU4-2wjo2U6nAh0gEKU
 * (вкладки V8, Atom, VRF, FCU-Duct, FCU-other, FCUCassette, DC 2-4-Pipe FCU,
 * Modular chiller, Heat Pump — «кассовые»/конечные
 * цены Midea, уже без путаницы из нескольких колонок оригинального прайса).
 *
 * Логика (подтверждена владельцем 06.09.2026):
 *  - обычная позиция (наружный блок, канальный, напольно-потолочный с уже
 *    включённым пультом и т.п.) — цена берётся как есть, сверху ничего не
 *    накручиваем;
 *  - кассетная позиция (внутренний блок VRF/ATOM с видимой декоративной
 *    панелью) — цена = цена вентилятора + цена панели (панели в прайсе
 *    отдельными строками (модели вида T-MBQ.../MBQ...), наценка тарифицирована по мощности,
 *    см. vrfPanelAddon) — «комплект», как менеджер и продаёт;
 *  - фанкойлы (вода, MKA/MKD) используют уже подтверждённые за сессию
 *    константы наценки на панель по под-линейке (fcuAddonMap) — они не
 *    выводятся из этого прайса напрямую (панели там кодами модели, не по
 *    мощности), но проверены по факту на уже существующих ценах в «для кп».
 *
 * ВАЖНО: этот скрипт НЕ встроен в обычный sync-sheets.mjs/`Обновить базу`
 * (то, что менеджеры жмут в интерфейсе) — намеренно. Тот путь только читает
 * «для кп» и не должен без спроса переписывать цены в самом листе. Этот
 * скрипт запускает владелец сам, когда обновил мастер-прайс.
 *
 * Запуск: node src/scripts/sync-master-price.mjs
 * После — обычный sync-sheets.mjs, чтобы обновить products.json.
 */

const MASTER_PRICE_ID = '1F1BooKFUs41IilaM6NtEiqMivU4-2wjo2U6nAh0gEKU';
const MASTER_TABS = ['V8', 'Atom', 'VRF', 'FCU-Duct', 'FCU-other', 'FCUCassette', 'DC 2-4-Pipe FCU', 'Modular chiller', 'Heat Pump (копия)'];
const CATALOG_ID = '1O5aeKAbSc_UkDk7expSqaDO5dpUaQLyqWI40Vhp4MhE';
const CATALOG_TAB = 'для кп';

if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
}

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function norm(s) { return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function parseCapacity(s) {
  const n = parseFloat(String(s || '').replace(',', '.').trim());
  return isNaN(n) ? null : n;
}
function looksLikeRealModel(model) {
  // Отсекаем мусор парсинга (характеристики питания, названия секций и
  // подстрочные пояснения, которые из-за объединённых ячеек попадают в
  // колонку модели) — реальный код Midea всегда содержит цифру и не похож
  // на текст про напряжение/частоту.
  return /\d/.test(model) && !/Hz|~|V\s*$/.test(model) && model.length >= 4;
}
function isAccessoryModel(model) {
  return /^T?-?MBQ|^KJRP|^KJR-|^DXFQT|^VCCUKZ|^CE-FCUKZ|^CCM-|^HRV-|^T-|^WFS-/i.test(model);
}

/** Наценка на декоративную панель VRF/ATOM кассеты — тарифицирована по мощности (кВт). */
function vrfPanelAddon(group, capacity) {
  const g = (group || '').toLowerCase();
  if (!capacity) return 0;
  if (/q1|one-way cassette/.test(g)) {
    if (capacity <= 2.2) return 83;
    if (capacity <= 3.6) return 90;
    return 128;
  }
  if (/compact four-way|q4c/.test(g)) return 99;
  if (/q4|four-way cassette/.test(g)) return capacity >= 16 ? 209 : 146;
  return 0;
}

/** Наценка на панель гидравлических (водяных) кассетных фанкойлов MKA/MKD — по под-линейке. */
const FCU_ADDON = { MKAR: 121, MKAF: 119, MKD: 87, MKDS: 75, MKCR: 120, MKCF: 118 };

async function fetchMasterRows(sheets) {
  const all = [];
  for (const tab of MASTER_TABS) {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: MASTER_PRICE_ID, range: `'${tab}'!A1:F1000` });
    const rows = resp.data.values || [];
    let group = '';
    for (let i = 2; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;
      if (r[0]) group = r[0].trim();
      const model = (r[1] || '').trim();
      const price = parseFloat((r[5] || '').replace(/[^0-9.]/g, '')) || 0;
      const capacity = parseCapacity(r[4]);
      if (!model || !price || !looksLikeRealModel(model) || isAccessoryModel(model)) continue;
      all.push({ tab, group, model, capacity, price });
    }
  }
  return all;
}

function computeKitPrice(row) {
  if (row.tab === 'FCUCassette') {
    const mm = row.model.match(/^([A-Z]+)-?\d+([A-Z]*)/);
    const key = mm ? mm[1] + (mm[2] || '') : '';
    return row.price + (FCU_ADDON[key] || 0);
  }
  const g = row.group.toLowerCase();
  if (/cassette/.test(g) && !/ceiling|floor/.test(g)) {
    return row.price + vrfPanelAddon(g, row.capacity);
  }
  return row.price;
}

async function main() {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });

  console.log('Читаю эталонный прайс...');
  const masterRows = await fetchMasterRows(sheets);
  console.log(`  ${masterRows.length} позиций`);

  console.log('Читаю каталог «для кп»...');
  const catalogResp = await sheets.spreadsheets.values.get({
    spreadsheetId: CATALOG_ID,
    range: `'${CATALOG_TAB}'!A1:Y1008`,
  });
  const catalog = catalogResp.data.values || [];

  const updates = [];
  for (const m of masterRows) {
    const key = norm(m.model);
    const idx = catalog.findIndex(r => norm(r[2] || '') === key);
    if (idx === -1) continue;
    const kitPrice = computeKitPrice(m);
    const curPrice = parseFloat((catalog[idx][21] || '').replace(/[^0-9.]/g, '')) || 0;
    if (curPrice === kitPrice) continue;
    updates.push({ row: idx + 1, model: m.model, curPrice, newPrice: kitPrice });
  }

  console.log(`Найдено расхождений: ${updates.length}`);
  if (updates.length === 0) { console.log('Всё уже в порядке.'); return; }

  updates.forEach(u => console.log(`  ${u.model}: ${u.curPrice} -> ${u.newPrice}`));

  const data = updates.map(u => ({ range: `'${CATALOG_TAB}'!V${u.row}`, values: [[u.newPrice]] }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: CATALOG_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
  console.log(`Обновлено ${updates.length} цен. Теперь запусти: node src/scripts/sync-sheets.mjs`);
}

main().catch(err => { console.error('Ошибка сверки цен:', err); process.exit(1); });
