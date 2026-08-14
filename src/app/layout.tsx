import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'

/* Шрифт собирается вместе с приложением: без обращения к CDN на каждой
   загрузке и без «прыжка» текста, когда файл ещё не приехал. */
const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'UMBT CP Maker | Генератор Коммерческих Предложений',
  description: 'Автоматическое создание КП Midea для систем кондиционирования',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru" className={inter.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
