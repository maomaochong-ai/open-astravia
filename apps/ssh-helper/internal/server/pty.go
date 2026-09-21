package server

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/creack/pty"

	"vetta-ssh-helper/internal/protocol"
)

// Interactive terminals are deliberately NOT modelled like proc.*.
//
// proc.* is "no daemon, all state on disk": it setsid's away from the SSH
// session, writes output to a log file, and any later helper process can take
// over supervising it. That is right for background tasks, and wrong for a
// terminal:
//
//   - a terminal is an interactive stream. Writing it to a log would persist
//     every \r, cursor move and full-screen redraw — minutes of htop is
//     hundreds of megabytes — and replaying that is still not interacting.
//   - the desktop side deliberately does not keep terminal processes alive
//     across sessions, so there is nothing to take over.
//
// So a pty lives exactly as long as the channel that opened it: when the helper
// exits, the master closes, the child gets SIGHUP and the session is gone. A
// reconnected helper reports no sessions, and the client says so instead of
// pretending the old terminal is still there.

// The read loop must never block: notifications go through the server's shared
// writeMu, so one `yes` would otherwise wedge every fs.* reply behind it. The
// outbox is therefore bounded (32 x 32KiB ~= 1MiB per terminal) and the oldest
// chunk is dropped when it is full, with the dropped byte count riding along on
// the next notification so the client can say output was skipped.
const (
	ptyReadChunk   = 32 << 10
	ptyOutboxDepth = 32
)

type ptySession struct {
	id      string
	master  *os.File
	cmd     *exec.Cmd
	outbox  chan []byte
	dropped atomic.Int64
	closing atomic.Bool
	once    sync.Once
}

type ptyManager struct {
	mu       sync.Mutex
	sessions map[string]*ptySession
	send     func(message any)
	nextID   atomic.Uint64
}

func newPtyManager(send func(message any)) *ptyManager {
	return &ptyManager{sessions: map[string]*ptySession{}, send: send}
}

type ptyOpenParams struct {
	Cwd   string            `json:"cwd"`
	Shell string            `json:"shell,omitempty"`
	Env   map[string]string `json:"env,omitempty"`
	Cols  uint16            `json:"cols"`
	Rows  uint16            `json:"rows"`
	Term  string            `json:"term,omitempty"`
}

type ptyWriteParams struct {
	ID      string `json:"id"`
	DataB64 string `json:"dataB64"`
}

