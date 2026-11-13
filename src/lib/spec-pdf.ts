/**
 * Инженерная спецификация к КП — отдельный PDF в фирменном стиле КП UMBT.
 * Разделы: обложка и сводка, оборудование (фото, ключевые ТТХ, QR на страницу каталога),
 * фанкойлы в рабочем режиме, комплектующие с артикулами, электроснабжение,
 * гидравлика и баланс мощности, эксплуатационные расходы, логистика и монтаж,
 * шум, источники данных. Все цифры — из каталогов Midea; чего нет — «по запросу».
 */
import fs from 'fs'
import path from 'path'
import QRCode from 'qrcode'
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb, type RGB } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import productsData from '@/data/products.json'
import settings from '@/data/spec-settings.json'
import { getCatalogMatch, getCatalogSource, inferCatalogKey } from './catalogs'
import { preloadImages, type ShrunkImage } from './docx-kp'

export const SPEC_ACCESS_EMAIL = 'nosirovmuhammadjon3@gmail.com'

export function canUseSpec(email: unknown): boolean {
  const allowed = (process.env.SPEC_ACCESS_EMAIL || SPEC_ACCESS_EMAIL).trim().toLowerCase()
  return typeof email === 'string' && email.trim().toLowerCase() === allowed
}

interface FcuSpec {
  waterFlow?: number; waterDp?: number; powerW?: number; airflow?: number; noise?: number; dims?: string; weight?: number
  options?: Record<string, string>
}
interface Product {
  id: string; category?: string; series?: string; model?: string; image?: string; slidesImage?: string
  coolingCapacity?: number; heatingCapacity?: number; coolingCapacityMax?: number; heatingCapacityMax?: number
  powerConsumption?: number; powerSupply?: string; refrigerant?: string; dimensions?: string; weight?: number
  noiseLevel?: string; airflow?: string; capacityNote?: string
  genSpec?: Record<string, string>; genSpecSource?: { catalogKey?: string; page?: number }
  catalogKey?: string; catalogPage?: number; fcuSpec?: FcuSpec
}
export interface SpecItem { productId?: string; model?: string; category?: string; quantity?: number | string; isAdditional?: boolean }
export interface BuildSpecOptions {
  cpNumber: string; cpDate: string; items: SpecItem[]; deltaT?: number
  client?: string; manager?: { name?: string; phone?: string }; origin?: string
}

const products = productsData as unknown as Product[]
const byId = new Map(products.map(p => [p.id, p]))
const byModel = new Map(products.map(p => [String(p.model || '').trim().toUpperCase(), p]))

// Палитра и метрики КП (kp-pdf.ts)
const PAGE_W = 595.28, PAGE_H = 841.89
const M = 42.5, CONTENT_W = PAGE_W - 2 * M
const BLUE = rgb(69 / 255, 176 / 255, 225 / 255)      // шапка таблиц КП
const PALE = rgb(219 / 255, 239 / 255, 249 / 255)     // строки таблиц КП
const PALE2 = rgb(238 / 255, 247 / 255, 252 / 255)
const COVER = rgb(38 / 255, 155 / 255, 217 / 255)     // номер/дата на обложке КП
const LABEL = rgb(0, 163 / 255, 212 / 255)            // подписи условий КП
const GREY = rgb(78 / 255, 78 / 255, 77 / 255)        // значения условий КП
const INK = rgb(0.12, 0.12, 0.12)
const SOFT = rgb(0.55, 0.58, 0.6)
const WHITE = rgb(1, 1, 1)
const GREEN = rgb(0.2, 0.68, 0.42), AMBER = rgb(0.93, 0.6, 0.15), RED = rgb(0.86, 0.3, 0.27)

type Group = 'generator' | 'fcu' | 'indoor' | 'other'
function groupOf(p?: Product, it?: SpecItem): Group {
  const c = `${p?.category || it?.category || ''}`.toLowerCase()
  if (c.includes('фанкойл')) return 'fcu'
  if (c.includes('чиллер') || c.includes('тепловой насос') || c.includes('наруж') || c.includes('внеш')) return 'generator'
  if (c.includes('внутр') || c.includes('кондиционер')) return 'indoor'
  return 'other'
}

const DN = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300]
function pickDn(g: number, v: number) {
  const d = Math.sqrt((4 * g) / (3600 * Math.PI * v)) * 1000
  return DN.find(x => x >= d) || DN[DN.length - 1]
}
/** Медный трёхжильный кабель, прокладка в воздухе — ПУЭ табл. 1.3.7 (ориентир, проверить по длине линии). */
const CABLE: [number, number][] = [[1.5, 19], [2.5, 25], [4, 35], [6, 42], [10, 55], [16, 75], [25, 95], [35, 120], [50, 145], [70, 180], [95, 220], [120, 260]]
const cableFor = (amps: number) => CABLE.find(([, a]) => a >= amps)?.[0]

const num = (v: unknown) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0 }
const fmt = (v: number, d = 2) => v ? v.toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: 0 }).replace(/[  ]/g, ' ') : '—'
const qtyOf = (q: unknown) => Number(String(q ?? '1').match(/[\d.,]+/)?.[0]?.replace(',', '.')) || 1
const clean = (s?: string) => (s && s !== '-' ? s : '')
const dec = (s?: string) => (s ? s.replace(/(\d)\.(\d)/g, '$1,$2') : '')

