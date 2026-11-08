/** Все координаты — в пунктах PDF (1/72"), начало в левом верхнем углу
 *  страницы так, как она отображается (с учётом поворота). */

export type FontFamily = 'sans' | 'serif'

export interface BaseObj {
  id: string
  x: number
  y: number
  w: number
  h: number
  opacity: number
  /** Служебная метка: ключ заменённой строки PDF или 'hl' для маркера. */
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

/** Доля размера шрифта от верха строки (line-height 1.2) до базовой линии — метрики DejaVu. */
export const BASELINE_RATIO = 0.946
export const LINE_HEIGHT = 1.2
