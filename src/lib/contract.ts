import { amountToWordsUZS } from './number-to-words';
import { stockModelKey } from './stock-match';

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
 * Комплект «внутренний + наружный» в прайсе идёт одной позицией с одной
 * ценой, а в договоре расписывается двумя строками с ценой пополам.
 *
 * Разделителем считается только «+», окружённый пробелами: в артикулах
 * встречается «/» («MHA-96HWAN1/MOUB-96HD1N1-R» — это одна позиция и
 * делить её нельзя), а в описаниях попадается «+55 градусов».
 */
export function splitKits(items: ContractInput[]): ContractInput[] {
  const out: ContractInput[] = [];

  for (const item of items) {
    const parts = String(item.model || '').split(/\s+\+\s+/).map(s => s.trim()).filter(Boolean);

    if (parts.length < 2) {
      out.push(item);
      continue;
    }

    const price = Number(item.unitPrice) || 0;
    // Половинки считаем так, чтобы их сумма точно равнялась цене комплекта:
    // остаток от деления уходит в последнюю строку.
    const share = Math.round((price / parts.length) * 100) / 100;
    const shares = parts.map((_, i) =>
      i === parts.length - 1
        ? Math.round((price - share * (parts.length - 1)) * 100) / 100
        : share
    );

    parts.forEach((model, i) => {
      out.push({ ...item, model, name: undefined, unitPrice: shares[i] });
    });
  }

  return out;
}

/**
 * Спецификация к договору.
 *
 * Принцип: итог в договоре ВСЕГДА равен итогу, который менеджер уже видел
 * на сайте в КП — какой бы математикой (наценка 1:1, +12%, +20%, скидка,
 * способ оплаты) та сумма ни была получена, это забота сайта, не договора.
 * Договор не начисляет НДС поверх — он только раскладывает уже готовую
 * итоговую сумму на тело (без НДС) и сам НДС (12%), поэтому unitPrice
 * здесь — всегда валовая (с НДС) цена за единицу, как в КП.
 *
 * Раньше было наоборот: сюда приходила «чистая» цена без наценки, и НДС
 * начислялся заново поверх — итог в договоре не совпадал с тем, что видел
 * клиент в КП (искусственно на 12% больше).
 */
export function buildSpec(items: ContractInput[]) {
  const rows: SpecRow[] = [];
  let totalNet = 0;
  let totalVat = 0;

  items.forEach((item, i) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPrice) || 0;

    const gross = Math.round(price * qty * 100) / 100;
    const net = Math.round((gross / (1 + VAT_RATE)) * 100) / 100;
    // НДС — остаток, а не отдельное округление: округли net и vat порознь
    // (как было) — net+vat перестаёт точно равняться gross, «Итого»
    // строк расходится с суммой по колонкам на копейки, а не округляется
    // вверх к реальной сумме КП.
    const vat = gross - net;
    // «Цена единицы» в спецификации — по формату подписанного договора —
    // это цена БЕЗ НДС (unit_price × qty = «Общая стоимость», тоже без
    // НДС). Входящая price — валовая (с НДС), поэтому для этой колонки
    // берём net за штуку, а не саму price.
    const netUnitPrice = qty > 0 ? net / qty : 0;

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
      price: money(netUnitPrice),
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
  const keys = Object.keys(namesByArticle);

  return items.map(item => {
    const key = stockModelKey(item.model);
    if (!key) return item;

    // Точное совпадение.
    let full = namesByArticle[key];

    // Иначе — по началу артикула: в прайсе встречаются хвосты, которых нет
    // в инвентаризации («MI2-56T2DHN18(At)S» против «MI2-56T2DHN18(At)»),
    // и наоборот. Побеждает самое длинное совпадение, чтобы не спутать
    // MIH28 с MIH280.
    if (!full) {
      const match = keys
        .filter(k => k.length >= 6 && (key.startsWith(k) || k.startsWith(key)))
        .sort((a, b) => b.length - a.length)[0];
      if (match) full = namesByArticle[match];
    }

    return full ? { ...item, name: full } : item;
  });
}

/** Позиции, для которых полное название в инвентаризации не нашлось. */
export function missingInventoryNames<T extends { model: string; name?: string }>(
  items: T[]
): string[] {
  return items.filter(i => !i.name?.trim()).map(i => i.model);
}

/** Строка пункта 3.1 договора целиком. */
export function contractAmountClause(totals: ReturnType<typeof buildSpec>['totals']): string {
  return `Общая стоимость: ${totals.grossInWords}, в т. ч. НДС ${totals.vat} сум`;
}
