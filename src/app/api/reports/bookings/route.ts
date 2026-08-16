import { NextResponse } from 'next/server';
import { getBookingsReport } from '@/lib/reports/cache';

export async function GET() {
  try {
    const report = await getBookingsReport();
    return NextResponse.json(report);
  } catch (err: any) {
    console.error('Error building bookings report:', err);
    return NextResponse.json({ error: 'Не удалось получить данные брони' }, { status: 500 });
  }
}