let assetCache: { regular: Uint8Array; bold: Uint8Array; bg: Uint8Array; logo: Uint8Array | null } | null = null
function assets() {
  if (assetCache) return assetCache
  const t = (f: string) => fs.readFileSync(path.join(process.cwd(), 'templates', f))
  let logo: Uint8Array | null = null
  try { logo = fs.readFileSync(path.join(process.cwd(), 'public/images/branding/logo_umbt.jpg')) } catch {}
  assetCache = { regular: t('kp-fonts/CenturyGothic.ttf'), bold: t('kp-fonts/CenturyGothic-Bold.ttf'), bg: t('kp-page-bg.jpg'), logo }
  return assetCache
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = []
  for (const para of String(text ?? '').split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(cand, size) <= maxW || !line) { line = cand; continue }
      out.push(line); line = word
    }
    out.push(line)
  }
  return out
}

/** Пульт (и панель для кассет) по правилам комплектации UMBT: KJRP-86I — 2-трубные, KJRP-86A — 4-трубные. */
function controlFor(p?: Product): string {
  const c = (p?.category || '').toLowerCase()
  if (c.includes('пульт')) return ''
  const fourPipe = /4[-\s]?х?[-\s]?трубн/.test(c)
  const remote = fourPipe ? 'KJRP-86A/BMFNKD-E' : 'KJRP-86I/MFK-E'
  return c.includes('кассет') ? `${remote} + декоративная панель` : remote
}

const OPTION_LABEL: Record<string, string> = {
  valve3x4: '3-ход. клапан (4 порта)', pipingKit: 'Комплект обвязки', valve3: '3-ход. клапан', valve2: '2-ход. клапан',
  drainTray: 'Поддон клапана', netModule: 'Модуль сети/ЦУ', mountKit: 'Монтажные опоры',
}

