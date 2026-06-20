#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# test_render_api.sh
#
# Sends a project ZIP to a running qween-ffmpeg server's /jobs/render-project
# endpoint, polls until it finishes, and prints the full status JSON
# (including the real error message if it fails).
#
# USAGE:
#   ./test_render_api.sh <path_to_project.zip> [server_url]
#
# EXAMPLES:
#   ./test_render_api.sh video_audio.zip
#   ./test_render_api.sh video_audio.zip http://localhost:8000
#   ./test_render_api.sh video_audio.zip https://my-deployed-api.example.com
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

ZIP_FILE="${1:-}"
SERVER="${2:-http://localhost:8000}"
LOG_FILE="render_test_$(date +%Y%m%d_%H%M%S).log"

if [[ -z "$ZIP_FILE" ]]; then
  echo "Usage: $0 <path_to_project.zip> [server_url]"
  exit 1
fi

if [[ ! -f "$ZIP_FILE" ]]; then
  echo "File not found: $ZIP_FILE"
  exit 1
fi

# Mirror everything (stdout + stderr) to both the terminal and a log file
exec > >(tee "$LOG_FILE") 2>&1

echo "── Log file: $LOG_FILE ──"
echo "── Submitting $ZIP_FILE to $SERVER/jobs/render-project ──"

RESPONSE=$(curl -sS -X POST "$SERVER/jobs/render-project" \
  -F "file=@${ZIP_FILE}" \
  -F "fps=30" \
  -F "crf=18" \
  -F "format=mp4")

echo "Submit response:"
echo "$RESPONSE"
echo

JOB_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('job_id',''))" 2>/dev/null || true)

if [[ -z "$JOB_ID" ]]; then
  echo "!! No job_id returned — server likely rejected the upload outright (see response above)."
  exit 1
fi

echo "── Job ID: $JOB_ID — polling status every 2s ──"
echo

while true; do
  STATUS_JSON=$(curl -sS "$SERVER/jobs/${JOB_ID}/status")
  STATUS=$(echo "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
  PROGRESS=$(echo "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('progress',''))" 2>/dev/null || true)
  MESSAGE=$(echo "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('message',''))" 2>/dev/null || true)

  echo "[$(date +%H:%M:%S)] status=$STATUS progress=$PROGRESS message=$MESSAGE"

  if [[ "$STATUS" == "done" ]]; then
    echo
    echo "── SUCCESS ──"
    echo "$STATUS_JSON" | python3 -m json.tool
    echo
    echo "Download with:"
    echo "  curl -OJ $SERVER/jobs/${JOB_ID}/download"
    break
  fi

  if [[ "$STATUS" == "error" ]]; then
    echo
    echo "── FAILED — full status JSON below, copy this entire block back ──"
    echo "$STATUS_JSON" | python3 -m json.tool
    break
  fi

  sleep 2
done

echo
echo "── Full log saved to: $LOG_FILE — upload this file ──"
