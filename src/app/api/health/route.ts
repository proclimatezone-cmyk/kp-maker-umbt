import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Открытый эндпоинт (без авторизации) — чтобы снаружи проверить, какая
// версия кода реально развёрнута, и не гадать при отладке.
export async function GET() {
  return NextResponse.json({
    ok: true,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local',
    builtAt: process.env.VERCEL_DEPLOYMENT_ID ? 'vercel' : 'local',
    // Признаки ключевых фиксов — видно, доехали ли они до прода.
    features: ['docx-generate', 'size-guard', 'image-shrink', 'stock-v2'],
  });
}
