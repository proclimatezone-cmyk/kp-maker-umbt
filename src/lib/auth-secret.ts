const MIN_SECRET_LENGTH = 32;

/**
 * Ключ подписи сессионных токенов. Никаких значений по умолчанию:
 * репозиторий публичный, и любой fallback здесь означает, что токен
 * сможет подписать кто угодно. Нет переменной — приложение не пускает никого.
 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters. ` +
      'Set it in the environment (Vercel > Settings > Environment Variables) before starting the app.'
    );
  }

  return new TextEncoder().encode(secret);
}
