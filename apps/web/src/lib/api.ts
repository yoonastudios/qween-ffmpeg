const DEFAULT_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api/ffmpeg'

export type OutputFormat = 'mp4' | 'mov' | 'webm' | 'gif'
export type VideoFormat  = 'mp4' | 'mov' | 'webm'

export interface UploadResult {
  job_id: string; frame_count: number; extension: string
  width: string; height: string; first_frame: string
}
export interface VideoUploadResult {
  job_id: string; width: string; height: string; duration: string; size_mb: number
}
export interface ProcessResult {
  job_id: string; format: string; download_url: string; size_bytes: number; size_mb: number
}
export interface SegmentInfo  { index: number; filename: string; size_mb: number; download_url: string }
export interface SegmentResult { job_id: string; segment_count: number; segments: SegmentInfo[] }
export interface StitchParams {
  fps: number; crf: number; preset: string; format: OutputFormat
  width?: number; height?: number; trim_start?: number; trim_end?: number
  crop_x?: number; crop_y?: number; crop_w?: number; crop_h?: number
}
export interface ProcessParams {
  format: VideoFormat; crf?: number; preset?: string
  width?: number; height?: number; trim_start?: number; trim_end?: number
  crop_x?: number; crop_y?: number; crop_w?: number; crop_h?: number
  speed?: number; async_mode?: boolean
}
export interface StorageInfo {
  storage_used_mb: number; job_count: number; auto_clean_hours: number
}

// ── File size limits (mirror server limits) ───────────────────────────────────
export const MAX_ZIP_MB   = 500
export const MAX_VIDEO_MB = 2048

// ── Client-side file validation ───────────────────────────────────────────────
export function validateFile(file: File, type: 'zip' | 'video'): string | null {
  const mb = file.size / 1_048_576
  if (type === 'zip') {
    if (!file.name.toLowerCase().endsWith('.zip'))
      return 'Please select a .zip file.'
    if (mb > MAX_ZIP_MB)
      return `File too large (${mb.toFixed(0)} MB). Maximum is ${MAX_ZIP_MB} MB.`
  } else {
    const allowed = ['.mp4', '.mov', '.webm', '.avi', '.mkv']
    if (!allowed.some(ext => file.name.toLowerCase().endsWith(ext)))
      return `Unsupported file type. Allowed: ${allowed.join(', ')}`
    if (mb > MAX_VIDEO_MB)
      return `File too large (${mb.toFixed(0)} MB). Maximum is ${MAX_VIDEO_MB} MB.`
  }
  return null
}

// ── XHR-based upload with progress callback ───────────────────────────────────
export function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress: (pct: number) => void,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    })
    xhr.addEventListener('load', async () => {
      let body: any
      try { body = JSON.parse(xhr.responseText) } catch { body = { detail: xhr.responseText } }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body)
      } else {
        reject(new Error(friendlyApiError(body, `Upload failed (${xhr.status})`)))
      }
    })
    xhr.addEventListener('error', () => {
      reject(new Error('Network error — is the API server running?'))
    })
    xhr.addEventListener('timeout', () => {
      reject(new Error('Upload timed out — file may be too large or connection too slow.'))
    })
    xhr.timeout = 5 * 60 * 1000 // 5 min
    xhr.send(formData)
  })
}

// ── Error normaliser ──────────────────────────────────────────────────────────
function friendlyApiError(body: any, fallback: string): string {
  if (!body) return fallback
  // FastAPI detail string
  if (typeof body.detail === 'string') return body.detail
  // FastAPI 422 validation array
  if (Array.isArray(body.detail))
    return body.detail.map((e: any) => `${e.loc?.slice(-1)[0] ?? 'field'}: ${e.msg}`).join(' · ')
  if (body.message) return body.message
  return fallback
}

async function extractError(r: Response, fallback: string): Promise<string> {
  try { return friendlyApiError(await r.json(), fallback) } catch { return fallback }
}

