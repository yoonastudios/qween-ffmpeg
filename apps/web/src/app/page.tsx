'use client'
import { useState, useEffect, useCallback } from 'react'
import StitchTool   from '@/tools/StitchTool'
import RenderTool   from '@/tools/RenderTool'
import CropTool     from '@/tools/CropTool'
import TrimTool     from '@/tools/TrimTool'
import ScaleTool    from '@/tools/ScaleTool'
import SegmentTool  from '@/tools/SegmentTool'
import MergeTool    from '@/tools/MergeTool'
import PipelineTool from '@/tools/PipelineTool'
import RecentTool   from '@/tools/RecentTool'
import LibraryTool  from '@/tools/LibraryTool'
import AudioTool    from '@/tools/AudioTool'
import { StorageBadge } from '@/components/ui'
import { getStorage, cleanAllJobs, useAsSource } from '@/lib/api'
import type { VideoUploadResult } from '@/lib/api'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api/ffmpeg'

const TOOLS = {
  stitch:   { label: 'Stitch',   desc: 'Frames → Video' },
  render:   { label: 'Render',   desc: 'Project → Video' },
  crop:     { label: 'Crop',     desc: 'Crop region'     },
  trim:     { label: 'Trim',     desc: 'Cut start/end'   },
  scale:    { label: 'Scale',    desc: 'Resize output'   },
  segment:  { label: 'Segment',  desc: 'Split chunks'    },
  merge:    { label: 'Merge',    desc: 'Concat videos'   },
  pipeline: { label: 'Pipeline', desc: 'Crop+Trim+Scale+Speed in one pass' },
  library:  { label: 'Library',  desc: 'Browse outputs'  },
  audio:    { label: 'Audio',    desc: 'Extract / edit / merge audio' },
  recent:   { label: 'Recent',   desc: 'Job history'     },
} as const
type ToolId = keyof typeof TOOLS

type CategoryId = 'build' | 'edit' | 'library' | 'audio' | 'history'
const CATEGORIES: Record<CategoryId, { label: string; tools: ToolId[] }> = {
  build:   { label: 'Build',   tools: ['stitch', 'render'] },
  edit:    { label: 'Edit',    tools: ['crop', 'trim', 'scale', 'segment', 'merge', 'pipeline'] },
  library: { label: 'Library', tools: ['library'] },
  audio:   { label: 'Audio',   tools: ['audio'] },
  history: { label: 'History', tools: ['recent'] },
}
const CATEGORY_OF: Record<ToolId, CategoryId> = {
  stitch: 'build', render: 'build',
  crop: 'edit', trim: 'edit', scale: 'edit', segment: 'edit', merge: 'edit', pipeline: 'edit',
  library: 'library', audio: 'audio',
  recent: 'history',
}

// ── Category tab icons — small line glyphs, accent on active ──────────────────
function CategoryIcon({ id }: { id: CategoryId }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (id === 'build') return (
    <svg {...common}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12v9M12 12L4 7.5M12 12l8-4.5"/></svg>
  )
  if (id === 'edit') return (
    <svg {...common}><path d="M14 3l7 7-9 9H5v-7l9-9z"/><path d="M13 4l7 7"/></svg>
  )
  if (id === 'library') return (
    <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
  )
  if (id === 'audio') return (
    <svg {...common}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
  )
  return (
    <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
  )
}

