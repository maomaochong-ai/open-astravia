package signalcli

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"vetta-im-gateway/internal/transport"
)

// =============================================================================
// construction + capabilities
// =============================================================================

func TestNew_Validation(t *testing.T) {
	if _, err := New(Options{}); err == nil {
		t.Error("expected error for missing Endpoint")
	}
	if _, err := New(Options{Endpoint: "http://127.0.0.1:8080"}); err == nil {
		t.Error("expected error for missing Account")
	}
	tr, err := New(Options{Endpoint: "http://127.0.0.1:8080/", Account: "+8613800000000"})
	if err != nil {
		t.Fatal(err)
	}
	if tr.opts.Endpoint != "http://127.0.0.1:8080" {
		t.Errorf("endpoint should be trimmed of trailing slash: %q", tr.opts.Endpoint)
	}
}

func TestCapabilities(t *testing.T) {
	tr := mustNew(t, Options{Endpoint: "http://127.0.0.1:8080", Account: "+86"})
	caps := tr.Capabilities()
	if caps.SupportsMessageEdit || caps.SupportsCards || caps.SupportsButtons {
		t.Errorf("edit/cards/buttons must be false: %+v", caps)
	}
	if !caps.SupportsFileUpload || !caps.SupportsThreads || !caps.SupportsReactions {
		t.Errorf("file-upload/threads/reactions must be true: %+v", caps)
	}
	if caps.MaxMessageLength != 0 {
		t.Errorf("MaxMessageLength should be 0 (unlimited), got %d", caps.MaxMessageLength)
	}
}

func TestEditMessage_Unsupported(t *testing.T) {
	tr := mustNew(t, Options{Endpoint: "http://127.0.0.1:8080", Account: "+86"})
	if err := tr.EditMessage(context.Background(), "+861", "1", transport.OutboundMessage{Text: "x"}); err == nil {
		t.Error("EditMessage should return an error")
	}
	if err := tr.EndStream(context.Background(), "+861", "1"); err != nil {
		t.Errorf("EndStream should be a no-op, got %v", err)
	}
}

// =============================================================================
// pure wire parsing / normalization
// =============================================================================

func TestParseEventFrame_NonReceiveIgnored(t *testing.T) {
	env, err := parseEventFrame([]byte(`{"jsonrpc":"2.0","method":"somethingElse","params":{}}`))
	if err != nil || env != nil {
		t.Errorf("non-receive frame should yield (nil, nil), got %v %v", env, err)
	}
	if _, err := parseEventFrame([]byte("not json")); err == nil {
		t.Error("invalid JSON should error")
	}
}

func TestNormalizeEnvelope_Private(t *testing.T) {
	env := decodeEnvelope(t, `{
		"sourceNumber": "+8613900000001",
		"sourceUuid": "uuid-1",
		"timestamp": 1700000000123,
		"dataMessage": {"message": "hello", "timestamp": 1700000000123}
	}`)
	msg, ok := normalizeEnvelope(env)
	if !ok {
		t.Fatal("expected ok")
	}
	if msg.Platform != "signal" {
		t.Errorf("Platform: %q", msg.Platform)
	}
	if msg.ChatID != "+8613900000001" || msg.UserID != "+8613900000001" {
		t.Errorf("chat/user: %q %q", msg.ChatID, msg.UserID)
	}
	if msg.MessageID != "1700000000123" {
		t.Errorf("MessageID: %q", msg.MessageID)
	}
	if msg.Text != "hello" || msg.ReplyToID != "" {
		t.Errorf("text/reply: %q %q", msg.Text, msg.ReplyToID)
	}
}

