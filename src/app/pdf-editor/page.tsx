'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as MuPDF from 'mupdf'
import {
  ArrowLeft, Upload, Download, MousePointer2, Type, Square, Circle, Minus, Eraser, Highlighter,
  ImagePlus, FilePlus2, FileInput, Trash2, Copy, RotateCw, ChevronUp, ChevronDown, Undo2, Redo2,
  ZoomIn, ZoomOut, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, BringToFront,
  SendToBack, Loader2, Replace, Eye, EyeOff,
} from 'lucide-react'
import { exportPdf } from '@/lib/pdf-editor/export'
import { derivePage, extractImageRgba, extractItems, pageInfo, renderPage, type Mu, type SourceItem } from '@/lib/pdf-editor/engine'
import {
  ASCENT, FONTS, textBoxHeight, viewSize, wrapText,
  type EditorImage, type EditorObj, type EditorPage, type FontFamily, type TextObj,
} from '@/lib/pdf-editor/types'
import './pdf-editor.css'

type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'line' | 'whiteout' | 'highlight'
type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'start' | 'end'

const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-5)
const A4 = { w: 595.28, h: 841.89 }
const MIN = 4

/* ------------------------------------------------------------------ */
/* MuPDF: грузится в рантайме из /mupdf (WASM), мимо бандлера           */

let muPromise: Promise<Mu> | null = null
function loadMu(): Promise<Mu> {
  if (!muPromise) muPromise = (new Function('u', 'return import(u)') as (u: string) => Promise<Mu>)('/mupdf/mupdf.js')
  return muPromise
}

interface Derived { doc: MuPDF.PDFDocument; page: MuPDF.PDFPage; items?: SourceItem[] }
const derivedCache = new Map<string, Derived>()
const derivedKey = (p: EditorPage) => `${p.srcId}|${p.srcIndex}|${p.rotation}|${JSON.stringify(p.removed)}`
function getDerived(mu: Mu, bytes: Uint8Array, p: EditorPage): Derived {
  const k = derivedKey(p)
  let d = derivedCache.get(k)
  if (!d) {
    d = derivePage(mu, bytes, p.srcIndex, p.rotation, p.removed)
    derivedCache.set(k, d)
    if (derivedCache.size > 40) {
      const [oldK, old] = derivedCache.entries().next().value as [string, Derived]
      derivedCache.delete(oldK)
      try { old.page.destroy(); old.doc.destroy() } catch { /* уже освобождён */ }
    }
  }
  return d
}

/* ------------------------------------------------------------------ */
/* Текст: измерение тем же шрифтом, что и при экспорте                  */

const measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d')! : null
function fontCss(o: Pick<TextObj, 'family' | 'bold' | 'italic' | 'size'>) {
  return `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.size}px ${FONTS[o.family]?.css || FONTS['dejavu-sans'].css}`
}
function measurer(o: Pick<TextObj, 'family' | 'bold' | 'italic' | 'size'>) {
  measureCtx!.font = fontCss(o)
  return (s: string) => measureCtx!.measureText(s).width
}
const layoutText = (o: TextObj) => wrapText(o.text, o.w + 0.5, measurer(o))
/** Высота блока по фактическому числу строк. */
const fitText = (o: TextObj): TextObj => ({ ...o, h: textBoxHeight(layoutText(o).length, o.size, o.lineHeight) })

function rgbaToPng(px: { data: Uint8ClampedArray; w: number; h: number }) {
  const cv = document.createElement('canvas')
  cv.width = px.w; cv.height = px.h
  cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.w, px.h), 0, 0)
  const url = cv.toDataURL('image/png')
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, url }
}

async function fileToImage(file: File): Promise<EditorImage & { w: number; h: number }> {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  await img.decode()
  let bytes = new Uint8Array(await file.arrayBuffer())
  let mime: EditorImage['mime'] = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
    const cv = document.createElement('canvas')
    cv.width = img.naturalWidth; cv.height = img.naturalHeight
    cv.getContext('2d')!.drawImage(img, 0, 0)
    const blob: Blob = await new Promise(r => cv.toBlob(b => r(b!), 'image/png'))
    bytes = new Uint8Array(await blob.arrayBuffer())
    mime = 'image/png'
  }
  return { bytes, mime, url, w: img.naturalWidth, h: img.naturalHeight }
}

/* ------------------------------------------------------------------ */