// ── Network-aware fetch wrapper ───────────────────────────────────────────────
async function apiFetch(url: string, opts: RequestInit, fallback: string): Promise<any> {
  let r: Response
  try {
    r = await fetch(url, opts)
  } catch {
    throw new Error('Cannot reach API — check the server is running and CORS is enabled.')
  }
  if (!r.ok) throw new Error(await extractError(r, fallback))
  return r.json()
}

// ── Upload ZIP (with progress) ────────────────────────────────────────────────
export async function uploadZip(
  file: File, base = DEFAULT_BASE,
  onProgress?: (pct: number) => void,
): Promise<UploadResult> {
  const err = validateFile(file, 'zip')
  if (err) throw new Error(err)
  const fd = new FormData(); fd.append('file', file)
  if (onProgress) return uploadWithProgress(`${base}/jobs/upload`, fd, onProgress)
  return apiFetch(`${base}/jobs/upload`, { method: 'POST', body: fd }, 'Upload failed')
}

// ── Upload video (with progress) ──────────────────────────────────────────────
export async function uploadVideo(
  file: File, base = DEFAULT_BASE,
  onProgress?: (pct: number) => void,
): Promise<VideoUploadResult> {
  const err = validateFile(file, 'video')
  if (err) throw new Error(err)
  const fd = new FormData(); fd.append('file', file)
  if (onProgress) return uploadWithProgress(`${base}/jobs/upload-video`, fd, onProgress)
  return apiFetch(`${base}/jobs/upload-video`, { method: 'POST', body: fd }, 'Upload failed')
}

// ── Stitch ────────────────────────────────────────────────────────────────────
export async function stitch(jobId: string, params: StitchParams, base = DEFAULT_BASE): Promise<ProcessResult> {
  const fd = new FormData()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') fd.append(k, String(v)) })
  return apiFetch(`${base}/jobs/${jobId}/stitch`, { method: 'POST', body: fd }, 'Stitch failed')
}

// ── Process (crop/trim/scale/speed — combinable in one call, see PipelineTool) ─
export async function processVideo(jobId: string, params: ProcessParams, base = DEFAULT_BASE): Promise<ProcessResult | QueuedJobResult> {
  const fd = new FormData()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') fd.append(k, String(v)) })
  return apiFetch(`${base}/jobs/${jobId}/process`, { method: 'POST', body: fd }, 'Process failed')
}

// ── Segment ───────────────────────────────────────────────────────────────────
export async function segment(jobId: string, duration: number, base = DEFAULT_BASE): Promise<SegmentResult> {
  const fd = new FormData(); fd.append('segment_duration', String(duration))
  return apiFetch(`${base}/jobs/${jobId}/segment`, { method: 'POST', body: fd }, 'Segment failed')
}

// ── Render project (QweenApp ZIP → video, drives Playwright + ffmpeg) ─────────
export interface RenderProjectParams {
  fps: number; crf: number; format: VideoFormat
  start_time?: number; end_time?: number
  stage_width?: number; stage_height?: number
  workers?: number
}
export interface RenderProjectResult {
  job_id: string; status: string; poll_url: string
  end_time: number; stage: string; format: string; fps: number
}
export async function renderProject(
  file: File, params: RenderProjectParams, base = DEFAULT_BASE,
  onProgress?: (pct: number) => void,
): Promise<RenderProjectResult> {
  const err = validateFile(file, 'zip')
  if (err) throw new Error(err)
  const fd = new FormData(); fd.append('file', file)
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') fd.append(k, String(v)) })
  if (onProgress) return uploadWithProgress(`${base}/jobs/render-project`, fd, onProgress)
  return apiFetch(`${base}/jobs/render-project`, { method: 'POST', body: fd }, 'Render failed')
}