func TestNormalizeEnvelope_GroupWithQuote(t *testing.T) {
	env := decodeEnvelope(t, `{
		"sourceNumber": "+8613900000002",
		"timestamp": 1700000001000,
		"dataMessage": {
			"message": "reply text",
			"groupInfo": {"groupId": "Z3JvdXAtaWQ="},
			"quote": {"id": 1699999990000, "author": "+8613900000001"}
		}
	}`)
	msg, ok := normalizeEnvelope(env)
	if !ok {
		t.Fatal("expected ok")
	}
	if msg.ChatID != "group:Z3JvdXAtaWQ=" {
		t.Errorf("ChatID: %q", msg.ChatID)
	}
	if msg.UserID != "+8613900000002" {
		t.Errorf("UserID: %q", msg.UserID)
	}
	if msg.ReplyToID != "1699999990000" {
		t.Errorf("ReplyToID: %q", msg.ReplyToID)
	}
}

func TestNormalizeEnvelope_UUIDFallback(t *testing.T) {
	env := decodeEnvelope(t, `{
		"sourceUuid": "uuid-only",
		"timestamp": 1,
		"dataMessage": {"message": "x"}
	}`)
	msg, ok := normalizeEnvelope(env)
	if !ok || msg.UserID != "uuid-only" {
		t.Errorf("expected uuid fallback, got ok=%v msg=%+v", ok, msg)
	}
}

func TestNormalizeEnvelope_IgnoredKinds(t *testing.T) {
	cases := map[string]string{
		"sync":    `{"sourceNumber":"+861","timestamp":1,"syncMessage":{"sentMessage":{"message":"self"}}}`,
		"receipt": `{"sourceNumber":"+861","timestamp":1,"receiptMessage":{"isDelivery":true}}`,
		"typing":  `{"sourceNumber":"+861","timestamp":1,"typingMessage":{"action":"STARTED"}}`,
		"empty":   `{"sourceNumber":"+861","timestamp":1}`,
	}
	for name, raw := range cases {
		if _, ok := normalizeEnvelope(decodeEnvelope(t, raw)); ok {
			t.Errorf("%s envelope should be ignored", name)
		}
	}
}

func TestSenderAllowed(t *testing.T) {
	tr := mustNew(t, Options{
		Endpoint:       "http://127.0.0.1:8080",
		Account:        "+86",
		AllowedNumbers: []string{"+8613900000001"},
	})
	allowed := transport.InboundMessage{ChatID: "+8613900000001", UserID: "+8613900000001"}
	blocked := transport.InboundMessage{ChatID: "+8613900000009", UserID: "+8613900000009"}
	group := transport.InboundMessage{ChatID: "group:abc=", UserID: "+8613900000009"}
	if !tr.senderAllowed(allowed) {
		t.Error("allowlisted sender should pass")
	}
	if tr.senderAllowed(blocked) {
		t.Error("non-allowlisted private sender should be filtered")
	}
	if !tr.senderAllowed(group) {
		t.Error("group messages are not filtered by the allowlist")
	}
}

func TestRenderButtonsFallback(t *testing.T) {
	btn := func(text, value string) transport.Button { return transport.Button{Text: text, Value: value} }
	cases := []struct {
		name string
		text string
		rows [][]transport.Button
		want string
	}{
		{"no buttons", "hello", nil, "hello"},
		{"empty rows", "hello", [][]transport.Button{{}}, "hello"},
		{
			"single row same value",
			"pick one",
			[][]transport.Button{{btn("Yes", "Yes"), btn("No", "No")}},
			"pick one\n\n1. Yes\n2. No",
		},
		{
			"value differs from label",
			"deploy?",
			[][]transport.Button{{btn("Approve", "approve_v2")}},
			"deploy?\n\n1. Approve [approve_v2]",
		},
		{
			"numbering continues across rows",
			"",
			[][]transport.Button{{btn("A", "A")}, {btn("B", "B"), btn("C", "c-val")}},
			"1. A\n2. B\n3. C [c-val]",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := renderButtonsFallback(tc.text, tc.rows); got != tc.want {
				t.Errorf("got %q want %q", got, tc.want)
			}
		})
	}
}

