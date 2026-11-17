#!/bin/bash
# Double-click from Finder: starts the local server, opens the page, stops the server when this window closes.
cd "$(dirname "$0")" || exit 1
unset INTERIM_PORT # the server is always on 4173, the address opened below

# Use the first Node 24 or newer: Homebrew's, then the nodejs.org installer's, then whatever PATH finds.
node_ok() { [ -x "$1" ] && [ "$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" -ge 24 ] 2>/dev/null; }
for dir in /opt/homebrew/bin /usr/local/bin $(dirname "$(command -v node 2>/dev/null || echo /none/node)"); do
  if node_ok "$dir/node"; then export PATH="$dir:$PATH"; found=1; break; fi
done

if [ -z "$found" ]; then
  install='cd /tmp && curl -fsSLO https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt && f=$(awk '"'"'/\.pkg$/{print $2}'"'"' SHASUMS256.txt) && curl -fsSLO "https://nodejs.org/dist/latest-v24.x/$f" && grep " $f$" SHASUMS256.txt | shasum -a 256 -c && sudo installer -pkg "$f" -target /'
  if command -v node >/dev/null; then
    echo "This needs Node 24 or newer. This Mac has Node $(node -v)."
  else
    echo "This needs Node 24 or newer, and Node is not installed."
  fi
  echo
  echo "To install it, paste this into Terminal (it asks for your Mac password):"
  echo
  echo "  $install"
  echo
  read -r -p "Or type y and press Return to install it now: " answer
  [ "$answer" = y ] || exit 1
  bash -c "$install" || { echo "Node was not installed."; exit 1; }
  node_ok /usr/local/bin/node || { echo "Node was not installed."; exit 1; }
  export PATH="/usr/local/bin:$PATH"
fi

[ -d node_modules ] || npm ci || exit 1
npm run build || exit 1

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
