#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLI_APP_DIR="$ROOT_DIR/packages/cli-app"
BUN_BIN="${BUN_BIN:-bun}"

if [[ ! -d "$CLI_APP_DIR" ]]; then
	echo "Error: cli-app package directory not found: $CLI_APP_DIR"
	exit 1
fi

if ! command -v "$BUN_BIN" >/dev/null 2>&1; then
	echo "Error: bun is not installed or not in PATH."
	exit 1
fi

echo "Ensuring workspace dependencies with bun..."
cd "$ROOT_DIR"
if ! "$BUN_BIN" install --frozen-lockfile; then
	echo ""
	echo "Error: bun install failed."
	echo "Please run 'bun install' in $ROOT_DIR and fix install errors first."
	exit 1
fi

echo "Building canonical CLI entrypoints with bun..."
cd "$ROOT_DIR"
"$BUN_BIN" run build:cli
chmod +x "$CLI_APP_DIR/dist/cli.js" "$CLI_APP_DIR/dist/agent-cli.js" "$CLI_APP_DIR/dist/agent-rpc-cli.js"

echo "Linking @vetta/cli-app executables globally..."

# Create a symlink in bun's global bin directory directly.
# `bun link -g` fails with FileNotFound for workspace packages, so we bypass it.
BUN_GLOBAL_BIN="$("$BUN_BIN" pm bin -g 2>/dev/null || true)"
if [[ -z "$BUN_GLOBAL_BIN" ]]; then
	echo "Error: could not determine bun global bin directory."
	exit 1
fi

mkdir -p "$BUN_GLOBAL_BIN"
ln -sf "$CLI_APP_DIR/dist/cli.js" "$BUN_GLOBAL_BIN/vetta"
ln -sf "$CLI_APP_DIR/dist/agent-cli.js" "$BUN_GLOBAL_BIN/vetta-agent"
ln -sf "$CLI_APP_DIR/dist/agent-rpc-cli.js" "$BUN_GLOBAL_BIN/vetta-agent-rpc"

echo "Bun global bin: $BUN_GLOBAL_BIN"

echo ""
echo "Done. You can now run 'vetta', 'vetta-agent', or 'vetta-agent-rpc' from any directory."
echo "Check: vetta --help"
