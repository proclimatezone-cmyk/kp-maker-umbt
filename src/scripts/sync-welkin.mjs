#!/usr/bin/env node
/**
 * Сопоставляет позиции прайса (products.json) с конкурентным брендом Welkin.
 * Источник — таблица 13BsDZMZHMwUCqvPmEoJH6fBQ34sgwkLnpEkvn3tCgO8, только
 * то, что «в наличии» (не «под ЗАКАЗ»: не тот ориентир для сравнения на месте).
 *
 * Два разных прохода, по приоритету:
 *
 * 1) Welkin by Midea (лист «welkin. CAC на СКЛАДЕ - НОВЫЙ сток») — это
 *    перепродажа ТОГО ЖЕ железа Midea под маркой Welkin, в таблице есть
 *    прямая колонка «Маркировка Midea» с настоящим артикулом. Точное
 *    совпадение по артикулу — самое надёжное, что тут есть.
 * 2) Welkin by Hisense (лист «Welkin CAC by HS на СКЛАДЕ») — чужое железо
 *    (Hisense OEM), общего артикула нет, только приблизительный аналог по
 *    ближайшей холодопроизводительности внутри класса оборудования.
 *    Используется только для того, чего нет в (1).
 *
 * Результат — src/data/welkin-match.json со полем source ('midea-exact' |
 * 'hisense-approx'), статический файл (как old-price.json), в рантайме
 * таблица не читается. Перезапускать вручную:
 *   node src/scripts/sync-welkin.mjs
 */
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { fileURLToPath, pathToFileURL } from 'url';

if (!process.env.GOOGLE_CLIENT_ID) {
  const { config } = await import('dotenv');
  config({ path: '.env.local' });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

const SHEET_ID = '13BsDZMZHMwUCqvPmEoJH6fBQ34sgwkLnpEkvn3tCgO8';
const MIDEA_TAB = 'welkin. CAC на СКЛАДЕ - НОВЫЙ сток';
const HISENSE_TAB = 'Welkin CAC by HS на СКЛАДЕ';

// Насколько далеко (в % от нужной мощности) допускаем ближайшее совпадение
// по мощности (только для прохода Hisense) — дальше это уже не «примерный
// аналог», а два разных класса оборудования.
const MAX_DELTA_PCT = 20;

function getGoogleAuth() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  }
  const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN?.trim() });
  return oauth2Client;
}

/**
 * Ключ сопоставления — копия stockKey() из lib/stock-match.ts (не
 * импортируем: скрипт выполняется node'ом напрямую, без TS-транспиляции).
 * MIDEA→MDV — серия ATOM в прайсе КП подписана «Midea-V…» (маркетинг), а
 * в инвентаризации и в этой самой Welkin-таблице — «MDV-V…».
 */
function stockKey(value) {
  const key = (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^MIDEAV\d/.test(key) ? key.replace(/^MIDEA/, 'MDV') : key;
}

function parsePrice(raw) {
  const n = parseFloat(String(raw || '').replace(/\s| /g, '').replace(',', '.'));
  return isFinite(n) && n > 0 ? n : null;
}

// --- Проход 1: Welkin by Midea, точное совпадение по артикулу ---

async function matchMideaExact(sheets, byKey) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${MIDEA_TAB}'!A7:O2000`,
  });
  const rows = res.data.values || [];

  const match = {};
  let matched = 0;
  for (const row of rows) {
    // Ячейка «Маркировка Midea» иногда содержит связку «блок / панель»
    // через слэш — берём основную позицию (первую).
    const mideaCell = String(row[1] || '').trim();
    if (!mideaCell) continue;
    const price = parsePrice(row[13]);
    if (!price) continue;

    const primary = mideaCell.split('/')[0].trim();
    const key = stockKey(primary);
    const product = byKey.get(key);
    if (!product) continue;

    match[product.model] = {
      welkinModel: String(row[2] || row[3] || '').trim(),
      priceUsd: price,
      source: 'midea-exact',
      deltaPct: 0,
    };
    matched++;
  }
  console.log(`Welkin by Midea: ${rows.length} строк в листе, точных совпадений по артикулу — ${matched}`);
  return match;
}

// --- Проход 2: Welkin by Hisense, приблизительно по мощности внутри класса ---

