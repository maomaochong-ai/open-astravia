package local

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"time"

	"vetta-im-gateway/internal/hostclient"
)

// Options configures a Client. Zero values are replaced with the documented
// defaults from internal/config.
type Options struct {
	// Bin is the path to the coding-agent binary. If empty, defaults to
	// "vetta" (the published binary name) and PATH lookup is used.
	Bin string

	// HandshakeTimeout bounds OpenSession.
	HandshakeTimeout time.Duration

	// CloseTimeout bounds Session.Close.
	CloseTimeout time.Duration

	// ExtraEnv is added to each subprocess's environment. Reserved for
	// future use; current callers leave it empty.
	ExtraEnv map[string]string

	// SessionDir, when non-empty, is forwarded as `--session-dir`. The
	// IM host runtime sets this to `<conversationCwd>/.vetta/sessions/`
	// to match desktop-app's `resolveSessionDirForCwd` convention so
	// IM-created session .jsonl files appear in the desktop sidebar
	// under the default "对话" project. Empty → coding-agent falls back
	// to `~/.vetta/agent/sessions/<encoded-cwd>/`.
	SessionDir string

	// BinPrefixArgs are prepended to the spawned subprocess's argv
	// (after Bin, before --mode rpc). Desktop-app production uses this
	// to inject `--agent-rpc`, the discriminator that flips Vetta.app
	// into coding-agent CLI mode. In dev it carries the Electron main-
	// entry path. Empty in `im-gateway start` standalone mode.
	BinPrefixArgs []string

	// EnableHostBridge appends `--enable-host-bridge` to the spawned
	// coding-agent subprocess argv. The flag tells coding-agent to
	// register the `im_send_attachment` tool and to accept `host_response`
	// commands on stdin (see packages/coding-agent/docs/rpc.md and
	// ADR-0006). Without it the agent has no way to call back into the
	// IM transport — the tool is invisible to the LLM.
	EnableHostBridge bool

	// MemoryMode appends `--memory-mode` to the spawned coding-agent argv,
	// enabling MEMORY.md cross-session memory, the `memory` tool, session
	// rollover (replacing the LLM compaction layer), and the dated work log
	// (ADR-0009). im-gateway sets it for the Claw conversation.
	MemoryMode bool

	// MemoryFile is forwarded as `--memory-file`. It must be an absolute,
	// run-cwd-independent path (im-gateway sets it to
	// `<conversationCwd>/MEMORY.md`) because the agent's run cwd is a daily
	// date directory, not the conversation root. Only emitted when MemoryMode.
	MemoryFile string
}

const (
	defaultBin              = "vetta"
	defaultHandshakeTimeout = 10 * time.Second
	defaultCloseTimeout     = 5 * time.Second
)

// Client implements hostclient.HostClient by spawning coding-agent subprocesses.
type Client struct {
	opts Options
}

// New constructs a Client with the given options. Defaults are applied for
// any zero-valued fields.
func New(opts Options) *Client {
	if opts.Bin == "" {
		opts.Bin = defaultBin
	}
	if opts.HandshakeTimeout == 0 {
		opts.HandshakeTimeout = defaultHandshakeTimeout
	}
	if opts.CloseTimeout == 0 {
		opts.CloseTimeout = defaultCloseTimeout
	}
	return &Client{opts: opts}
}

// Compile-time interface conformance.
var _ hostclient.HostClient = (*Client)(nil)

// OpenSession spawns the coding-agent subprocess and performs the handshake.
//
// Handshake protocol:
//  1. Spawn the subprocess with --mode rpc, --cwd, --session.
//  2. Start the reader goroutine.
//  3. Send a get_state command and wait for the matching response within
//     HandshakeTimeout.
//  4. If the subprocess exits before the handshake completes, scan its
//     early output for the structured startup lock-error response emitted
//     by main.ts and return ErrSessionLocked. Otherwise return a generic
//     error wrapping the captured stderr.
func (c *Client) OpenSession(ctx context.Context, cwd, sessionPath string) (hostclient.HostSession, error) {
	args := make([]string, 0, len(c.opts.BinPrefixArgs)+10)
	args = append(args, c.opts.BinPrefixArgs...)
	args = append(args, "--mode", "rpc", "--cwd", cwd)
	// Empty sessionPath means "create a new session in this cwd". coding-agent
	// expects --session to be omitted entirely in that case (passing it as
	// empty string causes argument parsing errors). We capture the actual
	// session file path the agent ends up using during the handshake's
	// get_state response, see session.handshake / session.resolvedSessionPath.
	if sessionPath != "" {
		args = append(args, "--session", sessionPath)
	}
	if c.opts.SessionDir != "" {
		args = append(args, "--session-dir", c.opts.SessionDir)
	}
	if c.opts.EnableHostBridge {
		args = append(args, "--enable-host-bridge")
	}
	if c.opts.MemoryMode {
		args = append(args, "--memory-mode")
		if c.opts.MemoryFile != "" {
			args = append(args, "--memory-file", c.opts.MemoryFile)
		}
	}
	cmd := exec.CommandContext(ctx, c.opts.Bin, args...)
	// CRITICAL: explicitly set the subprocess's working directory.
	// Without this Go's exec.Cmd makes the child inherit the parent's
	// cwd (= wherever `im-gateway start` was launched from). The agent's
	// shell tools (dir_tree, bash, ls, ...) operate on the OS-level cwd
	// of the subprocess, NOT on the --cwd flag we pass on the command
	// line. coding-agent uses --cwd only for session-file path metadata,
	// it does not call process.chdir(), so a wrong cmd.Dir means the
	// agent answers questions about the wrong project.
	cmd.Dir = cwd
	cmd.Env = envWithoutDuplicates(c.opts.ExtraEnv)
	// Run in its own process group so SIGINT to the gateway doesn't
	// directly hit the subprocess (we use Close() to bring it down cleanly).
	prepareSysProcAttr(cmd)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("hostclient/local: stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("hostclient/local: stdout pipe: %w", err)
	}
	stderrBuf := &bytes.Buffer{}
	cmd.Stderr = stderrBuf

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("hostclient/local: spawn coding-agent (%s): %w", c.opts.Bin, err)
	}

	s := &session{
		cwd:          cwd,
		sessionPath:  sessionPath,
		cmd:          cmd,
		stdin:        stdin,
		stderr:       stderrBuf,
		pending:      make(map[string]chan hostclient.Response),
		events:       make(chan hostclient.AgentEvent, 256),
		exited:       make(chan struct{}),
		closeTimeout: c.opts.CloseTimeout,
	}

	go s.readerLoop(stdout)
	go func() {
		err := cmd.Wait()
		s.markExited(err)
	}()

	if err := s.handshake(ctx, c.opts.HandshakeTimeout); err != nil {
		// Bring the subprocess down so we don't leak.
		_ = stdin.Close()
		select {
		case <-s.exited:
		case <-time.After(2 * time.Second):
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
			<-s.exited
		}
		return nil, err
	}

	return s, nil
}

