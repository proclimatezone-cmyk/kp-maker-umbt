import { google } from 'googleapis';
import { Readable } from 'stream';
import { getOAuthOnlyAuth } from './google-auth';

/**
 * Превращает .docx в PDF руками Google: файл заливается на Drive с
 * конвертацией в Google Docs, выгружается как PDF и удаляется.
 *
 * Замер (окт. 2026): загрузка+конвертация ≈3 с, выгрузка PDF ≈1 с, удаление
 * ≈0.3 с — и от размера файла это почти не зависит (пустой документ
 * конвертируется столько же). Поэтому ускоряем не файл, а всё вокруг:
 *  - один OAuth-клиент на процесс — токен (0.1–0.5 с) не запрашивается
 *    заново на каждый PDF;
 *  - удаление временного файла — после ответа (onCleanup → after());
 *  - главное — PDF готовится заранее, пока менеджер заполняет КП
 *    (см. prefetch в /api/generate и page.tsx), к нажатию кнопки он уже готов.
 *
 * Авторизация — строго OAuth (getOAuthOnlyAuth), не сервис-аккаунт: у
 * сервис-аккаунта нет квоты на хранение файлов на Drive, загрузка .docx
 * падает с storageQuotaExceeded ещё до конвертации.
 */
let driveClient: ReturnType<typeof google.drive> | null = null;
function getDrive() {
  // OAuth2-клиент сам обновляет access token по refresh token и держит его
  // до истечения — переиспользуем его между запросами одного инстанса.
  if (!driveClient) driveClient = google.drive({ version: 'v3', auth: getOAuthOnlyAuth() });
  return driveClient;
}

export async function convertDocxToPdf(
  docx: Buffer,
  fileName: string,
  opts?: { onCleanup?: (cleanup: () => Promise<void>) => void },
): Promise<Buffer> {
  const drive = getDrive();

  const uploaded = await drive.files.create({
    requestBody: {
      name: fileName,
      // Просим Google сконвертировать загруженный .docx в свой формат.
      mimeType: 'application/vnd.google-apps.document',
    },
    media: {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: Readable.from(docx),
    },
    fields: 'id',
  });

  const fileId = uploaded.data.id;
  if (!fileId) throw new Error('Google не вернул идентификатор загруженного файла');

  // Промежуточный файл не нужен ни при успехе, ни при ошибке. Если вызывающий
  // умеет отложить работу (after() в роуте) — удаляем уже после ответа.
  const cleanup = async () => {
    try {
      await drive.files.delete({ fileId });
    } catch (err) {
      console.warn('Не удалось удалить временный файл с Drive:', fileId, err);
    }
  };

  try {
    const exported = await drive.files.export(
      { fileId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' }
    );
    return Buffer.from(exported.data as ArrayBuffer);
  } finally {
    if (opts?.onCleanup) opts.onCleanup(cleanup);
    else await cleanup();
  }
}
