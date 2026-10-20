import { google } from 'googleapis';
import { getOAuthOnlyAuth } from '@/lib/google-auth';
import { todayIso } from '@/lib/format';
import { managerForOrderCode, normalizeOrderCode } from './managers';

/**
 * «Журнал заказов» — лист в книге архива КП, где у каждого заказа со склада
 * есть дата и (если известна) сумма договора.
 *
 * Зачем: в листе «Заказы» у заказа есть только код (K49, MN15…), даты нет,
 * а реестр «Объекты» с датами заполнен лишь для первых ~40 заказов. Без даты
 * нельзя построить продажи за день/неделю/месяц.
 *
 * Как заполняется:
 *  - заказ уже есть в «Объекты» → дата и сумма оттуда (источник «реестр»);
 *  - при первом создании журнала у старых заказов без даты дата оценивается
 *    по порядку колонок между известными датами (источник «оценка» —
 *    в отчёте помечается «≈», владелец может исправить дату прямо в листе);
 *  - новый код, появившийся в «Заказы» позже, получает дату первого
 *    появления (источник «авто»). Журнал дописывается при открытии отчёта
 *    и ежедневным cron-запуском, так что дата точна до суток.
 *
 * Отчёт всегда читает дату и сумму из журнала — правки руками в листе
 * имеют приоритет над всем остальным.
 */

export const JOURNAL_SHEET_ID = '1O5aeKAbSc_UkDk7expSqaDO5dpUaQLyqWI40Vhp4MhE';
export const JOURNAL_TAB = 'Журнал заказов';
const HEADER = ['Код заказа', 'Менеджер', 'Дата', 'Источник даты', 'Сумма договора, $', 'Объект', 'Примечание'];

export type DateSource = 'реестр' | 'оценка' | 'авто' | 'вручную';

export interface JournalEntry {
  code: string;
  date: string | null; // ISO
  source: DateSource | string;
  contractAmount: number | null;
  projectName: string;
}

export interface RegistryInfo {
  date: string | null; // ISO
  contractAmount: number | null;
  projectName: string | null;
}

