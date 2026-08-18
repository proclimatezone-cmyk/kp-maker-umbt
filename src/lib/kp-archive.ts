import { google } from 'googleapis';
import { Readable } from 'stream';
import { getOAuthOnlyAuth } from './google-auth';

/**
 * Архив всех КП, сгенерированных через сайт: копия файла на Диск (папки
 * «Все кп новые от UMBT» → Word / PDF) + строка в листе «все кпшки»
 * (кто, с какого логина, когда, на что — чтобы владелец мог быстро найти
 * нужный файл, не копаясь в почте менеджеров).
 */

const ARCHIVE_SHEET_ID = '1O5aeKAbSc_UkDk7expSqaDO5dpUaQLyqWI40Vhp4MhE';
const ARCHIVE_SHEET_TAB = 'все кпшки';

const WORD_FOLDER_ID = '1xzBUz1j74KZS0ne3iKs9yvzdyXP0iC-b';
const PDF_FOLDER_ID = '1TGYgxSZXytFVA9omnel2QR5v2EDHt5U8';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';

export interface ArchiveKpInput {
  cpNumber: string;
  client: string;
  manager: string;
  login: string;
  total: number | string;
  docx?: Buffer | null;
  pdf?: Buffer | null;
}

/** Имя файла на Диске: без «/» и переносов строк, разумной длины. */
function fileBaseName(input: ArchiveKpInput): string {
  const stamp = new Date().toLocaleString('ru-RU', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).replace(/[.:]/g, '-').replace(/,?\s+/g, '_');

  const parts = [input.cpNumber || 'КП', input.client || '', stamp].filter(Boolean);
  return parts.join(' — ').replace(/[\/\\\r\n]+/g, ' ').trim().slice(0, 150) || `КП_${stamp}`;
}

async function uploadFile(
  auth: ReturnType<typeof getOAuthOnlyAuth>,
  folderId: string,
  name: string,
  mimeType: string,
  buffer: Buffer
): Promise<string> {
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.create({
    requestBody: { name, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'webViewLink',
  });
  if (!res.data.webViewLink) throw new Error('Диск не вернул ссылку на загруженный файл');
  return res.data.webViewLink;
}

/**
 * Сохраняет КП в архив. Никогда не бросает исключение — вызывающая сторона
 * не должна терять готовый файл менеджера из-за сбоя архивации, поэтому
 * ошибка только логируется, а функция возвращает то, что удалось сохранить.
 */
export async function archiveKp(input: ArchiveKpInput): Promise<{ wordLink: string; pdfLink: string }> {
  const result = { wordLink: '', pdfLink: '' };
  try {
    const auth = getOAuthOnlyAuth();
    const name = fileBaseName(input);

    const [wordLink, pdfLink] = await Promise.all([
      input.docx ? uploadFile(auth, WORD_FOLDER_ID, `${name}.docx`, DOCX_MIME, input.docx) : Promise.resolve(''),
      input.pdf ? uploadFile(auth, PDF_FOLDER_ID, `${name}.pdf`, PDF_MIME, input.pdf) : Promise.resolve(''),
    ]);
    result.wordLink = wordLink;
    result.pdfLink = pdfLink;

    // Тем же аккаунтом, что грузил файлы — у сервис-аккаунта нет прав записи
    // в эту таблицу локально, дублировать логику подбора авторизации незачем.
    const sheets = google.sheets({ version: 'v4', auth });
    const timestamp = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' });
    await sheets.spreadsheets.values.append({
      spreadsheetId: ARCHIVE_SHEET_ID,
      range: `'${ARCHIVE_SHEET_TAB}'!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          timestamp,
          input.manager || '',
          input.login || '',
          input.client || '',
          input.cpNumber || '',
          input.total ?? '',
          wordLink,
          pdfLink,
        ]],
      },
    });
  } catch (err) {
    console.error('Архив КП: не удалось сохранить', err);
  }
  return result;
}
