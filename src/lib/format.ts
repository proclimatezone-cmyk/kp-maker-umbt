/**
 * Единый формат чисел для интерфейса и для документов.
 *
 * Раньше везде вызывался `toLocaleString()` без локали: в браузере с русскими
 * настройками получалось «8 555 999», а с английскими — «8,555,999». На сервере
 * Node тоже берёт свою локаль, поэтому запятые попадали прямо в готовое КП.
 * Локаль задаётся явно, разряды разделяются узким неразрывным пробелом.
 */
const NUMBER_FORMAT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export function formatNum(value: number | string | null | undefined): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!isFinite(n)) return '0';
  return NUMBER_FORMAT.format(n);
}

const RU_DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * ISO-дата из `<input type="date">` («2026-08-15») → «15 августа 2026» для договора.
 * Строку, которая не похожа на ISO (старые значения, набранные вручную ещё
 * до календаря), отдаём как есть — переформатировать произвольный текст нечем,
 * но и терять уже введённое не нужно.
 */
export function formatRuDate(value: string | null | undefined): string {
  const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return value || '';
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return RU_DATE_FORMAT.format(date).replace(' г.', '');
}
