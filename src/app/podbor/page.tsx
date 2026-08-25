'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { formatNum } from '@/lib/format'
import { stockModelKey } from '@/lib/stock-match'
import { evalAreaFormula } from '@/lib/podbor/formula'
import {
  PODBOR_CATALOG, FAMILY_LABEL, FORM_FACTOR_LABEL, SERIES_LABEL, PIPE_LABEL,
  familyProducts, formFactorOptions, seriesOptions, pipeTypeOptions,
  candidatesFor, matchByPower, matchOutdoorUnit, outdoorCandidates, productLabel,
  Family, FormFactor, Series, PodborProduct,
} from '@/lib/podbor/catalog'
import './podbor.css'

const AREA_COEFFICIENT = 0.135

// formatNum() округляет до целого (задумано для денег — см. src/lib/format.ts).
// Площадь и кВт теряют на этом значащую цифру (5,4 → «5»), поэтому здесь
// отдельный форматтер с одним знаком после запятой.
const DECIMAL_FORMAT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: 0 })
function formatDecimal(value: number | null | undefined): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!isFinite(n)) return '0'
  return DECIMAL_FORMAT.format(n)
}

interface Room {
  id: string
  name: string
  areaInput: string
  manualKw: string
  qty: string
  family: Family
  formFactor: FormFactor | null
  seriesOrPipe: string | null
  manualModelId: string | null
}

let roomSeq = 0
function newRoom(name: string): Room {
  roomSeq += 1
  const family: Family = 'vrf'
  const formFactor = formFactorOptions(family)[0] || null
  const seriesOrPipe = formFactor ? (seriesOptions(family, formFactor)[0] || null) : null
  return {
    id: `r${Date.now()}_${roomSeq}`,
    name,
    areaInput: '',
    manualKw: '',
    qty: '1',
    family,
    formFactor,
    seriesOrPipe,
    manualModelId: null,
  }
}

function computeRoom(room: Room, stock: Record<string, number> | null) {
  const area = evalAreaFormula(room.areaInput)
  const formulaKw = area != null ? Math.round(area * AREA_COEFFICIENT * 10) / 10 : 0
  const manualKwNum = room.manualKw.trim() ? parseFloat(room.manualKw.replace(',', '.')) : null
  const manualKwValid = manualKwNum != null && isFinite(manualKwNum) && manualKwNum > 0
  const factKw = manualKwValid ? (manualKwNum as number) : formulaKw
  const qty = Math.max(1, parseInt(room.qty, 10) || 1)

  const candidates = candidatesFor(room.family, room.formFactor, room.seriesOrPipe as any)
  const auto = matchByPower(candidates, factKw)
  const manual = room.manualModelId ? PODBOR_CATALOG.find(p => p.id === room.manualModelId) || null : null
  const matched: PodborProduct | null = manual || auto.product
  const isManual = !!manual
  const sum = matched ? matched.price * qty : 0
  const stockQty = matched && stock ? stock[stockModelKey(matched.model)] : undefined

  return { area, formulaKw, manualKwValid, factKw, qty, candidates, auto, matched, isManual, sum, stockQty }
}

const ROOMS_STORAGE_KEY = 'umbt_podbor_rooms'
const OUTDOOR_STORAGE_KEY = 'umbt_podbor_outdoor'

