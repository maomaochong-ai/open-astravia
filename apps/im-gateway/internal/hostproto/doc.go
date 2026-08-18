// Package hostproto defines the NDJSON control protocol used between the
// im-gateway sidecar (running in `host` mode) and its parent process
// (typically desktop-app's Electron main).
//
// All frames are single-line JSON objects terminated by '\n'. Frames flowing
// from parent → child are read on the sidecar's stdin; frames flowing from
// child → parent are written to the sidecar's stdout. stderr is reserved for
// fatal panic information only.
//
// Frame envelope: every frame has a "type" string discriminating the variant.
// See InboundFrame and OutboundFrame for the union shapes; concrete payloads
// live in the per-type structs (InitFrame, ReadyEvent, etc).
//
// Lifecycle:
//
//   parent spawns sidecar
//   parent → child: { "type": "init", ... }              (within 10s or sidecar exits)
//   child  → parent: { "type": "ready", ... }
//   ... runtime ...
//   parent → child: { "type": "config_update", ... }     (optional)
//   parent → child: { "type": "projects_update", ... }   (optional)
//   child  → parent: { "type": "log" | "status" | "state_patch" | "metric", ... }
//   parent → child: { "type": "shutdown" } OR closes stdin (EOF == shutdown)
//   child exits within 5s
package hostproto
