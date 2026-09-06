import { google } from 'googleapis';
import { getGoogleAuth } from './google-auth';

/**
 * Сохранённые подборы КП — не архив готовых файлов (это уже делает
 * kp-archive.ts, копируя .docx/.pdf на Диск и в лист «все кпшки»), а
 * структурированные данные подбора (какие позиции, кол-во, скидка, клиент,
 * менеджер), которых в файле нет — чтобы КП можно было открыть на сайте
 * заново и продолжить редактировать, а не начинать с нуля.
 *
 * Хранилище — отдельная вкладка «Сохранённые КП» в том же гугл-листе, что и
 * каталог: сервис-аккаунт туда уже имеет доступ на запись, отдельная база
 * не нужна. Сложные поля (items/options/...) лежат как JSON-строка в ячейке
 * — Sheets не умеет вложенные структуры, а объём (сотни, не миллионы строк)
 * не требует настоящей БД.
 */

const SPREADSHEET_ID = '1O5aeKAbSc_UkDk7expSqaDO5dpUaQLyqWI40Vhp4MhE';
const SHEET_TAB = 'Сохранённые КП';
const RANGE = `'${SHEET_TAB}'!A2:L`;

export interface SavedKpRecord {
  kpNumber: string;
  kpDate: string;
  manager: { name?: string; phone?: string; email?: string };
  client: string;
  extra: {
    company?: string;
    address?: string;
    objectType?: string;
    registrationDate?: string;
    equipmentType?: string;
    contactPerson?: { name?: string; phone?: string; position?: string };
  };
  items: { id: string; productId: string; quantity: number; discount?: number }[];
  additionalItems: { id: string; name: string; quantity: string; price: number }[];
  options: Record<string, unknown>;
  total: number;
  source: 'generated' | 'imported';
  /** Email вошедшего пользователя (из сессии) — каждый видит только свои
   *  сохранённые КП, см. listKpSelections. Пусто, если сохранено до этого
   *  поля или сессия не определилась. */
  login?: string;
}

export interface SavedKpListItem {
  kpNumber: string;
  kpDate: string;
  client: string;
  manager: string;
  total: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

function sheetsClient() {
  return google.sheets({ version: 'v4', auth: getGoogleAuth() });
}

function toRow(rec: SavedKpRecord, createdAt: string, updatedAt: string): string[] {
  return [
    rec.kpNumber,
    rec.kpDate,
    JSON.stringify(rec.manager || {}),
    JSON.stringify({ client: rec.client, ...rec.extra }),
    JSON.stringify(rec.items || []),
    JSON.stringify(rec.additionalItems || []),
    JSON.stringify(rec.options || {}),
    String(rec.total ?? ''),
    rec.source || 'generated',
    createdAt,
    updatedAt,
    rec.login || '',
  ];
}

function fromRow(row: string[]): (SavedKpRecord & { createdAt: string; updatedAt: string }) | null {
  if (!row || !row[0]) return null;
  try {
    const manager = JSON.parse(row[2] || '{}');
    const clientBlob = JSON.parse(row[3] || '{}');
    const { client, ...extra } = clientBlob;
    return {
      kpNumber: row[0],
      kpDate: row[1] || '',
      manager,
      client: client || '',
      extra,
      items: JSON.parse(row[4] || '[]'),
      additionalItems: JSON.parse(row[5] || '[]'),
      options: JSON.parse(row[6] || '{}'),
      total: Number(row[7]) || 0,
      source: (row[8] as 'generated' | 'imported') || 'generated',
      createdAt: row[9] || '',
      updatedAt: row[10] || '',
      login: row[11] || '',
    };
  } catch (err) {
    console.error('Сохранённые КП: не удалось разобрать строку', err);
    return null;
  }
}

/**
 * Сохраняет подбор (upsert по номеру КП). Никогда не бросает исключение —
 * как и архивация файлов, это вспомогательная запись: не должна ронять
 * основной сценарий генерации/скачивания КП при сбое.
 */
export async function saveKpSelection(rec: SavedKpRecord): Promise<void> {
  if (!rec.kpNumber) return;
  try {
    const sheets = sheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
    const rows = resp.data.values || [];
    const idx = rows.findIndex(r => r[0] === rec.kpNumber);
    const now = new Date().toISOString();
    const createdAt = idx >= 0 ? (rows[idx][9] || now) : now;
    const row = toRow(rec, createdAt, now);

    if (idx >= 0) {
      const sheetRow = idx + 2; // +2: заголовок (1) + 1-индексация
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_TAB}'!A${sheetRow}:K${sheetRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [row] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_TAB}'!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] },
      });
    }
  } catch (err) {
    console.error('Сохранённые КП: не удалось сохранить', err);
  }
}

export async function getKpSelection(kpNumber: string) {
  const sheets = sheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
  const rows = resp.data.values || [];
  const row = rows.find(r => r[0] === kpNumber);
  return row ? fromRow(row as string[]) : null;
}

/**
 * @param login если задан — только КП этого пользователя (у каждого
 *   менеджера свой список, чтобы не видеть чужие подборы). Без него —
 *   все записи (для сценариев без сессии/отладки).
 */
export async function listKpSelections(login?: string): Promise<SavedKpListItem[]> {
  const sheets = sheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
  const rows = (resp.data.values || []) as string[][];
  const list: SavedKpListItem[] = [];
  for (const row of rows) {
    const parsed = fromRow(row);
    if (!parsed) continue;
    if (login && parsed.login !== login) continue;
    list.push({
      kpNumber: parsed.kpNumber,
      kpDate: parsed.kpDate,
      client: parsed.client,
      manager: parsed.manager?.name || '',
      total: parsed.total,
      source: parsed.source,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    });
  }
  list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return list;
}
