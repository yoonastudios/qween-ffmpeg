'use client'
import { useState, useRef, useEffect } from 'react'
import { DropZone, Btn, Card, SectionTitle,
         LogBox, ErrorBox, ResultPreview, PillGroup, UploadProgress } from '@/components/ui'
import { TrimScrubber } from '@/components/ui/VideoEditors'
import { uploadVideo, downloadUrl, extractFilmstrip, VIDEO_FORMATS } from '@/lib/api'
import type { VideoFormat, VideoUploadResult } from '@/lib/api'

type Stage = 'idle' | 'uploading' | 'ready' | 'queued' | 'processing' | 'done' | 'error'

export default function TrimTool({ apiBase, initialUpload, onChainConsumed, onChainTo }: {
  apiBase: string
  initialUpload?: VideoUploadResult
  onChainConsumed?: () => void
  onChainTo?: (jobId: string, toolId: string) => void
}) {
  const [file, setFile]       = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [stage, setStage]     = useState<Stage>('idle')
  const [upload, setUpload]   = useState<VideoUploadResult | null>(null)
  const [jobId, setJobId]     = useState<string | null>(null)
  const [log, setLog]         = useState<string[]>([])
  const [error, setError]     = useState('')
  const [uploadPct, setUploadPct] = useState(0)
  const [progress, setProgress]   = useState(0)
  const [message, setMessage]     = useState('')
  const [resultMb, setResultMb]   = useState<number | null>(null)
  const [resultFmt, setResultFmt] = useState('')
  const [format, setFormat]   = useState<VideoFormat>('mp4')
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd]     = useState(0)
  const [filmstripUrl, setFilmstripUrl] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const addLog = (m: string) => setLog(p => [...p, m])

  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const loadFilmstrip = async (jid: string) => {
    setFilmstripUrl(null)
    try {
      const r = await extractFilmstrip(jid, 12, 140, apiBase)
      setFilmstripUrl(downloadUrl(r.job_id, apiBase))
    } catch { /* non-critical — scrubber falls back to a plain track */ }
  }

  // Stage 2.1: a previous tool's output was sent here via "Send to Trim" —
  // skip the upload step and start straight from 'ready'.
  useEffect(() => {
    if (!initialUpload) return
    setUpload(initialUpload)
    setTrimStart(0); setTrimEnd(Number(initialUpload.duration))
    setPreviewUrl(downloadUrl(initialUpload.job_id, apiBase))
    addLog(`✓ Received from previous step · ${initialUpload.width}×${initialUpload.height} · ${Number(initialUpload.duration).toFixed(1)}s`)
    setStage('ready')
    loadFilmstrip(initialUpload.job_id)
    onChainConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUpload])

  const startPoll = (jid: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${apiBase}/jobs/${jid}/status`)
        const d = await r.json()
        setProgress(d.progress ?? 0); setMessage(d.message ?? '')
        if (d.status === 'done') {
          clearInterval(pollRef.current!)
          setResultMb(d.size_mb); setResultFmt(d.format ?? format)
          setStage('done')
          addLog(`✓ Done — ${d.size_mb} MB · ${(d.format ?? format).toUpperCase()}`)
        } else if (d.status === 'error') {
          clearInterval(pollRef.current!)
          setError(d.message); setStage('error')
        } else if (d.status === 'processing') {
          setStage('processing')
        }
      } catch {}
    }, 1200)
  }

  const handleFile = async (f: File) => {
    setFile(f); setError(''); setLog([]); setUploadPct(0); setStage('uploading')
    addLog(`Uploading ${f.name}…`)
    try {
      const r = await uploadVideo(f, apiBase, setUploadPct)
      setUpload(r)
      setTrimStart(0); setTrimEnd(Number(r.duration))
      addLog(`✓ ${r.width}×${r.height} · ${Number(r.duration).toFixed(1)}s`)
      setStage('ready')
      loadFilmstrip(r.job_id)
    } catch (e: any) { setError(e.message); setStage('idle') }
  }

  const handleRun = async () => {
    if (!upload) return
    setStage('queued'); setError(''); setProgress(0); setMessage('Queuing…')
    addLog(`Processing → ${format.toUpperCase()}…`)
    try {
      const fd = new FormData()
      const params: Record<string, string> = {
        format, async_mode: 'true',
        trim_start: String(trimStart), trim_end: String(trimEnd),
      }
      Object.entries(params).forEach(([k, v]) => fd.append(k, v))
      const r = await fetch(`${apiBase}/jobs/${upload.job_id}/process`, { method: 'POST', body: fd })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail ?? 'Process failed')
      setJobId(upload.job_id)
      addLog('Job queued — polling for progress…')
      startPoll(upload.job_id)
    } catch (e: any) { setError(e.message); setStage('ready') }
  }

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    setFile(null); setUpload(null); setJobId(null); setLog([]); setError('')
    setStage('idle'); setProgress(0); setMessage(''); setResultMb(null)
    setTrimStart(0); setTrimEnd(0); setFilmstripUrl(null)
  }

  const isWorking = stage === 'queued' || stage === 'processing'

  return (
    <div className="flex flex-col gap-4 pb-6">
      <DropZone onFile={handleFile} loading={stage === 'uploading'} file={file}
        accept=".mp4,.mov,.webm,.avi,.mkv"
        label="Drop a video file to trim"
        sub="MP4 · MOV · WebM · AVI · MKV" />

      {stage === 'uploading' && (
        <Card className="p-4 flex flex-col gap-3">
          <UploadProgress pct={uploadPct} label="Uploading video…" />
          <span className="text-sub text-xs font-mono text-center">{uploadPct >= 100 ? 'Processing…' : 'Uploading…'}</span>
        </Card>
      )}

      {(stage === 'ready' || isWorking || stage === 'done' || stage === 'error') && upload && previewUrl && (
        <Card className="p-4 flex flex-col gap-5">
          <div>
            <SectionTitle>Drag handles to trim</SectionTitle>
            <TrimScrubber
              src={previewUrl} duration={Number(upload.duration)} filmstripUrl={filmstripUrl}
              start={trimStart} end={trimEnd}
              onChange={(s, e) => { setTrimStart(s); setTrimEnd(e) }}
            />
          </div>
          <div>
            <SectionTitle>Output Format</SectionTitle>
            <PillGroup options={VIDEO_FORMATS} value={format} onChange={v => setFormat(v as VideoFormat)} />
          </div>
        </Card>
      )}

      {isWorking && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-sub">{message || (stage === 'queued' ? 'Waiting in queue…' : 'Processing…')}</span>
            <span className="text-accent">{progress}%</span>
          </div>
          <div className="h-1.5 bg-bg border border-border rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-300 shimmer"
              style={{ width: `${Math.max(progress, 8)}%` }} />
          </div>
          {stage === 'queued' && <p className="text-[10px] text-muted font-mono">⏳ Another job is running — yours is queued</p>}
        </Card>
      )}

      <LogBox lines={log} />
      <ErrorBox message={error} />

      {stage === 'done' && jobId && (
        <ResultPreview
          jobId={jobId} mb={resultMb} fmt={resultFmt} apiBase={apiBase} label="Trimmed"
          sendToOptions={[{ id: 'crop', label: 'Crop' }]}
          onSendTo={toolId => onChainTo?.(jobId, toolId)}
          onReset={reset}
        />
      )}

      {(stage === 'ready' || stage === 'error') && (
        <Btn onClick={handleRun} fullWidth>
          ✂ Trim to {format.toUpperCase()}
        </Btn>
      )}
    </div>
  )
}
