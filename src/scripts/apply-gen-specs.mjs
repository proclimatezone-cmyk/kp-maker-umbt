import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const specs = JSON.parse(fs.readFileSync(path.join(root, 'src/data/gen-specs.json'), 'utf8'));
// Сверенные вручную по таблицам каталогов — приоритетнее автоматического разбора.
const manual = JSON.parse(fs.readFileSync(path.join(root, 'src/data/gen-specs-manual.json'), 'utf8'));
const norm = s => String(s || '').toUpperCase().replace(/[\s()]/g, '');
const GEN = /чиллер|тепловой насос|наруж|внеш/i;
const close = (a, b) => Math.abs(a - b) / Math.max(a, b) <= 0.1;

/** ТТХ источников холода/тепла из каталогов. Запись с расхождением мощности >10% с прайсом считаем сдвигом колонок и не берём. */
export function applyGenSpecs(products) {
  let n = 0, rejected = 0;
  const mismatches = [];
  for (const p of products) {
    if (!GEN.test(p.category || '')) continue;
    const m = manual[p.model];
    const s = m || specs[norm(p.model)];
    if (!s) continue;
    const top = v => Math.max(...String(v || '').split('-').map(parseFloat).filter(Number.isFinite), 0);
    const cool = top(s.coolKw), heat = top(s.heatKw);
    // Тепловые насосы: в прайсе в колонке «холод» стоит номинальный нагрев (по нему названа модель).
    if (m && /тепловой насос/i.test(p.category || '') && heat && p.coolingCapacity && close(heat, p.coolingCapacity) && !p.heatingCapacity) {
      p.heatingCapacity = heat;
      p.coolingCapacity = /бассейн|ГВС/i.test(p.category || '') ? 0 : cool;
    }
    // ГВС-насосы только греют: в прайсе их нагрев стоит в колонке холода.
    if (!cool && heat && /ГВС|бассейн/i.test(p.category || '') && p.coolingCapacity && close(heat, p.coolingCapacity)) {
      p.heatingCapacity = p.heatingCapacity || heat;
      p.coolingCapacity = 0;
    }
    const mismatch = (cool && p.coolingCapacity && !close(cool, p.coolingCapacity)) || (heat && p.heatingCapacity && !close(heat, p.heatingCapacity));
    if (mismatch && !m) { rejected++; continue; }
    if (mismatch) mismatches.push(`${p.model}: прайс ${p.coolingCapacity}/${p.heatingCapacity}, каталог ${s.coolKw || '—'}/${s.heatKw || '—'}`);
    const { model, catalogKey, page, ...rest } = s;
    p.genSpec = rest;
    p.genSpecSource = { catalogKey, page };
    if (!p.heatingCapacity && heat) p.heatingCapacity = heat;
    if (!p.coolingCapacity && cool) p.coolingCapacity = cool;
    n++;
  }
  return { n, rejected, mismatches };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = path.join(root, 'src/data/products.json');
  const products = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = applyGenSpecs(products);
  fs.writeFileSync(file, JSON.stringify(products, null, 2) + '\n');
  console.log(`Источники: ТТХ у ${r.n}, отклонено ${r.rejected}`);
  if (r.mismatches.length) console.log('Расхождение мощности прайса и каталога:\n' + r.mismatches.join('\n'));
}
