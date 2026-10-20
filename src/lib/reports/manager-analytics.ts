import { google } from 'googleapis';
import { getOAuthOnlyAuth } from '@/lib/google-auth';
import type { SheetGrid } from './sheet-source';
import { parseMatrixSheet } from './parse-matrix';
import { normalizeModel, parseRuNumber } from './parse-utils';
import { MANAGERS, UNKNOWN_MANAGER_KEY, managerForKp, managerForOrderCode, normalizeOrderCode, orderCodeLabel } from './managers';
import { JOURNAL_SHEET_ID, parseAnyDate, syncOrdersJournal, type RegistryInfo } from './orders-journal';

/**
 * Данные для раздела «Аналитика»: заказы со склада и выданные КП в
 * плоском виде. Агрегация по периодам/менеджерам делается в браузере —
 * так переключение «день/неделя/месяц/год» не требует запросов к серверу.
 */

export interface OrderLine { category: string; model: string; qty: number; amount: number | null }

export interface OrderRecord {
  code: string;
  managerKey: string;
  date: string | null; // ISO
  /** реестр / оценка / авто / вручную — «оценка» в интерфейсе помечается «≈». */
  dateSource: string;
  projectName: string;
  units: number;
  /** Сумма по текущему прайсу сайта (без скидок). */
  priceAmount: number;
  /** Доля штук, для которых нашлась цена в прайсе (0..1). */
  priceCoverage: number;
  /** Сумма договора — из журнала/реестра, если известна. */
  contractAmount: number | null;
  /** Итоговая сумма для отчёта: договор, иначе прайс. */
  amount: number;
  amountSource: 'договор' | 'прайс';
  lines: OrderLine[];
}

export interface KpRecord {
  kpNumber: string;
  date: string; // ISO, первая генерация
  managerKey: string;
  managerName: string;
  client: string;
  total: number;
  currency: 'USD' | 'UZS';
  versions: number;
}

export interface ManagerAnalytics {
  generatedAt: string;
  managers: { key: string; name: string; unconfirmed?: boolean }[];
  orders: OrderRecord[];
  kps: KpRecord[];
  journal: { written: number; error?: string };
  warnings: string[];
}

// Строки реестра «Объекты»: A=код заказа, D=дата отгрузки, E=название, I=сумма договора.
function parseRegistry(objects: SheetGrid): Map<string, RegistryInfo> {
  const map = new Map<string, RegistryInfo>();
  for (const r of objects.values.slice(2)) {
    const code = String(r?.[0] || '').trim();
    if (!code || code === '?') continue;
    const amount = parseRuNumber(r[8]);
    map.set(normalizeOrderCode(code), {
      date: parseAnyDate(r[3]),
      contractAmount: amount && amount > 0 ? amount : null,
      projectName: r[4] ? String(r[4]).trim() : null,
    });
  }
  return map;
}

function buildOrders(
  orders: SheetGrid,
  priceByModel: Map<string, number>,
): { codes: string[]; byCode: Map<string, { code: string; lines: OrderLine[] }>; duplicates: string[] } {
  const { codes, rows } = parseMatrixSheet(orders);
  const byCode = new Map<string, { code: string; lines: OrderLine[] }>();
  const seenHeaders = new Map<string, number>();
  const duplicates: string[] = [];
  for (const c of codes) {
    if (!c) continue;
    const k = normalizeOrderCode(c);
    seenHeaders.set(k, (seenHeaders.get(k) || 0) + 1);
    if (seenHeaders.get(k) === 2) duplicates.push(c);
    if (!byCode.has(k)) byCode.set(k, { code: orderCodeLabel(c), lines: [] });
  }
  for (const row of rows) {
    const price = priceByModel.get(normalizeModel(row.model));
    for (const cell of row.cells) {
      const o = byCode.get(normalizeOrderCode(cell.header));
      if (!o) continue;
      o.lines.push({ category: row.category, model: row.model, qty: cell.qty, amount: price != null ? price * cell.qty : null });
    }
  }
  return { codes: codes.filter(Boolean), byCode, duplicates };
}

async function readKpArchive(): Promise<string[][]> {
  const sheets = google.sheets({ version: 'v4', auth: getOAuthOnlyAuth() });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: JOURNAL_SHEET_ID, range: "'все кпшки'!A2:F20000" });
  return (res.data.values || []) as string[][];
}

const TEST_LOGINS = /smoke-test|^test@/i;
// Пробные КП: вместо клиента набрано «1», «234», «h» — в статистику не берём,
// иначе одна проверка большого VRF раздувает «сумму КП» на миллионы.
const isTestClient = (client: string) => /^[\d\s.,-]*$/.test(client) || client.trim().length <= 2;
// Итог КП в сумах (валюта КП = сум) на порядки больше долларового —
// валюта в архиве не пишется, отличаем по величине.
const UZS_THRESHOLD = 1_000_000;

