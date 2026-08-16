import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import { driveFileId } from '@/lib/docx-kp';

export const dynamic = 'force-dynamic';

/**
 * Открытая проверка доступа к фото: берёт Drive-ссылку (?url= или ?id=) и
 * пытается скачать файл авторизованно, как это делает генератор КП.
 * Показывает, получил ли настоящее изображение — чтобы подтвердить, что
 * аккаунт приложения видит фото, без генерации целого КП и без логина.
 */
const PRICE_SHEET_ID = '1O5aeKAbSc_UkDk7expSqaDO5dpUaQLyqWI40Vhp4MhE';

async function checkOne(id: string) {
  const drive = google.drive({ version: 'v3', auth: getGoogleAuth() });
  try {
    const m = await drive.files.get({ fileId: id, fields: 'name,mimeType' });
    const res = await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'arraybuffer' });
    const b = Buffer.from(res.data as ArrayBuffer);
    const ok = (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50);
    return { id, name: m.data.name, sizeBytes: b.length, ok, verdict: ok ? 'фото ок' : 'скачалось, но не картинка' };
  } catch (e: any) {
    return { id, ok: false, error: e.message };
  }
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  // Без параметров — берём актуальные ссылки на фото прямо из прайса
  // (колонка W «для кп»), а не из устаревшего products.json.
  if (!p.get('id') && !p.get('url')) {
    try {
      const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: PRICE_SHEET_ID, range: "'для кп'!A2:W" });
      const rows = (r.data.values || []) as string[][];
      const urls: string[] = [];
      for (const row of rows) {
        const u = row[22]; // W
        const id = u && driveFileId(u);
        if (id) urls.push(id);
        if (urls.length >= 5) break;
      }
      if (!urls.length) {
        return NextResponse.json({ ok: false, error: 'В колонке W «для кп» не найдено Drive-ссылок на фото' });
      }
      const results = await Promise.all(urls.map(checkOne));
      const good = results.filter(x => x.ok).length;

      // Сквозной тест: собираем КП с настоящим фото из прайса и считаем,
      // сколько картинок реально вставилось в документ.
      let buildTest: any = 'пропущен';
      if (good > 0) {
        try {
          const { buildKpDocx } = await import('@/lib/docx-kp');
          const PizZip = (await import('pizzip')).default;
          const firstId = results.find(x => x.ok)!.id;
          const buf = await buildKpDocx({
            cpNumber: 'PHOTO-TEST', cpDate: '16.08.2026',
            items: [{ model: 'TEST', category: 'Наружный блок', quantity: 1, price: 1000,
              slidesImage: `https://drive.google.com/uc?id=${firstId}` }],
            total: 1000,
            options: { deliveryTerms: 'warehouse', warrantyMonths: 36, showImages: true },
            origin: req.nextUrl.origin,
          });
          const zip = new PizZip(buf);
          const media = Object.keys(zip.files).filter(f => f.includes('media/image_generated'));
          // 70 байт = пустой BLANK_PNG (фото не легло); больше = реальное фото
          const realPhotos = media.filter(f => zip.files[f].asUint8Array().length > 500).length;
          buildTest = {
            sizeMB: +(buf.length / 1048576).toFixed(2),
            встроеноФото: realPhotos,
            вердикт: realPhotos > 0 ? 'ФОТО ВСТАВЛЯЕТСЯ В КП ✓' : 'фото не легло',
          };
        } catch (e: any) {
          buildTest = 'ошибка сборки: ' + e.message;
        }
      }

      return NextResponse.json({ ok: good > 0, tested: results.length, accessible: good, buildTest, results: results.slice(0, 2) });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: 'Не удалось прочитать прайс: ' + e.message });
    }
  }

  const raw = p.get('url') || (p.get('id') ? `id=${p.get('id')}` : '');
  const id = driveFileId(raw) || p.get('id') || '';

  try {
    const drive = google.drive({ version: 'v3', auth: getGoogleAuth() });

    // Метаданные: имя, тип, размер, кто владелец — видит ли их аккаунт вообще.
    let meta: any = {};
    try {
      const m = await drive.files.get({ fileId: id, fields: 'name,mimeType,size,owners(emailAddress)' });
      meta = m.data;
    } catch (e: any) {
      return NextResponse.json({ ok: false, id, error: 'Файл недоступен аккаунту: ' + e.message });
    }

    const res = await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'arraybuffer' });
    const b = Buffer.from(res.data as ArrayBuffer);
    const isJpeg = b[0] === 0xff && b[1] === 0xd8;
    const isPng = b[0] === 0x89 && b[1] === 0x50;
    const kind = isJpeg ? 'JPEG' : isPng ? 'PNG' : `неизвестно (${b.slice(0, 4).toString('hex')})`;

    return NextResponse.json({
      ok: isJpeg || isPng,
      id,
      name: meta.name,
      mimeType: meta.mimeType,
      sizeBytes: b.length,
      detected: kind,
      verdict: isJpeg || isPng ? 'Фото скачивается — генератор его вставит' : 'Скачалось, но это не картинка',
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, id, error: e.message });
  }
}
