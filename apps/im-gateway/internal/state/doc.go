// Package state owns the gateway's persistent routing table — the
// (im_user, project) → session mapping.
//
// # Boundary rules
//
//   - This package owns ~/.vetta/im-gateway/state.json. No other package
//     touches that file directly.
//   - All writes go through the standard write-temp + fsync + rename
//     atomic-write pattern so a crash mid-write cannot leave a corrupt
//     state.json. Mirrors desktop-app's atomic-write util and the
//     SessionManager lockfile module — the same convention used everywhere
//     in the project for state files.
//   - This package MUST NEVER store conversation content. The agent's
//     SessionManager owns .jsonl files; we only remember which file
//     belongs to which (user, project) pair.
//
// # Concurrency
//
// Store implementations are safe for concurrent use. Internally they
// serialize Save() calls so callers don't need their own mutex.
package state
