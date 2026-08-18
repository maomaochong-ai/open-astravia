// Package hostclient hides "where the agent runs" from the rest of the
// gateway behind the HostClient interface.
//
// # Boundary rules
//
//   - This package and subpackages MUST be the only code that knows how to
//     talk to coding-agent (subprocess vs network vs in-process).
//   - The Command / Response / AgentEvent types MUST mirror the protocol
//     documented in packages/coding-agent/docs/rpc.md. When that document
//     gains a new event type or command, this package is the place to
//     mirror it; upper layers should not need updates for additive
//     protocol changes.
//   - Upper layers MUST NOT import os/exec or net/http to reach the agent.
//
// # Implementations
//
//   - hostclient/local: spawns `coding-agent --mode rpc` as a child
//     process and speaks JSON over its stdio. Used in personal mode.
//   - hostclient/remote (future): connects to a centrally hosted gateway
//     server that proxies to a desktop installation over a reverse channel.
//     Used in enterprise mode. Not in the first milestone.
//
// Adding a new implementation does not require any other package to change,
// as long as the implementation honors the HostClient / HostSession contract
// defined in types.go.
package hostclient
