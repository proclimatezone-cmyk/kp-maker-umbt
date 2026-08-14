import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

/**
 * Доступ к Google: сервис-аккаунт, если он настроен, иначе OAuth от имени
 * человека, выдавшего refresh token.
 *
 * Раньше эта функция была скопирована в три файла и уже начала расходиться —
 * в одном месте у токена обрезались пробелы, в другом нет.
 */
export function getGoogleAuth() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: SCOPES,
    });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN?.trim() });
  return oauth2Client;
}