export async function buildSpecPdf(opts: BuildSpecOptions): Promise<Buffer> {
  const dT = opts.deltaT || 5
  const origin = (opts.origin || 'https://kp-maker-umbt.vercel.app').replace(/\/$/, '')
  const rows = opts.items
    .filter(it => !it.isAdditional)
    .map((it, i) => {
      const p = (it.productId && byId.get(it.productId)) || byModel.get(String(it.model || '').trim().toUpperCase())
      return { n: i + 1, it, p, qty: qtyOf(it.quantity), group: groupOf(p, it) }
    })
  type Row = typeof rows[number]
  const srcOf = (r: Row) => {
    const key = r.p?.genSpecSource?.catalogKey || r.p?.catalogKey || (r.p && getCatalogMatch(r.p.id)?.catalogKey) || (r.p ? inferCatalogKey(r.p) : null)
    const page = r.p?.genSpecSource?.page || r.p?.catalogPage || (r.p && getCatalogMatch(r.p.id)?.page) || null
    return { key, page, source: getCatalogSource(key || undefined) }
  }

  const a = assets()
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  doc.setTitle(`Инженерная спецификация — КП ${opts.cpNumber}`)
  doc.setAuthor('UMBT')
  doc.setProducer('UMBT KP Maker')

  const imgItems = rows.filter(r => r.p?.image || r.p?.slidesImage).map(r => ({ image: r.p!.image, slidesImage: r.p!.slidesImage }))
  const qrTargets = new Map<string, string>()
  rows.forEach(r => { const s = srcOf(r); if (s.key && s.page) qrTargets.set(`${s.key}/${s.page}`, `${origin}/catalog-pages/${s.key}/${s.page}.pdf`) })
  const [regular, bold, bg, logo, photos, qrPngs] = await Promise.all([
    doc.embedFont(a.regular, { subset: true }),
    doc.embedFont(a.bold, { subset: true }),
    doc.embedJpg(a.bg),
    a.logo ? doc.embedJpg(a.logo).catch(() => null) : Promise.resolve(null),
    preloadImages(imgItems, origin).catch(() => new Map<string, ShrunkImage>()),
    Promise.all([...qrTargets.entries()].map(async ([k, url]) => [k, await QRCode.toBuffer(url, { margin: 0, width: 160, color: { dark: '#1A6FA0', light: '#FFFFFF' } })] as const)),
  ])
  const photo = new Map<string, PDFImage>()
  await Promise.all([...photos.entries()].map(async ([k, im]) => photo.set(k, await doc.embedPng(im.buffer))))
  const qr = new Map<string, PDFImage>()
  await Promise.all(qrPngs.map(async ([k, b]) => qr.set(k, await doc.embedPng(b))))

  // ---------- Примитивы ----------
  const pages: PDFPage[] = []
  let page!: PDFPage
  let y = 0
  const TOP_Y = 70, BOT_Y = PAGE_H - 56
  const text = (s: string, x: number, top: number, size: number, font = regular, color: RGB = INK) =>
    page.drawText(s, { x, y: PAGE_H - top - size * 0.8, size, font, color })
  const textR = (s: string, right: number, top: number, size: number, font = regular, color: RGB = INK) =>
    text(s, right - font.widthOfTextAtSize(s, size), top, size, font, color)
  const textC = (s: string, cx: number, top: number, size: number, font = regular, color: RGB = INK) =>
    text(s, cx - font.widthOfTextAtSize(s, size) / 2, top, size, font, color)
  const rect = (x: number, top: number, w: number, h: number, color: RGB) =>
    page.drawRectangle({ x, y: PAGE_H - top - h, width: w, height: h, color })
  const round = (x: number, top: number, w: number, h: number, r: number, color: RGB, border?: RGB) => {
    const d = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`
    page.drawSvgPath(d, { x, y: PAGE_H - top, color, ...(border ? { borderColor: border, borderWidth: 0.7 } : {}) })
  }
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]); pages.push(page)
    page.drawImage(bg, { x: 0, y: 0, width: PAGE_W, height: PAGE_H })
    if (pages.length > 1) {
      text('ИНЖЕНЕРНАЯ СПЕЦИФИКАЦИЯ', M, 28, 8, bold, LABEL)
      textR(`КП № ${opts.cpNumber} от ${opts.cpDate}`, PAGE_W - M, 28, 8, regular, GREY)
      page.drawLine({ start: { x: M, y: PAGE_H - 44 }, end: { x: PAGE_W - M, y: PAGE_H - 44 }, thickness: 1, color: BLUE })
    }
    y = TOP_Y
  }
  const ensure = (h: number) => { if (y + h > BOT_Y) newPage() }
  let secNo = 0
  const section = (title: string, sub?: string, minAfter = 110) => {
    ensure(minAfter); y += 6; secNo++
    page.drawCircle({ x: M + 13, y: PAGE_H - y - 13, size: 13, color: COVER })
    textC(String(secNo), M + 13, y + 7, 12, bold, WHITE)
    text(title, M + 34, y + 2, 15, bold, COVER)
    if (sub) text(sub, M + 34, y + 21, 8.5, regular, GREY)
    y += sub ? 42 : 34
  }
  const para = (s: string, size = 9, color: RGB = GREY) => {
    for (const ln of wrap(s, regular, size, CONTENT_W)) { ensure(size + 5); text(ln, M, y, size, regular, color); y += size + 5 }
    y += 4
  }
  const table = (cols: { title: string; w: number; align?: 'l' | 'c' | 'r' }[], data: string[][], size = 8.5, opt: { boldCol?: number; total?: string[] } = {}) => {
    const total = cols.reduce((s, c) => s + c.w, 0)
    const ws = cols.map(c => (c.w / total) * CONTENT_W)
    const pad = 5, lh = size + 3.5
    const head = () => {
      const ls = cols.map((c, i) => wrap(c.title, bold, size, ws[i] - 2 * pad))
      const h = Math.max(...ls.map(l => l.length)) * lh + 2 * pad
      rect(M, y, CONTENT_W, h, BLUE)
      let x = M
      ls.forEach((l, i) => { l.forEach((s, j) => textC(s, x + ws[i] / 2, y + pad + j * lh, size, bold, WHITE)); x += ws[i] })
      y += h + 0.75
    }
    const drawRow = (row: string[], fill: RGB, font: PDFFont) => {
      const ls = row.map((v, i) => wrap(v, font, size, ws[i] - 2 * pad))
      const h = Math.max(...ls.map(l => l.length)) * lh + 2 * pad
      if (y + h > BOT_Y) { newPage(); head() }
      let x = M
      ls.forEach((l, i) => {
        rect(x, y, ws[i] - 0.75, h, fill)
        const al = cols[i].align || 'c'
        l.forEach((s, j) => {
          const f = opt.boldCol === i ? bold : font
          const tw = f.widthOfTextAtSize(s, size)
          text(s, al === 'l' ? x + pad : al === 'r' ? x + ws[i] - pad - tw : x + (ws[i] - tw) / 2, y + pad + j * lh, size, f, INK)
        })
        x += ws[i]
      })
      y += h + 0.75
    }
    ensure(60); head()
    data.forEach((row, r) => drawRow(row, r % 2 ? PALE2 : PALE, regular))
    if (opt.total) drawRow(opt.total, PALE, bold)
    y += 12
  }
  const kpiRow = (items: [string, string, string, RGB?][], h = 66) => {
    ensure(h + 10)
    const gap = 10, w = (CONTENT_W - gap * (items.length - 1)) / items.length
    items.forEach(([label, value, unit, accent], i) => {
      const x = M + i * (w + gap)
      round(x, y, w, h, 8, PALE)
      rect(x, y + 12, 3, h - 24, accent || COVER)
      text(label, x + 12, y + 10, 8, regular, GREY)
      text(value, x + 12, y + 25, 17, bold, COVER)
      wrap(unit, regular, 7.5, w - 20).slice(0, 2).forEach((l, j) => text(l, x + 12, y + h - 20 + j * 9, 7.5, regular, GREY))
    })
    y += h + 14
  }

  // ---------- Расчёты ----------
  const fcu = rows.filter(r => r.group === 'fcu')
  const gens = rows.filter(r => r.group === 'generator')
  const indoor = rows.filter(r => r.group === 'indoor')
  const cap = (r: Row) => num(r.p?.coolingCapacity) * r.qty
  const fcuQx = fcu.reduce((s, r) => s + cap(r), 0)
  const fcuQxMax = fcu.reduce((s, r) => s + (num(r.p?.coolingCapacityMax) || num(r.p?.coolingCapacity)) * r.qty, 0)
  const indoorQx = indoor.reduce((s, r) => s + cap(r), 0)
  const loadQx = fcuQx + indoorQx
  const genQx = gens.reduce((s, r) => s + cap(r), 0)
  const genQt = gens.reduce((s, r) => s + num(r.p?.heatingCapacity) * r.qty, 0)
  const flowOf = (r: Row) => num(r.p?.fcuSpec?.waterFlow) || num(r.p?.coolingCapacity) / (1.163 * dT)
  const fcuFlow = fcu.reduce((s, r) => s + flowOf(r) * r.qty, 0)
  const isWater = (r: Row) => !/наруж|vrf/i.test(r.p?.category || '')
  const genFlow = gens.filter(isWater).reduce((s, r) => s + (num(r.p?.genSpec?.waterFlow) || num(r.p?.coolingCapacity) / (1.163 * dT)) * r.qty, 0)
  const designFlow = fcuFlow || genFlow
  const maxDp = fcu.reduce((m, r) => Math.max(m, num(r.p?.fcuSpec?.waterDp)), 0)
  const waterGenQx = gens.filter(isWater).reduce((s, r) => s + cap(r), 0)
  const reserve = genQx && loadQx ? (genQx / loadQx - 1) * 100 : 0
  const reserveColor = !genQx || !loadQx ? SOFT : reserve < 0 ? RED : reserve < 10 ? AMBER : reserve <= 30 ? GREEN : AMBER
  const reserveText = !genQx || !loadQx ? 'Недостаточно данных для сравнения мощности источников и потребителей.'
    : reserve < 0 ? 'Мощности источников не хватает на нагрузку потребителей — подбор нужно пересмотреть.'
    : reserve < 10 ? 'Запас небольшой: при пиковой жаре и одновременной работе всех помещений возможна нехватка.'
    : reserve <= 30 ? 'Оптимальный запас с учётом неодновременности нагрузок и пиковой жары.'
    : 'Запас избыточный — можно рассмотреть источник меньшей мощности или поэтапное наращивание.'
  const genPowerCool = gens.reduce((s, r) => s + (num(r.p?.genSpec?.coolPower) || num(r.p?.powerConsumption)) * r.qty, 0)
  const genPowerHeat = gens.reduce((s, r) => s + num(r.p?.genSpec?.heatPower) * r.qty, 0)
  const fcuPowerKw = fcu.reduce((s, r) => s + num(r.p?.fcuSpec?.powerW) * r.qty, 0) / 1000
  const units = rows.reduce((s, r) => s + r.qty, 0)

  // =============== Обложка ===============
  newPage()
  if (logo) {
    const lw = 92, lh = (logo.height / logo.width) * lw
    page.drawImage(logo, { x: M, y: PAGE_H - 40 - lh, width: lw, height: lh })
  }
  textR(`№ ${opts.cpNumber}`, PAGE_W - M, 44, 16, bold, COVER)
  textR(`Дата: ${opts.cpDate}`, PAGE_W - M, 66, 12, regular, COVER)
  y = 130
  text('Инженерная', M, y, 34, bold, COVER); y += 40
  text('спецификация', M, y, 34, bold, COVER); y += 48
  text('Подбор оборудования Midea и расчёт системы климатизации', M, y, 11, regular, GREY); y += 26
  page.drawLine({ start: { x: M, y: PAGE_H - y }, end: { x: M + 120, y: PAGE_H - y }, thickness: 2.5, color: BLUE }); y += 18
  const meta: [string, string][] = [
    ...(opts.client ? [['Объект', opts.client] as [string, string]] : []),
    ['Приложение к', `коммерческому предложению № ${opts.cpNumber} от ${opts.cpDate}`],
    ...(opts.manager?.name ? [['Инженер-консультант', `${opts.manager.name}${opts.manager.phone ? ', ' + opts.manager.phone : ''}`] as [string, string]] : []),
  ]
  meta.forEach(([k, v]) => {
    text(k, M, y, 9.5, bold, LABEL)
    const ls = wrap(v, regular, 10, CONTENT_W - 150)
    ls.forEach((l, i) => text(l, M + 150, y + i * 14, 10, regular, GREY))
    y += Math.max(1, ls.length) * 14 + 6
  })
  y += 14
  kpiRow([
    ['Холод источников', genQx ? fmt(genQx, 1) : '—', 'кВт', COVER],
    ['Нагрузка потребителей', loadQx ? fmt(loadQx, 1) : '—', fcu.length ? 'кВт, фанкойлы на средней скорости' : 'кВт', GREEN],
    ['Запас по холоду', genQx && loadQx ? `${reserve >= 0 ? '+' : ''}${fmt(reserve, 0)} %` : '—', 'к нагрузке', reserveColor],
    ['Оборудование', fmt(units, 0), `ед. в ${rows.length} позициях`, AMBER],
  ], 76)

  // Схема системы
  const nodes: [string, string][] = []
  if (gens.length) nodes.push([gens.some(isWater) ? 'Чиллер / тепловой насос' : 'Наружный блок', `${fmt(gens.reduce((s, r) => s + r.qty, 0), 0)} ед. · ${fmt(genQx, 1)} кВт`])
  if (fcu.length) nodes.push(['Водяной контур', designFlow ? `${fmt(designFlow, 1)} м³/ч · DN${pickDn(designFlow, 1.0)}` : 'трубопроводы'])
  if (fcu.length) nodes.push(['Фанкойлы', `${fmt(fcu.reduce((s, r) => s + r.qty, 0), 0)} ед. · ${fmt(fcuQx, 1)} кВт`])
  if (indoor.length) nodes.push(['Внутренние блоки', `${fmt(indoor.reduce((s, r) => s + r.qty, 0), 0)} ед. · ${fmt(indoorQx, 1)} кВт`])
  if (nodes.length) {
    text('Схема системы', M, y, 11, bold, COVER); y += 20
    const gap = 26, nw = (CONTENT_W - gap * (nodes.length - 1)) / nodes.length
    nodes.forEach(([t, s], i) => {
      const x = M + i * (nw + gap)
      round(x, y, nw, 54, 10, WHITE, BLUE)
      textC(t, x + nw / 2, y + 13, 9.5, bold, COVER)
      textC(s, x + nw / 2, y + 32, 8, regular, GREY)
      if (i < nodes.length - 1) {
        const ax = x + nw + 4, ay = y + 27
        page.drawLine({ start: { x: ax, y: PAGE_H - ay }, end: { x: ax + gap - 9, y: PAGE_H - ay }, thickness: 1.6, color: BLUE })
        page.drawSvgPath('M 0 0 L -6 -4 L -6 4 Z', { x: ax + gap - 8, y: PAGE_H - ay, color: BLUE })
      }
    })
    y += 74
  }
  const tocTitles = ['Оборудование', ...(fcu.length ? ['Фанкойлы — рабочий режим', 'Комплектующие'] : []), 'Электроснабжение',
    'Гидравлика и баланс мощности', 'Эксплуатационные расходы', 'Логистика и монтаж', ...(fcu.length ? ['Уровень шума'] : []), 'Источники данных']
  text('Содержание', M, y, 11, bold, COVER); y += 20
  tocTitles.forEach((t, i) => {
    const x = M + (i % 2) * (CONTENT_W / 2), top = y + Math.floor(i / 2) * 18
    text(`${i + 1}`, x, top, 9.5, bold, COVER)
    text(t, x + 18, top, 9.5, regular, GREY)
  })

  // =============== 1. Оборудование ===============
  newPage()
  section('Оборудование', 'Номера позиций — как в коммерческом предложении. QR-код открывает страницу каталога Midea')
  for (const r of rows) {
    const p = r.p, g = p?.genSpec || {}, s = p?.fcuSpec
    const params: [string, string][] = []
    const add = (k: string, v?: string) => { if (v) params.push([k, v]) }
    if (r.group === 'fcu') {
      add('Холод, ср. скорость', num(p?.coolingCapacity) ? `${fmt(num(p?.coolingCapacity))} кВт` : '')
      add('Тепло, ср. скорость', num(p?.heatingCapacity) ? `${fmt(num(p?.heatingCapacity))} кВт` : '')
      add('Холод, макс.', num(p?.coolingCapacityMax) ? `${fmt(num(p?.coolingCapacityMax))} кВт` : '')
      add('Расход воздуха', s?.airflow ? `${fmt(s.airflow, 0)} м³/ч` : '')
      add('Шум', s?.noise ? `${fmt(s.noise, 0)} дБ(А)` : '')
      add('Расход воды', s?.waterFlow ? `${fmt(s.waterFlow)} м³/ч` : '')
    } else {
      add('Холод', g.coolKw ? `${dec(g.coolKw)} кВт` : num(p?.coolingCapacity) ? `${fmt(num(p?.coolingCapacity))} кВт` : '')
      add('Тепло', g.heatKw ? `${dec(g.heatKw)} кВт` : num(p?.heatingCapacity) ? `${fmt(num(p?.heatingCapacity))} кВт` : '')
      add('EER / COP', g.eer || g.cop ? `${dec(g.eer) || '—'} / ${dec(g.cop) || '—'}` : '')
      add('Электропитание', g.powerSupply || clean(p?.powerSupply))
      add('Хладагент', (g.refrigerant || clean(p?.refrigerant)).replace('А', 'A'))
      add('Шум', g.noise ? `${dec(g.noise)} дБ(А)` : clean(p?.noiseLevel) ? `${p?.noiseLevel} дБ(А)` : '')
      add('Компрессор', g.compressor)
      add('Масса', g.weight ? `${dec(g.weight)} кг` : '')
      add('Внутр. блоков', g.maxIndoor)
    }
    const shown = params.slice(0, 6)
    const h = 108
    ensure(h + 10)
    round(M, y, CONTENT_W, h, 10, WHITE, PALE)
    const key = p?.image || p?.slidesImage || ''
    const im = photo.get(key)
    const boxW = 112, boxH = 84
    round(M + 10, y + 12, boxW, boxH, 8, PALE2)
    if (im) {
      const k = Math.min((boxW - 10) / im.width, (boxH - 10) / im.height)
      page.drawImage(im, { x: M + 10 + (boxW - im.width * k) / 2, y: PAGE_H - (y + 12 + (boxH + im.height * k) / 2), width: im.width * k, height: im.height * k })
    }
    const x0 = M + 10 + boxW + 14
    const src = srcOf(r)
    const q = src.key && src.page ? qr.get(`${src.key}/${src.page}`) : undefined
    const rightW = q ? 64 : 0
    const infoW = CONTENT_W - (x0 - M) - rightW - 10
    text(`${r.n}`, x0, y + 12, 9, bold, LABEL)
    text(p?.model || r.it.model || '', x0 + 16, y + 10, 12.5, bold, INK)
    const cat = wrap(p?.category || r.it.category || '', regular, 8, infoW - 60)[0] || ''
    text(cat, x0 + 16, y + 28, 8, regular, GREY)
    const chipTxt = `${fmt(r.qty, 2)} шт.`
    const cw = bold.widthOfTextAtSize(chipTxt, 8.5) + 14
    round(x0 + infoW - cw, y + 10, cw, 17, 8.5, COVER)
    text(chipTxt, x0 + infoW - cw + 7, y + 14, 8.5, bold, WHITE)
    const colW = infoW / 3
    shown.forEach(([k, v], i) => {
      const cx = x0 + (i % 3) * colW, top = y + 48 + Math.floor(i / 3) * 28
      text(k, cx, top, 7.5, regular, LABEL)
      text(wrap(v, bold, 9, colW - 6)[0], cx, top + 11, 9, bold, GREY)
    })
    if (!shown.length) text('Технические данные — по запросу у производителя', x0, y + 52, 8.5, regular, SOFT)
    if (q) {
      const qx = M + CONTENT_W - rightW - 4
      page.drawImage(q, { x: qx + 8, y: PAGE_H - (y + 18) - 48, width: 48, height: 48 })
      textC('каталог', qx + 32, y + 72, 7, regular, GREY)
      textC(`стр. ${src.page}`, qx + 32, y + 82, 7, bold, COVER)
    }
    y += h + 10
  }

  // =============== 2–3. Фанкойлы и комплектующие ===============
  if (fcu.length) {
    section('Фанкойлы — рабочий режим', 'Средняя скорость вентилятора: реальный режим работы, по нему считается нагрузка помещений')
    const tot = (f: (r: Row) => number) => fcu.reduce((s, r) => s + f(r) * r.qty, 0)
    table(
      [{ title: '№', w: 4 }, { title: 'Модель', w: 18, align: 'l' }, { title: 'Кол.', w: 6 }, { title: 'Холод, кВт', w: 8 }, { title: 'Тепло, кВт', w: 8 },
        { title: 'Вода, м³/ч', w: 8 }, { title: 'ΔP воды, кПа', w: 8 }, { title: 'Воздух, м³/ч', w: 9 }, { title: 'Шум, дБ(А)', w: 7 },
        { title: 'Эл. мощн., Вт', w: 8 }, { title: 'Холод итого, кВт', w: 9 }],
      fcu.map(r => {
        const s = r.p?.fcuSpec || {}
        return [String(r.n), r.p?.model || r.it.model || '', fmt(r.qty), fmt(num(r.p?.coolingCapacity)), fmt(num(r.p?.heatingCapacity)),
          fmt(num(s.waterFlow)), fmt(num(s.waterDp), 1), fmt(num(s.airflow), 0), fmt(num(s.noise), 0), fmt(num(s.powerW), 0), fmt(cap(r), 1)]
      }),
      8, { boldCol: 1, total: ['', 'Итого', fmt(fcu.reduce((s, r) => s + r.qty, 0), 0), '', '', fmt(tot(flowOf), 2), '', fmt(tot(r => num(r.p?.fcuSpec?.airflow)), 0), '', fmt(tot(r => num(r.p?.fcuSpec?.powerW)), 0), fmt(fcuQx, 1)] },
    )
    const missing = fcu.filter(r => !r.p?.capacityNote).map(r => r.p?.model || r.it.model)
    if (missing.length) para(`Нет в каталоге Midea FCU 2025–2026, параметры уточняются у производителя: ${missing.join(', ')}.`, 8)
    para('Условия каталога: охлаждение — вода 7/12 °C, воздух на входе 27 °C (сух.) / 19 °C (влажн.); нагрев — вода 45/40 °C, воздух 20 °C.', 8)

    section('Комплектующие', 'Артикулы по каталогу Midea FCU — что понадобится для монтажа и управления каждой позицией')
    const optKeys = ['valve3', 'valve2', 'pipingKit', 'drainTray', 'mountKit', 'netModule'].filter(k => fcu.some(r => r.p?.fcuSpec?.options?.[k] && r.p.fcuSpec.options[k] !== 'Встроен'))
    table(
      [{ title: '№', w: 4 }, { title: 'Модель', w: 18, align: 'l' }, { title: 'Кол.', w: 6 }, { title: 'Пульт управления', w: 22, align: 'l' },
        ...optKeys.map(k => ({ title: OPTION_LABEL[k], w: 12 }))],
      fcu.map(r => [String(r.n), r.p?.model || r.it.model || '', fmt(r.qty), controlFor(r.p), ...optKeys.map(k => (r.p?.fcuSpec?.options?.[k] || '—').replace(/\+/g, ' + '))]),
      7.5, { boldCol: 1 },
    )
    const need = new Map<string, number>()
    const addNeed = (art: string, n: number) => {
      for (const part of art.split('+').map(s => s.trim()).filter(s => s && s !== '—' && s !== 'Встроен')) need.set(part, (need.get(part) || 0) + n)
    }
    fcu.forEach(r => {
      addNeed(controlFor(r.p).split(' + ')[0], r.qty)
      if (/кассет/i.test(r.p?.category || '')) addNeed('Декоративная панель (по модели блока)', r.qty)
      const o = r.p?.fcuSpec?.options || {}
      if (o.valve3) addNeed(o.valve3, r.qty)
    })
    if (need.size) {
      ensure(Math.min(260, 70 + need.size * 22))
      text('Сводная потребность: пульт, панель и 3-ходовой клапан на каждый фанкойл', M, y, 10, bold, COVER); y += 18
      table([{ title: 'Артикул', w: 60, align: 'l' }, { title: 'Количество, шт.', w: 40 }],
        [...need.entries()].sort((x, z) => z[1] - x[1]).map(([k, v]) => [k, fmt(v, 0)]), 8.5, { boldCol: 0 })
    }
    para('Выбор между 2- и 3-ходовыми клапанами и комплектами обвязки зависит от гидравлической схемы проекта. Пульты: KJRP-86I — для 2-трубных, KJRP-86A — для 4-трубных фанкойлов.', 8)
  }

  // =============== Электроснабжение ===============
  section('Электроснабжение', 'Нагрузка на электросеть, токи и защитные автоматы')
  const elec = gens.concat(fcu).map(r => {
    const g = r.p?.genSpec || {}
    const isF = r.group === 'fcu'
    const powerKw = isF ? num(r.p?.fcuSpec?.powerW) / 1000 : num(g.coolPower) || num(r.p?.powerConsumption)
    const curr = num(g.cableCurrent) || num(g.maxCurrent)
    const brk = num(g.breaker)
    const cable = brk ? cableFor(brk) : curr ? cableFor(curr * 1.25) : undefined
    return { r, isF, powerKw, supply: isF ? '220–240 В / 1 ф / 50 Гц' : (g.powerSupply || clean(r.p?.powerSupply) || '—'), curr, brk, cable }
  })
  table(
    [{ title: '№', w: 4 }, { title: 'Модель', w: 20, align: 'l' }, { title: 'Кол.', w: 6 }, { title: 'Электропитание', w: 17 },
      { title: 'Мощность ед., кВт', w: 10 }, { title: 'Мощность итого, кВт', w: 11 }, { title: 'Расчётный ток, А', w: 10 },
      { title: 'Автомат, А', w: 9 }, { title: 'Кабель Cu, мм²', w: 13 }],
    elec.map(e => [String(e.r.n), e.r.p?.model || e.r.it.model || '', fmt(e.r.qty), e.supply, e.powerKw ? fmt(e.powerKw, 3) : '—',
      e.powerKw ? fmt(e.powerKw * e.r.qty, 2) : '—', e.curr ? fmt(e.curr, 1) : '—', e.brk ? fmt(e.brk, 0) : '—',
      e.cable ? `3–5 × ${fmt(e.cable, 1)}` : e.isF ? 'групповая линия' : 'по документации']),
    8, { boldCol: 1, total: ['', 'Итого', '', '', '', fmt(genPowerCool + fcuPowerKw, 2), '', '', ''] },
  )
  para('Ток и автомат — по таблицам выбора кабеля и автомата каталога Midea VRF и паспортным данным агрегатов. Сечение — ориентир по ПУЭ (табл. 1.3.7, медь, прокладка в воздухе); окончательно проверяется по длине линии, падению напряжения и способу прокладки. Фанкойлы подключаются групповыми линиями 220 В.', 8)

  // =============== Гидравлика и баланс ===============
  section('Гидравлика и баланс мощности', `Сравнение источников и потребителей, расчёт водяного контура (Δt = ${dT} °C)`, 200)
  const bars: [string, number, RGB][] = ([
    ['Источники, холод', genQx, COVER],
    ['Фанкойлы, ср. скорость', fcuQx, GREEN],
    ['Фанкойлы, макс. скорость', fcuQxMax > fcuQx ? fcuQxMax : 0, rgb(0.6, 0.85, 0.7)],
    ['Внутренние блоки', indoorQx, rgb(0.45, 0.4, 0.85)],
    ['Источники, тепло', genQt, AMBER],
  ] as [string, number, RGB][]).filter(b => b[1] > 0)
  const maxBar = Math.max(1, ...bars.map(b => b[1]))
  const lw = 150, bw = CONTENT_W - lw - 72
  bars.forEach(([l, v, c]) => {
    ensure(26)
    text(l, M, y + 3, 9, regular, GREY)
    round(M + lw, y, bw, 15, 4, PALE2)
    round(M + lw, y, Math.max(8, (v / maxBar) * bw), 15, 4, c)
    textR(`${fmt(v, 1)} кВт`, M + CONTENT_W, y + 3, 9.5, bold, COVER)
    y += 24
  })
  y += 4
  const rl = wrap(reserveText, regular, 8.5, CONTENT_W - 30)
  const rh = 32 + rl.length * 12
  ensure(rh + 8)
  round(M, y, CONTENT_W, rh, 8, PALE)
  rect(M, y + 8, 4, rh - 16, reserveColor)
  text(genQx && loadQx ? `Запас мощности ${reserve >= 0 ? '+' : ''}${fmt(reserve, 1)} %` : 'Запас мощности', M + 16, y + 9, 11, bold, COVER)
  rl.forEach((l, i) => text(l, M + 16, y + 27 + i * 12, 8.5, regular, GREY))
  y += rh + 14
  if (fcu.length || gens.some(isWater)) {
    kpiRow([
      ['Расход воды', designFlow ? fmt(designFlow, 1) : '—', 'м³/ч', COVER],
      ['Магистраль', designFlow ? `DN${pickDn(designFlow, 1.0)}` : '—', designFlow ? `при 1,0 м/с; DN${pickDn(designFlow, 1.5)} при 1,5 м/с` : '', COVER],
      ['Объём воды в системе', waterGenQx ? `≥ ${fmt(waterGenQx * 3, 0)}` : '—', 'л (3–5 л на 1 кВт источника)', GREEN],
      ['Сопротивление фанкойла', maxDp ? fmt(maxDp, 1) : '—', 'кПа, наибольшее — для подбора насоса', AMBER],
    ], 76)
    para('Расход по фанкойлам — сумма каталожных значений; для источников G = Q / (1,163 · Δt). Диаметры, насосная группа и бак-аккумулятор окончательно подбираются в проекте по гидравлическому расчёту.', 8)
  }

  // =============== Эксплуатационные расходы ===============
  section('Эксплуатационные расходы', 'Ориентировочная стоимость электроэнергии за сезон')
  const tariff = settings.tariff.sumPerKwh
  const hc = settings.cooling.days * settings.cooling.hoursPerDay * settings.cooling.loadFactor
  const hh = settings.heating.days * settings.heating.hoursPerDay * settings.heating.loadFactor
  const coolKw = genPowerCool + fcuPowerKw
  const heatKw = genPowerHeat ? genPowerHeat + fcuPowerKw : 0
  const opex: string[][] = []
  if (coolKw) opex.push(['Охлаждение', settings.cooling.label, fmt(coolKw, 2), fmt(hc, 0), fmt(coolKw * hc, 0), fmt(coolKw * hc * tariff, 0)])
  if (heatKw) opex.push(['Отопление', settings.heating.label, fmt(heatKw, 2), fmt(hh, 0), fmt(heatKw * hh, 0), fmt(heatKw * hh * tariff, 0)])
  if (opex.length) {
    table([{ title: 'Режим', w: 12, align: 'l' }, { title: 'Допущения', w: 34, align: 'l' }, { title: 'Мощность, кВт', w: 11 },
      { title: 'Экв. часов', w: 10 }, { title: 'кВт·ч за сезон', w: 15 }, { title: 'Сумма, сум', w: 18 }], opex, 8,
    { boldCol: 0, total: ['Итого за год', '', '', '', fmt(coolKw * hc + heatKw * hh, 0), fmt((coolKw * hc + heatKw * hh) * tariff, 0)] })
    kpiRow([
      ['Месяц охлаждения', fmt((coolKw * hc * tariff) / (settings.cooling.days / 30), 0), 'сум, в среднем', COVER],
      ['Час на полной мощности', fmt(coolKw * tariff, 0), 'сум', AMBER],
      ['Тариф', fmt(tariff, 0), 'сум за 1 кВт·ч с НДС', GREEN],
    ], 66)
    para(`Тариф: ${settings.tariff.label}. Расчёт ориентировочный: фактическое потребление зависит от теплопритоков, режима работы и уставок; мощность — номинальная по каталогу.`, 7.5)
  } else para('Нет данных о потребляемой мощности оборудования — расчёт невозможен.', 8.5)

  // =============== Логистика и монтаж ===============
  section('Логистика и монтаж', 'Массы и габариты для доставки, подъёма и оценки нагрузки на основание')
  const logi = rows.map(r => {
    const g = r.p?.genSpec || {}, s = r.p?.fcuSpec
    const dims = g.dims || s?.dims || clean(r.p?.dimensions)
    const w = num(g.weight) || num(s?.weight) || num(r.p?.weight)
    const d = String(dims || '').split(/[×x]/).map(Number)
    const load = w && d.length === 3 && d[0] && d[2] ? w / ((d[0] / 1000) * (d[2] / 1000)) : 0
    return { r, dims, w, load }
  })
  const heavy = logi.filter(l => l.w >= 300)
  table(
    [{ title: '№', w: 4 }, { title: 'Модель', w: 22, align: 'l' }, { title: 'Кол.', w: 6 }, { title: 'Габариты Ш×В×Г, мм', w: 20 },
      { title: 'Масса ед., кг', w: 11 }, { title: 'Масса итого, кг', w: 12 }, { title: 'Нагрузка, кг/м²', w: 12 }, { title: 'Подъём', w: 13 }],
    logi.map(l => [String(l.r.n), l.r.p?.model || l.r.it.model || '', fmt(l.r.qty), l.dims || '—', l.w ? fmt(l.w, 1) : '—',
      l.w ? fmt(l.w * l.r.qty, 0) : '—', l.load ? fmt(l.load, 0) : '—', !l.w ? '—' : l.w >= 300 ? 'кран / манипулятор' : l.w >= 80 ? '2–4 человека' : 'вручную']),
    8, { boldCol: 1, total: ['', 'Итого', fmt(units, 0), '', '', fmt(logi.reduce((s, l) => s + l.w * l.r.qty, 0), 0), '', ''] },
  )
  if (heavy.length) para(`Для ${[...new Set(heavy.map(l => l.r.p?.model))].join(', ')} нужен кран или манипулятор; при установке на кровлю — проверка несущей способности по нагрузке из таблицы.`, 8)
  para('Нагрузка — масса нетто, делённая на площадь основания по габаритам. Для водяных агрегатов рабочая масса больше на объём воды в теплообменнике. Строки без массы — данные уточняются у производителя.', 7.5)

  // =============== Шум ===============
  if (fcu.length) {
    section('Уровень шума', 'Шум фанкойлов на средней скорости и рекомендуемые уровни для помещений, дБ(А)')
    const norms = settings.noiseNorms
    table(
      [{ title: 'Модель', w: 24, align: 'l' }, { title: 'Шум, дБ(А)', w: 12 }, ...norms.map(n => ({ title: `${n.room} — ${n.dba}`, w: 16 }))],
      [...new Map(fcu.map(r => [r.p?.model, r])).values()].map(r => {
        const nz = num(r.p?.fcuSpec?.noise)
        return [r.p?.model || '', nz ? fmt(nz, 0) : '—', ...norms.map(n => !nz ? '—' : nz <= n.dba ? 'подходит' : `+${fmt(nz - n.dba, 0)} дБ`)]
      }),
      8, { boldCol: 0 },
    )
    para('Уровни — ориентир для проектирования; шум в каталоге измерен в полубезэховой камере, в помещении он зависит от отделки, расстояния и способа монтажа. Для спален и номеров рекомендуем низкую скорость в ночном режиме.', 7.5)
  }

  // =============== Источники ===============
  section('Источники данных', undefined, 80)
  const seen = new Set<string>()
  const srcRows: string[][] = []
  rows.forEach(r => {
    const s = srcOf(r)
    const id = `${r.p?.model}|${s.key}|${s.page}`
    if (seen.has(id)) return; seen.add(id)
    srcRows.push([r.p?.model || r.it.model || '', s.source?.title || '—', s.page ? String(s.page) : '—'])
  })
  table([{ title: 'Модель', w: 35, align: 'l' }, { title: 'Документ', w: 50, align: 'l' }, { title: 'Стр.', w: 15 }], srcRows, 8, { boldCol: 0 })
  para(`Тариф на электроэнергию: ${settings.tariff.label}. Технические характеристики могут быть изменены производителем без предварительного уведомления. Документ подготовлен UMBT для оценки проектного решения и не заменяет рабочую документацию.`, 7.5)

  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: M, y: 40 }, end: { x: PAGE_W - M, y: 40 }, thickness: 0.6, color: PALE })
    pg.drawText('UMBT · Uzbekistan Midea Building Technologies', { x: M, y: 26, size: 7.5, font: regular, color: GREY })
    const s = `${i + 1} / ${pages.length}`
    pg.drawText(s, { x: PAGE_W - M - bold.widthOfTextAtSize(s, 8.5), y: 26, size: 8.5, font: bold, color: COVER })
  })
  return Buffer.from(await doc.save())
}
