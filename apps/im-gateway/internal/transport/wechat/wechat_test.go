package wechat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"vetta-im-gateway/internal/transport"
	"vetta-im-gateway/internal/transport/wechat/ilink"
)

// =============================================================================
// fake iLink server (just enough for getupdates + sendmessage)
// =============================================================================

type fakeILink struct {
	t   *testing.T
	mu  sync.Mutex
	srv *httptest.Server

	// queued responses for getupdates. Each call pops the next entry.
	// When empty, the handler holds (returns 200 with empty msgs after a
	// short delay) so the long-poll loop spins lightly.
	updates [][]ilink.WeixinMessage

	// successive cursors handed out
	cursorSeq atomic.Int64

	// captured sendmessage requests
	sent []ilink.SendMessageReq

	// captured sendtyping requests
	typing []ilink.SendTypingReq

	// optional injected error for the next sendmessage
	sendErr error
}

func newFakeILink(t *testing.T) *fakeILink {
	t.Helper()
	f := &fakeILink{t: t}
	mux := http.NewServeMux()
	mux.HandleFunc("/ilink/bot/getupdates", f.handleGetUpdates)
	mux.HandleFunc("/ilink/bot/sendmessage", f.handleSendMessage)
	mux.HandleFunc("/ilink/bot/getconfig", f.handleGetConfig)
	mux.HandleFunc("/ilink/bot/sendtyping", f.handleSendTyping)
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeILink) baseURL() string { return f.srv.URL }

// queueUpdate adds one batch (which will be returned by the next
// getupdates call) to the queue.
func (f *fakeILink) queueUpdate(msgs ...ilink.WeixinMessage) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.updates = append(f.updates, msgs)
}

// sentMessages returns a snapshot of all captured sendmessage requests.
func (f *fakeILink) sentMessages() []ilink.SendMessageReq {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]ilink.SendMessageReq, len(f.sent))
	copy(out, f.sent)
	return out
}

func (f *fakeILink) handleGetUpdates(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	var batch []ilink.WeixinMessage
	if len(f.updates) > 0 {
		batch = f.updates[0]
		f.updates = f.updates[1:]
	}
	f.mu.Unlock()

	if batch == nil {
		// No queued data: hold briefly so the loop doesn't spin hot,
		// then return an empty batch with the same cursor.
		select {
		case <-time.After(50 * time.Millisecond):
		case <-r.Context().Done():
			return
		}
	}

	cursor := "cursor-" + itoa(f.cursorSeq.Add(1))
	resp := ilink.GetUpdatesResp{
		Ret:           0,
		Msgs:          batch,
		GetUpdatesBuf: cursor,
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func (f *fakeILink) handleSendMessage(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.sendErr != nil {
		err := f.sendErr
		f.sendErr = nil
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var req ilink.SendMessageReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	f.sent = append(f.sent, req)
	w.Write([]byte(`{}`))
}

func (f *fakeILink) handleGetConfig(w http.ResponseWriter, _ *http.Request) {
	_ = json.NewEncoder(w).Encode(ilink.GetConfigResp{Ret: 0, TypingTicket: "ticket-xyz"})
}

func (f *fakeILink) handleSendTyping(w http.ResponseWriter, r *http.Request) {
	var req ilink.SendTypingReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	f.mu.Lock()
	f.typing = append(f.typing, req)
	f.mu.Unlock()
	w.Write([]byte(`{}`))
}

// typingRequests returns a snapshot of all captured sendtyping requests.
func (f *fakeILink) typingRequests() []ilink.SendTypingReq {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]ilink.SendTypingReq, len(f.typing))
	copy(out, f.typing)
	return out
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// =============================================================================
// captureHandler
// =============================================================================

type captureHandler struct {
	mu  sync.Mutex
	got []transport.InboundMessage
	ch  chan struct{}
}

func newCaptureHandler() *captureHandler {
	return &captureHandler{ch: make(chan struct{}, 16)}
}

func (h *captureHandler) HandleInbound(_ context.Context, msg transport.InboundMessage) error {
	h.mu.Lock()
	h.got = append(h.got, msg)
	h.mu.Unlock()
	select {
	case h.ch <- struct{}{}:
	default:
	}
	return nil
}

func (h *captureHandler) wait(t *testing.T, n int) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		h.mu.Lock()
		count := len(h.got)
		h.mu.Unlock()
		if count >= n {
			return
		}
		select {
		case <-h.ch:
		case <-deadline:
			t.Fatalf("waited for %d msgs, got %d", n, count)
		}
	}
}

