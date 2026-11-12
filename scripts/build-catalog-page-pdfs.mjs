// Нарезает нужные страницы каталогов в public/catalog-pages/<key>/<page>.pdf (ТТХ открывается сразу, без 20-МБ каталога).
// Запуск: node scripts/build-catalog-page-pdfs.mjs   (каталоги из CATALOGS_DIR)
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = process.env.CATALOGS_DIR || '/Users/muhammadjonaka/MN OG MAC v/каталоги';
const sources = JSON.parse(fs.readFileSync(path.join(root, 'src/data/catalog-sources.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(root, 'src/data/catalog-pages.json'), 'utf8')).products;
const products = JSON.parse(fs.readFileSync(path.join(root, 'src/data/products.json'), 'utf8'));

const want = new Map();
const add = (k, p) => { if (k && p) (want.get(k) || want.set(k, new Set()).get(k)).add(p); };
for (const m of Object.values(index)) add(m.catalogKey, m.page);
for (const p of products) add(p.catalogKey, p.catalogPage);

for (const [key, pages] of want) {
  const file = path.join(dir, sources[key].filename);
  const src = await PDFDocument.load(fs.readFileSync(file), { updateMetadata: false });
  const outDir = path.join(root, 'public/catalog-pages', key);
  fs.mkdirSync(outDir, { recursive: true });
  for (const page of pages) {
    const doc = await PDFDocument.create();
    const [pg] = await doc.copyPages(src, [page - 1]);
    doc.addPage(pg);
    doc.setTitle(`${sources[key].title} — стр. ${page}`);
    fs.writeFileSync(path.join(outDir, `${page}.pdf`), await doc.save());
  }
  console.log(key, pages.size, 'стр.');
}
