package mock

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"vetta-im-gateway/internal/transport"
)

type captureHandler struct {
	mu   sync.Mutex
	msgs []transport.InboundMessage
}

func (h *captureHandler) HandleInbound(_ context.Context, msg transport.InboundMessage) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.msgs = append(h.msgs, msg)
	return nil
}

func (h *captureHandler) drain() []transport.InboundMessage {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]transport.InboundMessage, len(h.msgs))
	copy(out, h.msgs)
	return out
}

func TestMock_Start_DispatchesInbound(t *testing.T) {
	in := strings.NewReader(
		`{"chatId":"c1","userId":"u1","messageId":"m1","text":"hello"}` + "\n" +
			`{"chatId":"c2","userId":"u2","text":"yo"}` + "\n",
	)
	out := &bytes.Buffer{}
	tr := New(Options{In: io.NopCloser(in), Out: out})
	h := &captureHandler{}

	if err := tr.Start(context.Background(), h); err != nil {
		t.Fatalf("Start: %v", err)
	}

	got := h.drain()
	if len(got) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(got))
	}
	if got[0].Text != "hello" || got[0].UserID != "u1" || got[0].ChatID != "c1" || got[0].MessageID != "m1" {
		t.Errorf("first message wrong: %+v", got[0])
	}
	// Second message had no MessageID — mock should generate one
	if got[1].MessageID == "" || !strings.HasPrefix(got[1].MessageID, "in-") {
		t.Errorf("expected synthesized message id, got %q", got[1].MessageID)
	}
	if got[1].Platform != "mock" {
		t.Errorf("Platform should be 'mock', got %q", got[1].Platform)
	}
}

func TestMock_Start_SkipsMalformed(t *testing.T) {
	in := strings.NewReader(
		"not json\n" +
			`{"chatId":"c1","userId":"u1","text":"keeps going"}` + "\n",
	)
	out := &bytes.Buffer{}
	tr := New(Options{In: io.NopCloser(in), Out: out})
	h := &captureHandler{}

	_ = tr.Start(context.Background(), h)
	got := h.drain()
	if len(got) != 1 {
		t.Errorf("expected to skip malformed line, got %d messages", len(got))
	}
	if !strings.Contains(out.String(), "malformed inbound") {
		t.Errorf("expected stderr-style error in out, got: %s", out.String())
	}
}

func TestMock_Start_RequiresFields(t *testing.T) {
	in := strings.NewReader(`{"chatId":"c1","text":"missing user"}` + "\n")
	out := &bytes.Buffer{}
	tr := New(Options{In: io.NopCloser(in), Out: out})
	h := &captureHandler{}
	_ = tr.Start(context.Background(), h)
	if len(h.drain()) != 0 {
		t.Error("incomplete message should be rejected")
	}
}

func TestMock_SendMessage_AssignsID(t *testing.T) {
	out := &bytes.Buffer{}
	tr := New(Options{In: io.NopCloser(strings.NewReader("")), Out: out})

	id1, err := tr.SendMessage(context.Background(), "c1", transport.OutboundMessage{Text: "first"})
	if err != nil {
		t.Fatal(err)
	}
	id2, err := tr.SendMessage(context.Background(), "c1", transport.OutboundMessage{Text: "second"})
	if err != nil {
		t.Fatal(err)
	}
	if id1 == id2 {
		t.Error("each send should get a unique id")
	}
	if !strings.HasPrefix(id1, "out-") || !strings.HasPrefix(id2, "out-") {
		t.Errorf("synthesized ids should be prefixed: %q %q", id1, id2)
	}

	// Check the lines on stdout
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 outbound lines, got %d:\n%s", len(lines), out.String())
	}
	var first map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &first); err != nil {
		t.Fatal(err)
	}
	if first["action"] != "send" || first["text"] != "first" {
		t.Errorf("first send wrong: %+v", first)
	}
}

func TestMock_EditMessage_NotSupported(t *testing.T) {
	tr := New(Options{In: io.NopCloser(strings.NewReader("")), Out: &bytes.Buffer{}})
	err := tr.EditMessage(context.Background(), "c1", "m1", transport.OutboundMessage{Text: "x"})
	if err == nil {
		t.Error("EditMessage should error since SupportsMessageEdit=false")
	}
}

func TestMock_Capabilities_Conservative(t *testing.T) {
	tr := New(Options{In: io.NopCloser(strings.NewReader("")), Out: &bytes.Buffer{}})
	caps := tr.Capabilities()
	if caps.SupportsMessageEdit {
		t.Error("mock SupportsMessageEdit should be false (it's the whole point)")
	}
	if caps.MaxMessageLength != 1000 {
		t.Errorf("MaxMessageLength: %d", caps.MaxMessageLength)
	}
}

func TestMock_Stop_UnblocksStart(t *testing.T) {
	// Pipe that never closes from the writer side simulates a real stdin
	// that never reaches EOF. Stop must interrupt the blocked read itself.
	r, w := io.Pipe()
	defer w.Close()

	tr := New(Options{In: r, Out: &bytes.Buffer{}})
	done := make(chan error, 1)
	go func() {
		done <- tr.Start(context.Background(), &captureHandler{})
	}()

	if err := tr.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if err := tr.Stop(); err != nil {
		t.Fatalf("second Stop: %v", err)
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Start after Stop: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Start did not return after Stop")
	}
}

func TestMock_ContextCancellationUnblocksStart(t *testing.T) {
	r, w := io.Pipe()
	defer w.Close()

	tr := New(Options{In: r, Out: &bytes.Buffer{}})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- tr.Start(ctx, &captureHandler{})
	}()

	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Start after context cancellation: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Start did not return after context cancellation")
	}
}
