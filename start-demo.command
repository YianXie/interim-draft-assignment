#!/bin/bash
# Double-click from Finder: starts the local server, opens the page, stops the server when this window closes.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:$PATH"

[ -f dist/index.html ] || npm run build || exit 1

node scripts/serve.mjs &
server=$!
trap 'kill "$server" 2>/dev/null' EXIT
trap 'exit 0' INT TERM HUP

until curl -s -o /dev/null http://127.0.0.1:4173; do
  kill -0 "$server" 2>/dev/null || { echo "The server did not start."; exit 1; }
  sleep 0.2
done
open http://127.0.0.1:4173
echo "Running at http://127.0.0.1:4173. Close this window to stop."
wait "$server"
