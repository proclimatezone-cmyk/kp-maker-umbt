import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';

/** Таблица склада/заказов/брони — отдельная от той, что использует sync-sheets.mjs для «для кп». */
export const REPORTS_SPREADSHEET_ID = '1VfKkErXzc3qdDdlFMphmX6ysL60mpg5MGJWE1dYXIRk';

export interface SheetGrid {
  values: string[][];
}

/** Одним запросом тянет «Заказы», «Бронь» и «Объекты» — вместо трёх отдельных round-trip'ов. */
export async function fetchReportSheets(): Promise<{
  orders: SheetGrid;
  bookings: SheetGrid;
  objects: SheetGrid;
}> {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: REPORTS_SPREADSHEET_ID,
    ranges: ["'Заказы'!A1:EE400", "'Бронь'!A1:EE400", "'Объекты'!A1:Q1000"],
  });

  const [orders, bookings, objects] = res.data.valueRanges || [];
  return {
    orders: { values: (orders?.values as string[][]) || [] },
    bookings: { values: (bookings?.values as string[][]) || [] },
    objects: { values: (objects?.values as string[][]) || [] },
  };
}
