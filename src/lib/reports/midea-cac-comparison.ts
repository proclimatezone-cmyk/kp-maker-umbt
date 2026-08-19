import mideaCacMatchData from '@/data/midea-cac-match.json';

/**
 * Сравнение с текущим прайсом ЗАВОДА Midea («Midea CAC на СКЛАДЕ») — не
 * путать с «Старой ценой» (отдельный статичный прайс-лист от 03.08.2026).
 * Сопоставление посчитано офлайн (node src/scripts/sync-midea-cac.mjs),
 * точное совпадение по артикулу — тот же бренд, тот же каталог, гадать
 * не нужно. Здесь — только join с ТЕКУЩЕЙ ценой прайса.
 */

interface MideaCacMatch {
  priceUsd: number;
}

const mideaCacMatch = mideaCacMatchData as Record<string, MideaCacMatch>;

interface CurrentProduct {
  model: string;
  category?: string;
  price: number;
}

export interface MideaCacComparisonRow {
  model: string;
  category: string;
  ourPrice: number;
  mideaPrice: number;
  deltaAbs: number;
  deltaPct: number;
  /** true — мы дороже завода */
  weAreMoreExpensive: boolean;
}

export interface MideaCacComparisonReport {
  rows: MideaCacComparisonRow[];
  matchedCount: number;
  weAreCheaperCount: number;
  weAreMoreExpensiveCount: number;
  avgDeltaPct: number | null;
}

export function computeMideaCacComparison(currentProducts: CurrentProduct[]): MideaCacComparisonReport {
  const rows: MideaCacComparisonRow[] = [];

  for (const p of currentProducts) {
    const m = mideaCacMatch[p.model];
    if (!m || !p.price) continue;
    const deltaAbs = p.price - m.priceUsd;
    const deltaPct = m.priceUsd > 0 ? (deltaAbs / m.priceUsd) * 100 : 0;
    rows.push({
      model: p.model,
      category: p.category || '',
      ourPrice: p.price,
      mideaPrice: m.priceUsd,
      deltaAbs,
      deltaPct,
      weAreMoreExpensive: deltaAbs > 0,
    });
  }

  rows.sort((a, b) => b.deltaPct - a.deltaPct);

  const weAreMoreExpensiveCount = rows.filter((r) => r.weAreMoreExpensive).length;
  const weAreCheaperCount = rows.filter((r) => !r.weAreMoreExpensive).length;
  const avgDeltaPct = rows.length ? rows.reduce((sum, r) => sum + r.deltaPct, 0) / rows.length : null;

  return {
    rows,
    matchedCount: rows.length,
    weAreCheaperCount,
    weAreMoreExpensiveCount,
    avgDeltaPct,
  };
}
