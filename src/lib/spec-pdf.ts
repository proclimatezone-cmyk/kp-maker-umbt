/**
 * Спецификация оборудования к КП («Приложение № 1») — один PDF:
 * сводка системы, перечень оборудования, ТТХ фанкойлов на средней скорости,
 * инженерный расчёт водяного контура, преимущества серий и источники данных.
 * Все цифры — из products.json (каталоги Midea); чего нет в каталоге — «по запросу».
 */
import fs from 'fs'
import path from 'path'
import { PDFDocument, PDFFont, PDFPage, rgb, type RGB } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import productsData from '@/data/products.json'
import { getCatalogMatch, getCatalogSource, inferCatalogKey } from './catalogs'

export const SPEC_ACCESS_EMAIL = 'nosirovmuhammadjon3@gmail.com'

export function canUseSpec(email: unknown): boolean {
  const allowed = (process.env.SPEC_ACCESS_EMAIL || SPEC_ACCESS_EMAIL).trim().toLowerCase()
  return typeof email === 'string' && email.trim().toLowerCase() === allowed
}

interface FcuSpec { waterFlow?: number; waterDp?: number; powerW?: number; airflow?: number; noise?: number; dims?: string; weight?: number }
interface Product {
  id: string; category?: string; series?: string; model?: string
  coolingCapacity?: number; heatingCapacity?: number; coolingCapacityMax?: number; heatingCapacityMax?: number
  powerConsumption?: number; powerSupply?: string; refrigerant?: string; dimensions?: string; weight?: number
  noiseLevel?: string; airflow?: string; capacityNote?: string; genSpec?: Record<string, string>; genSpecSource?: { catalogKey?: string; page?: number }; catalogKey?: string; catalogPage?: number; fcuSpec?: FcuSpec
}
export interface SpecItem { productId?: string; model?: string; category?: string; quantity?: number | string; isAdditional?: boolean }
export interface BuildSpecOptions { cpNumber: string; cpDate: string; items: SpecItem[]; deltaT?: number; client?: string; manager?: { name?: string; phone?: string } }

const products = productsData as unknown as Product[]
const byId = new Map(products.map(p => [p.id, p]))
const byModel = new Map(products.map(p => [String(p.model || '').trim().toUpperCase(), p]))

const PAGE_W = 595.28, PAGE_H = 841.89
const M = 42.5, CONTENT_W = PAGE_W - 2 * M
const TOP = 92, BOTTOM = PAGE_H - 60
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)
const NAVY = hex('#0E2A47'), NAVY2 = hex('#17406A'), CYAN = hex('#26A0DA'), SKY = hex('#E8F4FB'), MIST = hex('#F4F7FA')
const LINE = hex('#DCE4EC'), INK = hex('#1C2430'), GREY = hex('#66707C'), WHITE = rgb(1, 1, 1)
const GREEN = hex('#2BB673'), AMBER = hex('#F2A33A'), RED = hex('#E0524D'), VIOLET = hex('#6C5CE7')
const GROUP_COLOR = { generator: CYAN, fcu: GREEN, indoor: VIOLET, other: GREY } as const
const GROUP_LABEL = { generator: 'Источник холода / тепла', fcu: 'Фанкойл', indoor: 'Внутренний блок', other: 'Прочее' } as const

type Group = 'generator' | 'fcu' | 'indoor' | 'other'
function groupOf(p?: Product, it?: SpecItem): Group {
  const c = `${p?.category || it?.category || ''}`.toLowerCase()
  if (c.includes('фанкойл')) return 'fcu'
  if (c.includes('чиллер') || c.includes('тепловой насос') || c.includes('наруж') || c.includes('внеш')) return 'generator'
  if (c.includes('внутр') || c.includes('кондиционер')) return 'indoor'
  return 'other'
}

/** Тексты преимуществ — свои формулировки UMBT по типу оборудования. */
const ADVANTAGES: { test: RegExp; title: string; points: [string, string][] }[] = [
  {
    test: /чиллер/i, title: 'Чиллеры Midea',
    points: [
      ['Модульность', 'Мощность наращивается модулями по мере роста объекта; отказ одного модуля не останавливает систему.'],
      ['Работа в жару', 'Рассчитаны на летние температуры Узбекистана — стабильное охлаждение при +45 °C и выше.'],
      ['Тепловой насос', 'Реверсивный цикл: зимой та же установка греет теплоноситель, без отдельной котельной.'],
      ['Диспетчеризация', 'Интеграция в BMS здания по Modbus, удалённый контроль и журнал аварий.'],
    ],
  },
  {
    test: /тепловой насос/i, title: 'Тепловые насосы Midea',
    points: [
      ['Экономия', 'COP около 4: на 1 кВт электроэнергии — до 4 кВт тепла, дешевле электрокотла и газа по эксплуатации.'],
      ['Широкий диапазон', 'Работа при морозе и в жару, горячая вода круглый год.'],
      ['Защиты', 'Контроль давления, тока и температуры, защита водяного контура от замерзания.'],
    ],
  },
  {
    test: /фанкойл/i, title: 'Фанкойлы Midea',
    points: [
      ['Тихая работа', 'Малошумные вентиляторы — подходят для гостиничных номеров, офисов и спален.'],
      ['Средняя скорость', 'Мощность в спецификации указана на средней скорости — реальный рабочий режим, а не пиковый.'],
      ['Гибкий монтаж', 'Канальные, кассетные и напольно-потолочные исполнения под любой интерьер и высоту потолка.'],
      ['Управление', 'Проводные пульты с Modbus, подключение к центральному контроллеру и BMS.'],
    ],
  },
  {
    test: /vrf|наруж|внутр/i, title: 'VRF-системы Midea',
    points: [
      ['Инверторные компрессоры', 'Плавная подстройка под нагрузку — экономия энергии на частичных режимах.'],
      ['Длинные трассы', 'Большие перепады высот и длины фреоновых трасс — гибкость размещения блоков.'],
      ['Централизованное управление', 'Единая сеть управления всеми внутренними блоками здания.'],
    ],
  },
]

