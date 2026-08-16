import { NextResponse } from 'next/server';
import { getPriceComparisonReport } from '@/lib/reports/cache';

export async function GET() {
  try {
    const report = await getPriceComparisonReport();
    return NextResponse.json(report);
  } catch (err: any) {
    console.error('Error building price comparison report:', err);
    return NextResponse.json({ error: 'Не удалось получить сравнение цен' }, { status: 500 });
  }
}
