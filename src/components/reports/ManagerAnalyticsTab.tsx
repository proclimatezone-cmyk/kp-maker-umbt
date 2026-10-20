'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { formatNum, todayIso } from '@/lib/format'
import { ColumnChart, RankingBars, StatTile } from '@/components/reports/charts'
import type { ManagerAnalytics, OrderRecord, KpRecord } from '@/lib/reports/manager-analytics'

// ---------------------------------------------------------------------------
// Даты (все в ISO, «сегодня» — по Ташкенту)
// ---------------------------------------------------------------------------

const DAY = 86_400_000
const toMs = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const addDays = (iso: string, n: number) => toIso(toMs(iso) + n * DAY)
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const ruShort = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
const ruFull = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

function startOfWeek(iso: string) {
  const dow = (new Date(toMs(iso)).getUTCDay() + 6) % 7 // Пн = 0
  return addDays(iso, -dow)
}

type PresetKey = 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom'
interface Range { from: string; to: string }

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: '3 месяца' },
  { key: 'year', label: 'Год' },
  { key: 'all', label: 'Всё время' },
  { key: 'custom', label: 'Период…' },
]

function presetRange(key: PresetKey, today: string, minDate: string): Range {
  switch (key) {
    case 'today': return { from: today, to: today }
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y } }
    case 'week': return { from: startOfWeek(today), to: today }
    case 'month': return { from: today.slice(0, 8) + '01', to: today }
    case 'quarter': return { from: addDays(today, -90), to: today }
    case 'year': return { from: today.slice(0, 5) + '01-01', to: today }
    default: return { from: minDate, to: today }
  }
}

/** Такой же по длине период непосредственно перед выбранным — для сравнения. */
function previousRange(r: Range): Range {
  const len = (toMs(r.to) - toMs(r.from)) / DAY + 1
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) }
}

const inRange = (d: string | null, r: Range) => !!d && d >= r.from && d <= r.to

// ---------------------------------------------------------------------------
// Агрегаты
// ---------------------------------------------------------------------------

interface Totals { amount: number; orders: number; units: number; kpCount: number; kpAmount: number; estimated: number }

function totals(orders: OrderRecord[], kps: KpRecord[]): Totals {
  return {
    amount: orders.reduce((s, o) => s + o.amount, 0),
    orders: orders.length,
    units: orders.reduce((s, o) => s + o.units, 0),
    kpCount: kps.length,
    kpAmount: kps.reduce((s, k) => s + (k.currency === 'USD' ? k.total : 0), 0),
    estimated: orders.filter(o => o.dateSource === 'оценка').length,
  }
}

function deltaPct(cur: number, prev: number): number | null {
  if (!prev) return null
  return ((cur - prev) / prev) * 100
}

type Bucket = 'day' | 'week' | 'month'
function bucketOf(iso: string, b: Bucket) {
  if (b === 'day') return iso
  if (b === 'week') return startOfWeek(iso)
  return iso.slice(0, 7)
}
function bucketLabel(key: string, b: Bucket) {
  if (b === 'month') return `${MONTHS[+key.slice(5, 7) - 1]} ${key.slice(2, 4)}`
  return ruShort(key)
}
function bucketKeys(r: Range, b: Bucket): string[] {
  const keys: string[] = []
  let cur = r.from
  while (cur <= r.to) {
    const k = bucketOf(cur, b)
    if (keys[keys.length - 1] !== k) keys.push(k)
    cur = addDays(cur, 1)
  }
  return keys
}

type Metric = 'amount' | 'orders' | 'units' | 'kpCount'
const METRICS: { key: Metric; label: string; suffix: string }[] = [
  { key: 'amount', label: 'Сумма, $', suffix: ' $' },
  { key: 'orders', label: 'Заказы', suffix: '' },
  { key: 'units', label: 'Штуки', suffix: ' шт' },
  { key: 'kpCount', label: 'КП выдано', suffix: '' },
]

// ---------------------------------------------------------------------------

