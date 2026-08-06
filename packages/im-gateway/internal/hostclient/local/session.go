// Package local implements hostclient.HostClient by spawning the
// `coding-agent --mode rpc` binary as a subprocess and speaking the
// JSON-line protocol documented in packages/coding-agent/docs/rpc.md.
//
// Lifecycle (one HostSession = one subprocess = one .jsonl file):
//
//	OpenSession:
//	    1. exec.Command("coding-agent", "--mode", "rpc", "--cwd", cwd, "--session", path)
//	    2. Pipe stdin / stdout / stderr.
//	    3. Start the reader goroutine that consumes stdout JSON lines and
//	       routes them to either the responses or events channel.
//	    4. Handshake: send a get_state command and wait for the matching
//	       response within HandshakeTimeout. If the process exits first,
//	       inspect early stdout / stderr for the structured startup lock
//	       error emitted by main.ts and return ErrSessionLocked.
//	    5. Return the live session.
//
//	Send:
//	    Marshal command, write a single JSON line to stdin, register a
//	    pending entry keyed by ID, wait on its channel.
//
//	Events:
//	    Returned to the bridge as a read-only channel. The reader goroutine
//	    closes the channel on subprocess exit.
//
//	Close:
//	    Send abort (ignoring errors) → close stdin → wait for subprocess
//	    exit up to CloseTimeout → SIGKILL fallback → drain reader goroutine.
package local

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"vetta-im-gateway/internal/hostclient"
)

// session implements hostclient.HostSession backed by one coding-agent
// subprocess.
type session struct {
	cwd         string
	sessionPath string

	// resolvedSessionPath is the .jsonl file the agent actually ended up
	// using. Captured from the handshake get_state response. May differ from
	// sessionPath when the caller passed empty (signaling "let agent create
	// a fresh session"). SessionPath() returns this when set, falling back
	// to the original input.
	resolvedMu          sync.Mutex
	resolvedSessionPath string

	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stderr *bytes.Buffer // captured for error reporting on early exit

	// pending request correlation
	pendingMu sync.Mutex
	pending   map[string]chan hostclient.Response
	nextID    atomic.Uint64

	// events delivered to the bridge
	events chan hostclient.AgentEvent

	// reader goroutine signals exit + final exit error here
	exited chan struct{}
	exitMu sync.Mutex
	exitOK bool

	closeOnce sync.Once
	closeErr  error

	closeTimeout time.Duration
}

// Compile-time check that *session satisfies the public interface.
var _ hostclient.HostSession = (*session)(nil)

// SessionPath implements hostclient.HostSession. Returns the agent's
// real session file (captured from get_state during handshake) when known,
// otherwise the input path passed to OpenSession.
func (s *session) SessionPath() string {
	s.resolvedMu.Lock()
	defer s.resolvedMu.Unlock()
	if s.resolvedSessionPath != "" {
		return s.resolvedSessionPath
	}
	return s.sessionPath
}

// setResolvedSessionPath records the agent's actual session file path.
// Called from the handshake after parsing the get_state response.
func (s *session) setResolvedSessionPath(path string) {
	s.resolvedMu.Lock()
	defer s.resolvedMu.Unlock()
	s.resolvedSessionPath = path
}

// Events implements hostclient.HostSession.
func (s *session) Events() <-chan hostclient.AgentEvent { return s.events }

// Send implements hostclient.HostSession. Generates an ID if cmd.ID is empty.
func (s *session) Send(ctx context.Context, cmd hostclient.Command) (hostclient.Response, error) {
	if cmd.ID == "" {
		cmd.ID = "im-" + strconv.FormatUint(s.nextID.Add(1), 10)
	}

	respCh := make(chan hostclient.Response, 1)
	s.pendingMu.Lock()
	if s.pending == nil {
		s.pendingMu.Unlock()
		return hostclient.Response{}, errors.New("hostclient/local: session is closed")
	}
	s.pending[cmd.ID] = respCh
	s.pendingMu.Unlock()

	defer func() {
		s.pendingMu.Lock()
		delete(s.pending, cmd.ID)
		s.pendingMu.Unlock()
	}()

	if err := s.writeCommand(cmd); err != nil {
		return hostclient.Response{}, err
	}

	select {
	case resp := <-respCh:
		return resp, nil
	case <-s.exited:
		return hostclient.Response{}, fmt.Errorf("hostclient/local: subprocess exited before response (id=%s, type=%s): %s", cmd.ID, cmd.Type, s.tailStderr())
	case <-ctx.Done():
		return hostclient.Response{}, ctx.Err()
	}
}

func (s *session) writeCommand(cmd hostclient.Command) error {
	payload := map[string]any{
		"id":   cmd.ID,
		"type": cmd.Type,
	}
	for k, v := range cmd.Data {
		// Don't let Data clobber the protocol's reserved keys.
		if k == "id" || k == "type" {
			continue
		}
		payload[k] = v
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("hostclient/local: marshal command: %w", err)
	}
	raw = append(raw, '\n')

	if _, err := s.stdin.Write(raw); err != nil {
		return fmt.Errorf("hostclient/local: write stdin: %w", err)
	}
	return nil
}

// SendNoReply implements hostclient.HostSession. Writes the command to
// stdin and returns immediately without registering a pending channel.
// Used for fire-and-forget host→agent commands like `host_response`,
// which the agent consumes but does not echo back as a `response`.
func (s *session) SendNoReply(_ context.Context, cmd hostclient.Command) error {
	return s.writeCommand(cmd)
}

