'use client'
import { useState, useRef } from 'react'
import { DropZone, Btn, Card, Field, NumInput, SectionTitle,
         LogBox, ErrorBox, ResultPreview, PillGroup, UploadProgress } from '@/components/ui'
import { uploadVideo, processVideo, VIDEO_FORMATS, CRF_RANGE } from '@/lib/api'
import type { VideoFormat, VideoUploadResult, QueuedJobResult } from '@/lib/api'

type Stage = 'idle' | 'uploading' | 'ready' | 'queued' | 'processing' | 'done' | 'error'

// Combines Crop + Trim + Scale + Speed into ONE /process call — one ffmpeg
// pass, one decode/encode generation, instead of running each tool
// separately (which would re-decode/re-encode the file 4 times).
export default function PipelineTool({ apiBase }: { apiBase: string }) {
  const [file, setFile]       = useState<File | null>(null)
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
  const [crf, setCrf]         = useState(18)

  const [cropOn, setCropOn]   = useState(false)
  const [cropX, setCropX] = useState(''); const [cropY, setCropY] = useState('')
  const [cropW, setCropW] = useState(''); const [cropH, setCropH] = useState('')

  const [trimOn, setTrimOn]   = useState(false)
  const [trimStart, setTrimStart] = useState(''); const [trimEnd, setTrimEnd] = useState('')

  const [scaleOn, setScaleOn] = useState(false)
  const [scaleW, setScaleW] = useState(''); const [scaleH, setScaleH] = useState('')

  const [speedOn, setSpeedOn] = useState(false)
  const [speed, setSpeed]     = useState('1')

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const addLog = (m: string) => setLog(p => [...p, m])
  const [maxCrf] = CRF_RANGE[format] ?? [0, 51]

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
      setCropW(r.width); setCropH(r.height)
      addLog(`✓ ${r.width}×${r.height} · ${Number(r.duration).toFixed(1)}s`)
      setStage('ready')
    } catch (e: any) { setError(e.message); setStage('idle') }
  }

  const activeSteps = [cropOn, trimOn, scaleOn, speedOn].filter(Boolean).length

  const handleRun = async () => {
    if (!upload) return
    setStage('queued'); setError(''); setProgress(0); setMessage('Queuing…')
    addLog(`Running ${activeSteps || 0} step${activeSteps === 1 ? '' : 's'} in one pass → ${format.toUpperCase()}…`)
    try {
      const r = await processVideo(upload.job_id, {
        format, crf, async_mode: true,
        ...(cropOn  ? { crop_x: Number(cropX || 0), crop_y: Number(cropY || 0), crop_w: Number(cropW), crop_h: Number(cropH) } : {}),
        ...(trimOn  ? { trim_start: trimStart ? Number(trimStart) : undefined, trim_end: trimEnd ? Number(trimEnd) : undefined } : {}),
        ...(scaleOn ? { width: scaleW ? Number(scaleW) : undefined, height: scaleH ? Number(scaleH) : undefined } : {}),
        ...(speedOn ? { speed: Number(speed) } : {}),
      }, apiBase) as QueuedJobResult
      setJobId(r.job_id)
      addLog('Job queued — polling for progress…')
      startPoll(r.job_id)
    } catch (e: any) { setError(e.message); setStage('ready') }
  }

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    setFile(null); setUpload(null); setJobId(null); setLog([]); setError('')
    setStage('idle'); setProgress(0); setMessage(''); setResultMb(null)
    setCropOn(false); setTrimOn(false); setScaleOn(false); setSpeedOn(false)
    setCropX(''); setCropY(''); setCropW(''); setCropH('')
    setTrimStart(''); setTrimEnd(''); setScaleW(''); setScaleH(''); setSpeed('1')
  }

  const isWorking = stage === 'queued' || stage === 'processing'

  const StepToggle = ({ on, onToggle, label, desc }: { on: boolean; onToggle: () => void; label: string; desc: string }) => (
    <button onClick={onToggle}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors
        ${on ? 'bg-accent/10 border-accent/40' : 'bg-bg border-border hover:border-accent/30'}`}>
      <div className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0
        ${on ? 'bg-accent border-accent' : 'border-border'}`}>
        {on && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5"><polyline points="20 6 9 17 4 12"/></svg>}
      </div>
      <div className="flex-1">
        <p className="text-xs font-mono font-bold text-text">{label}</p>
        <p className="text-[10px] font-mono text-muted">{desc}</p>
      </div>
    </button>
  )

  return (
    <div className="flex flex-col gap-4 pb-6">
      <DropZone onFile={handleFile} loading={stage === 'uploading'} file={file}
        accept=".mp4,.mov,.webm,.avi,.mkv"
        label="Drop a video to run a multi-step edit on"
        sub="MP4 · MOV · WebM · AVI · MKV" />

      {stage === 'uploading' && <UploadProgress pct={uploadPct} label="Uploading video…" />}

      {upload && stage !== 'uploading' && (
        <Card className="px-4 py-3 text-xs font-mono text-muted">
          {upload.width}×{upload.height} · {Number(upload.duration).toFixed(1)}s · {upload.size_mb} MB
        </Card>
      )}

      {(stage === 'ready' || isWorking || stage === 'error') && (
        <>
          <Card className="p-4 flex flex-col gap-2">
            <SectionTitle>Steps (combined into one ffmpeg pass)</SectionTitle>
            <StepToggle on={cropOn}  onToggle={() => setCropOn(p => !p)}   label="Crop"  desc="Cut a region out of the frame" />
            <StepToggle on={trimOn}  onToggle={() => setTrimOn(p => !p)}   label="Trim"  desc="Cut start/end of the clip" />
            <StepToggle on={scaleOn} onToggle={() => setScaleOn(p => !p)}  label="Scale" desc="Resize output dimensions" />
            <StepToggle on={speedOn} onToggle={() => setSpeedOn(p => !p)}  label="Speed" desc="Slow motion or timelapse" />
          </Card>

          {cropOn && (
            <Card className="p-4 flex flex-col gap-3">
              <SectionTitle>Crop Region</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <Field label="X Offset (px)"><NumInput value={cropX} onChange={setCropX} placeholder="0" min={0} /></Field>
                <Field label="Y Offset (px)"><NumInput value={cropY} onChange={setCropY} placeholder="0" min={0} /></Field>
                <Field label="Width (px)"><NumInput value={cropW} onChange={setCropW} placeholder={upload?.width} min={1} /></Field>
                <Field label="Height (px)"><NumInput value={cropH} onChange={setCropH} placeholder={upload?.height} min={1} /></Field>
              </div>
            </Card>
          )}

          {trimOn && (
            <Card className="p-4 flex flex-col gap-3">
              <SectionTitle>Trim Range</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start (s)"><NumInput value={trimStart} onChange={setTrimStart} placeholder="0" min={0} step={0.1} /></Field>
                <Field label="End (s)"><NumInput value={trimEnd} onChange={setTrimEnd} placeholder={upload?.duration} min={0} step={0.1} /></Field>
              </div>
            </Card>
          )}

          {scaleOn && (
            <Card className="p-4 flex flex-col gap-3">
              <SectionTitle>Scale Dimensions</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Width (px)" hint="Leave blank to auto-fit"><NumInput value={scaleW} onChange={setScaleW} placeholder="auto" min={2} /></Field>
                <Field label="Height (px)" hint="Leave blank to auto-fit"><NumInput value={scaleH} onChange={setScaleH} placeholder="auto" min={2} /></Field>
              </div>
            </Card>
          )}

          {speedOn && (
            <Card className="p-4 flex flex-col gap-3">
              <SectionTitle>Speed Multiplier</SectionTitle>
              <Field label="Speed (e.g. 2 = 2x faster, 0.5 = half speed)">
                <NumInput value={speed} onChange={setSpeed} placeholder="1" min={0.1} max={10} step={0.1} />
              </Field>
              <p className="text-[10px] font-mono text-muted">Audio pitch is preserved (tempo-shifted, not just resampled).</p>
            </Card>
          )}

          <Card className="p-4 flex flex-col gap-5">
            <div>
              <SectionTitle>Output Format</SectionTitle>
              <PillGroup options={VIDEO_FORMATS} value={format} onChange={v => setFormat(v as VideoFormat)} />
            </div>
            <div>
              <SectionTitle>Quality (CRF {crf} · lower = better)</SectionTitle>
              <input type="range" min={0} max={maxCrf} value={Math.min(crf, maxCrf)}
                onChange={e => setCrf(Number(e.target.value))}
                className="w-full accent-[#7c6dfa]" />
            </div>
          </Card>
        </>
      )}

      {isWorking && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-sub">{message || (stage === 'queued' ? 'Waiting in queue…' : 'Processing…')}</span>
            <span className="text-accent">{progress}%</span>
          </div>
          <div className="h-1.5 bg-bg border border-border rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${Math.max(progress, 8)}%` }} />
          </div>
        </Card>
      )}

      <LogBox lines={log} />
      <ErrorBox message={error} />

      {stage === 'done' && jobId && (
        <ResultPreview jobId={jobId} mb={resultMb} fmt={resultFmt} apiBase={apiBase} label="Pipeline complete" onReset={reset} />
      )}

      {(stage === 'ready' || stage === 'error') && (
        <Btn onClick={handleRun} disabled={activeSteps === 0} fullWidth>
          ⚡ Run {activeSteps > 0 ? `${activeSteps} Step${activeSteps === 1 ? '' : 's'}` : '(pick at least one step)'}
        </Btn>
      )}
    </div>
  )
}
