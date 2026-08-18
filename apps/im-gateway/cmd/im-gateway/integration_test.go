package main

import (
	"bytes"
	"context"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"vetta-im-gateway/internal/command"
	"vetta-im-gateway/internal/router"
	"vetta-im-gateway/internal/state"
	"vetta-im-gateway/internal/transport/mock"
)

// TestEndToEnd_MockTransport_HelpCommand wires a mock transport ↔ router ↔
// command set the same way the `start` subcommand does, then pushes one
// inbound message and asserts the reply on the outbound stream. The goal
// is to verify the gateway's wiring (transport ↔ router ↔ command) without
// spawning a real coding-agent — /help doesn't reach the agent path so the
// hostclient pool stays uninvolved.
func TestEndToEnd_MockTransport_HelpCommand(t *testing.T) {
	in := newPipeBuffer()
	out := newPipeBuffer()

	tr := mock.New(mock.Options{In: in, Out: out})

	r := router.New(tr, command.NewRouter(), &noopStore{}, nil, "/home/u/.vetta/conversation")
	defer r.Shutdown()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() { done <- tr.Start(ctx, r) }()

	in.Write([]byte(`{"chatId":"c1","userId":"u1","messageId":"m1","text":"/help"}` + "\n"))

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if out.Contains("/new") && out.Contains("/help") {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	cancel()
	_ = tr.Stop()
	in.Close() // unblock pipeBuffer.Read so the transport's scanner returns
	<-done

	got := out.String()
	for _, want := range []string{"/new", "/whoami", "/help"} {
		if !strings.Contains(got, want) {
			t.Errorf("expected /help reply to mention %s, got:\n%s", want, got)
		}
	}
	for _, gone := range []string{"/projects", "/use"} {
		if strings.Contains(got, gone) {
			t.Errorf("/help should no longer mention removed command %s, got:\n%s", gone, got)
		}
	}
}

// =============================================================================
// pipeBuffer: thread-safe in-memory pipe with blocking Read.
// =============================================================================
//
// io.Pipe would also work but the bufio.Scanner inside the mock transport
// holds a Read indefinitely; using a sleep-poll buffer keeps the test
// deterministic without needing precise goroutine ordering.

type pipeBuffer struct {
	mu      sync.Mutex
	buf     bytes.Buffer
	readPos int
	closed  bool
}

func newPipeBuffer() *pipeBuffer { return &pipeBuffer{} }

func (p *pipeBuffer) Write(b []byte) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.buf.Write(b)
}

func (p *pipeBuffer) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	return nil
}

func (p *pipeBuffer) Read(b []byte) (int, error) {
	for {
		p.mu.Lock()
		if p.readPos < p.buf.Len() {
			data := p.buf.Bytes()[p.readPos:]
			n := copy(b, data)
			p.readPos += n
			p.mu.Unlock()
			return n, nil
		}
		closed := p.closed
		p.mu.Unlock()
		if closed {
			return 0, io.EOF
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (p *pipeBuffer) String() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.buf.String()
}

func (p *pipeBuffer) Contains(s string) bool {
	return strings.Contains(p.String(), s)
}

// =============================================================================
// no-op deps used by the /help path (which doesn't touch store)
// =============================================================================

type noopStore struct{}

func (noopStore) Load(_ context.Context) (state.RouterState, error) {
	return state.RouterState{Sessions: map[string]state.SessionEntry{}}, nil
}
func (noopStore) Save(_ context.Context, _ state.RouterState) error { return nil }
func (noopStore) GetSession(_ context.Context, _, _ string) (state.SessionEntry, bool, error) {
	return state.SessionEntry{}, false, nil
}
func (noopStore) SetSession(_ context.Context, _ state.SessionEntry) error { return nil }
