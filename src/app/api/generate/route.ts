import { NextRequest, NextResponse, after } from 'next/server'
import { generateSlidesKP } from '@/lib/google-slides'
import { buildKpDocx } from '@/lib/docx-kp'
import { convertDocxToPdf } from '@/lib/docx-to-pdf'
import { archiveKp } from '@/lib/kp-archive'
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

    // --- Старый вид: прежний путь через Google Slides, на выходе PDF ---
    if (template === 'old') {
      const { presentationId, pdfUrl, pdfBuffer, auditError } = await generateSlidesKP({
        cpName, client, items, additionalItems, equipmentTotal, partnerBonus,
        additionalTotal, total, manager, extraData, options, origin,
      })

      if (!pdfBuffer) throw new Error('Не удалось получить PDF из презентации')

      // Старый вид собирается через Slides — Word-версии для него нет,
      // в архив уходит только PDF. after() — чтобы не задерживать отдачу
      // готового файла менеджеру ожиданием загрузки на Диск.
      after(() => archiveKp({
        cpNumber: cpName || '', client: client || '', manager: manager?.name || '', login,
        total, pdf: pdfBuffer,
      }))

      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': contentDisposition(cpName || 'КП', 'pdf'),
          'X-Presentation-Id': presentationId,
          'X-PDF-Url': pdfUrl || '',
          // Заголовки принимают только latin1, а ошибка приходит от Google
          // и может содержать что угодно.
          'X-Audit-Error': encodeURIComponent(auditError || ''),
        },
      })
    }

    // --- Новый вид: сборка .docx из шаблона ---
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
      options: options || {},
      origin,
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

    if (format === 'pdf') {
      const pdf = await convertDocxToPdf(docx, cpName || 'КП')
      // В архив уходят оба формата, даже если менеджер скачал только PDF.
      after(() => archiveKp({ ...archiveMeta, docx, pdf }))
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': contentDisposition(cpName || 'КП', 'pdf'),
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