export default function Home() {
  const [category, setCategory]   = useState<CategoryId>('build')
  const [activeTool, setActiveTool] = useState<ToolId | null>(null)
  const [storageMb, setStorageMb] = useState<number | null>(null)
  const [cleaning, setCleaning]   = useState(false)

  // Stage 2.1: "Send to [tool]" chaining — set when a finished job's output
  // is handed to another tool as its input, cleared once that tool consumes it.
  const [chainTarget, setChainTarget] = useState<{ toolId: ToolId; upload: VideoUploadResult } | null>(null)
  const [chainError, setChainError]   = useState('')

  const fetchStorage = useCallback(async () => {
    try { setStorageMb((await getStorage(API_BASE)).storage_used_mb) } catch {}
  }, [])

  useEffect(() => {
    fetchStorage()
    const id = setInterval(fetchStorage, 30_000)
    return () => clearInterval(id)
  }, [fetchStorage])

  const handleClean = async () => {
    if (!confirm('Delete all jobs and free storage?')) return
    setCleaning(true)
    try {
      const r = await cleanAllJobs(API_BASE)
      alert(`Deleted ${r.deleted_jobs} job(s).`)
      setStorageMb(0)
    } catch (e: any) { alert(e.message) }
    finally { setCleaning(false) }
  }

  const openTool = (id: ToolId) => { setCategory(CATEGORY_OF[id]); setActiveTool(id) }

  const handleTabTap = (cat: CategoryId) => {
    setCategory(cat)
    const tools = CATEGORIES[cat].tools
    setActiveTool(tools.length === 1 ? tools[0] : null)
  }

  const handleChainTo = async (jobId: string, toolId: string) => {
    const id = toolId as ToolId
    setChainError('')
    try {
      const upload = await useAsSource(jobId, API_BASE)
      setChainTarget({ toolId: id, upload })
      openTool(id)
    } catch (e: any) { setChainError(e.message) }
  }

  const goBack = () => setActiveTool(null)
  const inLanding = activeTool === null
  const currentCategory = CATEGORIES[category]
  const showBack = !inLanding && currentCategory.tools.length > 1

  return (
    <div className="h-[100dvh] flex flex-col bg-bg">

      {/* Top bar — persistent, swaps logo↔back depending on depth */}
      <header className="flex items-center justify-between px-4 flex-shrink-0 bg-panel border-b border-border"
        style={{ paddingTop: 'env(safe-area-inset-top)', height: 52 }}>
        <div className="flex items-center gap-2 min-w-0">
          {showBack ? (
            <button onClick={goBack} className="flex items-center gap-1.5 text-sub hover:text-text transition-colors active:scale-95 select-none">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
              <span className="text-xs font-mono font-bold uppercase tracking-wide">{currentCategory.label}</span>
            </button>
          ) : (
            <div className="w-7 h-7 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M15 10L19.553 7.724A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
                  stroke="#7c6dfa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          )}
          {!showBack && (
            <span className="text-sm font-bold text-text tracking-tight font-mono truncate">QweenFFmpeg</span>
          )}
          {!inLanding && (
            <span className="text-xs font-mono text-muted truncate hidden sm:inline">
              · {TOOLS[activeTool].label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] font-mono text-muted bg-bg border border-border rounded-md px-2 py-0.5 hidden sm:inline">
            {inLanding ? currentCategory.label : TOOLS[activeTool].desc}
          </span>
          {storageMb !== null && <StorageBadge mb={storageMb} onClean={handleClean} />}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 pt-4" style={{ paddingBottom: 'calc(80px + env(safe-area-inset-bottom))' }}>
        {chainError && (
          <div className="bg-red/5 border border-red/20 rounded-xl px-4 py-3 text-xs font-mono text-red mb-4">
            ✗ {chainError}
          </div>
        )}

        {inLanding ? (
          /* ── Category landing: grid of tool cards ──────────────────────── */
          <div className="grid grid-cols-2 gap-3">
            {currentCategory.tools.map(id => (
              <button key={id} onClick={() => openTool(id)}
                className="bg-panel border border-border rounded-2xl p-4 text-left flex flex-col gap-1
                  hover:border-accent/50 active:scale-[0.97] transition-all select-none">
                <span className="text-sm font-semibold text-text">{TOOLS[id].label}</span>
                <span className="text-[11px] font-mono text-muted">{TOOLS[id].desc}</span>
              </button>
            ))}
          </div>
        ) : (
          /* ── Tool detail view ──────────────────────────────────────────── */
          <>
            {activeTool === 'stitch'  && <StitchTool  apiBase={API_BASE} />}
            {activeTool === 'render'  && <RenderTool  apiBase={API_BASE} onChainTo={handleChainTo} />}
            {activeTool === 'crop'    && (
              <CropTool apiBase={API_BASE} onChainTo={handleChainTo}
                initialUpload={chainTarget?.toolId === 'crop' ? chainTarget.upload : undefined}
                onChainConsumed={() => setChainTarget(null)} />
            )}
            {activeTool === 'trim'    && (
              <TrimTool apiBase={API_BASE} onChainTo={handleChainTo}
                initialUpload={chainTarget?.toolId === 'trim' ? chainTarget.upload : undefined}
                onChainConsumed={() => setChainTarget(null)} />
            )}
            {activeTool === 'scale'   && <ScaleTool   apiBase={API_BASE} />}
            {activeTool === 'segment' && <SegmentTool apiBase={API_BASE} />}
            {activeTool === 'merge'    && <MergeTool    apiBase={API_BASE} />}
            {activeTool === 'pipeline' && <PipelineTool apiBase={API_BASE} />}
            {activeTool === 'library' && <LibraryTool apiBase={API_BASE} />}
            {activeTool === 'audio'   && <AudioTool   apiBase={API_BASE} />}
            {activeTool === 'recent'  && <RecentTool  apiBase={API_BASE} />}
          </>
        )}
      </div>

      {/* Bottom nav — 3 category tabs, persistent */}
      <nav className="flex-shrink-0 bg-panel border-t border-border flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {(Object.keys(CATEGORIES) as CategoryId[]).map(cat => {
          const isActive = category === cat
          return (
            <button key={cat} onClick={() => handleTabTap(cat)}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors select-none
                ${isActive ? 'text-accent' : 'text-muted hover:text-sub'}`}>
              <CategoryIcon id={cat} />
              <span className="text-[10px] font-mono font-bold uppercase tracking-wide">{CATEGORIES[cat].label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
