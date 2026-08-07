package hostclient

import (
	"context"
	"encoding/json"
	"fmt"
)

// HostClient is the interface that hides "where the agent runs" from the rest
// of the gateway. The local implementation (internal/hostclient/local) spawns
// `coding-agent --mode rpc` as a subprocess on the same machine. A future
// remote implementation could connect to a centrally hosted server that
// proxies to a desktop installation over a reverse channel — the upper
// layers (router, bridge) would not change.
type HostClient interface {
	// OpenSession starts (or attaches to) a coding-agent session for the
	// given working directory and session file. The HostSession returned is
	// ready to receive Send / Events calls.
	//
	// If the underlying session file is already locked by another process,
	// implementations MUST return an error that wraps ErrSessionLocked so
	// the caller can present a clear message to the user.
	OpenSession(ctx context.Context, cwd, sessionPath string) (HostSession, error)
}

// HostSession is a single live coding-agent session. It corresponds 1:1 with
// a SessionManager instance inside the agent process and therefore with a
// single .jsonl file on disk. Concurrent Send calls on the same HostSession
// are serialized internally; concurrent reads from Events() are safe.
type HostSession interface {
	// Send delivers a command and waits for the matching response. The
	// response correlates by the command's ID field; implementations must
	// generate one if Cmd.ID is empty.
	Send(ctx context.Context, cmd Command) (Response, error)

	// SendNoReply delivers a command and returns immediately, without
	// waiting for any response. Used for fire-and-forget host→agent
	// messages such as `host_response` where the agent consumes the
	// command but does not emit a `response` event back. Implementations
	// MUST NOT register a pending entry for cmd.ID — doing so would leak
	// a goroutine waiting on a channel that never resolves.
	SendNoReply(ctx context.Context, cmd Command) error

	// Events returns a stream of agent events. The channel is closed when
	// the session is closed (either via Close() or because the underlying
	// process exited unexpectedly). On unexpected exit a final event of
	// type AgentEventTypeError is sent before the close.
	Events() <-chan AgentEvent

	// SessionPath returns the absolute path of the .jsonl file backing this
	// session. Stable for the session's lifetime.
	SessionPath() string

	// Close shuts down the session gracefully. After Close returns, the
	// session file's `.lock` MUST have been released by the underlying
	// agent process (the bridge / pool relies on this).
	Close() error
}

// Command is one RPC command to send to coding-agent. The Type field maps
// directly to the `type` field documented in
// packages/coding-agent/docs/rpc.md (e.g. "prompt", "abort", "switch_session").
//
// Data carries the command-specific payload as already-serializable values;
// the implementation marshals the whole command to a single JSON line on
// stdin. ID is optional but recommended for correlation.
type Command struct {
	ID   string
	Type string
	Data map[string]any
}

// Response is the matching reply for a Command. Mirrors the
// `{type:"response", ...}` shape from rpc.md.
type Response struct {
	ID             string
	Command        string
	Success        bool
	Data           map[string]any
	Error          string
	ErrorCode      FailureCode
	Phase          FailurePhase
	Recoverability FailureRecoverability
}

type FailureCode string

const (
	FailureCodeClientClosed       FailureCode = "client_closed"
	FailureCodeCommandFailed      FailureCode = "command_failed"
	FailureCodeHandshakeTimeout   FailureCode = "handshake_timeout"
	FailureCodeInvalidRequest     FailureCode = "invalid_request"
	FailureCodeProcessExited      FailureCode = "process_exited"
	FailureCodeProcessIOFailed    FailureCode = "process_io_failed"
	FailureCodeProcessSpawnFailed FailureCode = "process_spawn_failed"
	FailureCodeRequestCancelled   FailureCode = "request_cancelled"
	FailureCodeRequestTimeout     FailureCode = "request_timeout"
	FailureCodeSessionLocked      FailureCode = "session_locked"
	FailureCodeShutdownTimeout    FailureCode = "shutdown_timeout"
)

type FailurePhase string

const (
	FailurePhaseStartup    FailurePhase = "startup"
	FailurePhaseCommand    FailurePhase = "command"
	FailurePhaseTurn       FailurePhase = "turn"
	FailurePhaseTransition FailurePhase = "transition"
	FailurePhaseShutdown   FailurePhase = "shutdown"
)

type FailureRecoverability string

