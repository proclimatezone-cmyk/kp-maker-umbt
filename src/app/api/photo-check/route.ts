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
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const raw = p.get('url') || (p.get('id') ? `id=${p.get('id')}` : '');
  const id = driveFileId(raw) || p.get('id') || '';

  if (!id) {
    return NextResponse.json({ ok: false, error: 'Передайте ?id=<driveId> или ?url=<ссылка Drive>' });
  }

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
