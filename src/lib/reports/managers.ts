/**
 * Справочник менеджеров для аналитики.
 *
 * Менеджер определяется:
 *  - у заказа (лист «Заказы») — по буквенному префиксу кода: MN03 → MN, К49 → K;
 *  - у КП (лист «все кпшки») — сначала по инициалам в номере КП
 *    («КП-171026/02KJ» → KJ), иначе по логину, с которого КП сгенерировано.
 *
 * Модуль без обращений к Google — используется и на сервере, и в браузере.
 * Новый менеджер = новая строка в MANAGERS.
 */

export interface ManagerInfo {
  key: string;
  name: string;
  /** Буквенные префиксы кодов заказов в листе «Заказы». */
  orderPrefixes: string[];
  /** Инициалы в конце номера КП. */
  kpSuffixes: string[];
  /** Логины сайта (email), с которых менеджер генерирует КП. */
  logins: string[];
  /** true — имя не подтверждено владельцем, взято из реестра «Объекты». */
  unconfirmed?: boolean;
}

export const MANAGERS: ManagerInfo[] = [
  { key: 'MN', name: 'Мухаммаджон Носиров', orderPrefixes: ['MN'], kpSuffixes: ['MN'], logins: ['m.nosirov@umbt.uz', 'nosirovmuhammadjon3@gmail.com'] },
  { key: 'K', name: 'Анатолий Кузин', orderPrefixes: ['K'], kpSuffixes: ['K'], logins: ['a.kuzin@umbt.uz'] },
  { key: 'Э', name: 'Эльдар Ширинов', orderPrefixes: ['Э'], kpSuffixes: ['Э', 'Ш'], logins: ['e.shirinov@umbt.uz'] },
  { key: 'И', name: 'Ильяр Азаматов', orderPrefixes: ['И'], kpSuffixes: ['ИА'], logins: ['i.azamatov@umbt.uz'] },
  { key: 'КЖ', name: 'Комилжон Жалилов', orderPrefixes: ['КЖ'], kpSuffixes: ['KJ', 'КЖ'], logins: ['k.jalilov@umbt.uz'] },
  { key: 'Ж', name: 'Жасур', orderPrefixes: ['Ж'], kpSuffixes: [], logins: [], unconfirmed: true },
  { key: 'А', name: 'Андрей', orderPrefixes: ['А'], kpSuffixes: ['КД'], logins: [], unconfirmed: true },
  { key: 'ЭС', name: 'ЭС (не назначен)', orderPrefixes: ['ЭС'], kpSuffixes: [], logins: [], unconfirmed: true },
];

export const UNKNOWN_MANAGER_KEY = '?';

// Кириллица и латиница визуально неразличимы для части букв — в таблице
// один и тот же код набран то «K», то «К». Сравниваем в одном алфавите.
const LOOKALIKE: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X',
};

export function normalizeLetters(value: string): string {
  return String(value || '').toUpperCase().split('').map(ch => LOOKALIKE[ch] || ch).join('');
}

/** Код заказа в устойчивом виде: «К49» и «K49» — один и тот же заказ. */
export function normalizeOrderCode(code: string): string {
  return normalizeLetters(orderCodeLabel(code).replace(/\s+/g, ''));
}

/** В заголовке колонки бывает приписка второй строкой («MM01\nШмарин») — код это первая строка. */
export function orderCodeLabel(code: string): string {
  return String(code || '').split(/\r?\n/)[0].trim();
}

const byOrderPrefix = new Map<string, ManagerInfo>();
const bySuffix: { suffix: string; manager: ManagerInfo }[] = [];
const byLogin = new Map<string, ManagerInfo>();
for (const m of MANAGERS) {
  for (const p of m.orderPrefixes) byOrderPrefix.set(normalizeLetters(p), m);
  for (const s of m.kpSuffixes) bySuffix.push({ suffix: normalizeLetters(s), manager: m });
  for (const l of m.logins) byLogin.set(l.toLowerCase(), m);
}
// Длинные суффиксы проверяем первыми: «KJ» не должен уйти в «K».
bySuffix.sort((a, b) => b.suffix.length - a.suffix.length);

export function managerByKey(key: string): ManagerInfo | undefined {
  return MANAGERS.find(m => m.key === key);
}

/** «MN03+MN04» → MN, «ЭС01» → ЭС, «КЖ02» → КЖ. */
export function managerForOrderCode(code: string): ManagerInfo | null {
  const m = orderCodeLabel(code).match(/^([A-Za-zА-Яа-яЁё]+)/);
  if (!m) return null;
  return byOrderPrefix.get(normalizeLetters(m[1])) || null;
}

/** Инициалы после даты и порядкового номера: «КП-171026/02KJ VRF» → «KJ VRF». */
export function kpSuffix(kpNumber: string): string {
  const m = String(kpNumber || '').match(/\d{6,8}\s*[-\/_. ]?\s*\d{1,3}\s*([A-Za-zА-Яа-яЁё][^\/]*)$/);
  return m ? m[1].trim() : '';
}

export function managerForKp(kpNumber: string, login: string): ManagerInfo | null {
  const suffix = normalizeLetters(kpSuffix(kpNumber).replace(/[^A-Za-zА-Яа-яЁё]/g, ''));
  if (suffix) {
    for (const { suffix: s, manager } of bySuffix) {
      if (suffix.startsWith(s)) return manager;
    }
  }
  return byLogin.get(String(login || '').trim().toLowerCase()) || null;
}
