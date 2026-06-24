'use client'
import { useState, useRef } from 'react'
import { DropZone, Btn, Card, Field, NumInput, SectionTitle,
         LogBox, ErrorBox, DownloadBtn, PillGroup, UploadProgress } from '@/components/ui'
import {
  uploadVideo, uploadAudio, extractAudio, audioProcess, audioMerge,
  audioDownloadUrl, validateAudioFile, AUDIO_FORMATS, AUDIO_FORMAT_LABELS,
} from '@/lib/api'
import type { AudioFormat, VideoUploadResult, AudioUploadResult } from '@/lib/api'

type Mode = 'extract' | 'edit' | 'merge'
type Stage = 'idle' | 'uploading' | 'ready' | 'queued' | 'processing' | 'done' | 'error'

function AudioResult({ jobId, mb, fmt, apiBase, onReset }: {
  jobId: string; mb: number | null; fmt: string; apiBase: string; onReset: () => void
}) {
  return (
    <Card className="p-4 flex flex-col gap-3">
      <audio src={audioDownloadUrl(jobId, apiBase)} controls className="w-full" />
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
        <span className="text-sm font-semibold text-text">
          Done · {mb ?? '—'} MB · {AUDIO_FORMAT_LABELS[fmt] ?? fmt.toUpperCase()}
        </span>
      </div>
      <DownloadBtn href={audioDownloadUrl(jobId, apiBase)} label={`Download ${AUDIO_FORMAT_LABELS[fmt] ?? fmt}`} />
      <Btn onClick={onReset} variant="ghost" fullWidth>Start Over</Btn>
    </Card>
  )
}

// ── Extract: video in, audio out ───────────────────────────────────────────────
function ExtractMode({ apiBase }: { apiBase: string }) {
  const [file, setFile]     = useState<File | null>(null)
  const [upload, setUpload] = useState<VideoUploadResult | null>(null)
  const [stage, setStage]   = useState<Stage>('idle')
  const [format, setFormat] = useState<AudioFormat>('mp3')
  const [jobId, setJobId]   = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [message, setMessage]   = useState('')
  const [uploadPct, setUploadPct] = useState(0)
  const [resultMb, setResultMb] = useState<number | null>(null)
  const [error, setError]   = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startPoll = (jid: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${apiBase}/jobs/${jid}/status`); const d = await r.json()
        setProgress(d.progress ?? 0); setMessage(d.message ?? '')
        if (d.status === 'done') { clearInterval(pollRef.current!); setResultMb(d.size_mb); setStage('done') }
        else if (d.status === 'error') { clearInterval(pollRef.current!); setError(d.message); setStage('error') }
      } catch {}
    }, 1000)
  }

  const handleFile = async (f: File) => {
    setFile(f); setError(''); setUploadPct(0); setStage('uploading')
    try {
      const r = await uploadVideo(f, apiBase, setUploadPct)
      setUpload(r); setStage('ready')
    } catch (e: any) { setError(e.message); setStage('idle') }
  }

  const handleRun = async () => {
    if (!upload) return
    setStage('queued'); setError(''); setProgress(0)
    try {
      const r = await extractAudio(upload.job_id, format, apiBase)
      setJobId(r.job_id); setStage('processing'); startPoll(r.job_id)
    } catch (e: any) { setError(e.message); setStage('ready') }
  }

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    setFile(null); setUpload(null); setJobId(null); setError('')
    setStage('idle'); setProgress(0); setMessage(''); setResultMb(null)
  }

  const isWorking = stage === 'queued' || stage === 'processing'

  return (
    <div className="flex flex-col gap-4">
      {stage === 'idle' || stage === 'uploading' ? (
        <DropZone onFile={handleFile} loading={stage === 'uploading'} file={file}
          accept=".mp4,.mov,.webm,.avi,.mkv"
          label="Drop a video to extract audio from"
          sub="MP4 · MOV · WebM · AVI · MKV" />
      ) : null}

      {stage === 'uploading' && <UploadProgress pct={uploadPct} label="Uploading video…" />}

      {(stage === 'ready' || isWorking) && (
        <Card className="p-4 flex flex-col gap-3">
          <SectionTitle>Output Format</SectionTitle>
          <PillGroup options={AUDIO_FORMATS} value={format} onChange={v => setFormat(v as AudioFormat)} />
        </Card>
      )}

      {isWorking && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-sub">{message || 'Working…'}</span>
            <span className="text-accent">{progress}%</span>
          </div>
          <div className="h-1.5 bg-bg border border-border rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${Math.max(progress,8)}%` }} />
          </div>
        </Card>
      )}

      <ErrorBox message={error} />

      {stage === 'done' && jobId && (
        <AudioResult jobId={jobId} mb={resultMb} fmt={format} apiBase={apiBase} onReset={reset} />
      )}

      {(stage === 'ready' || stage === 'error') && (
        <Btn onClick={handleRun} fullWidth>♪ Extract Audio</Btn>
      )}
    </div>
  )
}

