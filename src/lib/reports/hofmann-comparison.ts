import hofmannData from '@/data/hofmann-price.json';

/**
 * Сравнение с конкурентом Hofmann Air. Общего артикула нет — аналог
 * подбирается по классу оборудования и ближайшей мощности (кВт).
 *
 * Классы наружных блоков VRF (как их позиционирует сам рынок):
 *  - HMV Mini            ↔ ATOM (мини-VRF);
 *  - HMV Slim / Flex     ↔ боковой выброс, кроме ATOM: V8 Easyfit, V6-i, V8 Mini, Mini C;
 *  - HMV X               ↔ вертикальный (верхний) выброс: V8 Master, V8S, V6R.
 * Внутренние блоки, фанкойлы и чиллеры — по типу (кассета 1/2/4 потока,
 * канальный, настенный…) и мощности.
 *
 * Цены Hofmann — статический файл src/data/hofmann-price.json (переносятся
 * вручную с прайс-картинок). Здесь только join с текущим прайсом сайта.
 */

type HofmannClass = keyof typeof hofmannData.classes;
type HofmannItem = [number, number, string?];

// Дальше этого (в % от нашей мощности) — уже не аналог, а другой типоразмер.
// Как у Welkin: до 20 %, точность сопоставления показывается в отчёте.
const MAX_DELTA_PCT = 20;

interface CurrentProduct {
  model: string;
  category?: string;
  series?: string;
  price: number;
  coolingCapacity?: number;
  orderOnly?: boolean;
}

export interface HofmannComparisonRow {
  model: string;
  category: string;
  ourKw: number;
  hofmannClass: string;
  hofmannModel: string;
  hofmannKw: number;
  ourPrice: number;
  hofmannPrice: number;
  deltaAbs: number;
  deltaPct: number;
  /** Разница мощностей в % (0 — тот же типоразмер). */
  matchDeltaPct: number;
  /** Позиция «под заказ» у нас. */
  orderOnly: boolean;
  weAreMoreExpensive: boolean;
}

export interface HofmannComparisonReport {
  rows: HofmannComparisonRow[];
  matchedCount: number;
  weAreCheaperCount: number;
  weAreMoreExpensiveCount: number;
  avgDeltaPct: number | null;
  classes: string[];
  source: string;
}

/** К какому классу Hofmann относится наша позиция. null — аналога у Hofmann нет. */
export function hofmannClassFor(p: CurrentProduct): HofmannClass | null {
  const c = `${p.category || ''} ${p.series || ''}`;
  const m = p.model || '';
  if (/комплект|Quantum|Unitary|водяное охлаждение|VC MAX|VC-i|Rooftop|тепловог|ГВС|Панель|Пульт|рекуп/i.test(c)) return null;

  if (/Наружный блок/i.test(c)) {
    if (/ATOM/i.test(c)) return /ATOM T/i.test(c) ? null : 'outdoor_mini';
    if (/Easyfit|V6-i|mini-VRF|Mini C|боковой/i.test(c)) return 'outdoor_side';
    if (/V8 Master|V8S|V6R|Master|Ultra|Individual/i.test(c)) return 'outdoor_top';
    return null;
  }

  if (/^Фанкойл/i.test(c)) {
    if (/напольн/i.test(c)) return null; // у Hofmann напольных фанкойлов нет
    if (/высоконапорн/i.test(c)) return null;
    // «F» после типоразмера в модели (MKT4-300FG30, MKA-600F, MKD-300S) — 4-трубное
    // исполнение, даже если категория в прайсе подписана «2-х трубный».
    const fourPipe = /4[- х]*х? *трубн|4тр|4х труб/i.test(c) || /^MK[A-Z]\d?-V?\d{3,4}(F|S\b)/i.test(m);
    if (/кассетн/i.test(c)) return fourPipe ? 'fcu_cassette_4p' : 'fcu_cassette_2p';
    if (/канальн/i.test(c)) return fourPipe ? 'fcu_duct_4p' : 'fcu_duct_2p';
    return null;
  }

  if (/чиллер/i.test(c)) return /mini Chiller/i.test(c) ? null : 'chiller';
  if (/притоком свежего/i.test(c)) return 'fresh_air';

  if (/Внутренний/i.test(c)) {
    if (/2х-поточн|2-поток/i.test(c)) return 'cassette_2';
    if (/1-поточн|1 поток/i.test(c)) return 'cassette_1';
    if (/4х-поточн|4-поток|4х поток|кассетный блок .*компакт/i.test(c)) return 'cassette_4';
    if (/напольно-потолочн/i.test(c)) return 'floor_ceiling';
    if (/настенн/i.test(c)) return /чёрн|черн/i.test(c) || /-B$/.test(m) ? 'wall_black' : 'wall_white';
    if (/высоконапорн|средненапорн|High Static|ARC/i.test(c)) return 'duct_high';
    if (/канальн/i.test(c)) return 'duct_low';
  }
  return null;
}

