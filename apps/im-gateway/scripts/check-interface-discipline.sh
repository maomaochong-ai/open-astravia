#!/usr/bin/env bash
#
# Verify the interface discipline declared in each internal package's
# doc.go: upper layers (router / bridge / command) must NOT import any
# IM platform SDK directly. The transport package and its subpackages
# are the only place platform code may live.
#
# Run from apps/im-gateway/ (the workflow does this for us via the
# `working-directory` setting).
#
# Exits non-zero on any violation.

set -euo pipefail

violations=0

# Pattern: any import path that contains a known IM SDK module.
# Add new SDKs to this list when adding new transports.
sdk_pattern='larksuite/oapi-sdk-go|telegram-bot-api|github.com/.*tg|github.com/.*dingtalk|github.com/.*feishu|slack-go/slack|bwmarrin/discordgo|go.mau.fi/whatsmeow|modernc.org/sqlite|api\.telegram\.org'

# Layers that MUST NOT touch SDKs.
restricted_dirs=(
  "internal/router"
  "internal/bridge"
  "internal/command"
  "internal/state"
  "internal/projects"
  "internal/config"
  "internal/logger"
)

for dir in "${restricted_dirs[@]}"; do
  if [[ ! -d "$dir" ]]; then
    continue
  fi
  matches=$(grep -REn "$sdk_pattern" "$dir" --include='*.go' || true)
  if [[ -n "$matches" ]]; then
    echo "INTERFACE VIOLATION: $dir imports an IM platform SDK"
    echo "$matches"
    violations=$((violations + 1))
  fi
done

# cmd/im-gateway is allowed to import transport implementations because
# it's the wiring layer. Everything below it must stay clean.

if (( violations > 0 )); then
  echo
  echo "Found $violations violations of the platform-SDK boundary."
  echo "All IM platform SDK code must live under internal/transport/<platform>/"
  exit 1
fi

echo "interface discipline OK ($(echo "${restricted_dirs[*]}" | wc -w) directories scanned)"
