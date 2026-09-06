import { NextRequest, NextResponse } from 'next/server'
import productsData from '@/data/products.json'
import { extractTextFromDocx, extractTextFromPdf, parseKpFromText } from '@/lib/kp-import'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * Загрузка готового КП (.docx/.pdf) — не гарантирует 100% распознавания
 * (см. комментарий в kp-import.ts), поэтому результат уходит на экран
 * проверки на сайте, а не сразу в подбор.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ success: false, error: 'Файл не передан' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const name = (file.name || '').toLowerCase()
    const isPdf = name.endsWith('.pdf') || file.type === 'application/pdf'
    const isDocx = name.endsWith('.docx') || file.type === DOCX_MIME

    if (!isPdf && !isDocx) {
      return NextResponse.json({ success: false, error: 'Поддерживаются только .docx и .pdf' }, { status: 400 })
    }

    const text = isPdf ? await extractTextFromPdf(buffer) : extractTextFromDocx(buffer)
    if (!text.trim()) {
      return NextResponse.json({ success: false, error: 'Не удалось прочитать текст из файла — возможно, это скан (картинка), а не текстовый документ' }, { status: 422 })
    }

    const result = parseKpFromText(text, productsData as any)
    if (result.items.length === 0) {
      return NextResponse.json({ success: false, error: 'В документе не нашлось ни одной знакомой модели из каталога' }, { status: 422 })
    }

    return NextResponse.json({ success: true, result })
  } catch (err: any) {
    console.error('Ошибка импорта КП:', err)
    return NextResponse.json({ success: false, error: err.message || 'Не удалось разобрать файл' }, { status: 500 })
  }
}
