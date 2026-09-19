import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..', '..')
const productsPath = path.join(root, 'src', 'data', 'products.json')
const sourcesPath = path.join(root, 'src', 'data', 'catalog-sources.json')
const outputPath = path.join(root, 'src', 'data', 'catalog-pages.json')
const catalogsDir = process.env.CATALOGS_DIR || '/Users/muhammadjonaka/MN OG MAC v/каталоги'

const CYR_TO_LAT = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
}

function normalize(value) {
  return String(value || '')
    .replace(/[АВЕКМНОРСТУХавекмнорстух]/g, ch => CYR_TO_LAT[ch] || ch)
    .replace(/[‐‑‒–—−]/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))]
}

function modelTerms(model) {
  const rawParts = String(model || '').split(/\s+\+\s+/).map(s => s.trim()).filter(Boolean)
  const terms = []
  for (const part of rawParts.length ? rawParts : [model]) {
    const noMidea = part.replace(/^midea-/i, '')
    const noParens = part.replace(/\([^)]*\)/g, '')
    const noMideaNoParens = noMidea.replace(/\([^)]*\)/g, '')
    terms.push(part, noMidea, noParens, noMideaNoParens)
  }
  return uniq(terms.map(normalize).filter(t => t.length >= 5)).sort((a, b) => b.length - a.length)
}

function splitModelTerm(term) {
  const match = term.match(/^(.+?)([rm]?\d{2,4}(?:wv|wd|rn|q|t|g|f|r|h|su|ss|v).*)$/i)
  if (!match) return null
  const prefix = match[1]
  const suffix = match[2]
  if (prefix.length < 2 || suffix.length < 5) return null
  return { prefix, suffix }
}

function modelSearchPatterns(model) {
  const terms = modelTerms(model)
  const exact = terms.map(term => ({ kind: 'exact', term }))
  const split = []
  for (const term of terms) {
    const parts = splitModelTerm(term)
    if (parts) split.push({ kind: 'split', term: `${parts.prefix}+${parts.suffix}`, ...parts })
  }
  return [...exact, ...uniq(split.map(x => JSON.stringify(x))).map(x => JSON.parse(x))]
}

function findPatternOnPages(pages, pattern) {
  if (pattern.kind === 'exact') {
    return pages.find(p => p.text.includes(pattern.term)) || null
  }
  return pages.find(p => p.text.includes(pattern.prefix) && p.text.includes(pattern.suffix)) || null
}

function preferredCatalogKeys(product, allKeys) {
  const hay = `${product.category || ''} ${product.series || ''} ${product.model || ''}`.toLowerCase()
  const model = product.model || ''
  if (hay.includes('фанкойл') || /^mk[athdgkc]/i.test(model)) return ['fcu-2026', ...allKeys]
  if (hay.includes('чиллер') || hay.includes('теплов') || /^mc-/i.test(model) || /^mh[ac]-/i.test(model)) return ['chiller-2026', ...allKeys]
  if (hay.includes('atom b') || hay.includes('(atb)')) return ['atom-b-2026', 'atom-2026', 'vrf-2026', ...allKeys]
  if (hay.includes('atom') || hay.includes('(at)')) return ['atom-2026', 'atom-b-2026', 'vrf-2026', ...allKeys]
  if (hay.includes('vrf') || hay.includes('v8') || /^(mv|mi|mvc|fqz|ahu|tc|ccm|wdc)/i.test(model)) return ['vrf-2026', 'atom-2026', 'atom-b-2026', ...allKeys]
  return allKeys
}

function pageCount(pdfPath) {
  const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' })
  const match = info.match(/^Pages:\s+(\d+)/m)
  if (!match) throw new Error(`Cannot read page count: ${pdfPath}`)
  return Number(match[1])
}

function extractPages(key, source) {
  const pdfPath = path.join(catalogsDir, source.filename)
  if (!fs.existsSync(pdfPath)) {
    console.warn(`[skip] PDF not found: ${pdfPath}`)
    return []
  }
  const count = pageCount(pdfPath)
  const pages = []
  for (let page = 1; page <= count; page++) {
    const text = execFileSync('pdftotext', ['-layout', '-f', String(page), '-l', String(page), pdfPath, '-'], {
      encoding: 'utf8',
      maxBuffer: 12 * 1024 * 1024,
    })
    pages.push({ page, text: normalize(text) })
  }
  console.log(`[index] ${key}: ${count} pages`)
  return pages
}

const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'))
const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'))
const sourceKeys = Object.keys(sources)
const indexed = Object.fromEntries(sourceKeys.map(key => [key, extractPages(key, sources[key])]))

const cleanProducts = products.filter(p => p.id && p.model && Number(p.price) > 0 && !String(p.id).startsWith('---'))
const matches = {}

for (const product of cleanProducts) {
  const patterns = modelSearchPatterns(product.model)
  if (patterns.length === 0) continue
  const candidates = uniq(preferredCatalogKeys(product, sourceKeys)).filter(key => indexed[key]?.length)

  let found = null
  for (const key of candidates) {
    for (const pattern of patterns) {
      const page = findPatternOnPages(indexed[key], pattern)
      if (page) {
        found = { catalogKey: key, page: page.page, matchedTerm: pattern.term, matchedModel: product.model }
        break
      }
    }
    if (found) break
  }

  if (found) matches[product.id] = found
}

const output = {
  generatedAt: new Date().toISOString(),
  catalogsDir,
  coverage: {
    totalProducts: cleanProducts.length,
    matchedProducts: Object.keys(matches).length,
  },
  products: matches,
}

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n')
console.log(`[done] matched ${output.coverage.matchedProducts}/${output.coverage.totalProducts} products`)
