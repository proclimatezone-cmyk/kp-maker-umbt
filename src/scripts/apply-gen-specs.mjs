import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const specs = JSON.parse(fs.readFileSync(path.join(root, 'src/data/gen-specs.json'), 'utf8'));
const norm = s => String(s || '').toUpperCase().replace(/[\s()]/g, '');
const GEN = /чиллер|тепловой насос|наруж|внеш/i;
const close = (a, b) => Math.abs(a - b) / Math.max(a, b) <= 0.1;

/** ТТХ источников холода/тепла из каталогов. Запись с расхождением мощности >10% с прайсом считаем сдвигом колонок и не берём. */
export function applyGenSpecs(products) {
  let n = 0, rejected = 0;
  for (const p of products) {
    if (!GEN.test(p.category || '')) continue;
    const s = specs[norm(p.model)];
    if (!s) continue;
    const cool = parseFloat(s.coolKw), heat = parseFloat(s.heatKw);
    // ГВС-насосы только греют: в прайсе их нагрев стоит в колонке холода.
    if (!cool && heat && /ГВС|бассейн/i.test(p.category || '') && p.coolingCapacity && close(heat, p.coolingCapacity)) {
      p.heatingCapacity = p.heatingCapacity || heat;
      p.coolingCapacity = 0;
    }
    if ((cool && p.coolingCapacity && !close(cool, p.coolingCapacity)) || (heat && p.heatingCapacity && !close(heat, p.heatingCapacity))) { rejected++; continue; }
    const { model, catalogKey, page, ...rest } = s;
    p.genSpec = rest;
    p.genSpecSource = { catalogKey, page };
    if (!p.heatingCapacity && heat) p.heatingCapacity = heat;
    if (!p.coolingCapacity && cool) p.coolingCapacity = cool;
    n++;
  }
  return { n, rejected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = path.join(root, 'src/data/products.json');
  const products = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = applyGenSpecs(products);
  fs.writeFileSync(file, JSON.stringify(products, null, 2) + '\n');
  console.log(`Источники: ТТХ у ${r.n}, отклонено ${r.rejected}`);
}
