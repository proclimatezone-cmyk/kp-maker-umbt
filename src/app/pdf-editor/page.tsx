'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import {
  ArrowLeft, Upload, Download, MousePointer2, Type, TextCursorInput, Square, Circle, Minus,
  Eraser, Highlighter, ImagePlus, FilePlus2, FileInput, Trash2, Copy, RotateCw, ChevronUp,
  ChevronDown, Undo2, Redo2, ZoomIn, ZoomOut, Bold, Italic, Underline, AlignLeft, AlignCenter,
  AlignRight, BringToFront, SendToBack, Loader2,
} from 'lucide-react'
import { exportPdf } from '@/lib/pdf-editor/export'
import {
  BASELINE_RATIO, LINE_HEIGHT, viewSize,
  type EditorImage, type EditorObj, type EditorPage, type FontFamily, type TextObj,
} from '@/lib/pdf-editor/types'
import './pdf-editor.css'

type Tool = 'select' | 'edit' | 'text' | 'rect' | 'ellipse' | 'line' | 'whiteout' | 'highlight'
type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'start' | 'end'
type Run = { key: string; str: string; x: number; y: number; w: number; h: number; base: number; size: number; font: string }

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
const A4 = { w: 595.28, h: 841.89 }
const FAMILY_CSS: Record<FontFamily, string> = { sans: '"DejaVu Sans", sans-serif', serif: '"DejaVu Serif", serif' }
const MIN = 4

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null
function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then(m => {
      m.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      return m
    })
  }
  return pdfjsPromise
}
async function openPdf(bytes: Uint8Array) {
  const m = await pdfjs()
  return m.getDocument({
    data: bytes.slice(),
    cMapUrl: '/pdfjs-cmaps/', cMapPacked: true,
    standardFontDataUrl: '/pdfjs-standard-fonts/',
  }).promise
}

function lum(r: number, g: number, b: number) { return 0.299 * r + 0.587 * g + 0.114 * b }
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')

