// Package mock implements transport.Transport over stdin/stdout JSON lines.
//
// Used for local development and as the second concrete transport
// (alongside feishu) so the abstraction in internal/transport is exercised
// by more than one implementation. The capabilities are deliberately
// conservative — message edit OFF, attachments OFF, max length 1000 — so
// the bridge's fallback paths are exercised in tests.
//
// Wire format (one JSON object per line):
//
//	inbound  {"chatId":"c1","userId":"u1","messageId":"m1","text":"hello"}
//	outbound {"action":"send","chatId":"c1","messageId":"m99","text":"hi back"}
//	         {"action":"edit","chatId":"c1","messageId":"m99","text":"hi back!"}
//	         {"action":"delete","chatId":"c1","messageId":"m99"}
//	         {"action":"typing","chatId":"c1"}
//
// Inbound is read from os.Stdin (or an injected io.Reader for tests).
// Outbound is written to os.Stdout (or an injected io.Writer). The mock
// generates message IDs for outbound messages because real IMs do — the
// bridge needs the ID back so it can edit later.
package mock

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"vetta-im-gateway/internal/transport"
)

// Transport is the mock implementation. Construct via New; the zero value
// is not usable.
type Transport struct {
	in  io.ReadCloser
	out io.Writer

	mu           sync.Mutex
	nextMsg      uint64
	closed       atomic.Bool
	stopCh       chan struct{}
	stopOnce     sync.Once
	stopInputErr error
}

// Options for New. All fields optional; defaults are os.Stdin / os.Stdout.
// Transport owns In and closes it when stopped or when Start's context is cancelled.
type Options struct {
	In  io.ReadCloser
	Out io.Writer
}

// New constructs a mock transport.
func New(opts Options) *Transport {
	t := &Transport{
		in:     opts.In,
		out:    opts.Out,
		stopCh: make(chan struct{}),
	}
	if t.in == nil {
		t.in = os.Stdin
	}
	if t.out == nil {
		t.out = os.Stdout
	}
	return t
}

// Compile-time interface check.
var _ transport.Transport = (*Transport)(nil)

func (t *Transport) Name() string { return "mock" }

func (t *Transport) Capabilities() transport.Capabilities {
	return transport.Capabilities{
		// Deliberately conservative so the bridge falls back to "send a
		// new message per chunk" instead of edit-in-place. This is the
		// path that telegram and most other simple platforms also take.
		SupportsMessageEdit: false,
		SupportsCards:       false,
		SupportsButtons:     false,
		SupportsFileUpload:  false,
		SupportsThreads:     false,
		MaxMessageLength:    1000,
	}
}

// Start begins reading inbound messages from t.in and dispatches each one
// to handler. Blocks until t.in is closed or Stop is called.
func (t *Transport) Start(ctx context.Context, handler transport.MessageHandler) error {
	stopContextWatch := context.AfterFunc(ctx, func() {
		_ = t.Stop()
	})
	defer stopContextWatch()

	scanner := bufio.NewScanner(t.in)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	for scanner.Scan() {
		select {
		case <-t.stopCh:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var raw struct {
			ChatID    string `json:"chatId"`
			UserID    string `json:"userId"`
			MessageID string `json:"messageId"`
			ReplyToID string `json:"replyToId,omitempty"`
			Text      string `json:"text"`
		}
		if err := json.Unmarshal(line, &raw); err != nil {
			t.writeError(fmt.Sprintf("malformed inbound: %v", err))
			continue
		}
		if raw.ChatID == "" || raw.UserID == "" || raw.Text == "" {
			t.writeError("inbound missing required fields (chatId, userId, text)")
			continue
		}
		if raw.MessageID == "" {
			raw.MessageID = "in-" + strconv.FormatUint(atomic.AddUint64(&t.nextMsg, 1), 10)
		}

		msg := transport.InboundMessage{
			Platform:   "mock",
			ChatID:     raw.ChatID,
			UserID:     raw.UserID,
			MessageID:  raw.MessageID,
			ReplyToID:  raw.ReplyToID,
			Text:       raw.Text,
			ReceivedAt: time.Now(),
		}
		if err := handler.HandleInbound(ctx, msg); err != nil {
			t.writeError(fmt.Sprintf("handler: %v", err))
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if t.closed.Load() {
		return nil
	}
	return scanner.Err()
}

// Stop signals Start to return. Safe to call multiple times.
func (t *Transport) Stop() error {
	t.stopOnce.Do(func() {
		t.closed.Store(true)
		close(t.stopCh)
		t.stopInputErr = t.in.Close()
	})
	return t.stopInputErr
}

// SendMessage emits a {"action":"send"} line and synthesizes a message ID
// the caller can use for later edits.
func (t *Transport) SendMessage(_ context.Context, chatID string, msg transport.OutboundMessage) (string, error) {
	id := "out-" + strconv.FormatUint(atomic.AddUint64(&t.nextMsg, 1), 10)
	if err := t.writeJSON(map[string]any{
		"action":    "send",
		"chatId":    chatID,
		"messageId": id,
		"text":      msg.Text,
	}); err != nil {
		return "", err
	}
	return id, nil
}

// EditMessage is intentionally a no-op error: the mock declares
// SupportsMessageEdit=false. The bridge SHOULD never call this; if it does,
// returning an error helps tests catch the bug.
func (t *Transport) EditMessage(_ context.Context, _, _ string, _ transport.OutboundMessage) error {
	return errors.New("mock transport does not support message edit")
}

// EndStream is a no-op for the mock transport since it has no dedicated
// streaming path.
func (t *Transport) EndStream(_ context.Context, _, _ string) error { return nil }

func (t *Transport) DeleteMessage(_ context.Context, chatID, messageID string) error {
	return t.writeJSON(map[string]any{
		"action":    "delete",
		"chatId":    chatID,
		"messageId": messageID,
	})
}

func (t *Transport) ShowTyping(_ context.Context, chatID string) error {
	return t.writeJSON(map[string]any{
		"action": "typing",
		"chatId": chatID,
	})
}

// SendAttachment is not supported on the mock transport. The mock keeps its
// surface minimal so tests stay deterministic — adding fake CDN handshakes
// would obscure what the tests actually exercise.
func (t *Transport) SendAttachment(_ context.Context, _ string, _ transport.OutboundAttachment) (string, error) {
	return "", errors.New("mock: attachment send not supported")
}

func (t *Transport) writeJSON(v any) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	enc := json.NewEncoder(t.out)
	return enc.Encode(v)
}

func (t *Transport) writeError(msg string) {
	_ = t.writeJSON(map[string]any{
		"action": "error",
		"text":   msg,
	})
}