function buildKps(rows: string[][]): { kps: KpRecord[]; skippedTests: number } {
  const map = new Map<string, KpRecord>();
  let skippedTests = 0;
  for (const r of rows) {
    const [stamp, managerName, login, client, kpNumberRaw, totalRaw] = r;
    const kpNumber = String(kpNumberRaw || '').trim();
    const date = parseAnyDate(stamp);
    if (!kpNumber || !date) continue;
    if (TEST_LOGINS.test(String(login || ''))) continue;
    if (isTestClient(String(client || ''))) { skippedTests++; continue; }
    const total = Number(String(totalRaw || '').replace(/[\s  ]/g, '').replace(',', '.')) || 0;
    const manager = managerForKp(kpNumber, login);
    const key = kpNumber.toUpperCase().replace(/\s+/g, ' ');
    const prev = map.get(key);
    const rec: KpRecord = {
      kpNumber,
      date: prev?.date || date,
      // Менеджер вне справочника (новый сотрудник) — отдельной строкой по логину,
      // а не в общей куче «Не определён».
      managerKey: manager?.key || (login ? `~${String(login).trim().toLowerCase()}` : UNKNOWN_MANAGER_KEY),
      managerName: manager?.name || String(managerName || login || 'Не определён'),
      client: String(client || ''),
      total,
      currency: total >= UZS_THRESHOLD ? 'UZS' : 'USD',
      versions: (prev?.versions || 0) + 1,
    };
    map.set(key, rec); // последняя версия КП — актуальная сумма
  }
  return { kps: [...map.values()], skippedTests };
}

export async function computeManagerAnalytics(
  ordersGrid: SheetGrid,
  objectsGrid: SheetGrid,
  products: { model: string; price: number }[],
): Promise<ManagerAnalytics> {
  const warnings: string[] = [];
  const priceByModel = new Map<string, number>();
  for (const p of products) if (p.price > 0) priceByModel.set(normalizeModel(p.model), p.price);

  const registry = parseRegistry(objectsGrid);
  const { codes, byCode, duplicates } = buildOrders(ordersGrid, priceByModel);
  if (duplicates.length) warnings.push(`В листе «Заказы» повторяются коды: ${duplicates.join(', ')} — такие колонки посчитаны как один заказ.`);

  let journal: Awaited<ReturnType<typeof syncOrdersJournal>>;
  try {
    journal = await syncOrdersJournal(codes, registry);
  } catch (err: any) {
    journal = { entries: new Map(), written: 0, error: err?.message || String(err) };
  }
  if (journal.error) warnings.push('Журнал заказов недоступен — даты новых заказов не сохранены: ' + journal.error);

  const orders: OrderRecord[] = [];
  for (const [k, o] of byCode) {
    if (!o.lines.length) continue; // пустая колонка — заказ ещё не заполнен
    const j = journal.entries.get(k);
    const reg = registry.get(k);
    const units = o.lines.reduce((s, l) => s + l.qty, 0);
    const pricedUnits = o.lines.reduce((s, l) => s + (l.amount != null ? l.qty : 0), 0);
    const priceAmount = Math.round(o.lines.reduce((s, l) => s + (l.amount || 0), 0));
    const contractAmount = j?.contractAmount ?? reg?.contractAmount ?? null;
    orders.push({
      code: o.code,
      managerKey: managerForOrderCode(o.code)?.key || UNKNOWN_MANAGER_KEY,
      date: j?.date ?? reg?.date ?? null,
      dateSource: j?.source || (reg?.date ? 'реестр' : ''),
      projectName: j?.projectName || reg?.projectName || '',
      units,
      priceAmount,
      priceCoverage: units > 0 ? pricedUnits / units : 0,
      contractAmount,
      amount: contractAmount ?? priceAmount,
      amountSource: contractAmount != null ? 'договор' : 'прайс',
      lines: o.lines,
    });
  }

  const unknown = orders.filter(o => o.managerKey === UNKNOWN_MANAGER_KEY).map(o => o.code);
  if (unknown.length) warnings.push(`Нет менеджера для кодов: ${unknown.join(', ')} — добавьте префикс в справочник (src/lib/reports/managers.ts).`);

  let kps: KpRecord[] = [];
  try {
    const built = buildKps(await readKpArchive());
    kps = built.kps;
    if (built.skippedTests) warnings.push(`Не учтено ${built.skippedTests} генераций КП с пробным клиентом («1», «234», «h»…) — это проверки, а не реальные предложения.`);
  } catch (err: any) {
    warnings.push('Архив КП недоступен: ' + (err?.message || String(err)));
  }

  return {
    generatedAt: new Date().toISOString(),
    managers: MANAGERS.map(m => ({ key: m.key, name: m.name, unconfirmed: m.unconfirmed })),
    orders,
    kps,
    journal: { written: journal.written, error: journal.error },
    warnings,
  };
}
