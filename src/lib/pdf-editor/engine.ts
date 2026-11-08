/**
 * Движок редактора на MuPDF (WASM): разбор содержимого страницы на абзацы и
 * изображения, настоящее удаление исходного текста (redaction) и картинок
 * (вырезание оператора Do из потока содержимого), рендер страниц.
 *
 * Модуль не импортирует mupdf сам — экземпляр передаётся снаружи (в браузере
 * грузится из /mupdf/, в Node — из node_modules), поэтому бандлер его не трогает.
 */
import type * as MuPDF from 'mupdf'
import type { FontFamily, Removal } from './types'

export type Mu = typeof MuPDF
type Mat = [number, number, number, number, number, number]
type R4 = [number, number, number, number]

export interface SourceText {
  kind: 'text'
  key: string
  /** Прямоугольник абзаца в координатах просмотра (pt, начало слева сверху). */
  x: number; y: number; w: number; h: number
  lines: string[]
  /** Базовая линия первой строки (координаты просмотра). */
  base: number
  size: number
  lineHeight: number
  align: 'left' | 'center' | 'right'
  family: FontFamily
  bold: boolean
  italic: boolean
  color: string
  /** Полосы строк в пространстве PDF — что вырезать при правке. */
  removal: Removal
}

export interface SourceImage {
  kind: 'image'
  key: string
  x: number; y: number; w: number; h: number
  removal: Removal
}

export type SourceItem = SourceText | SourceImage

/* ------------------------------------------------------------------ */
/* Матрицы                                                            */

const mul = (m: Mat, c: Mat): Mat => [
  m[0] * c[0] + m[1] * c[2], m[0] * c[1] + m[1] * c[3],
  m[2] * c[0] + m[3] * c[2], m[2] * c[1] + m[3] * c[3],
  m[4] * c[0] + m[5] * c[2] + c[4], m[4] * c[1] + m[5] * c[3] + c[5],
]
const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
function rectOf(m: Mat, r: R4 = [0, 0, 1, 1]): R4 {
  const pts = [apply(m, r[0], r[1]), apply(m, r[2], r[1]), apply(m, r[0], r[3]), apply(m, r[2], r[3])]
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2]
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]
}
const near = (a: R4, b: R4, tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

/* ------------------------------------------------------------------ */
/* Поток содержимого: вырезание отрисовки конкретных изображений        */

const WS = new Set([0, 9, 10, 12, 13, 32])
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37])

interface Draw { start: number; end: number; bbox: R4 }

/** Находит в потоке все отрисовки изображений (XObject Image и inline BI…EI) с их рамками в пространстве PDF. */
function scanImageDraws(src: Uint8Array, isImage: (name: string) => boolean): Draw[] {
  const n = src.length
  let i = 0
  let operands: { s: number; v: string }[] = []
  let ctm: Mat = [1, 0, 0, 1, 0, 0]
  const stack: Mat[] = []
  const draws: Draw[] = []
  const str = (a: number, b: number) => { let s = ''; for (let k = a; k < b; k++) s += String.fromCharCode(src[k]); return s }

  while (i < n) {
    const c = src[i]
    if (WS.has(c)) { i++; continue }
    if (c === 37) { while (i < n && src[i] !== 10 && src[i] !== 13) i++; continue }
    const s = i
    if (c === 40) { // (строка)
      let depth = 0
      for (; i < n; i++) {
        if (src[i] === 92) { i++; continue }
        if (src[i] === 40) depth++
        else if (src[i] === 41 && --depth === 0) { i++; break }
      }
      operands.push({ s, v: '' }); continue
    }
    if (c === 60 && src[i + 1] === 60) { i += 2; operands.push({ s, v: '<<' }); continue }
    if (c === 62 && src[i + 1] === 62) { i += 2; operands.push({ s, v: '>>' }); continue }
    if (c === 60) { while (i < n && src[i] !== 62) i++; i++; operands.push({ s, v: '' }); continue }
    if (c === 91 || c === 93 || c === 123 || c === 125) { i++; operands.push({ s, v: String.fromCharCode(c) }); continue }
    if (c === 47) {
      i++
      while (i < n && !WS.has(src[i]) && !DELIM.has(src[i])) i++
      operands.push({ s, v: str(s, i) }); continue
    }
    while (i < n && !WS.has(src[i]) && !DELIM.has(src[i])) i++
    const tok = str(s, i)
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok) || tok === 'true' || tok === 'false' || tok === 'null') { operands.push({ s, v: tok }); continue }

    const opStart = operands.length ? operands[0].s : s
    if (tok === 'q') stack.push(ctm)
    else if (tok === 'Q') ctm = stack.pop() || [1, 0, 0, 1, 0, 0]
    else if (tok === 'cm' && operands.length >= 6) {
      const m = operands.slice(-6).map(o => +o.v) as Mat
      ctm = mul(m, ctm)
    } else if (tok === 'Do' && operands.length) {
      const name = operands[operands.length - 1].v.slice(1)
      if (isImage(name)) draws.push({ start: opStart, end: i, bbox: rectOf(ctm) })
    } else if (tok === 'BI') {
      // inline-изображение: словарь до ID, затем двоичные данные до «EI»
      let j = i
      while (j < n - 1 && !(src[j] === 73 && src[j + 1] === 68 && WS.has(src[j - 1]) && WS.has(src[j + 2]))) j++
      j += 3
      while (j < n - 1 && !(src[j] === 69 && src[j + 1] === 73 && WS.has(src[j - 1]) && (j + 2 >= n || WS.has(src[j + 2])))) j++
      i = Math.min(n, j + 2)
      draws.push({ start: s, end: i, bbox: rectOf(ctm) })
    }
    operands = []
  }
  return draws
}

