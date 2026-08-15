/**
 * Сумма прописью по-русски для договоров и спецификаций.
 *
 * В договоре сумма дублируется словами: «1 285 610 740,00 (один миллиард
 * двести восемьдесят пять миллионов шестьсот десять тысяч семьсот сорок)
 * сум 00 тийин». Ошибку в этой строке замечают сразу, поэтому она
 * собирается кодом, а не руками.
 */

const ONES_MALE = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_FEMALE = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = [
  'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
  'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать',
];
const TENS = [
  '', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят',
  'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто',
];
const HUNDREDS = [
  '', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот',
  'шестьсот', 'семьсот', 'восемьсот', 'девятьсот',
];

/** Разряды: слово в трёх формах и род числительного перед ним. */
const SCALES: { forms: [string, string, string]; female: boolean }[] = [
  { forms: ['', '', ''], female: false },                                  // единицы
  { forms: ['тысяча', 'тысячи', 'тысяч'], female: true },
  { forms: ['миллион', 'миллиона', 'миллионов'], female: false },
  { forms: ['миллиард', 'миллиарда', 'миллиардов'], female: false },
  { forms: ['триллион', 'триллиона', 'триллионов'], female: false },
];

/** Выбор формы слова: 1 сум, 2 сума, 5 сумов. */
export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

/** Группа до 999 словами. */
function tripletToWords(n: number, female: boolean): string[] {
  const words: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;

  if (h) words.push(HUNDREDS[h]);
  if (t > 1) {
    words.push(TENS[t]);
    if (o) words.push((female ? ONES_FEMALE : ONES_MALE)[o]);
  } else if (t === 1) {
    words.push(TEENS[o]);
  } else if (o) {
    words.push((female ? ONES_FEMALE : ONES_MALE)[o]);
  }
  return words;
}

/** Целое число словами, без названия валюты. */
export function numberToWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return 'ноль';

  const triplets: number[] = [];
  let rest = n;
  while (rest > 0) {
    triplets.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }

  if (triplets.length > SCALES.length) {
    throw new Error('Сумма слишком велика для записи прописью');
  }

  const words: string[] = [];
  for (let i = triplets.length - 1; i >= 0; i--) {
    const t = triplets[i];
    if (!t) continue;
    const scale = SCALES[i];
    words.push(...tripletToWords(t, scale.female));
    if (i > 0) words.push(plural(t, scale.forms));
  }

  return (value < 0 ? 'минус ' : '') + words.join(' ');
}

/**
 * Сумма в сумах для договора: цифрами, следом прописью, затем тийины.
 * Тийины по образцу договора пишутся цифрами, а не словами.
 *
 * @example
 * amountToWordsUZS(1285610740)
 * // «1 285 610 740,00 (один миллиард двести восемьдесят пять миллионов
 * //  шестьсот десять тысяч семьсот сорок) сум 00 тийин»
 */
export function amountToWordsUZS(amount: number): string {
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const whole = Math.floor(rounded);
  const coins = Math.round((rounded - whole) * 100);

  const digits = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rounded);

  const words = numberToWords(whole);

  // «сум» и «тийин» не склоняются: так в договоре UZ41/26 и так принято
  // в узбекских договорах на русском. Грамматически «сумов» было бы
  // правильнее, но документ юридический и должен совпадать с практикой.
  return `${digits} (${words}) сум ${String(coins).padStart(2, '0')} тийин`;
}

/** То же для у.е.: «5 773,00 (пять тысяч семьсот семьдесят три) у.е.» */
export function amountToWordsUE(amount: number): string {
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const digits = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rounded);
  return `${digits} (${numberToWords(Math.floor(rounded))}) у.е.`;
}
