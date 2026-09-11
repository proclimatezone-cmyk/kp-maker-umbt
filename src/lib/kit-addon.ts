/**
 * Надбавка «база → комплект» — тот же принцип, что при добавлении позиций
 * «под заказ» в сентябре 2026 (см. git log src/data/products.json той
 * недели): кассетный блок VRF/ATOM продаётся с декоративной панелью,
 * канальный/напольно-потолочный фанкойл — с проводным пультом. Цифры —
 * не формула, а фактические цены аксессуаров из прайса владельца
 * (T-MBQ1-.../T-MBQ4-... панели, KJRP-* пульты), тарифицированные по типу и
 * мощности блока.
 *
 * Раньше эта логика жила только в разовых скриптах синхронизации цен
 * (src/scripts/sync-master-price.mjs) — «Старая цена» в интерфейсе брала
 * old-price.json как есть, без надбавки, и сравнивала цену КОМПЛЕКТА с
 * ценой ГОЛОГО вентилятора: маржа завышалась ровно на стоимость панели/
 * пульта (напр. +40% вместо реальных ~10-15%). Вынесено сюда, чтобы
 * использовалось и в price-comparison.ts, и (при следующей сверке) в
 * sync-master-price.mjs — одна точка правды вместо двух копий формулы.
 */

/** Панель VRF/ATOM кассеты по мощности (кВт) и типу (1-поточная/4-поточная/компакт). */
function vrfPanelAddon(category: string, series: string, capacityKw: number | undefined): number {
  const text = `${category} ${series}`.toLowerCase();
  if (!/кассет/.test(text)) return 0;
  if (!capacityKw) return 0;
  if (/компакт|q4c/.test(text)) return 99;
  if (/1-поточ|1х-поточ|q1\b/.test(text)) {
    if (capacityKw <= 2.2) return 83;
    if (capacityKw <= 3.6) return 90;
    return 128;
  }
  if (/4-поточ|4х-поточ|2х-поточ|q4\b|q2\b/.test(text)) {
    return capacityKw >= 16 ? 209 : 146;
  }
  return 0;
}

/** Пульт гидравлических (водяных) кассетных фанкойлов MKA/MKD — по под-линейке. */
const FCU_CASSETTE_ADDON: Record<string, number> = { MKAR: 121, MKAF: 119, MKD: 87, MKDS: 75, MKCR: 120, MKCF: 118 };

/** Пульт канальных (MKT3/MKT3H — 2-х трубные, MKT4 — 4-х трубные) и напольно-потолочных (MKH1/MKH2) фанкойлов. */
function fcuRemoteAddon(model: string, category: string): number {
  const m = model.toUpperCase();
  if (/^MKA-|^MKD-|^MKC-/.test(m)) {
    const match = m.match(/^([A-Z]+)-?\d+([A-Z]*)/);
    const key = match ? match[1] + (match[2] || '') : '';
    return FCU_CASSETTE_ADDON[key] ?? 0;
  }
  if (/^MKH[12]-/.test(m)) return 88; // напольно-потолочный, всегда с пультом
  if (/^MKT3H?-/.test(m)) return 62; // канальный 2-х трубный (KJRP-86I/MFK-E)
  if (/^MKT4-/.test(m)) return 77; // канальный 4-х трубный (KJRP-86A/BMFNKD-E)
  return 0;
}

/**
 * Надбавка база→комплект для модели. capacityKw нужен только для панелей
 * VRF/ATOM кассет (там тариф зависит от мощности) — фанкойлам не нужен,
 * у них надбавка зависит только от типа/под-линейки.
 */
export function getKitAddon(model: string, category: string, series: string, capacityKw?: number): number {
  if (!model) return 0;
  const fcu = fcuRemoteAddon(model, category);
  if (fcu > 0) return fcu;
  return vrfPanelAddon(category, series, capacityKw);
}