/** Сшивает куски текста pdf.js в строки, пригодные для правки. */
async function extractRuns(page: PDFPageProxy, rotation: number): Promise<Run[]> {
  const m = await pdfjs()
  const vp = page.getViewport({ scale: 1, rotation })
  const tc = await page.getTextContent()
  const items: Run[] = []
  for (const it of tc.items) {
    if (!('str' in it) || !it.str) continue
    const t = m.Util.transform(vp.transform, it.transform)
    if (!(t[0] > 0) || Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue
    const size = Math.abs(t[3])
    if (size < 1) continue
    let font = ''
    try { if (page.commonObjs.has(it.fontName)) font = (page.commonObjs.get(it.fontName) as { name?: string })?.name || '' } catch { /* шрифт ещё не загружен */ }
    items.push({ key: '', str: it.str, x: t[4], base: t[5], w: it.width, size, font, y: t[5] - size * 0.92, h: size * 1.18 })
  }
  items.sort((a, b) => (Math.abs(a.base - b.base) < 0.6 ? a.x - b.x : a.base - b.base))
  const runs: Run[] = []
  for (const it of items) {
    const prev = runs[runs.length - 1]
    const gap = prev ? it.x - (prev.x + prev.w) : 0
    if (prev && Math.abs(prev.base - it.base) < 0.6 && prev.font === it.font && Math.abs(prev.size - it.size) < 0.5
      && gap < it.size * 0.6 && gap > -it.size) {
      prev.str += (gap > it.size * 0.15 && !prev.str.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str
      prev.w = it.x + it.w - prev.x
    } else if (it.str.trim()) {
      runs.push({ ...it })
    }
  }
  for (const r of runs) { r.str = r.str.trim(); r.key = `${Math.round(r.x)}:${Math.round(r.base)}` }
  return runs.filter(r => r.str)
}

function measureText(o: Pick<TextObj, 'text' | 'size' | 'family' | 'bold' | 'italic'>) {
  const c = document.createElement('canvas').getContext('2d')!
  c.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.size}px ${FAMILY_CSS[o.family]}`
  return Math.max(...o.text.split('\n').map(l => c.measureText(l).width))
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

function ObjectView({ o, zoom, images, editing, onEditChange, onEditDone }: {
  o: EditorObj; zoom: number; images: Map<string, EditorImage>
  editing?: boolean; onEditChange?: (text: string, h: number) => void; onEditDone?: () => void
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (editing && taRef.current) { taRef.current.focus(); taRef.current.select() }
  }, [editing])

  const x = o.type === 'line' ? Math.min(o.x, o.x + o.w) : o.x
  const y = o.type === 'line' ? Math.min(o.y, o.y + o.h) : o.y
  const w = Math.abs(o.w), h = Math.abs(o.h)
  const box: React.CSSProperties = { left: x * zoom, top: y * zoom, width: w * zoom, height: h * zoom, opacity: o.opacity }

  if (o.type === 'text') {
    const style: React.CSSProperties = {
      ...box, fontFamily: FAMILY_CSS[o.family], fontSize: o.size * zoom, lineHeight: LINE_HEIGHT,
      fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? 'italic' : 'normal',
      textDecoration: o.underline ? 'underline' : 'none', color: o.color, background: o.bg || 'transparent', textAlign: o.align,
    }
    if (editing) {
      return (
        <textarea
          ref={taRef} className="pe-obj pe-text pe-text-edit" style={style} value={o.text} spellCheck={false}
          onPointerDown={e => e.stopPropagation()}
          onChange={e => {
            const ta = e.currentTarget
            ta.style.height = '0px'
            const sh = ta.scrollHeight
            ta.style.height = ''
            onEditChange?.(e.target.value, Math.max(o.size * LINE_HEIGHT, sh / zoom))
          }}
          onBlur={onEditDone}
          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onEditDone?.() } e.stopPropagation() }}
        />
      )
    }
    return <div className="pe-obj pe-text" style={style}>{o.text || ' '}</div>
  }
  if (o.type === 'image') {
    const im = images.get(o.imageId)
    return <img className="pe-obj" style={box} src={im?.url} alt="" draggable={false} />
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

function PdfCanvas({ doc, page, zoom, canvasRef, onRendered }: {
  doc: PDFDocumentProxy | undefined; page: EditorPage; zoom: number
  canvasRef?: React.RefObject<HTMLCanvasElement | null>; onRendered?: (p: PDFPageProxy) => void
}) {
  const own = useRef<HTMLCanvasElement>(null)
  const ref = canvasRef || own
  const { w, h } = viewSize(page)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(w * zoom * dpr)
    cv.height = Math.round(h * zoom * dpr)
    const ctx = cv.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, cv.width, cv.height)
    if (!doc || page.srcId === null) return
    let task: ReturnType<PDFPageProxy['render']> | null = null
    let cancelled = false
    doc.getPage(page.srcIndex + 1).then(p => {
      if (cancelled) return
      task = p.render({ canvasContext: ctx, viewport: p.getViewport({ scale: zoom * dpr, rotation: page.rotation }) })
      task.promise.then(() => onRendered?.(p)).catch(() => {})
    })
    return () => { cancelled = true; task?.cancel() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, page.srcId, page.srcIndex, page.rotation, zoom, w, h])
  return <canvas ref={ref} className="pe-canvas" style={{ width: w * zoom, height: h * zoom }} />
}

/* ------------------------------------------------------------------ */

export default function PdfEditorPage() {
  const [fileName, setFileName] = useState('')
  const [pages, setPagesState] = useState<EditorPage[]>([])
  const pagesRef = useRef<EditorPage[]>([])
  const [docs, setDocs] = useState<Map<string, PDFDocumentProxy>>(new Map())
  const sources = useRef(new Map<string, Uint8Array>())
  const images = useRef(new Map<string, EditorImage>())
  const [tool, setTool] = useState<Tool>('select')
  const [zoom, setZoom] = useState(1.25)
  const [sel, setSel] = useState<{ page: string; id: string } | null>(null)
  const [curPage, setCurPage] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)
  const undoStack = useRef<EditorPage[][]>([])
  const redoStack = useRef<EditorPage[][]>([])
  const [, force] = useState(0)
  const clipboard = useRef<EditorObj | null>(null)
  const [runs, setRuns] = useState<Record<string, Run[]>>({})
  const pdfPages = useRef(new Map<string, PDFPageProxy>())
  const [defaults, setDefaults] = useState({ size: 12, family: 'sans' as FontFamily, color: '#1a1f36', stroke: '#c0123c', fill: '' })
  const [dragOver, setDragOver] = useState(false)
  const [thumbDrag, setThumbDrag] = useState<number | null>(null)

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

  const updateObj = useCallback((pageKey: string, id: string, patch: Partial<EditorObj>, record = true) => {
    const next = pagesRef.current.map(p => p.key !== pageKey ? p : {
      ...p, objects: p.objects.map(o => o.id === id ? ({ ...o, ...patch } as EditorObj) : o),
    })
    if (record) commit(next); else setPages(next)
  }, [commit, setPages])

  const addObjects = useCallback((pageKey: string, objs: EditorObj[], select = true) => {
    commit(pagesRef.current.map(p => p.key !== pageKey ? p : { ...p, objects: [...p.objects, ...objs] }))
    if (select) setSel({ page: pageKey, id: objs[objs.length - 1].id })
  }, [commit])

  const selected = sel ? pages.find(p => p.key === sel.page)?.objects.find(o => o.id === sel.id) : undefined

  /* ---------- файлы ---------- */

  const loadSource = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const doc = await openPdf(bytes)
    const id = uid()
    sources.current.set(id, bytes)
    setDocs(prev => new Map(prev).set(id, doc))
    const list: EditorPage[] = []
    for (let i = 0; i < doc.numPages; i++) {
      const p = await doc.getPage(i + 1)
      const [x0, y0, x1, y1] = p.view
      list.push({ key: uid(), srcId: id, srcIndex: i, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, rotation: p.rotate % 360, objects: [] })
    }
    return list
  }

  const openFile = async (file: File) => {
    if (dirty && !confirm('Несохранённые изменения будут потеряны. Открыть другой файл?')) return
    setErr(''); setBusy('Открываю PDF…')
    try {
      sources.current.clear(); images.current.clear(); setDocs(new Map()); setRuns({}); pdfPages.current.clear()
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

  const insertImage = async (file: File) => {
    const target = curPage || pagesRef.current[0]?.key
    const page = pagesRef.current.find(p => p.key === target)
    if (!page) return
    try {
      const im = await fileToImage(file)
      const id = uid()
      images.current.set(id, im)
      const vs = viewSize(page)
      const scale = Math.min(1, (vs.w * 0.5) / im.w, (vs.h * 0.5) / im.h)
      const w = im.w * scale, h = im.h * scale
      addObjects(page.key, [{ id: uid(), type: 'image', imageId: id, x: (vs.w - w) / 2, y: (vs.h - h) / 2, w, h, opacity: 1 }])
      setTool('select')
    } catch (e) { setErr(`Не удалось вставить изображение: ${(e as Error).message}`) }
  }

  const save = async () => {
    setErr(''); setBusy('Сохраняю PDF…')
    try {
      const bytes = await exportPdf({
        pages: pagesRef.current, sources: sources.current, images: images.current, title: fileName,
        loadFont: async f => new Uint8Array(await (await fetch(`/fonts/${f}`)).arrayBuffer()),
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      a.download = `${fileName || 'документ'}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      setDirty(false)
    } catch (e) {
      setErr(`Ошибка сохранения: ${(e as Error).message}`)
    } finally { setBusy('') }
  }

  /* ---------- страницы ---------- */

  const pageIdx = (key: string | null) => pagesRef.current.findIndex(p => p.key === key)
  const addBlank = () => {
    const cur = pagesRef.current
    const i = pageIdx(curPage)
    const ref = cur[i]
    const size = ref ? viewSize(ref) : A4
    const page: EditorPage = { key: uid(), srcId: null, srcIndex: 0, box: { x: 0, y: 0, w: size.w, h: size.h }, rotation: 0, objects: [] }
    const at = i >= 0 ? i + 1 : cur.length
    commit([...cur.slice(0, at), page, ...cur.slice(at)])
    setCurPage(page.key)
    setTimeout(() => document.getElementById(`pe-page-${page.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
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
  const rotatePage = (key: string) => commit(pagesRef.current.map(p => p.key === key ? { ...p, rotation: (p.rotation + 90) % 360 } : p))
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

  const newText = (x: number, y: number, extra: Partial<TextObj> = {}): TextObj => ({
    id: uid(), type: 'text', x, y, w: 200, h: defaults.size * LINE_HEIGHT, opacity: 1, text: 'Текст',
    size: defaults.size, family: defaults.family, bold: false, italic: false, underline: false,
    color: defaults.color, align: 'left', bg: null, ...extra,
  })

  /** Замена существующего текста PDF: замазка цветом фона + редактируемый блок поверх. */
  const replaceRun = (page: EditorPage, run: Run) => {
    const fn = run.font.toLowerCase()
    const style = {
      text: run.str, size: Math.round(run.size * 10) / 10,
      family: (/serif|times|roman|georgia|cambria/.test(fn) && !/sans/.test(fn) ? 'serif' : 'sans') as FontFamily,
      bold: /bold|black|heavy|semibold|demi/.test(fn), italic: /italic|oblique/.test(fn),
    }
    const tw = measureText(style)
    const cover: EditorObj = { id: uid(), type: 'rect', x: run.x - 1.5, y: run.y - 1, w: run.w + 3, h: run.h + 2, opacity: 1, fill: '#ffffff', stroke: null, strokeWidth: 0, origin: run.key }
    const txt = newText(run.x, run.base - BASELINE_RATIO * style.size, { ...style, color: '#000000', w: Math.max(run.w, tw) + 4, h: style.size * LINE_HEIGHT })
    addObjects(page.key, [cover, txt])
    setTool('select')
    setEditingId(txt.id)
    sampleColors(page, run).then(c => {
      if (!c) return
      setPages(pagesRef.current.map(p => p.key !== page.key ? p : {
        ...p, objects: p.objects.map(o => o.id === cover.id ? { ...o, fill: c.bg } as EditorObj
          : o.id === txt.id && (o as TextObj).color === '#000000' ? { ...o, color: c.fg } as EditorObj : o),
      }))
    }).catch(() => {})
  }

  /** Цвет фона и текста под строкой — из отдельного рендера страницы. */
  const sampleColors = async (page: EditorPage, run: Run) => {
    const doc = page.srcId ? docs.get(page.srcId) : undefined
    if (!doc) return null
    const pp = await doc.getPage(page.srcIndex + 1)
    const vp = pp.getViewport({ scale: 2, rotation: page.rotation })
    const cv = document.createElement('canvas')
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height)
    const ctx = cv.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height)
    await pp.render({ canvasContext: ctx, viewport: vp }).promise
    const k = 2
    const px = (x: number, y: number) => {
      const d = ctx.getImageData(Math.max(0, Math.min(cv.width - 1, Math.round(x * k))), Math.max(0, Math.min(cv.height - 1, Math.round(y * k))), 1, 1).data
      return [d[0], d[1], d[2]] as [number, number, number]
    }
    const ring = [
      px(run.x - 2, run.y - 1), px(run.x + run.w + 2, run.y - 1), px(run.x - 2, run.y + run.h + 1),
      px(run.x + run.w + 2, run.y + run.h + 1), px(run.x + run.w / 2, run.y - 2), px(run.x + run.w / 2, run.y + run.h + 2),
    ]
    const b = ring.sort((a, c) => lum(...c) - lum(...a))[0]
    const d = ctx.getImageData(Math.round(run.x * k), Math.round(run.y * k), Math.max(1, Math.round(run.w * k)), Math.max(1, Math.round(run.h * k))).data
    let best = 0, f: [number, number, number] = [0, 0, 0]
    for (let i = 0; i < d.length; i += 4) {
      const dist = Math.abs(d[i] - b[0]) + Math.abs(d[i + 1] - b[1]) + Math.abs(d[i + 2] - b[2])
      if (dist > best) { best = dist; f = [d[i], d[i + 1], d[i + 2]] }
    }
    return { bg: toHex(...b), fg: toHex(...f) }
  }

  /* ---------- мышь ---------- */

  const drag = useRef<{
    kind: 'move' | 'resize' | 'create'; page: string; id: string; handle?: Handle
    sx: number; sy: number; orig: EditorObj; snapshot: EditorPage[]; moved: boolean
  } | null>(null)

  const toPt = (e: { clientX: number; clientY: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom }
  }

  const startDrag = (e: React.PointerEvent, page: EditorPage, obj: EditorObj, kind: 'move' | 'resize' | 'create', handle?: Handle, snapshot = pagesRef.current) => {
    const layer = (e.currentTarget as HTMLElement).closest('.pe-layer') as HTMLElement
    const p = toPt(e, layer)
    drag.current = { kind, page: page.key, id: obj.id, handle, sx: p.x, sy: p.y, orig: obj, snapshot, moved: false }
    const onMove = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const q = toPt(ev, layer)
      const dx = q.x - d.sx, dy = q.y - d.sy
      if (Math.abs(dx) + Math.abs(dy) > 0.5) d.moved = true
      const o = d.orig
      let patch: Partial<EditorObj> = {}
      if (d.kind === 'move') {
        patch = { x: o.x + dx, y: o.y + dy }
      } else if (o.type === 'line' || d.handle === 'start' || d.handle === 'end') {
        patch = d.handle === 'start' ? { x: o.x + dx, y: o.y + dy, w: o.w - dx, h: o.h - dy } : { w: o.w + dx, h: o.h + dy }
        if (ev.shiftKey) {
          const pw = (patch.w ?? o.w), ph = (patch.h ?? o.h)
          if (Math.abs(pw) > Math.abs(ph)) patch.h = 0; else patch.w = 0
          if (d.handle === 'start') { patch.x = o.x + o.w - (patch.w ?? 0); patch.y = o.y + o.h - (patch.h ?? 0) }
        }
      } else {
        let l = o.x, t = o.y, r = o.x + o.w, b = o.y + o.h
        if (d.handle!.includes('w')) l += dx; else r += dx
        if (d.handle!.includes('n')) t += dy; else b += dy
        if (o.type === 'image' && !ev.shiftKey && d.kind === 'resize') {
          const ratio = o.w / o.h
          const nw = Math.abs(r - l)
          const nh = nw / ratio
          if (d.handle!.includes('n')) t = b - nh; else b = t + nh
        }
        patch = { x: Math.min(l, r), y: Math.min(t, b), w: Math.max(Math.abs(r - l), MIN), h: Math.max(Math.abs(b - t), MIN) }
        if (o.type === 'text') patch.h = Math.max(patch.h!, o.size * LINE_HEIGHT)
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
          const def = created.type === 'line' ? { w: 120, h: 0 } : { w: 120, h: created.type === 'rect' && (created as { origin?: string }).origin === 'hl' ? 16 : 60 }
          updateObj(d.page, d.id, def, false)
        }
        undoStack.current.push(d.snapshot); redoStack.current = []; setDirty(true)
        if (created?.type === 'text') setEditingId(created.id)
        setTool('select')
      } else if (d.moved) {
        undoStack.current.push(d.snapshot); redoStack.current = []; setDirty(true)
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
    if (tool === 'select' || tool === 'edit') { setSel(null); return }
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
      case 'highlight': obj = { ...base, type: 'rect', fill: '#ffe066', stroke: null, strokeWidth: 0, opacity: 0.4, origin: 'hl' } as EditorObj; break
      default: return
    }
    const snapshot = pagesRef.current
    const next = pagesRef.current.map(pg => pg.key !== page.key ? pg : { ...pg, objects: [...pg.objects, obj] })
    setPages(next)
    setSel({ page: page.key, id: obj.id })
    startDrag(e, page, obj, tool === 'text' ? 'move' : 'create', tool === 'line' ? 'end' : 'se', snapshot)
    if (drag.current) drag.current.kind = 'create'
  }

  /* ---------- текст PDF для режима правки ---------- */

  useEffect(() => {
    if (tool !== 'edit') return
    let alive = true
    ;(async () => {
      const out: Record<string, Run[]> = {}
      for (const p of pagesRef.current) {
        if (!p.srcId) continue
        const doc = docs.get(p.srcId)
        if (!doc) continue
        const pp = pdfPages.current.get(p.key) || await doc.getPage(p.srcIndex + 1)
        out[p.key] = await extractRuns(pp, p.rotation)
      }
      if (alive) setRuns(out)
    })()
    return () => { alive = false }
  }, [tool, docs, pages.length, pages.map(p => p.rotation).join()])

  /* ---------- клавиатура ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (pagesRef.current.length) save(); return }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return }
      if (mod && e.key.toLowerCase() === 'c' && selected) { clipboard.current = selected; return }
      if (mod && e.key.toLowerCase() === 'v' && clipboard.current) {
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
    ['select', <MousePointer2 key="s" size={16} />, 'Выбор и перемещение (Esc)'],
    ['edit', <TextCursorInput key="e" size={16} />, 'Править текст PDF — кликните по строке'],
    ['text', <Type key="t" size={16} />, 'Добавить текст'],
    ['rect', <Square key="r" size={16} />, 'Прямоугольник'],
    ['ellipse', <Circle key="c" size={16} />, 'Эллипс'],
    ['line', <Minus key="l" size={16} />, 'Линия (Shift — ровно)'],
    ['whiteout', <Eraser key="w" size={16} />, 'Замазка — скрыть элемент'],
    ['highlight', <Highlighter key="h" size={16} />, 'Выделение маркером'],
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
          <p>Перетащите сюда готовое КП или любой PDF — или выберите файл.</p>
          <button className="btn btn-primary" onClick={() => pickFile('application/pdf,.pdf', openFile)} disabled={!!busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {busy || 'Открыть PDF'}
          </button>
          <button className="btn btn-ghost" onClick={() => {
            const page: EditorPage = { key: uid(), srcId: null, srcIndex: 0, box: { x: 0, y: 0, ...A4 }, rotation: 0, objects: [] }
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
        <button className="pe-tool" title="Вставить изображение / печать / подпись" onClick={() => pickFile('image/*', insertImage)}><ImagePlus size={16} /></button>
        <span className="pe-sep" />
        <button className="pe-tool" title="Добавить пустую страницу после текущей" onClick={addBlank}><FilePlus2 size={16} /></button>
        <button className="pe-tool" title="Вставить страницы из другого PDF после текущей" onClick={() => pickFile('application/pdf,.pdf', insertPdf)}><FileInput size={16} /></button>
        <span className="pe-sep" />
        <div className="pe-props">
          {textSel && <>
            <select value={textSel.family} onChange={e => { patch({ family: e.target.value as FontFamily }); setDefaults(d => ({ ...d, family: e.target.value as FontFamily })) }}>
              <option value="sans">DejaVu Sans</option>
              <option value="serif">DejaVu Serif</option>
            </select>
            <input type="number" min={4} max={200} step={0.5} value={textSel.size} title="Размер, pt"
              onChange={e => { const v = +e.target.value || 12; patch({ size: v, h: Math.max(textSel.h, v * LINE_HEIGHT) }); setDefaults(d => ({ ...d, size: v })) }} />
            <button className={`pe-tool ${textSel.bold ? 'on' : ''}`} onClick={() => patch({ bold: !textSel.bold })}><Bold size={14} /></button>
            <button className={`pe-tool ${textSel.italic ? 'on' : ''}`} onClick={() => patch({ italic: !textSel.italic })}><Italic size={14} /></button>
            <button className={`pe-tool ${textSel.underline ? 'on' : ''}`} onClick={() => patch({ underline: !textSel.underline })}><Underline size={14} /></button>
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
          {selected && <>
            <label className="pe-op" title="Непрозрачность">
              <input type="range" min={0.05} max={1} step={0.05} value={selected.opacity} onChange={e => updateObj(sel!.page, sel!.id, { opacity: +e.target.value }, false)}
                onPointerUp={() => { undoStack.current.push(pagesRef.current); setDirty(true) }} />
            </label>
            <button className="pe-tool" title="На передний план" onClick={() => reorder(true)}><BringToFront size={14} /></button>
            <button className="pe-tool" title="На задний план" onClick={() => reorder(false)}><SendToBack size={14} /></button>
            <button className="pe-tool" title="Дублировать (Ctrl+D)" onClick={duplicateSelected}><Copy size={14} /></button>
            <button className="pe-tool danger" title="Удалить (Delete)" onClick={deleteSelected}><Trash2 size={14} /></button>
          </>}
          {!selected && tool === 'edit' && <span className="pe-hint">Кликните по любой строке текста в документе, чтобы изменить её</span>}
          {!selected && tool === 'select' && <span className="pe-hint">Двойной клик по тексту — редактировать. Перетащите PDF или картинку в окно — вставить.</span>}
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
                onClick={() => { setCurPage(p.key); document.getElementById(`pe-page-${p.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
                <div className="pe-thumb-img" style={{ width: vs.w * tz, height: vs.h * tz }}>
                  <PdfCanvas doc={p.srcId ? docs.get(p.srcId) : undefined} page={p} zoom={tz} />
                  <div className="pe-layer static">
                    {p.objects.map(o => <ObjectView key={o.id} o={o} zoom={tz} images={images.current} />)}
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
            const replaced = new Set(p.objects.map(o => (o as { origin?: string }).origin).filter(Boolean))
            return (
              <section key={p.key} id={`pe-page-${p.key}`} className={`pe-page ${curPage === p.key ? 'on' : ''}`}>
                <div className="pe-page-label">Стр. {i + 1} из {pages.length}</div>
                <div className="pe-sheet" style={{ width: vs.w * zoom, height: vs.h * zoom }}>
                  <PdfCanvas doc={p.srcId ? docs.get(p.srcId) : undefined} page={p} zoom={zoom}
                    onRendered={pp => pdfPages.current.set(p.key, pp)} />
                  <div className={`pe-layer tool-${tool}`} onPointerDown={e => onLayerDown(e, p)}>
                    {p.objects.map(o => {
                      const isSel = sel?.page === p.key && sel.id === o.id
                      return (
                        <div key={o.id} className={`pe-wrap ${isSel ? 'sel' : ''}`}
                          onPointerDown={e => {
                            if (tool !== 'select' && tool !== 'edit') return
                            e.stopPropagation()
                            if (editingId === o.id) return
                            if (editingId) setEditingId(null)
                            setCurPage(p.key); setSel({ page: p.key, id: o.id }); setTool('select')
                            startDrag(e, p, o, 'move')
                          }}
                          onDoubleClick={() => { if (o.type === 'text') setEditingId(o.id) }}>
                          <ObjectView o={o} zoom={zoom} images={images.current} editing={editingId === o.id}
                            onEditChange={(text, h) => updateObj(p.key, o.id, { text, h: Math.max(h, (o as TextObj).size * LINE_HEIGHT) }, false)}
                            onEditDone={() => { setEditingId(null); undoStack.current.push(pagesRef.current); setDirty(true) }} />
                          {isSel && editingId !== o.id && <SelectionBox o={o} zoom={zoom} onHandle={(e, h) => { e.stopPropagation(); startDrag(e, p, o, 'resize', h) }} />}
                        </div>
                      )
                    })}
                    {tool === 'edit' && runs[p.key]?.filter(r => !replaced.has(r.key)).map(r => (
                      <div key={r.key} className="pe-run" title={r.str}
                        style={{ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom }}
                        onPointerDown={e => { e.stopPropagation(); setCurPage(p.key); replaceRun(p, r) }} />
                    ))}
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
  return <>
    <div className="pe-selbox" style={{ left: l, top: t, width: r - l, height: b - t }} />
    {([['nw', l, t], ['ne', r, t], ['sw', l, b], ['se', r, b]] as const).map(([h, x, y]) => (
      <span key={h} className={`pe-handle h-${h}`} style={{ left: x, top: y }} onPointerDown={e => onHandle(e, h)} />
    ))}
  </>
}
