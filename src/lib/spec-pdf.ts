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
export interface BuildSpecOptions { cpNumber: string; cpDate: string; items: SpecItem[]; deltaT?: number }

const products = productsData as unknown as Product[]
const byId = new Map(products.map(p => [p.id, p]))
const byModel = new Map(products.map(p => [String(p.model || '').trim().toUpperCase(), p]))

const PAGE_W = 595.28, PAGE_H = 841.89
const M = 42.5, CONTENT_W = PAGE_W - 2 * M
const TOP = 92, BOTTOM = PAGE_H - 60
const BLUE = rgb(69 / 255, 176 / 255, 225 / 255)
const DEEP = rgb(38 / 255, 155 / 255, 217 / 255)
const PALE = rgb(219 / 255, 239 / 255, 249 / 255)
const ZEBRA = rgb(242 / 255, 249 / 255, 253 / 255)
const INK = rgb(0.13, 0.13, 0.13)
const GREY = rgb(78 / 255, 78 / 255, 77 / 255)
const WHITE = rgb(1, 1, 1)

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

let fontCache: { regular: Uint8Array; bold: Uint8Array; bg: Uint8Array } | null = null
function fontFiles() {
  if (fontCache) return fontCache
  const t = (f: string) => fs.readFileSync(path.join(process.cwd(), 'templates', f))
  fontCache = { regular: t('kp-fonts/CenturyGothic.ttf'), bold: t('kp-fonts/CenturyGothic-Bold.ttf'), bg: t('kp-page-bg.jpg') }
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

export async function buildSpecPdf(opts: BuildSpecOptions): Promise<Buffer> {
  const dT = opts.deltaT || 5
  const rows = opts.items
    .filter(it => !it.isAdditional)
    .map((it, i) => {
      const p = (it.productId && byId.get(it.productId)) || byModel.get(String(it.model || '').trim().toUpperCase())
      return { n: i + 1, it, p, qty: qtyOf(it.quantity), group: groupOf(p, it) }
    })

  const f = fontFiles()
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  doc.setTitle(`Спецификация к КП ${opts.cpNumber}`)
  doc.setProducer('UMBT KP Maker')
  const [regular, bold, bg] = await Promise.all([
    doc.embedFont(f.regular, { subset: true }), doc.embedFont(f.bold, { subset: true }), doc.embedJpg(f.bg),
  ])

  const pages: PDFPage[] = []
  let page!: PDFPage
  let y = TOP
  const text = (s: string, x: number, top: number, size: number, font = regular, color: RGB = INK) =>
    page.drawText(s, { x, y: PAGE_H - top - size * 0.8, size, font, color })
  const rect = (x: number, top: number, w: number, h: number, color: RGB) =>
    page.drawRectangle({ x, y: PAGE_H - top - h, width: w, height: h, color })
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]); pages.push(page)
    page.drawImage(bg, { x: 0, y: 0, width: PAGE_W, height: PAGE_H, opacity: 0.35 })
    const h = `Приложение № 1 к коммерческому предложению № ${opts.cpNumber} от ${opts.cpDate}`
    text(h, PAGE_W - M - regular.widthOfTextAtSize(h, 8), 40, 8, regular, GREY)
    text('UMBT', M, 36, 16, bold, DEEP)
    text('UZBEKISTAN MIDEA BUILDING TECHNOLOGIES', M, 55, 6.5, regular, GREY)
    page.drawLine({ start: { x: M, y: PAGE_H - 70 }, end: { x: PAGE_W - M, y: PAGE_H - 70 }, thickness: 0.8, color: BLUE })
    y = TOP
  }
  const ensure = (h: number) => { if (y + h > BOTTOM) newPage() }
  const heading = (s: string) => {
    ensure(110); y += 6
    rect(M, y, 4, 16, BLUE)
    text(s, M + 10, y + 2, 13, bold, DEEP); y += 26
  }
  const para = (s: string, size = 9, color: RGB = GREY) => {
    for (const ln of wrap(s, regular, size, CONTENT_W)) { ensure(size + 4); text(ln, M, y, size, regular, color); y += size + 4 }
    y += 4
  }

  /** Таблица с переносом по словам, повтором шапки и зеброй. */
  const table = (cols: { title: string; w: number; align?: 'l' | 'c' | 'r' }[], data: string[][], size = 8.5) => {
    const total = cols.reduce((s, c) => s + c.w, 0)
    const ws = cols.map(c => (c.w / total) * CONTENT_W)
    const pad = 4, lh = size + 3
    const drawHead = () => {
      const lines = cols.map((c, i) => wrap(c.title, bold, size, ws[i] - 2 * pad))
      const h = Math.max(...lines.map(l => l.length)) * lh + 2 * pad
      let x = M
      rect(M, y, CONTENT_W, h, BLUE)
      lines.forEach((ls, i) => {
        ls.forEach((ln, j) => {
          const w = bold.widthOfTextAtSize(ln, size)
          text(ln, x + (ws[i] - w) / 2, y + pad + j * lh, size, bold, WHITE)
        })
        x += ws[i]
      })
      y += h
    }
    ensure(60); drawHead()
    data.forEach((row, r) => {
      const lines = row.map((v, i) => wrap(v, regular, size, ws[i] - 2 * pad))
      const h = Math.max(...lines.map(l => l.length)) * lh + 2 * pad
      if (y + h > BOTTOM) { newPage(); drawHead() }
      rect(M, y, CONTENT_W, h, r % 2 ? ZEBRA : PALE)
      let x = M
      lines.forEach((ls, i) => {
        const al = cols[i].align || 'c'
        ls.forEach((ln, j) => {
          const w = regular.widthOfTextAtSize(ln, size)
          const tx = al === 'l' ? x + pad : al === 'r' ? x + ws[i] - pad - w : x + (ws[i] - w) / 2
          text(ln, tx, y + pad + j * lh, size, regular, INK)
        })
        x += ws[i]
      })
      y += h
    })
    y += 10
  }

  // ---------- Расчёты ----------
  const fcu = rows.filter(r => r.group === 'fcu')
  const gens = rows.filter(r => r.group === 'generator')
  const fcuQx = fcu.reduce((s, r) => s + num(r.p?.coolingCapacity) * r.qty, 0)
  const fcuQt = fcu.reduce((s, r) => s + num(r.p?.heatingCapacity) * r.qty, 0)
  const genQx = gens.reduce((s, r) => s + num(r.p?.coolingCapacity) * r.qty, 0)
  const genQt = gens.reduce((s, r) => s + num(r.p?.heatingCapacity) * r.qty, 0)
  const flowOf = (r: typeof fcu[number]) => num(r.p?.fcuSpec?.waterFlow) || num(r.p?.coolingCapacity) / (1.163 * dT)
  const fcuFlow = fcu.reduce((s, r) => s + flowOf(r) * r.qty, 0)
  const genFlow = gens.reduce((s, r) => s + (num(r.p?.genSpec?.waterFlow) && num(r.p?.coolingCapacity) ? num(r.p?.genSpec?.waterFlow) : num(r.p?.coolingCapacity) / (1.163 * dT)) * r.qty, 0)
  const fcuPowerKw = fcu.reduce((s, r) => s + num(r.p?.fcuSpec?.powerW) * r.qty, 0) / 1000
  const genPowerKw = gens.reduce((s, r) => s + (num(r.p?.genSpec?.coolPower) || num(r.p?.powerConsumption)) * r.qty, 0)
  const maxDp = fcu.reduce((m, r) => Math.max(m, num(r.p?.fcuSpec?.waterDp)), 0)
  const designFlow = fcuFlow || genFlow
  const reserve = genQx && fcuQx ? (genQx / fcuQx - 1) * 100 : 0

  // ---------- Документ ----------
  newPage()
  text('Спецификация оборудования', M, y, 20, bold, DEEP); y += 28
  para(`Оборудование Midea по коммерческому предложению № ${opts.cpNumber} от ${opts.cpDate}. ` +
    'Qx — холодопроизводительность, Qt — теплопроизводительность. Для фанкойлов значения приведены на средней скорости вентилятора (MED) — ' +
    'это рабочий режим, по которому корректно считать нагрузку помещений.')

  // Карточки сводки
  const cards: [string, string][] = [
    ['Фанкойлы, Qx (MED)', fcuQx ? `${fmt(fcuQx, 1)} кВт` : '—'],
    ['Источники холода, Qx', genQx ? `${fmt(genQx, 1)} кВт` : '—'],
    ['Запас по холоду', genQx && fcuQx ? `${reserve >= 0 ? '+' : ''}${fmt(reserve, 0)} %` : '—'],
    ['Расход воды, расчётный', designFlow ? `${fmt(designFlow, 1)} м³/ч` : '—'],
  ]
  const cw = (CONTENT_W - 3 * 8) / 4
  cards.forEach(([l, v], i) => {
    const x = M + i * (cw + 8)
    rect(x, y, cw, 52, PALE); rect(x, y, cw, 3, BLUE)
    wrap(l, regular, 7.5, cw - 12).forEach((ln, j) => text(ln, x + 6, y + 9 + j * 10, 7.5, regular, GREY))
    text(v, x + 6, y + 32, 13, bold, DEEP)
  })
  y += 66

  heading('1. Перечень оборудования')
  table(
    [{ title: '№', w: 4 }, { title: 'Наименование', w: 30, align: 'l' }, { title: 'Модель', w: 22, align: 'l' },
      { title: 'Кол-во, шт', w: 9 }, { title: 'Qx, кВт', w: 9 }, { title: 'Qt, кВт', w: 9 }, { title: 'Источник', w: 17 }],
    rows.map(r => {
      const key = r.p?.catalogKey || (r.p && getCatalogMatch(r.p.id)?.catalogKey) || (r.p ? inferCatalogKey(r.p) : null)
      const page = r.p?.catalogPage || (r.p && getCatalogMatch(r.p.id)?.page)
      const src = key ? `${getCatalogSource(key)?.title.replace('Каталог ', '') || key}${page ? `, стр. ${page}` : ''}` : '—'
      const med = r.p?.capacityNote ? ' (MED)' : ''
      return [String(r.n), r.p?.category || r.it.category || '', r.p?.model || r.it.model || '', fmt(r.qty, 2),
        num(r.p?.coolingCapacity) ? fmt(num(r.p?.coolingCapacity)) + med : '—', num(r.p?.heatingCapacity) ? fmt(num(r.p?.heatingCapacity)) : '—', src]
    }),
  )

  if (gens.length) {
    heading('2. Источники холода и тепла')
    for (const r of gens) {
      const p = r.p
      ensure(90)
      text(`${p?.category || r.it.category || ''} ${p?.model || r.it.model || ''} — ${fmt(r.qty)} шт.`, M, y, 10, bold, INK); y += 16
      const g = p?.genSpec || {}
      const q = (v?: string, unit = '') => (v ? `${v.replace('.', ',')}${unit ? ' ' + unit : ''}` : '')
      const kv: [string, string][] = ([
        ['Холодопроизводительность Qx', q(g.coolKw, 'кВт') || (num(p?.coolingCapacity) ? `${fmt(num(p?.coolingCapacity))} кВт` : '')],
        ['Теплопроизводительность Qt', q(g.heatKw, 'кВт') || (num(p?.heatingCapacity) ? `${fmt(num(p?.heatingCapacity))} кВт` : '')],
        ['Потребляемая мощность (охл. / нагр.)', [q(g.coolPower), q(g.heatPower)].some(Boolean) ? `${q(g.coolPower) || '—'} / ${q(g.heatPower) || '—'} кВт` : ''],
        ['EER / COP', g.eer || g.cop ? `${q(g.eer) || '—'} / ${q(g.cop) || '—'}` : ''],
        ['Электропитание', g.powerSupply || clean(p?.powerSupply)],
        ['Максимальный ток', q(g.maxCurrent, 'А')],
        ['Компрессор', g.compressor || ''],
        ['Хладагент', (g.refrigerant || clean(p?.refrigerant)).replace('А', 'A')],
        ['Расход воды / потери давления', g.waterFlow ? `${q(g.waterFlow, 'м³/ч')}${g.waterDp ? ' / ' + q(g.waterDp, 'кПа') : ''}` : ''],
        ['Присоединение воды', g.pipe || ''],
        ['Расход воздуха', g.airflow ? `${g.airflow} м³/ч` : ''],
        ['Уровень звукового давления', q(g.noise, 'дБ(А)') || (clean(p?.noiseLevel) ? `${p?.noiseLevel} дБ(А)` : '')],
        ['Наружный воздух: охлаждение / нагрев', g.tempCool || g.tempHeat ? `${g.tempCool || '—'} / ${g.tempHeat || '—'} °C` : ''],
        ['Габариты (Ш×В×Г)', g.dims ? `${g.dims} мм` : (clean(p?.dimensions) ? `${p?.dimensions} мм` : '')],
        ['Масса нетто', q(g.weight, 'кг') || (num(p?.weight) ? `${fmt(num(p?.weight), 0)} кг` : '')],
      ] as [string, string][]).map(([k, v]) => [k, v || 'по запросу'] as [string, string])
      table([{ title: 'Параметр', w: 45, align: 'l' }, { title: 'Значение', w: 55, align: 'l' }], kv)
    }
  }

  if (fcu.length) {
    heading(`${gens.length ? 3 : 2}. Фанкойлы — характеристики на средней скорости (MED)`)
    table(
      [{ title: '№', w: 4 }, { title: 'Модель', w: 20, align: 'l' }, { title: 'Кол-во', w: 7 }, { title: 'Qx, кВт', w: 8 },
        { title: 'Qt, кВт', w: 8 }, { title: 'Расход воды, м³/ч', w: 10 }, { title: 'ΔP воды, кПа', w: 9 },
        { title: 'Воздух, м³/ч', w: 9 }, { title: 'Шум, дБ(А)', w: 8 }, { title: 'Мощн., Вт', w: 8 }, { title: 'Габариты, мм', w: 14 }],
      fcu.map(r => {
        const s = r.p?.fcuSpec || {}
        return [String(r.n), r.p?.model || r.it.model || '', fmt(r.qty), fmt(num(r.p?.coolingCapacity)), fmt(num(r.p?.heatingCapacity)),
          fmt(num(s.waterFlow)), fmt(num(s.waterDp), 1), fmt(num(s.airflow), 0), fmt(num(s.noise), 0), fmt(num(s.powerW), 0), s.dims || '—']
      }),
      7.5,
    )
    const missing = fcu.filter(r => !r.p?.capacityNote).map(r => r.p?.model || r.it.model)
    if (missing.length) para(`Нет в каталоге Midea FCU 2025–2026, параметры — по запросу у производителя: ${missing.join(', ')}.`, 8)
    para('Условия каталога: охлаждение — вода 7/12 °C, воздух 27 °C сух. / 19 °C влажн.; нагрев — вода 45/40 °C, воздух 20 °C.', 8)
  }

  heading('Инженерный расчёт водяного контура')
  const calc: [string, string][] = [
    ['Суммарная Qx фанкойлов (MED) / Qt', fcuQx ? `${fmt(fcuQx, 1)} кВт / ${fcuQt ? fmt(fcuQt, 1) + ' кВт' : '—'}` : '—'],
    ['Суммарная Qx / Qt источников', genQx ? `${fmt(genQx, 1)} кВт / ${genQt ? fmt(genQt, 1) + ' кВт' : '—'}` : '—'],
    ['Запас мощности источников над фанкойлами', genQx && fcuQx ? `${fmt(reserve, 0)} % (рекомендуется 10–20 % с учётом неодновременности)` : '—'],
    [`Расход воды по фанкойлам (каталог, Δt ${dT} °C)`, fcuFlow ? `${fmt(fcuFlow, 2)} м³/ч` : '—'],
    [`Расход воды через источники, G = Q / (1,163 · Δt)`, genFlow ? `${fmt(genFlow, 2)} м³/ч` : '—'],
    ['Магистраль к фанкойлам: DN при 1,0 / 1,5 м/с', designFlow ? `DN${pickDn(designFlow, 1.0)} / DN${pickDn(designFlow, 1.5)}` : '—'],
    ['Мин. объём воды в системе (≈ 3–5 л/кВт источника)', genQx ? `${fmt(genQx * 3, 0)}–${fmt(genQx * 5, 0)} л` : '—'],
    ['Наибольшее сопротивление фанкойла по воде', maxDp ? `${fmt(maxDp, 1)} кПа (учитывать при подборе насоса)` : '—'],
    ['Электрическая нагрузка: фанкойлы / источники', `${fcuPowerKw ? fmt(fcuPowerKw, 2) + ' кВт' : '—'} / ${genPowerKw ? fmt(genPowerKw, 1) + ' кВт' : 'по данным производителя'}`],
  ]
  table([{ title: 'Показатель', w: 55, align: 'l' }, { title: 'Значение', w: 45, align: 'l' }], calc)
  para('Расчёт предварительный, для оценки комплектации. Диаметры трубопроводов, насос и бак-аккумулятор окончательно подбираются в проекте по гидравлическому расчёту объекта.', 8)

  const cats = rows.map(r => `${r.p?.category || r.it.category || ''}`).join(' ')
  const adv = ADVANTAGES.filter(a => a.test.test(cats))
  if (adv.length) {
    heading('Преимущества оборудования')
    for (const a of adv) {
      ensure(40); text(a.title, M, y, 10.5, bold, INK); y += 16
      const colW = (CONTENT_W - 12) / 2
      for (let i = 0; i < a.points.length; i += 2) {
        const pair = a.points.slice(i, i + 2)
        const blocks = pair.map(([t, d]) => ({ t, d: wrap(d, regular, 8, colW - 14) }))
        const h = Math.max(...blocks.map(b => b.d.length)) * 11 + 22
        ensure(h)
        blocks.forEach((b, j) => {
          const x = M + j * (colW + 12)
          rect(x, y, colW, h - 6, PALE); rect(x, y, 3, h - 6, BLUE)
          text(b.t, x + 10, y + 6, 9, bold, DEEP)
          b.d.forEach((ln, k) => text(ln, x + 10, y + 20 + k * 11, 8, regular, GREY))
        })
        y += h
      }
      y += 4
    }
  }

  heading('Источники данных')
  const srcs = new Set<string>()
  rows.forEach(r => {
    const key = r.p?.catalogKey || (r.p && getCatalogMatch(r.p.id)?.catalogKey) || (r.p ? inferCatalogKey(r.p) : null)
    const s = getCatalogSource(key || undefined)
    if (s) srcs.add(s.title)
  })
  para([...srcs].map(s => `• ${s}`).join('\n') || '—', 8.5)
  para('Технические характеристики могут быть изменены производителем без предварительного уведомления. Номера позиций соответствуют порядку позиций коммерческого предложения.', 8)

  pages.forEach((pg, i) => {
    const s = `ООО «UMBT» · Спецификация оборудования Midea · стр. ${i + 1} из ${pages.length}`
    pg.drawText(s, { x: M, y: 30, size: 7.5, font: regular, color: GREY })
  })
  return Buffer.from(await doc.save())
}
