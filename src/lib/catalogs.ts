import catalogSourcesData from '@/data/catalog-sources.json'
import catalogPagesData from '@/data/catalog-pages.json'

export interface CatalogSource {
  title: string
  filename: string
  description: string
  driveFileId?: string
}

export interface CatalogMatch {
  catalogKey: string
  page: number
  matchedTerm: string
  matchedModel: string
}

type CatalogPagesFile = {
  generatedAt: string | null
  catalogsDir: string | null
  coverage: { totalProducts: number; matchedProducts: number }
  products: Record<string, CatalogMatch>
}

export const catalogSources = catalogSourcesData as Record<string, CatalogSource>
export const catalogPages = catalogPagesData as CatalogPagesFile

export function getCatalogSource(key: string | undefined): CatalogSource | null {
  if (!key) return null
  return catalogSources[key] || null
}

export function getCatalogDriveUrl(key: string | undefined): string | null {
  if (!key) return null
  const source = catalogSources[key]
  if (source?.driveFileId) {
    return `https://drive.google.com/file/d/${source.driveFileId}/view`
  }
  return null
}

export function getCatalogMatch(productId: string): CatalogMatch | null {
  return catalogPages.products?.[productId] || null
}

export function getCatalogPdfUrl(catalogKey: string, page?: number | null) {
  const base = `/api/catalogs/${encodeURIComponent(catalogKey)}`
  return page ? `${base}#page=${page}` : base
}

export function inferCatalogKey(product: { category?: string; series?: string; model?: string }) {
  const hay = `${product.category || ''} ${product.series || ''} ${product.model || ''}`.toLowerCase()
  if (hay.includes('фанкойл') || /\bmk[athdgkc]/i.test(product.model || '')) return 'fcu-2026'
  if (hay.includes('чиллер') || hay.includes('теплов') || /\bmc-|^mh[ac]-/i.test(product.model || '')) return 'chiller-2026'
  if (hay.includes('atom b') || hay.includes('(atb)')) return 'atom-b-2026'
  if (hay.includes('atom') || hay.includes('(at)')) return 'atom-2026'
  if (hay.includes('vrf') || hay.includes('v8') || /\b(mv|mi|mvc|fqz|ahu|tc|ccm|wdc)/i.test(product.model || '')) return 'vrf-2026'
  return null
}
