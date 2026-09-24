#!/usr/bin/env bash
# Runs the Swift interop suite against the desktop's real LAN server and the
# repository's fake relay. Requires Bun and the repository dependencies.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../.." && pwd)"
info="$(mktemp -t vetta-interop).json"
log="$(mktemp -t vetta-interop-log)"
bun "$here/interop-desktop.ts" "$info" >"$log" 2>&1 &
harness=$!
trap 'kill $harness 2>/dev/null || true; rm -f "$info"' EXIT
for _ in $(seq 1 100); do
	[[ -s "$info" ]] && break
	if ! kill -0 "$harness" 2>/dev/null; then cat "$log"; exit 1; fi
	sleep 0.1
done
[[ -s "$info" ]] || { echo "interop harness did not start"; cat "$log"; exit 1; }
cd "$root/apps/mobile/client-apple/VettaKit"
VETTA_INTEROP_FILE="$info" swift test --no-parallel --filter InteropTests
