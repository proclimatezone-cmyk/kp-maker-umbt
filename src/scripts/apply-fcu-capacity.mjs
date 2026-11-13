import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const caps = JSON.parse(fs.readFileSync(path.join(root, 'src/data/fcu-capacity.json'), 'utf8'));

const r2 = n => Math.round(n * 100) / 100;

function candidates(model) {
  const base = String(model || '').split('+')[0].replace(/\(A\)/g, '').replace(/\s+/g, '').toUpperCase();
  const out = [base, base.replace(/-CR$/, '-CL'), base.replace(/EG(\d+)$/, 'G$1')];
  // Канальные: производительность не зависит от статического напора (G12/G30/G50)
  const cl = base.replace(/-CR$/, '-CL');
  for (const g of ['G12', 'G30', 'G50']) out.push(cl.replace(/G(12|30|50)(-C[LR])$/, `${g}$2`));
  return [...new Set(out)];
}

export function applyFcuCapacity(products) {
  let n = 0;
  for (const p of products) {
    if (!/фанкойл/i.test(`${p.category} ${p.name}`)) continue;
    const key = candidates(p.model).find(k => caps[k] && caps[k].coolMid);
    if (!key) continue;
    const c = caps[key];
    p.coolingCapacity = r2(c.coolMid);
    p.coolingCapacityMax = r2(c.coolMax);
    if (c.heatMid) { p.heatingCapacity = r2(c.heatMid); p.heatingCapacityMax = r2(c.heatMax); }
    p.capacityNote = 'средняя скорость вентилятора, каталог Midea FCU';
    p.catalogKey = 'fcu-2026';
    p.catalogPage = c.page;
    p.catalogModel = key;
    // Для кассет вторая строка «Габариты/Масса» — декоративная панель; такие значения не берём.
    const panel = c.dims && Number(String(c.dims).split('×')[1]) < 100;
    p.fcuSpec = {
      waterFlow: c.waterFlow, waterDp: c.waterDp, powerW: c.powerW, airflow: c.airflow, noise: c.noise,
      dims: panel ? undefined : c.dims, weight: panel ? undefined : c.weight, options: c.options, kitRemote: c.kitRemote, panel: c.panel,
    };
    n++;
  }
  return n;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = path.join(root, 'src/data/products.json');
  const products = JSON.parse(fs.readFileSync(file, 'utf8'));
  const n = applyFcuCapacity(products);
  fs.writeFileSync(file, JSON.stringify(products, null, 2) + '\n');
  console.log(`FCU: обновлено ${n} позиций`);
}
