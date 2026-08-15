/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel собирает каждую функцию из прослеженных зависимостей и не берёт
  // файлы, к которым нет статической ссылки. Шаблоны читаются по строковому
  // пути через fs, поэтому их надо включить явно — иначе генерация КП и
  // договора падает в проде на «файл не найден».
  outputFileTracingIncludes: {
    '/api/generate': ['./templates/**'],
    '/api/contract': ['./templates/**'],
  },

  // Заголовки безопасности на каждый ответ. Проверка показала, что их не было
  // вовсе, а приложение стоит за авторизацией и работает с деньгами и КП.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Запрет встраивания в чужой iframe (кликджекинг).
          { key: 'X-Frame-Options', value: 'DENY' },
          // Браузер не угадывает MIME — только объявленный.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Реферер не утекает на сторонние сайты.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Отключаем ненужные приложению возможности.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
