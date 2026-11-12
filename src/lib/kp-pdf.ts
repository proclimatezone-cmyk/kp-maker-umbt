/**
 * Быстрая сборка PDF КП без Google Drive.
 *
 * Страницы 1–3 (обложка без номера/даты и две страницы о компании) — готовый
 * templates/kp-static.pdf (scripts/build-kp-static.ts). Номер, дата, таблица,
 * условия и адрес рисуются pdf-lib по метрикам, снятым с рендера kp-new.docx
 * в Google Docs, поэтому КП выглядит так же, но собирается за доли секунды.
 */
import fs from 'fs'
import path from 'path'
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb, type RGB } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { formatNum } from './format'
import { buildSignatureLines, COMPANY_ADDRESS_LINES, getMoneyLabels } from './delivery-terms'
import {
  buildTermsRows, mergeIdenticalItems, preloadImages, quantityLabel,
  type BuildKpOptions, type KpItem, type ShrunkImage,
} from './docx-kp'

const PAGE_W = 595.28
const PAGE_H = 841.89
const BOTTOM = PAGE_H - 42.55

const TABLE_X = 42.5
const COLS = [134.95, 128.5, 65.5, 98.05, 104.15]
const TABLE_TOP = 50.55
const CELL_PAD = 5.4
const BORDER = 0.75
const SIZE = 12
const LINE = 17.14
const ROW_MIN = 89.7
const TOTAL_ROW = 45.35
const IMG_W = 112.5
const IMG_H = 82.5

const HEADER_BG = rgb(69 / 255, 176 / 255, 225 / 255)
const ROW_BG = rgb(219 / 255, 239 / 255, 249 / 255)
const WHITE = rgb(1, 1, 1)
const BLACK = rgb(0, 0, 0)
const LABEL = rgb(0, 163 / 255, 212 / 255)
const GREY = rgb(78 / 255, 78 / 255, 77 / 255)
const COVER = rgb(38 / 255, 155 / 255, 217 / 255)

const TERMS_X = 42.1
const TERMS_COL1 = 143.9
const TERMS_COL2 = 366.45
const ADDRESS_X = 69.8

interface Assets {
  staticPdf: Uint8Array
  bg: Uint8Array
  regular: Uint8Array
  bold: Uint8Array
  boldItalic: Uint8Array
}

let assets: Assets | null = null
function loadAssets(): Assets {
  if (assets) return assets
  const t = (f: string) => fs.readFileSync(path.join(process.cwd(), 'templates', f))
  assets = {
    staticPdf: t('kp-static.pdf'),
    bg: t('kp-page-bg.jpg'),
    regular: t('kp-fonts/CenturyGothic.ttf'),
    bold: t('kp-fonts/CenturyGothic-Bold.ttf'),
    boldItalic: t('kp-fonts/CenturyGothic-BoldItalic.ttf'),
  }
  return assets
}

/** Перенос по словам; слово шире строки рубится по символам (как в Google Docs). */
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = []
  const width = (s: string) => font.widthOfTextAtSize(s, size)
  for (const para of String(text ?? '').split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = line ? `${line} ${word}` : word
      if (width(cand) <= maxW) { line = cand; continue }
      if (line) out.push(line)
      line = ''
      let rest = word
      while (width(rest) > maxW) {
        let i = rest.length - 1
        while (i > 1 && width(rest.slice(0, i)) > maxW) i--
        out.push(rest.slice(0, i))
        rest = rest.slice(i)
      }
      line = rest
    }
    out.push(line)
  }
  return out
}

/** Базовая линия строки высотой lineH: глиф по центру строки (метрики Century Gothic). */
const baseline = (lineTop: number, lineH: number, size: number) =>
  lineTop + (lineH - 1.226 * size) / 2 + 1.006 * size

