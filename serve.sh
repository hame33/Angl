#!/usr/bin/env bash
#
# Serve Angl locally and open it in your browser.
#
#   ./serve.sh
#
# Why a server instead of just opening the .html file: the YouTube player is
# unreliable over file:// URLs, and browser storage is keyed to the origin —
# so your clips only exist at one specific address.
#
# That address is http://localhost:8777. Keep the port the same every time.
# Serving on a different port makes existing clips look like they've vanished;
# they're still there, just under the old origin. Export regularly regardless.

set -euo pipefail

PORT="${PORT:-8777}"
PAGE="index.html"
URL="http://localhost:${PORT}/${PAGE}"

# Always serve the repo, no matter where this is called from
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -f "$PAGE" ]; then
  echo "error: $PAGE not found in $(pwd)" >&2
  exit 1
fi

open_browser() {
  if command -v open >/dev/null 2>&1; then open "$URL"          # macOS
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" # Linux
  else echo "Open this in your browser:  $URL"
  fi
}

# Reuse an already-running server rather than failing on a busy port
if curl -sf -o /dev/null "$URL" 2>/dev/null; then
  echo "Angl is already being served on port ${PORT}."
  echo "Opening ${URL}"
  open_browser
  exit 0
fi

# Port is taken, but not by us — serving elsewhere would hide existing clips
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "error: port ${PORT} is in use by something that isn't Angl." >&2
  echo "       Free it, or run with a different port: PORT=8778 ./serve.sh" >&2
  echo "       Note that a different port starts with an empty clip list." >&2
  exit 1
fi

echo "Serving Angl at ${URL}"
echo "Press Ctrl+C to stop."
echo

# Give the server a moment to bind before the browser asks for the page
( sleep 1; open_browser ) &

exec python3 -m http.server "$PORT"
