#!/usr/bin/env bash
#
# Build monorepo packages in dependency order.
#
# Usage:
#   ./scripts/build.sh          # build all packages
#   ./scripts/build.sh lib      # build libraries only (no apps)
#   ./scripts/build.sh app      # build apps only (assumes libs are built)
#   ./scripts/build.sh desktop  # build desktop-app and its deps
#   ./scripts/build.sh cli      # build cli-app and its deps
#   ./scripts/build.sh admin    # build admin panel
#   ./scripts/build.sh preset   # build preset plugins only
#

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
DIM='\033[2m'
RESET='\033[0m'

build_pkg() {
  local dir="$1"
  build_pkg_script "$dir" build
}

build_pkg_script() {
  local dir="$1"
  local script="$2"
  local name
  name=$(basename "$dir")
  printf "${DIM}[build]${RESET} %-24s" "$name:$script"
  if (cd "$dir" && bun run "$script" > /dev/null 2>&1); then
    printf "${GREEN}ok${RESET}\n"
  else
    printf "${RED}FAIL${RESET}\n"
    echo "  Re-running with output:"
    (cd "$dir" && bun run "$script")
    exit 1
  fi
}

# ── Layer 0: no workspace deps ──
build_layer0() {
  build_pkg packages/capability-sdk
  build_pkg packages/ai
  build_pkg packages/runtime-telemetry
  build_pkg packages/agent
  build_pkg packages/ecosystem-adapter
  build_pkg packages/action-rpc
  build_pkg packages/runtime-subagents
  build_pkg packages/toolkit
  build_pkg packages/plugins/plugin-sdk
  build_pkg packages/plugins/plugin-vite
}

# ── Layer 1: depends on layer 0 ──
build_layer1() {
  build_pkg packages/capability-runtime
  build_pkg packages/runtime-core
  build_pkg packages/plugins/plugin-cli
}

# ── Layer 2: depends on runtime-core ──
build_layer2() {
  build_pkg packages/runtime-mcp
}

# ── Layer 3: independent Runtime packages used by coding-agent ──
build_layer3() {
  build_pkg packages/runtime-knowledge
  build_pkg packages/runtime-tools
  build_pkg packages/runtime-storage
}

# ── Layer 4: Coding Profile + Composition Root ──
build_layer4() {
  build_pkg packages/coding-agent
}

# ── Layer 5: apps ──
build_apps() {
  build_pkg packages/cli-app
  build_pkg packages/desktop-app
}

build_admin() {
  build_pkg packages/admin
}

# ── Preset plugins (packages/plugins/presets/*) ──
# Reuses desktop-app 的 build-presets.mjs（含按需 bun install、遍历全部 preset）。
build_presets() {
  printf "${DIM}[build]${RESET} %-24s" "presets"
  if node packages/desktop-app/scripts/build-presets.mjs > /dev/null 2>&1; then
    printf "${GREEN}ok${RESET}\n"
  else
    printf "${RED}FAIL${RESET}\n"
    echo "  Re-running with output:"
    node packages/desktop-app/scripts/build-presets.mjs
    exit 1
  fi
}

build_libs() {
  build_layer0
  build_layer1
  build_layer2
	build_layer3
	build_layer4
}

build_all() {
  build_libs
  build_apps
  build_admin
}

case "${1:-all}" in
  all)     build_all; build_presets ;;
  lib|libs) build_libs; build_presets ;;
  app|apps) build_apps ;;
  desktop)  build_libs && build_apps ;;
  cli)      build_libs && build_pkg packages/cli-app && build_presets ;;
  admin)    build_admin ;;
  preset|presets) build_presets ;;
  *)
    echo "Unknown target: $1"
    echo "Usage: $0 [all|libs|apps|desktop|cli|admin|preset]"
    exit 1
    ;;
esac

printf "\n${GREEN}Done.${RESET}\n"