// ── Edit: trim / volume / normalize / convert ──────────────────────────────────
function EditMode({ apiBase }: { apiBase: string }) {
  const [file, setFile]     = useState<File | null>(null)
  const [upload, setUpload] = useState<AudioUploadResult | null>(null)
  const [stage, setStage]   = useState<Stage>('idle')
  const [format, setFormat] = useState<AudioFormat>('mp3')
  const [trimStart, setTrimStart] = useState('')
  const [trimEnd, setTrimEnd]     = useState('')
  const [volumeDb, setVolumeDb]   = useState('')
  const [normalize, setNormalize] = useState(false)
  const [jobId, setJobId]   = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [message, setMessage]   = useState('')
  const [uploadPct, setUploadPct] = useState(0)
  const [resultMb, setResultMb] = useState<number | null>(null)
  const [error, setError]   = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startPoll = (jid: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${apiBase}/jobs/${jid}/status`); const d = await r.json()
        setProgress(d.progress ?? 0); setMessage(d.message ?? '')
        if (d.status === 'done') { clearInterval(pollRef.current!); setResultMb(d.size_mb); setStage('done') }
        else if (d.status === 'error') { clearInterval(pollRef.current!); setError(d.message); setStage('error') }
      } catch {}
    }, 1000)
  }

  const handleFile = async (f: File) => {
    const err = validateAudioFile(f)
    if (err) return setError(err)
    setFile(f); setError(''); setUploadPct(0); setStage('uploading')
    try {
      const r = await uploadAudio(f, apiBase, setUploadPct)
      setUpload(r); setStage('ready')
    } catch (e: any) { setError(e.message); setStage('idle') }
  }

  const handleRun = async () => {
    if (!upload) return
    setStage('queued'); setError(''); setProgress(0)
    try {
      const r = await audioProcess(upload.job_id, {
        format,
        trim_start: trimStart ? Number(trimStart) : undefined,
        trim_end:   trimEnd   ? Number(trimEnd)   : undefined,
        volume_db:  volumeDb  ? Number(volumeDb)  : undefined,
        normalize,
      }, apiBase)
      setJobId(r.job_id); setStage('processing'); startPoll(r.job_id)
    } catch (e: any) { setError(e.message); setStage('ready') }
  }

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    setFile(null); setUpload(null); setJobId(null); setError('')
    setStage('idle'); setProgress(0); setMessage(''); setResultMb(null)
    setTrimStart(''); setTrimEnd(''); setVolumeDb(''); setNormalize(false)
  }

  const isWorking = stage === 'queued' || stage === 'processing'

  return (
    <div className="flex flex-col gap-4">
      {stage === 'idle' || stage === 'uploading' ? (
        <DropZone onFile={handleFile} loading={stage === 'uploading'} file={file}
          accept=".mp3,.wav,.aac,.m4a,.ogg,.flac"
          label="Drop an audio file"
          sub="MP3 · WAV · AAC · M4A · OGG · FLAC" />
      ) : null}

      {stage === 'uploading' && <UploadProgress pct={uploadPct} label="Uploading audio…" />}

      {upload && stage !== 'uploading' && (
        <Card className="px-4 py-3 text-xs font-mono text-muted">
          Duration {Number(upload.duration).toFixed(1)}s · {upload.size_mb} MB
        </Card>
      )}

      {(stage === 'ready' || isWorking || stage === 'error') && (
        <Card className="p-4 flex flex-col gap-5">
          <div>
            <SectionTitle>Output Format</SectionTitle>
            <PillGroup options={AUDIO_FORMATS} value={format} onChange={v => setFormat(v as AudioFormat)} />
          </div>
          <div>
            <SectionTitle>Trim</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start (s)"><NumInput value={trimStart} onChange={setTrimStart} placeholder="0" min={0} step={0.1} /></Field>
              <Field label="End (s)"><NumInput value={trimEnd} onChange={setTrimEnd} placeholder={upload?.duration} min={0} step={0.1} /></Field>
            </div>
          </div>
          <div>
            <SectionTitle>Volume</SectionTitle>
            <div className="grid grid-cols-2 gap-3 items-end">
              <Field label="Adjust (dB)" hint="e.g. -6 or +3"><NumInput value={volumeDb} onChange={setVolumeDb} placeholder="0" step={0.5} /></Field>
              <button onClick={() => setNormalize(p => !p)}
                className={`h-[46px] rounded-xl text-xs font-mono border transition-colors select-none
                  ${normalize ? 'bg-accent border-accent text-white' : 'bg-bg border-border text-sub hover:border-accent/50'}`}>
                {normalize ? '✓ Normalize on' : 'Normalize loudness'}
              </button>
            </div>
          </div>
        </Card>
      )}

      {isWorking && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-sub">{message || 'Working…'}</span>
            <span className="text-accent">{progress}%</span>
          </div>
          <div className="h-1.5 bg-bg border border-border rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${Math.max(progress,8)}%` }} />
          </div>
        </Card>
      )}

      <ErrorBox message={error} />

      {stage === 'done' && jobId && (
        <AudioResult jobId={jobId} mb={resultMb} fmt={format} apiBase={apiBase} onReset={reset} />
      )}

      {(stage === 'ready' || stage === 'error') && (
        <Btn onClick={handleRun} fullWidth>♪ Process Audio</Btn>
      )}
    </div>
  )
}

