import { NextResponse } from 'next/server';
import { getHofmannComparisonReport } from '@/lib/reports/cache';

// Доступ закрыт middleware.ts (REPORTS_ACCESS_EMAIL) — как у Welkin.
export async function GET() {
  try {
    return NextResponse.json(await getHofmannComparisonReport());
  } catch (err: any) {
    console.error('Error building Hofmann comparison report:', err);
    return NextResponse.json({ error: 'Не удалось получить сравнение с Hofmann' }, { status: 500 });
  }
}
