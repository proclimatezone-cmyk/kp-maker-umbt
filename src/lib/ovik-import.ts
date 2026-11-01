// Приём спецификации из OVIK (проектирование ОВиК, ovik-by-mn.vercel.app).
// OVIK открывает КП-мейкер по ссылке вида https://kp-maker-umbt.vercel.app/#ovik=<base64url JSON>.
// Ссылка может сначала попасть на /login (нет входа) — поэтому список сразу кладём в localStorage
// и подхватываем на главной после входа. Дальше — тот же экран проверки, что у импорта .docx/.pdf.
import { normalizeModel } from '@/lib/reports/parse-utils'

const KEY = 'ovik-import'

export interface OvikPayload {
  v: 1
  source: 'ovik'
  project: string
  items: { model: string; quantity: number; name?: string }[]
}

function b64urlDecode(s: string): string {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  return decodeURIComponent(Array.from(b, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''))
}

/** Если открыли по ссылке из OVIK — сохранить список и убрать его из адреса. */
export function captureOvikHash() {
  if (typeof window === 'undefined') return
  const m = window.location.hash.match(/^#ovik=([A-Za-z0-9_-]+)$/)
  if (!m) return
  try {
    const p = JSON.parse(b64urlDecode(m[1])) as OvikPayload
    if (p?.source === 'ovik' && Array.isArray(p.items)) localStorage.setItem(KEY, JSON.stringify({ ...p, at: Date.now() }))
  } catch { /* битая ссылка — просто игнорируем */ }
  history.replaceState(null, '', window.location.pathname + window.location.search)
}

/** Забрать список (один раз) и сопоставить модели с прайсом. Ссылка старше суток не подхватывается. */
export function takeOvikImport(products: { id: string; model: string }[]) {
  if (typeof window === 'undefined') return null
  let p: (OvikPayload & { at?: number }) | null = null
  try { p = JSON.parse(localStorage.getItem(KEY) || 'null') } catch { p = null }
  localStorage.removeItem(KEY)
  if (!p || (p.at && Date.now() - p.at > 86400000)) return null
  const byKey = new Map(products.map(x => [normalizeModel(x.model), x]))
  const items: { productId: string; model: string; quantity: number }[] = []
  const missing: { model: string; quantity: number; name?: string }[] = []
  for (const it of p.items) {
    const hit = byKey.get(normalizeModel(it.model))
    const q = Math.max(1, Math.round(Number(it.quantity) || 1))
    if (hit) {
      const same = items.find(x => x.productId === hit.id)
      if (same) same.quantity += q; else items.push({ productId: hit.id, model: hit.model, quantity: q })
    } else missing.push({ model: it.model, quantity: q, name: it.name })
  }
  return { cpNumber: '', cpDate: '', client: p.project || '', items, confidentCount: items.length, uncertainCount: 0, missing, fromOvik: true }
}
