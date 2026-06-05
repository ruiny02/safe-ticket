#!/bin/bash
set -euo pipefail

DISPLAY="${DISPLAY:-:99}"
SCREEN_RESOLUTION="${SCREEN_RESOLUTION:-1440x1000x24}"
THECHEAT_LOGIN_URL="${THECHEAT_LOGIN_URL:-https://thecheat.co.kr/rb/?mod=ssl_login_otp}"
CHROME_USER_DATA_DIR="${CHROME_USER_DATA_DIR:-/data/profile}"
CHROME_REMOTE_DEBUGGING_PORT="${CHROME_REMOTE_DEBUGGING_PORT:-9223}"

mkdir -p "${CHROME_USER_DATA_DIR}"
rm -f "/tmp/.X${DISPLAY#:}-lock"

Xvfb "${DISPLAY}" -screen 0 "${SCREEN_RESOLUTION}" -ac +extension RANDR >/tmp/xvfb.log 2>&1 &
fluxbox >/tmp/fluxbox.log 2>&1 &
x11vnc -display "${DISPLAY}" -forever -shared -nopw -listen 0.0.0.0 -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc/ 0.0.0.0:6080 localhost:5900 >/tmp/novnc.log 2>&1 &
nginx -c /etc/nginx/nginx.conf

if [[ -z "${CHROME_BIN:-}" ]]; then
  CHROME_BIN="$(find /ms-playwright -path '*/chrome-linux*/chrome' -type f | sort | tail -n 1)"
fi

if [[ -z "${CHROME_BIN}" ]]; then
  echo "Chromium executable not found. Set CHROME_BIN explicitly." >&2
  exit 1
fi

exec "${CHROME_BIN}" \
  --display="${DISPLAY}" \
  --user-data-dir="${CHROME_USER_DATA_DIR}" \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port="${CHROME_REMOTE_DEBUGGING_PORT}" \
  --no-sandbox \
  --disable-dev-shm-usage \
  --no-first-run \
  --no-default-browser-check \
  --window-size=1400,950 \
  "${THECHEAT_LOGIN_URL}" \
  "$@"
