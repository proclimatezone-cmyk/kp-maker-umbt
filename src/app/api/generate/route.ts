import path from 'path'
import { NextRequest, NextResponse, after } from 'next/server'
import { buildKpDocx } from '@/lib/docx-kp'
import { convertDocxToPdf } from '@/lib/docx-to-pdf'
import { archiveKp } from '@/lib/kp-archive'
import { saveKpSelection } from '@/lib/saved-kp'
import { getSessionEmail } from '@/lib/auth-session'

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Заголовок с именем файла: кириллица допустима только в filename*. */
function contentDisposition(name: string, ext: string) {
  const encoded = encodeURIComponent(`${name}.${ext}`)
  return `attachment; filename="kp.${ext}"; filename*=UTF-8''${encoded}`
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    const {
      manager,
      client,
      cpName,
      cpDate,
      items,
      rawItems,
      additionalItems,
      equipmentTotal,
      partnerBonus,
      additionalTotal,
      total,
      extraData,
      options,
      origin: clientOrigin,
      template = 'new',
      format = 'docx',
    } = data

    const origin = clientOrigin || req.nextUrl.origin
    const login = await getSessionEmail(req)

    // Оба вида КП собираются одинаково — .docx из шаблона через
    // docxtemplater. Разница только в файле шаблона: раньше «старый вид»
    // шёл через Google Slides (медленно, риск таймаута на Hobby-плане,
    // не собрать локально); теперь оба вида одинаково надёжны.
    const allItems = [
      ...(items || []),
      ...(additionalItems || []).map((a: any) => ({
        category: 'Дополнительные работы и материалы',
        model: a.name || 'Дополнительные услуги',
        quantity: a.quantity,
        price: a.price,
        isAdditional: true,
      })),
    ]

    const baseArgs = {
      cpNumber: cpName || '',
      cpDate: cpDate || new Date().toLocaleDateString('ru-RU'),
      items: allItems,
      total,
      manager,
      options: options || {},
      origin,
      templatePath: template === 'old'
        ? path.join(process.cwd(), 'templates', 'kp-old.docx')
        : undefined,
    }

    let docx = await buildKpDocx(baseArgs)
    let sizeWarning = ''

    // Vercel рубит ответ больше 4.5 МБ и отдаёт HTML-страницу ошибки вместо
    // файла. Если фото раздули документ сверх лимита — пересобираем без них,
    // чтобы менеджер всегда получил рабочий файл, а не тупик.
    const LIMIT = 4.3 * 1024 * 1024
    if (docx.length > LIMIT && (options?.showImages ?? true)) {
      docx = await buildKpDocx({ ...baseArgs, options: { ...(options || {}), showImages: false } })
      sizeWarning = 'Слишком много фото для одного файла — КП собрано без изображений'
    }

    const archiveMeta = { cpNumber: cpName || '', client: client || '', manager: manager?.name || '', login, total }

    // Отдельно от архива файла (см. archiveKp) — структурированный подбор
    // (позиции/скидки/клиент), чтобы КП можно было открыть на сайте заново,
    // а не только скачать готовый файл. rawItems — «сырые» билдер-строки
    // ({productId, quantity, discount}), а не развёрнутые items из docx —
    // без них скидку по каждой позиции обратно не восстановить.
    const saveSelection = () => saveKpSelection({
      kpNumber: cpName || '',
      kpDate: cpDate || '',
      manager: manager || {},
      client: client || '',
      extra: extraData || {},
      items: rawItems || [],
      additionalItems: additionalItems || [],
      options: options || {},
      total: Number(total) || 0,
      source: 'generated',
      login,
    })

    if (format === 'pdf') {
      const pdf = await convertDocxToPdf(docx, cpName || 'КП')
      // В архив уходят оба формата, даже если менеджер скачал только PDF.
      after(() => archiveKp({ ...archiveMeta, docx, pdf }))
      after(saveSelection)
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': contentDisposition(cpName || 'КП', 'pdf'),
          // Без этого заголовка предупреждение «собрано без изображений»
          // (см. LIMIT выше) виделось только при скачивании .docx — при
          // выгрузке в PDF фото так же молча выпадали, а менеджер не узнавал.
          'X-Size-Warning': encodeURIComponent(sizeWarning),
        },
      })
    }

    // Менеджер скачивает .docx — PDF для архива дособирается уже после
    // ответа, чтобы конвертация через Диск (несколько секунд) не задерживала скачивание.
    after(async () => {
      let pdf: Buffer | undefined
      try { pdf = await convertDocxToPdf(docx, cpName || 'КП') } catch (err) {
        console.error('Архив КП: не удалось получить PDF-копию', err)
      }
      await archiveKp({ ...archiveMeta, docx, pdf })
    })
    after(saveSelection)

    return new NextResponse(new Uint8Array(docx), {
      headers: {
        'Content-Type': DOCX_MIME,
        'Content-Disposition': contentDisposition(cpName || 'КП', 'docx'),
        'X-Size-Warning': encodeURIComponent(sizeWarning),
      },
    })
  } catch (err: any) {
    console.error('Ошибка генерации КП:', err)
    return NextResponse.json({ error: err.message, success: false }, { status: 500 })
  }
}
