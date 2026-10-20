import { NextRequest, NextResponse } from 'next/server';
import { getManagerAnalytics } from '@/lib/reports/cache';

export const dynamic = 'force-dynamic';

// Доступ уже закрыт middleware.ts (REPORTS_ACCESS_EMAIL) — здесь только данные.
export async function GET(req: NextRequest) {
  try {
    const force = req.nextUrl.searchParams.get('refresh') === 'true';
    return NextResponse.json(await getManagerAnalytics(force));
  } catch (err: any) {
    console.error('Error building manager analytics:', err);
    return NextResponse.json({ error: 'Не удалось собрать аналитику' }, { status: 500 });
  }
}