export async function buildKpPdf(opts: BuildKpOptions): Promise<Buffer> {
  const a = loadAssets()
  const items = mergeIdenticalItems(opts.items)
  const showImages = opts.options.showImages !== false
  const imagesP = showImages ? preloadImages(items, opts.origin) : Promise.resolve(new Map<string, ShrunkImage>())

  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  doc.setTitle(`КП ${opts.cpNumber}`)
  doc.setProducer('UMBT KP Maker')
  const src = await PDFDocument.load(a.staticPdf)
  const [regular, bold, boldItalic, bgImg, staticPages] = await Promise.all([
    doc.embedFont(a.regular, { subset: true }),
    doc.embedFont(a.bold, { subset: true }),
    doc.embedFont(a.boldItalic, { subset: true }),
    doc.embedJpg(a.bg),
    doc.copyPages(src, src.getPageIndices()),
  ])
  staticPages.forEach(p => doc.addPage(p))

  // Обложка: номер и дата, по правому краю текстового блока шаблона.
  const cover = staticPages[0]
  const coverLine = (text: string, base: number) => {
    const w = bold.widthOfTextAtSize(text, 20)
    cover.drawText(text, { x: 574.5 - w, y: PAGE_H - base, size: 20, font: bold, color: COVER })
  }
  coverLine(`№ ${opts.cpNumber}`, 59.6)
  coverLine(`Дата: ${opts.cpDate}`, 88.6)

  const images = await imagesP
  const embedded = new Map<string, PDFImage>()
  await Promise.all([...images.entries()].map(async ([k, im]) => embedded.set(k, await doc.embedPng(im.buffer))))

  let page!: PDFPage
  let y = 0
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H])
    page.drawImage(bgImg, { x: 0, y: 0, width: PAGE_W, height: PAGE_H })
  }
  const rect = (x: number, top: number, w: number, h: number, color: RGB) =>
    page.drawRectangle({ x, y: PAGE_H - top - h, width: w, height: h, color })
  const text = (s: string, x: number, base: number, size: number, font: PDFFont, color: RGB) =>
    page.drawText(s, { x, y: PAGE_H - base, size, font, color })
  const colX = (i: number) => TABLE_X + COLS.slice(0, i).reduce((s, w) => s + w, 0)
  const cellText = (lines: string[], x: number, w: number, top: number, h: number, size: number, font: PDFFont, color: RGB, lineH: number) => {
    const start = top + (h - lines.length * lineH) / 2
    lines.forEach((ln, i) => {
      const lw = font.widthOfTextAtSize(ln, size)
      text(ln, x + (w - lw) / 2, baseline(start + i * lineH, lineH, size), size, font, color)
    })
  }

  const money = getMoneyLabels(opts.options)
  const headWrap = (t: string, i: number) => wrap(t, bold, SIZE, COLS[i] - 2 * CELL_PAD)
  const HEADERS = [['Внешний вид'], ['Наименование', 'Товара'], ['Кол-во'], headWrap(money.price, 3), headWrap(money.sum, 4)]
  const headerH = Math.max(...HEADERS.map(h => h.length)) * LINE
  const drawHeader = () => {
    HEADERS.forEach((lines, i) => {
      rect(colX(i), y, COLS[i], headerH, HEADER_BG)
      cellText(lines, colX(i), COLS[i], y, headerH, SIZE, bold, WHITE, LINE)
    })
    y += headerH + BORDER
  }
  const startTablePage = () => { newPage(); y = TABLE_TOP; drawHeader() }
  startTablePage()

  let total = 0
  for (const item of items) {
    const price = Math.round(Number(item.price) || 0)
    const qty = Number(String(item.quantity ?? '1').match(/[\d.,]+/)?.[0]?.replace(',', '.')) || 1
    total += price * qty
    const merged = !!item.isAdditional
    const nameW = (merged ? COLS[0] + COLS[1] : COLS[1]) - 2 * CELL_PAD
    const name = merged
      ? wrap(item.model || '', regular, SIZE, nameW)
      : [...wrap(item.category || '', regular, SIZE, nameW), ...wrap(item.model || '', regular, SIZE, nameW)].filter(Boolean)
    const h = Math.max(merged ? LINE : ROW_MIN, name.length * LINE)
    if (y + h > BOTTOM) startTablePage()

    if (merged) {
      rect(colX(0), y, COLS[0] + COLS[1], h, ROW_BG)
      cellText(name, colX(0), COLS[0] + COLS[1], y, h, SIZE, regular, BLACK, LINE)
    } else {
      rect(colX(0), y, COLS[0], h, ROW_BG)
      rect(colX(1), y, COLS[1], h, ROW_BG)
      const key = item.image || item.slidesImage || ''
      const img = showImages ? embedded.get(key) : undefined
      const meta = images.get(key)
      if (img && meta) {
        const k = Math.min(IMG_W / meta.width, IMG_H / meta.height)
        const w = meta.width * k, ih = meta.height * k
        page.drawImage(img, { x: colX(0) + (COLS[0] - w) / 2, y: PAGE_H - (y + (h + ih) / 2), width: w, height: ih })
      }
      cellText(name, colX(1), COLS[1], y, h, SIZE, regular, BLACK, LINE)
    }
    const cells = [quantityLabel(item.quantity), formatNum(price), formatNum(price * qty)]
    cells.forEach((v, j) => {
      const c = j + 2
      rect(colX(c), y, COLS[c], h, ROW_BG)
      cellText([v], colX(c), COLS[c], y, h, SIZE, regular, BLACK, LINE)
    })
    y += h + BORDER
  }

  const grandTotal = Number.isFinite(Number(opts.total)) ? Number(opts.total) : total
  if (y + TOTAL_ROW > BOTTOM) startTablePage()
  const spanW = COLS.slice(0, 4).reduce((s, w) => s + w, 0)
  rect(TABLE_X, y, spanW, TOTAL_ROW, ROW_BG)
  rect(colX(4), y, COLS[4], TOTAL_ROW, ROW_BG)
  cellText([money.total() + ':'], TABLE_X, spanW, y, TOTAL_ROW, 14, boldItalic, BLACK, 20)
  cellText([formatNum(grandTotal)], colX(4), COLS[4], y, TOTAL_ROW, 14, boldItalic, BLACK, 20)
  y += TOTAL_ROW + BORDER

  // Условия: блок целиком — не помещается, уходит на новую страницу.
  const VALUE = 10, VALUE_LINE = 12.38, LABEL_SIZE = 11
  const valueW = TERMS_COL2 - 2 * CELL_PAD - 4.55 - 8.5
  const labelW = TERMS_COL1 - 2 * CELL_PAD - 4.55
  const rows = buildTermsRows(opts.options).map(r => {
    const label = wrap(r.label, bold, LABEL_SIZE, labelW)
    const value = wrap(r.value, regular, VALUE, valueW)
    const h = Math.max(31, value.length * VALUE_LINE + 12, label.length * 15.7 + 8)
    return { label, value, h }
  })
  const termsH = rows.reduce((s, r) => s + r.h + BORDER, 0)
  y += 22
  if (y + termsH > BOTTOM) { newPage(); y = 56.7 }
  for (const r of rows) {
    const lx = TERMS_X + CELL_PAD + 4.55
    const vx = TERMS_X + TERMS_COL1 + CELL_PAD + 4.55
    const ls = y + (r.h - r.label.length * 15.7) / 2
    r.label.forEach((ln, i) => text(ln, lx, baseline(ls + i * 15.7, 15.7, LABEL_SIZE), LABEL_SIZE, bold, LABEL))
    const vs = y + (r.h - r.value.length * VALUE_LINE) / 2
    r.value.forEach((ln, i) => text(ln, vx, baseline(vs + i * VALUE_LINE, VALUE_LINE, VALUE), VALUE, regular, GREY))
    y += r.h + BORDER
  }

  // Подпись менеджера (слева) и адрес (справа, либо слева без подписи).
  const signature = opts.options.includeManagerSignature ? buildSignatureLines(opts.manager) : []
  const ADDR = 11, ADDR_PITCH = 26.2
  const blockH = Math.max(signature.length, COMPANY_ADDRESS_LINES.length) * ADDR_PITCH
  y += 24
  if (y + blockH > BOTTOM) { newPage(); y = 56.7 }
  const column = (lines: string[], x: number) =>
    lines.forEach((ln, i) => text(ln, x, baseline(y + i * ADDR_PITCH, 15.7, ADDR), ADDR, regular, GREY))
  if (signature.length) {
    column(signature, ADDRESS_X)
    column(COMPANY_ADDRESS_LINES, ADDRESS_X + 244.5)
  } else {
    column(COMPANY_ADDRESS_LINES, ADDRESS_X)
  }

  return Buffer.from(await doc.save({ useObjectStreams: true }))
}

export type { KpItem }