const (
	FailureRetrySafe       FailureRecoverability = "retry_safe"
	FailureContinueSession FailureRecoverability = "continue_session"
	FailureRestartSession  FailureRecoverability = "restart_session"
	FailureUserAction      FailureRecoverability = "user_action"
	FailureFatal           FailureRecoverability = "fatal"
)

type TypedFailure interface {
	error
	FailureCode() FailureCode
	FailurePhase() FailurePhase
	FailureRecoverability() FailureRecoverability
}

type HostFailure struct {
	Code           FailureCode
	Phase          FailurePhase
	Recoverability FailureRecoverability
	Message        string
	Cause          error
}

func (e *HostFailure) Error() string { return e.Message }
func (e *HostFailure) Unwrap() error { return e.Cause }

func (e *HostFailure) FailureCode() FailureCode                     { return e.Code }
func (e *HostFailure) FailurePhase() FailurePhase                   { return e.Phase }
func (e *HostFailure) FailureRecoverability() FailureRecoverability { return e.Recoverability }

// AgentEvent is one event emitted by the agent during a session. The Type
// matches the rpc.md "Events" section (agent_start, message_update,
// tool_execution_end, etc.).
//
// Raw carries the original JSON line so the bridge can decode into
// type-specific structs lazily — we deliberately do NOT enumerate every
// possible event shape here, because new event types are added upstream
// without protocol bumps and we want this layer to forward unknowns.
type AgentEvent struct {
	Type string
	Raw  json.RawMessage
}

// Well-known event type constants. The bridge consumes these by name and
// ignores any event with an unknown Type.
const (
	AgentEventTypeAgentStart         = "agent_start"
	AgentEventTypeAgentEnd           = "agent_end"
	AgentEventTypeTurnStart          = "turn_start"
	AgentEventTypeTurnEnd            = "turn_end"
	AgentEventTypeMessageStart       = "message_start"
	AgentEventTypeMessageUpdate      = "message_update"
	AgentEventTypeMessageEnd         = "message_end"
	AgentEventTypeToolExecutionStart = "tool_execution_start"
	AgentEventTypeToolExecutionEnd   = "tool_execution_end"
	AgentEventTypeError              = "error"
	// AgentEventTypeSessionPathChanged is emitted by coding-agent in memory-mode
	// when a session rollover switches the active .jsonl file (ADR-0009). The
	// bridge forwards the new path to the router so routing state is repointed.
	AgentEventTypeSessionPathChanged = "session_path_changed"
)

// Well-known command types matching rpc.md.
const (
	CommandTypePrompt         = "prompt"
	CommandTypeAbort          = "abort"
	CommandTypeNewSession     = "new_session"
	CommandTypeSwitchSession  = "switch_session"
	CommandTypeGetState       = "get_state"
	CommandTypeSetSessionName = "set_session_name"
	// CommandTypeFlushMemory asks coding-agent (memory-mode) to consolidate
	// durable facts from the current context into MEMORY.md before the session
	// is discarded — used by /new (ADR-0009). No-op when memory-mode is off.
	CommandTypeFlushMemory = "flush_memory"
)

// LockHolder describes the process currently holding a session file lock,
// returned in ErrSessionLocked. Mirrors the JSON the agent's startup error
// emits when it cannot acquire the lock.
type LockHolder struct {
	PID      int    `json:"pid"`
	Hostname string `json:"hostname"`
	OpenedAt string `json:"openedAt"`
}

// ErrSessionLocked is returned by HostClient.OpenSession when the target
// session file is already held by another writer. Use errors.As to extract
// the holder details for user-facing messages.
type ErrSessionLocked struct {
	SessionPath string
	LockPath    string
	Holder      LockHolder
}

func (e *ErrSessionLocked) Error() string {
	return fmt.Sprintf(
		"session file is in use (pid %d@%s opened %s, lock=%s, session=%s)",
		e.Holder.PID, e.Holder.Hostname, e.Holder.OpenedAt, e.LockPath, e.SessionPath,
	)
}

func (e *ErrSessionLocked) FailureCode() FailureCode                     { return FailureCodeSessionLocked }
func (e *ErrSessionLocked) FailurePhase() FailurePhase                   { return FailurePhaseStartup }
func (e *ErrSessionLocked) FailureRecoverability() FailureRecoverability { return FailureUserAction }
