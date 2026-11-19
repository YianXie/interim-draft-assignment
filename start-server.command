#!/bin/bash
# Double-click from Finder: starts the local server, opens the page, stops the server when this window closes.
# Written for someone who has never used Terminal: every line it prints says what is happening or what to do.
cd "$(dirname "$0")" || exit 1
unset INTERIM_PORT # the server is always on 4173, the address opened below
url=http://127.0.0.1:4173

say() { printf '%s\n' "$@"; }
fail() { say "" "$@" "" "You can close this window."; exit 1; }
open_page() { open -a "Google Chrome" "$url" 2>/dev/null || open "$url"; }

# A folder unzipped from a download is marked as from the internet, which is why the first double-click needed
# Open Anyway. Clearing the mark on this folder only (no password needed) lets later double-clicks just open.
xattr -dr com.apple.quarantine . 2>/dev/null

# Already running, from another double-click: a second tab of the page could lose changes, so ask first.
if page=$(curl -fs --max-time 2 "$url/"); then
  case "$page" in
    *"<title>Interim Draft Assistant</title>"*)
      say "The demo is already running, in another Terminal window." \
        "Use the Chrome tab that is already open. Two tabs of the page can lose changes."
      read -r -p "To open a tab anyway, type y and press Return. Otherwise just press Return: " answer
      [ "$answer" = y ] && open_page
      exit 0 ;;
    *) fail "Something else on this Mac is using the address $url." "Quit that program, then double-click start-server.command again." ;;
  esac
fi

# Node 24 or newer: one fetched into this folder before, then Homebrew's, then the nodejs.org installer's, then PATH's.
node_ok() { [ -x "$1" ] && [ "$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" -ge 24 ] 2>/dev/null; }
for dir in "$PWD/.node/bin" /opt/homebrew/bin /usr/local/bin "$(dirname "$(command -v node 2>/dev/null || echo /none/node)")"; do
  if node_ok "$dir/node"; then export PATH="$dir:$PATH"; found=1; break; fi
done

# None: fetch the official Node 24 from nodejs.org into this folder's hidden .node folder. No password, nothing installed system-wide.
if [ -z "$found" ]; then
  if command -v node >/dev/null; then say "This needs Node 24 or newer. This Mac has Node $(node -v)."
  else say "This needs Node 24 or newer, and this Mac does not have it."; fi
  # Node 24 runs on macOS 13.5 or newer only: say so before a 50 MB download, not after.
  mac=$(sw_vers -productVersion 2>/dev/null); case "$mac" in *.*) ;; *) mac="$mac.0" ;; esac
  major=${mac%%.*}; minor=${mac#*.}; minor=${minor%%.*}
  if [ "$major" -lt 13 ] 2>/dev/null || { [ "$major" = 13 ] && [ "$minor" -lt 5 ] 2>/dev/null; }; then
    fail "Node 24 needs macOS 13.5 or newer, and this Mac has macOS $mac." "It can't run here. Please try it on a newer Mac."
  fi
  say "It can be fetched from nodejs.org (about 50 MB) into this folder. It needs no password and changes nothing else on the Mac."
  read -r -p "To fetch it, type y and press Return: " answer
  case "$answer" in [yY]*) ;; *) fail "Node was not fetched." "To try again, double-click start-server.command again." ;; esac
  arch=x64; [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ] && arch=arm64
  base=https://nodejs.org/dist/latest-v24.x
  tmp=$(mktemp -d) || fail "Could not make a temporary folder."
  offline="Could not reach nodejs.org. Check the internet connection and try again."
  say "Contacting nodejs.org ..."
  curl -fsL --connect-timeout 20 --max-time 60 "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt" || fail "$offline"
  file=$(awk -v want="darwin-$arch.tar.gz" 'substr($2, length($2) - length(want) + 1) == want { print $2 }' "$tmp/SHASUMS256.txt")
  # No file listed is most likely a network sign-in page answering instead of nodejs.org.
  [ -n "$file" ] || fail "$offline"
  say "Fetching $file ..."
  curl -fL --progress-bar --connect-timeout 20 --speed-limit 1024 --speed-time 30 "$base/$file" -o "$tmp/$file" || fail "The download stopped. Check the internet connection and try again."
  (cd "$tmp" && grep "  $file\$" SHASUMS256.txt | shasum -a 256 -c -s) || fail "The download did not match nodejs.org's checksum, so it was not used."
  # Unpacked beside .node and then renamed, so a stopped unpack never leaves a half-made .node behind.
  rm -rf .node.new && mkdir .node.new && tar -xzf "$tmp/$file" -C .node.new --strip-components 1 || { rm -rf .node.new; fail "Could not unpack Node."; }
  rm -rf .node "$tmp" && mv .node.new .node
  node_ok "$PWD/.node/bin/node" || fail "Node was fetched but does not run on this Mac."
  export PATH="$PWD/.node/bin:$PATH"
  say "Node $(node -v) is ready." ""
fi

# The parts the page is built from. npm's own notices are left out; its errors are not. No package's install script
# runs: esbuild finds its binary through its @esbuild/darwin-* package without one.
fetch_parts() {
  say "Getting the parts the page needs (first time only, about a minute) ..."
  npm ci --ignore-scripts --no-audit --no-fund --loglevel=error --fetch-timeout=30000 --fetch-retries=1 || fail "Could not get the parts. Check the internet connection and double-click start-server.command again."
}
[ -f node_modules/.package-lock.json ] || fetch_parts
say "Building the page ..."
# A half-finished earlier fetch can leave the parts broken: fetch them again once, then build again. Only the
# second try shows its errors, so a fixable first failure prints nothing alarming.
if ! npm run build --silent >/dev/null 2>&1; then
  fetch_parts
  npm run build --silent >/dev/null || fail "The page could not be built."
fi

# Ready only when this server says it is listening: a page answering on the address could be another window's server.
log=$(mktemp) || fail "Could not make a temporary file."
node scripts/serve.mjs >"$log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null; rm -f "$log"' EXIT
trap 'exit 0' INT TERM HUP

until grep -q "^$url" "$log"; do
  kill -0 "$server" 2>/dev/null || fail "$(cat "$log")" "The server did not start. If another Terminal window is running the demo, use that one." \
    "Otherwise restart the Mac, then double-click start-server.command again."
  sleep 0.2
done
open_page
say "" "Running at $url" "" \
  "Leave this window open while you use the page." \
  "To stop: close this window (click Terminate if asked). Your draft stays saved in Chrome."
wait "$server"