func TestResolveTarget(t *testing.T) {
	rec, gid, err := resolveTarget("+8613900000001")
	if err != nil || gid != "" || len(rec) != 1 || rec[0] != "+8613900000001" {
		t.Errorf("private: rec=%v gid=%q err=%v", rec, gid, err)
	}
	rec, gid, err = resolveTarget("group:Z3JvdXA=")
	if err != nil || gid != "Z3JvdXA=" || rec != nil {
		t.Errorf("group: rec=%v gid=%q err=%v", rec, gid, err)
	}
	if _, _, err := resolveTarget(""); err == nil {
		t.Error("empty chatID should error")
	}
	if _, _, err := resolveTarget("group:"); err == nil {
		t.Error("empty group id should error")
	}
}

// =============================================================================
// SSE inbound end-to-end
// =============================================================================

func TestSSEInbound_NormalizationAndAllowlist(t *testing.T) {
	d := newFakeDaemon(t)
	tr := mustNew(t, Options{
		Endpoint:       d.srv.URL,
		Account:        "+8613800000000",
		AllowedNumbers: []string{"+8613900000001"},
	})
	inCh := startTransport(t, tr)

	// 1) allowlisted private message with a quote.
	d.events <- sseReceiveFrame(`{
		"sourceNumber": "+8613900000001",
		"timestamp": 1700000000123,
		"dataMessage": {
			"message": "hi there",
			"quote": {"id": 1699999990000, "author": "+8613800000000"}
		}
	}`)
	// 2) non-allowlisted private message: must be filtered.
	d.events <- sseReceiveFrame(`{
		"sourceNumber": "+8613900000009",
		"timestamp": 1700000000200,
		"dataMessage": {"message": "spam"}
	}`)
	// 3) group message from a non-allowlisted number: passes (allowlist is
	// private-chat only).
	d.events <- sseReceiveFrame(`{
		"sourceNumber": "+8613900000009",
		"timestamp": 1700000000300,
		"dataMessage": {"message": "group hello", "groupInfo": {"groupId": "Z3JvdXA="}}
	}`)

	m1 := waitInbound(t, inCh)
	if m1.ChatID != "+8613900000001" || m1.MessageID != "1700000000123" {
		t.Errorf("m1: %+v", m1)
	}
	if m1.ReplyToID != "1699999990000" {
		t.Errorf("m1 ReplyToID: %q", m1.ReplyToID)
	}
	if m1.Text != "hi there" {
		t.Errorf("m1 Text: %q", m1.Text)
	}

	m2 := waitInbound(t, inCh)
	if m2.ChatID != "group:Z3JvdXA=" || m2.Text != "group hello" {
		t.Errorf("expected the group message (spam filtered), got %+v", m2)
	}
	if m2.UserID != "+8613900000009" {
		t.Errorf("m2 UserID: %q", m2.UserID)
	}
}

func TestSSEReconnect(t *testing.T) {
	d := newFakeDaemon(t)
	d.dropFirstConn = true
	tr := mustNew(t, Options{Endpoint: d.srv.URL, Account: "+86"})
	tr.backoffInitial = time.Millisecond
	tr.backoffMax = 5 * time.Millisecond
	inCh := startTransport(t, tr)

	waitConn := func(want int) {
		t.Helper()
		for {
			select {
			case n := <-d.connCh:
				if n >= want {
					return
				}
			case <-time.After(5 * time.Second):
				t.Fatalf("timed out waiting for connection #%d", want)
			}
		}
	}
	waitConn(1)
	waitConn(2)

	// The second (surviving) connection must actually deliver events.
	d.events <- sseReceiveFrame(`{
		"sourceNumber": "+8613900000001",
		"timestamp": 42,
		"dataMessage": {"message": "after reconnect"}
	}`)
	m := waitInbound(t, inCh)
	if m.Text != "after reconnect" || m.MessageID != "42" {
		t.Errorf("got %+v", m)
	}
}

