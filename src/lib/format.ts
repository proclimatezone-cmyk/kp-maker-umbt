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
