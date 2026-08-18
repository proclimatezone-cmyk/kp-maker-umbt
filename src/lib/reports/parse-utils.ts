/** Общие разборщики для отчётов: даты в формате ДД.ММ.ГГ и суммы вида «7 938,00». */

import { stockKey } from '../stock-match';

export interface ParsedDate {
  iso: string;
  monthKey: string; // YYYY-MM
  year: number;
  month: number; // 1-12
}

export function parseRuDate(raw: string | undefined | null): ParsedDate | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yy] = m;
  const year = 2000 + Number(yy);
  const month = Number(mm);
  if (month < 1 || month > 12) return null;
  const monthKey = `${year}-${mm}`;
  return { iso: `${year}-${mm}-${dd}`, monthKey, year, month };
}

export function parseRuNumber(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().replace(/\s| /g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ключ сопоставления модели со старым прайсом — та же логика, что и для
 * остатков (stockKey): без этого «Midea-V56WDHN1(AtB)» (так оно подписано
 * в КП) не находило «MDV-V56WDHN1(AtB)» (так оно подписано в старом
 * прайсе) — разный бренд-префикс у той же самой позиции серии ATOM.
 */
export function normalizeModel(raw: string | undefined | null): string {
  return stockKey(String(raw || ''));
}
