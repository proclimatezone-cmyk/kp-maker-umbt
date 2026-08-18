import welkinMatchData from '@/data/welkin-match.json';

/**
 * Сравнение с конкурентом Welkin (Hisense OEM) — сопоставление заранее
 * посчитано офлайн (node src/scripts/sync-welkin.mjs) по ближайшей
 * холодопроизводительности внутри класса оборудования: общего артикула
 * у брендов нет, только приблизительное соответствие («≈»). Здесь —
 * только join с ТЕКУЩЕЙ ценой прайса, она меняется чаще, чем список
 * моделей.
 */

interface WelkinMatch {
  welkinModel: string;
  hisenseModel: string;
  priceUsd: number;
  matchedKw: number;
  productKw: number;
  deltaPct: number;
}

const welkinMatch = welkinMatchData as Record<string, WelkinMatch>;

interface CurrentProduct {
  model: string;
  category?: string;
  price: number;
}

export interface WelkinComparisonRow {
  model: string;
  category: string;
  welkinModel: string;
  ourPrice: number;
  welkinPrice: number;
  deltaAbs: number;
  deltaPct: number;
  /** Насколько точно совпала мощность при офлайн-сопоставлении (0 — точно). */
  matchDeltaPct: number;
  /** true — мы дороже Welkin */
  weAreMoreExpensive: boolean;
}

export interface WelkinComparisonReport {
  rows: WelkinComparisonRow[];
  matchedCount: number;
  weAreCheaperCount: number;
  weAreMoreExpensiveCount: number;
  avgDeltaPct: number | null;
}

export function computeWelkinComparison(currentProducts: CurrentProduct[]): WelkinComparisonReport {
  const rows: WelkinComparisonRow[] = [];

  for (const p of currentProducts) {
    const m = welkinMatch[p.model];
    if (!m || !p.price) continue;
    const deltaAbs = p.price - m.priceUsd;
    const deltaPct = m.priceUsd > 0 ? (deltaAbs / m.priceUsd) * 100 : 0;
    rows.push({
      model: p.model,
      category: p.category || '',
      welkinModel: m.welkinModel,
      ourPrice: p.price,
      welkinPrice: m.priceUsd,
      deltaAbs,
      deltaPct,
      matchDeltaPct: m.deltaPct,
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
