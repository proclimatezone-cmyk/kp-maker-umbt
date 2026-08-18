import type { SheetGrid } from './sheet-source';
import { parseMatrixSheet } from './parse-matrix';
import { parseRuDate, parseRuNumber } from './parse-utils';

interface ObjectEntry {
  projectNumber: string;
  manager: string | null;
  date: string | null; // ДД.ММ.ГГ, как в таблице
  projectName: string | null;
  contractAmount: number | null;
}

const OBJECTS_HEADER_ROW = 1; // строка 0 — пустая разделительная строка
const OBJECTS_DATA_START = 2;

function parseObjectsRegistry(grid: SheetGrid): Map<string, ObjectEntry> {
  const map = new Map<string, ObjectEntry>();
  const values = grid.values;
  for (let i = OBJECTS_DATA_START; i < values.length; i++) {
    const r = values[i] || [];
    const code = String(r[0] || '').trim();
    if (!code) continue;
    map.set(code, {
      projectNumber: String(r[1] || ''),
      manager: r[2] ? String(r[2]).trim() : null,
      date: r[3] ? String(r[3]).trim() : null,
      projectName: r[4] ? String(r[4]).trim() : null,
      contractAmount: parseRuNumber(r[8]),
    });
  }
  return map;
}

export interface SaleRecord {
  category: string;
  series: string;
  model: string;
  qty: number;
  orderCode: string;
  /** Буквенный префикс кода заказа («K03» → «K», «MN01» → «MN») — заполнен
   *  у 100% заказов, в отличие от manager (реестр «Объекты» привязан частично).
   *  Не «менеджер» в чистом виде — это код, за которым может стоять один
   *  человек или группа, сопоставление кодов с именами знает только админ. */
  codePrefix: string;
  linked: boolean;
  date: string | null;
  monthKey: string | null;
  manager: string | null;
  projectName: string | null;
}

export interface SalesReport {
  records: SaleRecord[];
  completeness: { linked: number; total: number; ratio: number };
  totals: { qty: number; linkedQty: number };
  byMonth: { monthKey: string; qty: number }[];
  byManager: { manager: string; qty: number }[];
  byCategory: { category: string; qty: number }[];
  byCodePrefix: { prefix: string; qty: number }[];
}

const UNLINKED = 'Не указано';

// Кириллица и латиница визуально неразличимы для части букв — в исходнике
// один и тот же код где-то набран «K» (латиница), где-то «К» (кириллица).
// Без этой нормализации это две разные группы вместо одной.
const CYRILLIC_TO_LATIN_LOOKALIKE: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X',
};

/** «K03»/«К03» → «K», «MN01» → «MN», «ЭС01» → «ЭС», «MN03+MN04» → «MN». */
function extractCodePrefix(orderCode: string): string {
  const m = String(orderCode || '').match(/^([A-Za-zА-Яа-яЁё]+)/);
  if (!m) return UNLINKED;
  return m[1]
    .toUpperCase()
    .split('')
    .map(ch => CYRILLIC_TO_LATIN_LOOKALIKE[ch] || ch)
    .join('');
}

export function computeSalesReport(orders: SheetGrid, objects: SheetGrid): SalesReport {
  const registry = parseObjectsRegistry(objects);
  const { rows } = parseMatrixSheet(orders);

  const records: SaleRecord[] = [];
  const linkedCodes = new Set<string>();
  const totalCodes = new Set<string>();

  for (const row of rows) {
    for (const cell of row.cells) {
      totalCodes.add(cell.header);
      const entry = registry.get(cell.header);
      const linked = !!entry;
      if (linked) linkedCodes.add(cell.header);
      const parsedDate = entry?.date ? parseRuDate(entry.date) : null;

      records.push({
        category: row.category,
        series: row.series,
        model: row.model,
        qty: cell.qty,
        orderCode: cell.header,
        codePrefix: extractCodePrefix(cell.header),
        linked,
        date: parsedDate?.iso ?? null,
        monthKey: parsedDate?.monthKey ?? null,
        manager: entry?.manager || null,
        projectName: entry?.projectName || null,
      });
    }
  }

  const totals = { qty: 0, linkedQty: 0 };
  const byMonthMap = new Map<string, number>();
  const byManagerMap = new Map<string, number>();
  const byCategoryMap = new Map<string, number>();
  const byCodePrefixMap = new Map<string, number>();

  for (const rec of records) {
    totals.qty += rec.qty;
    if (rec.linked) totals.linkedQty += rec.qty;

    const monthKey = rec.monthKey || UNLINKED;
    byMonthMap.set(monthKey, (byMonthMap.get(monthKey) || 0) + rec.qty);

    const manager = rec.manager || UNLINKED;
    byManagerMap.set(manager, (byManagerMap.get(manager) || 0) + rec.qty);

    byCategoryMap.set(rec.category, (byCategoryMap.get(rec.category) || 0) + rec.qty);
    byCodePrefixMap.set(rec.codePrefix, (byCodePrefixMap.get(rec.codePrefix) || 0) + rec.qty);
  }

  const byMonth = [...byMonthMap.entries()]
    .map(([monthKey, qty]) => ({ monthKey, qty }))
    .sort((a, b) => (a.monthKey === UNLINKED ? 1 : b.monthKey === UNLINKED ? -1 : a.monthKey.localeCompare(b.monthKey)));

  const byManager = [...byManagerMap.entries()]
    .map(([manager, qty]) => ({ manager, qty }))
    .sort((a, b) => b.qty - a.qty);

  const byCategory = [...byCategoryMap.entries()]
    .map(([category, qty]) => ({ category, qty }))
    .sort((a, b) => b.qty - a.qty);

  const byCodePrefix = [...byCodePrefixMap.entries()]
    .map(([prefix, qty]) => ({ prefix, qty }))
    .sort((a, b) => b.qty - a.qty);

  const total = totalCodes.size;
  const linked = linkedCodes.size;

  return {
    records,
    completeness: { linked, total, ratio: total > 0 ? linked / total : 0 },
    totals,
    byMonth,
    byManager,
    byCategory,
    byCodePrefix,
  };
}