function ObjectView({ o, zoom, images, editing, fontsTick, onEditChange, onEditDone }: {
  o: EditorObj; zoom: number; images: Map<string, EditorImage>; fontsTick: number
  editing?: boolean; onEditChange?: (text: string) => void; onEditDone?: () => void
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (editing && taRef.current) { taRef.current.focus(); taRef.current.select() }
  }, [editing])
  const lines = useMemo(() => (o.type === 'text' ? layoutText(o) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [o, fontsTick])

  const x = o.type === 'line' ? Math.min(o.x, o.x + o.w) : o.x
  const y = o.type === 'line' ? Math.min(o.y, o.y + o.h) : o.y
  const w = Math.abs(o.w), h = Math.abs(o.h)
  const box: React.CSSProperties = { left: x * zoom, top: y * zoom, width: w * zoom, height: h * zoom, opacity: o.opacity }

  if (o.type === 'text') {
    if (editing) {
      const lhPx = o.size * o.lineHeight * zoom
      return (
        <textarea
          ref={taRef} className="pe-obj pe-text-edit" spellCheck={false} value={o.text}
          style={{
            ...box, height: Math.max(h * zoom, lhPx), fontFamily: FONTS[o.family].css, fontSize: o.size * zoom, lineHeight: `${lhPx}px`,
            paddingTop: Math.max(0, (ASCENT * o.size * zoom) - lhPx / 2 - o.size * zoom * 0.33),
            fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? 'italic' : 'normal', color: o.color,
            background: o.bg || 'rgba(255,255,255,0.92)', textAlign: o.align,
          }}
          onPointerDown={e => e.stopPropagation()}
          onChange={e => onEditChange?.(e.target.value)}
          onBlur={onEditDone}
          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onEditDone?.() } e.stopPropagation() }}
        />
      )
    }
    const m = measurer(o)
    return (
      <svg className="pe-obj" style={{ ...box, overflow: 'visible' }} width={Math.max(1, w * zoom)} height={Math.max(1, h * zoom)}>
        {o.bg && <rect x={0} y={0} width={w * zoom} height={h * zoom} fill={o.bg} />}
        {lines.map((ln, i) => {
          const lw = m(ln)
          const lx = o.align === 'center' ? (o.w - lw) / 2 : o.align === 'right' ? o.w - lw : 0
          const by = (ASCENT + i * o.lineHeight) * o.size
          return (
            <g key={i}>
              <text x={lx * zoom} y={by * zoom} fill={o.color} xmlSpace="preserve"
                style={{ font: fontCss({ ...o, size: o.size * zoom }) }}>{ln}</text>
              {o.underline && ln && <line x1={lx * zoom} x2={(lx + lw) * zoom} y1={(by + o.size * 0.12) * zoom} y2={(by + o.size * 0.12) * zoom}
                stroke={o.color} strokeWidth={Math.max(0.5, o.size / 16) * zoom} />}
            </g>
          )
        })}
      </svg>
    )
  }
  if (o.type === 'image') {
    return <img className="pe-obj" style={box} src={images.get(o.imageId)?.url} alt="" draggable={false} />
  }
  const sw = (o.type === 'line' ? o.strokeWidth : o.stroke ? o.strokeWidth : 0) * zoom
  return (
    <svg className="pe-obj" style={{ ...box, overflow: 'visible' }} width={Math.max(w * zoom, 1)} height={Math.max(h * zoom, 1)}>
      {o.type === 'rect' && <rect x={0} y={0} width={w * zoom} height={h * zoom} fill={o.fill || 'none'} stroke={o.stroke || 'none'} strokeWidth={sw} />}
      {o.type === 'ellipse' && <ellipse cx={w * zoom / 2} cy={h * zoom / 2} rx={w * zoom / 2} ry={h * zoom / 2} fill={o.fill || 'none'} stroke={o.stroke || 'none'} strokeWidth={sw} />}
      {o.type === 'line' && (
        <line x1={(o.x - x) * zoom} y1={(o.y - y) * zoom} x2={(o.x + o.w - x) * zoom} y2={(o.y + o.h - y) * zoom}
          stroke={o.stroke} strokeWidth={sw} strokeLinecap="round" />
      )}
    </svg>
  )
}

/** Фон страницы (исходник без вырезанных элементов), рисуется MuPDF при попадании в экран. */
function PageCanvas({ mu, bytes, page, zoom }: { mu: Mu | null; bytes: Uint8Array | undefined; page: EditorPage; zoom: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const { w, h } = viewSize(page)
  const key = derivedKey(page)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    const cv = ref.current
    if (!cv || !visible) return
    const dpr = window.devicePixelRatio || 1
    const ctx = cv.getContext('2d')!
    if (!mu || !bytes || !page.srcId) {
      cv.width = Math.round(w * zoom * dpr); cv.height = Math.round(h * zoom * dpr)
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height)
      return
    }
    const t = setTimeout(() => {
      try {
        const d = getDerived(mu, bytes, page)
        const px = renderPage(mu, d.page, zoom * dpr)
        cv.width = px.w; cv.height = px.h
        ctx.putImageData(new ImageData(px.data as Uint8ClampedArray<ArrayBuffer>, px.w, px.h), 0, 0)
      } catch (e) { console.error('render', e) }
    }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mu, bytes, key, zoom, visible, w, h])
  return <canvas ref={ref} className="pe-canvas" style={{ width: w * zoom, height: h * zoom }} />
}

/* ------------------------------------------------------------------ */

