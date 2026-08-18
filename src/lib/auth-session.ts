import { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { getJwtSecret } from './auth-secret';

/**
 * Email авторизованного пользователя из httpOnly-куки umbt_auth.
 * Логика продублирована из middleware.ts/api/auth/me — там она встроена
 * в конкретный флоу (редиректы/404), здесь нужен только сам email,
 * без побочных эффектов.
 */
export async function getSessionEmail(req: NextRequest): Promise<string> {
  const token = req.cookies.get('umbt_auth')?.value;
  if (!token) return '';
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return typeof payload.email === 'string' ? payload.email : '';
  } catch {
    return '';
  }
}