func (h *captureHandler) snapshot() []transport.InboundMessage {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]transport.InboundMessage, len(h.got))
	copy(out, h.got)
	return out
}

// =============================================================================
// helpers
// =============================================================================

// newBoundTransport spawns a fakeILink, primes a state file with creds
// pointing at it, constructs a Transport, and returns the trio.
func newBoundTransport(t *testing.T) (*Transport, *fakeILink, string) {
	t.Helper()
	fake := newFakeILink(t)
	dir := t.TempDir()
	statePath := filepath.Join(dir, "wechat.json")

	// Prime the state file with credentials so New() does not return
	// ErrNotBound.
	store, err := newStateStore(statePath)
	if err != nil {
		t.Fatalf("newStateStore: %v", err)
	}
	if err := store.SetCredentials(ilink.Credentials{
		BotToken:    "tok",
		ILinkBotID:  "bot",
		ILinkUserID: "self",
		BaseURL:     fake.baseURL(),
	}); err != nil {
		t.Fatalf("SetCredentials: %v", err)
	}

	tr, err := New(Options{StatePath: statePath})
	if err != nil {
		t.Fatalf("wechat.New: %v", err)
	}
	t.Cleanup(func() { _ = tr.Stop() })
	return tr, fake, statePath
}

// =============================================================================
// tests
// =============================================================================

func TestTransport_NewWithoutCredentials(t *testing.T) {
	dir := t.TempDir()
	_, err := New(Options{StatePath: filepath.Join(dir, "wechat.json")})
	if !errors.Is(err, ErrNotBound) {
		t.Errorf("err = %v, want ErrNotBound", err)
	}
}

func TestTransport_StartDispatchesInboundAndCapturesContextToken(t *testing.T) {
	tr, fake, _ := newBoundTransport(t)

	fake.queueUpdate(ilink.WeixinMessage{
		FromUserID:   "alice",
		ContextToken: "ctx-alice-1",
		ItemList: []ilink.MessageItem{{
			Type:     ilink.MessageItemTypeText,
			TextItem: &ilink.TextItem{Text: "hi bot"},
		}},
	})

	h := newCaptureHandler()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- tr.Start(ctx, h) }()

	h.wait(t, 1)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Start did not return after cancel")
	}

	got := h.snapshot()
	if len(got) != 1 {
		t.Fatalf("got %d msgs", len(got))
	}
	if got[0].Text != "hi bot" {
		t.Errorf("text = %q", got[0].Text)
	}
	if got[0].UserID != "alice" || got[0].ChatID != "alice" {
		t.Errorf("ids = %q/%q", got[0].UserID, got[0].ChatID)
	}
	if got[0].Platform != "wechat" {
		t.Errorf("platform = %q", got[0].Platform)
	}
	// Context token should have been persisted.
	if tok := tr.store.ContextToken("alice"); tok != "ctx-alice-1" {
		t.Errorf("context_token not stored: %q", tok)
	}
}

func TestTransport_DropsNonTextAndEmptyFromUserID(t *testing.T) {
	tr, fake, _ := newBoundTransport(t)
	// 1. message with no from_user_id (dropped)
	// 2. message with image-only item_list (dropped)
	// 3. valid text message (kept)
	fake.queueUpdate(
		ilink.WeixinMessage{
			ItemList: []ilink.MessageItem{{
				Type:     ilink.MessageItemTypeText,
				TextItem: &ilink.TextItem{Text: "from nobody"},
			}},
		},
		ilink.WeixinMessage{
			FromUserID: "bob",
			ItemList: []ilink.MessageItem{{
				Type:      ilink.MessageItemTypeImage,
				ImageItem: &ilink.ImageItem{},
			}},
		},
		ilink.WeixinMessage{
			FromUserID: "carol",
			ItemList: []ilink.MessageItem{{
				Type:     ilink.MessageItemTypeText,
				TextItem: &ilink.TextItem{Text: "hello"},
			}},
		},
	)

	h := newCaptureHandler()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	go tr.Start(ctx, h) //nolint:errcheck

	h.wait(t, 1)
	got := h.snapshot()
	if len(got) != 1 {
		t.Fatalf("got %d msgs, want 1", len(got))
	}
	if got[0].UserID != "carol" {
		t.Errorf("UserID = %q, want carol", got[0].UserID)
	}
}

