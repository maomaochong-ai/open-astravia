package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"vetta-ssh-helper/internal/protocol"
)

// Tasks are long-running commands (dev servers, watchers, builds) that must
// outlive the SSH connection that started them.
//
// There is deliberately no daemon. A task is a detached process group whose
// entire state lives in a directory:
//
//	<stateDir>/tasks/<id>/meta.json   command, cwd, pid, start time
//	<stateDir>/tasks/<id>/output.log  combined stdout + stderr
//	<stateDir>/tasks/<id>/exit        exit code, written by the wrapper shell
//
// Any later helper process — after a laptop lid close, an app upgrade, a network
// change — can list, read, and stop the task by looking at that directory. A
// supervising daemon would add a second thing that can crash, a socket to
// secure, and a version-skew problem between the daemon and newer clients.
type taskMeta struct {
	ID        string `json:"id"`
	Command   string `json:"command"`
	Cwd       string `json:"cwd"`
	Pid       int    `json:"pid"`
	StartedMs int64  `json:"startedMs"`
}

// Task state is the three-value vocabulary from ADR-0124. "exited" requires
// positive evidence (the exit file); a vanished process without one is
// "unverifiable", never silently folded into either side.
const (
	stateLive         = "live"
	stateExited       = "exited"
	stateUnverifiable = "unverifiable"
)

type taskStatus struct {
	taskMeta
	State    string `json:"state"`
	ExitCode *int   `json:"exitCode,omitempty"`
	// OutputSize lets a reconnecting client resume reading where it stopped.
	OutputSize int64 `json:"outputSize"`
}

var taskIDPattern = regexp.MustCompile(`^[a-z0-9]{8,32}$`)

func (s *Server) tasksDir() string { return filepath.Join(s.stateDir, "tasks") }

func (s *Server) taskDir(id string) (string, *protocol.Error) {
	// The id becomes a path segment, so it must not be able to climb out.
	if !taskIDPattern.MatchString(id) {
		return "", protocol.Errorf(protocol.CodeInvalid, "invalid task id")
	}
	return filepath.Join(s.tasksDir(), id), nil
}

type spawnParams struct {
	Command string            `json:"command"`
	Cwd     string            `json:"cwd"`
	Env     map[string]string `json:"env"`
}

// wrapperScript runs the user's command through their login shell (so nvm,
// pyenv and friends are on PATH) and records the exit code afterwards. The
// code lands in a temp name first: a reader must never see a half-written file
// and mistake "" for a status.
const wrapperScript = `"${SHELL:-/bin/sh}" -l -c "$1"
code=$?
printf %s "$code" > "$2.tmp" && mv -f "$2.tmp" "$2"
exit "$code"`

func (s *Server) procSpawn(p spawnParams) (any, *protocol.Error) {
	if strings.TrimSpace(p.Command) == "" {
		return nil, protocol.Errorf(protocol.CodeInvalid, "command is required")
	}
	if e := requireAbsolute(p.Cwd); e != nil {
		return nil, e
	}
	// A missing cwd must fail the spawn. Falling back to $HOME would run the
	// command against a different directory than the one the user is looking at.
	if info, err := os.Stat(p.Cwd); err != nil || !info.IsDir() {
		return nil, protocol.Errorf(protocol.CodeNotFound, "working directory does not exist: "+p.Cwd)
	}
	id, err := newTaskID()
	if err != nil {
		return nil, protocol.Errorf(protocol.CodeInternal, err.Error())
	}
	dir := filepath.Join(s.tasksDir(), id)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, mapFsError(err)
	}
	output, err := os.OpenFile(filepath.Join(dir, "output.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil, mapFsError(err)
	}
	defer output.Close()

	cmd := exec.Command("/bin/sh", "-c", wrapperScript, "vetta-task", p.Command, filepath.Join(dir, "exit"))
	cmd.Dir = p.Cwd
	cmd.Env = os.Environ()
	for key, value := range p.Env {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	cmd.Stdin = nil
	cmd.Stdout = output
	cmd.Stderr = output
	// Its own session: closing the SSH channel signals the helper's process
	// group, and the task must not be in it. The new session also makes
	// pid == pgid, which is what lets a later helper stop the whole tree.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		_ = os.RemoveAll(dir)
		return nil, protocol.Errorf(protocol.CodeInternal, "failed to start: "+err.Error())
	}
	meta := taskMeta{ID: id, Command: p.Command, Cwd: p.Cwd, Pid: cmd.Process.Pid, StartedMs: time.Now().UnixMilli()}
	if err := writeJSONAtomic(filepath.Join(dir, "meta.json"), meta); err != nil {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		return nil, mapFsError(err)
	}
	// Reap it if it ends while we are still here; if we go first, init adopts it.
	go func() { _ = cmd.Wait() }()
	return s.statusOf(meta), nil
}

