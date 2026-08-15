import { amountToWordsUZS } from './number-to-words';
import { stockKey } from './stock-match';

/** Ставка НДС в Узбекистане. */
export const VAT_RATE = 0.12;

export interface ContractInput {
  /** Полное название из инвентаризации; если пусто — берётся модель */
  name?: string;
  model: string;
  unit?: string;
  quantity: number;
  /** Цена за единицу БЕЗ НДС, в сумах */
  unitPrice: number;
}

export interface SpecRow {
  index: number;
  name: string;
  unit: string;
  qty: string;
  price: string;
  total: string;
  vat: string;
  withVat: string;
}

/** Денежный формат договора: разряды пробелами, всегда две цифры после запятой. */
const MONEY = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(value: number): string {
  return MONEY.format(value);
}

/**
 * Спецификация к договору.
 *
 * Расчёт сверен со строками подписанного договора UZ41/26:
 * общая стоимость — цена за единицу без НДС на количество,
 * НДС — 12% от неё, округлённые до сума,
 * стоимость с НДС — их сумма.
 */
export function buildSpec(items: ContractInput[]) {
  const rows: SpecRow[] = [];
  let totalNet = 0;
  let totalVat = 0;

  items.forEach((item, i) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPrice) || 0;

    const net = Math.round(price * qty * 100) / 100;
    const vat = Math.round(net * VAT_RATE);
    const gross = net + vat;

    totalNet += net;
    totalVat += vat;

    rows.push({
      index: i + 1,
      // В договоре позиции называются полностью, как в инвентаризации:
      // «Внутренний блок кассетного типа промышленной мультизональной
      // VRF системы MIH28Q4HN18», а не коротким артикулом из прайса.
      name: item.name?.trim() || item.model,
      unit: item.unit || 'шт.',
      qty: String(qty),
      price: money(price),
      total: money(net),
      vat: money(vat),
      withVat: money(gross),
    });
  });

  const totalGross = totalNet + totalVat;

  return {
    rows,
    totals: {
      net: money(totalNet),
      vat: money(totalVat),
      gross: money(totalGross),
      grossRaw: totalGross,
      vatRaw: totalVat,
      /** Строка для пункта 3.1: цифрами, прописью и отдельно НДС */
      grossInWords: amountToWordsUZS(totalGross),
      vatInWords: amountToWordsUZS(totalVat),
    },
  };
}

/**
 * Подставляет полные названия из инвентаризации по артикулу модели.
 * То, чего в инвентаризации нет, остаётся с названием из прайса.
 */
export function withInventoryNames<T extends { model: string; name?: string }>(
  items: T[],
  namesByArticle: Record<string, string>
): T[] {
  return items.map(item => {
    const full = namesByArticle[stockKey(item.model)];
    return full ? { ...item, name: full } : item;
  });
}

/** Строка пункта 3.1 договора целиком. */
export function contractAmountClause(totals: ReturnType<typeof buildSpec>['totals']): string {
  return `Общая стоимость: ${totals.grossInWords}, в т. ч. НДС ${totals.vat} сум`;
}