func TestTransport_VoiceWithSTTFallback(t *testing.T) {
	tr, fake, _ := newBoundTransport(t)
	fake.queueUpdate(ilink.WeixinMessage{
		FromUserID: "dave",
		ItemList: []ilink.MessageItem{{
			Type:      ilink.MessageItemTypeVoice,
			VoiceItem: &ilink.VoiceItem{Text: "transcribed audio"},
		}},
	})

	h := newCaptureHandler()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	go tr.Start(ctx, h) //nolint:errcheck

	h.wait(t, 1)
	if got := h.snapshot()[0].Text; got != "transcribed audio" {
		t.Errorf("text = %q", got)
	}
}

func TestTransport_QuotedReplyFormatting(t *testing.T) {
	tr, fake, _ := newBoundTransport(t)
	fake.queueUpdate(ilink.WeixinMessage{
		FromUserID: "eve",
		ItemList: []ilink.MessageItem{{
			Type:     ilink.MessageItemTypeText,
			TextItem: &ilink.TextItem{Text: "agreed"},
			RefMsg: &ilink.RefMessage{
				Title: "earlier",
				MessageItem: &ilink.MessageItem{
					Type:     ilink.MessageItemTypeText,
					TextItem: &ilink.TextItem{Text: "we should ship"},
				},
			},
		}},
	})

	h := newCaptureHandler()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	go tr.Start(ctx, h) //nolint:errcheck

	h.wait(t, 1)
	got := h.snapshot()[0].Text
	want := "[引用: earlier | we should ship]\nagreed"
	if got != want {
		t.Errorf("text = %q, want %q", got, want)
	}
}

func TestTransport_SendMessageUsesContextTokenAndIncrementsQuota(t *testing.T) {
	tr, fake, _ := newBoundTransport(t)

	// Drive an inbound first so we capture a context_token.
	fake.queueUpdate(ilink.WeixinMessage{
		FromUserID:   "frank",
		ContextToken: "ctx-frank",
		ItemList: []ilink.MessageItem{{
			Type:     ilink.MessageItemTypeText,
			TextItem: &ilink.TextItem{Text: "ping"},
		}},
	})

	h := newCaptureHandler()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	go tr.Start(ctx, h) //nolint:errcheck

	h.wait(t, 1)

	id, err := tr.SendMessage(ctx, "frank", transport.OutboundMessage{Text: "pong"})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if id == "" {
		t.Error("empty messageID")
	}

	sent := fake.sentMessages()
	if len(sent) != 1 {
		t.Fatalf("sent %d, want 1", len(sent))
	}
	if got := sent[0].Msg.ContextToken; got != "ctx-frank" {
		t.Errorf("ContextToken = %q, want ctx-frank", got)
	}
	if got := sent[0].Msg.ToUserID; got != "frank" {
		t.Errorf("ToUserID = %q", got)
	}
	if got := sent[0].Msg.ItemList[0].TextItem.Text; got != "pong" {
		t.Errorf("text = %q", got)
	}
	// Quota should have decremented from 10 → 9. Inbound resets to 10
	// before the send, so we expect 9 remaining.
	if got := tr.quota.Remaining("frank"); got != 9 {
		t.Errorf("Remaining = %d, want 9", got)
	}
}

func TestTransport_SendMessageQuotaExhausted(t *testing.T) {
	tr, _, _ := newBoundTransport(t)
	// Force the quota to zero for this peer by recording 10 sends.
	for range 10 {
		tr.quota.RecordSend("peer")
	}
	_, err := tr.SendMessage(context.Background(), "peer", transport.OutboundMessage{Text: "hi"})
	if !errors.Is(err, ErrQuotaExhausted) {
		t.Errorf("err = %v, want ErrQuotaExhausted", err)
	}
}

