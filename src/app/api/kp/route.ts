import { NextResponse } from 'next/server'
import { listKpSelections } from '@/lib/saved-kp'

/** Список сохранённых подборов — для раздела «Сохранённые КП» на сайте. */
export async function GET() {
  try {
    const list = await listKpSelections()
    return NextResponse.json({ success: true, list })
  } catch (err: any) {
    console.error('Ошибка списка сохранённых КП:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