const DN = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300]
/** Внутренний диаметр (мм) при скорости v (м/с) для расхода G (м³/ч) → ближайший DN не меньше. */
function pickDn(g: number, v: number) {
  const d = Math.sqrt((4 * g) / (3600 * Math.PI * v)) * 1000
  return DN.find(x => x >= d) || DN[DN.length - 1]
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }
const fmt = (v: number, d = 2) => v ? v.toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: 0 }).replace(/ /g, ' ') : '—'
const qtyOf = (q: unknown) => Number(String(q ?? '1').match(/[\d.,]+/)?.[0]?.replace(',', '.')) || 1
const clean = (s?: string) => (s && s !== '-' ? s : '')

let fontCache: { regular: Uint8Array; bold: Uint8Array; logo: Uint8Array | null } | null = null
function fontFiles() {
  if (fontCache) return fontCache
  const t = (f: string) => fs.readFileSync(path.join(process.cwd(), 'templates', f))
  let logo: Uint8Array | null = null
  try { logo = fs.readFileSync(path.join(process.cwd(), 'public/images/branding/logo_umbt.jpg')) } catch {}
  fontCache = { regular: t('kp-fonts/CenturyGothic.ttf'), bold: t('kp-fonts/CenturyGothic-Bold.ttf'), logo }
  return fontCache
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

/** Рекомендации по монтажу — практические пункты UMBT для каждого типа оборудования. */
const INSTALL: { group: Group; title: string; points: string[] }[] = [
  { group: 'generator', title: 'Источники холода / тепла', points: [
    'Ровное основание с запасом по несущей способности на рабочую массу агрегата, виброопоры под каждую точку опоры.',
    'Сервисные зоны со всех сторон по монтажной инструкции; беспрепятственный выброс воздуха вверх.',
    'На входе воды — сетчатый фильтр, на выходе — реле протока; запорная арматура и гибкие вставки на подключениях.',
    'Объём воды в контуре не ниже минимального (см. расчёт) — при необходимости бак-аккумулятор.',
    'Зимний режим: антифриз или дренаж контура, если агрегат не работает на нагрев.',
  ] },
  { group: 'fcu', title: 'Фанкойлы', points: [
    'Дренаж с уклоном не менее 1 %, гидрозатвор; для кассет — встроенная дренажная помпа.',
    'Двух- или трёхходовые клапаны с приводами — для поддержания температуры в каждом помещении.',
    'Теплоизоляция трубопроводов и клапанов против конденсата, балансировочные клапаны на ветках.',
    'Сервисный люк в потолке под канальные и кассетные блоки.',
  ] },
  { group: 'indoor', title: 'VRF и внутренние блоки', points: [
    'Длины и перепады фреоновых трасс — в пределах, указанных производителем для серии.',
    'Разветвители (рефнеты) только оригинальные, горизонтальная или вертикальная установка по инструкции.',
    'Опрессовка азотом, вакуумирование и дозаправка хладагентом по фактической длине трасс.',
  ] },
]

export async function buildSpecPdf(opts: BuildSpecOptions): Promise<Buffer> {
  const dT = opts.deltaT || 5
  const rows = opts.items
    .filter(it => !it.isAdditional)
    .map((it, i) => {
      const p = (it.productId && byId.get(it.productId)) || byModel.get(String(it.model || '').trim().toUpperCase())
      const g = groupOf(p, it)
      return { n: i + 1, it, p, qty: qtyOf(it.quantity), group: (g === 'other' && /vrf|наруж/i.test(p?.category || '')) ? 'generator' as Group : g }
    })

  const f = fontFiles()
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  doc.setTitle(`Инженерная спецификация — КП ${opts.cpNumber}`)
  doc.setAuthor('UMBT')
  doc.setProducer('UMBT KP Maker')
  const [regular, bold] = await Promise.all([doc.embedFont(f.regular, { subset: true }), doc.embedFont(f.bold, { subset: true })])
  const logo = f.logo ? await doc.embedJpg(f.logo).catch(() => null) : null

  // ---------- Примитивы ----------
  const pages: PDFPage[] = []
  let page!: PDFPage
  let y = 0
  const TOP_Y = 78, BOT_Y = PAGE_H - 54
  const text = (s: string, x: number, top: number, size: number, font = regular, color: RGB = INK) =>
    page.drawText(s, { x, y: PAGE_H - top - size * 0.8, size, font, color })
  const textR = (s: string, right: number, top: number, size: number, font = regular, color: RGB = INK) =>
    text(s, right - font.widthOfTextAtSize(s, size), top, size, font, color)
  const textC = (s: string, cx: number, top: number, size: number, font = regular, color: RGB = INK) =>
    text(s, cx - font.widthOfTextAtSize(s, size) / 2, top, size, font, color)
  const rect = (x: number, top: number, w: number, h: number, color: RGB, border?: RGB) =>
    page.drawRectangle({ x, y: PAGE_H - top - h, width: w, height: h, color, ...(border ? { borderColor: border, borderWidth: 0.6 } : {}) })
  const round = (x: number, top: number, w: number, h: number, r: number, color: RGB, border?: RGB) => {
    const d = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`
    page.drawSvgPath(d, { x, y: PAGE_H - top, color, ...(border ? { borderColor: border, borderWidth: 0.6 } : {}) })
  }
  const line = (x1: number, t1: number, x2: number, t2: number, color: RGB = LINE, w = 0.6) =>
    page.drawLine({ start: { x: x1, y: PAGE_H - t1 }, end: { x: x2, y: PAGE_H - t2 }, thickness: w, color })
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]); pages.push(page)
    rect(0, 0, PAGE_W, 46, NAVY)
    rect(0, 46, PAGE_W, 3, CYAN)
    text('UMBT', M, 15, 15, bold, WHITE)
    text('ИНЖЕНЕРНАЯ СПЕЦИФИКАЦИЯ', M + 52, 19, 7.5, regular, hex('#9FC3E0'))
    textR(`КП № ${opts.cpNumber}  ·  ${opts.cpDate}`, PAGE_W - M, 19, 8, regular, WHITE)
    y = TOP_Y
  }
  const ensure = (h: number) => { if (y + h > BOT_Y) newPage() }
  let secNo = 0
  const section = (title: string, sub?: string) => {
    ensure(120); y += 8; secNo++
    const tag = String(secNo).padStart(2, '0')
    round(M, y, 30, 22, 4, NAVY)
    textC(tag, M + 15, y + 6, 11, bold, WHITE)
    text(title, M + 40, y + 2, 14, bold, NAVY)
    if (sub) text(sub, M + 40, y + 19, 8, regular, GREY)
    y += sub ? 38 : 32
  }
  const para = (s: string, size = 8.5, color: RGB = GREY, x = M, w = CONTENT_W) => {
    for (const ln of wrap(s, regular, size, w)) { ensure(size + 4); text(ln, x, y, size, regular, color); y += size + 4 }
    y += 3
  }
  const chip = (s: string, x: number, top: number, bg: RGB, fg: RGB = WHITE, size = 7.5) => {
    const w = bold.widthOfTextAtSize(s, size) + 12
    round(x, top, w, size + 8, (size + 8) / 2, bg)
    text(s, x + 6, top + 4, size, bold, fg)
    return w
  }

  /** Аккуратная таблица: шапка navy, тонкие разделители, зебра очень светлая. */
  const table = (cols: { title: string; w: number; align?: 'l' | 'c' | 'r' }[], data: string[][], size = 8, accent?: (r: number) => RGB | null) => {
    const total = cols.reduce((s, c) => s + c.w, 0)
    const ws = cols.map(c => (c.w / total) * CONTENT_W)
    const pad = 5, lh = size + 3.5
    const head = () => {
      const ls = cols.map((c, i) => wrap(c.title, bold, size - 0.5, ws[i] - 2 * pad))
      const h = Math.max(...ls.map(l => l.length)) * lh + 2 * pad
      round(M, y, CONTENT_W, h, 4, NAVY2)
      let x = M
      ls.forEach((l, i) => { l.forEach((s, j) => textC(s, x + ws[i] / 2, y + pad + j * lh, size - 0.5, bold, WHITE)); x += ws[i] })
      y += h
    }
    ensure(70); head()
    data.forEach((row, r) => {
      const ls = row.map((v, i) => wrap(v, regular, size, ws[i] - 2 * pad))
      const h = Math.max(...ls.map(l => l.length)) * lh + 2 * pad
      if (y + h > BOT_Y) { newPage(); head() }
      if (r % 2) rect(M, y, CONTENT_W, h, MIST)
      const ac = accent?.(r); if (ac) rect(M, y, 3, h, ac)
      let x = M
      ls.forEach((l, i) => {
        const al = cols[i].align || 'c'
        l.forEach((s, j) => {
          const tw = regular.widthOfTextAtSize(s, size)
          text(s, al === 'l' ? x + pad + (i === 0 && ac ? 3 : 0) : al === 'r' ? x + ws[i] - pad - tw : x + (ws[i] - tw) / 2, y + pad + j * lh, size, i === 1 ? bold : regular, INK)
        })
        x += ws[i]
      })
      y += h
      line(M, y, M + CONTENT_W, y)
    })
    y += 12
  }

  // ---------- Расчёты ----------
  const fcu = rows.filter(r => r.group === 'fcu')
  const gens = rows.filter(r => r.group === 'generator')
  const indoor = rows.filter(r => r.group === 'indoor')
  const capOf = (r: typeof rows[number]) => num(r.p?.coolingCapacity) * r.qty
  const fcuQx = fcu.reduce((s, r) => s + capOf(r), 0)
  const fcuQxMax = fcu.reduce((s, r) => s + (num(r.p?.coolingCapacityMax) || num(r.p?.coolingCapacity)) * r.qty, 0)
  const fcuQt = fcu.reduce((s, r) => s + num(r.p?.heatingCapacity) * r.qty, 0)
  const indoorQx = indoor.reduce((s, r) => s + capOf(r), 0)
  const genQx = gens.reduce((s, r) => s + capOf(r), 0)
  const genQt = gens.reduce((s, r) => s + num(r.p?.heatingCapacity) * r.qty, 0)
  const loadQx = fcuQx + indoorQx
  const flowOf = (r: typeof fcu[number]) => num(r.p?.fcuSpec?.waterFlow) || num(r.p?.coolingCapacity) / (1.163 * dT)
  const fcuFlow = fcu.reduce((s, r) => s + flowOf(r) * r.qty, 0)
  const genFlow = gens.reduce((s, r) => s + (num(r.p?.genSpec?.waterFlow) && num(r.p?.coolingCapacity) ? num(r.p?.genSpec?.waterFlow) : num(r.p?.coolingCapacity) / (1.163 * dT)) * r.qty, 0)
  const fcuPowerKw = fcu.reduce((s, r) => s + num(r.p?.fcuSpec?.powerW) * r.qty, 0) / 1000
  const genPowerKw = gens.reduce((s, r) => s + (num(r.p?.genSpec?.coolPower) || num(r.p?.powerConsumption)) * r.qty, 0)
  const maxDp = fcu.reduce((m, r) => Math.max(m, num(r.p?.fcuSpec?.waterDp)), 0)
  const designFlow = fcuFlow || genFlow
  const reserve = genQx && loadQx ? (genQx / loadQx - 1) * 100 : 0
  const reserveColor = !genQx || !loadQx ? GREY : reserve < 0 ? RED : reserve < 10 ? AMBER : reserve <= 30 ? GREEN : AMBER
  const reserveText = !genQx || !loadQx ? 'нет данных для сравнения' : reserve < 0 ? 'дефицит мощности — проверьте подбор'
    : reserve < 10 ? 'малый запас — учесть пиковые нагрузки' : reserve <= 30 ? 'оптимальный запас' : 'избыточный запас — возможна оптимизация'
  const totalUnits = rows.reduce((s, r) => s + r.qty, 0)

  // ================= Страница 1: обложка =================
  newPage()
  round(M, y, CONTENT_W, 150, 10, NAVY)
  rect(M + CONTENT_W - 160, y, 160, 150, NAVY2)
  round(M + CONTENT_W - 12, y, 12, 150, 0, NAVY2)
  if (logo) {
    const lw = 70, lh = (logo.height / logo.width) * lw
    round(M + CONTENT_W - 130, y + 20, 100, lh + 16, 6, WHITE)
    page.drawImage(logo, { x: M + CONTENT_W - 115, y: PAGE_H - (y + 28) - lh, width: lw, height: lh })
  }
  text('Инженерная спецификация', M + 22, y + 22, 22, bold, WHITE)
  text('подбор и расчёт системы', M + 22, y + 52, 16, regular, hex('#BFD9EE'))
  const client = (opts.client || '').trim()
  if (client) wrap(`Объект: ${client}`, bold, 10, CONTENT_W - 210).slice(0, 2).forEach((l, i) => text(l, M + 22, y + 84 + i * 14, 10, bold, WHITE))
  text(`Приложение к коммерческому предложению № ${opts.cpNumber} от ${opts.cpDate}`, M + 22, y + 122, 8, regular, hex('#9FC3E0'))
  if (opts.manager?.name) text(`Инженер-консультант: ${opts.manager.name}${opts.manager.phone ? '  ·  ' + opts.manager.phone : ''}`, M + 22, y + 134, 8, regular, hex('#9FC3E0'))
  y += 166

  // KPI-плитки
  const kpis: [string, string, string, RGB][] = [
    ['Мощность источников', genQx ? fmt(genQx, 1) : '—', 'кВт · холод', CYAN],
    ['Нагрузка потребителей', loadQx ? fmt(loadQx, 1) : '—', fcu.length ? 'кВт · фанкойлы MED' : 'кВт · внутренние блоки', GREEN],
    ['Запас по холоду', genQx && loadQx ? `${reserve >= 0 ? '+' : ''}${fmt(reserve, 0)}` : '—', '% к нагрузке', reserveColor],
    ['Единиц оборудования', fmt(totalUnits, 0), `${rows.length} позиций`, VIOLET],
  ]
  const kw = (CONTENT_W - 3 * 10) / 4
  kpis.forEach(([l, v, u, c], i) => {
    const x = M + i * (kw + 10)
    round(x, y, kw, 74, 8, WHITE, LINE)
    rect(x + 12, y + 12, 18, 3, c)
    text(l, x + 12, y + 22, 7.5, regular, GREY)
    text(v, x + 12, y + 36, 20, bold, NAVY)
    text(u, x + 12, y + 60, 7, regular, GREY)
  })
  y += 92

  // Схема системы
  text('Структура системы', M, y, 11, bold, NAVY); y += 20
  const nodes: [string, string, RGB][] = []
  if (gens.length) nodes.push(['Источник', `${fmt(gens.reduce((s, r) => s + r.qty, 0), 0)} ед. · ${fmt(genQx, 1)} кВт`, CYAN])
  if (fcu.length) nodes.push(['Гидравлика', designFlow ? `${fmt(designFlow, 1)} м³/ч · DN${pickDn(designFlow, 1.0)}` : 'водяной контур', NAVY2])
  if (fcu.length) nodes.push(['Фанкойлы', `${fmt(fcu.reduce((s, r) => s + r.qty, 0), 0)} ед. · ${fmt(fcuQx, 1)} кВт`, GREEN])
  if (indoor.length) nodes.push(['Внутренние блоки', `${fmt(indoor.reduce((s, r) => s + r.qty, 0), 0)} ед. · ${fmt(indoorQx, 1)} кВт`, VIOLET])
  if (!nodes.length) nodes.push(['Оборудование', `${rows.length} позиций`, CYAN])
  const gap = 26, nw = (CONTENT_W - gap * (nodes.length - 1)) / nodes.length
  nodes.forEach(([t, s, c], i) => {
    const x = M + i * (nw + gap)
    round(x, y, nw, 52, 8, SKY)
    rect(x, y + 10, 3, 32, c)
    textC(t, x + nw / 2, y + 12, 10, bold, NAVY)
    textC(s, x + nw / 2, y + 31, 7.5, regular, GREY)
    if (i < nodes.length - 1) {
      const ax = x + nw + 4, ay = y + 26
      line(ax, ay, ax + gap - 8, ay, CYAN, 1.4)
      page.drawSvgPath('M 0 0 L -6 -4 L -6 4 Z', { x: ax + gap - 8, y: PAGE_H - ay, color: CYAN })
    }
  })
  y += 72

  // Содержание
  text('Содержание', M, y, 11, bold, NAVY); y += 20
  const toc = ['Баланс мощности', 'Состав оборудования', ...(gens.length ? ['Источники холода и тепла'] : []), ...(fcu.length ? ['Фанкойлы — рабочий режим'] : []),
    ...(gens.some(r => r.p?.genSpec?.eer || r.p?.genSpec?.cop) ? ['Энергоэффективность'] : []), 'Инженерный расчёт', 'Рекомендации по монтажу', 'Почему это оборудование', 'Источники данных']
  toc.forEach((t, i) => {
    const col = i % 2, x = M + col * (CONTENT_W / 2), top = y + Math.floor(i / 2) * 18
    text(String(i + 1).padStart(2, '0'), x, top, 9, bold, CYAN)
    text(t, x + 22, top, 9, regular, INK)
  })
  y += Math.ceil(toc.length / 2) * 18 + 8
  para('Холодопроизводительность фанкойлов приведена на средней скорости вентилятора (MED) — это реальный рабочий режим, по которому корректно считать нагрузку помещений. Все технические данные взяты из официальных каталогов Midea с указанием страницы.', 8)

  // ================= 01 Баланс мощности =================
  section('Баланс мощности', 'Сопоставление мощности источников и нагрузки потребителей')
  const bars: [string, number, RGB][] = ([
    ['Источники холода', genQx, CYAN] as [string, number, RGB],
    ...(fcu.length ? [['Фанкойлы, средняя скорость', fcuQx, GREEN] as [string, number, RGB], ['Фанкойлы, максимальная скорость', fcuQxMax, hex('#9BDDBB')] as [string, number, RGB]] : []),
    ...(indoor.length ? [['Внутренние блоки', indoorQx, VIOLET] as [string, number, RGB]] : []),
    ...(genQt ? [['Источники, нагрев', genQt, AMBER] as [string, number, RGB]] : []),
  ] as [string, number, RGB][]).filter(b => b[1] > 0)
  const maxBar = Math.max(1, ...bars.map(b => b[1]))
  const labelW = 170, barW = CONTENT_W - labelW - 70
  bars.forEach(([l, v, c]) => {
    text(l, M, y + 4, 8.5, regular, INK)
    round(M + labelW, y, barW, 16, 4, MIST)
    round(M + labelW, y, Math.max(8, (v / maxBar) * barW), 16, 4, c)
    textR(`${fmt(v, 1)} кВт`, M + CONTENT_W, y + 4, 9, bold, NAVY)
    y += 26
  })
  y += 6
  const rl = wrap(reserveText + (genQx && loadQx ? '. Ориентир для систем с фанкойлами — 10–30 % с учётом неодновременности нагрузок.' : ''), regular, 8, CONTENT_W - 32)
  const rh = 30 + rl.length * 11
  ensure(rh + 10)
  round(M, y, CONTENT_W, rh, 8, SKY)
  rect(M, y, 4, rh, reserveColor)
  text(genQx && loadQx ? `Запас мощности: ${reserve >= 0 ? '+' : ''}${fmt(reserve, 1)} %` : 'Запас мощности', M + 16, y + 9, 11, bold, NAVY)
  rl.forEach((l, i) => text(l, M + 16, y + 27 + i * 11, 8, regular, GREY))
  y += rh + 16

  // ================= 02 Состав оборудования =================
  section('Состав оборудования', 'Номера позиций соответствуют коммерческому предложению')
  table(
    [{ title: '№', w: 5 }, { title: 'Модель', w: 22, align: 'l' }, { title: 'Тип', w: 30, align: 'l' }, { title: 'Кол-во', w: 8 },
      { title: 'Qx, кВт', w: 10 }, { title: 'Qt, кВт', w: 10 }, { title: 'Сумма Qx', w: 11 }],
    rows.map(r => [String(r.n), r.p?.model || r.it.model || '', r.p?.category || r.it.category || '', fmt(r.qty, 2),
      num(r.p?.coolingCapacity) ? fmt(num(r.p?.coolingCapacity)) + (r.p?.capacityNote ? '*' : '') : '—',
      num(r.p?.heatingCapacity) ? fmt(num(r.p?.heatingCapacity)) : '—', capOf(r) ? fmt(capOf(r), 1) : '—']),
    8, r => GROUP_COLOR[rows[r].group],
  )
  let lx = M
  ;(['generator', 'fcu', 'indoor'] as const).filter(g => rows.some(r => r.group === g)).forEach(g => {
    rect(lx, y + 2, 8, 8, GROUP_COLOR[g]); text(GROUP_LABEL[g], lx + 12, y + 2, 7.5, regular, GREY)
    lx += regular.widthOfTextAtSize(GROUP_LABEL[g], 7.5) + 30
  })
  if (fcu.length) text('* средняя скорость вентилятора', lx, y + 2, 7.5, regular, GREY)
  y += 22

  // ================= 03 Источники =================
  if (gens.length) {
    section('Источники холода и тепла', 'Паспортные данные по каталогу производителя')
    for (const r of gens) {
      const p = r.p, g = p?.genSpec || {}
      const q = (v?: string, unit = '') => (v ? `${v.replace('.', ',')}${unit ? ' ' + unit : ''}` : '')
      const vrf = /наруж|vrf/i.test(p?.category || '')
      const params: [string, string][] = ([
        ['Холод Qx', q(g.coolKw, 'кВт') || (num(p?.coolingCapacity) ? `${fmt(num(p?.coolingCapacity))} кВт` : '')],
        ['Нагрев Qt', q(g.heatKw, 'кВт') || (num(p?.heatingCapacity) ? `${fmt(num(p?.heatingCapacity))} кВт` : '')],
        ['Потребление охл./нагр.', g.coolPower || g.heatPower ? `${q(g.coolPower) || '—'} / ${q(g.heatPower) || '—'} кВт` : ''],
        ['EER / COP', g.eer || g.cop ? `${q(g.eer) || '—'} / ${q(g.cop) || '—'}` : ''],
        ['Электропитание', g.powerSupply || clean(p?.powerSupply)],
        ['Макс. ток', q(g.maxCurrent, 'А')],
        ['Компрессор', g.compressor || ''],
        ['Хладагент', [(g.refrigerant || clean(p?.refrigerant)).replace('А', 'A'), g.refrigerantCharge ? `${q(g.refrigerantCharge)} кг` : ''].filter(Boolean).join(' · ')],
        ...(vrf ? [['Трубы жидкость / газ', g.pipeLiquid ? `${q(g.pipeLiquid)} / ${q(g.pipeGas) || '—'} мм` : ''], ['Внутренних блоков', g.maxIndoor || '']] as [string, string][]
          : [['Расход воды', g.waterFlow ? `${q(g.waterFlow, 'м³/ч')}${g.waterDp ? ' · ' + q(g.waterDp, 'кПа') : ''}` : ''], ['Присоединение', g.pipe || '']] as [string, string][]),
        ['Расход воздуха', g.airflow ? `${g.airflow} м³/ч` : ''],
        ['Шум', q(g.noise, 'дБ(А)') || (clean(p?.noiseLevel) ? `${p?.noiseLevel} дБ(А)` : '')],
        ['Наружный воздух', g.tempCool || g.tempHeat ? `охл. ${g.tempCool || '—'} · нагр. ${g.tempHeat || '—'} °C` : ''],
        ['Габариты Ш×В×Г', g.dims ? `${g.dims} мм` : (clean(p?.dimensions) ? `${p?.dimensions} мм` : '')],
        ['Масса нетто', q(g.weight, 'кг') || (num(p?.weight) ? `${fmt(num(p?.weight), 0)} кг` : '')],
      ] as [string, string][]).filter(([k, v]) => v || /Холод|Нагрев Qt|Электро/.test(k))
        .filter(([k]) => !(k === 'Холод Qx' && /ГВС|бассейн/i.test(p?.category || '') && !g.coolKw))
      const cols = 3, cw = (CONTENT_W - 24) / cols, rh = 30
      const h = 44 + Math.ceil(params.length / cols) * rh + 8
      ensure(h + 10)
      round(M, y, CONTENT_W, h, 8, WHITE, LINE)
      rect(M, y + 12, 4, 22, CYAN)
      text(p?.model || r.it.model || '', M + 14, y + 12, 12, bold, NAVY)
      const cat = wrap(p?.category || '', regular, 7.5, CONTENT_W - 150)[0] || ''
      text(cat, M + 14, y + 28, 7.5, regular, GREY)
      chip(`${fmt(r.qty, 0)} шт.`, M + CONTENT_W - 70, y + 12, NAVY)
      params.forEach(([k, v], i) => {
        const x = M + 12 + (i % cols) * cw, top = y + 44 + Math.floor(i / cols) * rh
        text(k, x, top, 7, regular, GREY)
        text(wrap(v || 'по запросу', bold, 8.5, cw - 10)[0], x, top + 11, 8.5, bold, v ? INK : GREY)
      })
      y += h + 12
    }
  }

  // ================= 04 Фанкойлы =================
  if (fcu.length) {
    section('Фанкойлы — рабочий режим', 'Параметры на средней скорости вентилятора (MED)')
    table(
      [{ title: '№', w: 4 }, { title: 'Модель', w: 19, align: 'l' }, { title: 'Кол.', w: 6 }, { title: 'Qx, кВт', w: 8 },
        { title: 'Qt, кВт', w: 8 }, { title: 'Вода, м³/ч', w: 9 }, { title: 'ΔP, кПа', w: 8 }, { title: 'Воздух, м³/ч', w: 9 },
        { title: 'Шум, дБ(А)', w: 8 }, { title: 'Мощн., Вт', w: 8 }, { title: 'Габариты, мм', w: 13 }],
      fcu.map(r => {
        const s = r.p?.fcuSpec || {}
        return [String(r.n), r.p?.model || r.it.model || '', fmt(r.qty), fmt(num(r.p?.coolingCapacity)), fmt(num(r.p?.heatingCapacity)),
          fmt(num(s.waterFlow)), fmt(num(s.waterDp), 1), fmt(num(s.airflow), 0), fmt(num(s.noise), 0), fmt(num(s.powerW), 0), s.dims || '—']
      }),
      7.5, () => GREEN,
    )
    const missing = fcu.filter(r => !r.p?.capacityNote).map(r => r.p?.model || r.it.model)
    if (missing.length) para(`Нет в каталоге Midea FCU 2025–2026, параметры уточняются у производителя: ${missing.join(', ')}.`, 7.5)
    para('Условия каталога: охлаждение — вода 7/12 °C, воздух 27 °C сух. / 19 °C влажн.; нагрев — вода 45/40 °C, воздух 20 °C.', 7.5)
  }

  // ================= 05 Энергоэффективность =================
  const eff = gens.filter(r => num(r.p?.genSpec?.eer) || num(r.p?.genSpec?.cop))
  if (eff.length) {
    section('Энергоэффективность', 'EER — охлаждение, COP — нагрев: кВт тепла/холода на 1 кВт электроэнергии')
    const scale = Math.max(5, ...eff.flatMap(r => [num(r.p?.genSpec?.eer), num(r.p?.genSpec?.cop)]))
    const lw = 150, bw = CONTENT_W - lw - 40
    for (const r of eff) {
      ensure(40)
      text(r.p?.model || '', M, y + 4, 8.5, bold, INK)
      ;([['EER', num(r.p?.genSpec?.eer), CYAN], ['COP', num(r.p?.genSpec?.cop), AMBER]] as [string, number, RGB][]).forEach(([k, v], j) => {
        const top = y + j * 14
        text(k, M + lw - 26, top + 1, 7, regular, GREY)
        round(M + lw, top, bw, 10, 3, MIST)
        if (v) round(M + lw, top, (v / scale) * bw, 10, 3, k === 'EER' ? CYAN : AMBER)
        text(v ? fmt(v, 2) : '—', M + lw + bw + 8, top + 1, 8, bold, NAVY)
      })
      y += 36
    }
    para('Чем выше коэффициент, тем меньше электроэнергии потребляет система на единицу выработанного холода или тепла.', 8)
  }

  // ================= 06 Инженерный расчёт =================
  section('Инженерный расчёт', `Предварительная оценка водяного контура и электрической нагрузки, Δt = ${dT} °C`)
  const calc: [string, string, string][] = [
    ['Расход воды', designFlow ? `${fmt(designFlow, 1)} м³/ч` : '—', fcuFlow ? 'сумма по каталогу фанкойлов' : 'G = Q / (1,163 · Δt)'],
    ['Магистраль', designFlow ? `DN${pickDn(designFlow, 1.0)} – DN${pickDn(designFlow, 1.5)}` : '—', 'при скорости воды 1,0–1,5 м/с'],
    ['Объём воды в системе', genQx ? `≥ ${fmt(genQx * 3, 0)} л` : '—', 'ориентир 3–5 л на 1 кВт источника'],
    ['Сопротивление фанкойла', maxDp ? `${fmt(maxDp, 1)} кПа` : '—', 'наибольшее — учесть при подборе насоса'],
    ['Электрика источников', genPowerKw ? `${fmt(genPowerKw, 1)} кВт` : '—', 'номинальное потребление в охлаждении'],
    ['Электрика фанкойлов', fcuPowerKw ? `${fmt(fcuPowerKw, 2)} кВт` : '—', 'на средней скорости'],
  ]
  const cw3 = (CONTENT_W - 20) / 3
  calc.forEach(([k, v, n], i) => {
    if (i % 3 === 0) ensure(78)
    const x = M + (i % 3) * (cw3 + 10), top = y + Math.floor((i % 3) / 3) * 0
    round(x, top, cw3, 66, 8, SKY)
    text(k, x + 12, top + 10, 7.5, regular, GREY)
    text(v, x + 12, top + 24, 15, bold, NAVY)
    wrap(n, regular, 6.8, cw3 - 24).slice(0, 2).forEach((l, j) => text(l, x + 12, top + 46 + j * 9, 6.8, regular, GREY))
    if (i % 3 === 2 || i === calc.length - 1) y += 76
  })
  para('Расчёт предварительный: диаметры, насосная группа и бак-аккумулятор окончательно подбираются в проекте по гидравлическому расчёту объекта.', 7.5)

  // ================= 07 Монтаж =================
  section('Рекомендации по монтажу', 'Что заложить в проект и смету, чтобы система работала на паспортных параметрах')
  const groupsPresent = new Set<Group>(rows.map(r => r.group === 'other' ? 'generator' : r.group))
  if (rows.some(r => /наруж|vrf/i.test(r.p?.category || ''))) groupsPresent.add('indoor')
  for (const blk of INSTALL.filter(b => groupsPresent.has(b.group))) {
    ensure(40)
    text(blk.title, M, y, 10, bold, NAVY); y += 16
    for (const pt of blk.points) {
      const ls = wrap(pt, regular, 8.3, CONTENT_W - 22)
      ensure(ls.length * 12 + 4)
      round(M + 2, y + 1, 9, 9, 2, GREEN)
      page.drawSvgPath('M 2 4.5 L 4 6.5 L 7.5 2.5', { x: M + 2, y: PAGE_H - y - 1, borderColor: WHITE, borderWidth: 1.2 })
      ls.forEach((l, j) => text(l, M + 18, y + j * 12, 8.3, regular, INK))
      y += ls.length * 12 + 4
    }
    y += 6
  }

  // ================= 08 Почему это оборудование =================
  const cats = rows.map(r => `${r.p?.category || r.it.category || ''}`).join(' ')
  const adv = ADVANTAGES.filter(a => a.test.test(cats))
  if (adv.length) {
    section('Почему это оборудование', 'Ключевые свойства выбранных серий')
    for (const a of adv) {
      ensure(40); text(a.title, M, y, 10, bold, NAVY); y += 16
      const colW = (CONTENT_W - 10) / 2
      for (let i = 0; i < a.points.length; i += 2) {
        const blocks = a.points.slice(i, i + 2).map(([t, d]) => ({ t, d: wrap(d, regular, 7.8, colW - 24) }))
        const h = Math.max(...blocks.map(b => b.d.length)) * 10.5 + 28
        ensure(h + 6)
        blocks.forEach((b, j) => {
          const x = M + j * (colW + 10)
          round(x, y, colW, h, 8, WHITE, LINE)
          round(x + 10, y + 10, 6, 6, 3, CYAN)
          text(b.t, x + 22, y + 8, 9, bold, NAVY)
          b.d.forEach((l, k) => text(l, x + 12, y + 24 + k * 10.5, 7.8, regular, GREY))
        })
        y += h + 8
      }
      y += 4
    }
  }

  // ================= 09 Источники =================
  section('Источники данных')
  const srcRows: string[][] = []
  const seen = new Set<string>()
  rows.forEach(r => {
    const key = r.p?.genSpecSource?.catalogKey || r.p?.catalogKey || (r.p && getCatalogMatch(r.p.id)?.catalogKey) || (r.p ? inferCatalogKey(r.p) : null)
    const pg = r.p?.genSpecSource?.page || r.p?.catalogPage || (r.p && getCatalogMatch(r.p.id)?.page)
    const s = getCatalogSource(key || undefined)
    const id = `${r.p?.model}|${key}|${pg}`
    if (seen.has(id)) return; seen.add(id)
    srcRows.push([r.p?.model || r.it.model || '', s?.title || '—', pg ? String(pg) : '—'])
  })
  table([{ title: 'Модель', w: 35, align: 'l' }, { title: 'Документ', w: 50, align: 'l' }, { title: 'Стр.', w: 15 }], srcRows, 7.5)
  para('Технические характеристики могут быть изменены производителем без предварительного уведомления. Документ подготовлен UMBT для оценки проектного решения и не заменяет рабочую документацию.', 7.5)

  // Подвал
  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: M, y: 38 }, end: { x: PAGE_W - M, y: 38 }, thickness: 0.5, color: LINE })
    pg.drawText('UMBT · Uzbekistan Midea Building Technologies · umbt-midea.uz', { x: M, y: 24, size: 7, font: regular, color: GREY })
    const s = `${i + 1} / ${pages.length}`
    pg.drawText(s, { x: PAGE_W - M - bold.widthOfTextAtSize(s, 8), y: 24, size: 8, font: bold, color: NAVY })
  })
  return Buffer.from(await doc.save())
}
