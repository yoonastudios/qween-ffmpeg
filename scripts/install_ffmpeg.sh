#!/usr/bin/env bash
# Install a pinned, version-stable ffmpeg/ffprobe static build, replacing the
# unpinned `apt-get install ffmpeg` (which pulled 4.2.7-0Ubuntu — circa 2019).
#
# Source: BtbN/FFmpeg-Builds (https://github.com/BtbN/FFmpeg-Builds)
# Uses the "latest" floating tag scoped to the 7.1 release branch — this
# tracks 7.1.x patch/security updates only, never drifts to master or to a
# newer major branch. Re-run this script to pick up 7.1.x patch updates;
# bumping to a new major branch (e.g. 8.1) requires deliberately changing the
# filename below, not a side effect of re-running.
#
# Usage:
#   sudo bash scripts/install_ffmpeg.sh
#
# Installs to /opt/ffmpeg-pinned/{ffmpeg,ffprobe} — apps/api/main.py looks for
# binaries there by default (see FFMPEG_DIR / FFMPEG_BIN / FFPROBE_BIN env
# vars in main.py if you need a different location).
#
# NOTE: this script has not been executed/verified end-to-end yet — the dev
# sandbox used to write it blocks the asset host (release-assets.githubusercontent.com)
# at the network-policy level. Run and verify on the actual target server,
# which should have normal outbound internet access.

set -euo pipefail

INSTALL_DIR="${FFMPEG_DIR:-/opt/ffmpeg-pinned}"
ASSET_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-linux64-gpl-7.1.tar.xz"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "==> Downloading pinned ffmpeg (7.1 release branch, linux64, gpl static) ..."
curl -fL --retry 3 -o "${TMP_DIR}/ffmpeg.tar.xz" "${ASSET_URL}"

echo "==> Extracting ..."
tar -xf "${TMP_DIR}/ffmpeg.tar.xz" -C "${TMP_DIR}"

EXTRACTED_DIR="$(find "${TMP_DIR}" -maxdepth 1 -type d -name 'ffmpeg-*' | head -n1)"
if [ -z "${EXTRACTED_DIR}" ]; then
  echo "ERROR: could not locate extracted ffmpeg-* directory in archive." >&2
  exit 1
fi

echo "==> Installing to ${INSTALL_DIR} ..."
mkdir -p "${INSTALL_DIR}"
cp "${EXTRACTED_DIR}/bin/ffmpeg"  "${INSTALL_DIR}/ffmpeg"
cp "${EXTRACTED_DIR}/bin/ffprobe" "${INSTALL_DIR}/ffprobe"
chmod +x "${INSTALL_DIR}/ffmpeg" "${INSTALL_DIR}/ffprobe"

echo "==> Verifying ..."
"${INSTALL_DIR}/ffmpeg" -version | head -n1
"${INSTALL_DIR}/ffprobe" -version | head -n1

echo "==> Done. apps/api/main.py auto-detects ${INSTALL_DIR}/ffmpeg by default."
echo "    Override with FFMPEG_BIN / FFPROBE_BIN / FFMPEG_DIR env vars if needed."