export default function ManagerAnalyticsTab() {
  const [data, setData] = useState<ManagerAnalytics | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [preset, setPreset] = useState<PresetKey>('month')
  const [custom, setCustom] = useState<Range | null>(null)
  const [managerKey, setManagerKey] = useState('')
  const [metric, setMetric] = useState<Metric>('amount')
  const [includeEstimated, setIncludeEstimated] = useState(true)

  useEffect(() => {
    setLoading(true)
    setError('')
    fetch(`/api/reports/managers${reloadKey ? '?refresh=true' : ''}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(setData)
      .catch(() => setError('Не удалось загрузить аналитику'))
      .finally(() => setLoading(false))
  }, [reloadKey])

  const today = todayIso()
  const minDate = useMemo(() => {
    if (!data) return today
    const dates = [...data.orders.map(o => o.date), ...data.kps.map(k => k.date)].filter(Boolean) as string[]
    return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : today
  }, [data, today])

  const range: Range = preset === 'custom' && custom ? custom : presetRange(preset, today, minDate)
  const prevRange = previousRange(range)

  const managerName = useMemo(() => {
    const m = new Map<string, string>()
    data?.managers.forEach(x => m.set(x.key, x.name))
    // Не из справочника — имя из последнего КП этого логина.
    data?.kps.forEach(k => { if (k.managerKey.startsWith('~')) m.set(k.managerKey, `${k.managerName} (${k.managerKey.slice(1)})`) })
    m.set('?', 'Не определён')
    return (key: string) => m.get(key) || key
  }, [data])

  const baseOrders = useMemo(() => (data?.orders || []).filter(o =>
    (includeEstimated || o.dateSource !== 'оценка') && (!managerKey || o.managerKey === managerKey)), [data, includeEstimated, managerKey])
  const baseKps = useMemo(() => (data?.kps || []).filter(k => !managerKey || k.managerKey === managerKey), [data, managerKey])

  const curOrders = useMemo(() => baseOrders.filter(o => inRange(o.date, range)), [baseOrders, range.from, range.to])
  const curKps = useMemo(() => baseKps.filter(k => inRange(k.date, range)), [baseKps, range.from, range.to])
  const cur = totals(curOrders, curKps)
  const prev = totals(baseOrders.filter(o => inRange(o.date, prevRange)), baseKps.filter(k => inRange(k.date, prevRange)))
  const showDelta = preset !== 'all'

  // Таблица менеджеров — всегда по всем, независимо от выбранного менеджера.
  const managerRows = useMemo(() => {
    if (!data) return []
    const orders = data.orders.filter(o => inRange(o.date, range) && (includeEstimated || o.dateSource !== 'оценка'))
    const kps = data.kps.filter(k => inRange(k.date, range))
    const keys = new Set([...orders.map(o => o.managerKey), ...kps.map(k => k.managerKey)])
    const total = orders.reduce((s, o) => s + o.amount, 0) || 1
    return [...keys].map(key => {
      const t = totals(orders.filter(o => o.managerKey === key), kps.filter(k => k.managerKey === key))
      return { key, name: managerName(key), ...t, share: t.amount / total, avg: t.orders ? t.amount / t.orders : 0 }
    }).sort((a, b) => b.amount - a.amount || b.kpCount - a.kpCount)
  }, [data, range.from, range.to, includeEstimated, managerName])

  const bucket: Bucket = useMemo(() => {
    const days = (toMs(range.to) - toMs(range.from)) / DAY + 1
    return days <= 31 ? 'day' : days <= 120 ? 'week' : 'month'
  }, [range.from, range.to])

  const chart = useMemo(() => {
    const keys = bucketKeys(range, bucket)
    const vals = new Map(keys.map(k => [k, 0]))
    if (metric === 'kpCount') {
      for (const k of curKps) vals.set(bucketOf(k.date, bucket), (vals.get(bucketOf(k.date, bucket)) || 0) + 1)
    } else {
      for (const o of curOrders) {
        const k = bucketOf(o.date!, bucket)
        const v = metric === 'amount' ? o.amount : metric === 'orders' ? 1 : o.units
        vals.set(k, (vals.get(k) || 0) + v)
      }
    }
    return keys.map(k => ({ label: bucketLabel(k, bucket), value: Math.round(vals.get(k) || 0) }))
  }, [curOrders, curKps, range.from, range.to, bucket, metric])

  // Сводка «день / неделя / месяц / 3 мес / год» — не зависит от выбранного периода.
  const summary = useMemo(() => {
    const rows: { label: string; key: PresetKey }[] = [
      { label: 'Сегодня', key: 'today' }, { label: 'Вчера', key: 'yesterday' }, { label: 'Эта неделя', key: 'week' },
      { label: 'Этот месяц', key: 'month' }, { label: '3 месяца', key: 'quarter' }, { label: 'Этот год', key: 'year' },
    ]
    return rows.map(r => {
      const rg = presetRange(r.key, today, minDate)
      return { ...r, range: rg, t: totals(baseOrders.filter(o => inRange(o.date, rg)), baseKps.filter(k => inRange(k.date, rg))) }
    })
  }, [baseOrders, baseKps, today, minDate])

  // Помесячно по менеджерам — последние 6 месяцев.
  const pivot = useMemo(() => {
    if (!data) return { months: [] as string[], rows: [] as { key: string; vals: number[]; total: number }[] }
    const months: string[] = []
    let m = today.slice(0, 7)
    for (let i = 0; i < 6; i++) {
      months.unshift(m)
      const [y, mo] = m.split('-').map(Number)
      m = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`
    }
    const orders = data.orders.filter(o => o.date && (includeEstimated || o.dateSource !== 'оценка'))
    const keys = [...new Set(orders.map(o => o.managerKey))]
    const rows = keys.map(key => {
      const vals = months.map(mo => orders.filter(o => o.managerKey === key && o.date!.startsWith(mo)).reduce((s, o) => s + o.amount, 0))
      return { key, vals, total: vals.reduce((a, b) => a + b, 0) }
    }).filter(r => r.total > 0).sort((a, b) => b.total - a.total)
    return { months, rows }
  }, [data, today, includeEstimated])

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of curOrders) for (const l of o.lines) map.set(l.category || 'Без категории', (map.get(l.category || 'Без категории') || 0) + l.qty)
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [curOrders])

  if (loading) return <div className="reports-loading"><RefreshCw className="spin" size={20} /></div>
  if (error || !data) return <div className="reports-error">{error || 'Нет данных'}</div>

  const estimatedAll = data.orders.filter(o => o.dateSource === 'оценка').length
  const contractAll = data.orders.filter(o => o.amountSource === 'договор').length
  const metricInfo = METRICS.find(m => m.key === metric)!

  return (
    <>
      <div className="completeness-banner">
        <AlertTriangle size={16} />
        <span>
          Заказов в «Заказы»: {data.orders.length}. Менеджер определяется по коду заказа (MN, K, Э, И, КЖ…) — у всех.
          Сумма: по договору у {contractAll}, у остальных — по текущему прайсу без скидок.
          {estimatedAll > 0 && <> Дата у {estimatedAll} старых заказов примерная (≈) — точные даты можно поправить в листе «Журнал заказов» таблицы архива КП; новые заказы датируются автоматически.</>}
        </span>
      </div>
      {data.warnings.map((w, i) => <div key={i} className="completeness-banner">{w}</div>)}

      <div className="period-bar">
        <div className="period-presets">
          {PRESETS.map(p => (
            <button key={p.key} className={`period-chip ${preset === p.key ? 'active' : ''}`}
              onClick={() => { setPreset(p.key); if (p.key === 'custom' && !custom) setCustom(presetRange('month', today, minDate)) }}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && custom && (
          <div className="period-custom">
            <input type="date" value={custom.from} max={custom.to} onChange={e => e.target.value && setCustom({ ...custom, from: e.target.value })} />
            <span>—</span>
            <input type="date" value={custom.to} min={custom.from} onChange={e => e.target.value && setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
        <div className="period-meta">
          {ruFull(range.from)}{range.from !== range.to && ` — ${ruFull(range.to)}`}
          <button className="btn btn-ghost" onClick={() => setReloadKey(k => k + 1)} title="Перечитать таблицы">
            <RefreshCw size={13} /> Обновить
          </button>
        </div>
      </div>

      <div className="report-filters">
        <select value={managerKey} onChange={e => setManagerKey(e.target.value)}>
          <option value="">Все менеджеры</option>
          {data.managers.map(m => <option key={m.key} value={m.key}>{m.name} ({m.key})</option>)}
        </select>
        <label className="report-check">
          <input type="checkbox" checked={includeEstimated} onChange={e => setIncludeEstimated(e.target.checked)} />
          Учитывать заказы с примерной датой (≈)
        </label>
      </div>

      <div className="stat-grid">
        <StatTile label="Продажи, $" value={formatNum(cur.amount)} hint={showDelta ? deltaText(cur.amount, prev.amount) : undefined} />
        <StatTile label="Заказов" value={formatNum(cur.orders)} hint={showDelta ? deltaText(cur.orders, prev.orders) : undefined} />
        <StatTile label="Средний чек, $" value={formatNum(cur.orders ? cur.amount / cur.orders : 0)} />
        <StatTile label="Штук оборудования" value={formatNum(cur.units)} hint={showDelta ? deltaText(cur.units, prev.units) : undefined} />
        <StatTile label="КП выдано" value={formatNum(cur.kpCount)} hint={showDelta ? deltaText(cur.kpCount, prev.kpCount) : `на ${formatNum(cur.kpAmount)} $`} />
      </div>

      <div className="report-section">
        <h2>Сводка{managerKey ? ` — ${managerName(managerKey)}` : ''}</h2>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr><th>Период</th><th className="num">Продажи, $</th><th className="num">Заказов</th><th className="num">Штук</th><th className="num">Средний чек, $</th><th className="num">КП выдано</th><th className="num">Сумма КП, $</th></tr>
            </thead>
            <tbody>
              {summary.map(s => (
                <tr key={s.key} className="clickable" onClick={() => setPreset(s.key)}>
                  <td><b>{s.label}</b> <span className="muted">{ruShort(s.range.from)}{s.range.from !== s.range.to && `–${ruShort(s.range.to)}`}</span></td>
                  <td className="num">{formatNum(s.t.amount)}</td>
                  <td className="num">{formatNum(s.t.orders)}</td>
                  <td className="num">{formatNum(s.t.units)}</td>
                  <td className="num">{formatNum(s.t.orders ? s.t.amount / s.t.orders : 0)}</td>
                  <td className="num">{formatNum(s.t.kpCount)}</td>
                  <td className="num">{formatNum(s.t.kpAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="report-section">
        <h2>Менеджеры за период</h2>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Менеджер</th><th className="num">Продажи, $</th><th className="num">Доля</th><th className="num">Заказов</th>
                <th className="num">Средний чек, $</th><th className="num">Штук</th><th className="num">КП выдано</th><th className="num">Сумма КП, $</th><th className="num">Заказов на 10 КП</th>
              </tr>
            </thead>
            <tbody>
              {managerRows.map(r => (
                <tr key={r.key} className={`clickable ${managerKey === r.key ? 'selected' : ''}`} onClick={() => setManagerKey(managerKey === r.key ? '' : r.key)}>
                  <td>{!r.key.startsWith('~') && <span className="badge">{r.key}</span>} {r.name}</td>
                  <td className="num"><b>{formatNum(r.amount)}</b></td>
                  <td className="num">{Math.round(r.share * 100)}%</td>
                  <td className="num">{formatNum(r.orders)}{r.estimated > 0 && <span className="muted"> (≈{r.estimated})</span>}</td>
                  <td className="num">{formatNum(r.avg)}</td>
                  <td className="num">{formatNum(r.units)}</td>
                  <td className="num">{formatNum(r.kpCount)}</td>
                  <td className="num">{formatNum(r.kpAmount)}</td>
                  <td className="num">{r.kpCount ? (r.orders / r.kpCount * 10).toFixed(1) : '—'}</td>
                </tr>
              ))}
              {!managerRows.length && <tr><td colSpan={9} className="muted">За этот период нет ни заказов, ни КП</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="stat-tile-hint" style={{ marginTop: 8 }}>
          Клик по строке — показать только этого менеджера. «Заказов на 10 КП» — грубая конверсия: заказы и КП за один и тот же период.
        </p>
      </div>

      <div className="report-section">
        <div className="section-head">
          <h2>Динамика{managerKey ? ` — ${managerName(managerKey)}` : ''} ({bucket === 'day' ? 'по дням' : bucket === 'week' ? 'по неделям' : 'по месяцам'})</h2>
          <div className="toggle-group small">
            {METRICS.map(m => <button key={m.key} className={metric === m.key ? 'on' : ''} onClick={() => setMetric(m.key)}>{m.label}</button>)}
          </div>
        </div>
        <ColumnChart data={chart} valueSuffix={metricInfo.suffix} />
      </div>

      <div className="report-section">
        <h2>Продажи по месяцам и менеджерам, $</h2>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr><th>Менеджер</th>{pivot.months.map(m => <th key={m} className="num">{bucketLabel(m, 'month')}</th>)}<th className="num">Итого</th></tr>
            </thead>
            <tbody>
              {pivot.rows.map(r => (
                <tr key={r.key}>
                  <td><span className="badge">{r.key}</span> {managerName(r.key)}</td>
                  {r.vals.map((v, i) => <td key={i} className="num">{v ? formatNum(v) : '—'}</td>)}
                  <td className="num"><b>{formatNum(r.total)}</b></td>
                </tr>
              ))}
              <tr className="total-row">
                <td>Итого</td>
                {pivot.months.map((_, i) => <td key={i} className="num">{formatNum(pivot.rows.reduce((s, r) => s + r.vals[i], 0))}</td>)}
                <td className="num">{formatNum(pivot.rows.reduce((s, r) => s + r.total, 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="report-section">
        <h2>Что продаётся (штук за период)</h2>
        <RankingBars data={byCategory} valueSuffix=" шт" maxItems={10} />
      </div>

      <div className="report-section">
        <h2>Заказы за период ({curOrders.length})</h2>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr><th>Заказ</th><th>Дата</th><th>Менеджер</th><th>Объект</th><th className="num">Штук</th><th className="num">Сумма, $</th><th>Сумма по</th></tr>
            </thead>
            <tbody>
              {[...curOrders].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(o => (
                <tr key={o.code}>
                  <td>{o.code}</td>
                  <td>{o.date ? ruFull(o.date) : '—'}{o.dateSource === 'оценка' && <span className="badge unlinked" title="Дата оценена по порядку заказов">≈</span>}</td>
                  <td>{managerName(o.managerKey)}</td>
                  <td>{o.projectName || <span className="muted">—</span>}</td>
                  <td className="num">{formatNum(o.units)}</td>
                  <td className="num">{formatNum(o.amount)}</td>
                  <td>{o.amountSource === 'договор'
                    ? <span className="badge linked">договору</span>
                    : <span className="badge" title={`Цена найдена для ${Math.round(o.priceCoverage * 100)}% штук`}>прайсу{o.priceCoverage < 0.95 ? ` (${Math.round(o.priceCoverage * 100)}%)` : ''}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function deltaText(cur: number, prev: number): string {
  const d = deltaPct(cur, prev)
  if (d === null) return cur ? 'в прошлом периоде — 0' : 'нет данных'
  return `${d >= 0 ? '▲ +' : '▼ '}${d.toFixed(0)}% к прошлому периоду`
}
