package local

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"vetta-im-gateway/internal/hostclient"
)

// fakeAgent writes a small Go program that mimics the parts of the
// coding-agent rpc protocol the hostclient cares about, then compiles it
// to a tempdir binary. Tests point Client at the fake instead of the real
// agent so we can exercise handshake / Send / events / Close / lock-error
// paths without depending on the actual coding-agent build.
//
// Behavior is controlled by command-line flags on the fake itself:
//
//	--lock     emit the structured startup lock error and exit 2
//	--crash    write garbage and exit 1 immediately
//	--silent   never emit anything (used to test handshake timeout)
//	--echo     echo any prompt back as a message_update event then agent_end
//
// Without flags the fake answers get_state with a successful response and
// then loops until stdin closes.
func buildFakeAgent(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("fake agent build flow is POSIX-only for now")
	}

	src := `package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
)

func main() {
	lock := flag.Bool("lock", false, "")
	crash := flag.Bool("crash", false, "")
	silent := flag.Bool("silent", false, "")
	echo := flag.Bool("echo", false, "")
	// Accept and ignore the flags coding-agent itself uses so the test
	// invocation looks realistic.
	_ = flag.String("mode", "rpc", "")
	_ = flag.String("cwd", "", "")
	_ = flag.String("session", "", "")
	flag.Parse()

	if *lock {
		json.NewEncoder(os.Stdout).Encode(map[string]any{
			"type":           "response",
			"command":        "startup",
			"success":        false,
			"errorCode":      "session_locked",
			"phase":          "startup",
			"recoverability": "user_action",
			"error":          "session locked",
			"lockHolder": map[string]any{
				"pid":      99999,
				"hostname": "test-host",
				"openedAt": "2024-01-01T00:00:00Z",
			},
		})
		os.Exit(2)
	}
	if *crash {
		fmt.Fprintln(os.Stderr, "fatal: nope")
		fmt.Println("not valid json at all")
		os.Exit(1)
	}
	if *silent {
		// Just block forever, never reading stdin so the parent's send
		// goes nowhere and the handshake should time out.
		select {}
	}

	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 64*1024), 4*1024*1024)
	enc := json.NewEncoder(os.Stdout)
	for in.Scan() {
		line := strings.TrimSpace(in.Text())
		if line == "" {
			continue
		}
		var cmd struct {
			ID      string ` + "`json:\"id\"`" + `
			Type    string ` + "`json:\"type\"`" + `
			Message string ` + "`json:\"message\"`" + `
		}
		if err := json.Unmarshal([]byte(line), &cmd); err != nil {
			continue
		}
		switch cmd.Type {
		case "get_state":
			enc.Encode(map[string]any{
				"id":      cmd.ID,
				"type":    "response",
				"command": "get_state",
				"success": true,
				"data": map[string]any{
					"sessionId": "test-session",
				},
			})
		case "prompt":
			enc.Encode(map[string]any{
				"id":      cmd.ID,
				"type":    "response",
				"command": "prompt",
				"success": true,
			})
			if *echo {
				enc.Encode(map[string]any{
					"type": "message_update",
					"data": map[string]any{"text": cmd.Message},
				})
				enc.Encode(map[string]any{
					"type": "agent_end",
				})
			}
		case "abort":
			enc.Encode(map[string]any{
				"id":      cmd.ID,
				"type":    "response",
				"command": "abort",
				"success": true,
			})
		default:
			enc.Encode(map[string]any{
				"id":             cmd.ID,
				"type":           "response",
				"command":        cmd.Type,
				"success":        false,
				"errorCode":      "command_not_supported",
				"phase":          "command",
				"recoverability": "user_action",
				"error":          "unknown command in fake agent",
			})
		}
	}
}
`

	dir := t.TempDir()
	srcPath := filepath.Join(dir, "fake_agent.go")
	if err := os.WriteFile(srcPath, []byte(src), 0o600); err != nil {
		t.Fatal(err)
	}
	binPath := filepath.Join(dir, "fake-agent")
	mustGo(t, "build", "-o", binPath, srcPath)
	return binPath
}

func mustGo(t *testing.T, args ...string) {
	t.Helper()
	cmd := exec.Command("go", args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("go %v: %v\n%s", args, err, out)
	}
}

func TestOpenSession_HandshakeSuccess(t *testing.T) {
	bin := buildFakeAgent(t)
	c := New(Options{Bin: bin, HandshakeTimeout: 5 * time.Second, CloseTimeout: 2 * time.Second})

	sess, err := c.OpenSession(context.Background(), t.TempDir(), filepath.Join(t.TempDir(), "session.jsonl"))
	if err != nil {
		t.Fatalf("OpenSession: %v", err)
	}
	defer sess.Close()

	if sess.SessionPath() == "" {
		t.Error("SessionPath should be set")
	}
}

func TestOpenSession_StartupLockError(t *testing.T) {
	bin := buildFakeAgent(t)
	// Reuse the fake but add the --lock flag via Options.ExtraEnv? No: we
	// need command-line args. Build a wrapper that always passes --lock.
	wrapper := writeWrapperScript(t, bin, "--lock")

	c := New(Options{Bin: wrapper, HandshakeTimeout: 5 * time.Second, CloseTimeout: 2 * time.Second})
	_, err := c.OpenSession(context.Background(), t.TempDir(), filepath.Join(t.TempDir(), "session.jsonl"))
	if err == nil {
		t.Fatal("expected ErrSessionLocked")
	}
	var lockErr *hostclient.ErrSessionLocked
	if !errors.As(err, &lockErr) {
		t.Fatalf("expected *ErrSessionLocked, got %T: %v", err, err)
	}
	if lockErr.Holder.PID != 99999 {
		t.Errorf("holder pid: %d", lockErr.Holder.PID)
	}
	if lockErr.Holder.Hostname != "test-host" {
		t.Errorf("holder hostname: %q", lockErr.Holder.Hostname)
	}
}

