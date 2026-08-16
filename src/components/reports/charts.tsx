'use client'

import { useState } from 'react'
import { formatNum } from '@/lib/format'

/**
 * Лёгкие SVG-графики без внешней чарт-библиотеки — датасеты маленькие
 * (десятки точек), а в проекте нет ни одной другой чарт-зависимости.
 * Один акцентный цвет (--accent), «Не указано» — приглушённый серый:
 * это статус нехватки данных, а не отдельная категория.
 */

const MUTED_KEY = 'Не указано'

interface Point { label: string; value: number }

function Tooltip({ x, y, label, value }: { x: number; y: number; label: string; value: string }) {
  return (
    <g transform={`translate(${x}, ${y})`} pointerEvents="none">
      <rect x={-1} y={-34} width={Math.max(70, label.length * 6.4 + 20)} height={28} rx={6} fill="var(--text)" opacity={0.94} />
      <text x={9} y={-19} fontSize={11} fill="#fff" fontWeight={600}>{label}</text>
      <text x={9} y={-8} fontSize={10} fill="#cbd6e2">{value}</text>
    </g>
  )
}

/** Столбики по времени/категориям слева направо (по месяцам продаж). */
export function ColumnChart({ data, height = 180, valueSuffix = '' }: { data: Point[]; height?: number; valueSuffix?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!data.length) return <div className="chart-empty">Нет данных</div>

  const max = Math.max(...data.map(d => d.value), 1)
  const barSlot = Math.min(48, 640 / data.length)
  const barWidth = Math.min(24, barSlot - 6)
  const width = data.length * barSlot + 16
  const chartH = height - 28

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} className="report-chart">
      <line x1={8} y1={chartH} x2={width - 8} y2={chartH} stroke="var(--border-strong)" strokeWidth={1} />
      {[0.5, 1].map(f => (
        <line key={f} x1={8} y1={chartH - chartH * f} x2={width - 8} y2={chartH - chartH * f} stroke="var(--border)" strokeWidth={1} />
      ))}
      {data.map((d, i) => {
        const h = max > 0 ? (d.value / max) * (chartH - 8) : 0
        const x = 8 + i * barSlot + (barSlot - barWidth) / 2
        const y = chartH - h
        const muted = d.label === MUTED_KEY
        return (
          <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={x} y={y} width={barWidth} height={Math.max(h, 2)} rx={4}
              fill={muted ? 'var(--border-strong)' : 'var(--accent)'}
              opacity={hover === null || hover === i ? 1 : 0.45} />
            <rect x={x - 2} y={0} width={barWidth + 4} height={chartH} fill="transparent" />
            <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
              {d.label.length > 8 ? d.label.slice(0, 7) + '…' : d.label}
            </text>
            {hover === i && <Tooltip x={x + barWidth / 2} y={y} label={d.label} value={`${formatNum(d.value)}${valueSuffix}`} />}
          </g>
        )
      })}
    </svg>
  )
}

/** Горизонтальные бары — для рейтингов (по менеджерам/категориям/клиентам), где подписи разной длины. */
export function RankingBars({ data, valueSuffix = '', maxItems = 8 }: { data: Point[]; valueSuffix?: string; maxItems?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const items = data.slice(0, maxItems)
  if (!items.length) return <div className="chart-empty">Нет данных</div>

  const max = Math.max(...items.map(d => d.value), 1)
  const rowH = 28
  const height = items.length * rowH + 8
  const labelW = 128
  const trackW = 420

  return (
    <svg viewBox={`0 0 ${labelW + trackW + 60} ${height}`} width="100%" height={height} className="report-chart">
      {items.map((d, i) => {
        const w = max > 0 ? (d.value / max) * trackW : 0
        const y = i * rowH
        const muted = d.label === MUTED_KEY
        return (
          <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <text x={labelW - 8} y={y + 17} textAnchor="end" fontSize={12} fill="var(--text-secondary)">
              {d.label.length > 20 ? d.label.slice(0, 19) + '…' : d.label}
            </text>
            <rect x={labelW} y={y + 4} width={Math.max(w, 3)} height={16} rx={4}
              fill={muted ? 'var(--border-strong)' : 'var(--accent)'}
              opacity={hover === null || hover === i ? 1 : 0.45} />
            <rect x={labelW} y={y} width={trackW} height={rowH} fill="transparent" />
            <text x={labelW + Math.max(w, 3) + 8} y={y + 17} fontSize={12} fontWeight={600} fill="var(--text)">
              {formatNum(d.value)}{valueSuffix}
            </text>
            {hover === i && <Tooltip x={labelW + Math.max(w, 3) / 2} y={y + 4} label={d.label} value={`${formatNum(d.value)}${valueSuffix}`} />}
          </g>
        )
      })}
    </svg>
  )
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-label">{label}</div>
      <div className="stat-tile-value">{value}</div>
      {hint && <div className="stat-tile-hint">{hint}</div>}
    </div>
  )
}
