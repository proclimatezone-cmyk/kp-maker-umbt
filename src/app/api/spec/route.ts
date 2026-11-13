import { NextRequest, NextResponse } from 'next/server'
import { getSessionEmail } from '@/lib/auth-session'
import { buildSpecPdf, canUseSpec } from '@/lib/spec-pdf'

export async function POST(req: NextRequest) {
  if (!canUseSpec(await getSessionEmail(req))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const { cpName, cpDate, items, rawItems } = await req.json()
    const list = Array.isArray(rawItems) && rawItems.length ? rawItems : items
    const pdf = await buildSpecPdf({ cpNumber: cpName || '', cpDate: cpDate || '', items: Array.isArray(list) ? list : [] })
    const name = encodeURIComponent(`Спецификация ${cpName || ''}.pdf`.replace(/[\\/]/g, '-'))
    return new NextResponse(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="spec.pdf"; filename*=UTF-8''${name}` },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Ошибка сборки спецификации' }, { status: 500 })
  }
}