/**
 * Мощность в кВт. В индексе модели она надёжнее, чем в колонке прайса
 * (там встречаются ошибки вроде 1.2 кВт у агрегата на 33.5): MIH22… → 2.2,
 * MV8i-252… → 25.2, MV8M-100… → 10. Иначе — колонка прайса; для фанкойлов
 * без мощности — типоразмер × 0.009 (MKT3-400 → 3.6, как у позиций с данными).
 */
export function capacityKw(p: CurrentProduct): number {
  const m = p.model || '';
  let r = m.match(/^MIH(\d{2,3})[A-Z]/i);
  if (r) return Number(r[1]) / 10;
  r = m.match(/^(?:MV8i|MV8|MV8S|MVi|MV6-R)-?R?(\d{3,4})W/i);
  if (r) return Number(r[1]) / 10;
  r = m.match(/^MV8M-(\d{2,3})W/i);
  if (r) return Number(r[1]) / 10;
  r = m.match(/^MDV-V(\d{2,3})W\/DHN1\(D\)/i);
  if (r) return Number(r[1]) / 10;
  // Канальные/компактные кассетные фанкойлы — по типоразмеру: в колонке
  // прайса у них встречаются явные ошибки (MKD-400S — «1.1 кВт»).
  r = m.match(/^MK[TCD]\d?H?-V?(\d{3,4})/i);
  if (r) return Math.round(Number(r[1]) * 0.009 * 10) / 10;
  const cap = Number(p.coolingCapacity) || 0;
  return cap > 0 ? cap : 0;
}

function nearest(items: HofmannItem[], kw: number): HofmannItem | null {
  let best: HofmannItem | null = null;
  for (const it of items) {
    if (!best || Math.abs(it[0] - kw) < Math.abs(best[0] - kw)) best = it;
  }
  return best;
}

export function computeHofmannComparison(currentProducts: CurrentProduct[]): HofmannComparisonReport {
  const classes = hofmannData.classes as unknown as Record<string, { label: string; items: HofmannItem[] }>;
  const rows: HofmannComparisonRow[] = [];
  const seen = new Set<string>();

  for (const p of currentProducts) {
    if (!p.price || !p.model || seen.has(p.model)) continue;
    const cls = hofmannClassFor(p);
    if (!cls) continue;
    const kw = capacityKw(p);
    if (!kw) continue;
    const spec = classes[cls];
    const hit = nearest(spec.items, kw);
    if (!hit) continue;
    const matchDeltaPct = Math.round((Math.abs(hit[0] - kw) / kw) * 1000) / 10;
    if (matchDeltaPct > MAX_DELTA_PCT) continue;
    seen.add(p.model);

    const [hKw, hPrice, sub] = hit;
    const deltaAbs = p.price - hPrice;
    rows.push({
      model: p.model,
      category: p.category || '',
      ourKw: kw,
      hofmannClass: spec.label,
      hofmannModel: `${sub || spec.label} ${hKw} кВт`,
      hofmannKw: hKw,
      ourPrice: p.price,
      hofmannPrice: hPrice,
      deltaAbs,
      deltaPct: hPrice > 0 ? (deltaAbs / hPrice) * 100 : 0,
      matchDeltaPct,
      orderOnly: !!p.orderOnly,
      weAreMoreExpensive: deltaAbs > 0,
    });
  }

  rows.sort((a, b) => b.deltaPct - a.deltaPct);
  const avg = rows.length ? rows.reduce((s, r) => s + r.deltaPct, 0) / rows.length : null;
  return {
    rows,
    matchedCount: rows.length,
    weAreCheaperCount: rows.filter(r => !r.weAreMoreExpensive).length,
    weAreMoreExpensiveCount: rows.filter(r => r.weAreMoreExpensive).length,
    avgDeltaPct: avg,
    classes: [...new Set(rows.map(r => r.hofmannClass))],
    source: hofmannData.source,
  };
}
