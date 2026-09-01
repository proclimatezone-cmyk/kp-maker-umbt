import { google } from 'googleapis';
import { Readable } from 'stream';
import { getOAuthOnlyAuth } from './google-auth';

/**
 * Превращает .docx в PDF руками Google: файл заливается на Drive с
 * конвертацией в Google Docs, выгружается как PDF и тут же удаляется.
 *
 * Собственного способа получить PDF у нас нет — для этого нужен LibreOffice
 * на своей машине или платный сервис. Поэтому путь медленный (несколько
 * секунд и зависимость от сети) и включается только по явному выбору
 * формата, а не при каждой генерации.
 *
 * Авторизация — строго OAuth (getOAuthOnlyAuth), не сервис-аккаунт: у
 * сервис-аккаунта нет квоты на хранение файлов на Drive, загрузка .docx
 * падает с storageQuotaExceeded ещё до конвертации.
 */
export async function convertDocxToPdf(docx: Buffer, fileName: string): Promise<Buffer> {
  const drive = google.drive({ version: 'v3', auth: getOAuthOnlyAuth() });

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

  try {
    const exported = await drive.files.export(
      { fileId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' }
    );
    return Buffer.from(exported.data as ArrayBuffer);
  } finally {
    // Промежуточный файл не нужен ни при успехе, ни при ошибке.
    try {
      await drive.files.delete({ fileId });
    } catch (err) {
      console.warn('Не удалось удалить временный файл с Drive:', fileId, err);
    }
  }
}