function classifyWelkinSeries(series) {
  const s = (series || '').toLowerCase();
  if (s.includes('hi-flexi') || s.includes('mini odu')) return 'vrf-outdoor';
  if (s.includes('1-way cassette')) return 'cassette-1way';
  if (s.includes('4-way cassette') || s.includes('4-way casset')) return 'cassette-4way';
  if (s.includes('wall mounted')) return 'wall';
  if (s.includes('ceiling ducted')) return 'duct';
  if (s.includes('chiller')) return 'chiller';
  return null;
}

function classifyMideaCategory(category) {
  const c = (category || '').toLowerCase();
  if (c.includes('чиллер')) return 'chiller';
  if (!c.includes('vrf') && !c.includes('atom') && !c.includes('mini-vrf')) return null;
  if (c.includes('наружный') || c.includes('компрессорно-конденсаторный')) return 'vrf-outdoor';
  if (c.includes('кассетный 4х-поточный') || c.includes('кассетный комплект')) return 'cassette-4way';
  if (c.includes('кассетный 1-поточный')) return 'cassette-1way';
  if (c.includes('настенный')) return 'wall';
  if (c.includes('канальный')) return 'duct';
  return null;
}

function parseKw(raw) {
  const n = parseFloat(String(raw || '').replace(',', '.').replace(/\s/g, ''));
  return isFinite(n) && n > 0 ? n : null;
}

/** У чиллеров Hisense колонка «Capacity (KW)» пустая — мощность зашита в код модели («HFRE-65W/A2F» → 65). */
function parseKwFromModel(model) {
  const m = String(model || '').match(/-(\d{2,4})[A-Za-z]/);
  const n = m ? parseInt(m[1], 10) : NaN;
  return isFinite(n) && n > 0 ? n : null;
}

async function matchHisenseApprox(sheets, products, alreadyMatched) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${HISENSE_TAB}'!A1:H1000`,
  });
  const rows = res.data.values || [];

  const pool = [];
  let currentSeries = '';
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (row[0]) currentSeries = row[0];
    const cls = classifyWelkinSeries(currentSeries);
    if (!cls) continue;
    const kw = parseKw(row[3]) || (cls === 'chiller' ? parseKwFromModel(row[1]) : null);
    const price = parsePrice(row[7]);
    if (!kw || !price) continue;
    pool.push({ class: cls, hisenseModel: row[1] || '', welkinModel: row[2] || '', kw, price });
  }

  const match = {};
  let matched = 0;
  for (const p of products) {
    if (alreadyMatched.has(p.model)) continue; // точный матч по Midea важнее
    if (String(p.model || '').includes(' + ')) continue; // комплекты — см. описание в шапке файла

    const cls = classifyMideaCategory(p.category);
    if (!cls) continue;
    const kw = Number(p.coolingCapacity) || 0;
    if (!kw) continue;

    const candidates = pool.filter(r => r.class === cls);
    let best = null, bestDelta = Infinity;
    for (const c of candidates) {
      const delta = Math.abs(c.kw - kw) / kw * 100;
      if (delta < bestDelta) { bestDelta = delta; best = c; }
    }
    if (!best || bestDelta > MAX_DELTA_PCT) continue;

    match[p.model] = {
      welkinModel: best.welkinModel,
      hisenseModel: best.hisenseModel,
      priceUsd: best.price,
      source: 'hisense-approx',
      deltaPct: Math.round(bestDelta * 10) / 10,
    };
    matched++;
  }
  console.log(`Welkin by Hisense: ${pool.length} строк с мощностью и ценой, приблизительных совпадений — ${matched}`);
  return match;
}

async function main() {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });

  const productsPath = path.join(ROOT, 'src', 'data', 'products.json');
  const products = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
  const byKey = new Map(products.map(p => [stockKey(p.model), p]));

  const mideaMatch = await matchMideaExact(sheets, byKey);
  const hisenseMatch = await matchHisenseApprox(sheets, products, new Set(Object.keys(mideaMatch)));

  const match = { ...hisenseMatch, ...mideaMatch };

  const outPath = path.join(ROOT, 'src', 'data', 'welkin-match.json');
  fs.writeFileSync(outPath, JSON.stringify(match, null, 2), 'utf-8');
  console.log(`Итого сопоставлено: ${Object.keys(match).length} (точных — ${Object.keys(mideaMatch).length}, приблизительных — ${Object.keys(hisenseMatch).length})`);
  console.log(`Записано: ${outPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
