import type { SheetGrid } from './sheet-source';
import { parseMatrixSheet } from './parse-matrix';
import { parseRuDate } from './parse-utils';

interface BookingColumnMeta {
  bookingNo: string | null;
  date: string | null;
  monthKey: string | null;
  client: string;
  note: string;
  /** «Стенд фреон + вода», «Шоурум офис» — служебный резерв, не бронь клиента. */
  isInternal: boolean;
}

const columnMetaCache = new Map<string, BookingColumnMeta>();

/**
 * Заголовок брони — свободный текст в одной ячейке, например:
 * "Бронь №11\n от 03.08.26\n Объект Мухаммад\n010826/04MN\n1000 $ залог".
 * Менеджера в этих данных нет вообще — группировка честно идёт по клиенту/объекту.
 */
function parseColumnHeader(headerText: string): BookingColumnMeta {
  const cached = columnMetaCache.get(headerText);
  if (cached) return cached;

  const noMatch = headerText.match(/Бронь\s*№\s*(\d+)/i);
  const dateMatch = headerText.match(/от\s*(\d{2}\.\d{2}\.\d{2})/);
  const clientMatch = headerText.match(/Объект\s+([^\n]+)/i);

  const isInternal = !noMatch;
  const parsedDate = dateMatch ? parseRuDate(dateMatch[1]) : null;

  const lines = headerText.split('\n').map((l) => l.trim()).filter(Boolean);
  const noteLines = lines.filter(
    (l) => !/^бронь\s*№/i.test(l) && !/^от\s*\d{2}\.\d{2}\.\d{2}/i.test(l) && !/^объект\s+/i.test(l)
  );

  const meta: BookingColumnMeta = {
    bookingNo: noMatch ? noMatch[1] : null,
    date: parsedDate?.iso ?? null,
    monthKey: parsedDate?.monthKey ?? null,
    client: isInternal ? lines[0] || headerText : (clientMatch ? clientMatch[1].trim() : 'Без объекта'),
    note: noteLines.join(' · '),
    isInternal,
  };
  columnMetaCache.set(headerText, meta);
  return meta;
}

export interface BookingRecord {
  category: string;
  series: string;
  model: string;
  qty: number;
  columnHeader: string;
  bookingNo: string | null;
  date: string | null;
  monthKey: string | null;
  client: string;
  note: string;
  isInternal: boolean;
}

export interface BookingsReport {
  records: BookingRecord[];
  byClient: { client: string; qty: number; bookingNumbers: string[] }[];
  totalQty: number;
  activeBookingsCount: number;
}

export function computeBookingsReport(bookings: SheetGrid): BookingsReport {
  const { rows } = parseMatrixSheet(bookings);

  const records: BookingRecord[] = [];
  const bookingNumbers = new Set<string>();

  for (const row of rows) {
    for (const cell of row.cells) {
      const meta = parseColumnHeader(cell.header);
      if (meta.bookingNo) bookingNumbers.add(meta.bookingNo);
      records.push({
        category: row.category,
        series: row.series,
        model: row.model,
        qty: cell.qty,
        columnHeader: cell.header,
        bookingNo: meta.bookingNo,
        date: meta.date,
        monthKey: meta.monthKey,
        client: meta.client,
        note: meta.note,
        isInternal: meta.isInternal,
      });
    }
  }

  const byClientMap = new Map<string, { qty: number; bookingNumbers: Set<string> }>();
  let totalQty = 0;

  for (const rec of records) {
    if (rec.isInternal) continue; // служебные резервы не считаем как бронь клиента
    totalQty += rec.qty;
    const entry = byClientMap.get(rec.client) || { qty: 0, bookingNumbers: new Set<string>() };
    entry.qty += rec.qty;
    if (rec.bookingNo) entry.bookingNumbers.add(rec.bookingNo);
    byClientMap.set(rec.client, entry);
  }

  const byClient = [...byClientMap.entries()]
    .map(([client, v]) => ({ client, qty: v.qty, bookingNumbers: [...v.bookingNumbers].sort((a, b) => Number(a) - Number(b)) }))
    .sort((a, b) => b.qty - a.qty);

  return {
    records,
    byClient,
    totalQty,
    activeBookingsCount: bookingNumbers.size,
  };
}