func TestTransport_SendMessageEmptyText(t *testing.T) {
	tr, _, _ := newBoundTransport(t)
	_, err := tr.SendMessage(context.Background(), "peer", transport.OutboundMessage{})
	if err == nil {
		t.Error("expected error for empty text")
	}
}

func TestTransport_SendMessageBlocksFallback(t *testing.T) {
	tr, fake, _ := newBoundTransport(t)
	id, err := tr.SendMessage(context.Background(), "peer", transport.OutboundMessage{
		Blocks: []transport.Block{
			{Type: transport.BlockTypeText, Text: "line 1"},
			{Type: transport.BlockTypeText, Text: "line 2"},
		},
	})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if id == "" {
		t.Error("empty id")
	}
	sent := fake.sentMessages()
	if len(sent) != 1 {
		t.Fatalf("sent = %d", len(sent))
	}
	got := sent[0].Msg.ItemList[0].TextItem.Text
	want := "line 1\nline 2"
	if got != want {
		t.Errorf("text = %q, want %q", got, want)
	}
}

func TestTransport_EditAndDeleteAreErrors(t *testing.T) {
	tr, _, _ := newBoundTransport(t)
	if err := tr.EditMessage(context.Background(), "c", "m", transport.OutboundMessage{}); err == nil {
		t.Error("EditMessage should error")
	}
	if err := tr.DeleteMessage(context.Background(), "c", "m"); err == nil {
		t.Error("DeleteMessage should error")
	}
	if err := tr.EndStream(context.Background(), "c", "m"); err != nil {
		t.Errorf("EndStream should be no-op, got %v", err)
	}
}

func TestTransport_ShowTypingSendsIndicator(t *testing.T) {
	tr, fake, _ := newBoundTransport(t)
	if err := tr.ShowTyping(context.Background(), "peer1"); err != nil {
		t.Fatalf("ShowTyping: %v", err)
	}
	got := fake.typingRequests()
	if len(got) != 1 {
		t.Fatalf("expected 1 sendtyping, got %d", len(got))
	}
	if got[0].ILinkUserID != "peer1" {
		t.Errorf("peer = %q, want peer1", got[0].ILinkUserID)
	}
	if got[0].Status != 1 {
		t.Errorf("status = %d, want 1 (typing)", got[0].Status)
	}
	if got[0].TypingTicket != "ticket-xyz" {
		t.Errorf("ticket = %q, want ticket-xyz (from getconfig)", got[0].TypingTicket)
	}
}

func TestTransport_StopReturnsContextCancelled(t *testing.T) {
	tr, _, _ := newBoundTransport(t)
	h := newCaptureHandler()
	ctx := context.Background()
	done := make(chan error, 1)
	go func() { done <- tr.Start(ctx, h) }()

	time.Sleep(100 * time.Millisecond)
	_ = tr.Stop()

	select {
	case err := <-done:
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Errorf("Start returned %v, want context.Canceled or nil", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Start did not exit after Stop")
	}
}

func TestTransport_CursorPersisted(t *testing.T) {
	tr, fake, statePath := newBoundTransport(t)

	fake.queueUpdate(ilink.WeixinMessage{
		FromUserID: "g",
		ItemList: []ilink.MessageItem{{
			Type:     ilink.MessageItemTypeText,
			TextItem: &ilink.TextItem{Text: "x"},
		}},
	})

	h := newCaptureHandler()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	go tr.Start(ctx, h) //nolint:errcheck
	h.wait(t, 1)

	// Wait one more loop iter so the post-dispatch cursor save lands.
	time.Sleep(150 * time.Millisecond)
	cancel()

	// Reopen and confirm the cursor was persisted.
	store, err := newStateStore(statePath)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if got := store.Cursor(); got == "" {
		t.Errorf("cursor not persisted")
	}
}

// Compile-time check that we satisfy transport.Transport. (Already in
// wechat.go but doubling here makes test failures clearer.)
var _ transport.Transport = (*Transport)(nil)
