'use client'
import { useState, useEffect, useCallback } from 'react'
import { Card, SectionTitle, Btn, DownloadBtn, ErrorBox, PillGroup } from '@/components/ui'
import { listJobs, mergeExisting, getJobStatus, downloadUrl, FORMAT_LABELS, VIDEO_FORMATS } from '@/lib/api'
import type { JobRecord, VideoFormat } from '@/lib/api'

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() / 1000) - ts)
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

type Stage = 'browsing' | 'queued' | 'processing' | 'done' | 'error'

export default function LibraryTool({ apiBase }: { apiBase: string }) {
  const [jobs, setJobs]       = useState<JobRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [format, setFormat]   = useState<VideoFormat>('mp4')
  const [stage, setStage]     = useState<Stage>('browsing')
  const [jobId, setJobId]     = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [resultMb, setResultMb] = useState<number | null>(null)

  const fetchJobs = useCallback(async () => {
    setError('')
    try {
      const r = await listJobs(apiBase)
      // Only finished video outputs are mergeable — exclude audio-only jobs.
      setJobs(r.jobs.filter(j => j.has_output && !j.is_audio))
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [apiBase])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  const toggle = (id: string) =>
    setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  const moveUp = (i: number) => {
    if (i === 0) return
    setSelected(p => { const a = [...p]; [a[i-1], a[i]] = [a[i], a[i-1]]; return a })
  }
  const moveDown = (i: number) => {
    setSelected(p => { if (i >= p.length - 1) return p; const a = [...p]; [a[i], a[i+1]] = [a[i+1], a[i]]; return a })
  }

  const startPoll = (jid: string) => {
    const id = setInterval(async () => {
      try {
        const s = await getJobStatus(jid, apiBase)
        setProgress(s.progress ?? 0)
        setMessage(s.message ?? '')
        if (s.status === 'done') {
          clearInterval(id); setResultMb(s.size_mb ?? null); setStage('done')
        } else if (s.status === 'error') {
          clearInterval(id); setError(s.message); setStage('error')
        }
      } catch {}
    }, 1000)
  }

  const handleMerge = async () => {
    if (selected.length < 2) return
    setError(''); setStage('queued'); setProgress(0)
    try {
      const r = await mergeExisting(selected, format, apiBase)
      setJobId(r.job_id)
      setStage('processing')
      startPoll(r.job_id)
    } catch (e: any) { setError(e.message); setStage('browsing') }
  }

  const reset = () => {
    setSelected([]); setJobId(null); setProgress(0); setMessage('')
    setResultMb(null); setStage('browsing'); fetchJobs()
  }

  const jobLabel = (j: JobRecord) => j.label || j.input_file || j.job_id.slice(0, 8)

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <span className="text-sub text-sm font-mono">Loading library…</span>
    </div>
  )

  if (stage === 'done' && jobId) return (
    <div className="flex flex-col gap-4 pb-6">
      <Card className="p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
          <span className="text-sm font-semibold text-text">
            Merged · {resultMb} MB · {FORMAT_LABELS[format]}
          </span>
        </div>
        <DownloadBtn href={downloadUrl(jobId, apiBase)} label={`Download ${FORMAT_LABELS[format]}`} />
        <Btn onClick={reset} variant="ghost" fullWidth>Back to Library</Btn>
      </Card>
    </div>
  )

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted">
          {jobs.length} output{jobs.length !== 1 ? 's' : ''} · select 2+ to merge
        </p>
        <button onClick={fetchJobs} className="text-[11px] font-mono text-accent active:scale-95">Refresh</button>
      </div>

      <ErrorBox message={error} />

      {jobs.length === 0 && (
        <Card className="p-10 flex flex-col items-center gap-2">
          <p className="text-sm text-muted">No finished outputs yet — process something first</p>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {jobs.map(job => {
          const isSelected = selected.includes(job.job_id)
          return (
            <div key={job.job_id}
              className={`bg-panel border rounded-2xl p-3 flex items-center gap-3 cursor-pointer transition-colors
                ${isSelected ? 'border-accent/60' : 'border-border'}`}
              onClick={() => toggle(job.job_id)}>
              <div className={`w-5 h-5 rounded-lg border flex items-center justify-center shrink-0
                ${isSelected ? 'bg-accent border-accent' : 'border-border bg-bg'}`}>
                {isSelected && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-text truncate">{jobLabel(job)}</p>
                <p className="text-[10px] font-mono text-muted mt-0.5">
                  {job.job_id.slice(0, 8)} · {timeAgo(job.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 text-[10px] font-mono text-muted">
                {job.format && <span className="text-accent">{FORMAT_LABELS[job.format] ?? job.format.toUpperCase()}</span>}
                {job.size_mb && <span>{job.size_mb} MB</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Sticky action bar */}
      {selected.length > 0 && stage === 'browsing' && (
        <div className="fixed left-0 right-0 bottom-[64px] px-4 pb-2">
          <Card className="p-4 flex flex-col gap-3 shadow-2xl">
            <SectionTitle>Selected ({selected.length})</SectionTitle>
            <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
              {selected.map((id, i) => {
                const job = jobs.find(j => j.job_id === id)
                return (
                  <div key={id} className="flex items-center gap-2 bg-bg border border-border rounded-xl px-3 py-2">
                    <span className="text-[10px] font-mono text-muted w-4 shrink-0">{i+1}</span>
                    <span className="text-xs font-mono text-text flex-1 truncate">{job ? jobLabel(job) : id.slice(0,8)}</span>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => moveUp(i)} disabled={i===0}
                        className="w-6 h-6 rounded-md bg-panel border border-border text-muted disabled:opacity-20 flex items-center justify-center active:scale-90">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                      </button>
                      <button onClick={() => moveDown(i)} disabled={i===selected.length-1}
                        className="w-6 h-6 rounded-md bg-panel border border-border text-muted disabled:opacity-20 flex items-center justify-center active:scale-90">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                      <button onClick={() => toggle(id)}
                        className="w-6 h-6 rounded-md bg-panel border border-red/20 text-red/60 flex items-center justify-center active:scale-90">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            <PillGroup options={VIDEO_FORMATS} value={format} onChange={v => setFormat(v as VideoFormat)} />
            <Btn onClick={handleMerge} disabled={selected.length < 2} fullWidth>
              ⊕ Merge {selected.length} Selected
            </Btn>
          </Card>
        </div>
      )}

      {(stage === 'queued' || stage === 'processing') && (
        <div className="fixed left-0 right-0 bottom-[64px] px-4 pb-2">
          <Card className="p-4 flex flex-col gap-3 shadow-2xl">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-sub">{message || 'In queue…'}</span>
              <span className="text-accent">{progress}%</span>
            </div>
            <div className="h-1.5 bg-bg border border-border rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
