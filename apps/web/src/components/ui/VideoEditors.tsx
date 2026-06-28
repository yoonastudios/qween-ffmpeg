'use client'
import { useRef, useState, useEffect } from 'react'

// ════════════════════════════════════════════════════════════════════════════
// CropOverlay — drag/resize a rectangle directly on the video frame instead
// of typing x/y/w/h. All dragging happens in *rendered* pixel space; values
// are converted to the video's *natural* pixel space only when committed via
// onChange, since the on-screen size rarely matches the source resolution.
// ════════════════════════════════════════════════════════════════════════════
export interface CropRect { x: number; y: number; w: number; h: number }

const CROP_PRESETS: { label: string; ratio: number | null }[] = [
  { label: 'Free', ratio: null },
  { label: '1:1',  ratio: 1 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '4:5',  ratio: 4 / 5 },
]

type DragMode = 'move' | 'tl' | 'tr' | 'bl' | 'br'

export function CropOverlay({
  src, naturalWidth, naturalHeight, value, onChange,
}: {
  src: string; naturalWidth: number; naturalHeight: number
  value: CropRect; onChange: (r: CropRect) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1) // rendered px per natural px
  const [activeRatio, setActiveRatio] = useState<number | null>(null)
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; startRect: CropRect } | null>(null)

  useEffect(() => {
    const measure = () => { if (containerRef.current) setScale(containerRef.current.clientWidth / naturalWidth) }
    measure()
    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [naturalWidth])

  const clamp = (r: CropRect): CropRect => {
    let { x, y, w, h } = r
    w = Math.max(20, Math.min(w, naturalWidth))
    h = Math.max(20, Math.min(h, naturalHeight))
    x = Math.max(0, Math.min(x, naturalWidth - w))
    y = Math.max(0, Math.min(y, naturalHeight - h))
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
  }

  const onPointerMove = (e: PointerEvent) => {
    const ds = dragRef.current
    if (!ds) return
    const dx = (e.clientX - ds.startX) / scale
    const dy = (e.clientY - ds.startY) / scale
    let next: CropRect
    if (ds.mode === 'move') {
      next = { ...ds.startRect, x: ds.startRect.x + dx, y: ds.startRect.y + dy }
    } else {
      let { x, y, w, h } = ds.startRect
      if (ds.mode.includes('l')) { x = ds.startRect.x + dx; w = ds.startRect.w - dx }
      if (ds.mode.includes('r')) { w = ds.startRect.w + dx }
      if (ds.mode.includes('t')) { y = ds.startRect.y + dy; h = ds.startRect.h - dy }
      if (ds.mode.includes('b')) { h = ds.startRect.h + dy }
      if (activeRatio) {
        h = w / activeRatio
        if (ds.mode.includes('t')) y = ds.startRect.y + ds.startRect.h - h
      }
      next = { x, y, w, h }
    }
    onChange(clamp(next))
  }
  const onPointerUp = () => {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }
  const onPointerDown = (mode: DragMode) => (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault()
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, startRect: { ...value } }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  const applyPreset = (ratio: number | null) => {
    setActiveRatio(ratio)
    if (ratio === null) return
    let w = value.w, h = w / ratio
    if (h > naturalHeight) { h = naturalHeight; w = h * ratio }
    if (w > naturalWidth)  { w = naturalWidth;  h = w / ratio }
    const x = value.x + (value.w - w) / 2
    const y = value.y + (value.h - h) / 2
    onChange(clamp({ x, y, w, h }))
  }

  const HANDLE = 'absolute w-5 h-5 bg-white border-2 border-accent rounded-full shadow touch-none -m-2.5'

  return (
    <div className="flex flex-col gap-3">
      <div ref={containerRef}
        className="relative w-full rounded-xl overflow-hidden bg-black select-none touch-none"
        style={{ aspectRatio: `${naturalWidth} / ${naturalHeight}` }}>
        <video src={src} className="w-full h-full object-contain pointer-events-none"
          muted playsInline preload="metadata" />
        <div
          onPointerDown={onPointerDown('move')}
          className="absolute border-2 border-accent cursor-move"
          style={{
            left: value.x * scale, top: value.y * scale,
            width: value.w * scale, height: value.h * scale,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
          }}>
          <div onPointerDown={onPointerDown('tl')} className={HANDLE} style={{ left: 0, top: 0, cursor: 'nwse-resize' }} />
          <div onPointerDown={onPointerDown('tr')} className={HANDLE} style={{ left: '100%', top: 0, cursor: 'nesw-resize' }} />
          <div onPointerDown={onPointerDown('bl')} className={HANDLE} style={{ left: 0, top: '100%', cursor: 'nesw-resize' }} />
          <div onPointerDown={onPointerDown('br')} className={HANDLE} style={{ left: '100%', top: '100%', cursor: 'nwse-resize' }} />
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {CROP_PRESETS.map(p => (
          <button key={p.label} onClick={() => applyPreset(p.ratio)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors select-none
              ${activeRatio === p.ratio ? 'bg-accent border-accent text-white' : 'bg-bg border-border text-sub hover:border-accent/50'}`}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// TrimScrubber — drag start/end handles on a timeline (with a filmstrip
// background once it loads) instead of typing seconds. Dragging a handle
// scrubs the video preview live to that timestamp.
// ════════════════════════════════════════════════════════════════════════════
function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1).padStart(4, '0')
  return `${m}:${sec}`
}

export function TrimScrubber({
  src, duration, filmstripUrl, start, end, onChange,
}: {
  src: string; duration: number; filmstripUrl?: string | null
  start: number; end: number; onChange: (start: number, end: number) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef  = useRef<'start' | 'end' | null>(null)

  const timeFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el || !duration) return 0
    const rect = el.getBoundingClientRect()
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return pct * duration
  }

  const onPointerMove = (e: PointerEvent) => {
    const mode = dragRef.current
    if (!mode) return
    const t = timeFromClientX(e.clientX)
    let nextStart = start, nextEnd = end
    if (mode === 'start') nextStart = Math.max(0, Math.min(t, end - 0.1))
    else                  nextEnd   = Math.min(duration, Math.max(t, start + 0.1))
    onChange(nextStart, nextEnd)
    if (videoRef.current) videoRef.current.currentTime = mode === 'start' ? nextStart : nextEnd
  }
  const onPointerUp = () => {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }
  const onPointerDown = (mode: 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    dragRef.current = mode
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  const startPct = duration ? (start / duration) * 100 : 0
  const endPct   = duration ? (end / duration) * 100 : 100

  return (
    <div className="flex flex-col gap-3">
      <video ref={videoRef} src={src} className="w-full rounded-xl bg-black block"
        style={{ maxHeight: 280 }} muted playsInline preload="metadata" controls />

      <div ref={trackRef}
        className="relative h-14 rounded-xl overflow-hidden bg-bg border border-border touch-none select-none"
        style={filmstripUrl ? { backgroundImage: `url(${filmstripUrl})`, backgroundSize: '100% 100%' } : undefined}>
        {!filmstripUrl && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-muted">
            Loading preview…
          </div>
        )}
        <div className="absolute inset-y-0 left-0 bg-black/60 pointer-events-none" style={{ width: `${startPct}%` }} />
        <div className="absolute inset-y-0 right-0 bg-black/60 pointer-events-none" style={{ width: `${100 - endPct}%` }} />
        <div className="absolute inset-y-0 border-y-2 border-accent pointer-events-none"
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }} />
        <div onPointerDown={onPointerDown('start')}
          className="absolute inset-y-0 w-4 -ml-2 cursor-ew-resize touch-none flex items-center justify-center z-10"
          style={{ left: `${startPct}%` }}>
          <div className="w-1 h-7 bg-accent rounded-full shadow" />
        </div>
        <div onPointerDown={onPointerDown('end')}
          className="absolute inset-y-0 w-4 -ml-2 cursor-ew-resize touch-none flex items-center justify-center z-10"
          style={{ left: `${endPct}%` }}>
          <div className="w-1 h-7 bg-accent rounded-full shadow" />
        </div>
      </div>

      <div className="flex justify-between text-[11px] font-mono">
        <span className="text-accent">{fmtTime(start)}</span>
        <span className="text-muted">{fmtTime(duration)} total · {fmtTime(end - start)} selected</span>
        <span className="text-accent">{fmtTime(end)}</span>
      </div>
    </div>
  )
}