export default function PodborPage() {
  const router = useRouter()
  const [rooms, setRooms] = useState<Room[]>(() => [newRoom('Комната 1')])
  const [stock, setStock] = useState<Record<string, number> | null>(null)
  const [transferring, setTransferring] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  // Ручной выбор наружного блока по серии (v8 / atom_b) — перекрывает
  // авто-подбор по сумме кВт внутренних блоков этой серии. null/отсутствие
  // ключа = используется авто-подбор (matchOutdoorUnit).
  const [outdoorPicks, setOutdoorPicks] = useState<Record<string, string | null>>({})

  useEffect(() => {
    fetch('/api/stock')
      .then(r => r.json())
      .then(d => { if (d.success) setStock(d.byArticle) })
      .catch(() => {})
  }, [])

  // Черновик комнат раньше жил только в памяти React — уходишь со страницы
  // (назад в каталог, обновление, переход по ссылке) и весь ввод пропадал.
  // Восстанавливаем при заходе и сохраняем при каждом изменении — тот же
  // паттерн, что и автосохранение основного КП в page.tsx.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ROOMS_STORAGE_KEY)
      if (saved) {
        const parsed: Room[] = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) setRooms(parsed)
      }
      const savedOutdoor = localStorage.getItem(OUTDOOR_STORAGE_KEY)
      if (savedOutdoor) {
        const parsed = JSON.parse(savedOutdoor)
        if (parsed && typeof parsed === 'object') setOutdoorPicks(parsed)
      }
    } catch { /* повреждённый черновик — остаёмся с пустой комнатой по умолчанию */ }
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (!isMounted) return
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(rooms))
        localStorage.setItem(OUTDOOR_STORAGE_KEY, JSON.stringify(outdoorPicks))
      } catch { /* квота/приватный режим — не критично */ }
    }, 500)
    return () => clearTimeout(timer)
  }, [rooms, outdoorPicks, isMounted])

  const updateRoom = useCallback((id: string, patch: Partial<Room>) => {
    setRooms(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  const removeRoom = useCallback((id: string) => {
    setRooms(prev => prev.filter(r => r.id !== id))
  }, [])

  const addRoom = useCallback(() => {
    setRooms(prev => [...prev, newRoom(`Комната ${prev.length + 1}`)])
  }, [])

  const clearRooms = useCallback(() => {
    if (!window.confirm('Очистить весь подбор? Все введённые комнаты будут удалены.')) return
    setRooms([newRoom('Комната 1')])
    setOutdoorPicks({})
    try {
      localStorage.removeItem(ROOMS_STORAGE_KEY)
      localStorage.removeItem(OUTDOOR_STORAGE_KEY)
    } catch { /* приватный режим — не критично */ }
  }, [])

  const setFamily = useCallback((id: string, family: Family) => {
    const formFactor = formFactorOptions(family)[0] || null
    const seriesOrPipe = formFactor
      ? (family === 'vrf' ? seriesOptions(family, formFactor)[0] : family === 'fancoil' ? pipeTypeOptions(family, formFactor)[0] : null) || null
      : null
    updateRoom(id, { family, formFactor, seriesOrPipe, manualModelId: null })
  }, [updateRoom])

  const setFormFactor = useCallback((id: string, room: Room, formFactor: FormFactor) => {
    const seriesOrPipe = room.family === 'vrf'
      ? (seriesOptions(room.family, formFactor)[0] || null)
      : room.family === 'fancoil'
        ? (pipeTypeOptions(room.family, formFactor)[0] || null)
        : null
    updateRoom(id, { formFactor, seriesOrPipe, manualModelId: null })
  }, [updateRoom])

  const computed = useMemo(() => rooms.map(r => ({ room: r, c: computeRoom(r, stock) })), [rooms, stock])

  const totals = useMemo(() => {
    let area = 0, kw = 0, qty = 0, sum = 0, rooms_ = 0
    for (const { room, c } of computed) {
      rooms_ += 1
      area += c.area || 0
      // factKw — требуемая мощность ОДНОЙ единицы в комнате (см. "запас X кВт
      // к требуемым Y" у результата подбора), а qty — сколько таких единиц в
      // комнате стоит. Без умножения на qty «Суммарная мощность» занижала
      // общий итог на каждой комнате, где выбрано больше одной единицы.
      kw += (c.factKw || 0) * c.qty
      qty += c.qty
      sum += c.sum
    }
    const fancoil = computed.filter(x => x.room.family === 'fancoil')
    const units = computed.filter(x => x.room.family !== 'fancoil')
    const group = (list: typeof computed) => ({
      qty: list.reduce((s, x) => s + x.c.qty, 0),
      sum: list.reduce((s, x) => s + x.c.sum, 0),
    })
    return { area, kw, qty, sum, rooms: rooms_, fancoil: group(fancoil), units: group(units) }
  }, [computed])

  // Наружные блоки VRF не выбираются на комнату — один агрегат обслуживает
  // все внутренние блоки одной серии (v8 / atom_b) проекта. Группируем кВт
  // внутренних блоков family='vrf' по серии и подбираем наружный блок под
  // сумму (matchOutdoorUnit, коэффициент комбинации 90–115%).
  const outdoorGroups = useMemo(() => {
    const indoorKwBySeries = new Map<Series, number>()
    for (const { room, c } of computed) {
      if (room.family !== 'vrf' || !room.seriesOrPipe) continue
      const series = room.seriesOrPipe as Series
      indoorKwBySeries.set(series, (indoorKwBySeries.get(series) || 0) + c.factKw * c.qty)
    }
    return [...indoorKwBySeries.entries()].map(([series, indoorKw]) => {
      const candidates = outdoorCandidates(series)
      const auto = matchOutdoorUnit(series, indoorKw)
      const manualId = outdoorPicks[series] || null
      const manual = manualId ? candidates.find(p => p.id === manualId) || null : null
      const product = manual || auto.product
      const ratio = product ? indoorKw / product.coolingCapacity : auto.ratio
      return { series, indoorKw, candidates, auto, isManual: !!manual, product, ratio }
    })
  }, [computed, outdoorPicks])

  const outdoorSum = outdoorGroups.reduce((s, g) => s + (g.product?.price || 0), 0)

  const stockAlerts = useMemo(() => {
    let low = 0, none = 0
    for (const { c } of computed) {
      if (!c.matched) continue
      if (c.stockQty === undefined || c.stockQty <= 0) none += 1
      else if (c.stockQty < c.qty) low += 1
    }
    return { low, none }
  }, [computed])

  const handleTransfer = useCallback(() => {
    const items = computed
      .filter(x => x.c.matched)
      .map(x => ({ productId: x.c.matched!.id, quantity: x.c.qty }))
    const outdoorItems = outdoorGroups
      .filter(g => g.product)
      .map(g => ({ productId: g.product!.id, quantity: 1 }))
    const allItems = [...items, ...outdoorItems]
    if (allItems.length === 0) return
    setTransferring(true)
    sessionStorage.setItem('umbt_podbor_transfer', JSON.stringify(allItems))
    router.push('/')
  }, [computed, outdoorGroups, router])

  const exportExcel = useCallback(async (mode: 'client' | 'work') => {
    const XLSX = await import('xlsx')
    if (mode === 'client') {
      const rows = computed.map(({ room, c }) => ({
        'Комната': room.name,
        'Площадь, м²': c.area ?? '',
        'кВт (факт)': Math.round(c.factKw * c.qty * 10) / 10,
        'Кол-во, шт': c.qty,
        'Модель': c.matched?.model || '—',
        'Цена, у.е.': c.matched?.price || 0,
        'Сумма, у.е.': c.sum,
      }))
      rows.push({
        'Комната': 'Итого', 'Площадь, м²': Math.round(totals.area * 100) / 100, 'кВт (факт)': Math.round(totals.kw * 10) / 10,
        'Кол-во, шт': totals.qty, 'Модель': '', 'Цена, у.е.': '' as any, 'Сумма, у.е.': totals.sum,
      })
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'КП')
      XLSX.writeFile(wb, 'Подбор — КП.xlsx')
    } else {
      const rows = computed.map(({ room, c }) => ({
        'Комната': room.name,
        'Тип оборудования': FAMILY_LABEL[room.family],
        'Форм-фактор': room.formFactor ? FORM_FACTOR_LABEL[room.formFactor] : '—',
        'Серия / трубность': room.family === 'vrf'
          ? (SERIES_LABEL as any)[room.seriesOrPipe || ''] || '—'
          : room.family === 'fancoil'
            ? (PIPE_LABEL as any)[room.seriesOrPipe || ''] || '—'
            : '—',
        'Модель': c.matched?.model || '—',
        'Кол-во, шт': c.qty,
        'Остаток на складе': c.stockQty !== undefined ? c.stockQty : 'нет данных',
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Рабочий лист')
      XLSX.writeFile(wb, 'Подбор — рабочий лист.xlsx')
    }
  }, [computed, totals])

  return (
    <div className="podbor-shell">
      <div className="podbor-topbar">
        <div>
          <a href="/" className="btn btn-ghost" style={{ marginBottom: 10 }}>
            <ArrowLeft size={14} /> К каталогу
          </a>
          <h1>Подбор оборудования по комнатам</h1>
        </div>
        <button className="btn btn-ghost" onClick={clearRooms}><Trash2 size={14} /> Очистить подбор</button>
      </div>
      <p className="podbor-lede">
        Площадь считается как в Excel — число или формула (8*5, =8*5, 20+20). Площадь × 0,135 даёт кВт по формуле;
        поле «кВт вручную» перекрывает её. Тип оборудования — реальные семейства каталога: VRF-система, Фанкойл,
        Высоконапорный канальный сплит. Подобранную модель всегда можно заменить вручную на любую другую —
        независимо от того, подходит она по кВт.
      </p>

      <div className="podbor-layout">
        <div>
          <div className="podbor-card">
            {computed.map(({ room, c }, idx) => (
              <RoomCard
                key={room.id}
                index={idx + 1}
                room={room}
                c={c}
                onUpdate={patch => updateRoom(room.id, patch)}
                onRemove={() => removeRoom(room.id)}
                onFamily={family => setFamily(room.id, family)}
                onFormFactor={ff => setFormFactor(room.id, room, ff)}
                canRemove={rooms.length > 1}
              />
            ))}
            <div className="add-room-row">
              <button className="btn-add-room" onClick={addRoom}><Plus size={14} /> Добавить комнату</button>
            </div>
          </div>
        </div>

        <div className="podbor-summary">
          <div className="podbor-card summary-card">
            <p className="summary-title">Итого по подбору</p>
            <div className="kpi-row"><span className="kpi-label">Общая площадь</span><span className="kpi-value">{formatDecimal(totals.area)} м²</span></div>
            <div className="kpi-row"><span className="kpi-label">Комнат</span><span className="kpi-value">{totals.rooms}</span></div>
            <div className="kpi-row"><span className="kpi-label">Единиц оборудования</span><span className="kpi-value">{totals.qty}</span></div>
            <div className="kpi-row"><span className="kpi-label">Суммарная мощность</span><span className="kpi-value">{formatDecimal(totals.kw)} кВт</span></div>
            <div className="kpi-divider" />
            <div className="kpi-row"><span className="kpi-label">Стоимость оборудования</span><span className="kpi-value accent">{formatNum(totals.sum)} у.е.</span></div>
            {outdoorGroups.length > 0 && (
              <>
                <div className="kpi-row"><span className="kpi-label">Наружные блоки</span><span className="kpi-value">{formatNum(outdoorSum)} у.е.</span></div>
                <div className="kpi-row"><span className="kpi-label">Итого с наружными блоками</span><span className="kpi-value accent">{formatNum(totals.sum + outdoorSum)} у.е.</span></div>
              </>
            )}
          </div>

          <div className="podbor-card summary-card">
            <p className="summary-title">Разбивка по группам</p>
            <div className="kpi-row"><span className="kpi-label">Фанкойлы</span><span className="kpi-value">{totals.fancoil.qty} шт · {formatNum(totals.fancoil.sum)} у.е.</span></div>
            <div className="kpi-row"><span className="kpi-label">Агрегаты (VRF + сплит)</span><span className="kpi-value">{totals.units.qty} шт · {formatNum(totals.units.sum)} у.е.</span></div>
          </div>

          {outdoorGroups.length > 0 && (
            <div className="podbor-card summary-card">
              <p className="summary-title">Наружные блоки VRF — по сумме внутренних</p>
              {outdoorGroups.map(g => (
                <div key={g.series} className="outdoor-group" style={{ marginBottom: 10 }}>
                  <div className="kpi-row">
                    <span className="kpi-label">{SERIES_LABEL[g.series]} · внутри</span>
                    <span className="kpi-value">{formatDecimal(g.indoorKw)} кВт</span>
                  </div>
                  <select
                    className="field-input"
                    style={{ width: '100%', marginTop: 4 }}
                    value={g.product?.id || ''}
                    onChange={e => setOutdoorPicks(prev => ({ ...prev, [g.series]: e.target.value || null }))}
                  >
                    <option value="">— авто по мощности —</option>
                    {g.candidates.map(p => (
                      <option key={p.id} value={p.id}>{productLabel(p)}</option>
                    ))}
                  </select>
                  {g.product ? (
                    <div className="outdoor-product-row" style={{ marginTop: 4 }}>
                      {g.product.image && (
                        <img className="outdoor-product-thumb" src={g.product.image} alt={g.product.model} />
                      )}
                      <p className="kw-note" style={{ margin: 0 }}>
                        {g.product.model} · {formatDecimal(g.product.coolingCapacity)} кВт · {formatNum(g.product.price)} у.е.
                        {g.ratio != null && <> · загрузка {Math.round(g.ratio * 100)}%</>}
                        {g.ratio != null && (g.ratio < 0.9 || g.ratio > 1.15) && (
                          <span style={{ color: 'var(--error)' }}> — вне 90–115%, проверьте вручную</span>
                        )}
                      </p>
                    </div>
                  ) : (
                    <p className="result-note warn" style={{ marginTop: 4 }}>
                      ⚠ {g.auto.reason === 'over_capacity'
                        ? `даже самого мощного блока серии не хватает (потребовалось бы ${Math.round((g.auto.ratio || 0) * 100)}% от него) — выберите вручную или разбейте на несколько систем`
                        : 'нет наружных блоков этой серии в каталоге — выберите вручную'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {(stockAlerts.low > 0 || stockAlerts.none > 0) && (
            <div className="podbor-card summary-card">
              <p className="summary-title">Остатки</p>
              <div className="alert-line">
                ⚠ {stockAlerts.low > 0 && <>{stockAlerts.low} позиции мало на складе</>}
                {stockAlerts.low > 0 && stockAlerts.none > 0 && ', '}
                {stockAlerts.none > 0 && <>{stockAlerts.none} — под заказ</>}
              </div>
            </div>
          )}

          <div className="podbor-card summary-card">
            <p className="summary-title" style={{ marginBottom: 10 }}>Перенести в КП</p>
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={transferring || totals.qty === 0} onClick={handleTransfer}>
              ➜ Перенести в КП
            </button>
            <p className="transfer-note">Подобранные модели с количеством попадут в основной раздел сайта. Дальше собираете предложение как обычно.</p>
          </div>

          <div className="podbor-card summary-card">
            <p className="summary-title" style={{ marginBottom: 10 }}>Выгрузка</p>
            <button className="btn btn-primary" style={{ width: '100%', marginBottom: 8 }} onClick={() => exportExcel('client')}>⬇ Excel — коммерческое предложение</button>
            <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => exportExcel('work')}>⬇ Excel — рабочий лист (монтаж)</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RoomCard({ index, room, c, onUpdate, onRemove, onFamily, onFormFactor, canRemove }: {
  index: number
  room: Room
  c: ReturnType<typeof computeRoom>
  onUpdate: (patch: Partial<Room>) => void
  onRemove: () => void
  onFamily: (family: Family) => void
  onFormFactor: (ff: FormFactor) => void
  canRemove: boolean
}) {
  const families: Family[] = ['vrf', 'fancoil', 'split']
  const formFactors = formFactorOptions(room.family)
  const seriesOrPipeOptions = room.family === 'vrf'
    ? (room.formFactor ? seriesOptions(room.family, room.formFactor) : [])
    : room.family === 'fancoil'
      ? (room.formFactor ? pipeTypeOptions(room.family, room.formFactor) : [])
      : []
  const seriesLabelMap: Record<string, string> = room.family === 'vrf' ? SERIES_LABEL : PIPE_LABEL

  const noCapacityData = c.auto.reason === 'no_capacity_data' && !c.isManual
  const noCandidates = c.auto.reason === 'no_candidates' && !c.isManual

  const stockBadge = () => {
    if (!c.matched) return null
    if (c.stockQty === undefined) return <span className="stock-badge warn"><span className="dot" />нет данных</span>
    if (c.stockQty <= 0) return <span className="stock-badge danger"><span className="dot" />под заказ</span>
    if (c.stockQty < c.qty) return <span className="stock-badge warn"><span className="dot" />{c.stockQty} из {c.qty} в наличии</span>
    return <span className="stock-badge ok"><span className="dot" />{c.stockQty} шт на складе</span>
  }

  return (
    <div className={`room-card ${noCapacityData || noCandidates ? 'attention' : ''}`}>
      <div className="room-head">
        <div className="room-name-wrap">
          <span className="room-index">Комната {index}</span>
          <input className="room-name-input" value={room.name} onChange={e => onUpdate({ name: e.target.value })} />
        </div>
        {canRemove && (
          <button className="room-remove-btn" onClick={onRemove} title="Удалить комнату"><Trash2 size={13} /></button>
        )}
      </div>

      <div className="type-row">
        <span className="podbor-label">Тип оборудования</span>
        <div className="segmented wide">
          {families.map(f => (
            <button key={f} className={room.family === f ? 'active' : ''} onClick={() => onFamily(f)}>{FAMILY_LABEL[f]}</button>
          ))}
        </div>
      </div>

      <div className="room-field-grid">
        <div className="room-field">
          <span className="podbor-label">Площадь, м²</span>
          <input
            className="field-input formula-input"
            value={room.areaInput}
            placeholder="напр. 8*5"
            onChange={e => onUpdate({ areaInput: e.target.value })}
          />
          {room.areaInput.trim() && (
            c.area != null
              ? <span className="kw-note">= {formatDecimal(c.area)} м²</span>
              : <span className="kw-note" style={{ color: 'var(--error)' }}>не удалось посчитать</span>
          )}
        </div>

        <div className="room-field">
          <span className="podbor-label">кВт · формула</span>
          <div className={`kw-box ${!c.manualKwValid ? 'used' : ''}`}>{c.area != null ? formatDecimal(c.formulaKw) : '—'}</div>
          {!c.manualKwValid && <span className="kw-used-tag">используется</span>}
          <span className="kw-note">площадь × 0,135</span>
        </div>

        <div className="room-field">
          <span className="podbor-label">кВт · вручную</span>
          <input
            className="field-input"
            value={room.manualKw}
            placeholder="—"
            onChange={e => onUpdate({ manualKw: e.target.value })}
          />
          {c.manualKwValid && <span className="kw-used-tag">используется</span>}
        </div>

        <div className="room-field">
          <span className="podbor-label">Количество, шт</span>
          <input
            className="field-input"
            style={{ textAlign: 'center', fontWeight: 700 }}
            value={room.qty}
            onChange={e => onUpdate({ qty: e.target.value.replace(/[^\d]/g, '') })}
          />
          {c.qty > 1 && <span className="kw-note">= {formatDecimal(c.factKw * c.qty)} кВт всего</span>}
        </div>
      </div>

      <div className="classify-row">
        {formFactors.length > 0 && (
          <div className="room-field">
            <span className="podbor-label">Форм-фактор</span>
            <div className="segmented">
              {formFactors.map(ff => (
                <button key={ff} className={room.formFactor === ff ? 'active' : ''} onClick={() => onFormFactor(ff)}>{FORM_FACTOR_LABEL[ff]}</button>
              ))}
            </div>
          </div>
        )}
        {seriesOrPipeOptions.length > 0 && (
          <div className="room-field">
            <span className="podbor-label">{room.family === 'vrf' ? 'Серия' : 'Трубность'}</span>
            <div className="segmented">
              {seriesOrPipeOptions.map(s => (
                <button key={s} className={room.seriesOrPipe === s ? 'active' : ''} onClick={() => onUpdate({ seriesOrPipe: s, manualModelId: null })}>{seriesLabelMap[s]}</button>
              ))}
            </div>
          </div>
        )}
        {room.family === 'split' && (
          <div className="room-field">
            <span className="podbor-label">Форм-фактор</span>
            <span className="kw-note">не выбирается — готовый агрегат</span>
          </div>
        )}
      </div>

      <div className={`result-strip ${c.isManual ? 'manual' : ''} ${noCapacityData || noCandidates ? 'no-data' : ''}`}>
        <div className="result-left">
          <div className="result-model-block">
            <span className="result-eyebrow">{c.isManual ? 'Выбрано вручную' : 'Подобрано'} {c.qty > 1 ? `· ${c.qty} шт` : ''}</span>
            <select
              className="result-model-select"
              value={c.matched?.id || ''}
              onChange={e => onUpdate({ manualModelId: e.target.value || null })}
            >
              <option value="">— выбрать модель —</option>
              {(['vrf', 'fancoil', 'split'] as Family[]).map(fam => (
                <optgroup key={fam} label={FAMILY_LABEL[fam]}>
                  {familyProducts(fam).map(p => (
                    <option key={p.id} value={p.id}>{productLabel(p)}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {c.matched && <span className="result-meta">{c.matched.coolingCapacity > 0 ? `${formatDecimal(c.matched.coolingCapacity)} кВт · ` : ''}{formatNum(c.matched.price)} у.е. / шт</span>}
          </div>
          {noCapacityData && <span className="result-note warn">⚠ в каталоге не указана мощность для этой категории — выберите модель вручную</span>}
          {noCandidates && <span className="result-note warn">⚠ для этой комбинации нет моделей в каталоге</span>}
          {!c.isManual && c.matched && c.matched.coolingCapacity > 0 && (
            <span className="result-note">запас {formatDecimal(c.matched.coolingCapacity - c.factKw)} кВт к требуемым {formatDecimal(c.factKw)}</span>
          )}
        </div>
        <div className="result-right">
          {stockBadge()}
          <div className="result-sum-block">
            <div className="result-sum-label">Сумма</div>
            <div className="result-sum">{formatNum(c.sum)} у.е.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
