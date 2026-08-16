import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Пошаговый диагностический прогон. ?step=N ограничивает, до какого шага
 * идти, и каждый шаг возвращает JSON — так на Vercel видно, какой именно
 * импорт или вызов роняет функцию, без доступа к логам.
 */
export async function GET(req: NextRequest) {
  const maxStep = Number(req.nextUrl.searchParams.get('step') || 99);
  const steps: Record<string, string> = {};

  async function run(n: number, label: string, fn: () => Promise<string>) {
    if (n > maxStep) return false;
    try {
      steps[label] = await fn();
    } catch (e: any) {
      steps[label] = 'ОШИБКА: ' + (e?.message || String(e));
    }
    return true;
  }

  await run(1, 'template', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const p = path.join(process.cwd(), 'templates', 'kp-new.docx');
    return fs.existsSync(p) ? `есть, ${(fs.statSync(p).size / 1048576).toFixed(2)} МБ` : `НЕ НАЙДЕН: ${p}`;
  });

  await run(2, 'pizzip+docxtemplater', async () => {
    await import('pizzip');
    await import('docxtemplater');
    return 'импортированы';
  });

  await run(3, 'image-module', async () => {
    await import('docxtemplater-image-module-free');
    return 'импортирован';
  });

  await run(4, 'sharp', async () => {
    const sharp = (await import('sharp')).default;
    const out = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    return `работает, ${out.length} байт`;
  });

  await run(5, 'import docx-kp', async () => {
    await import('@/lib/docx-kp');
    return 'импортирован';
  });

  await run(6, 'buildNoImages', async () => {
    const { buildKpDocx } = await import('@/lib/docx-kp');
    const buf = await buildKpDocx({
      cpNumber: 'ST', cpDate: '15.08.2026',
      items: [{ model: 'T-1', category: 'Тест', quantity: 1, price: 100 }],
      total: 100, options: { deliveryTerms: 'cip', warrantyMonths: 36, showImages: false },
      origin: 'https://kp-umbt.vercel.app',
    });
    return `ок, ${(buf.length / 1048576).toFixed(2)} МБ`;
  });

  await run(7, 'buildWithImage', async () => {
    const { buildKpDocx } = await import('@/lib/docx-kp');
    const t0 = Date.now();
    const buf = await buildKpDocx({
      cpNumber: 'ST', cpDate: '15.08.2026',
      items: [{ model: 'MV8i-252WV2GN1(MA)', category: 'Наружный блок', quantity: 1, price: 5773,
        slidesImage: 'https://drive.google.com/uc?id=1BEHmIb14r2WSUw7HoAcKSLQXqlFgZuuY' }],
      total: 5773, options: { deliveryTerms: 'cip', warrantyMonths: 36, showImages: true },
      origin: 'https://kp-umbt.vercel.app',
    });
    return `ок, ${(buf.length / 1048576).toFixed(2)} МБ за ${Date.now() - t0}мс`;
  });

  return NextResponse.json({ ok: true, upTo: maxStep, steps });
}
