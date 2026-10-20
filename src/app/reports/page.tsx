'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, AlertTriangle, RefreshCw } from 'lucide-react'
import { formatNum } from '@/lib/format'
import { RankingBars, StatTile } from '@/components/reports/charts'
import ManagerAnalyticsTab from '@/components/reports/ManagerAnalyticsTab'
import type { BookingsReport } from '@/lib/reports/bookings'
import type { PriceComparisonReport } from '@/lib/reports/price-comparison'
import type { WelkinComparisonReport } from '@/lib/reports/welkin-comparison'
import type { MideaCacComparisonReport } from '@/lib/reports/midea-cac-comparison'
import type { HofmannComparisonReport } from '@/lib/reports/hofmann-comparison'
import './reports.css'

type Tab = 'sales' | 'bookings' | 'price' | 'welkin' | 'hofmann' | 'midea-cac'

function useReportData<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(url)
      .then(r => { if (!r.ok) throw new Error('Ошибка загрузки'); return r.json() })
      .then(d => setData(d))
      .catch(() => setError('Не удалось загрузить данные'))
      .finally(() => setLoading(false))
  }, [url])

  return { data, error, loading }
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('sales')

  return (
    <div className="reports-page fade-in">
      <div className="reports-header">
        <div>
          <a href="/" className="btn btn-ghost" style={{ marginBottom: 10 }}>
            <ArrowLeft size={14} /> Назад в КП
          </a>
          <h1>Отчёты</h1>
        </div>
      </div>

      <div className="reports-tabs">
        <button className={`reports-tab ${tab === 'sales' ? 'active' : ''}`} onClick={() => setTab('sales')}>Аналитика продаж</button>
        <button className={`reports-tab ${tab === 'bookings' ? 'active' : ''}`} onClick={() => setTab('bookings')}>Бронь</button>
        <button className={`reports-tab ${tab === 'price' ? 'active' : ''}`} onClick={() => setTab('price')}>Прайс</button>
        <button className={`reports-tab ${tab === 'welkin' ? 'active' : ''}`} onClick={() => setTab('welkin')}>Welkin</button>
        <button className={`reports-tab ${tab === 'hofmann' ? 'active' : ''}`} onClick={() => setTab('hofmann')}>Hofmann</button>
        <button className={`reports-tab ${tab === 'midea-cac' ? 'active' : ''}`} onClick={() => setTab('midea-cac')}>Midea (завод)</button>
      </div>

      {tab === 'sales' && <ManagerAnalyticsTab />}
      {tab === 'bookings' && <BookingsTab />}
      {tab === 'price' && <PriceTab />}
      {tab === 'welkin' && <WelkinTab />}
      {tab === 'hofmann' && <HofmannTab />}
      {tab === 'midea-cac' && <MideaCacTab />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Бронь
// ---------------------------------------------------------------------------

function BookingsTab() {
  const { data, error, loading } = useReportData<BookingsReport>('/api/reports/bookings')
  const [client, setClient] = useState('')

  const clients = useMemo(() => data ? data.byClient.map(c => c.client) : [], [data])
  const filtered = useMemo(() => {
    if (!data) return []
    return data.records.filter(r => !r.isInternal && (!client || r.client === client))
  }, [data, client])

  if (loading) return <div className="reports-loading"><RefreshCw className="spin" size={20} /></div>
  if (error || !data) return <div className="reports-error">{error || 'Нет данных'}</div>

  return (
    <>
      <div className="completeness-banner">
        <AlertTriangle size={16} />
        В листе «Бронь» нет поля «Менеджер» и нет истории закрытых броней — снятая бронь просто удаляется из таблицы.
        Ниже — только текущий активный срез, сгруппированный по клиенту/объекту.
      </div>

      <div className="stat-grid">
        <StatTile label="Активных броней" value={String(data.activeBookingsCount)} />
        <StatTile label="Забронировано штук" value={formatNum(data.totalQty)} />
        <StatTile label="Клиентов/объектов" value={String(data.byClient.length)} />
      </div>

      <div className="report-filters">
        <select value={client} onChange={e => setClient(e.target.value)}>
          <option value="">Все клиенты</option>
          {clients.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="report-section">
        <h2>По клиенту / объекту</h2>
        <RankingBars data={data.byClient.map(c => ({ label: c.client, value: c.qty }))} valueSuffix=" шт" maxItems={12} />
      </div>

      <div className="report-section">
        <h2>Позиции в брони ({filtered.length})</h2>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Бронь №</th><th>Дата</th><th>Клиент / объект</th><th>Категория</th><th>Модель</th><th className="num">Кол-во</th><th>Примечание</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i}>
                  <td>{r.bookingNo}</td>
                  <td>{r.date || '—'}</td>
                  <td>{r.client}</td>
                  <td>{r.category}</td>
                  <td>{r.model}</td>
                  <td className="num">{formatNum(r.qty)}</td>
                  <td>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Прайс
// ---------------------------------------------------------------------------

function PriceTab() {
  const { data, error, loading } = useReportData<PriceComparisonReport>('/api/reports/price-comparison')
  const [onlyMatched, setOnlyMatched] = useState(true)

  const rows = useMemo(() => {
    if (!data) return []
    return onlyMatched ? data.rows.filter(r => r.status === 'matched') : data.rows
  }, [data, onlyMatched])

  if (loading) return <div className="reports-loading"><RefreshCw className="spin" size={20} /></div>
  if (error || !data) return <div className="reports-error">{error || 'Нет данных'}</div>

  return (
    <>
      <div className="completeness-banner">
        <AlertTriangle size={16} />
        Старый прайс — закупочные цены Midea (со скидкой 62%) на 03.08.2026, USD. Текущая цена — отпускная цена из «для кп» с наценкой.
        Это разные базы: дельта показывает динамику закупки, а не готовую маржу.
      </div>

      <div className="stat-grid">
        <StatTile label="Совпало моделей" value={String(data.matchedCount)} />
        <StatTile label="Только в старом прайсе" value={String(data.oldOnlyCount)} hint="сняты с производства или переименованы" />
        <StatTile label="Новые позиции" value={String(data.currentOnlyCount)} hint="отсутствовали в старом прайсе" />
        <StatTile label="Средняя дельта" value={data.avgDeltaPct !== null ? `${data.avgDeltaPct >= 0 ? '+' : ''}${data.avgDeltaPct.toFixed(1)}%` : '—'} />
      </div>

      <div className="report-filters">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={onlyMatched} onChange={e => setOnlyMatched(e.target.checked)} />
          Только совпавшие модели
        </label>
      </div>

      <div className="report-section">
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Модель</th><th>Категория</th><th className="num">Старая цена, $</th><th className="num">Текущая цена, $</th><th className="num">Дельта</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 400).map((r, i) => (
                <tr key={i}>
                  <td>{r.model}</td>
                  <td>{r.category}</td>
                  <td className="num">{r.oldPrice !== null ? formatNum(r.oldPrice) : '—'}</td>
                  <td className="num">{r.currentPrice !== null ? formatNum(r.currentPrice) : '—'}</td>
                  <td className="num">
                    {r.deltaPct !== null
                      ? <span className={`badge ${r.deltaPct >= 0 ? 'up' : 'down'}`}>{r.deltaPct >= 0 ? '+' : ''}{r.deltaPct.toFixed(1)}%</span>
                      : <span className="badge unlinked">{r.status === 'oldOnly' ? 'снята' : 'новая'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 400 && <div className="stat-tile-hint" style={{ marginTop: 8 }}>Показаны первые 400 из {rows.length} строк.</div>}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Welkin (Hisense OEM) — сравнение с конкурентом
// ---------------------------------------------------------------------------

function WelkinTab() {
  const { data, error, loading } = useReportData<WelkinComparisonReport>('/api/reports/welkin-comparison')
  const [onlyMoreExpensive, setOnlyMoreExpensive] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<'' | 'midea-exact' | 'hisense-approx'>('')

  const rows = useMemo(() => {
    if (!data) return []
    return data.rows.filter(r => (!onlyMoreExpensive || r.weAreMoreExpensive) && (!sourceFilter || r.source === sourceFilter))
  }, [data, onlyMoreExpensive, sourceFilter])

  const exactCount = useMemo(() => data ? data.rows.filter(r => r.source === 'midea-exact').length : 0, [data])
  const approxCount = useMemo(() => data ? data.rows.filter(r => r.source === 'hisense-approx').length : 0, [data])

  if (loading) return <div className="reports-loading"><RefreshCw className="spin" size={20} /></div>
  if (error || !data) return <div className="reports-error">{error || 'Нет данных'}</div>

  return (
    <>
      <div className="completeness-banner">
        <AlertTriangle size={16} />
        Два источника: <b>Welkin by Midea</b> — то же железо Midea под маркой Welkin, точное совпадение по
        артикулу ({exactCount} шт). <b>Welkin by Hisense</b> — чужое железо, общего артикула нет, только
        приблизительный аналог по ближайшей холодопроизводительности внутри класса оборудования ({approxCount} шт),
        используется только там, где точного совпадения по Midea нет. Источник — только позиции «в наличии»,
        «под заказ» сознательно не берём.
      </div>

      <div className="stat-grid">
        <StatTile label="Сопоставлено моделей" value={String(data.matchedCount)} hint={`${exactCount} точных · ${approxCount} приблизительных`} />
        <StatTile label="Мы дороже" value={String(data.weAreMoreExpensiveCount)} />
        <StatTile label="Мы дешевле" value={String(data.weAreCheaperCount)} />
        <StatTile label="Средняя дельта" value={data.avgDeltaPct !== null ? `${data.avgDeltaPct >= 0 ? '+' : ''}${data.avgDeltaPct.toFixed(1)}%` : '—'} hint="наша цена относительно Welkin" />
      </div>

      <div className="report-filters">
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value as any)}>
          <option value="">Оба источника</option>
          <option value="midea-exact">Только Welkin by Midea (точно)</option>
          <option value="hisense-approx">Только Welkin by Hisense (приблизительно)</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={onlyMoreExpensive} onChange={e => setOnlyMoreExpensive(e.target.checked)} />
          Только где мы дороже
        </label>
      </div>

      <div className="report-section">
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Наша модель</th><th>Модель Welkin</th><th>Категория</th><th>Источник</th>
                <th className="num">Наша цена, $</th><th className="num">Welkin, $</th><th className="num">Дельта</th><th className="num">Точность сопоставления</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 400).map((r, i) => (
                <tr key={i}>
                  <td>{r.model}</td>
                  <td>{r.welkinModel}</td>
                  <td>{r.category}</td>
                  <td>
                    {r.source === 'midea-exact'
                      ? <span className="badge down">by Midea</span>
                      : <span className="badge unlinked">by Hisense</span>}
                  </td>
                  <td className="num">{formatNum(r.ourPrice)}</td>
                  <td className="num">{formatNum(r.welkinPrice)}</td>
                  <td className="num">
                    <span className={`badge ${r.deltaPct >= 0 ? 'up' : 'down'}`}>{r.deltaPct >= 0 ? '+' : ''}{r.deltaPct.toFixed(1)}%</span>
                  </td>
                  <td className="num">{r.source === 'midea-exact' ? 'точно' : `±${r.matchDeltaPct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 400 && <div className="stat-tile-hint" style={{ marginTop: 8 }}>Показаны первые 400 из {rows.length} строк.</div>}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Hofmann Air — аналог по классу оборудования и мощности
// ---------------------------------------------------------------------------

function HofmannTab() {
  const { data, error, loading } = useReportData<HofmannComparisonReport>('/api/reports/hofmann-comparison')
  const [cls, setCls] = useState('')
  const [onlyMoreExpensive, setOnlyMoreExpensive] = useState(false)
  const [onlyStock, setOnlyStock] = useState(true)

  const rows = useMemo(() => {
    if (!data) return []
    return data.rows.filter(r =>
      (!cls || r.hofmannClass === cls) &&
      (!onlyMoreExpensive || r.weAreMoreExpensive) &&
      (!onlyStock || !r.orderOnly))
  }, [data, cls, onlyMoreExpensive, onlyStock])

  const byClass = useMemo(() => {
    const map = new Map<string, { sum: number; n: number }>()
    for (const r of rows) {
      const e = map.get(r.hofmannClass) || { sum: 0, n: 0 }
      e.sum += r.deltaPct; e.n++
      map.set(r.hofmannClass, e)
    }
    return [...map.entries()].map(([k, v]) => ({ cls: k, avg: v.sum / v.n, n: v.n })).sort((a, b) => b.avg - a.avg)
  }, [rows])

  if (loading) return <div className="reports-loading"><RefreshCw className="spin" size={20} /></div>
  if (error || !data) return <div className="reports-error">{error || 'Нет данных'}</div>

  const avg = rows.length ? rows.reduce((s, r) => s + r.deltaPct, 0) / rows.length : null
  const dearer = rows.filter(r => r.weAreMoreExpensive).length

  return (
    <>
      <div className="completeness-banner">
        <AlertTriangle size={16} />
        <span>
          Hofmann Air — другое железо, общего артикула нет: аналог подбирается по классу и ближайшей мощности (до ±20%).
          HMV Mini ↔ ATOM; HMV Slim / Flex (боковой выброс) ↔ V8 Easyfit, V6-i, V8 Mini; HMV X (вертикальный выброс) ↔ V8 Master, V8S, V6R.
          Наша цена — из прайса сайта (у некоторых фанкойлов в неё входит пульт). {data.source}
        </span>
      </div>

      <div className="stat-grid">
        <StatTile label="Сопоставлено моделей" value={String(rows.length)} hint={onlyStock ? 'только наши позиции в наличии' : 'включая «под заказ»'} />
        <StatTile label="Мы дороже" value={String(dearer)} />
        <StatTile label="Мы дешевле" value={String(rows.length - dearer)} />
        <StatTile label="Средняя дельта" value={avg !== null ? `${avg >= 0 ? '+' : ''}${avg.toFixed(1)}%` : '—'} hint="наша цена относительно Hofmann" />
      </div>

      <div className="report-filters">
        <select value={cls} onChange={e => setCls(e.target.value)}>
          <option value="">Все классы</option>
          {data.classes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="report-check">
          <input type="checkbox" checked={onlyStock} onChange={e => setOnlyStock(e.target.checked)} />
          Только наши позиции в наличии
        </label>
        <label className="report-check">
          <input type="checkbox" checked={onlyMoreExpensive} onChange={e => setOnlyMoreExpensive(e.target.checked)} />
          Только где мы дороже
        </label>
      </div>

      {!cls && byClass.length > 1 && (
        <div className="report-section">
          <h2>Средняя разница по классам</h2>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead><tr><th>Класс Hofmann</th><th className="num">Моделей</th><th className="num">Мы относительно Hofmann</th></tr></thead>
              <tbody>
                {byClass.map(b => (
                  <tr key={b.cls} className="clickable" onClick={() => setCls(b.cls)}>
                    <td>{b.cls}</td>
                    <td className="num">{b.n}</td>
                    <td className="num"><span className={`badge ${b.avg >= 0 ? 'up' : 'down'}`}>{b.avg >= 0 ? '+' : ''}{b.avg.toFixed(1)}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="report-section">
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Наша модель</th><th className="num">кВт</th><th>Аналог Hofmann</th>
                <th className="num">Наша цена, $</th><th className="num">Hofmann, $</th><th className="num">Дельта</th><th className="num">Точность</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((r, i) => (
                <tr key={i}>
                  <td>{r.model}{r.orderOnly && <span className="badge unlinked">под заказ</span>}</td>
                  <td className="num">{r.ourKw}</td>
                  <td>{r.hofmannModel}</td>
                  <td className="num">{formatNum(r.ourPrice)}</td>
                  <td className="num">{formatNum(r.hofmannPrice)}</td>
                  <td className="num"><span className={`badge ${r.deltaPct >= 0 ? 'up' : 'down'}`}>{r.deltaPct >= 0 ? '+' : ''}{r.deltaPct.toFixed(1)}%</span></td>
                  <td className="num">{r.matchDeltaPct === 0 ? 'тот же кВт' : `±${r.matchDeltaPct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Midea (завод) — сравнение с текущим прайсом производителя
// ---------------------------------------------------------------------------

function MideaCacTab() {
  const { data, error, loading } = useReportData<MideaCacComparisonReport>('/api/reports/midea-cac-comparison')
  const [onlyMoreExpensive, setOnlyMoreExpensive] = useState(false)

  const rows = useMemo(() => {
    if (!data) return []
    return onlyMoreExpensive ? data.rows.filter(r => r.weAreMoreExpensive) : data.rows
  }, [data, onlyMoreExpensive])

  if (loading) return <div className="reports-loading"><RefreshCw className="spin" size={20} /></div>
  if (error || !data) return <div className="reports-error">{error || 'Нет данных'}</div>

  return (
    <>
      <div className="completeness-banner">
        <AlertTriangle size={16} />
        Текущий прайс завода Midea (лист «Midea CAC на СКЛАДЕ») — тот же бренд, точное совпадение по артикулу.
        Не путать со «Старой ценой» (вкладка «Прайс») — это отдельный статичный прайс-лист от 03.08.2026, а здесь —
        текущий, из той же таблицы, что и Welkin. Только позиции «в наличии».
      </div>

      <div className="stat-grid">
        <StatTile label="Сопоставлено моделей" value={String(data.matchedCount)} />
        <StatTile label="Мы дороже" value={String(data.weAreMoreExpensiveCount)} />
        <StatTile label="Мы дешевле" value={String(data.weAreCheaperCount)} />
        <StatTile label="Средняя дельта" value={data.avgDeltaPct !== null ? `${data.avgDeltaPct >= 0 ? '+' : ''}${data.avgDeltaPct.toFixed(1)}%` : '—'} hint="наша цена относительно завода" />
      </div>

      <div className="report-filters">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={onlyMoreExpensive} onChange={e => setOnlyMoreExpensive(e.target.checked)} />
          Только где мы дороже
        </label>
      </div>

      <div className="report-section">
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Модель</th><th>Категория</th><th className="num">Наша цена, $</th><th className="num">Midea, $</th><th className="num">Дельта</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 400).map((r, i) => (
                <tr key={i}>
                  <td>{r.model}</td>
                  <td>{r.category}</td>
                  <td className="num">{formatNum(r.ourPrice)}</td>
                  <td className="num">{formatNum(r.mideaPrice)}</td>
                  <td className="num">
                    <span className={`badge ${r.deltaPct >= 0 ? 'up' : 'down'}`}>{r.deltaPct >= 0 ? '+' : ''}{r.deltaPct.toFixed(1)}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 400 && <div className="stat-tile-hint" style={{ marginTop: 8 }}>Показаны первые 400 из {rows.length} строк.</div>}
        </div>
      </div>
    </>
  )
}
