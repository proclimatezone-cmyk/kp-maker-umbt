import Link from 'next/link'
import { notFound } from 'next/navigation'
import productsData from '@/data/products.json'
import { formatNum } from '@/lib/format'
import { getCatalogMatch, getCatalogPdfUrl, getCatalogSource, inferCatalogKey } from '@/lib/catalogs'
import { resolveProductImage } from '@/lib/product-images'
import {
  ArrowLeft, BookOpen, ExternalLink, FileText, CheckCircle2,
  Zap, Flame, Snowflake, Maximize2, Wind, Volume2,
  Box, Scale, Activity, ShieldCheck, Tag, Info
} from 'lucide-react'

interface Product {
  id: string
  category?: string
  series?: string
  name?: string
  model?: string
  price?: number
  image?: string
  driveImage?: string
  coolingCapacity?: number
  heatingCapacity?: number
  recommendedArea?: number
  powerConsumption?: number
  airflow?: string
  noiseLevel?: string
  dimensions?: string
  weight?: number
  liquidPipe?: string
  gasPipe?: string
  powerSupply?: string
  refrigerant?: string
  descHeader?: string
  description?: string
  specs?: string
  orderOnly?: boolean
}

export default async function EquipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = (productsData as Product[]).find(p => p.id === decodeURIComponent(id))
  if (!product) notFound()

  const match = getCatalogMatch(product.id)
  const fallbackKey = inferCatalogKey(product)
  const catalogKey = match?.catalogKey || fallbackKey
  const catalog = getCatalogSource(catalogKey || undefined)
  const pdfUrl = catalogKey ? getCatalogPdfUrl(catalogKey, match?.page) : null
  const image = resolveProductImage(product)

  // Primary highlight metrics
  const keyMetrics = [
    {
      icon: <Snowflake size={20} className="metric-icon cool" />,
      label: 'Охлаждение',
      value: product.coolingCapacity ? `${product.coolingCapacity} кВт` : null,
    },
    {
      icon: <Flame size={20} className="metric-icon heat" />,
      label: 'Обогрев',
      value: product.heatingCapacity ? `${product.heatingCapacity} кВт` : null,
    },
    {
      icon: <Maximize2 size={20} className="metric-icon area" />,
      label: 'Площадь помещения',
      value: product.recommendedArea ? `до ${product.recommendedArea} м²` : null,
    },
    {
      icon: <Zap size={20} className="metric-icon power" />,
      label: 'Потребляемая мощность',
      value: product.powerConsumption ? `${product.powerConsumption} кВт` : null,
    },
  ].filter(m => Boolean(m.value))

  // Detailed technical parameters table
  const techSpecs = [
    { label: 'Холодопроизводительность', val: product.coolingCapacity, unit: 'кВт' },
    { label: 'Теплопроизводительность', val: product.heatingCapacity, unit: 'кВт' },
    { label: 'Рекомендуемая площадь', val: product.recommendedArea, unit: 'м²' },
    { label: 'Потребляемая мощность', val: product.powerConsumption, unit: 'кВт' },
    { label: 'Расход воздуха', val: product.airflow, unit: product.airflow ? 'м³/ч' : '' },
    { label: 'Уровень звукового давления (шум)', val: product.noiseLevel, unit: product.noiseLevel ? 'дБ(А)' : '' },
    { label: 'Габаритные размеры (Ш × В × Г)', val: product.dimensions, unit: product.dimensions ? 'мм' : '' },
    { label: 'Масса нетто (вес)', val: product.weight, unit: product.weight ? 'кг' : '' },
    { label: 'Диаметр жидкостной трубы', val: product.liquidPipe, unit: product.liquidPipe ? 'мм' : '' },
    { label: 'Диаметр газовой трубы', val: product.gasPipe, unit: product.gasPipe ? 'мм' : '' },
    { label: 'Электропитание', val: product.powerSupply, unit: '' },
    { label: 'Хладагент (фреон)', val: product.refrigerant, unit: '' },
    { label: 'Ориентировочная цена из базы', val: product.price ? `${formatNum(product.price)} у.е.` : null, unit: '' },
    { label: 'Статус доступности', val: product.orderOnly ? 'Под заказ (срок поставки уточняется)' : 'В наличии / основной прайс', unit: '' },
  ].filter(item => item.val !== null && item.val !== undefined && String(item.val).trim() !== '' && String(item.val) !== '0')

  return (
    <>
      <header className="topbar equipment-topbar">
        <div className="topbar-inner">
          <Link className="topbar-brand equipment-brand" href="/">
            <img src="/images/branding/logo_umbt.jpg" alt="UMBT" />
            <span>KP Maker</span>
          </Link>
          <div className="topbar-actions">
            <Link className="btn btn-ghost" href="/">
              <ArrowLeft size={16} />
              Вернуться в КП
            </Link>
            {pdfUrl && (
              <a className="btn btn-primary" href={pdfUrl} target="_blank" rel="noreferrer">
                <BookOpen size={16} />
                Сверить с каталогом {match?.page ? `(стр. ${match.page})` : ''}
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="page equipment-page">
        {/* HERO SECTION */}
        <section className="equipment-hero">
          <div className="equipment-photo">
            <img
              src={image}
              alt={product.model || 'Оборудование Midea'}
              loading="eager"
            />
          </div>
          <div className="equipment-summary">
            <div className="equipment-kicker-row">
              <span className="equipment-kicker">{product.series || product.category || 'Midea Clima'}</span>
              {product.orderOnly ? (
                <span className="order-only-badge">под заказ</span>
              ) : (
                <span className="stock-tag ok">
                  <CheckCircle2 size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                  в прайс-листе
                </span>
              )}
            </div>

            <h1>{product.model}</h1>
            <p className="equipment-subtitle">{product.category || product.name}</p>

            {/* QUICK KEY METRICS CHIPS */}
            {keyMetrics.length > 0 && (
              <div className="equipment-metrics-grid">
                {keyMetrics.map((m, idx) => (
                  <div key={idx} className="metric-chip">
                    {m.icon}
                    <div>
                      <div className="metric-chip-label">{m.label}</div>
                      <div className="metric-chip-val">{m.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ACTION BUTTON TO VERIFY WITH PDF CATALOG */}
            <div className="equipment-actions" style={{ marginTop: '1.25rem' }}>
              {pdfUrl ? (
                <a className="btn btn-primary" href={pdfUrl} target="_blank" rel="noreferrer">
                  <BookOpen size={16} />
                  Сверить с каталогом {match?.page ? `(стр. ${match.page})` : ''}
                </a>
              ) : (
                <span className="notice-inline">Официальный каталог Midea 2026</span>
              )}
            </div>
          </div>
        </section>

        {/* FULL TECHNICAL SPECIFICATIONS TABLE */}
        <section className="section">
          <div className="section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Activity size={18} style={{ color: 'var(--accent)' }} />
              <h2>Технические характеристики</h2>
            </div>
            {match?.page && (
              <span className="count-pill">
                Каталог: стр. {match.page}
              </span>
            )}
          </div>

          <div className="equipment-specs-card">
            <table className="specs-table">
              <tbody>
                {techSpecs.map((item, i) => (
                  <tr key={i}>
                    <td className="spec-name">{item.label}</td>
                    <td className="spec-val">
                      <strong>{item.val}</strong> {item.unit && <span className="spec-unit">{item.unit}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* DESCRIPTION / HIGHLIGHTS SECTION IF AVAILABLE */}
        {(product.descHeader || product.description) && (
          <section className="section">
            <div className="section-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Info size={18} style={{ color: 'var(--accent)' }} />
                <h2>Описание и особенности модели</h2>
              </div>
            </div>
            <div className="equipment-desc-card">
              {product.descHeader && <h3 className="equipment-desc-header">{product.descHeader}</h3>}
              {product.description && <p className="equipment-desc-body">{product.description}</p>}
            </div>
          </section>
        )}
      </main>
    </>
  )
}