// ── Storage ───────────────────────────────────────────────────────────────────
export async function getStorage(base = DEFAULT_BASE): Promise<StorageInfo> {
  return apiFetch(`${base}/storage`, { method: 'GET' }, 'Could not fetch storage info')
}

export async function cleanAllJobs(base = DEFAULT_BASE): Promise<{ deleted_jobs: number }> {
  return apiFetch(`${base}/storage/clean`, { method: 'DELETE' }, 'Clean failed')
}

export async function deleteJob(jobId: string, base = DEFAULT_BASE) {
  await fetch(`${base}/jobs/${jobId}`, { method: 'DELETE' })
}

// ── Stage 2.1: chain a finished job's output into a new job as input ─────────
// Server-side copy, no re-upload — frontend treats the result identically to
// a fresh uploadVideo() response.
export async function useAsSource(jobId: string, base = DEFAULT_BASE): Promise<VideoUploadResult> {
  return apiFetch(`${base}/jobs/${jobId}/use-as-source`, { method: 'POST' }, 'Could not send job to next tool')
}

// ── Merge from Library: select existing job outputs instead of re-uploading ──
export interface QueuedJobResult { job_id: string; status: string; poll_url: string }
export async function mergeExisting(jobIds: string[], format: VideoFormat, base = DEFAULT_BASE): Promise<QueuedJobResult> {
  const fd = new FormData()
  jobIds.forEach(id => fd.append('job_ids', id))
  fd.append('format', format)
  return apiFetch(`${base}/jobs/merge-existing`, { method: 'POST', body: fd }, 'Merge failed')
}
export const downloadUrl        = (jobId: string, base = DEFAULT_BASE) => `${base}/jobs/${jobId}/download`
export const segmentDownloadUrl = (jobId: string, idx: number, base = DEFAULT_BASE) => `${base}/jobs/${jobId}/segment/${idx}`
export const frameUrl           = (jobId: string, idx: number, base = DEFAULT_BASE) => `${base}/jobs/${jobId}/frame/${idx}`

// ── Format helpers ────────────────────────────────────────────────────────────
export const FORMAT_LABELS: Record<string, string> = { mp4: 'MP4', mov: 'MOV', webm: 'WebM', gif: 'GIF', mp3: 'MP3', wav: 'WAV', aac: 'AAC', m4a: 'M4A' }
export const VIDEO_FORMATS: VideoFormat[]  = ['mp4', 'mov', 'webm']
export const ALL_FORMATS:   OutputFormat[] = ['mp4', 'mov', 'webm', 'gif']
// x264 (mp4/mov) CRF is 0–51; VP9 (webm) uses a wider ~0–63 scale. Quality
// sliders should size their max to the selected format instead of always
// capping at 51 (which silently limited webm's achievable quality range).
export const CRF_RANGE: Record<string, [number, number]> = { mp4: [0, 51], mov: [0, 51], webm: [0, 63] }

// ── Jobs list (for Recent tab) ────────────────────────────────────────────────
export interface JobRecord {
  job_id: string; label: string; input_file: string
  created_at: number; frame_count: number
  has_output: boolean; format: string | null; size_mb: number | null
  is_audio?: boolean; is_thumbnail?: boolean
}
export async function listJobs(base = DEFAULT_BASE): Promise<{ jobs: JobRecord[] }> {
  return apiFetch(`${base}/jobs`, { method: 'GET' }, 'Could not fetch jobs')
}

// ── Job status (for log viewer) ───────────────────────────────────────────────
export interface JobStatus {
  status: string; message: string; progress: number
  label?: string; size_mb?: number | null; format?: string | null
}
export async function getJobStatus(jobId: string, base = DEFAULT_BASE): Promise<JobStatus> {
  return apiFetch(`${base}/jobs/${jobId}/status`, { method: 'GET' }, 'Could not fetch status')
}

