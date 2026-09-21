package server

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

type ptyDataNote struct {
	ID      string `json:"id"`
	DataB64 string `json:"dataB64"`
	Dropped int64  `json:"dropped"`
}

type ptyExitNote struct {
	ID       string `json:"id"`
	ExitCode int    `json:"exitCode"`
}

func openPty(t *testing.T, c *client, cwd string) string {
	t.Helper()
	var opened struct {
		ID string `json:"id"`
	}
	c.mustCall("pty.open", map[string]any{"cwd": cwd, "shell": "/bin/sh", "cols": 80, "rows": 24}, &opened)
	if opened.ID == "" {
		t.Fatal("pty.open returned no id")
	}
	return opened.ID
}

func writePty(t *testing.T, c *client, id string, text string) {
	t.Helper()
	c.mustCall("pty.write", map[string]any{"id": id, "dataB64": encode(text)}, nil)
}

// awaitOutput drains pty.data notifications until the accumulated output
// contains needle, so a test never depends on how the kernel chunks the stream.
func awaitOutput(t *testing.T, c *client, id string, needle string, timeout time.Duration) string {
	t.Helper()
	var seen strings.Builder
	deadline := time.After(timeout)
	for {
		select {
		case note := <-c.notified:
			if note.Method != "pty.data" {
				continue
			}
			var data ptyDataNote
			if json.Unmarshal(note.Params, &data) != nil || data.ID != id {
				continue
			}
			chunk, err := base64.StdEncoding.DecodeString(data.DataB64)
			if err != nil {
				t.Fatalf("pty.data is not base64: %v", err)
			}
			seen.Write(chunk)
			if strings.Contains(seen.String(), needle) {
				return seen.String()
			}
		case <-deadline:
			t.Fatalf("did not see %q in pty output; got %q", needle, seen.String())
			return ""
		}
	}
}

func awaitExit(t *testing.T, c *client, id string, timeout time.Duration) ptyExitNote {
	t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case note := <-c.notified:
			if note.Method != "pty.exit" {
				continue
			}
			var exit ptyExitNote
			if json.Unmarshal(note.Params, &exit) != nil || exit.ID != id {
				continue
			}
			return exit
		case <-deadline:
			t.Fatalf("pty %s never reported an exit", id)
			return ptyExitNote{}
		}
	}
}

func TestPtyEchoesCommandOutput(t *testing.T) {
	c := startServer(t, t.TempDir())
	cwd := t.TempDir()
	id := openPty(t, c, cwd)

	writePty(t, c, id, "printf 'vetta-pty-ok\\n'\n")

	awaitOutput(t, c, id, "vetta-pty-ok", 20*time.Second)
}

func TestPtyRunsInRequestedDirectory(t *testing.T) {
	c := startServer(t, t.TempDir())
	cwd := t.TempDir()
	id := openPty(t, c, cwd)

	writePty(t, c, id, "pwd\n")

	// macOS 会把 /var 解析成 /private/var，所以只比对目录名。
	awaitOutput(t, c, id, lastSegment(cwd), 20*time.Second)
}

func lastSegment(path string) string {
	parts := strings.Split(strings.TrimRight(path, "/"), "/")
	return parts[len(parts)-1]
}

func TestPtyResizePropagatesWindowSize(t *testing.T) {
	c := startServer(t, t.TempDir())
	id := openPty(t, c, t.TempDir())
	// 先确认 shell 已经能应答，再改尺寸，避免 stty 跑在 shell 起来之前。
	writePty(t, c, id, "printf 'ready\\n'\n")
	awaitOutput(t, c, id, "ready", 20*time.Second)

	c.mustCall("pty.resize", map[string]any{"id": id, "cols": 120, "rows": 40}, nil)
	writePty(t, c, id, "stty size\n")

	// 真的把 winsize 下到了从端，子进程才能读到 40 120。
	awaitOutput(t, c, id, "40 120", 20*time.Second)
}

func TestPtyOpenRejectsMissingDirectoryInsteadOfFallingBackHome(t *testing.T) {
	c := startServer(t, t.TempDir())

	response := c.call("pty.open", map[string]any{"cwd": "/definitely/not/here", "cols": 80, "rows": 24}, nil)

	if response.Error == nil {
		t.Fatal("pty.open accepted a missing cwd")
	}
	if response.Error.Code != "ENOENT" {
		t.Fatalf("expected ENOENT, got %s", response.Error.Code)
	}
}

func TestPtyCloseEndsTheSessionAndReportsExit(t *testing.T) {
	c := startServer(t, t.TempDir())
	id := openPty(t, c, t.TempDir())
	writePty(t, c, id, "printf 'ready\\n'\n")
	awaitOutput(t, c, id, "ready", 20*time.Second)

	c.mustCall("pty.close", map[string]any{"id": id}, nil)

	awaitExit(t, c, id, 20*time.Second)
	var listed struct {
		Sessions []map[string]any `json:"sessions"`
	}
	c.mustCall("pty.list", nil, &listed)
	if len(listed.Sessions) != 0 {
		t.Fatalf("closed pty is still listed: %+v", listed.Sessions)
	}
}

func TestPtyExitIsReportedWhenTheShellExitsOnItsOwn(t *testing.T) {
	c := startServer(t, t.TempDir())
	id := openPty(t, c, t.TempDir())

	writePty(t, c, id, "exit 3\n")

	exit := awaitExit(t, c, id, 20*time.Second)
	if exit.ExitCode != 3 {
		t.Fatalf("expected exit code 3, got %d", exit.ExitCode)
	}
}

func TestPtyWriteRejectsUnknownSessionAndBadPayload(t *testing.T) {
	c := startServer(t, t.TempDir())
	id := openPty(t, c, t.TempDir())

	unknown := c.call("pty.write", map[string]any{"id": "pty-nope", "dataB64": encode("x")}, nil)
	if unknown.Error == nil || unknown.Error.Code != "ENOENT" {
		t.Fatalf("expected ENOENT for unknown pty, got %+v", unknown.Error)
	}

	invalid := c.call("pty.write", map[string]any{"id": id, "dataB64": "not base64!!"}, nil)
	if invalid.Error == nil || invalid.Error.Code != "EINVAL" {
		t.Fatalf("expected EINVAL for bad payload, got %+v", invalid.Error)
	}
}

// 背压：刷屏的终端不能长期饿死其他请求，缓冲也必须有界。
//
// 注意断言的边界：客户端完全不读时连回复本身都送不出去，那是传输层的正常回压，
// 不是 helper 的问题。这里模拟的是真实客户端——一直在收通知——同时要求普通请求
// 仍能及时返回，而不是排在刷屏输出后面。
func TestPtyFloodKeepsOtherRequestsResponsive(t *testing.T) {
	c := startServer(t, t.TempDir())
	id := openPty(t, c, t.TempDir())

	// 真实客户端会一直收通知；不读的话连 hello 的回复也挤不出管道。
	go func() {
		for range c.notified {
		}
	}()

	writePty(t, c, id, "yes vetta-flood\n")

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var hello struct {
			OS string `json:"os"`
		}
		start := time.Now()
		c.mustCall("hello", nil, &hello)
		if elapsed := time.Since(start); elapsed > 2*time.Second {
			t.Fatalf("hello took %s while a pty was flooding", elapsed)
		}
	}

	c.mustCall("pty.close", map[string]any{"id": id}, nil)
}