// Close implements hostclient.HostSession.
func (s *session) Close() error {
	s.closeOnce.Do(func() {
		// Best-effort abort first; ignore errors because the subprocess
		// may already be exiting.
		_ = s.writeCommand(hostclient.Command{
			ID:   "im-close-abort",
			Type: hostclient.CommandTypeAbort,
		})

		// Closing stdin signals the rpc loop to exit (its readline returns).
		_ = s.stdin.Close()

		// Wait for graceful exit, then SIGKILL fallback.
		select {
		case <-s.exited:
		case <-time.After(s.closeTimeout):
			if s.cmd.Process != nil {
				_ = s.cmd.Process.Signal(syscall.SIGKILL)
			}
			<-s.exited
		}

		// Drain the events channel so any goroutine reading from it sees
		// the close.
		s.pendingMu.Lock()
		s.pending = nil
		s.pendingMu.Unlock()

		s.exitMu.Lock()
		ok := s.exitOK
		s.exitMu.Unlock()
		if !ok {
			s.closeErr = fmt.Errorf("hostclient/local: subprocess exited non-zero: %s", s.tailStderr())
		}
	})
	return s.closeErr
}

// readerLoop runs in its own goroutine consuming stdout. It dispatches each
// JSON line to either the pending-response map (for `{type:"response", id}`)
// or to the events channel (for everything else, including responses without
// an id which are treated as out-of-band events).
//
// The loop terminates when stdout closes (subprocess exited or pipe closed).
func (s *session) readerLoop(stdout io.ReadCloser) {
	defer close(s.events)

	// Optional debug tee: if IM_GATEWAY_DEBUG_AGENT_STDOUT is set, mirror
	// every line we read to that file BEFORE parsing. Used for diagnosing
	// "agent only emitted N tokens then stopped" type bugs without having
	// to instrument the bridge or guess at the JSON shapes.
	var debugTee *os.File
	if path := os.Getenv("IM_GATEWAY_DEBUG_AGENT_STDOUT"); path != "" {
		f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err == nil {
			debugTee = f
			defer debugTee.Close()
			fmt.Fprintf(debugTee, "\n=== session opened: cwd=%s sessionPath=%s pid=%d ===\n",
				s.cwd, s.sessionPath, os.Getpid())
		} else {
			fmt.Fprintf(os.Stderr, "im-gateway debug tee open failed: %v\n", err)
		}
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024) // allow large lines

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		if debugTee != nil {
			_, _ = debugTee.Write(line)
			_, _ = debugTee.Write([]byte{'\n'})
		}

		// Peek at type / id without fully decoding the payload twice.
		var head struct {
			Type    string          `json:"type"`
			ID      string          `json:"id"`
			Command string          `json:"command"`
			Success *bool           `json:"success"`
			Error   string          `json:"error"`
			Data    json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(line, &head); err != nil {
			// Malformed line: surface as an error event but keep the loop
			// alive — coding-agent might recover.
			s.deliverEvent(hostclient.AgentEvent{
				Type: hostclient.AgentEventTypeError,
				Raw:  json.RawMessage(line),
			})
			continue
		}

		if head.Type == "response" && head.ID != "" {
			s.deliverResponse(head.ID, hostclient.Response{
				ID:      head.ID,
				Command: head.Command,
				Success: head.Success != nil && *head.Success,
				Error:   head.Error,
				Data:    decodeData(head.Data),
			})
			continue
		}

		// Treat everything else as a forward-only event. The bridge
		// switches on Type and ignores anything it doesn't understand.
		// This includes startup-time error responses without an id (e.g.
		// the structured lock error emitted by main.ts before runRpcMode).
		raw := make(json.RawMessage, len(line))
		copy(raw, line)
		s.deliverEvent(hostclient.AgentEvent{
			Type: head.Type,
			Raw:  raw,
		})
	}
}

func (s *session) deliverResponse(id string, resp hostclient.Response) {
	s.pendingMu.Lock()
	ch, ok := s.pending[id]
	s.pendingMu.Unlock()
	if !ok {
		return // late or duplicate; drop
	}
	select {
	case ch <- resp:
	default:
		// Receiver gone; drop.
	}
}

func (s *session) deliverEvent(ev hostclient.AgentEvent) {
	select {
	case s.events <- ev:
	default:
		// Buffer full — block briefly so we don't drop events lightly.
		// In practice the bridge consumes events as fast as the agent
		// produces them; this is just a safety net.
		s.events <- ev
	}
}

func (s *session) markExited(err error) {
	s.exitMu.Lock()
	s.exitOK = err == nil
	s.exitMu.Unlock()
	close(s.exited)

	// Wake any in-flight Send calls.
	s.pendingMu.Lock()
	for id, ch := range s.pending {
		select {
		case ch <- hostclient.Response{
			ID:      id,
			Success: false,
			Error:   "subprocess exited",
		}:
		default:
		}
	}
	s.pendingMu.Unlock()
}

func (s *session) tailStderr() string {
	if s.stderr == nil {
		return ""
	}
	out := s.stderr.String()
	const limit = 2048
	if len(out) > limit {
		out = "..." + out[len(out)-limit:]
	}
	return out
}

func decodeData(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

// envWithoutDuplicates merges os.Environ with extra entries, last-write-wins.
// Reserved for future use; placeholder so cmd construction stays explicit.
func envWithoutDuplicates(extra map[string]string) []string {
	out := os.Environ()
	for k, v := range extra {
		out = append(out, k+"="+v)
	}
	return out
}
