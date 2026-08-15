import { NextRequest, NextResponse } from 'next/server';
import { getStock, indexByArticle, indexNamesByArticle } from '@/lib/stock';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const force = req.nextUrl.searchParams.get('refresh') === 'true';
    const rows = await getStock(force);
    return NextResponse.json({
      success: true,
      updatedAt: new Date().toISOString(),
      count: rows.length,
      byArticle: indexByArticle(rows),
      namesByArticle: indexNamesByArticle(rows),
    });
  } catch (err: any) {
    // Чаще всего это отсутствие доступа к таблице — сообщение должно
    // подсказать, что чинить, а не просто «ошибка».
    const message: string = err?.message || 'Не удалось прочитать остатки';
    const denied = /permission|not found|403|404/i.test(message);
    console.error('Ошибка чтения остатков:', err);
    return NextResponse.json(
      {
        success: false,
        error: denied
          ? 'Нет доступа к таблице остатков. Откройте её на чтение для аккаунта, под которым работает приложение.'
          : message,
      },
      { status: 500 }
    );
  }
}
