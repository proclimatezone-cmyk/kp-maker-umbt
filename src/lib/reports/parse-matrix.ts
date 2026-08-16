import type { SheetGrid } from './sheet-source';

export interface MatrixCell {
  /** Заголовок колонки-события: код заказа («K03») или полный текст брони («Бронь №11\n от 03.08.26…»). */
  header: string;
  qty: number;
}

export interface MatrixRow {
  category: string;
  series: string;
  model: string;
  cells: MatrixCell[];
}

const CODE_COL_START = 3; // A=дата синка, B=Наименование, C=Модель, D..=события

/**
 * «Заказы» и «Бронь» — одна и та же раскладка: строки-товары под строкой-категорией
 * (колонка B задана, колонка C пуста), колонка «Наименование» заполняется точечно —
 * подсерия действует, пока не встретится следующая. Строки «Итого» — просто суммы,
 * не данные, пропускаются.
 */
export function parseMatrixSheet(grid: SheetGrid): { codes: string[]; rows: MatrixRow[] } {
  const values = grid.values;
  if (values.length === 0) return { codes: [], rows: [] };

  const header = values[0] || [];
  const codes = header.slice(CODE_COL_START).map((c) => String(c || ''));

  let currentCategory = '';
  let currentSeries = '';
  const rows: MatrixRow[] = [];

  for (let i = 1; i < values.length; i++) {
    const r = values[i] || [];
    const naming = String(r[1] || '').trim();
    const model = String(r[2] || '').trim();

    if (!naming && !model) continue; // пустая строка-разделитель

    if (naming && !model) {
      if (/^итого/i.test(naming)) continue; // строка суммы, не категория
      currentCategory = naming;
      currentSeries = '';
      continue;
    }

    if (naming) currentSeries = naming;
    if (!model) continue;

    const cells: MatrixCell[] = [];
    for (let c = 0; c < codes.length; c++) {
      if (!codes[c]) continue;
      const raw = String(r[CODE_COL_START + c] || '').trim();
      if (!raw || raw === '-') continue;
      const qty = Number(raw.replace(',', '.'));
      if (!Number.isFinite(qty) || qty === 0) continue;
      cells.push({ header: codes[c], qty });
    }

    rows.push({ category: currentCategory, series: currentSeries, model, cells });
  }

  return { codes, rows };
}