export default function PdfEditorPage() {
  const [mu, setMu] = useState<Mu | null>(null)
  const [fileName, setFileName] = useState('')
  const [pages, setPagesState] = useState<EditorPage[]>([])
  const pagesRef = useRef<EditorPage[]>([])
  const [sources, setSources] = useState<Map<string, Uint8Array>>(new Map())
  const images = useRef(new Map<string, EditorImage>())
  const [tool, setTool] = useState<Tool>('select')
  const [zoom, setZoom] = useState(1.25)
  const [sel, setSel] = useState<{ page: string; id: string } | null>(null)
  const [curPage, setCurPage] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(true)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)
  const undoStack = useRef<EditorPage[][]>([])
  const redoStack = useRef<EditorPage[][]>([])
  const [, force] = useState(0)
  const [fontsTick, setFontsTick] = useState(0)
  const clipboard = useRef<EditorObj | null>(null)
  const [defaults, setDefaults] = useState({ size: 12, family: 'dejavu-sans' as FontFamily, color: '#1a1f36', stroke: '#c0123c', fill: '' })
  const [dragOver, setDragOver] = useState(false)
  const [thumbDrag, setThumbDrag] = useState<number | null>(null)

  useEffect(() => {
    loadMu().then(setMu).catch(e => setErr(`Не удалось загрузить движок PDF: ${(e as Error).message}`))
    const fams = Object.values(FONTS).flatMap(f => ['', 'bold ', 'italic ', 'italic bold '].map(s => document.fonts.load(`${s}16px ${f.css}`)))
    Promise.all(fams).then(() => setFontsTick(t => t + 1)).catch(() => {})
  }, [])

  const setPages = useCallback((next: EditorPage[]) => { pagesRef.current = next; setPagesState(next) }, [])
  const commit = useCallback((next: EditorPage[], prev = pagesRef.current) => {
    undoStack.current.push(prev)
    if (undoStack.current.length > 200) undoStack.current.shift()
    redoStack.current = []
    setPages(next)
    setDirty(true)
  }, [setPages])
  const undo = () => {
    const prev = undoStack.current.pop()
    if (!prev) return
    redoStack.current.push(pagesRef.current); setPages(prev); setSel(null); setEditingId(null); force(n => n + 1)
  }
  const redo = () => {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(pagesRef.current); setPages(next); setSel(null); force(n => n + 1)
  }

  const patchObj = (o: EditorObj, patch: Partial<EditorObj>): EditorObj => {
    const n = { ...o, ...patch } as EditorObj
    return n.type === 'text' ? fitText(n) : n
  }
  const updateObj = useCallback((pageKey: string, id: string, patch: Partial<EditorObj>, record = true) => {
    const next = pagesRef.current.map(p => p.key !== pageKey ? p : {
      ...p, objects: p.objects.map(o => o.id === id ? patchObj(o, patch) : o),
    })
    if (record) commit(next); else setPages(next)
  }, [commit, setPages])

  const addObjects = useCallback((pageKey: string, objs: EditorObj[], select = true) => {
    commit(pagesRef.current.map(p => p.key !== pageKey ? p : { ...p, objects: [...p.objects, ...objs] }))
    if (select) setSel({ page: pageKey, id: objs[objs.length - 1].id })
  }, [commit])

  const selected = sel ? pages.find(p => p.key === sel.page)?.objects.find(o => o.id === sel.id) : undefined

  /* ---------- исходные элементы страницы ---------- */

  const itemsOf = (p: EditorPage): SourceItem[] => {
    if (!mu || !p.srcId) return []
    const bytes = sources.get(p.srcId)
    if (!bytes) return []
    try {
      const d = getDerived(mu, bytes, p)
      if (!d.items) d.items = extractItems(mu, d.page)
      return d.items
    } catch (e) { console.error(e); return [] }
  }

  /** Исходный абзац/картинка → редактируемый объект; исходник вырезается из страницы. */
  const convertItem = (page: EditorPage, item: SourceItem, edit = false) => {
    const snapshot = pagesRef.current
    let obj: EditorObj
    if (item.kind === 'text') {
      const base: TextObj = {
        id: uid(), type: 'text', x: item.x, y: item.base - ASCENT * item.size, w: item.w, h: 0, opacity: 1,
        text: item.lines.join('\n'), size: Math.round(item.size * 100) / 100, family: item.family, bold: item.bold, italic: item.italic,
        underline: false, color: item.color, align: item.align, lineHeight: item.lineHeight, bg: null,
      }
      // ширина — по самой длинной строке в нашем шрифте, центр/правый край сохраняются
      const m = measurer(base)
      const need = Math.max(...item.lines.map(l => m(l))) + 1
      const grow = Math.max(0, need - item.w)
      const x = base.align === 'center' ? item.x - grow / 2 : base.align === 'right' ? item.x - grow : item.x
      obj = fitText({ ...base, x, w: item.w + grow })
    } else {
      const d = getDerived(mu!, sources.get(page.srcId!)!, page)
      const px = extractImageRgba(mu!, d.page, item)
      if (!px) { setErr('Не удалось извлечь изображение'); return }
      const png = rgbaToPng(px)
      const id = uid()
      images.current.set(id, { bytes: png.bytes, mime: 'image/png', url: png.url })
      obj = { id: uid(), type: 'image', imageId: id, x: item.x, y: item.y, w: item.w, h: item.h, opacity: 1 }
    }
    commit(pagesRef.current.map(p => p.key !== page.key ? p : { ...p, removed: [...p.removed, item.removal], objects: [...p.objects, obj] }), snapshot)
    setSel({ page: page.key, id: obj.id })
    setCurPage(page.key)
    if (edit && obj.type === 'text') setEditingId(obj.id)
    return obj
  }

  /* ---------- файлы ---------- */

  const loadSource = async (file: File) => {
    const m = mu || await loadMu()
    const bytes = new Uint8Array(await file.arrayBuffer())
    const doc = m.Document.openDocument(bytes, 'application/pdf')
    if (!(doc instanceof m.PDFDocument)) throw new Error('Это не PDF')
    if (doc.needsPassword()) throw new Error('PDF защищён паролем')
    const id = uid()
    const list: EditorPage[] = []
    for (let i = 0; i < doc.countPages(); i++) {
      const pg = doc.loadPage(i) as MuPDF.PDFPage
      const info = pageInfo(pg)
      list.push({ key: uid(), srcId: id, srcIndex: i, box: info.box, rotation: info.rotation, removed: [], objects: [] })
      pg.destroy()
    }
    doc.destroy()
    setSources(prev => new Map(prev).set(id, bytes))
    return list
  }

  const openFile = async (file: File) => {
    if (dirty && !confirm('Несохранённые изменения будут потеряны. Открыть другой файл?')) return
    setErr(''); setBusy('Открываю PDF…')
    try {
      const list = await loadSource(file)
      undoStack.current = []; redoStack.current = []
      setPages(list); setCurPage(list[0]?.key || null); setSel(null); setDirty(false)
      setFileName(file.name.replace(/\.pdf$/i, ''))
    } catch (e) {
      setErr(`Не удалось открыть PDF: ${(e as Error).message}`)
    } finally { setBusy('') }
  }

  const insertPdf = async (file: File) => {
    setErr(''); setBusy('Вставляю страницы…')
    try {
      const list = await loadSource(file)
      const cur = pagesRef.current
      const at = curPage ? cur.findIndex(p => p.key === curPage) + 1 : cur.length
      commit([...cur.slice(0, at), ...list, ...cur.slice(at)])
      if (!fileName) setFileName(file.name.replace(/\.pdf$/i, ''))
    } catch (e) {
      setErr(`Не удалось вставить PDF: ${(e as Error).message}`)
    } finally { setBusy('') }
  }

  const insertImage = async (file: File, replaceSel = false) => {
    const target = curPage || pagesRef.current[0]?.key
    const page = pagesRef.current.find(p => p.key === target)
    if (!page) return
    try {
      const im = await fileToImage(file)
      const id = uid()
      images.current.set(id, im)
      if (replaceSel && sel && selected?.type === 'image') {
        const ratio = im.w / im.h
        const h = selected.w / ratio
        updateObj(sel.page, sel.id, { imageId: id, h, y: selected.y + (selected.h - h) / 2 })
        return
      }
      const vs = viewSize(page)
      const scale = Math.min(1, (vs.w * 0.5) / im.w, (vs.h * 0.5) / im.h)
      const w = im.w * scale, h = im.h * scale
      addObjects(page.key, [{ id: uid(), type: 'image', imageId: id, x: (vs.w - w) / 2, y: (vs.h - h) / 2, w, h, opacity: 1 }])
      setTool('select')
    } catch (e) { setErr(`Не удалось вставить изображение: ${(e as Error).message}`) }
  }

  const save = async () => {
    if (!mu) return
    setEditingId(null)
    setErr(''); setBusy('Сохраняю PDF…')
    try {
      const srcMap = new Map(sources)
      const prepared = pagesRef.current.map(p => {
        if (!p.srcId || !p.removed.length) return p
        const d = getDerived(mu, sources.get(p.srcId)!, p)
        const id = `d_${uid()}`
        srcMap.set(id, d.doc.saveToBuffer('compress').asUint8Array().slice())
        return { ...p, srcId: id }
      })
      const bytes = await exportPdf({
        pages: prepared, sources: srcMap, images: images.current, title: fileName,
        loadFont: async f => new Uint8Array(await (await fetch(`/fonts/${f}`)).arrayBuffer()),
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      a.download = `${fileName || 'документ'}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      setDirty(false)
    } catch (e) {
      console.error(e)
      setErr(`Ошибка сохранения: ${(e as Error).message}`)
    } finally { setBusy('') }
  }

  /* ---------- страницы ---------- */

  const pageIdx = (key: string | null) => pagesRef.current.findIndex(p => p.key === key)
  const scrollToPage = (key: string) => setTimeout(() => document.getElementById(`pe-page-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  const addBlank = () => {
    const cur = pagesRef.current
    const i = pageIdx(curPage)
    const size = cur[i] ? viewSize(cur[i]) : A4
    const page: EditorPage = { key: uid(), srcId: null, srcIndex: 0, box: { x: 0, y: 0, w: size.w, h: size.h }, rotation: 0, removed: [], objects: [] }
    const at = i >= 0 ? i + 1 : cur.length
    commit([...cur.slice(0, at), page, ...cur.slice(at)])
    setCurPage(page.key); scrollToPage(page.key)
  }
  const deletePage = (key: string) => {
    if (pagesRef.current.length <= 1) { setErr('Нельзя удалить единственную страницу'); return }
    const i = pageIdx(key)
    const next = pagesRef.current.filter(p => p.key !== key)
    commit(next)
    setCurPage(next[Math.min(i, next.length - 1)].key)
    if (sel?.page === key) setSel(null)
  }
  const duplicatePage = (key: string) => {
    const i = pageIdx(key)
    const src = pagesRef.current[i]
    const copy = { ...src, key: uid(), objects: src.objects.map(o => ({ ...o, id: uid() })) }
    commit([...pagesRef.current.slice(0, i + 1), copy, ...pagesRef.current.slice(i + 1)])
  }
  const rotatePage = (key: string) => {
    const p = pagesRef.current.find(x => x.key === key)
    if (p?.objects.length && !confirm('На странице есть добавленные объекты — после поворота их может понадобиться передвинуть. Повернуть?')) return
    commit(pagesRef.current.map(x => x.key === key ? { ...x, rotation: (x.rotation + 90) % 360 } : x))
  }
  const movePage = (from: number, to: number) => {
    const cur = [...pagesRef.current]
    if (to < 0 || to >= cur.length || from === to) return
    const [p] = cur.splice(from, 1)
    cur.splice(to, 0, p)
    commit(cur)
  }

  /* ---------- объекты ---------- */

  const deleteSelected = () => {
    if (!sel) return
    commit(pagesRef.current.map(p => p.key !== sel.page ? p : { ...p, objects: p.objects.filter(o => o.id !== sel.id) }))
    setSel(null); setEditingId(null)
  }
  const duplicateSelected = () => {
    if (!sel || !selected) return
    addObjects(sel.page, [{ ...selected, id: uid(), x: selected.x + 10, y: selected.y + 10 } as EditorObj])
  }
  const reorder = (front: boolean) => {
    if (!sel || !selected) return
    commit(pagesRef.current.map(p => {
      if (p.key !== sel.page) return p
      const rest = p.objects.filter(o => o.id !== sel.id)
      return { ...p, objects: front ? [...rest, selected] : [selected, ...rest] }
    }))
  }

  const newText = (x: number, y: number): TextObj => fitText({
    id: uid(), type: 'text', x, y, w: 200, h: 0, opacity: 1, text: 'Текст',
    size: defaults.size, family: defaults.family, bold: false, italic: false, underline: false,
    color: defaults.color, align: 'left', lineHeight: 1.2, bg: null,
  })

  /* ---------- мышь ---------- */

  const drag = useRef<{
    kind: 'move' | 'resize' | 'create'; page: string; id: string; handle?: Handle
    sx: number; sy: number; orig: EditorObj; snapshot: EditorPage[]; moved: boolean
  } | null>(null)

  const toPt = (e: { clientX: number; clientY: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom }
  }

  const startDrag = (e: { clientX: number; clientY: number }, layerEl: HTMLElement, pageKey: string, obj: EditorObj,
    kind: 'move' | 'resize' | 'create', handle?: Handle, snapshot = pagesRef.current) => {
    const p = toPt(e, layerEl)
    drag.current = { kind, page: pageKey, id: obj.id, handle, sx: p.x, sy: p.y, orig: obj, snapshot, moved: false }
    const onMove = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const q = toPt(ev, layerEl)
      const dx = q.x - d.sx, dy = q.y - d.sy
      if (Math.abs(dx) + Math.abs(dy) > 0.5) d.moved = true
      if (!d.moved) return
      const o = d.orig
      let patch: Partial<EditorObj> = {}
      if (d.kind === 'move') {
        patch = { x: o.x + dx, y: o.y + dy }
      } else if (o.type === 'line') {
        patch = d.handle === 'start' ? { x: o.x + dx, y: o.y + dy, w: o.w - dx, h: o.h - dy } : { w: o.w + dx, h: o.h + dy }
        if (ev.shiftKey) {
          const pw = patch.w ?? o.w, ph = patch.h ?? o.h
          if (Math.abs(pw) > Math.abs(ph)) patch.h = 0; else patch.w = 0
          if (d.handle === 'start') { patch.x = o.x + o.w - (patch.w ?? 0); patch.y = o.y + o.h - (patch.h ?? 0) }
        }
      } else {
        let l = o.x, t = o.y, r = o.x + o.w, b = o.y + o.h
        if (d.handle!.includes('w')) l += dx; else r += dx
        if (d.handle!.includes('n')) t += dy; else b += dy
        if (o.type === 'image' && !ev.shiftKey && d.kind === 'resize') {
          const nh = Math.abs(r - l) / (o.w / o.h)
          if (d.handle!.includes('n')) t = b - nh; else b = t + nh
        }
        patch = { x: Math.min(l, r), y: Math.min(t, b), w: Math.max(Math.abs(r - l), MIN), h: Math.max(Math.abs(b - t), MIN) }
        if (o.type === 'text') { delete patch.h; patch.y = o.y }
      }
      updateObj(d.page, d.id, patch, false)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const d = drag.current
      drag.current = null
      if (!d) return
      if (d.kind === 'create') {
        const created = pagesRef.current.find(p => p.key === d.page)?.objects.find(o => o.id === d.id)
        if (created && !d.moved && created.type !== 'text') {
          updateObj(d.page, d.id, created.type === 'line' ? { w: 120, h: 0 } : { w: 120, h: created.origin === 'hl' ? 16 : 60 }, false)
        }
        undoStack.current.push(d.snapshot); redoStack.current = []; setDirty(true)
        if (created?.type === 'text') setEditingId(created.id)
        setTool('select')
      } else if (d.moved) {
        // при конвертации исходника snapshot уже записан в историю — повторно не пишем
        if (undoStack.current[undoStack.current.length - 1] !== d.snapshot) { undoStack.current.push(d.snapshot); redoStack.current = [] }
        setDirty(true)
      }
      force(n => n + 1)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onLayerDown = (e: React.PointerEvent<HTMLDivElement>, page: EditorPage) => {
    setCurPage(page.key)
    if (e.button !== 0) return
    if (editingId) { setEditingId(null); return }
    if (tool === 'select') { setSel(null); return }
    e.preventDefault()
    const p = toPt(e, e.currentTarget)
    const base = { id: uid(), x: p.x, y: p.y, w: 0, h: 0, opacity: 1 }
    let obj: EditorObj
    switch (tool) {
      case 'text': obj = newText(p.x, p.y); break
      case 'rect': obj = { ...base, type: 'rect', fill: defaults.fill || null, stroke: defaults.stroke, strokeWidth: 1.5 }; break
      case 'ellipse': obj = { ...base, type: 'ellipse', fill: defaults.fill || null, stroke: defaults.stroke, strokeWidth: 1.5 }; break
      case 'line': obj = { ...base, type: 'line', stroke: defaults.stroke, strokeWidth: 1.5 }; break
      case 'whiteout': obj = { ...base, type: 'rect', fill: '#ffffff', stroke: null, strokeWidth: 0 }; break
      case 'highlight': obj = { ...base, type: 'rect', fill: '#ffe066', stroke: null, strokeWidth: 0, opacity: 0.4, origin: 'hl' }; break
      default: return
    }
    const snapshot = pagesRef.current
    setPages(pagesRef.current.map(pg => pg.key !== page.key ? pg : { ...pg, objects: [...pg.objects, obj] }))
    setSel({ page: page.key, id: obj.id })
    startDrag(e, e.currentTarget, page.key, obj, 'create', tool === 'line' ? 'end' : 'se', snapshot)
  }

  /* ---------- клавиатура ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && (k === 'z' || k === 'я')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && (k === 'y' || k === 'н')) { e.preventDefault(); redo(); return }
      if (mod && (k === 's' || k === 'ы')) { e.preventDefault(); if (pagesRef.current.length) save(); return }
      if (mod && (k === 'd' || k === 'в')) { e.preventDefault(); duplicateSelected(); return }
      if (mod && (k === 'c' || k === 'с') && selected) { clipboard.current = selected; return }
      if (mod && (k === 'v' || k === 'м') && clipboard.current) {
        const target = curPage || sel?.page
        if (target) addObjects(target, [{ ...clipboard.current, id: uid(), x: clipboard.current.x + 10, y: clipboard.current.y + 10 } as EditorObj])
        return
      }
      if (e.key === 'Escape') { setSel(null); setTool('select'); return }
      if (!sel || !selected) return
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return }
      if (e.key === 'Enter' && selected.type === 'text') { e.preventDefault(); setEditingId(selected.id); return }
      const step = e.shiftKey ? 10 : 1
      const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      if (mv[e.key]) { e.preventDefault(); updateObj(sel.page, sel.id, { x: selected.x + mv[e.key][0], y: selected.y + mv[e.key][1] }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  /* ---------- разметка ---------- */

  const pickFile = (accept: string, cb: (f: File) => void) => {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = accept
    inp.onchange = () => { const f = inp.files?.[0]; if (f) cb(f) }
    inp.click()
  }

  const fitWidth = () => {
    const main = document.querySelector('.pe-main') as HTMLElement | null
    const widest = Math.max(...pagesRef.current.map(p => viewSize(p).w), A4.w)
    if (main) setZoom(Math.max(0.3, Math.min(4, (main.clientWidth - 64) / widest)))
  }

  const tools: [Tool, React.ReactNode, string][] = [
    ['select', <MousePointer2 key="s" size={16} />, 'Выбор и правка: клик по любому тексту или картинке документа (Esc)'],
    ['text', <Type key="t" size={16} />, 'Добавить текст'],
    ['rect', <Square key="r" size={16} />, 'Прямоугольник'],
    ['ellipse', <Circle key="c" size={16} />, 'Эллипс'],
    ['line', <Minus key="l" size={16} />, 'Линия (Shift — ровно)'],
    ['whiteout', <Eraser key="w" size={16} />, 'Замазка'],
    ['highlight', <Highlighter key="h" size={16} />, 'Маркер'],
  ]

  const textSel = selected?.type === 'text' ? selected : null
  const shapeSel = selected && (selected.type === 'rect' || selected.type === 'ellipse') ? selected : null
  const lineSel = selected?.type === 'line' ? selected : null
  const patch = (p: Partial<EditorObj>) => sel && updateObj(sel.page, sel.id, p)

  if (!pages.length) {
    return (
      <div className="pe-empty"
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) openFile(f) }}>
        <a className="btn btn-ghost pe-back" href="/"><ArrowLeft size={14} /> К конструктору КП</a>
        <div className={`pe-drop ${dragOver ? 'over' : ''}`}>
          <FileInput size={40} strokeWidth={1.5} />
          <h1>Редактор PDF</h1>
          <p>Перетащите сюда готовое КП или любой PDF — или выберите файл. Любой текст и любую картинку документа можно изменить, передвинуть или удалить.</p>
          <button className="btn btn-primary" onClick={() => pickFile('application/pdf,.pdf', openFile)} disabled={!!busy || !mu}>
            {busy || !mu ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {busy || (mu ? 'Открыть PDF' : 'Загрузка движка…')}
          </button>
          <button className="btn btn-ghost" onClick={() => {
            const page: EditorPage = { key: uid(), srcId: null, srcIndex: 0, box: { x: 0, y: 0, ...A4 }, rotation: 0, removed: [], objects: [] }
            setPages([page]); setCurPage(page.key); setFileName('Новый документ')
          }}>
            <FilePlus2 size={14} /> Пустой документ A4
          </button>
          {err && <div className="pe-err">{err}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="pe-app"
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDrop={e => {
        const f = e.dataTransfer.files[0]
        if (!f) return
        e.preventDefault()
        if (f.type === 'application/pdf') insertPdf(f); else if (f.type.startsWith('image/')) insertImage(f)
      }}>
      <header className="pe-top">
        <a className="btn btn-ghost" href="/" title="К конструктору КП"><ArrowLeft size={14} /></a>
        <input className="pe-name" value={fileName} onChange={e => setFileName(e.target.value)} title="Имя файла при сохранении" />
        {dirty && <span className="pe-dirty">● не сохранено</span>}
        <div className="pe-sp" />
        <button className="btn btn-ghost" onClick={undo} disabled={!undoStack.current.length} title="Отменить (Ctrl+Z)"><Undo2 size={14} /></button>
        <button className="btn btn-ghost" onClick={redo} disabled={!redoStack.current.length} title="Повторить (Ctrl+Shift+Z)"><Redo2 size={14} /></button>
        <div className="pe-zoom">
          <button className="btn btn-ghost" onClick={() => setZoom(z => Math.max(0.3, +(z / 1.2).toFixed(2)))}><ZoomOut size={14} /></button>
          <button className="btn btn-ghost pe-zoom-val" onClick={fitWidth} title="По ширине">{Math.round(zoom * 100)}%</button>
          <button className="btn btn-ghost" onClick={() => setZoom(z => Math.min(4, +(z * 1.2).toFixed(2)))}><ZoomIn size={14} /></button>
        </div>
        <button className="btn btn-ghost" onClick={() => pickFile('application/pdf,.pdf', openFile)} title="Открыть другой PDF"><Upload size={14} /> Открыть</button>
        <button className="btn btn-primary" onClick={save} disabled={!!busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />} {busy || 'Скачать PDF'}
        </button>
      </header>

      <div className="pe-toolbar">
        {tools.map(([t, icon, title]) => (
          <button key={t} className={`pe-tool ${tool === t ? 'on' : ''}`} title={title} onClick={() => { setTool(t); setEditingId(null) }}>{icon}</button>
        ))}
        <button className="pe-tool" title="Вставить изображение / печать / подпись" onClick={() => pickFile('image/*', f => insertImage(f))}><ImagePlus size={16} /></button>
        <button className={`pe-tool ${showSource ? 'on' : ''}`} title="Подсвечивать редактируемые элементы документа" onClick={() => setShowSource(v => !v)}>
          {showSource ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
        <span className="pe-sep" />
        <button className="pe-tool" title="Добавить пустую страницу после текущей" onClick={addBlank}><FilePlus2 size={16} /></button>
        <button className="pe-tool" title="Вставить страницы из другого PDF после текущей" onClick={() => pickFile('application/pdf,.pdf', insertPdf)}><FileInput size={16} /></button>
        <span className="pe-sep" />
        <div className="pe-props">
          {textSel && <>
            <select value={textSel.family} onChange={e => { const f = e.target.value as FontFamily; patch({ family: f }); setDefaults(d => ({ ...d, family: f })) }}>
              {Object.entries(FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
            </select>
            <input type="number" min={4} max={300} step={0.5} value={textSel.size} title="Кегль, pt"
              onChange={e => { const v = +e.target.value || 12; patch({ size: v }); setDefaults(d => ({ ...d, size: v })) }} />
            <input type="number" min={0.8} max={3} step={0.05} value={textSel.lineHeight} title="Межстрочный интервал"
              onChange={e => patch({ lineHeight: +e.target.value || 1.2 })} />
            <button className={`pe-tool ${textSel.bold ? 'on' : ''}`} title="Жирный" onClick={() => patch({ bold: !textSel.bold })}><Bold size={14} /></button>
            <button className={`pe-tool ${textSel.italic ? 'on' : ''}`} title="Курсив" onClick={() => patch({ italic: !textSel.italic })}><Italic size={14} /></button>
            <button className={`pe-tool ${textSel.underline ? 'on' : ''}`} title="Подчёркнутый" onClick={() => patch({ underline: !textSel.underline })}><Underline size={14} /></button>
            {(['left', 'center', 'right'] as const).map(a => (
              <button key={a} className={`pe-tool ${textSel.align === a ? 'on' : ''}`} onClick={() => patch({ align: a })}>
                {a === 'left' ? <AlignLeft size={14} /> : a === 'center' ? <AlignCenter size={14} /> : <AlignRight size={14} />}
              </button>
            ))}
            <label className="pe-color" title="Цвет текста"><span>A</span><input type="color" value={textSel.color} onChange={e => { patch({ color: e.target.value }); setDefaults(d => ({ ...d, color: e.target.value })) }} /></label>
            <label className="pe-color" title="Фон блока"><span>Фон</span><input type="color" value={textSel.bg || '#ffffff'} onChange={e => patch({ bg: e.target.value })} /></label>
            {textSel.bg && <button className="pe-mini" onClick={() => patch({ bg: null })}>без фона</button>}
          </>}
          {(shapeSel || lineSel) && <>
            <label className="pe-color" title="Цвет линии"><span>Линия</span>
              <input type="color" value={(shapeSel ? shapeSel.stroke : lineSel!.stroke) || '#000000'} onChange={e => { patch({ stroke: e.target.value }); setDefaults(d => ({ ...d, stroke: e.target.value })) }} />
            </label>
            {shapeSel?.stroke && <button className="pe-mini" onClick={() => patch({ stroke: null })}>без линии</button>}
            <input type="number" min={0.25} max={30} step={0.25} title="Толщина, pt" value={(shapeSel || lineSel)!.strokeWidth}
              onChange={e => patch({ strokeWidth: +e.target.value || 1 })} />
            {shapeSel && <>
              <label className="pe-color" title="Заливка"><span>Заливка</span>
                <input type="color" value={shapeSel.fill || '#ffffff'} onChange={e => { patch({ fill: e.target.value }); setDefaults(d => ({ ...d, fill: e.target.value })) }} />
              </label>
              {shapeSel.fill && <button className="pe-mini" onClick={() => patch({ fill: null })}>без заливки</button>}
            </>}
          </>}
          {selected?.type === 'image' && (
            <button className="pe-tool" title="Заменить изображение" onClick={() => pickFile('image/*', f => insertImage(f, true))}><Replace size={14} /></button>
          )}
          {selected && <>
            <label className="pe-op" title="Непрозрачность">
              <input type="range" min={0.05} max={1} step={0.05} value={selected.opacity}
                onPointerDown={() => { undoStack.current.push(pagesRef.current); setDirty(true) }}
                onChange={e => updateObj(sel!.page, sel!.id, { opacity: +e.target.value }, false)} />
            </label>
            <button className="pe-tool" title="На передний план" onClick={() => reorder(true)}><BringToFront size={14} /></button>
            <button className="pe-tool" title="На задний план" onClick={() => reorder(false)}><SendToBack size={14} /></button>
            <button className="pe-tool" title="Дублировать (Ctrl+D)" onClick={duplicateSelected}><Copy size={14} /></button>
            <button className="pe-tool danger" title="Удалить (Delete)" onClick={deleteSelected}><Trash2 size={14} /></button>
          </>}
          {!selected && tool === 'select' && <span className="pe-hint">Клик по тексту или картинке документа — выделить и двигать, двойной клик — править текст, Delete — удалить.</span>}
        </div>
      </div>

      {err && <div className="pe-err pe-err-bar" onClick={() => setErr('')}>{err} ✕</div>}

      <div className="pe-body">
        <aside className="pe-thumbs">
          {pages.map((p, i) => {
            const vs = viewSize(p)
            const tz = 132 / vs.w
            return (
              <div key={p.key}
                className={`pe-thumb ${curPage === p.key ? 'on' : ''} ${thumbDrag !== null && thumbDrag !== i ? 'drop' : ''}`}
                draggable onDragStart={() => setThumbDrag(i)} onDragEnd={() => setThumbDrag(null)}
                onDragOver={e => { if (thumbDrag !== null) e.preventDefault() }}
                onDrop={e => { if (thumbDrag !== null) { e.preventDefault(); e.stopPropagation(); movePage(thumbDrag, i); setThumbDrag(null) } }}
                onClick={() => { setCurPage(p.key); scrollToPage(p.key) }}>
                <div className="pe-thumb-img" style={{ width: vs.w * tz, height: vs.h * tz }}>
                  <PageCanvas mu={mu} bytes={p.srcId ? sources.get(p.srcId) : undefined} page={p} zoom={tz} />
                  <div className="pe-layer static">
                    {p.objects.map(o => <ObjectView key={o.id} o={o} zoom={tz} images={images.current} fontsTick={fontsTick} />)}
                  </div>
                </div>
                <div className="pe-thumb-bar">
                  <span>{i + 1}</span>
                  <button title="Выше" onClick={e => { e.stopPropagation(); movePage(i, i - 1) }} disabled={i === 0}><ChevronUp size={13} /></button>
                  <button title="Ниже" onClick={e => { e.stopPropagation(); movePage(i, i + 1) }} disabled={i === pages.length - 1}><ChevronDown size={13} /></button>
                  <button title="Повернуть" onClick={e => { e.stopPropagation(); rotatePage(p.key) }}><RotateCw size={13} /></button>
                  <button title="Дублировать страницу" onClick={e => { e.stopPropagation(); duplicatePage(p.key) }}><Copy size={13} /></button>
                  <button title="Удалить страницу" className="danger" onClick={e => { e.stopPropagation(); deletePage(p.key) }}><Trash2 size={13} /></button>
                </div>
              </div>
            )
          })}
          <button className="pe-add-page" onClick={addBlank}><FilePlus2 size={14} /> Страница</button>
        </aside>

        <main className="pe-main">
          {pages.map((p, i) => {
            const vs = viewSize(p)
            const items = tool === 'select' ? itemsOf(p) : []
            const pageArea = vs.w * vs.h
            // крупные картинки снизу, мелкие и текст сверху; фон на всю страницу не перехватывает клики
            const hits = items.filter(it => it.kind === 'text' || it.w * it.h < pageArea * 0.85)
              .sort((a, b) => (a.kind === b.kind ? b.w * b.h - a.w * a.h : a.kind === 'image' ? -1 : 1))
            return (
              <section key={p.key} id={`pe-page-${p.key}`} className={`pe-page ${curPage === p.key ? 'on' : ''}`}>
                <div className="pe-page-label">Стр. {i + 1} из {pages.length}</div>
                <div className="pe-sheet" style={{ width: vs.w * zoom, height: vs.h * zoom }}>
                  <PageCanvas mu={mu} bytes={p.srcId ? sources.get(p.srcId) : undefined} page={p} zoom={zoom} />
                  <div className={`pe-layer tool-${tool} ${showSource ? 'show-src' : ''}`} onPointerDown={e => onLayerDown(e, p)}>
                    {hits.map(it => (
                      <div key={it.key} className={`pe-src pe-src-${it.kind}`}
                        title={it.kind === 'text' ? it.lines.join(' ') : 'Изображение'}
                        style={{ left: it.x * zoom, top: it.y * zoom, width: it.w * zoom, height: it.h * zoom }}
                        onPointerDown={e => {
                          if (e.button !== 0) return
                          e.stopPropagation()
                          if (editingId) setEditingId(null)
                          const layer = e.currentTarget.parentElement as HTMLElement
                          const pt = { clientX: e.clientX, clientY: e.clientY }
                          const snapshot = pagesRef.current
                          const obj = convertItem(p, it, e.detail >= 2)
                          if (obj && e.detail < 2) startDrag(pt, layer, p.key, obj, 'move', undefined, snapshot)
                        }} />
                    ))}
                    {p.objects.map(o => {
                      const isSel = sel?.page === p.key && sel.id === o.id
                      return (
                        <div key={o.id} className={`pe-wrap ${isSel ? 'sel' : ''}`}
                          onPointerDown={e => {
                            if (tool !== 'select') return
                            e.stopPropagation()
                            if (editingId === o.id) return
                            if (editingId) setEditingId(null)
                            setCurPage(p.key); setSel({ page: p.key, id: o.id })
                            if (e.detail >= 2 && o.type === 'text') { e.preventDefault(); setEditingId(o.id); return }
                            startDrag(e, e.currentTarget.parentElement as HTMLElement, p.key, o, 'move')
                          }}
                          onDoubleClick={() => { if (o.type === 'text') setEditingId(o.id) }}>
                          <ObjectView o={o} zoom={zoom} images={images.current} fontsTick={fontsTick} editing={editingId === o.id}
                            onEditChange={text => updateObj(p.key, o.id, { text }, false)}
                            onEditDone={() => { setEditingId(null); undoStack.current.push(pagesRef.current); setDirty(true) }} />
                          {isSel && editingId !== o.id && (
                            <SelectionBox o={o} zoom={zoom} onHandle={(e, h) => {
                              e.stopPropagation()
                              startDrag(e, (e.currentTarget as HTMLElement).closest('.pe-layer') as HTMLElement, p.key, o, 'resize', h)
                            }} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </section>
            )
          })}
        </main>
      </div>
    </div>
  )
}

function SelectionBox({ o, zoom, onHandle }: { o: EditorObj; zoom: number; onHandle: (e: React.PointerEvent, h: Handle) => void }) {
  if (o.type === 'line') {
    return <>
      <span className="pe-handle" style={{ left: o.x * zoom, top: o.y * zoom }} onPointerDown={e => onHandle(e, 'start')} />
      <span className="pe-handle" style={{ left: (o.x + o.w) * zoom, top: (o.y + o.h) * zoom }} onPointerDown={e => onHandle(e, 'end')} />
    </>
  }
  const l = o.x * zoom, t = o.y * zoom, r = (o.x + o.w) * zoom, b = (o.y + o.h) * zoom
  const handles: [Handle, number, number][] = o.type === 'text'
    ? [['nw', l, t], ['ne', r, t]]
    : [['nw', l, t], ['ne', r, t], ['sw', l, b], ['se', r, b]]
  return <>
    <div className="pe-selbox" style={{ left: l, top: t, width: r - l, height: b - t }} />
    {handles.map(([h, x, y]) => (
      <span key={h} className={`pe-handle h-${h}`} style={{ left: x, top: y }} onPointerDown={e => onHandle(e, h)} />
    ))}
  </>
}
