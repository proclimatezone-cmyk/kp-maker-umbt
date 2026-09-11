import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Официальные названия позиций для спецификации договора — из реальных
 * таможенных инвойсов (invoice-finder.vercel.app), не из листа
 * «Состояние склада» (тот даёт короткие/неточные формулировки вроде
 * «VRF серии V8 Easy Fit наружний блок» вместо таможенной «Наружный блок
 * промышленной мультизональной VRF системы MV8-...»).
 *
 * Сайт закрыт HTTP Basic Auth, поиск — клиентский (без REST API, реального
 * запроса через curl не подсмотреть), поэтому гоняем headless Chrome.
 * Не встраивать в /api/contract напрямую: Vercel serverless не гарантирует
 * Chrome-бинарник (пакет пришлось бы тянуть через @sparticuz/chromium,
 * это отдельная работа и риск для прод-пути генерации договора). Разовый
 * скрипт — как old-price.json/sync-master-price.mjs: гоняется вручную,
 * результат — статический JSON в репозитории.
 *
 * Запуск: node src/scripts/scrape-invoice-names.mjs
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'invoice-names.json');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const AUTH = { username: 'midea', password: 'midea2026' };

function parseFirstDescription(bodyText, model) {
  const lines = bodyText.split('\n');
  const foundIdx = lines.findIndex(l => /^Найдено:/.test(l));
  if (foundIdx === -1) return null;
  const count = parseInt(lines[foundIdx].replace(/\D/g, ''), 10) || 0;
  if (count === 0) return null;

  // Первая строка с "/" после "Найдено:" — двуязычное описание
  // (русское/английское), делится этим же символом.
  for (let i = foundIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes('/') && line.toUpperCase().includes(model.toUpperCase().slice(0, 6))) {
      const ru = line.split('/')[0].trim();
      if (ru) return ru;
    }
  }
  return null;
}

async function main() {
  const productsPath = path.join(__dirname, '..', 'data', 'products.json');
  const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
  // Приоритет — позиции «в наличии»: реально продаются и завозятся, у
  // «под заказ» (свежедобавленных в сентябре 2026) инвойсной истории пока
  // физически быть не может.
  const models = [...new Set(products.filter(p => !p.orderOnly && p.model).map(p => p.model))];
  console.log(`Моделей к поиску: ${models.length}`);

  let existing = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    console.log(`Уже есть в кэше: ${Object.keys(existing).length}`);
  }

  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME_PATH });
  const page = await browser.newPage();
  await page.authenticate(AUTH);
  await page.goto('https://invoice-finder.vercel.app/', { waitUntil: 'networkidle0' });

  let found = 0, notFound = 0, skipped = 0;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    if (existing[model] !== undefined) { skipped++; continue; }

    try {
      const input = await page.$('input');
      await input.click({ clickCount: 3 });
      await input.type(model);
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 900));

      const bodyText = await page.evaluate(() => document.body.innerText);
      const name = parseFirstDescription(bodyText, model);
      existing[model] = name; // null тоже сохраняем — чтобы не искать заново то, чего там нет
      if (name) found++; else notFound++;
    } catch (err) {
      console.warn(`Ошибка на "${model}":`, err.message);
    }

    if ((i + 1) % 20 === 0 || i === models.length - 1) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 1));
      console.log(`[${i + 1}/${models.length}] найдено=${found} не найдено=${notFound} пропущено=${skipped}`);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 1));
  await browser.close();
  console.log(`Готово. Найдено=${found}, не найдено=${notFound}, пропущено=${skipped}`);
}

main().catch(err => { console.error(err); process.exit(1); });