// =============================================================================
// inbound attachments
// =============================================================================

func TestCollectAttachments_PersistsFromCache(t *testing.T) {
	attDir := t.TempDir()
	inboxDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(attDir, "att-123"), []byte("png-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	tr := mustNew(t, Options{
		Endpoint:       "http://127.0.0.1:8080",
		Account:        "+86",
		InboxDir:       inboxDir,
		AttachmentsDir: attDir,
	})
	env := decodeEnvelope(t, `{
		"sourceNumber": "+8613900000001",
		"timestamp": 1700000000123,
		"dataMessage": {
			"message": "see pic",
			"attachments": [
				{"contentType": "image/png", "filename": "cat.png", "id": "att-123"},
				{"contentType": "application/pdf", "filename": "gone.pdf", "id": "missing-id"}
			]
		}
	}`)
	atts := tr.collectAttachments(env, "1700000000123")
	if len(atts) != 1 {
		t.Fatalf("expected 1 attachment (missing file skipped), got %d", len(atts))
	}
	a := atts[0]
	if a.Kind != transport.AttachmentImage || a.MimeType != "image/png" {
		t.Errorf("kind/mime: %+v", a)
	}
	b, err := os.ReadFile(a.URL)
	if err != nil || string(b) != "png-bytes" {
		t.Errorf("persisted bytes wrong: %v %q", err, b)
	}
	if !strings.Contains(a.URL, inboxDir) {
		t.Errorf("attachment should live under the inbox: %q", a.URL)
	}
}

func TestCollectAttachments_DisabledWithoutDirs(t *testing.T) {
	tr := mustNew(t, Options{Endpoint: "http://x", Account: "+86", InboxDir: t.TempDir()})
	env := decodeEnvelope(t, `{
		"sourceNumber": "+861",
		"timestamp": 1,
		"dataMessage": {"message": "", "attachments": [{"contentType": "image/png", "id": "a"}]}
	}`)
	if atts := tr.collectAttachments(env, "1"); atts != nil {
		t.Errorf("no AttachmentsDir configured: expected nil, got %v", atts)
	}
}

// =============================================================================
// outbound JSON-RPC bodies
// =============================================================================

