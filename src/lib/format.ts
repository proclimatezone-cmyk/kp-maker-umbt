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

/**
 * ISO-дата («2026-08-15») → короткий формат «15.08.2026» для КП.
 * Не-ISO строку (старые значения, набранные вручную до календаря)
 * отдаём как есть.
 */
export function formatShortRuDate(value: string | null | undefined): string {
  const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return value || '';
  const [, y, mo, d] = m;
  return `${d}.${mo}.${y}`;
}

/** «15.08.2026» → ISO «2026-08-15», для заполнения `<input type="date">` старыми значениями. */
export function toIsoDate(value: string | null | undefined): string {
  const m = String(value || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return String(value || '');
  const [, d, mo, y] = m;
  return `${y}-${mo}-${d}`;
}

/** Часовой пояс, по которому считается «сегодня» для КП (команда в Ташкенте). */
export const KP_TIME_ZONE = 'Asia/Tashkent';

/**
 * Сегодняшняя дата в ISO («2026-10-18») по ташкентскому времени.
 * Раньше брался `new Date().toISOString()` — это UTC, и с 00:00 до 05:00
 * по Ташкенту подставлялось вчерашнее число.
 */
export function todayIso(now: Date = new Date()): string {
  // en-CA отдаёт дату ровно в виде YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: KP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** ISO «2026-10-18» → «181026» (как дата пишется в номере КП). */
export function isoToKpStamp(iso: string): string {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}${m[2]}${m[1].slice(2)}`;
}

/**
 * Подставляет дату в номер КП, сохраняя всё остальное (префикс, порядковый
 * номер, инициалы менеджера): «КП-171026/02MN» + 2026-10-18 → «КП-181026/02MN».
 * Ищется первая группа из 6 цифр, похожая на ДДММГГ. Если в номере даты нет
 * (менеджер набрал своё), номер не трогаем; пустой номер → «КП-ДДММГГ/01».
 */
export function applyDateToKpName(name: string, iso: string): string {
  const stamp = isoToKpStamp(iso);
  if (!stamp) return name;
  const current = String(name || '');
  if (!current.trim()) return `КП-${stamp}/01`;
  let replaced = false;
  const next = current.replace(/(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/, (whole, d, mo) => {
    const day = Number(d), month = Number(mo);
    if (day < 1 || day > 31 || month < 1 || month > 12) return whole;
    replaced = true;
    return stamp;
  });
  return replaced ? next : current;
}
