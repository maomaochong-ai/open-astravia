// Package command implements the slash-command parser and handlers for
// /new, /whoami, /help.
//
// # Boundary rules
//
//   - This package MUST NOT import any IM platform SDK. Commands work the
//     same way across all transports — the only platform-specific behavior
//     is whether output uses rich formatting (a Capabilities decision made
//     in the bridge layer, not here).
//   - Command handlers MUST NOT bypass state.Store; routing state goes
//     through the canonical interface so future store backends work
//     without changes.
//
// # Adding a command
//
// Define a Handler in this package, register it with Router. Avoid
// stuffing logic into the Router itself — keep each command's behavior
// in its own file for clarity.
package command
