package server

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// client drives a Server over in-memory pipes — the same framing a real SSH
// channel carries, minus the network.
type client struct {
	t        *testing.T
	in       io.WriteCloser
	mu       sync.Mutex
	nextID   uint64
	waiting  map[uint64]chan rawResponse
	notified chan rawNotification
	done     chan struct{}
}

type rawResponse struct {
	ID     uint64          `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type rawNotification struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

func startServer(t *testing.T, stateDir string) *client {
	t.Helper()
	requestReader, requestWriter := io.Pipe()
	responseReader, responseWriter := io.Pipe()
	c := &client{
		t:        t,
		in:       requestWriter,
		waiting:  map[uint64]chan rawResponse{},
		notified: make(chan rawNotification, 16),
		done:     make(chan struct{}),
	}
	server := New(Options{StateDir: stateDir, WatchInterval: 20 * time.Millisecond})
	go func() {
		_ = server.Serve(requestReader, responseWriter)
		responseWriter.Close()
	}()
	go func() {
		defer close(c.done)
		scanner := bufio.NewScanner(responseReader)
		scanner.Buffer(make([]byte, 0, 64<<10), maxFrameBytes)
		for scanner.Scan() {
			var probe struct {
				ID *uint64 `json:"id"`
			}
			line := append([]byte(nil), scanner.Bytes()...)
			if json.Unmarshal(line, &probe) != nil {
				continue
			}
			if probe.ID == nil {
				var note rawNotification
				_ = json.Unmarshal(line, &note)
				c.notified <- note
				continue
			}
			var response rawResponse
			_ = json.Unmarshal(line, &response)
			c.mu.Lock()
			channel := c.waiting[response.ID]
			delete(c.waiting, response.ID)
			c.mu.Unlock()
			if channel != nil {
				channel <- response
			}
		}
	}()
	t.Cleanup(c.close)
	return c
}

// close ends the connection the way a dropped SSH channel does: stdin closes,
// the server drains and returns.
func (c *client) close() {
	_ = c.in.Close()
	select {
	case <-c.done:
	case <-time.After(5 * time.Second):
		c.t.Error("server did not shut down after its input closed")
	}
}

func (c *client) call(method string, params any, result any) *rawResponse {
	c.t.Helper()
	c.mu.Lock()
	c.nextID++
	id := c.nextID
	channel := make(chan rawResponse, 1)
	c.waiting[id] = channel
	c.mu.Unlock()
	frame, err := json.Marshal(map[string]any{"id": id, "method": method, "params": params})
	if err != nil {
		c.t.Fatal(err)
	}
	if _, err := c.in.Write(append(frame, '\n')); err != nil {
		c.t.Fatal(err)
	}
	select {
	case response := <-channel:
		if response.Error == nil && result != nil {
			if err := json.Unmarshal(response.Result, result); err != nil {
				c.t.Fatalf("%s: cannot decode result %s: %v", method, response.Result, err)
			}
		}
		return &response
	case <-time.After(20 * time.Second):
		c.t.Fatalf("%s: no response", method)
		return nil
	}
}

func (c *client) mustCall(method string, params any, result any) {
	c.t.Helper()
	if response := c.call(method, params, result); response.Error != nil {
		c.t.Fatalf("%s failed: %s: %s", method, response.Error.Code, response.Error.Message)
	}
}

func encode(text string) string { return base64.StdEncoding.EncodeToString([]byte(text)) }

func TestHelloReportsProtocolVersionAndPlatform(t *testing.T) {
	c := startServer(t, t.TempDir())
	var hello struct {
		ProtocolVersion string `json:"protocolVersion"`
		OS              string `json:"os"`
		Home            string `json:"home"`
	}
	c.mustCall("hello", nil, &hello)
	if hello.ProtocolVersion == "" || hello.OS == "" || hello.Home == "" {
		t.Fatalf("incomplete handshake: %+v", hello)
	}
}

func TestUnknownMethodIsAnErrorNotAHang(t *testing.T) {
	c := startServer(t, t.TempDir())
	response := c.call("future.method", nil, nil)
	if response.Error == nil || response.Error.Code != "ENOSYS" {
		t.Fatalf("want ENOSYS, got %+v", response.Error)
	}
}

func TestWriteKeepsExecutableBitAndWritesThroughSymlinks(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "run.sh")
	if err := os.WriteFile(script, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link.sh")
	if err := os.Symlink(script, link); err != nil {
		t.Fatal(err)
	}
	c := startServer(t, t.TempDir())

	c.mustCall("fs.writeFile", map[string]any{"path": link, "data": encode("new")}, nil)

	if info, _ := os.Lstat(link); info.Mode()&os.ModeSymlink == 0 {
		t.Fatal("the symlink was replaced by a regular file")
	}
	if data, _ := os.ReadFile(script); string(data) != "new" {
		t.Fatalf("link target not updated: %q", data)
	}
	if info, _ := os.Stat(script); info.Mode().Perm() != 0o755 {
		t.Fatalf("executable bit lost: %v", info.Mode().Perm())
	}
	leftovers, _ := filepath.Glob(filepath.Join(dir, ".*vetta-tmp*"))
	if len(leftovers) != 0 {
		t.Fatalf("temp files left behind: %v", leftovers)
	}
}

func TestEditIsOneRoundTripAndRefusesToClobberAConcurrentChange(t *testing.T) {
	file := filepath.Join(t.TempDir(), "main.ts")
	if err := os.WriteFile(file, []byte("const port = 3000;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	c := startServer(t, t.TempDir())
	var read struct {
		Data     string `json:"data"`
		Revision string `json:"revision"`
	}
	c.mustCall("fs.readFile", map[string]any{"path": file, "length": -1}, &read)

	// Someone else edits the file between our read and our write.
	if err := os.WriteFile(file, []byte("const port = 9999;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	stale := c.call("fs.writeFile", map[string]any{"path": file, "data": encode("mine"), "expectedRevision": read.Revision}, nil)
	if stale.Error == nil || stale.Error.Code != "ECONFLICT" {
		t.Fatalf("want ECONFLICT, got %+v", stale.Error)
	}
	if data, _ := os.ReadFile(file); string(data) != "const port = 9999;\n" {
		t.Fatalf("the concurrent change was overwritten: %q", data)
	}
}

func TestStatDistinguishesMissingFromFailure(t *testing.T) {
	c := startServer(t, t.TempDir())
	var result struct {
		Entry *Entry `json:"entry"`
	}
	c.mustCall("fs.stat", map[string]any{"path": filepath.Join(t.TempDir(), "missing")}, &result)
	if result.Entry != nil {
		t.Fatalf("missing path reported as %+v", result.Entry)
	}
	if response := c.call("fs.stat", map[string]any{"path": "relative/path"}, nil); response.Error == nil {
		t.Fatal("a relative path must be rejected")
	}
}

func TestCreateEntryNeverOverwrites(t *testing.T) {
	dir := t.TempDir()
	existing := filepath.Join(dir, "keep.txt")
	if err := os.WriteFile(existing, []byte("precious"), 0o644); err != nil {
		t.Fatal(err)
	}
	c := startServer(t, t.TempDir())
	if response := c.call("fs.createEntry", map[string]any{"path": existing, "kind": "file"}, nil); response.Error == nil || response.Error.Code != "EEXIST" {
		t.Fatalf("want EEXIST, got %+v", response.Error)
	}
	if data, _ := os.ReadFile(existing); string(data) != "precious" {
		t.Fatalf("existing file was truncated: %q", data)
	}
	c.mustCall("fs.createEntry", map[string]any{"path": filepath.Join(dir, "src"), "kind": "directory"}, nil)
}

func TestListRecursiveSkipsHiddenAndIgnoredTrees(t *testing.T) {
	root := t.TempDir()
	for _, file := range []string{"README.md", "src/deep/a b.ts", "node_modules/pkg/index.js", ".git/config", ".env"} {
		path := filepath.Join(root, file)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	c := startServer(t, t.TempDir())
	var result struct {
		Files     []string `json:"files"`
		Truncated bool     `json:"truncated"`
	}
	c.mustCall("fs.listRecursive", map[string]any{"path": root, "ignoredDirectories": []string{"node_modules"}}, &result)
	if got := strings.Join(result.Files, ","); got != "README.md,src/deep/a b.ts" {
		t.Fatalf("unexpected listing: %s", got)
	}
	c.mustCall("fs.listRecursive", map[string]any{"path": root, "limit": 1}, &result)
	if len(result.Files) != 1 || !result.Truncated {
		t.Fatalf("limit not applied: %+v", result)
	}
}

func TestRemoveRefusesTheRootDirectory(t *testing.T) {
	c := startServer(t, t.TempDir())
	if response := c.call("fs.remove", map[string]any{"path": "/"}, nil); response.Error == nil {
		t.Fatal("removing / must be refused")
	}
}

func TestWatchNotifiesWhenAnOpenDirectoryChanges(t *testing.T) {
	dir := t.TempDir()
	c := startServer(t, t.TempDir())
	c.mustCall("watch.subscribe", map[string]any{"path": dir}, nil)

	if err := os.WriteFile(filepath.Join(dir, "new.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	select {
	case note := <-c.notified:
		if note.Method != "watch.changed" || !strings.Contains(string(note.Params), dir) {
			t.Fatalf("unexpected notification: %+v", note)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no change notification")
	}

	c.mustCall("watch.unsubscribe", map[string]any{"path": dir}, nil)
	if err := os.WriteFile(filepath.Join(dir, "later.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	select {
	case note := <-c.notified:
		t.Fatalf("notified after unsubscribe: %+v", note)
	case <-time.After(150 * time.Millisecond):
	}
}

type taskView struct {
	ID         string `json:"id"`
	State      string `json:"state"`
	ExitCode   *int   `json:"exitCode"`
	OutputSize int64  `json:"outputSize"`
}

type readView struct {
	Data       string   `json:"data"`
	NextOffset int64    `json:"nextOffset"`
	Status     taskView `json:"status"`
}

func useShellAsLoginShell(t *testing.T) {
	t.Helper()
	// A developer's own zsh profile is slow and makes the result machine-dependent.
	t.Setenv("SHELL", "/bin/sh")
}

// The reason the helper exists: a task started over one connection keeps running
// after that connection is gone, and a later connection can pick it up.
func TestTaskSurvivesTheConnectionThatStartedIt(t *testing.T) {
	useShellAsLoginShell(t)
	stateDir := t.TempDir()
	workDir := t.TempDir()

	first := startServer(t, stateDir)
	var started taskView
	first.mustCall("proc.spawn", map[string]any{
		"command": "echo started; sleep 0.4; echo finished; exit 3",
		"cwd":     workDir,
	}, &started)
	if started.State != "live" {
		t.Fatalf("task should be live right after spawn, got %q", started.State)
	}
	first.close() // The laptop lid closes.

	second := startServer(t, stateDir)
	var listed struct {
		Tasks []taskView `json:"tasks"`
	}
	second.mustCall("proc.list", nil, &listed)
	if len(listed.Tasks) != 1 || listed.Tasks[0].ID != started.ID {
		t.Fatalf("the new connection cannot see the task: %+v", listed.Tasks)
	}

	output := ""
	offset := int64(0)
	for {
		var read readView
		second.mustCall("proc.read", map[string]any{"id": started.ID, "offset": offset, "waitMs": 5000}, &read)
		output += read.Data
		offset = read.NextOffset
		if read.Status.State != "live" && read.Data == "" {
			if read.Status.State != "exited" || read.Status.ExitCode == nil || *read.Status.ExitCode != 3 {
				t.Fatalf("want exited(3), got %+v", read.Status)
			}
			break
		}
	}
	if output != "started\nfinished\n" {
		t.Fatalf("output lost across the reconnect: %q", output)
	}
}

func TestKillStopsTheWholeProcessTree(t *testing.T) {
	useShellAsLoginShell(t)
	workDir := t.TempDir()
	marker := filepath.Join(workDir, "child.pid")
	c := startServer(t, t.TempDir())
	var started taskView
	c.mustCall("proc.spawn", map[string]any{
		// A dev server is never one process: the shell spawns a child that would be
		// orphaned if only the leader were signaled.
		"command": "sh -c 'echo $$ > " + marker + "; sleep 60' & sleep 60",
		"cwd":     workDir,
	}, &started)
	waitFor(t, func() bool { _, err := os.Stat(marker); return err == nil })

	var killed taskView
	c.mustCall("proc.kill", map[string]any{"id": started.ID}, &killed)
	if killed.State == "live" {
		t.Fatal("task still live after kill")
	}
	waitFor(t, func() bool { return !processGroupAlive(startedPid(t, c, started.ID)) })

	if response := c.call("proc.remove", map[string]any{"id": started.ID}, nil); response.Error != nil {
		t.Fatalf("cannot forget a stopped task: %+v", response.Error)
	}
}

func startedPid(t *testing.T, c *client, id string) int {
	t.Helper()
	var status struct {
		Pid int `json:"pid"`
	}
	c.mustCall("proc.status", map[string]any{"id": id}, &status)
	return status.Pid
}

func TestSpawnFailsInsteadOfRunningInAnotherDirectory(t *testing.T) {
	useShellAsLoginShell(t)
	c := startServer(t, t.TempDir())
	response := c.call("proc.spawn", map[string]any{"command": "pwd", "cwd": filepath.Join(t.TempDir(), "gone")}, nil)
	if response.Error == nil || response.Error.Code != "ENOENT" {
		t.Fatalf("want ENOENT, got %+v", response.Error)
	}
}

func TestTaskIDCannotEscapeTheStateDirectory(t *testing.T) {
	c := startServer(t, t.TempDir())
	for _, id := range []string{"../../etc", "", "a/b", "UPPERCASE1"} {
		if response := c.call("proc.status", map[string]any{"id": id}, nil); response.Error == nil || response.Error.Code != "EINVAL" {
			t.Fatalf("id %q: want EINVAL, got %+v", id, response.Error)
		}
	}
}

func TestAVanishedTaskIsUnverifiableNotExited(t *testing.T) {
	stateDir := t.TempDir()
	dir := filepath.Join(stateDir, "tasks", "deadbeef00")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	// A record with no exit file and no live process: the host rebooted, or the
	// process was killed from outside. We have no evidence of how it ended.
	if err := writeJSONAtomic(filepath.Join(dir, "meta.json"), taskMeta{ID: "deadbeef00", Command: "x", Cwd: "/", Pid: 2147483000}); err != nil {
		t.Fatal(err)
	}
	c := startServer(t, stateDir)
	var status taskView
	c.mustCall("proc.status", map[string]any{"id": "deadbeef00"}, &status)
	if status.State != "unverifiable" || status.ExitCode != nil {
		t.Fatalf("want unverifiable with no exit code, got %+v", status)
	}
}

func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in time")
		}
		time.Sleep(20 * time.Millisecond)
	}
}
