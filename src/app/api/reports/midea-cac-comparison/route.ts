import { NextResponse } from 'next/server';
import { getMideaCacComparisonReport } from '@/lib/reports/cache';

export async function GET() {
  try {
    const report = await getMideaCacComparisonReport();
    return NextResponse.json(report);
  } catch (err: any) {
    console.error('Error building Midea CAC comparison report:', err);
    return NextResponse.json({ error: 'Не удалось получить сравнение с прайсом Midea' }, { status: 500 });
  }
}
