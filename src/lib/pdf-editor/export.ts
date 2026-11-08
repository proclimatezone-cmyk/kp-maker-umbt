import {
  PDFDocument, PDFFont, PDFImage, PDFPage, rgb, degrees,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix,
} from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import {
  BASELINE_RATIO, LINE_HEIGHT, viewSize,
  type EditorImage, type EditorPage, type FontFamily, type TextObj,
} from './types'

export const FONT_FILES: Record<FontFamily, [string, string, string, string]> = {
  sans: ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf', 'DejaVuSans-Oblique.ttf', 'DejaVuSans-BoldOblique.ttf'],
  serif: ['DejaVuSerif.ttf', 'DejaVuSerif-Bold.ttf', 'DejaVuSerif-Italic.ttf', 'DejaVuSerif-BoldItalic.ttf'],
}

export type FontLoader = (file: string) => Promise<Uint8Array>

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/** Перенос строк по ширине — та же логика, что у CSS white-space: pre-wrap. */
export function wrapText(text: string, maxW: number, measure: (s: string) => number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/)
    let line = ''
    for (const w of words) {
      const cand = line + w
      if (line && measure(cand.trimEnd()) > maxW && w.trim()) {
        out.push(line.trimEnd())
        line = w.trimStart()
        while (measure(line) > maxW && line.length > 1) {
          let i = line.length - 1
          while (i > 1 && measure(line.slice(0, i)) > maxW) i--
          out.push(line.slice(0, i))
          line = line.slice(i)
        }
      } else {
        line = cand
      }
    }
    out.push(line)
  }
  return out
}

/** Матрица из «пространства просмотра» (x вправо, y вверх, размеры повёрнутой
 *  страницы) в пространство пользователя неповёрнутой страницы. */
function viewMatrix(p: EditorPage): [number, number, number, number, number, number] {
  const { x: x0, y: y0, w: W, h: H } = p.box
  switch (((p.rotation % 360) + 360) % 360) {
    case 90: return [0, 1, -1, 0, W + x0, y0]
    case 180: return [-1, 0, 0, -1, W + x0, H + y0]
    case 270: return [0, -1, 1, 0, x0, H + y0]
    default: return [1, 0, 0, 1, x0, y0]
  }
}

export async function exportPdf(opts: {
  pages: EditorPage[]
  sources: Map<string, Uint8Array>
  images: Map<string, EditorImage>
  loadFont: FontLoader
  title?: string
}): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  out.registerFontkit(fontkit)
  if (opts.title) out.setTitle(opts.title)
  out.setProducer('UMBT KP Maker')

  const srcDocs = new Map<string, PDFDocument>()
  for (const id of new Set(opts.pages.map(p => p.srcId).filter(Boolean) as string[])) {
    srcDocs.set(id, await PDFDocument.load(opts.sources.get(id)!, { ignoreEncryption: true, updateMetadata: false }))
  }
  // Копируем страницы пачкой по источнику — общие ресурсы (шрифты, картинки) не дублируются.
  const copied = new Map<string, PDFPage>()
  for (const [id, doc] of srcDocs) {
    const idx = [...new Set(opts.pages.filter(p => p.srcId === id).map(p => p.srcIndex))]
    const pages = await out.copyPages(doc, idx)
    idx.forEach((i, k) => copied.set(`${id}:${i}`, pages[k]))
  }

  const fontCache = new Map<string, PDFFont>()
  const font = async (o: TextObj) => {
    const file = FONT_FILES[o.family][(o.bold ? 1 : 0) + (o.italic ? 2 : 0)]
    if (!fontCache.has(file)) fontCache.set(file, await out.embedFont(await opts.loadFont(file), { subset: true }))
    return fontCache.get(file)!
  }
  const imgCache = new Map<string, PDFImage>()
  const image = async (id: string) => {
    if (!imgCache.has(id)) {
      const im = opts.images.get(id)!
      imgCache.set(id, im.mime === 'image/png' ? await out.embedPng(im.bytes) : await out.embedJpg(im.bytes))
    }
    return imgCache.get(id)!
  }

  const used = new Set<string>()
  for (const p of opts.pages) {
    let page: PDFPage
    if (p.srcId) {
      const k = `${p.srcId}:${p.srcIndex}`
      // Одна и та же исходная страница дважды (дубликат) — копируем ещё раз.
      page = used.has(k) ? (await out.copyPages(srcDocs.get(p.srcId)!, [p.srcIndex]))[0] : copied.get(k)!
      used.add(k)
      out.addPage(page)
    } else {
      page = out.addPage([p.box.w, p.box.h])
    }
    page.setRotation(degrees(p.rotation))
    if (!p.objects.length) continue

    const { h: VH } = viewSize(p)
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...viewMatrix(p)))
    for (const o of p.objects) {
      const top = VH - o.y
      if (o.type === 'rect' || o.type === 'ellipse') {
        const common = {
          color: o.fill ? hexToRgb(o.fill) : undefined,
          borderColor: o.stroke ? hexToRgb(o.stroke) : undefined,
          borderWidth: o.stroke ? o.strokeWidth : 0,
          opacity: o.opacity, borderOpacity: o.opacity,
        }
        if (o.type === 'rect') page.drawRectangle({ x: o.x, y: top - o.h, width: o.w, height: o.h, ...common })
        else page.drawEllipse({ x: o.x + o.w / 2, y: top - o.h / 2, xScale: o.w / 2, yScale: o.h / 2, ...common })
      } else if (o.type === 'line') {
        page.drawLine({
          start: { x: o.x, y: top }, end: { x: o.x + o.w, y: top - o.h },
          thickness: o.strokeWidth, color: hexToRgb(o.stroke), opacity: o.opacity,
        })
      } else if (o.type === 'image') {
        page.drawImage(await image(o.imageId), { x: o.x, y: top - o.h, width: o.w, height: o.h, opacity: o.opacity })
      } else if (o.type === 'text') {
        if (o.bg) page.drawRectangle({ x: o.x, y: top - o.h, width: o.w, height: o.h, color: hexToRgb(o.bg), opacity: o.opacity })
        const f = await font(o)
        const measure = (s: string) => f.widthOfTextAtSize(s, o.size)
        const lines = wrapText(o.text, o.w + 0.5, measure)
        const color = hexToRgb(o.color)
        lines.forEach((ln, i) => {
          const lw = measure(ln)
          const x = o.align === 'center' ? o.x + (o.w - lw) / 2 : o.align === 'right' ? o.x + o.w - lw : o.x
          const base = top - (i * LINE_HEIGHT + BASELINE_RATIO) * o.size
          if (ln) page.drawText(ln, { x, y: base, size: o.size, font: f, color, opacity: o.opacity })
          if (o.underline && ln) {
            page.drawLine({ start: { x, y: base - o.size * 0.12 }, end: { x: x + lw, y: base - o.size * 0.12 }, thickness: Math.max(0.5, o.size / 16), color, opacity: o.opacity })
          }
        })
      }
    }
    page.pushOperators(popGraphicsState())
  }
  return out.save({ useObjectStreams: true })
}
