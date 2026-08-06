package local

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"vetta-im-gateway/internal/hostclient"
)

const (
	realAgentBinaryEnv     = "VETTA_TEST_AGENT_BIN"
	realAgentPackageDirEnv = "VETTA_TEST_PACKAGE_DIR"
	realAgentReply         = "IM_REAL_AGENT_REPLY"
	realAgentFileContent   = "IM real Agent tool loop content"
)

func TestRealAgent_IMToolLoopAndResume(t *testing.T) {
	binaryPath := os.Getenv(realAgentBinaryEnv)
	packageDir := os.Getenv(realAgentPackageDirEnv)
	if binaryPath == "" || packageDir == "" {
		t.Skipf("set %s and %s to run the real Agent acceptance test", realAgentBinaryEnv, realAgentPackageDirEnv)
	}

	root := t.TempDir()
	agentDir := filepath.Join(root, "agent")
	workspace := filepath.Join(root, "workspace")
	sessionDir := filepath.Join(root, "sessions")
	for _, dir := range []string{agentDir, workspace, sessionDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("create acceptance directory %s: %v", dir, err)
		}
	}
	workspaceFile := filepath.Join(workspace, "im-real-agent.txt")
	if err := os.WriteFile(workspaceFile, []byte(realAgentFileContent), 0o600); err != nil {
		t.Fatalf("write acceptance workspace file: %v", err)
	}

	provider := newRealAgentProvider(workspaceFile)
	defer provider.Close()
	writeRealAgentConfiguration(t, agentDir, provider.URL)

	client := New(Options{
		Bin: binaryPath,
		BinPrefixArgs: []string{
			"agent",
			"--provider", "test",
			"--model", "test-model",
			"--offline",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-themes",
			"--scenario", "im-claw",
		},
		EnableHostBridge: true,
		SessionDir:       sessionDir,
		HandshakeTimeout: 30 * time.Second,
		CloseTimeout:     15 * time.Second,
		ExtraEnv: map[string]string{
			"NO_COLOR":               "1",
			"VETTA_CODING_AGENT_DIR": agentDir,
			"VETTA_PACKAGE_DIR":      packageDir,
		},
	})

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	first, err := client.OpenSession(ctx, workspace, "")
	if err != nil {
		t.Fatalf("open fresh real Agent session: %v", err)
	}
	firstClosed := false
	defer func() {
		if !firstClosed {
			_ = first.Close()
		}
	}()
	sessionPath := first.SessionPath()
	assertPathWithin(t, sessionDir, sessionPath)
	if _, err := os.Stat(sessionPath); err != nil {
		t.Fatalf("fresh Agent session was not persisted at %s: %v", sessionPath, err)
	}
	ownershipLock := sessionPath + ".owner.lock"
	if _, err := os.Stat(ownershipLock); err != nil {
		t.Fatalf("fresh Agent session did not hold ownership lock %s: %v", ownershipLock, err)
	}

	response, err := first.Send(ctx, hostclient.Command{
		Type: hostclient.CommandTypePrompt,
		Data: map[string]any{"message": "Read im-real-agent.txt and report its exact content."},
	})
	if err != nil {
		t.Fatalf("send real Agent prompt: %v", err)
	}
	if !response.Success {
		t.Fatalf("real Agent prompt was rejected: %s", response.Error)
	}
	firstEvents := waitForAgentEnd(t, ctx, first.Events())
	assertEventContains(t, firstEvents, `"toolName":"read"`)
	assertEventContains(t, firstEvents, realAgentReply)
	if provider.RequestCount() != 2 {
		t.Fatalf("real Agent tool loop request count = %d, want 2", provider.RequestCount())
	}

	if err := first.Close(); err != nil {
		t.Fatalf("close fresh real Agent session: %v", err)
	}
	firstClosed = true
	assertPathRemoved(t, ownershipLock)

	second, err := client.OpenSession(ctx, workspace, sessionPath)
	if err != nil {
		t.Fatalf("resume real Agent session after close: %v", err)
	}
	defer second.Close()
	if second.SessionPath() != sessionPath {
		t.Fatalf("resumed Agent session path = %s, want %s", second.SessionPath(), sessionPath)
	}

	response, err = second.Send(ctx, hostclient.Command{
		Type: hostclient.CommandTypePrompt,
		Data: map[string]any{"message": "Confirm this IM session resumed successfully."},
	})
	if err != nil {
		t.Fatalf("send resumed real Agent prompt: %v", err)
	}
	if !response.Success {
		t.Fatalf("resumed real Agent prompt was rejected: %s", response.Error)
	}
	secondEvents := waitForAgentEnd(t, ctx, second.Events())
	assertEventContains(t, secondEvents, realAgentReply)
	if provider.RequestCount() != 3 {
		t.Fatalf("real Agent resumed request count = %d, want 3", provider.RequestCount())
	}

	if err := second.Close(); err != nil {
		t.Fatalf("close resumed real Agent session: %v", err)
	}
	assertPathRemoved(t, ownershipLock)
}

func waitForAgentEnd(t *testing.T, ctx context.Context, events <-chan hostclient.AgentEvent) []hostclient.AgentEvent {
	t.Helper()
	collected := make([]hostclient.AgentEvent, 0, 16)
	for {
		select {
		case event, ok := <-events:
			if !ok {
				t.Fatalf("real Agent event stream closed before agent_end")
			}
			collected = append(collected, event)
			if event.Type == hostclient.AgentEventTypeAgentEnd {
				return collected
			}
		case <-ctx.Done():
			t.Fatalf("wait for real Agent terminal event: %v", ctx.Err())
		}
	}
}

func assertEventContains(t *testing.T, events []hostclient.AgentEvent, expected string) {
	t.Helper()
	var output bytes.Buffer
	for _, event := range events {
		output.Write(event.Raw)
		output.WriteByte('\n')
	}
	if !strings.Contains(output.String(), expected) {
		t.Fatalf("real Agent events do not contain %q:\n%s", expected, output.String())
	}
}

func assertPathWithin(t *testing.T, parent, candidate string) {
	t.Helper()
	relative, err := filepath.Rel(parent, candidate)
	if err != nil {
		t.Fatalf("resolve Agent session path: %v", err)
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		t.Fatalf("Agent session path %s is outside acceptance session directory %s", candidate, parent)
	}
}

func assertPathRemoved(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		_, err := os.Stat(path)
		if os.IsNotExist(err) {
			return
		}
		if err != nil {
			t.Fatalf("inspect released Agent path %s: %v", path, err)
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("Agent path was not released: %s", path)
}