function isoToRu(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** «18.10.2026», «18.10.26», «2026-10-18» → ISO. */
export function parseAnyDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const mo = m[2].padStart(2, '0');
  const d = m[1].padStart(2, '0');
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${year}-${mo}-${d}`;
}

function parseAmount(raw: unknown): number | null {
  const s = String(raw ?? '').replace(/[\s  $]/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const dayMs = 24 * 3600 * 1000;
const isoToMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const msToIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Оценка дат для заказов без даты: колонки «Заказы» идут по времени,
 * поэтому дата заказа между двумя известными — линейная интерполяция.
 * Концы: до первой известной даты — она сама, после последней —
 * интерполяция до сегодняшнего дня.
 */
export function estimateDates(codes: string[], known: Map<string, string>, today: string): Map<string, string> {
  const anchors: { i: number; ms: number }[] = [];
  codes.forEach((c, i) => { const d = known.get(c); if (d) anchors.push({ i, ms: isoToMs(d) }); });
  const lastIdx = codes.length - 1;
  if (!anchors.length || anchors[anchors.length - 1].i !== lastIdx) {
    const lastKnown = anchors.length ? anchors[anchors.length - 1].ms : isoToMs(today);
    anchors.push({ i: lastIdx, ms: Math.max(isoToMs(today), lastKnown) });
  }
  const out = new Map<string, string>();
  codes.forEach((c, i) => {
    if (known.has(c)) return;
    const next = anchors.find(a => a.i >= i)!;
    const prev = [...anchors].reverse().find(a => a.i <= i);
    if (!prev || prev.i === next.i) { out.set(c, msToIso(next.ms)); return; }
    const t = (i - prev.i) / (next.i - prev.i);
    const ms = prev.ms + Math.max(0, next.ms - prev.ms) * t;
    out.set(c, msToIso(Math.round(ms / dayMs) * dayMs));
  });
  return out;
}

async function readJournal(sheets: ReturnType<typeof google.sheets>): Promise<{ exists: boolean; entries: Map<string, JournalEntry> }> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: JOURNAL_SHEET_ID, fields: 'sheets.properties.title' });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === JOURNAL_TAB);
  const entries = new Map<string, JournalEntry>();
  if (!exists) return { exists, entries };

  const res = await sheets.spreadsheets.values.get({ spreadsheetId: JOURNAL_SHEET_ID, range: `'${JOURNAL_TAB}'!A2:G5000` });
  for (const r of (res.data.values || []) as string[][]) {
    const code = String(r[0] || '').trim();
    if (!code) continue;
    const key = normalizeOrderCode(code);
    if (entries.has(key)) continue; // дубль от параллельной дозаписи — первая строка главная
    entries.set(key, {
      code,
      date: parseAnyDate(r[2]),
      source: String(r[3] || '').trim(),
      contractAmount: parseAmount(r[4]),
      projectName: String(r[5] || '').trim(),
    });
  }
  return { exists, entries };
}

/**
 * Читает журнал и дописывает в него коды, которых там ещё нет.
 * Ошибка записи (нет прав, лимит API) не ломает отчёт — тогда для новых
 * кодов используются вычисленные на лету значения без сохранения.
 */
export async function syncOrdersJournal(
  orderCodes: string[],
  registry: Map<string, RegistryInfo>,
): Promise<{ entries: Map<string, JournalEntry>; written: number; error?: string }> {
  const auth = getOAuthOnlyAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const today = todayIso();

  const { exists, entries } = await readJournal(sheets);

  const uniqueCodes: string[] = [];
  const seen = new Set<string>();
  for (const c of orderCodes) {
    const k = normalizeOrderCode(c);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    uniqueCodes.push(c);
  }

  const missing = uniqueCodes.filter(c => !entries.has(normalizeOrderCode(c)));
  if (!missing.length) return { entries, written: 0 };

  // Даты для оценки: журнал (уже исправленные владельцем) + реестр.
  const known = new Map<string, string>();
  for (const c of uniqueCodes) {
    const k = normalizeOrderCode(c);
    const d = entries.get(k)?.date || registry.get(k)?.date;
    if (d) known.set(c, d);
  }
  const estimated = !exists ? estimateDates(uniqueCodes, known, today) : new Map<string, string>();

  const newRows: string[][] = [];
  for (const code of missing) {
    const k = normalizeOrderCode(code);
    const reg = registry.get(k);
    let date: string;
    let source: DateSource;
    if (reg?.date) { date = reg.date; source = 'реестр'; }
    else if (estimated.has(code)) { date = estimated.get(code)!; source = 'оценка'; }
    else { date = today; source = 'авто'; }

    const manager = managerForOrderCode(code);
    const entry: JournalEntry = {
      code, date, source,
      contractAmount: reg?.contractAmount ?? null,
      projectName: reg?.projectName || '',
    };
    entries.set(k, entry);
    newRows.push([
      code,
      manager?.name || '',
      isoToRu(date),
      source,
      entry.contractAmount != null ? String(entry.contractAmount) : '',
      entry.projectName,
      source === 'оценка' ? 'дата примерная — исправьте, если знаете точную' : '',
    ]);
  }

  try {
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: JOURNAL_SHEET_ID,
        requestBody: { requests: [{ addSheet: { properties: { title: JOURNAL_TAB, gridProperties: { frozenRowCount: 1 } } } }] },
      });
      newRows.unshift(HEADER);
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId: JOURNAL_SHEET_ID,
      range: `'${JOURNAL_TAB}'!A1`,
      // RAW: даты пишем текстом «18.10.2026», чтобы локаль таблицы не превратила их в число
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: newRows },
    });
    return { entries, written: newRows.length - (exists ? 0 : 1) };
  } catch (err: any) {
    console.error('Журнал заказов: не удалось дописать', err);
    return { entries, written: 0, error: err?.message || String(err) };
  }
}
