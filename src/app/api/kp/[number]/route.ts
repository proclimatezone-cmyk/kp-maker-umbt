import { NextResponse } from 'next/server'
import { getKpSelection } from '@/lib/saved-kp'

/** Один сохранённый подбор по номеру КП — для повторного открытия на сайте. */
export async function GET(_req: Request, context: { params: Promise<{ number: string }> }) {
  try {
    const { number } = await context.params
    const rec = await getKpSelection(decodeURIComponent(number))
    if (!rec) return NextResponse.json({ success: false, error: 'КП с таким номером не найден' }, { status: 404 })
    return NextResponse.json({ success: true, kp: rec })
  } catch (err: any) {
    console.error('Ошибка чтения сохранённого КП:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
