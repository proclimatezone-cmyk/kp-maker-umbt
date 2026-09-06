import { NextRequest, NextResponse } from 'next/server'
import { listKpSelections } from '@/lib/saved-kp'
import { getSessionEmail } from '@/lib/auth-session'

/**
 * Список сохранённых подборов — для раздела «Сохранённые КП» на сайте.
 * Каждый менеджер видит только свои: без этого общий список быстро
 * становится нечитаемым (десятки чужих КП вперемешку), а на своих чужие
 * данные клиента видеть тоже незачем.
 */
export async function GET(req: NextRequest) {
  try {
    const login = await getSessionEmail(req)
    const list = await listKpSelections(login || undefined)
    return NextResponse.json({ success: true, list })
  } catch (err: any) {
    console.error('Ошибка списка сохранённых КП:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
