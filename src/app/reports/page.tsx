'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import { formatNum } from '@/lib/format'
import { ColumnChart, RankingBars, StatTile } from '@/components/reports/charts'
import type { SalesReport, SaleRecord } from '@/lib/reports/sales'
import type { BookingsReport } from '@/lib/reports/bookings'
import type { PriceComparisonReport } from '@/lib/reports/price-comparison'
import './reports.css'

type Tab = 'sales' | 'bookings' | 'price'

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
        <button className={`reports-tab ${tab === 'sales' ? 'active' : ''}`} onClick={() => setTab('sales')}>Продажи</button>
        <button className={`reports-tab ${tab === 'bookings' ? 'active' : ''}`} onClick={() => setTab('bookings')}>Бронь</button>
        <button className={`reports-tab ${tab === 'price' ? 'active' : ''}`} onClick={() => setTab('price')}>Прайс</button>
      </div>

      {tab === 'sales' && <SalesTab />}
      {tab === 'bookings' && <BookingsTab />}
      {tab === 'price' && <PriceTab />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Продажи
// ---------------------------------------------------------------------------

function SalesTab() {
  const { data, error, loading } = useReportData<SalesReport>('/api/reports/sales')
  const [month, setMonth] = useState('')
  const [manager, setManager] = useState('')
  const [category, setCategory] = useState('')

  const months = useMemo(() => data ? [...new Set(data.records.map(r => r.monthKey).filter(Boolean))].sort() as string[] : [], [data])
  const managers = useMemo(() => data ? [...new Set(data.records.map(r => r.manager).filter(Boolean))].sort() as string[] : [], [data])
  const categories = useMemo(() => data ? [...new Set(data.records.map(r => r.category))].sort() : [], [data])

  const filtered = useMemo(() => {
    if (!data) return []
    return data.records.filter(r =>
      (!month || r.monthKey === month) &&
      (!manager || r.manager === manager) &&
      (!category || r.category === category)
    )
  }, [data, month, manager, category])

  const filteredTotalQty = useMemo(() => filtered.reduce((s, r) => s + r.qty, 0), [filtered])

  const byMonth = useMemo(() => aggregate(filtered, r => r.monthKey || 'Не указано')
    .sort((a, b) => (a.key === 'Не указано' ? 1 : b.key === 'Не указано' ? -1 : a.key.localeCompare(b.key))), [filtered])
  const byManager = useMemo(() => aggregate(filtered, r => r.manager || 'Не указано').sort((a, b) => b.value - a.value), [filtered])
  const byCategory = useMemo(() => aggregate(filtered, r => r.category).sort((a, b) => b.value - a.value), [filtered])

  if (loading) return <div className="reports-loading"><RefreshCw className="spin" size={20} /></div>
  if (error || !data) return <div className="reports-error">{error || 'Нет данных'}</div>

  const ratio = Math.round(data.completeness.ratio * 100)

  return (
    <>
      <div className={`completeness-banner ${ratio >= 90 ? 'ok' : ''}`}>
        {ratio >= 90 ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
        {data.completeness.linked} из {data.completeness.total} заказов привязаны к дате и менеджеру (реестр «Объекты» в таблице) — {ratio}%.
        {ratio < 90 && ' Остальные показаны в группе «Не указано»: чтобы они попали в разбивку по месяцам/менеджерам, дозаполните реестр «Объекты».'}
      </div>

      <div className="stat-grid">
        <StatTile label="Продано штук (всего)" value={formatNum(data.totals.qty)} />
        <StatTile label="Продано штук (привязано)" value={formatNum(data.totals.linkedQty)} hint={`${Math.round((data.totals.linkedQty / (data.totals.qty || 1)) * 100)}% от всех`} />
        <StatTile label="По текущему фильтру" value={formatNum(filteredTotalQty)} />
        <StatTile label="Категорий" value={String(data.byCategory.length)} />
      </div>

      <div className="report-filters">
        <select value={month} onChange={e => setMonth(e.target.value)}>
          <option value="">Все месяцы</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={manager} onChange={e => setManager(e.target.value)}>
          <option value="">Все менеджеры</option>
          {managers.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">Все категории</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="report-section">
        <h2>Продажи по месяцам</h2>
        <ColumnChart data={byMonth.map(d => ({ label: d.key, value: d.value }))} valueSuffix=" шт" />
      </div>

      <div className="report-grid-2">
        <div className="report-section">
          <h2>По менеджерам</h2>
          <RankingBars data={byManager.map(d => ({ label: d.key, value: d.value }))} valueSuffix=" шт" />
        </div>
        <div className="report-section">
          <h2>По категориям</h2>
          <RankingBars data={byCategory.map(d => ({ label: d.key, value: d.value }))} valueSuffix=" шт" />
        </div>
      </div>

      <div className="report-section">
        <h2>Заказы ({filtered.length})</h2>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Заказ</th><th>Дата</th><th>Менеджер</th><th>Категория</th><th>Модель</th><th className="num">Кол-во</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 300).map((r, i) => (
                <tr key={i}>
                  <td>{r.orderCode}</td>
                  <td>{r.date || <span className="badge unlinked">нет даты</span>}</td>
                  <td>{r.manager || <span className="badge unlinked">не указан</span>}</td>
                  <td>{r.category}</td>
                  <td>{r.model}</td>
                  <td className="num">{formatNum(r.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 300 && <div className="stat-tile-hint" style={{ marginTop: 8 }}>Показаны первые 300 из {filtered.length} строк — сузьте фильтр.</div>}
        </div>
      </div>
    </>
  )
}

function aggregate(records: SaleRecord[], keyFn: (r: SaleRecord) => string) {
  const map = new Map<string, number>()
  for (const r of records) map.set(keyFn(r), (map.get(keyFn(r)) || 0) + r.qty)
  return [...map.entries()].map(([key, value]) => ({ key, value }))
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