// ── Merge: concat multiple audio files ─────────────────────────────────────────
const MAX_AUDIO_FILES = 10
function MergeMode({ apiBase }: { apiBase: string }) {
  const [files, setFiles]   = useState<File[]>([])
  const [format, setFormat] = useState<AudioFormat>('mp3')
  const [stage, setStage]   = useState<Stage>('idle')
  const [jobId, setJobId]   = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [message, setMessage]   = useState('')
  const [resultMb, setResultMb] = useState<number | null>(null)
  const [error, setError]   = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleFiles = (incoming: FileList | null) => {
    if (!incoming) return
    const valid = Array.from(incoming).filter(f => !validateAudioFile(f))
    if (!valid.length) return setError('No valid audio files selected.')
    setFiles(p => [...p, ...valid].slice(0, MAX_AUDIO_FILES))
    setError('')
  }
  const removeFile = (i: number) => setFiles(p => p.filter((_, idx) => idx !== i))
  const moveUp   = (i: number) => { if (i===0) return; setFiles(p => { const a=[...p]; [a[i-1],a[i]]=[a[i],a[i-1]]; return a }) }
  const moveDown = (i: number) => setFiles(p => { if (i>=p.length-1) return p; const a=[...p]; [a[i],a[i+1]]=[a[i+1],a[i]]; return a })

  const startPoll = (jid: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${apiBase}/jobs/${jid}/status`); const d = await r.json()
        setProgress(d.progress ?? 0); setMessage(d.message ?? '')
        if (d.status === 'done') { clearInterval(pollRef.current!); setResultMb(d.size_mb); setStage('done') }
        else if (d.status === 'error') { clearInterval(pollRef.current!); setError(d.message); setStage('error') }
      } catch {}
    }, 1000)
  }

  const handleRun = async () => {
    if (files.length < 2) return setError('Add at least 2 audio files.')
    setStage('queued'); setError(''); setProgress(0)
    try {
      const r = await audioMerge(files, format, apiBase)
      setJobId(r.job_id); setStage('processing'); startPoll(r.job_id)
    } catch (e: any) { setError(e.message); setStage('idle') }
  }

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    setFiles([]); setJobId(null); setError(''); setStage('idle')
    setProgress(0); setMessage(''); setResultMb(null)
  }

  const isWorking = stage === 'queued' || stage === 'processing'

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 flex flex-col gap-3">
        <SectionTitle>Audio Files ({files.length}/{MAX_AUDIO_FILES})</SectionTitle>
        {files.length === 0 ? (
          <div onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-2xl py-10 flex flex-col items-center
              gap-3 cursor-pointer hover:border-accent/40 transition-colors active:scale-98">
            <p className="text-sm text-sub">Tap to add audio files</p>
            <p className="text-xs text-muted">MP3 · WAV · AAC · M4A · OGG · FLAC</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 bg-bg border border-border rounded-xl px-3 py-2.5">
                <span className="text-[10px] font-mono text-muted w-4 shrink-0">{i+1}</span>
                <span className="text-xs font-mono text-text flex-1 truncate">{f.name}</span>
                <span className="text-[10px] font-mono text-muted shrink-0">{(f.size/1e6).toFixed(1)}MB</span>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => moveUp(i)} disabled={i===0}
                    className="w-6 h-6 rounded-md bg-panel border border-border text-muted disabled:opacity-20 flex items-center justify-center active:scale-90">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                  </button>
                  <button onClick={() => moveDown(i)} disabled={i===files.length-1}
                    className="w-6 h-6 rounded-md bg-panel border border-border text-muted disabled:opacity-20 flex items-center justify-center active:scale-90">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                  <button onClick={() => removeFile(i)}
                    className="w-6 h-6 rounded-md bg-panel border border-red/20 text-red/60 flex items-center justify-center active:scale-90">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {files.length > 0 && files.length < MAX_AUDIO_FILES && (
          <button onClick={() => inputRef.current?.click()}
            className="flex items-center justify-center gap-2 py-2.5 border border-dashed border-border rounded-xl
              text-xs text-sub hover:border-accent/40 transition-colors active:scale-95">
            + Add more files
          </button>
        )}
        <input ref={inputRef} type="file" accept=".mp3,.wav,.aac,.m4a,.ogg,.flac"
          multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
      </Card>

      <Card className="p-4">
        <SectionTitle>Output Format</SectionTitle>
        <PillGroup options={AUDIO_FORMATS} value={format} onChange={v => setFormat(v as AudioFormat)} />
      </Card>

      {isWorking && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-sub">{message || 'In queue…'}</span>
            <span className="text-accent">{progress}%</span>
          </div>
          <div className="h-1.5 bg-bg border border-border rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </Card>
      )}

      <ErrorBox message={error} />

      {stage === 'done' && jobId && (
        <AudioResult jobId={jobId} mb={resultMb} fmt={format} apiBase={apiBase} onReset={reset} />
      )}

      {(stage === 'idle' || stage === 'error') && (
        <Btn onClick={handleRun} disabled={files.length < 2} fullWidth>
          ⊕ Merge {files.length > 0 ? `${files.length} Files` : '(add files above)'}
        </Btn>
      )}
    </div>
  )
}

// ── Main Audio tool — sub-mode switcher ────────────────────────────────────────
export default function AudioTool({ apiBase }: { apiBase: string }) {
  const [mode, setMode] = useState<Mode>('extract')
  const MODES: { id: Mode; label: string }[] = [
    { id: 'extract', label: 'Extract' },
    { id: 'edit',    label: 'Edit' },
    { id: 'merge',   label: 'Merge' },
  ]
  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="flex gap-2">
        {MODES.map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`flex-1 py-2.5 rounded-xl text-xs font-mono font-bold border transition-colors select-none
              ${mode === m.id ? 'bg-accent border-accent text-white' : 'bg-bg border-border text-sub hover:border-accent/50'}`}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'extract' && <ExtractMode apiBase={apiBase} />}
      {mode === 'edit'    && <EditMode apiBase={apiBase} />}
      {mode === 'merge'   && <MergeMode apiBase={apiBase} />}
    </div>
  )
}
