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

/**
 * Авторизация строго от живого человека (OAuth), никогда сервис-аккаунтом.
 *
 * Нужна для загрузки обычных (не Google-нативных) файлов на личный Диск:
 * у сервис-аккаунта нет своей квоты на хранение, и Google отказывает в
 * загрузке («Service Accounts do not have storage quota») даже если у него
 * есть права Редактора на папку. Работает только реальный аккаунт с квотой.
 */
export function getOAuthOnlyAuth() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('OAuth не настроен (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN) — загрузка на Диск недоступна');
  }
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN.trim() });
  return oauth2Client;
}