// ── Audio tools ────────────────────────────────────────────────────────────────
export type AudioFormat = 'mp3' | 'wav' | 'aac' | 'm4a'
export const AUDIO_FORMATS: AudioFormat[] = ['mp3', 'wav', 'aac', 'm4a']
export const AUDIO_FORMAT_LABELS: Record<string, string> = { mp3: 'MP3', wav: 'WAV', aac: 'AAC', m4a: 'M4A' }
const ALLOWED_AUDIO_EXTS = ['.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac']

export function validateAudioFile(file: File): string | null {
  const mb = file.size / 1_048_576
  if (!ALLOWED_AUDIO_EXTS.some(ext => file.name.toLowerCase().endsWith(ext)))
    return `Unsupported file type. Allowed: ${ALLOWED_AUDIO_EXTS.join(', ')}`
  if (mb > MAX_VIDEO_MB) return `File too large (${mb.toFixed(0)} MB). Maximum is ${MAX_VIDEO_MB} MB.`
  return null
}

export interface AudioUploadResult { job_id: string; duration: string; size_mb: number }
export async function uploadAudio(
  file: File, base = DEFAULT_BASE, onProgress?: (pct: number) => void,
): Promise<AudioUploadResult> {
  const err = validateAudioFile(file)
  if (err) throw new Error(err)
  const fd = new FormData(); fd.append('file', file)
  if (onProgress) return uploadWithProgress(`${base}/jobs/upload-audio`, fd, onProgress)
  return apiFetch(`${base}/jobs/upload-audio`, { method: 'POST', body: fd }, 'Upload failed')
}

// Extract audio from any prior video job (works on render/process/upload outputs alike)
export async function extractAudio(jobId: string, format: AudioFormat, base = DEFAULT_BASE): Promise<QueuedJobResult> {
  const fd = new FormData(); fd.append('format', format)
  return apiFetch(`${base}/jobs/${jobId}/extract-audio`, { method: 'POST', body: fd }, 'Extract failed')
}

export interface AudioProcessParams {
  format: AudioFormat; trim_start?: number; trim_end?: number
  volume_db?: number; normalize?: boolean
}
export async function audioProcess(jobId: string, params: AudioProcessParams, base = DEFAULT_BASE): Promise<QueuedJobResult> {
  const fd = new FormData()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') fd.append(k, String(v)) })
  return apiFetch(`${base}/jobs/${jobId}/audio-process`, { method: 'POST', body: fd }, 'Audio processing failed')
}

export async function audioMerge(files: File[], format: AudioFormat, base = DEFAULT_BASE): Promise<QueuedJobResult> {
  const fd = new FormData()
  files.forEach(f => fd.append('files', f))
  fd.append('format', format)
  return apiFetch(`${base}/jobs/audio-merge`, { method: 'POST', body: fd }, 'Merge failed')
}

export const audioDownloadUrl = (jobId: string, base = DEFAULT_BASE) => `${base}/jobs/${jobId}/download`

// ── Thumbnail / poster-frame extraction ───────────────────────────────────────
export type ThumbnailFormat = 'jpg' | 'png'
export interface ThumbnailResult extends ProcessResult { count?: number }
export async function extractThumbnail(
  jobId: string, time: number, format: ThumbnailFormat = 'jpg', base = DEFAULT_BASE,
): Promise<ProcessResult> {
  const fd = new FormData(); fd.append('time', String(time)); fd.append('format', format)
  return apiFetch(`${base}/jobs/${jobId}/thumbnail`, { method: 'POST', body: fd }, 'Thumbnail extraction failed')
}

// ── Filmstrip sprite — for the Trim tool's visual timeline scrubber ──────────
export async function extractFilmstrip(
  jobId: string, count = 10, width = 160, base = DEFAULT_BASE,
): Promise<ThumbnailResult> {
  const fd = new FormData(); fd.append('count', String(count)); fd.append('width', String(width))
  return apiFetch(`${base}/jobs/${jobId}/filmstrip`, { method: 'POST', body: fd }, 'Filmstrip extraction failed')
}
