/**
 * Условия поставки: единственное место, где живут формулировки,
 * попадающие в готовое КП. Модуль общий для интерфейса и генератора,
 * чтобы менеджер видел на экране ровно тот текст, что уйдёт клиенту.
 */

export type DeliveryTerm = 'warehouse' | 'cip' | 'ddp' | 'order';
export type WarrantyMonths = 18 | 36;

interface DeliveryTermSpec {
  /** Подпись переключателя в интерфейсе */
  label: string;
  /** Пункт «Условия поставки» */
  delivery: string;
  /** Пункт «Срок поставки» */
  leadTime: string;
  /** Префикс в шапке колонок и в итогах: «Цена CIP, у.е.» */
  incoterm: string;
  /** Нужен ли пункт про оплату в национальной валюте */
  nationalCurrencyClause: boolean;
}

export const DELIVERY_TERMS: Record<DeliveryTerm, DeliveryTermSpec> = {
  warehouse: {
    label: 'Со склада',
    delivery: 'со склада продавца в Ташкенте (бесплатная доставка в г. Ташкенте)',
    leadTime: '2 рабочих дня после подтверждения получения платежа* (*уточнить наличие)',
    incoterm: '',
    nationalCurrencyClause: false,
  },
  cip: {
    label: 'CIP Ташкент',
    delivery: 'CIP Ташкент',
    leadTime: '90 календарных дней',
    incoterm: 'CIP',
    nationalCurrencyClause: true,
  },
  ddp: {
    label: 'DDP Ташкент',
    delivery: 'DDP Ташкент',
    leadTime: '90 календарных дней',
    incoterm: 'DDP',
    nationalCurrencyClause: true,
  },
  order: {
    label: 'Под заказ',
    delivery: 'под заказ',
    leadTime: '90 календарных дней',
    incoterm: '',
    nationalCurrencyClause: false,
  },
};

const NATIONAL_CURRENCY_CLAUSE =
  'Цены указаны в у.е. (доллар США). Оплата производится в национальной валюте ' +
  'по актуальному курсу на момент оплаты';

export function getDeliverySpec(term: unknown): DeliveryTermSpec {
  return DELIVERY_TERMS[(term as DeliveryTerm)] || DELIVERY_TERMS.warehouse;
}

export function getWarrantyLine(months: unknown): string {
  return Number(months) === 36
    ? '36 месяцев'
    : '18 месяцев после поставки или 12 месяцев после пуска в эксплуатацию';
}

/**
 * Нумерованные пункты блока «Условия предложения» в том порядке,
 * в котором они печатаются в КП.
 */
export function buildTermsLines(opts: {
  deliveryTerms?: unknown;
  warrantyMonths?: unknown;
}): string[] {
  const spec = getDeliverySpec(opts.deliveryTerms);

  const points = [
    `Условия поставки: ${spec.delivery};`,
    `Срок поставки: ${spec.leadTime};`,
    'Условия оплаты: 100% предоплата;',
    `Гарантия: ${getWarrantyLine(opts.warrantyMonths)};`,
    'Срок действия предложения: 1 неделя с момента подачи',
  ];

  if (spec.nationalCurrencyClause) {
    // Пункт про национальную валюту всегда идёт последним.
    points[points.length - 1] = 'Срок действия предложения: 1 неделя с момента подачи;';
    points.push(`${NATIONAL_CURRENCY_CLAUSE}`);
  }

  return points.map((text, i) => `${i + 1}. ${text}`);
}

/**
 * Подписи денежных колонок и итогов.
 * Базовая единица зависит от валюты и способа оплаты, к ней добавляется
 * базис поставки: «Цена CIP, у.е.». Для склада и заказа базиса нет.
 */
export function getMoneyLabels(opts: {
  deliveryTerms?: unknown;
  currency?: string;
  paymentType?: string;
}) {
  const { incoterm } = getDeliverySpec(opts.deliveryTerms);

  let unit = 'у.е.';
  if (opts.paymentType === 'transfer') unit = 'с НДС';
  else if (opts.currency === 'sum') unit = 'СУМ';

  const suffix = incoterm ? `${incoterm}, ${unit}` : unit;

  return {
    incoterm,
    unit,
    /** Шапка колонки с ценой за единицу */
    price: `Цена ${suffix}`,
    /** Шапка колонки с суммой по строке */
    sum: `Сумма ${suffix}`,
    /**
     * Подпись строки итога. `Итого CIP, у.е.` / `Итого доп. раздел CIP, у.е.`
     * @param what уточнение вроде «кондиционирование» или «доп. раздел»
     */
    total: (what?: string) => `Итого${what ? ' ' + what : ''} ${suffix}`,
  };
}