function readContents(page: MuPDF.PDFPage): Uint8Array {
  const obj = page.getObject().get('Contents')
  const parts: Uint8Array[] = []
  if (obj.isArray()) obj.forEach(v => { parts.push(v.readStream().asUint8Array()) })
  else if (obj.isStream()) parts.push(obj.readStream().asUint8Array())
  const total = parts.reduce((a, p) => a + p.length + 1, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length; out[o++] = 10 }
  return out
}

function removeImages(doc: MuPDF.PDFDocument, page: MuPDF.PDFPage, rects: R4[]) {
  const xobj = page.getObject().getInheritable('Resources').get('XObject')
  const isImage = (name: string) => {
    if (!xobj || xobj.isNull()) return false
    const o = xobj.get(name)
    return !o.isNull() && o.get('Subtype').asName() === 'Image'
  }
  const src = readContents(page)
  const draws = scanImageDraws(src, isImage)
  const cut: Draw[] = []
  for (const r of rects) {
    let best: Draw | null = null, bestD = Infinity
    for (const d of draws) {
      if (!near(d.bbox, r, 2.5)) continue
      const dist = d.bbox.reduce((a, v, k) => a + Math.abs(v - r[k]), 0)
      if (dist < bestD) { bestD = dist; best = d }
    }
    if (best && !cut.includes(best)) cut.push(best)
  }
  if (!cut.length) return
  const out = src.slice()
  for (const d of cut) out.fill(32, d.start, d.end)
  const stream = doc.addStream(out, doc.newDictionary())
  page.getObject().put('Contents', stream)
}

/* ------------------------------------------------------------------ */
/* Производная страница: исходник + поворот + удаления                 */

export function derivePage(mu: Mu, bytes: Uint8Array, index: number, rotation: number, removals: Removal[]) {
  const doc = mu.Document.openDocument(bytes, 'application/pdf') as MuPDF.PDFDocument
  const page = doc.loadPage(index) as MuPDF.PDFPage
  page.getObject().put('Rotate', rotation)
  const imgs = removals.filter(r => r.kind === 'image').flatMap(r => r.rects) as R4[]
  if (imgs.length) removeImages(doc, page, imgs)
  const texts = removals.filter(r => r.kind === 'text').flatMap(r => r.rects) as R4[]
  if (texts.length) {
    const T = page.getTransform() as Mat
    for (const r of texts) {
      const a = page.createAnnotation('Redact')
      a.setRect(rectOf(T, r))
    }
    page.applyRedactions(false, mu.PDFPage.REDACT_IMAGE_NONE, mu.PDFPage.REDACT_LINE_ART_NONE, mu.PDFPage.REDACT_TEXT_REMOVE)
  }
  return { doc, page }
}

export function renderPage(mu: Mu, page: MuPDF.PDFPage, scale: number): { data: Uint8ClampedArray; w: number; h: number } {
  const pix = page.toPixmap(mu.Matrix.scale(scale, scale), mu.ColorSpace.DeviceRGB, false, false)
  const w = pix.getWidth(), h = pix.getHeight()
  const src = pix.getPixels(), n = pix.getNumberOfComponents()
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0, j = 0; i < data.length; i += 4, j += n) { data[i] = src[j]; data[i + 1] = src[j + 1]; data[i + 2] = src[j + 2]; data[i + 3] = 255 }
  pix.destroy()
  return { data, w, h }
}

export function pageInfo(page: MuPDF.PDFPage) {
  const o = page.getObject()
  const box = (o.getInheritable('CropBox').isNull() ? o.getInheritable('MediaBox') : o.getInheritable('CropBox')).asJS() as number[]
  const rot = o.getInheritable('Rotate')
  return {
    box: { x: Math.min(box[0], box[2]), y: Math.min(box[1], box[3]), w: Math.abs(box[2] - box[0]), h: Math.abs(box[3] - box[1]) },
    rotation: ((rot.isNull() ? 0 : rot.asNumber()) % 360 + 360) % 360,
  }
}

