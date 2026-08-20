package signalcli

// Test doubles and helpers shared by the signal transport tests: an httptest
// fake of the signal-cli daemon (JSON-RPC recorder + SSE event feed) plus
// transport start/teardown plumbing.

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"vetta-im-gateway/internal/transport"
)

type rpcCallRecord struct {
	Method string
	Params map[string]any
}

type fakeDaemon struct {
	srv *httptest.Server

	mu    sync.Mutex
	calls []rpcCallRecord

	// events is drained by the /api/v1/events handler; each string is a raw
	// SSE chunk written verbatim then flushed.
	events chan string

	// connCount increments on every /api/v1/events connection; the current
	// count is sent to connCh (buffered) for reconnect synchronisation.
	connCount atomic.Int32
	connCh    chan int

	// dropFirstConn makes the first events connection close immediately
	// after the response headers, to exercise the reconnect path.
	dropFirstConn bool
}

func newFakeDaemon(t *testing.T) *fakeDaemon {
	t.Helper()
	d := &fakeDaemon{
		events: make(chan string, 16),
		connCh: make(chan int, 16),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/rpc", d.handleRPC)
	mux.HandleFunc("/api/v1/events", d.handleEvents)
	d.srv = httptest.NewServer(mux)
	t.Cleanup(d.srv.Close)
	return d
}

func (d *fakeDaemon) handleRPC(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID     any            `json:"id"`
		Method string         `json:"method"`
		Params map[string]any `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	d.mu.Lock()
	d.calls = append(d.calls, rpcCallRecord{Method: req.Method, Params: req.Params})
	d.mu.Unlock()

	var result any = map[string]any{}
	if req.Method == "send" {
		result = map[string]any{"timestamp": int64(1723456789012)}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"jsonrpc": "2.0",
		"id":      req.ID,
		"result":  result,
	})
}

func (d *fakeDaemon) handleEvents(w http.ResponseWriter, r *http.Request) {
	n := int(d.connCount.Add(1))
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "no flusher", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.WriteHeader(http.StatusOK)
	fl.Flush()
	d.connCh <- n
	if d.dropFirstConn && n == 1 {
		return // close the stream right away; the transport must reconnect
	}
	for {
		select {
		case chunk := <-d.events:
			_, _ = io.WriteString(w, chunk)
			fl.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (d *fakeDaemon) lastCall(t *testing.T) rpcCallRecord {
	t.Helper()
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.calls) == 0 {
		t.Fatal("no rpc calls recorded")
	}
	return d.calls[len(d.calls)-1]
}

// sseReceiveFrame wraps an envelope JSON into one SSE data frame carrying
// the JSON-RPC "receive" notification. The JSON is compacted first — an SSE
// data payload must be a single line.
func sseReceiveFrame(envelopeJSON string) string {
	raw := `{"jsonrpc":"2.0","method":"receive","params":{"envelope":` + envelopeJSON + `}}`
	var buf bytes.Buffer
	if err := json.Compact(&buf, []byte(raw)); err != nil {
		panic(err)
	}
	return "data: " + buf.String() + "\n\n"
}

func mustNew(t *testing.T, opts Options) *Transport {
	t.Helper()
	tr, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	return tr
}

// startTransport runs Start in a goroutine, delivering inbound messages to
// the returned channel. Cleanup stops the transport and waits for Start to
// return.
func startTransport(t *testing.T, tr *Transport) <-chan transport.InboundMessage {
	t.Helper()
	inCh := make(chan transport.InboundMessage, 16)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = tr.Start(ctx, transport.MessageHandlerFunc(func(_ context.Context, m transport.InboundMessage) error {
			inCh <- m
			return nil
		}))
	}()
	t.Cleanup(func() {
		_ = tr.Stop()
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("Start did not return after Stop+cancel")
		}
	})
	return inCh
}

func waitInbound(t *testing.T, ch <-chan transport.InboundMessage) transport.InboundMessage {
	t.Helper()
	select {
	case m := <-ch:
		return m
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for inbound message")
		return transport.InboundMessage{}
	}
}

func decodeEnvelope(t *testing.T, raw string) *envelope {
	t.Helper()
	var env envelope
	if err := json.Unmarshal([]byte(raw), &env); err != nil {
		t.Fatal(err)
	}
	return &env
}
