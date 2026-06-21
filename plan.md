# QweenFFmpeg — Improvement Plan

Status: **Stage 1 implemented (see status markers below).** Stage 2 still planning-only.

---

## Stage 1 — Render Pipeline (Backend)

**Goal:** reduce disk/RAM pressure on the 4 CPU / 8GB RAM / 30GB disk server, and cut render time, for long SVG-driven animations.

### 1.1 Upgrade FastAPI/Starlette — ✅ implemented
- `fastapi==0.111.0` pinned `starlette<0.38.0` — no HTTP Range support on `FileResponse`.
- Bumped to `fastapi==0.115.6` / `uvicorn==0.32.1` / `python-multipart==0.0.17` → pulls `starlette<0.42.0`, which includes Range support (added in starlette 0.39.0). Required for Stage 2 video preview/scrubbing.
- Verified clean install + import smoke test in an isolated venv, no dependency conflicts.

### 1.2 Parallel frame workers — ✅ implemented
- User-selectable worker count (`workers` field on `/jobs/playwright-render` and `/jobs/render-project`), capped server-side at `min(requested, MAX_RENDER_WORKERS, total_frames)`.
- `MAX_RENDER_WORKERS` env var, default `cpu_count - 1` (leaves 1 core for the API process itself).
- Global concurrency cap via `_render_worker_sem` (separate pool from the existing `_ffmpeg_sem`, which guards short single-shot ffmpeg calls) — bounds total concurrent (Chromium page + ffmpeg encode) pairs across **all** jobs, not just per-job.
- Even frame-range split (e.g. 2 workers on 3600 frames → 0–1800 / 1800–3600), verified contiguous/no-gap.
- **Scope-limited to the simple (no video-node compositing) path with a real video output** — gif and png_sequence still render single-worker (see 1.3 below for why). Cost-weighted (uneven) split and banded-path parallelism are still future work.

### 1.3 Stream frames to ffmpeg instead of writing full PNG sequence to disk — ✅ implemented (simple path)
- Each worker streams JPEG screenshots directly into its own `ffmpeg -f image2pipe` subprocess via stdin — zero frame files written to disk for this path.
- Workers' segment outputs are concatenated (`-c copy`, lossless stream copy) before audio muxing.
- Applies whenever no video nodes exist, output_mode isn't `png_sequence`, and format isn't `gif` — same gating as the 1.4 JPEG-frame condition.
- **Video-composite path** (banded SVG layers + ffmpeg overlay in `_composite_video_layers`) is unchanged — still writes a full band-PNG sequence to disk before compositing. Out of scope for this pass, as originally flagged.

### 1.4 Frame format/size reduction (no-alpha path only) — ✅ implemented
- JPEG (quality 90) instead of PNG for screenshots where alpha isn't required (no video nodes, output_mode != png_sequence) — large per-frame size reduction.
- Banded/alpha-requiring captures stay PNG (need transparency for compositing).

### 1.5 Upgrade and pin ffmpeg — ✅ implemented (pending on-server verification)
- Server ran `ffmpeg 4.2.7-0Ubuntu` (~2019/2020), unpinned — `.codesandbox/tasks.json` installed via plain `apt-get install ffmpeg`.
- Added `scripts/install_ffmpeg.sh`: downloads BtbN's 7.1-release-branch static build to `/opt/ffmpeg-pinned`, pinned to the 7.1.x line (patch updates only, never drifts to master or a new major).
- `.codesandbox/tasks.json` now runs the pin script instead of apt.
- `apps/api/main.py` now resolves `FFMPEG_BIN`/`FFPROBE_BIN` via env override → pinned-path auto-detect → bare `ffmpeg`/`ffprobe` on `$PATH` fallback, used consistently across every subprocess call site.
- Fixed `/health`: removed the hardcoded `"version": "4.0.0"` placeholder, added `ffmpeg_bin` to the response.
- ⚠️ The script's download step could not be executed in the dev sandbox (network policy blocks the GitHub release-assets host) — **confirmed working when sanity-checked on the actual server.**

**Stage 1 risk notes:**
- RAM is the tighter constraint than CPU — each Chromium context ~200–400MB; the global `_render_worker_sem` cap addresses this across jobs.
- Streaming/parallel workers cover the simple path only; banded video-composite path is still the original sequential single-page flow.
- ffmpeg 4.2.7 → 7.1.5 jump was not regression-tested against every filter_complex chain (palette gen, banded overlay/composite, concat) on this pass — recommend a manual pass before fully relying on the new pin in production traffic.

---

## Stage 2 — Output Preview + Mobile Tool UI (Frontend)

**Goal:** let users preview output in-browser before downloading, chain tools without re-uploading, and turn `apps/web` into a proper mobile-first tool app.

Status: planning only, not yet implemented.

### 2.1 In-browser output preview
- Depends on Stage 1.1 (Range support, now implemented) for smooth scrubbing.
- New "Result" view after any job completes: inline `<video>` player against the job's output endpoint.
- Action row beside player: **Download**, **Send to Crop**, **Send to Trim**, **Send to Scale**, **Send to Merge**, etc. — output becomes next tool's input without manual download/re-upload.
- `RecentTool` (job history) gets the same inline preview per past job, not just a filename/link.

### 2.2 Mobile-first navigation
- Replace flat top-tab bar (8 tools, already overflowing on mobile) with **3 bottom tabs**: **Build** (Stitch, Render), **Edit** (Crop, Trim, Scale, Segment, Merge), **History** (Recent).
- Each bottom tab → category landing screen with tool cards → tap pushes into a full-screen tool view with back navigation (Lightroom/CapCut-style), instead of competing tab bar + content on one screen.
- Persistent top bar (storage badge, clean-all action) across all screens.

### 2.3 Visual cleanup (keep existing theme)
- Keep current dark/purple palette (`bg #0d0d0f`, `panel #111116`, `accent #7c6dfa`, etc. — already defined in `tailwind.config.js`).
- Install shadcn (Radix primitives + `cva` + `clsx`/`tailwind-merge`) on top of the existing Tailwind config — style shadcn components with current tokens, not shadcn defaults.
- Migrate `page.tsx` and all 8 tool components from inline JS style objects to Tailwind classes.
- Consistent spacing/radius/touch-target scale (44px min tap targets) across all tools.

**Stage 2 risk notes:**
- Full migration touches every tool file (`StitchTool`, `RenderTool`, `CropTool`, `TrimTool`, `ScaleTool`, `SegmentTool`, `MergeTool`, `RecentTool`) — sizeable but mechanical refactor.
- "Send to [tool]" chaining requires each tool component to accept an optional pre-filled input (job_id/output reference) — small API addition per tool.

---

## Suggested sequencing
1. ~~Stage 1.1 (Range support) + 1.5 (ffmpeg upgrade/pin)~~ — done.
2. ~~Stage 1.2 + 1.3 (workers + streaming, simple path)~~ — done.
3. Stage 2.1 (preview) — unblocked by 1.1, ready to start.
4. Stage 2.2 + 2.3 (nav + visual migration) — independent of Stage 1, can run in parallel.