func TestOpenSession_HandshakeTimeout(t *testing.T) {
	bin := buildFakeAgent(t)
	wrapper := writeWrapperScript(t, bin, "--silent")

	c := New(Options{Bin: wrapper, HandshakeTimeout: 200 * time.Millisecond, CloseTimeout: 1 * time.Second})
	_, err := c.OpenSession(context.Background(), t.TempDir(), filepath.Join(t.TempDir(), "session.jsonl"))
	if err == nil {
		t.Fatal("expected handshake timeout error")
	}
	assertTypedFailure(t, err, hostclient.FailureCodeHandshakeTimeout, hostclient.FailurePhaseStartup, hostclient.FailureRetrySafe)
}

func TestOpenSession_CrashOnStart(t *testing.T) {
	bin := buildFakeAgent(t)
	wrapper := writeWrapperScript(t, bin, "--crash")

	c := New(Options{Bin: wrapper, HandshakeTimeout: 2 * time.Second, CloseTimeout: 1 * time.Second})
	_, err := c.OpenSession(context.Background(), t.TempDir(), filepath.Join(t.TempDir(), "session.jsonl"))
	if err == nil {
		t.Fatal("expected error from crashing fake")
	}
	assertTypedFailure(t, err, hostclient.FailureCodeProcessExited, hostclient.FailurePhaseStartup, hostclient.FailureRetrySafe)
}

func TestSession_PromptAndEvents(t *testing.T) {
	bin := buildFakeAgent(t)
	wrapper := writeWrapperScript(t, bin, "--echo")

	c := New(Options{Bin: wrapper, HandshakeTimeout: 5 * time.Second, CloseTimeout: 2 * time.Second})
	sess, err := c.OpenSession(context.Background(), t.TempDir(), filepath.Join(t.TempDir(), "session.jsonl"))
	if err != nil {
		t.Fatalf("OpenSession: %v", err)
	}
	defer sess.Close()

	resp, err := sess.Send(context.Background(), hostclient.Command{
		Type: hostclient.CommandTypePrompt,
		Data: map[string]any{"message": "hello"},
	})
	if err != nil {
		t.Fatalf("Send prompt: %v", err)
	}
	if !resp.Success {
		t.Errorf("prompt response not success: %+v", resp)
	}

	// Wait for the message_update + agent_end events that the fake echoes.
	deadline := time.After(2 * time.Second)
	gotMessageUpdate := false
	gotAgentEnd := false
	for !(gotMessageUpdate && gotAgentEnd) {
		select {
		case ev, ok := <-sess.Events():
			if !ok {
				t.Fatal("events channel closed before expected events arrived")
			}
			switch ev.Type {
			case hostclient.AgentEventTypeMessageUpdate:
				gotMessageUpdate = true
			case hostclient.AgentEventTypeAgentEnd:
				gotAgentEnd = true
			}
		case <-deadline:
			t.Fatalf("timed out waiting for events (got_update=%v got_end=%v)", gotMessageUpdate, gotAgentEnd)
		}
	}
}

func TestSession_Close_GracefulExit(t *testing.T) {
	bin := buildFakeAgent(t)
	c := New(Options{Bin: bin, HandshakeTimeout: 5 * time.Second, CloseTimeout: 2 * time.Second})
	sess, err := c.OpenSession(context.Background(), t.TempDir(), filepath.Join(t.TempDir(), "session.jsonl"))
	if err != nil {
		t.Fatalf("OpenSession: %v", err)
	}
	if err := sess.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	// Calling Close twice should be a no-op.
	if err := sess.Close(); err != nil {
		t.Fatalf("Close (second): %v", err)
	}
}

// writeWrapperScript writes a tiny shell script that exec's the real fake
// binary with the given extra args, so we can vary fake-agent behavior
// without rebuilding.
func writeWrapperScript(t *testing.T, target string, extra ...string) string {
	t.Helper()
	script := "#!/bin/sh\nexec \"" + target + "\""
	for _, a := range extra {
		script += " " + shellQuote(a)
	}
	script += " \"$@\"\n"

	dir := t.TempDir()
	path := filepath.Join(dir, "wrapper.sh")
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func assertTypedFailure(
	t *testing.T,
	err error,
	code hostclient.FailureCode,
	phase hostclient.FailurePhase,
	recoverability hostclient.FailureRecoverability,
) {
	t.Helper()
	var failure hostclient.TypedFailure
	if !errors.As(err, &failure) {
		t.Fatalf("expected typed failure, got %T: %v", err, err)
	}
	if failure.FailureCode() != code {
		t.Errorf("failure code: got %q, want %q", failure.FailureCode(), code)
	}
	if failure.FailurePhase() != phase {
		t.Errorf("failure phase: got %q, want %q", failure.FailurePhase(), phase)
	}
	if failure.FailureRecoverability() != recoverability {
		t.Errorf("failure recoverability: got %q, want %q", failure.FailureRecoverability(), recoverability)
	}
}
