import { NextResponse } from 'next/server';
import { getWelkinComparisonReport } from '@/lib/reports/cache';

export async function GET() {
  try {
    const report = await getWelkinComparisonReport();
    return NextResponse.json(report);
  } catch (err: any) {
    console.error('Error building Welkin comparison report:', err);
    return NextResponse.json({ error: 'Не удалось получить сравнение с Welkin' }, { status: 500 });
  }
}