/* ------------------------------------------------------------------ */
/* Разбор содержимого                                                  */

interface Seg {
  text: string; x0: number; y0: number; x1: number; y1: number; base: number
  size: number; font: string; bold: boolean; italic: boolean; serif: boolean; color: string
}

function familyOf(font: string, serif: boolean): FontFamily {
  const f = font.toLowerCase()
  if (/dejavu/.test(f)) return /serif/.test(f) && !/sans/.test(f) ? 'dejavu-serif' : 'dejavu-sans'
  if (/pt ?sans|ptsans/.test(f)) return 'pt-sans'
  if (/pt ?serif|ptserif/.test(f)) return 'pt-serif'
  if (/times|tinos|liberation ?serif|georgia|cambria|garamond/.test(f)) return 'tinos'
  if (/arial|helvetica|arimo|liberation ?sans|calibri|verdana|tahoma|roboto|open ?sans|segoe/.test(f)) return 'arimo'
  return serif ? 'tinos' : 'arimo'
}

function toHex(c: number[]) {
  let rgb: number[]
  if (c.length === 1) rgb = [c[0], c[0], c[0]]
  else if (c.length === 4) rgb = [0, 1, 2].map(k => (1 - c[k]) * (1 - c[3]))
  else rgb = c.slice(0, 3)
  return '#' + rgb.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')
}

export function extractItems(mu: Mu, page: MuPDF.PDFPage): SourceItem[] {
  const bounds = page.getBounds()
  const ox = bounds[0], oy = bounds[1]
  const inv = invert(page.getTransform() as Mat)
  const toPdf = (r: R4) => rectOf(inv, [r[0] + ox, r[1] + oy, r[2] + ox, r[3] + oy])
  const st = page.toStructuredText('preserve-images,preserve-whitespace')
  const segs: Seg[] = []
  const images: SourceImage[] = []
  let cur: Seg | null = null
  let horiz = true
  let lastRight = 0
  const flush = () => { if (cur && cur.text.trim()) { cur.text = cur.text.replace(/\s+$/, ''); segs.push(cur) } cur = null }

  st.walk({
    onImageBlock(bbox) {
      const r: R4 = [bbox[0] - ox, bbox[1] - oy, bbox[2] - ox, bbox[3] - oy]
      if (r[2] - r[0] < 2 || r[3] - r[1] < 2) return
      images.push({
        kind: 'image', key: `i${r.map(v => Math.round(v)).join('_')}`,
        x: r[0], y: r[1], w: r[2] - r[0], h: r[3] - r[1],
        removal: { kind: 'image', rects: [toPdf(r)] },
      })
    },
    beginLine(_bbox, wmode, dir) { flush(); horiz = wmode === 0 && Math.abs(dir[1]) < 0.01 && dir[0] > 0 },
    onChar(ch, origin, font, size, quad, color) {
      if (!horiz) return
      const x0 = Math.min(quad[0], quad[4]) - ox, x1 = Math.max(quad[2], quad[6]) - ox
      const y0 = Math.min(quad[1], quad[3]) - oy, y1 = Math.max(quad[5], quad[7]) - oy
      const name = font.getName()
      const bold = font.isBold() || /bold|black|heavy|semibold|demi/i.test(name)
      const italic = font.isItalic() || /italic|oblique/i.test(name)
      const hex = toHex(color)
      const sameStyle = cur && cur.font === name && Math.abs(cur.size - size) < 0.3 && cur.color === hex
      const gap = cur ? x0 - lastRight : 0
      if (!cur || !sameStyle || gap > size * 0.9 || gap < -size) {
        // пробел в конце сегмента не должен рвать стиль следующего
        if (cur && ch === ' ' && sameStyle === false && gap <= size * 0.9) { cur.text += ' '; return }
        flush()
        if (ch === ' ') return
        cur = { text: '', x0, y0, x1, y1, base: origin[1] - oy, size, font: name, bold, italic, serif: font.isSerif(), color: hex }
      }
      cur.text += ch
      cur.x0 = Math.min(cur.x0, x0); cur.x1 = Math.max(cur.x1, x1)
      cur.y0 = Math.min(cur.y0, y0); cur.y1 = Math.max(cur.y1, y1)
      if (ch !== ' ') lastRight = x1
    },
    endLine() { flush() },
  })
  flush()
  st.destroy()

  // Строки → абзацы: та же гарнитура и кегль, соседние по вертикали, перекрываются по горизонтали.
  segs.sort((a, b) => a.base - b.base || a.x0 - b.x0)
  const paras: Seg[][] = []
  for (const s of segs) {
    let target: Seg[] | null = null
    for (const p of paras) {
      const last = p[p.length - 1]
      const dy = s.base - last.base
      const overlap = Math.min(s.x1, last.x1) - Math.max(s.x0, last.x0)
      if (last.font === s.font && Math.abs(last.size - s.size) < 0.3 && last.color === s.color
        && dy > s.size * 0.8 && dy < s.size * 1.9 && overlap > -1) {
        if (p.length > 1) {
          const prevGap = last.base - p[p.length - 2].base
          if (Math.abs(prevGap - dy) > s.size * 0.25) continue
        }
        target = p; break
      }
    }
    if (target) target.push(s); else paras.push([s])
  }

  const texts: SourceText[] = paras.map(lines => {
    const x0 = Math.min(...lines.map(l => l.x0)), x1 = Math.max(...lines.map(l => l.x1))
    const y0 = Math.min(...lines.map(l => l.y0)), y1 = Math.max(...lines.map(l => l.y1))
    const f = lines[0]
    const tol = Math.max(1.5, f.size * 0.15)
    let align: SourceText['align'] = 'left'
    if (lines.length > 1) {
      const spread = (a: number[]) => Math.max(...a) - Math.min(...a)
      const cand = [
        ['left', spread(lines.map(l => l.x0))], ['center', spread(lines.map(l => (l.x0 + l.x1) / 2))], ['right', spread(lines.map(l => l.x1))],
      ] as const
      const best = [...cand].sort((a, b) => a[1] - b[1])[0]
      if (best[1] <= Math.max(tol, f.size * 0.5)) align = best[0]
    }
    const lh = lines.length > 1 ? (lines[lines.length - 1].base - lines[0].base) / (lines.length - 1) / f.size : 1.2
    return {
      kind: 'text', key: `t${Math.round(x0)}_${Math.round(f.base)}_${Math.round(f.size * 10)}`,
      x: x0, y: y0, w: x1 - x0, h: y1 - y0, lines: lines.map(l => l.text), base: f.base, size: f.size,
      lineHeight: Math.round(lh * 100) / 100, align, family: familyOf(f.font, f.serif), bold: f.bold, italic: f.italic, color: f.color,
      // средняя полоса строки — чтобы не задеть буквы соседних абзацев
      removal: {
        kind: 'text',
        rects: lines.map(l => { const h = l.y1 - l.y0; return toPdf([l.x0 + 0.3, l.y0 + h * 0.3, l.x1 - 0.3, l.y1 - h * 0.3]) }),
      },
    }
  })
  return [...images, ...texts]
}

