#!/usr/bin/env bash
# Builds the app and runs the UI tests on a simulator against the interop
# harness (the desktop's real LAN server + fake relay). Each appearance gets a
# fresh harness: the desktop pins the first phone that claims an invite, and
# every UI run is a brand-new phone. Screenshots of every screen land in
# $VETTA_UITEST_SHOTS (default: ./build/ui-shots).
#   scripts/ui-test.sh ["iPhone 17"]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
project="$(cd "$here/.." && pwd)"
device="${1:-iPhone 17}"
shots="${VETTA_UITEST_SHOTS:-$project/build/ui-shots}"
derived="$project/build/DerivedData"
mkdir -p "$shots"
harness=""
info=""
cleanup() {
	[[ -n "$harness" ]] && kill "$harness" 2>/dev/null || true
	[[ -n "$info" ]] && rm -f "$info"
	return 0
}
trap cleanup EXIT

start_harness() {
	cleanup
	info="$(mktemp -t vetta-interop).json"
	local log="$shots/harness-$appearance.log"
	bun "$here/interop-desktop.ts" "$info" >"$log" 2>&1 &
	harness=$!
	for _ in $(seq 1 100); do [[ -s "$info" ]] && return 0; sleep 0.1; done
	echo "interop harness did not start"
	cat "$log"
	exit 1
}

udid="$(xcrun simctl list devices available -j | python3 -c 'import json,sys; name=sys.argv[1]; print(next(d["udid"] for r in json.load(sys.stdin)["devices"].values() for d in r if d["name"]==name))' "$device")"
xcrun simctl boot "$udid" 2>/dev/null || true
for appearance in dark light; do
	start_harness
	invite="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["invite"])' "$info")"
	xcrun simctl ui "$udid" appearance "$appearance"
	TEST_RUNNER_VETTA_UITEST_INVITE="$invite" \
	TEST_RUNNER_VETTA_UITEST_SHOTS="$shots" \
	TEST_RUNNER_VETTA_UITEST_APPEARANCE="$appearance" \
	xcodebuild test -project "$project/Vetta.xcodeproj" -scheme Vetta \
		-destination "id=$udid" -derivedDataPath "$derived" -quiet
done
echo "screenshots: $shots"
