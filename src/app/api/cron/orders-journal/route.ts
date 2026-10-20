import { NextRequest, NextResponse } from 'next/server';
import { getManagerAnalytics } from '@/lib/reports/cache';

export const dynamic = 'force-dynamic';

/**
 * Ежедневный запуск (vercel.json → crons): дописывает новые коды заказов
 * в «Журнал заказов», чтобы дата заказа фиксировалась даже в дни, когда
 * отчёт никто не открывал. Vercel передаёт `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const data = await getManagerAnalytics(true);
    return NextResponse.json({ ok: true, orders: data.orders.length, written: data.journal.written, error: data.journal.error });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