type ptyResizeParams struct {
	ID   string `json:"id"`
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

type ptyIDParams struct {
	ID string `json:"id"`
}

func (m *ptyManager) open(params ptyOpenParams) (any, *protocol.Error) {
	if params.Cwd == "" {
		return nil, protocol.Errorf(protocol.CodeInvalid, "cwd is required")
	}
	// cwd 不存在时报错而不是退到 $HOME：那会让用户以为自己在操作项目目录。
	info, err := os.Stat(params.Cwd)
	if err != nil {
		return nil, protocol.Errorf(protocol.CodeNotFound, "cwd not found: "+params.Cwd)
	}
	if !info.IsDir() {
		return nil, protocol.Errorf(protocol.CodeInvalid, "cwd is not a directory: "+params.Cwd)
	}

	shell := params.Shell
	if shell == "" {
		shell = os.Getenv("SHELL")
	}
	if shell == "" {
		shell = "/bin/sh"
	}

	// 登录 shell：只有这样才能拿到用户 profile 注入的 PATH，与 proc.* 的包装脚本一致。
	cmd := exec.Command(shell, "-l")
	cmd.Dir = params.Cwd
	cmd.Env = ptyEnvironment(params.Env, params.Term)

	size := &pty.Winsize{Cols: clampDimension(params.Cols, 80), Rows: clampDimension(params.Rows, 24)}
	master, err := pty.StartWithSize(cmd, size)
	if err != nil {
		return nil, protocol.Errorf(protocol.CodeInternal, "cannot start pty: "+err.Error())
	}

	session := &ptySession{
		id:     fmt.Sprintf("pty-%d", m.nextID.Add(1)),
		master: master,
		cmd:    cmd,
		outbox: make(chan []byte, ptyOutboxDepth),
	}
	m.mu.Lock()
	m.sessions[session.id] = session
	m.mu.Unlock()

	go m.pump(session)
	go m.read(session)

	return map[string]any{"id": session.id}, nil
}

func clampDimension(value uint16, fallback uint16) uint16 {
	if value == 0 {
		return fallback
	}
	if value > 1000 {
		return 1000
	}
	return value
}

func ptyEnvironment(overrides map[string]string, term string) []string {
	env := map[string]string{}
	for _, entry := range os.Environ() {
		if key, value, found := strings.Cut(entry, "="); found {
			env[key] = value
		}
	}
	if term == "" {
		term = "xterm-256color"
	}
	// 声明真终端与真彩色，否则 ls 不上色、TUI 走降级渲染。
	env["TERM"] = term
	env["COLORTERM"] = "truecolor"
	maps.Copy(env, overrides)
	result := make([]string, 0, len(env))
	for key, value := range env {
		result = append(result, key+"="+value)
	}
	return result
}

// enqueue never blocks: a full outbox means dropping the oldest chunk.
func (session *ptySession) enqueue(chunk []byte) {
	for {
		select {
		case session.outbox <- chunk:
			return
		default:
		}
		select {
		case old := <-session.outbox:
			session.dropped.Add(int64(len(old)))
		default:
			// 明明取不出也放不进：pump 已经走了，这块直接算丢弃。
			session.dropped.Add(int64(len(chunk)))
			return
		}
	}
}

// read is the only sender on the outbox, which is what makes the close in
// finish safe: it runs after this loop has returned.
func (m *ptyManager) read(session *ptySession) {
	buffer := make([]byte, ptyReadChunk)
	for {
		n, err := session.master.Read(buffer)
		if n > 0 {
			session.enqueue(append([]byte(nil), buffer[:n]...))
		}
		if err != nil {
			// 主端关闭（EIO / EOF）就是这个终端的结束。
			if !errors.Is(err, io.EOF) && !session.closing.Load() {
				m.send(protocol.Notification{
					Method: "pty.error",
					Params: map[string]any{"id": session.id, "message": err.Error()},
				})
			}
			m.finish(session)
			return
		}
	}
}

func (m *ptyManager) pump(session *ptySession) {
	for chunk := range session.outbox {
		params := map[string]any{"id": session.id, "dataB64": base64.StdEncoding.EncodeToString(chunk)}
		if dropped := session.dropped.Swap(0); dropped > 0 {
			params["dropped"] = dropped
		}
		m.send(protocol.Notification{Method: "pty.data", Params: params})
	}
}

func (m *ptyManager) finish(session *ptySession) {
	session.once.Do(func() {
		m.mu.Lock()
		delete(m.sessions, session.id)
		m.mu.Unlock()
		close(session.outbox)
		exitCode := 0
		if err := session.cmd.Wait(); err != nil {
			var exitError *exec.ExitError
			if errors.As(err, &exitError) {
				exitCode = exitError.ExitCode()
			} else {
				exitCode = -1
			}
		}
		_ = session.master.Close()
		m.send(protocol.Notification{
			Method: "pty.exit",
			Params: map[string]any{"id": session.id, "exitCode": exitCode},
		})
	})
}

func (m *ptyManager) lookup(id string) (*ptySession, *protocol.Error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, ok := m.sessions[id]
	if !ok {
		return nil, protocol.Errorf(protocol.CodeNotFound, "unknown pty: "+id)
	}
	return session, nil
}

func (m *ptyManager) write(params ptyWriteParams) (any, *protocol.Error) {
	session, err := m.lookup(params.ID)
	if err != nil {
		return nil, err
	}
	data, decodeErr := base64.StdEncoding.DecodeString(params.DataB64)
	if decodeErr != nil {
		return nil, protocol.Errorf(protocol.CodeInvalid, "dataB64 is not base64")
	}
	if _, writeErr := session.master.Write(data); writeErr != nil {
		return nil, protocol.Errorf(protocol.CodeInternal, "cannot write to pty: "+writeErr.Error())
	}
	return map[string]any{}, nil
}

func (m *ptyManager) resize(params ptyResizeParams) (any, *protocol.Error) {
	session, err := m.lookup(params.ID)
	if err != nil {
		return nil, err
	}
	size := &pty.Winsize{Cols: clampDimension(params.Cols, 80), Rows: clampDimension(params.Rows, 24)}
	if setErr := pty.Setsize(session.master, size); setErr != nil {
		return nil, protocol.Errorf(protocol.CodeInternal, "cannot resize pty: "+setErr.Error())
	}
	return map[string]any{}, nil
}

func (m *ptyManager) close(params ptyIDParams) (any, *protocol.Error) {
	session, err := m.lookup(params.ID)
	if err != nil {
		return nil, err
	}
	m.terminate(session)
	return map[string]any{}, nil
}

func (m *ptyManager) list(_ struct{}) (any, *protocol.Error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	sessions := make([]map[string]any, 0, len(m.sessions))
	for id, session := range m.sessions {
		sessions = append(sessions, map[string]any{"id": id, "pid": session.cmd.Process.Pid})
	}
	return map[string]any{"sessions": sessions}, nil
}

func (m *ptyManager) terminate(session *ptySession) {
	session.closing.Store(true)
	// 关主端会让子进程收到 SIGHUP；read 循环随之拿到 EIO 并走 finish。
	_ = session.master.Close()
}

// closeAll runs when the channel goes away, so the remote host is not left with
// orphan login shells.
func (m *ptyManager) closeAll() {
	m.mu.Lock()
	sessions := make([]*ptySession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.mu.Unlock()
	for _, session := range sessions {
		m.terminate(session)
		if session.cmd.Process != nil {
			_ = session.cmd.Process.Kill()
		}
	}
}
