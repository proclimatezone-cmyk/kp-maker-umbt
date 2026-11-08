/** Все координаты объектов — в пунктах PDF (1/72"), начало в левом верхнем
 *  углу страницы так, как она отображается (с учётом поворота). */

export type FontFamily = 'dejavu-sans' | 'dejavu-serif' | 'arimo' | 'tinos' | 'pt-sans' | 'pt-serif'

export const FONTS: Record<FontFamily, { label: string; css: string; files: [string, string, string, string] }> = {
  'dejavu-sans': { label: 'DejaVu Sans', css: '"PE DejaVu Sans"', files: ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf', 'DejaVuSans-Oblique.ttf', 'DejaVuSans-BoldOblique.ttf'] },
  'dejavu-serif': { label: 'DejaVu Serif', css: '"PE DejaVu Serif"', files: ['DejaVuSerif.ttf', 'DejaVuSerif-Bold.ttf', 'DejaVuSerif-Italic.ttf', 'DejaVuSerif-BoldItalic.ttf'] },
  arimo: { label: 'Arimo (как Arial)', css: '"PE Arimo"', files: ['Arimo-Regular.ttf', 'Arimo-Bold.ttf', 'Arimo-Italic.ttf', 'Arimo-BoldItalic.ttf'] },
  tinos: { label: 'Tinos (как Times)', css: '"PE Tinos"', files: ['Tinos-Regular.ttf', 'Tinos-Bold.ttf', 'Tinos-Italic.ttf', 'Tinos-BoldItalic.ttf'] },
  'pt-sans': { label: 'PT Sans', css: '"PE PT Sans"', files: ['PT_Sans-Web-Regular.ttf', 'PT_Sans-Web-Bold.ttf', 'PT_Sans-Web-Italic.ttf', 'PT_Sans-Web-BoldItalic.ttf'] },
  'pt-serif': { label: 'PT Serif', css: '"PE PT Serif"', files: ['PT_Serif-Web-Regular.ttf', 'PT_Serif-Web-Bold.ttf', 'PT_Serif-Web-Italic.ttf', 'PT_Serif-Web-BoldItalic.ttf'] },
}

export const fontFile = (f: FontFamily, bold: boolean, italic: boolean) => (FONTS[f] || FONTS['dejavu-sans']).files[(bold ? 1 : 0) + (italic ? 2 : 0)]

/** Удалённый исходный элемент страницы: прямоугольники в пространстве PDF (неповёрнутом). */
export interface Removal {
  kind: 'text' | 'image'
  rects: number[][]
}

export interface BaseObj {
  id: string
  x: number
  y: number
  w: number
  h: number
  opacity: number
  /** Служебная метка: 'hl' — маркер. */
  origin?: string
}

export interface TextObj extends BaseObj {
  type: 'text'
  text: string
  size: number
  family: FontFamily
  bold: boolean
  italic: boolean
  underline: boolean
  color: string
  align: 'left' | 'center' | 'right'
  /** Межстрочный интервал, доля кегля. */
  lineHeight: number
  /** Подложка под текстом (null — прозрачная). */
  bg: string | null
}

export interface ShapeObj extends BaseObj {
  type: 'rect' | 'ellipse'
  fill: string | null
  stroke: string | null
  strokeWidth: number
}

export interface LineObj extends BaseObj {
  /** Линия от (x, y) до (x + w, y + h); w/h могут быть отрицательными. */
  type: 'line'
  stroke: string
  strokeWidth: number
}

export interface ImageObj extends BaseObj {
  type: 'image'
  imageId: string
}

export type EditorObj = TextObj | ShapeObj | LineObj | ImageObj

export interface EditorPage {
  key: string
  /** null — пустая страница, созданная в редакторе. */
  srcId: string | null
  srcIndex: number
  /** Неповёрнутый CropBox исходной страницы. */
  box: { x: number; y: number; w: number; h: number }
  /** Итоговый поворот (исходный /Rotate + добавленный), кратен 90. */
  rotation: number
  /** Исходные элементы, вырезанные из страницы (переведены в объекты или удалены). */
  removed: Removal[]
  objects: EditorObj[]
}

export interface EditorImage {
  bytes: Uint8Array
  mime: 'image/png' | 'image/jpeg'
  url: string
}

export function viewSize(p: Pick<EditorPage, 'box' | 'rotation'>) {
  const swap = p.rotation % 180 !== 0
  return swap ? { w: p.box.h, h: p.box.w } : { w: p.box.w, h: p.box.h }
}

/** Базовая линия первой строки = верх блока + ASCENT × кегль; строки идут через lineHeight × кегль.
 *  Одно правило и для отображения (SVG), и для экспорта — совпадение один в один. */
export const ASCENT = 0.9
export const DESCENT = 0.3
export const textBoxHeight = (lines: number, size: number, lh: number) => size * (ASCENT + DESCENT + Math.max(0, lines - 1) * lh)

/** Перенос строк по ширине (общий для экрана и экспорта). */
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
