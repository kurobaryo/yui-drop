#!/usr/bin/env bash
# yui-drop-upload.sh — simple-upload reference client for the yui-drop v1 API.
#
# Uploads a file (≤ 10 MiB) to a yui-drop instance and prints the short URL.
# For larger files, use scripts/yui-drop-upload.py which handles the
# multipart presigned-URL flow.
#
# Usage:
#   yui-drop-upload.sh FILE [EXPIRE_VALUE] [EXPIRE_STYLE]
#
# Environment:
#   YUI_DROP_API_KEY   — required, Bearer API key
#   YUI_DROP_BASE_URL  — default https://drop.leod.me

set -euo pipefail

file="${1:-}"
expire_value="${2:-1}"
expire_style="${3:-day}"

if [[ -z "${file}" ]]; then
  echo "usage: $0 FILE [EXPIRE_VALUE] [EXPIRE_STYLE]" >&2
  exit 64
fi
if [[ ! -f "${file}" ]]; then
  echo "error: not a file: ${file}" >&2
  exit 66
fi
if [[ -z "${YUI_DROP_API_KEY:-}" ]]; then
  echo "error: YUI_DROP_API_KEY not set" >&2
  exit 78
fi

base_url="${YUI_DROP_BASE_URL:-https://drop.leod.me}"
base_url="${base_url%/}"

response=$(curl -sS -X POST "${base_url}/api/v1/upload" \
  -H "Authorization: Bearer ${YUI_DROP_API_KEY}" \
  -F "file=@${file}" \
  -F "expire_value=${expire_value}" \
  -F "expire_style=${expire_style}")

if command -v jq >/dev/null 2>&1; then
  code=$(echo "${response}" | jq -r '.code // empty')
  if [[ "${code}" != "2000" ]]; then
    echo "error: ${response}" >&2
    exit 1
  fi
  echo "${response}" | jq -r '.detail.short_url'
else
  # No jq — print the raw response and let the caller parse it.
  echo "${response}"
fi