// handshake sends get_state and waits for the response. If the subprocess
// exits before responding, the events channel is drained non-blockingly to
// look for the structured startup lock-error emitted by main.ts:
//
//	{"type":"response","command":"startup","success":false,"lockHolder":{...}}
//
// The lock error arrives BEFORE the process exits, so by the time Send
// fails the event is already buffered.
//
// On a lock-error path the caller never gets a session and therefore
// never reads from events; draining is safe.
func (s *session) handshake(ctx context.Context, timeout time.Duration) error {
	handshakeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	resp, err := s.Send(handshakeCtx, hostclient.Command{
		Type: hostclient.CommandTypeGetState,
	})
	if err != nil {
		if lockErr := s.detectStartupLockError(); lockErr != nil {
			return lockErr
		}
		select {
		case <-s.exited:
			return fmt.Errorf("hostclient/local: subprocess exited during handshake: %s", s.tailStderr())
		default:
		}
		if errors.Is(err, context.DeadlineExceeded) {
			// The subprocess is still alive (otherwise the s.exited branch
			// above would have fired) but never answered get_state in time.
			// Its stderr is the only window into why — surface it instead of
			// swallowing it, so a child that hangs in startup (e.g. Electron
			// sandbox/GPU init on Linux) is diagnosable without re-spawning.
			if tail := s.tailStderr(); tail != "" {
				return fmt.Errorf("hostclient/local: handshake timed out after %v; subprocess stderr: %s", timeout, tail)
			}
			return fmt.Errorf("hostclient/local: handshake timed out after %v", timeout)
		}
		return fmt.Errorf("hostclient/local: handshake failed: %w", err)
	}
	if !resp.Success {
		return fmt.Errorf("hostclient/local: handshake response error: %s", resp.Error)
	}
	// Capture the session file path the agent ended up using. This is
	// either the explicit --session we passed or, when we passed nothing,
	// the fresh path the agent generated. The router needs this so it can
	// persist a stable (user, project) → sessionPath mapping after the
	// first message.
	if resp.Data != nil {
		if sf, ok := resp.Data["sessionFile"].(string); ok && sf != "" {
			s.setResolvedSessionPath(sf)
		}
	}
	return nil
}

// detectStartupLockError scans the events channel (non-blockingly) for the
// structured startup lock error emitted by main.ts when SessionManager
// cannot acquire the .jsonl lock. The shape is:
//
//	{"type":"response","command":"startup","success":false,
//	 "error":"...","lockHolder":{"pid":...,"hostname":"...","openedAt":"..."}}
//
// Because main.ts emits this BEFORE runRpcMode and the subprocess exits
// shortly after, by the time handshake's Send fails the line is already
// in the events channel (the reader goroutine routes id-less responses
// to events).
func (s *session) detectStartupLockError() *hostclient.ErrSessionLocked {
	// Drain whatever's currently in the events channel non-blockingly.
	for {
		select {
		case ev, ok := <-s.events:
			if !ok {
				return nil
			}
			if lockErr := parseStartupLockError(ev); lockErr != nil {
				lockErr.SessionPath = s.sessionPath
				return lockErr
			}
		default:
			return nil
		}
	}
}

func parseStartupLockError(ev hostclient.AgentEvent) *hostclient.ErrSessionLocked {
	if ev.Type != "response" {
		return nil
	}
	var raw struct {
		Type       string `json:"type"`
		Command    string `json:"command"`
		Success    bool   `json:"success"`
		LockHolder *struct {
			PID      int    `json:"pid"`
			Hostname string `json:"hostname"`
			OpenedAt string `json:"openedAt"`
		} `json:"lockHolder"`
	}
	if err := json.Unmarshal(ev.Raw, &raw); err != nil {
		return nil
	}
	if raw.Command != "startup" || raw.Success || raw.LockHolder == nil {
		return nil
	}
	return &hostclient.ErrSessionLocked{
		Holder: hostclient.LockHolder{
			PID:      raw.LockHolder.PID,
			Hostname: raw.LockHolder.Hostname,
			OpenedAt: raw.LockHolder.OpenedAt,
		},
	}
}
