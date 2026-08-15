import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Открытый диагностический прогон сборки КП прямо на сервере: помогает
 * увидеть настоящую ошибку на рантайме Vercel, не имея доступа к логам.
 * Каждый шаг обёрнут отдельно, чтобы понять, где именно рвётся.
 * Никаких пользовательских данных — только зашитый образец.
 */
export async function GET() {
  const steps: Record<string, string> = {};

  // 1. Виден ли шаблон по пути, который использует генератор?
  try {
    const fs = await import('fs');
    const path = await import('path');
    const p = path.join(process.cwd(), 'templates', 'kp-new.docx');
    steps.template = fs.existsSync(p)
      ? `есть, ${(fs.statSync(p).size / 1024 / 1024).toFixed(2)} МБ`
      : `НЕ НАЙДЕН: ${p} (cwd=${process.cwd()})`;
  } catch (e: any) {
    steps.template = 'ошибка: ' + e.message;
  }

  // 2. Загружается ли sharp в этом рантайме?
  try {
    const sharp = (await import('sharp')).default;
    const out = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).jpeg().toBuffer();
    steps.sharp = `работает, тестовый JPEG ${out.length} байт`;
  } catch (e: any) {
    steps.sharp = 'НЕ РАБОТАЕТ: ' + e.message;
  }

  // 3. Полная сборка КП без картинок (только шаблон + текст).
  try {
    const { buildKpDocx } = await import('@/lib/docx-kp');
    const buf = await buildKpDocx({
      cpNumber: 'SELFTEST', cpDate: '15.08.2026',
      items: [{ model: 'TEST-1', category: 'Тест', quantity: 1, price: 100 }],
      total: 100,
      options: { deliveryTerms: 'cip', warrantyMonths: 36, showImages: false },
      origin: 'https://kp-umbt.vercel.app',
    });
    steps.buildNoImages = `ок, ${(buf.length / 1024 / 1024).toFixed(2)} МБ`;
  } catch (e: any) {
    steps.buildNoImages = 'ОШИБКА: ' + e.message;
  }

  // 4. Сборка с картинкой из Drive — здесь ловится и падение sharp, и медленный fetch.
  try {
    const { buildKpDocx } = await import('@/lib/docx-kp');
    const t0 = Date.now();
    const buf = await buildKpDocx({
      cpNumber: 'SELFTEST', cpDate: '15.08.2026',
      items: [{
        model: 'MV8i-252WV2GN1(MA)', category: 'Наружный блок',
        quantity: 1, price: 5773,
        slidesImage: 'https://drive.google.com/uc?id=1BEHmIb14r2WSUw7HoAcKSLQXqlFgZuuY',
      }],
      total: 5773,
      options: { deliveryTerms: 'cip', warrantyMonths: 36, showImages: true },
      origin: 'https://kp-umbt.vercel.app',
    });
    steps.buildWithImage = `ок, ${(buf.length / 1024 / 1024).toFixed(2)} МБ за ${Date.now() - t0}мс`;
  } catch (e: any) {
    steps.buildWithImage = 'ОШИБКА: ' + e.message;
  }

  return NextResponse.json({ ok: true, steps });
}
