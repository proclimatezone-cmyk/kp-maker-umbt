import oldPriceData from '@/data/old-price.json';
import { normalizeModel } from './parse-utils';

interface OldPriceItem {
  category: string;
  series: string;
  model: string;
  articleCode: string;
  price: number;
}

interface CurrentProduct {
  model: string;
  category?: string;
  price: number;
}

export interface PriceComparisonRow {
  model: string;
  category: string;
  oldPrice: number | null;
  currentPrice: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
  /** matched — есть в обоих прайсах; oldOnly — снята с производства/не переходила в новый прайс; currentOnly — новая позиция */
  status: 'matched' | 'oldOnly' | 'currentOnly';
}

export interface PriceComparisonReport {
  rows: PriceComparisonRow[];
  matchedCount: number;
  oldOnlyCount: number;
  currentOnlyCount: number;
  avgDeltaPct: number | null;
}

export function computePriceComparison(currentProducts: CurrentProduct[]): PriceComparisonReport {
  const oldByModel = new Map<string, OldPriceItem>();
  for (const item of oldPriceData as OldPriceItem[]) {
    oldByModel.set(normalizeModel(item.model), item);
  }

  const currentByModel = new Map<string, CurrentProduct>();
  for (const p of currentProducts) {
    if (p.model) currentByModel.set(normalizeModel(p.model), p);
  }

  const rows: PriceComparisonRow[] = [];
  const seen = new Set<string>();

  for (const [key, oldItem] of oldByModel) {
    const current = currentByModel.get(key);
    seen.add(key);
    if (current) {
      const deltaAbs = current.price - oldItem.price;
      const deltaPct = oldItem.price > 0 ? (deltaAbs / oldItem.price) * 100 : null;
      rows.push({
        model: oldItem.model,
        category: current.category || oldItem.category,
        oldPrice: oldItem.price,
        currentPrice: current.price,
        deltaAbs,
        deltaPct,
        status: 'matched',
      });
    } else {
      rows.push({
        model: oldItem.model,
        category: oldItem.category,
        oldPrice: oldItem.price,
        currentPrice: null,
        deltaAbs: null,
        deltaPct: null,
        status: 'oldOnly',
      });
    }
  }

  for (const [key, current] of currentByModel) {
    if (seen.has(key)) continue;
    rows.push({
      model: current.model,
      category: current.category || '',
      oldPrice: null,
      currentPrice: current.price,
      deltaAbs: null,
      deltaPct: null,
      status: 'currentOnly',
    });
  }

  rows.sort((a, b) => {
    const ad = a.deltaPct ?? -Infinity;
    const bd = b.deltaPct ?? -Infinity;
    return bd - ad;
  });

  const matched = rows.filter((r) => r.status === 'matched');
  const avgDeltaPct = matched.length
    ? matched.reduce((sum, r) => sum + (r.deltaPct || 0), 0) / matched.length
    : null;

  return {
    rows,
    matchedCount: matched.length,
    oldOnlyCount: rows.filter((r) => r.status === 'oldOnly').length,
    currentOnlyCount: rows.filter((r) => r.status === 'currentOnly').length,
    avgDeltaPct,
  };
}