/** Пиксели исходного изображения (RGBA без предумножения, с маской прозрачности) — для превращения в редактируемый объект. */
export function extractImageRgba(mu: Mu, page: MuPDF.PDFPage, item: SourceImage): { data: Uint8ClampedArray; w: number; h: number } | null {
  const bounds = page.getBounds()
  let out: { data: Uint8ClampedArray; w: number; h: number } | null = null
  const st = page.toStructuredText('preserve-images')
  st.walk({
    onImageBlock(bbox, _t, image) {
      if (out) return
      const r: R4 = [bbox[0] - bounds[0], bbox[1] - bounds[1], bbox[2] - bounds[0], bbox[3] - bounds[1]]
      if (!near(r, [item.x, item.y, item.x + item.w, item.y + item.h], 1)) return
      let pix = image.toPixmap()
      if (!pix.getColorSpace()?.isRGB()) pix = pix.convertToColorSpace(mu.ColorSpace.DeviceRGB, true)
      const w = pix.getWidth(), h = pix.getHeight()
      const n = pix.getNumberOfComponents(), hasA = !!pix.getAlpha()
      const px = pix.getPixels()
      const data = new Uint8ClampedArray(w * h * 4)
      for (let k = 0, j = 0; k < data.length; k += 4, j += n) {
        const a = hasA ? px[j + 3] : 255
        const un = (v: number) => (hasA && a > 0 && a < 255 ? Math.min(255, Math.round(v * 255 / a)) : v)
        data[k] = un(px[j]); data[k + 1] = un(px[j + 1]); data[k + 2] = un(px[j + 2]); data[k + 3] = a
      }
      const mask = image.getMask()
      if (mask && !hasA) {
        const m = mask.toPixmap()
        if (m.getWidth() === w && m.getHeight() === h) {
          const mn = m.getNumberOfComponents(), mp = m.getPixels()
          for (let k = 3, q = 0; k < data.length; k += 4, q += mn) data[k] = mp[q]
        }
        m.destroy()
      }
      out = { data, w, h }
    },
  })
  st.destroy()
  return out
}
