import { NextResponse } from 'next/server';
import { getSalesReport } from '@/lib/reports/cache';

// Доступ уже закрыт middleware.ts (REPORTS_ACCESS_EMAIL) — здесь только данные.
export async function GET() {
  try {
    const report = await getSalesReport();
    return NextResponse.json(report);
  } catch (err: any) {
    console.error('Error building sales report:', err);
    return NextResponse.json({ error: 'Не удалось получить данные продаж' }, { status: 500 });
  }
}