func newTaskID() (string, error) {
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func writeJSONAtomic(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	temp := path + ".tmp"
	if err := os.WriteFile(temp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(temp, path)
}

func readMeta(dir string) (taskMeta, error) {
	var meta taskMeta
	data, err := os.ReadFile(filepath.Join(dir, "meta.json"))
	if err != nil {
		return meta, err
	}
	return meta, json.Unmarshal(data, &meta)
}

func (s *Server) statusOf(meta taskMeta) taskStatus {
	dir := filepath.Join(s.tasksDir(), meta.ID)
	status := taskStatus{taskMeta: meta, State: stateUnverifiable}
	if info, err := os.Stat(filepath.Join(dir, "output.log")); err == nil {
		status.OutputSize = info.Size()
	}
	if data, err := os.ReadFile(filepath.Join(dir, "exit")); err == nil {
		if code, err := strconv.Atoi(strings.TrimSpace(string(data))); err == nil {
			status.State = stateExited
			status.ExitCode = &code
			return status
		}
	}
	if processGroupAlive(meta.Pid) {
		status.State = stateLive
	}
	return status
}

// processGroupAlive reports whether anything is left in the task's group.
// EPERM means "exists but not ours", which for a pid we created can only be a
// recycled pid — treat that as not alive rather than claim a stranger's process.
func processGroupAlive(pid int) bool {
	if pid <= 1 {
		return false
	}
	return syscall.Kill(-pid, 0) == nil
}

type taskIDParams struct {
	ID string `json:"id"`
}

func (s *Server) procStatus(p taskIDParams) (any, *protocol.Error) {
	dir, perr := s.taskDir(p.ID)
	if perr != nil {
		return nil, perr
	}
	meta, err := readMeta(dir)
	if err != nil {
		return nil, mapFsError(err)
	}
	return s.statusOf(meta), nil
}

func (s *Server) procList(_ struct{}) (any, *protocol.Error) {
	items, err := os.ReadDir(s.tasksDir())
	if errors.Is(err, fs.ErrNotExist) {
		return map[string]any{"tasks": []taskStatus{}}, nil
	}
	if err != nil {
		return nil, mapFsError(err)
	}
	tasks := make([]taskStatus, 0, len(items))
	for _, item := range items {
		if !item.IsDir() {
			continue
		}
		meta, err := readMeta(filepath.Join(s.tasksDir(), item.Name()))
		if err != nil {
			continue // Spawn raced with us, or a stale half-written dir.
		}
		tasks = append(tasks, s.statusOf(meta))
	}
	sort.Slice(tasks, func(i, j int) bool { return tasks[i].StartedMs < tasks[j].StartedMs })
	return map[string]any{"tasks": tasks}, nil
}

type procReadParams struct {
	ID     string `json:"id"`
	Offset int64  `json:"offset"`
	// WaitMs > 0 turns the call into a long poll: it returns as soon as there is
	// new output or the task stops being live, instead of making the client spin.
	WaitMs   int `json:"waitMs"`
	MaxBytes int `json:"maxBytes"`
}

func (s *Server) procRead(p procReadParams) (any, *protocol.Error) {
	dir, perr := s.taskDir(p.ID)
	if perr != nil {
		return nil, perr
	}
	meta, err := readMeta(dir)
	if err != nil {
		return nil, mapFsError(err)
	}
	maxBytes := p.MaxBytes
	if maxBytes <= 0 || maxBytes > 1<<20 {
		maxBytes = 1 << 20
	}
	deadline := time.Now().Add(time.Duration(min(p.WaitMs, 30_000)) * time.Millisecond)
	for {
		chunk, err := readLogChunk(filepath.Join(dir, "output.log"), p.Offset, maxBytes)
		if err != nil {
			return nil, mapFsError(err)
		}
		status := s.statusOf(meta)
		if len(chunk) > 0 || status.State != stateLive || !time.Now().Before(deadline) {
			return map[string]any{
				"data":       string(chunk),
				"nextOffset": p.Offset + int64(len(chunk)),
				"status":     status,
			}, nil
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func readLogChunk(path string, offset int64, maxBytes int) ([]byte, error) {
	file, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return nil, err
	}
	return io.ReadAll(io.LimitReader(file, int64(maxBytes)))
}

// procKill stops the whole tree: TERM first so a dev server can release its
// port, then KILL for whatever ignored it.
func (s *Server) procKill(p taskIDParams) (any, *protocol.Error) {
	dir, perr := s.taskDir(p.ID)
	if perr != nil {
		return nil, perr
	}
	meta, err := readMeta(dir)
	if err != nil {
		return nil, mapFsError(err)
	}
	if processGroupAlive(meta.Pid) {
		_ = syscall.Kill(-meta.Pid, syscall.SIGTERM)
		for i := 0; i < 20 && processGroupAlive(meta.Pid); i++ {
			time.Sleep(100 * time.Millisecond)
		}
		if processGroupAlive(meta.Pid) {
			_ = syscall.Kill(-meta.Pid, syscall.SIGKILL)
		}
	}
	return s.statusOf(meta), nil
}

// procRemove forgets a finished task. A live one must be killed first, so a
// client cannot orphan a process it can no longer name.
func (s *Server) procRemove(p taskIDParams) (any, *protocol.Error) {
	dir, perr := s.taskDir(p.ID)
	if perr != nil {
		return nil, perr
	}
	meta, err := readMeta(dir)
	if err != nil {
		return nil, mapFsError(err)
	}
	if s.statusOf(meta).State == stateLive {
		return nil, protocol.Errorf(protocol.CodeConflict, "task is still running; kill it first")
	}
	if err := os.RemoveAll(dir); err != nil {
		return nil, mapFsError(err)
	}
	return map[string]any{}, nil
}
