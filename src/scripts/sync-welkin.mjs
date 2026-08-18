#!/usr/bin/env node
/**
 * Сопоставляет позиции прайса (products.json) с конкурентным прайсом Welkin
 * (Hisense OEM) по ближайшей холодопроизводительности внутри одного класса
 * оборудования — общего артикула у брендов нет, только приблизительное
 * соответствие по мощности. Источник — таблица
 * 13BsDZMZHMwUCqvPmEoJH6fBQ34sgwkLnpEkvn3tCgO8, лист «Welkin CAC by HS на
 * СКЛАДЕ» (только то, что в наличии — «под ЗАКАЗ» сознательно не берём:
 * не тот ориентир для быстрого сравнения на месте).
 *
 * Результат — src/data/welkin-match.json, статический файл (как
 * old-price.json), в рантайме таблица не читается. Перезапускать вручную:
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
const TAB = 'Welkin CAC by HS на СКЛАДЕ';

// Насколько далеко (в % от нужной мощности) допускаем ближайшее совпадение —
// дальше это уже не «примерный аналог», а два разных класса оборудования.
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

/** Класс оборудования Welkin по названию серии (колонка A, смёржена на группу строк). */
function classifyWelkinSeries(series) {
  const s = (series || '').toLowerCase();
  if (s.includes('hi-flexi') || s.includes('mini odu')) return 'vrf-outdoor';
  if (s.includes('1-way cassette')) return 'cassette-1way';
  if (s.includes('4-way cassette') || s.includes('4-way casset')) return 'cassette-4way';
  if (s.includes('wall mounted')) return 'wall';
  if (s.includes('ceiling ducted')) return 'duct';
  return null;
}

/** Класс оборудования Midea по тексту категории — см. products.json. */
function classifyMideaCategory(category) {
  const c = (category || '').toLowerCase();
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

function parsePrice(raw) {
  const n = parseFloat(String(raw || '').replace(/\s| /g, '').replace(',', '.'));
  return isFinite(n) && n > 0 ? n : null;
}

async function main() {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${TAB}'!A1:H1000`,
  });
  const rows = res.data.values || [];

  // Колонка A — смёржена на группу строк (та же раскладка, что и везде в
  // этих таблицах): заполнена только на первой строке серии.
  const pool = []; // { class, hisenseModel, welkinModel, kw, price }
  let currentSeries = '';
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (row[0]) currentSeries = row[0];
    const cls = classifyWelkinSeries(currentSeries);
    if (!cls) continue;
    const kw = parseKw(row[3]);
    const price = parsePrice(row[7]);
    if (!kw || !price) continue;
    pool.push({ class: cls, hisenseModel: row[1] || '', welkinModel: row[2] || '', kw, price });
  }

  console.log(`Welkin: разобрано ${pool.length} строк с мощностью и ценой из «${TAB}»`);
  const byClass = {};
  for (const r of pool) byClass[r.class] = (byClass[r.class] || 0) + 1;
  console.log('По классам:', JSON.stringify(byClass));

  const productsPath = path.join(ROOT, 'src', 'data', 'products.json');
  const products = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));

  const match = {};
  let matched = 0, skippedNoClass = 0, skippedNoCapacity = 0, skippedTooFar = 0;

  let skippedKit = 0;
  for (const p of products) {
    // Комплекты «внутренний + наружный» стоят как пара, а сопоставить есть
    // возможность только один компонент (по мощности наружного блока) —
    // сравнение «цена пары» vs «цена одного блока Welkin» врёт (+100% и
    // больше на ровном месте). Честнее не показывать вовсе.
    if (String(p.model || '').includes(' + ')) { skippedKit++; continue; }

    const cls = classifyMideaCategory(p.category);
    if (!cls) { skippedNoClass++; continue; }

    const kw = Number(p.coolingCapacity) || 0;
    if (!kw) { skippedNoCapacity++; continue; }

    const candidates = pool.filter(r => r.class === cls);
    if (!candidates.length) { skippedNoClass++; continue; }

    let best = null, bestDelta = Infinity;
    for (const c of candidates) {
      const delta = Math.abs(c.kw - kw) / kw * 100;
      if (delta < bestDelta) { bestDelta = delta; best = c; }
    }
    if (!best || bestDelta > MAX_DELTA_PCT) { skippedTooFar++; continue; }

    match[p.model] = {
      welkinModel: best.welkinModel,
      hisenseModel: best.hisenseModel,
      priceUsd: best.price,
      matchedKw: best.kw,
      productKw: kw,
      deltaPct: Math.round(bestDelta * 10) / 10,
    };
    matched++;
  }

  const outPath = path.join(ROOT, 'src', 'data', 'welkin-match.json');
  fs.writeFileSync(outPath, JSON.stringify(match, null, 2), 'utf-8');
  console.log(`Сопоставлено: ${matched}. Без класса: ${skippedNoClass}. Без мощности: ${skippedNoCapacity}. Слишком далеко (>${MAX_DELTA_PCT}%): ${skippedTooFar}. Комплекты (пропущены намеренно): ${skippedKit}.`);
  console.log(`Записано: ${outPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
