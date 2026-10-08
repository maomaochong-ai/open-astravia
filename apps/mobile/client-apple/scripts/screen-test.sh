#!/usr/bin/env bash
# Real WebRTC video + DataChannel input, against a local synthetic canvas host.
# Usage: scripts/screen-test.sh ["iPhone 17 Pro"]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
project="$(cd "$here/.." && pwd)"
root="$(cd "$project/../../.." && pwd)"
derived="$project/build/DerivedData"
logs="$project/build/screen-logs"
mkdir -p "$logs"
fixture="$(mktemp -d -t vetta-screen)"
server_pid=""
electron_pid=""
cleanup() {
	[[ -z "$electron_pid" ]] || kill "$electron_pid" 2>/dev/null || true
	[[ -z "$server_pid" ]] || kill "$server_pid" 2>/dev/null || true
	wait 2>/dev/null || true
	rm -rf "$fixture"
}
trap cleanup EXIT

bun run --cwd "$root/packages/remote-control" build
bun run --cwd "$root/packages/remote-desktop" build
udid="$(xcrun simctl list devices available -j | python3 -c 'import json,sys; print(next(d["udid"] for r in json.load(sys.stdin)["devices"].values() for d in r if d["name"]==sys.argv[1]))' "${1:-iPhone 17 Pro}")"
xcrun simctl boot "$udid" 2>/dev/null || true
xcodebuild build-for-testing -project "$project/Vetta.xcodeproj" -scheme Vetta \
	-destination "id=$udid" -derivedDataPath "$derived" -quiet
bun "$here/screen-interop/server.ts" "$fixture/info.json" >"$logs/server.log" 2>&1 &
server_pid=$!
for _ in {1..100}; do
	[[ ! -s "$fixture/info.json" ]] || break
	kill -0 "$server_pid"
	sleep 0.1
done
port="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["port"])' "$fixture/info.json")"
electron_bin="$(cd "$root/packages/remote-desktop" && node -p 'require("electron")')"
"$electron_bin" "$here/screen-interop/main.cjs" "$fixture" >"$logs/electron.log" 2>&1 &
electron_pid=$!
for _ in {1..100}; do
	if curl -fsS "http://127.0.0.1:$port/ready" >/dev/null 2>&1; then break; fi
	kill -0 "$electron_pid"
	sleep 0.1
done
curl -fsS "http://127.0.0.1:$port/ready" >/dev/null
invite="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["invite"])' "$fixture/info.json")"
TEST_RUNNER_VETTA_SCREEN_INVITE="$invite" \
xcodebuild test-without-building -project "$project/Vetta.xcodeproj" -scheme Vetta \
	-destination "id=$udid" -derivedDataPath "$derived" -parallel-testing-enabled NO -quiet \
	-only-testing:VettaUITests/RemoteScreenUITests
