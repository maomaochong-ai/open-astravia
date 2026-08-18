// Package bridge translates agent event streams into IM messages.
//
// # Boundary rules
//
//   - This package MUST NOT import any IM platform SDK. It uses the
//     transport interface and consults Capabilities() to decide between
//     edit-in-place streaming vs new-message-per-chunk streaming.
//   - This package consumes hostclient.AgentEvent values; new event types
//     defined upstream in coding-agent's rpc protocol are forwarded
//     transparently. Bridge code only reacts to events whose semantics it
//     understands; unknown events are logged and dropped.
//   - Throttling and chunking belong here, not in the transport.
//
// # Streaming model
//
// For transports declaring SupportsMessageEdit=true the bridge streams
// assistant text by editing one live message (with throttling, default
// 800ms). For transports without edit support the bridge buffers assistant
// text until a flush boundary or max-length threshold, then sends a new
// message.
//
// thinking_delta is surfaced as a separate user-visible message. Tool
// execution events flush pending text/thinking and emit a one-line tool
// summary; tool results remain hidden.
package bridge
