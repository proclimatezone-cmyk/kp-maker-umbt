'use client'

import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import { Copy } from 'lucide-react'

/**
 * Поиск модели по вводу текста вместо длинного нативного <select> —
 * общий компонент для главной страницы и «Подбора» (раньше был только
 * внутри page.tsx, продублировать пришлось бы весь портал/позиционирование
 * заново). Список рендерится порталом в document.body — строка часто
 * живёт в горизонтально скроллящейся таблице/карточке, обычный
 * position:absolute обрезался бы её границами.
 */

export interface ModelOption {
  id: string
  model: string
  series?: string | null
  category?: string | null
  orderOnly?: boolean
}

export const ModelSearchSelector = memo(({ value, onChange, options, allOptions, placeholder }: {
  value: string
  onChange: (val: string) => void
  /** Список для выпадашки — уже отфильтрованный (например, по тумблеру «под заказ»). */
  options: ModelOption[]
  /** Полный список без фильтра — чтобы уже выбранная позиция не пропадала из инпута,
   *  если тумблер её скрывает из поиска. По умолчанию — тот же options. */
  allOptions?: ModelOption[]
  placeholder?: string
}) => {
  const all = allOptions || options
  const currentProduct = all.find(p => p.id === value)
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const [dropdownRect, setDropdownRect] = useState<{ left: number; top: number; width: number; openUp: boolean } | null>(null)

  useEffect(() => {
    if (currentProduct) setQuery(currentProduct.model)
  }, [currentProduct])

  const updatePosition = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const maxDropdownHeight = 240
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < maxDropdownHeight && rect.top > spaceBelow
    setDropdownRect({ left: rect.left, top: openUp ? rect.top : rect.bottom, width: rect.width, openUp })
  }, [])

  useEffect(() => {
    if (!isOpen) return
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [isOpen, updatePosition])

  const filtered = useMemo(() => {
    if (!query) return options.slice(0, 50)
    const q = query.toLowerCase()
    return options.filter(p =>
      p.model.toLowerCase().includes(q) ||
      (p.series || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    ).slice(0, 50)
  }, [query, options])

  return (
    <div className="model-selector-container" style={{ position: 'relative' }} ref={containerRef}>
      <input
        className="model-search-input"
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setIsOpen(true) }}
        onFocus={() => { setIsOpen(true); setQuery('') }}
        onBlur={() => {
          setTimeout(() => {
            setIsOpen(false)
            if (currentProduct) setQuery(currentProduct.model)
          }, 200)
        }}
        placeholder={placeholder || 'Поиск модели...'}
        style={{ paddingRight: '2.2rem' }}
      />
      {currentProduct && !isOpen && (
        <button
          onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(currentProduct.model) }}
          title="Копировать название модели"
          className="copy-btn"
        >
          <Copy size={13} />
        </button>
      )}
      {isOpen && dropdownRect && typeof document !== 'undefined' && createPortal(
        <div
          className="model-selector-dropdown"
          style={{
            position: 'fixed',
            left: dropdownRect.left,
            width: dropdownRect.width,
            top: dropdownRect.openUp ? undefined : dropdownRect.top + 3,
            bottom: dropdownRect.openUp ? window.innerHeight - dropdownRect.top + 3 : undefined,
          }}
        >
          {filtered.length === 0 ? (
            <div className="dropdown-no-results">Ничего не найдено</div>
          ) : (
            filtered.map(p => (
              <div
                key={p.id}
                className="dropdown-item"
                onMouseDown={() => { onChange(p.id); setQuery(p.model); setIsOpen(false) }}
              >
                <div className="dropdown-item-model">
                  {p.model}
                  {p.orderOnly && <span className="order-only-badge">под заказ</span>}
                </div>
                <div className="dropdown-item-meta">{p.series || p.category}</div>
              </div>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  )
})
ModelSearchSelector.displayName = 'ModelSearchSelector'
