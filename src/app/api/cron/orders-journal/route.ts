import { NextRequest, NextResponse } from 'next/server';
import { getManagerAnalytics } from '@/lib/reports/cache';

export const dynamic = 'force-dynamic';

/**
 * Ежедневный запуск (vercel.json → crons): дописывает новые коды заказов
 * в «Журнал заказов», чтобы дата заказа фиксировалась даже в дни, когда
 * отчёт никто не открывал. Vercel передаёт `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  // С CRON_SECRET — строгая проверка. Без него принимаем вызов планировщика
  // Vercel по его user-agent: роут только дописывает даты новых заказов в
  // журнал (идемпотентно, ничего не отдаёт наружу), так что подделка
  // заголовка ничем не грозит, а cron работает без ручной настройки.
  const secret = process.env.CRON_SECRET;
  const authorized = secret
    ? req.headers.get('authorization') === `Bearer ${secret}`
    : /^vercel-cron\//i.test(req.headers.get('user-agent') || '');
  if (!authorized) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const data = await getManagerAnalytics(true);
    return NextResponse.json({ ok: true, orders: data.orders.length, written: data.journal.written, error: data.journal.error });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