func TestSendMessage_Private(t *testing.T) {
	d := newFakeDaemon(t)
	tr := mustNew(t, Options{Endpoint: d.srv.URL, Account: "+8613800000000"})

	id, err := tr.SendMessage(context.Background(), "+8613900000001", transport.OutboundMessage{Text: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	if id != "1723456789012" {
		t.Errorf("message id: %q", id)
	}
	c := d.lastCall(t)
	if c.Method != "send" {
		t.Errorf("method: %q", c.Method)
	}
	rec, _ := c.Params["recipient"].([]any)
	if len(rec) != 1 || rec[0] != "+8613900000001" {
		t.Errorf("recipient: %v", c.Params["recipient"])
	}
	if c.Params["message"] != "hello" {
		t.Errorf("message: %v", c.Params["message"])
	}
	if c.Params["account"] != "+8613800000000" {
		t.Errorf("account: %v", c.Params["account"])
	}
	if _, present := c.Params["groupId"]; present {
		t.Error("groupId must be omitted for private chats")
	}
}

func TestSendMessage_PrivateQuote(t *testing.T) {
	d := newFakeDaemon(t)
	tr := mustNew(t, Options{Endpoint: d.srv.URL, Account: "+86"})

	_, err := tr.SendMessage(context.Background(), "+8613900000001", transport.OutboundMessage{
		Text:      "re",
		ReplyToID: "1700000000123",
	})
	if err != nil {
		t.Fatal(err)
	}
	c := d.lastCall(t)
	if c.Params["quoteTimestamp"] != float64(1700000000123) {
		t.Errorf("quoteTimestamp: %v", c.Params["quoteTimestamp"])
	}
	if c.Params["quoteAuthor"] != "+8613900000001" {
		t.Errorf("quoteAuthor: %v", c.Params["quoteAuthor"])
	}
}

func TestSendMessage_GroupDropsQuote(t *testing.T) {
	// Group ChatIDs carry no author info, so the quote is dropped rather
	// than mis-attributed (best-effort threading).
	d := newFakeDaemon(t)
	tr := mustNew(t, Options{Endpoint: d.srv.URL, Account: "+86"})

	_, err := tr.SendMessage(context.Background(), "group:Z3JvdXA=", transport.OutboundMessage{
		Text:      "group reply",
		ReplyToID: "1700000000123",
	})
	if err != nil {
		t.Fatal(err)
	}
	c := d.lastCall(t)
	if c.Params["groupId"] != "Z3JvdXA=" {
		t.Errorf("groupId: %v", c.Params["groupId"])
	}
	if _, present := c.Params["recipient"]; present {
		t.Error("recipient must be omitted for group chats")
	}
	if _, present := c.Params["quoteTimestamp"]; present {
		t.Error("quote must be dropped for group chats")
	}
}

func TestSendMessage_ButtonsFallbackAppended(t *testing.T) {
	d := newFakeDaemon(t)
	tr := mustNew(t, Options{Endpoint: d.srv.URL, Account: "+86"})

	_, err := tr.SendMessage(context.Background(), "+861", transport.OutboundMessage{
		Text:    "pick",
		Buttons: [][]transport.Button{{{Text: "Yes", Value: "yes"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	c := d.lastCall(t)
	if c.Params["message"] != "pick\n\n1. Yes [yes]" {
		t.Errorf("message: %q", c.Params["message"])
	}
}

func TestSendReaction_AddAndRemove(t *testing.T) {
	d := newFakeDaemon(t)
	tr := mustNew(t, Options{Endpoint: d.srv.URL, Account: "+86"})

	if err := tr.AddReaction(context.Background(), "+8613900000001", "1700000000123", "👀"); err != nil {
		t.Fatal(err)
	}
	c := d.lastCall(t)
	if c.Method != "sendReaction" {
		t.Errorf("method: %q", c.Method)
	}
	if c.Params["reaction"] != "👀" {
		t.Errorf("reaction: %v", c.Params["reaction"])
	}
	if c.Params["targetAuthor"] != "+8613900000001" {
		t.Errorf("targetAuthor: %v", c.Params["targetAuthor"])
	}
	if c.Params["targetTimestamp"] != float64(1700000000123) {
		t.Errorf("targetTimestamp: %v", c.Params["targetTimestamp"])
	}
	if _, present := c.Params["remove"]; present {
		t.Error("remove should be omitted on add")
	}

	if err := tr.RemoveReaction(context.Background(), "+8613900000001", "1700000000123", "👀"); err != nil {
		t.Fatal(err)
	}
	c = d.lastCall(t)
	if c.Params["remove"] != true {
		t.Errorf("remove: %v", c.Params["remove"])
	}
}

func TestShowTyping(t *testing.T) {
	d := newFakeDaemon(t)
	tr := mustNew(t, Options{Endpoint: d.srv.URL, Account: "+86"})

	if err := tr.ShowTyping(context.Background(), "+8613900000001"); err != nil {
		t.Fatal(err)
	}
	c := d.lastCall(t)
	if c.Method != "sendTyping" {
		t.Errorf("method: %q", c.Method)
	}
	rec, _ := c.Params["recipient"].([]any)
	if len(rec) != 1 || rec[0] != "+8613900000001" {
		t.Errorf("recipient: %v", c.Params["recipient"])
	}
	if _, present := c.Params["stop"]; present {
		t.Error("stop should be omitted for typing-started")
	}
}

func TestDeleteMessage(t *testing.T) {
	d := newFakeDaemon(t)
	tr := mustNew(t, Options{Endpoint: d.srv.URL, Account: "+86"})

	if err := tr.DeleteMessage(context.Background(), "group:Z3JvdXA=", "1700000000123"); err != nil {
		t.Fatal(err)
	}
	c := d.lastCall(t)
	if c.Method != "remoteDelete" {
		t.Errorf("method: %q", c.Method)
	}
	if c.Params["groupId"] != "Z3JvdXA=" || c.Params["targetTimestamp"] != float64(1700000000123) {
		t.Errorf("params: %v", c.Params)
	}

	if err := tr.DeleteMessage(context.Background(), "+861", "not-a-timestamp"); err == nil {
		t.Error("non-numeric message id should error")
	}
}

func TestSendAttachment_DataURI(t *testing.T) {
	d := newFakeDaemon(t)
	tr := mustNew(t, Options{Endpoint: d.srv.URL, Account: "+86"})

	path := filepath.Join(t.TempDir(), "pic.png")
	if err := os.WriteFile(path, []byte{0x89, 'P', 'N', 'G'}, 0o644); err != nil {
		t.Fatal(err)
	}
	id, err := tr.SendAttachment(context.Background(), "+8613900000001", transport.OutboundAttachment{
		Kind:    transport.AttachmentImage,
		Path:    path,
		Caption: "a cat",
	})
	if err != nil {
		t.Fatal(err)
	}
	if id != "1723456789012" {
		t.Errorf("message id: %q", id)
	}
	c := d.lastCall(t)
	atts, _ := c.Params["attachments"].([]any)
	if len(atts) != 1 {
		t.Fatalf("attachments: %v", c.Params["attachments"])
	}
	uri, _ := atts[0].(string)
	if !strings.HasPrefix(uri, "data:image/png;base64,") {
		t.Errorf("data uri prefix wrong: %q", uri)
	}
	if c.Params["message"] != "a cat" {
		t.Errorf("caption: %v", c.Params["message"])
	}
}

func TestRPCErrorSurfaced(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Invalid params"}}`)
	}))
	defer srv.Close()
	tr := mustNew(t, Options{Endpoint: srv.URL, Account: "+86"})

	_, err := tr.SendMessage(context.Background(), "+861", transport.OutboundMessage{Text: "x"})
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "-32602") || !strings.Contains(err.Error(), "Invalid params") {
		t.Errorf("error should carry JSON-RPC code and message: %v", err)
	}
	if !strings.HasPrefix(err.Error(), "signal send:") {
		t.Errorf("error should be prefixed with the op: %v", err)
	}
}

// =============================================================================
// integration (gated)
// =============================================================================

// TestSignal_Integration exercises a real signal-cli daemon. Requirements:
//
//	SIGNAL_INTEGRATION_TEST=1
//	SIGNAL_ENDPOINT (default http://127.0.0.1:8080)
//	SIGNAL_ACCOUNT  (the daemon's E.164 number)
//
// The test only opens the event stream briefly; it does not send messages.
func TestSignal_Integration(t *testing.T) {
	if os.Getenv("SIGNAL_INTEGRATION_TEST") != "1" {
		t.Skip("set SIGNAL_INTEGRATION_TEST=1 to run")
	}
	endpoint := os.Getenv("SIGNAL_ENDPOINT")
	if endpoint == "" {
		endpoint = "http://127.0.0.1:8080"
	}
	account := os.Getenv("SIGNAL_ACCOUNT")
	if account == "" {
		t.Skip("SIGNAL_ACCOUNT is required")
	}
	tr := mustNew(t, Options{Endpoint: endpoint, Account: account})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- tr.Start(ctx, transport.MessageHandlerFunc(func(_ context.Context, m transport.InboundMessage) error {
			t.Logf("received: %+v", m)
			return nil
		}))
	}()
	time.Sleep(2 * time.Second)
	_ = tr.Stop()
	cancel()
	select {
	case err := <-done:
		if err != nil && err != context.Canceled {
			t.Errorf("Start returned: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Error("Start did not return after Stop+cancel")
	}
}
