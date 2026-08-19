#!/usr/bin/env node
/**
 * Сопоставляет позиции прайса (products.json) с текущим прайсом ЗАВОДА
 * Midea («Midea CAC на СКЛАДЕ» в таблице
 * 13BsDZMZHMwUCqvPmEoJH6fBQ34sgwkLnpEkvn3tCgO8) — не путать со «Старой
 * ценой» (это отдельный статичный прайс-лист от 03.08.2026, см.
 * parse-old-price.mjs). Здесь — тот же бренд, та же таблица, где и Welkin,
 * но колонка «Цена конечная за нал» без привязки к чужому бренду: точное
 * совпадение по артикулу, других способов сопоставления не нужно.
 *
 * Только позиции «в наличии» — «под ЗАКАЗ» сознательно не берём (см. то
 * же решение для Welkin).
 *
 * Результат — src/data/midea-cac-match.json, статический файл (как
 * old-price.json/welkin-match.json), в рантайме таблица не читается.
 * Перезапускать вручную:
 *   node src/scripts/sync-midea-cac.mjs
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
const TAB = 'Midea CAC на СКЛАДЕ';

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

/** Копия stockKey() из lib/stock-match.ts — см. пояснение в sync-welkin.mjs. */
function stockKey(value) {
  const key = (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^MIDEAV\d/.test(key) ? key.replace(/^MIDEA/, 'MDV') : key;
}

function parsePrice(raw) {
  const n = parseFloat(String(raw || '').replace(/\s| /g, '').replace(',', '.'));
  return isFinite(n) && n > 0 ? n : null;
}

async function main() {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${TAB}'!A7:L2000`,
  });
  const rows = res.data.values || [];

  const productsPath = path.join(ROOT, 'src', 'data', 'products.json');
  const products = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
  const byKey = new Map(products.map(p => [stockKey(p.model), p]));

  const match = {};
  let matched = 0;
  for (const row of rows) {
    // Ячейка «Модель» иногда содержит связку «блок / пульт» через слэш —
    // берём основную позицию (первую).
    const cell = String(row[1] || '').trim();
    if (!cell) continue;
    const price = parsePrice(row[10]);
    if (!price) continue;

    const primary = cell.split('/')[0].trim();
    const key = stockKey(primary);
    const product = byKey.get(key);
    if (!product) continue;

    match[product.model] = { priceUsd: price };
    matched++;
  }

  const outPath = path.join(ROOT, 'src', 'data', 'midea-cac-match.json');
  fs.writeFileSync(outPath, JSON.stringify(match, null, 2), 'utf-8');
  console.log(`Midea CAC: ${rows.length} строк в листе, сопоставлено точно по артикулу — ${matched}`);
  console.log(`Записано: ${outPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
