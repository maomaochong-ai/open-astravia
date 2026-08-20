package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"vetta-im-gateway/internal/transport"
)

func TestNew_RequiresToken(t *testing.T) {
	if _, err := New(Options{}); err == nil {
		t.Error("expected error for missing BotToken")
	}
	if _, err := New(Options{BotToken: "x"}); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestCapabilities(t *testing.T) {
	tr, err := New(Options{BotToken: "x"})
	if err != nil {
		t.Fatal(err)
	}
	caps := tr.Capabilities()
	want := transport.Capabilities{
		SupportsMessageEdit: true,
		SupportsCards:       false,
		SupportsButtons:     true,
		SupportsFileUpload:  true,
		SupportsThreads:     true,
		SupportsReactions:   true,
		MaxMessageLength:    4096,
	}
	if caps != want {
		t.Errorf("capabilities: got %+v want %+v", caps, want)
	}
}

func TestMarkdownToHTML(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain", "hello", "hello"},
		{"escapes", "a & b <c> d>e", "a &amp; b &lt;c&gt; d&gt;e"},
		{"bold", "**bold**", "<b>bold</b>"},
		{"italic", "*it*", "<i>it</i>"},
		{"code", "`x<y`", "<code>x&lt;y</code>"},
		{"code not markdown inside", "`**not bold**`", "<code>**not bold**</code>"},
		{"link", "[site](https://x.io)", `<a href="https://x.io">site</a>`},
		{"link escaped url", "[a](https://x.io?a=1&b=2)", `<a href="https://x.io?a=1&amp;b=2">a</a>`},
		{"fence with lang", "```go\nfmt.Println(1)\n```", `<pre><code class="language-go">fmt.Println(1)</code></pre>`},
		{"fence no lang", "```\na<b\n```", "<pre>a&lt;b</pre>"},
		{"fence keeps inner markdown literal", "```\n**x**\n```", "<pre>**x**</pre>"},
		{"unterminated fence", "```\ncode", "<pre>code</pre>"},
		{"nested bold code", "**bold `code`**", "<b>bold <code>code</code></b>"},
		{"unterminated bold literal", "**oops", "**oops"},
		{"unterminated code literal", "`oops", "`oops"},
		{"lone asterisk literal", "2*3", "2*3"},
		{"mixed", "pre **b** mid `c` post", "pre <b>b</b> mid <code>c</code> post"},
		{"text around fence", "before\n```\nx\n```\nafter", "before\n<pre>x</pre>\nafter"},
		{"multiline preserved", "line1\nline2", "line1\nline2"},
		{"cjk", "中文 **加粗**", "中文 <b>加粗</b>"},
		{"bracket without link literal", "[not a link]", "[not a link]"},
		{"empty", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := markdownToHTML(c.in); got != c.want {
				t.Errorf("markdownToHTML(%q)\n got  %q\n want %q", c.in, got, c.want)
			}
		})
	}
}

func TestTruncateUTF8(t *testing.T) {
	long := strings.Repeat("a", 100)
	if got := truncateUTF8(long, 64); len(got) != 64 {
		t.Errorf("ascii truncation: len=%d", len(got))
	}
	cjk := strings.Repeat("好", 30) // 90 bytes
	got := truncateUTF8(cjk, 64)
	if len(got) > 64 || !utf8.ValidString(got) {
		t.Errorf("cjk truncation invalid: len=%d valid=%v", len(got), utf8.ValidString(got))
	}
	if got := truncateUTF8("short", 64); got != "short" {
		t.Errorf("short string should be untouched: %q", got)
	}
}

func TestStripBotMention(t *testing.T) {
	cases := []struct {
		in, user, want string
		mentioned      bool
	}{
		{"@vettabot do thing", "vettabot", "do thing", true},
		{"@VettaBot Do Thing", "vettabot", "Do Thing", true},
		{"hey @vettabot help", "vettabot", "hey  help", true},
		{"no mention here", "vettabot", "no mention here", false},
		{"@otherbot hi", "vettabot", "@otherbot hi", false},
		{"@vettabot", "vettabot", "", true},
		{"anything", "", "anything", false},
	}
	for _, c := range cases {
		got, mentioned := stripBotMention(c.in, c.user)
		if mentioned != c.mentioned {
			t.Errorf("stripBotMention(%q): mentioned=%v want %v", c.in, mentioned, c.mentioned)
			continue
		}
		if mentioned && got != strings.TrimSpace(c.want) {
			t.Errorf("stripBotMention(%q): got %q want %q", c.in, got, strings.TrimSpace(c.want))
		}
	}
}

// =============================================================================
// fake Bot API
// =============================================================================

const testToken = "TESTTOKEN"

// fakeAPI is an httptest-backed Bot API double. It records every request
// body per method and lets tests install per-method handlers. Unhandled
// methods respond {"ok":true,"result":{"message_id":1}} which satisfies
// every send-shaped call.
type fakeAPI struct {
	mu       sync.Mutex
	bodies   map[string][][]byte
	handlers map[string]func(body []byte, w http.ResponseWriter, r *http.Request)
	srv      *httptest.Server
}

func newFakeAPI(t *testing.T) *fakeAPI {
	t.Helper()
	f := &fakeAPI{
		bodies:   map[string][][]byte{},
		handlers: map[string]func([]byte, http.ResponseWriter, *http.Request){},
	}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/file/") {
			f.mu.Lock()
			h := f.handlers["_file"]
			f.mu.Unlock()
			if h != nil {
				h(nil, w, r)
				return
			}
			http.NotFound(w, r)
			return
		}
		method := path.Base(r.URL.Path)
		body, _ := io.ReadAll(r.Body)
		r.Body = io.NopCloser(bytes.NewReader(body))
		f.mu.Lock()
		f.bodies[method] = append(f.bodies[method], body)
		h := f.handlers[method]
		f.mu.Unlock()
		if h != nil {
			h(body, w, r)
			return
		}
		respondResult(w, map[string]any{"message_id": 1})
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeAPI) handle(method string, h func(body []byte, w http.ResponseWriter, r *http.Request)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.handlers[method] = h
}

func (f *fakeAPI) recorded(method string) [][]byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([][]byte, len(f.bodies[method]))
	copy(out, f.bodies[method])
	return out
}

func respondResult(w http.ResponseWriter, result any) {
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": result})
}

func respondError(w http.ResponseWriter, code int, description string) {
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok": false, "error_code": code, "description": description,
	})
}

// serveGetMe installs the default bot identity.
func (f *fakeAPI) serveGetMe(username string) {
	f.handle("getMe", func(_ []byte, w http.ResponseWriter, _ *http.Request) {
		respondResult(w, map[string]any{"id": 999, "is_bot": true, "username": username})
	})
}

// serveUpdatesOnce serves the given updates on the first poll; every later
// poll parks until the client disconnects (Stop cancels the request) so the
// loop neither spins hot nor needs sleeps.
func (f *fakeAPI) serveUpdatesOnce(updates ...map[string]any) {
	first := make(chan struct{}, 1)
	first <- struct{}{}
	f.handle("getUpdates", func(_ []byte, w http.ResponseWriter, r *http.Request) {
		select {
		case <-first:
			respondResult(w, updates)
		default:
			<-r.Context().Done()
			respondResult(w, []any{})
		}
	})
}

func newTestTransport(t *testing.T, f *fakeAPI, opts Options) *Transport {
	t.Helper()
	opts.BotToken = testToken
	opts.BaseURL = f.srv.URL
	tr, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	return tr
}

// chanHandler forwards inbound messages to a channel for select-based
// synchronization (no sleep polling).
type chanHandler chan transport.InboundMessage

func (c chanHandler) HandleInbound(_ context.Context, m transport.InboundMessage) error {
	c <- m
	return nil
}

// runTransport starts tr in a goroutine and registers cleanup that stops it
// and waits for Start to return.
func runTransport(t *testing.T, tr *Transport, h transport.MessageHandler) {
	t.Helper()
	errCh := make(chan error, 1)
	go func() {
		errCh <- tr.Start(context.Background(), h)
	}()
	t.Cleanup(func() {
		_ = tr.Stop()
		select {
		case <-errCh:
		case <-time.After(5 * time.Second):
			t.Error("Start did not return after Stop")
		}
	})
}

func privateTextUpdate(updateID, userID, chatID, messageID int64, text string) map[string]any {
	return map[string]any{
		"update_id": updateID,
		"message": map[string]any{
			"message_id": messageID,
			"from":       map[string]any{"id": userID},
			"chat":       map[string]any{"id": chatID, "type": "private"},
			"text":       text,
		},
	}
}

func TestStart_PrivateMessageDelivered(t *testing.T) {
	f := newFakeAPI(t)
	f.serveGetMe("vettabot")

	u := privateTextUpdate(41, 100, 100, 7, "hello agent")
	u["message"].(map[string]any)["reply_to_message"] = map[string]any{
		"message_id": 5,
		"chat":       map[string]any{"id": 100, "type": "private"},
	}
	f.serveUpdatesOnce(u)

	tr := newTestTransport(t, f, Options{})
	ch := make(chanHandler, 8)
	runTransport(t, tr, ch)

	select {
	case m := <-ch:
		if m.Platform != "telegram" || m.ChatID != "100" || m.UserID != "100" ||
			m.MessageID != "7" || m.Text != "hello agent" || m.ReplyToID != "5" || m.ActionID != "" {
			t.Errorf("unexpected inbound: %+v", m)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("inbound message never arrived")
	}
}

func TestStart_OffsetAdvances(t *testing.T) {
	f := newFakeAPI(t)
	f.serveGetMe("vettabot")

	polled2 := make(chan struct{})
	first := make(chan struct{}, 1)
	first <- struct{}{}
	f.handle("getUpdates", func(_ []byte, w http.ResponseWriter, r *http.Request) {
		select {
		case <-first:
			respondResult(w, []any{privateTextUpdate(41, 1, 1, 7, "a"), privateTextUpdate(42, 1, 1, 8, "b")})
		default:
			close(polled2)
			<-r.Context().Done()
			respondResult(w, []any{})
		}
	})

	tr := newTestTransport(t, f, Options{})
	ch := make(chanHandler, 8)
	runTransport(t, tr, ch)

	for range 2 {
		select {
		case <-ch:
		case <-time.After(5 * time.Second):
			t.Fatal("inbound messages never arrived")
		}
	}
	select {
	case <-polled2:
	case <-time.After(5 * time.Second):
		t.Fatal("second poll never happened")
	}

	polls := f.recorded("getUpdates")
	if len(polls) < 2 {
		t.Fatalf("expected ≥2 polls, got %d", len(polls))
	}
	var req struct {
		Offset         int64    `json:"offset"`
		Timeout        int      `json:"timeout"`
		AllowedUpdates []string `json:"allowed_updates"`
	}
	if err := json.Unmarshal(polls[1], &req); err != nil {
		t.Fatal(err)
	}
	if req.Offset != 43 {
		t.Errorf("second poll offset: got %d want 43", req.Offset)
	}
	if req.Timeout != pollTimeoutSeconds {
		t.Errorf("timeout: got %d want %d", req.Timeout, pollTimeoutSeconds)
	}
	if len(req.AllowedUpdates) != 2 || req.AllowedUpdates[0] != "message" || req.AllowedUpdates[1] != "callback_query" {
		t.Errorf("allowed_updates: %v", req.AllowedUpdates)
	}
}

func TestStart_AllowedUserFilter(t *testing.T) {
	f := newFakeAPI(t)
	f.serveGetMe("vettabot")
	f.serveUpdatesOnce(
		privateTextUpdate(1, 555, 555, 1, "from stranger"),
		privateTextUpdate(2, 100, 100, 2, "from friend"),
	)

	tr := newTestTransport(t, f, Options{AllowedUserIDs: []int64{100}})
	ch := make(chanHandler, 8)
	runTransport(t, tr, ch)

	select {
	case m := <-ch:
		if m.UserID != "100" || m.Text != "from friend" {
			t.Errorf("filter passed the wrong message: %+v", m)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("allowed user's message never arrived")
	}
	// Both updates were in one batch and dispatch is sequential, so if the
	// stranger's message had passed it would have arrived first.
	select {
	case m := <-ch:
		t.Errorf("unexpected extra inbound: %+v", m)
	default:
	}
}

func groupTextUpdate(updateID, messageID int64, text string) map[string]any {
	return map[string]any{
		"update_id": updateID,
		"message": map[string]any{
			"message_id": messageID,
			"from":       map[string]any{"id": 100},
			"chat":       map[string]any{"id": -200, "type": "group"},
			"text":       text,
		},
	}
}

func TestStart_GroupMentionGating(t *testing.T) {
	f := newFakeAPI(t)
	f.serveGetMe("vettabot")
	f.serveUpdatesOnce(
		groupTextUpdate(1, 1, "chit chat without the bot"),
		groupTextUpdate(2, 2, "@vettabot run the tests"),
	)

	tr := newTestTransport(t, f, Options{})
	ch := make(chanHandler, 8)
	runTransport(t, tr, ch)

	select {
	case m := <-ch:
		if m.Text != "run the tests" {
			t.Errorf("mention should be stripped: %q", m.Text)
		}
		if m.ChatID != "-200" {
			t.Errorf("ChatID: %q", m.ChatID)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("mentioned group message never arrived")
	}
	select {
	case m := <-ch:
		t.Errorf("unmentioned group message should be dropped: %+v", m)
	default:
	}
}

func TestStart_CallbackQuery(t *testing.T) {
	f := newFakeAPI(t)
	f.serveGetMe("vettabot")

	acked := make(chan []byte, 1)
	f.handle("answerCallbackQuery", func(body []byte, w http.ResponseWriter, _ *http.Request) {
		acked <- body
		respondResult(w, true)
	})
	f.serveUpdatesOnce(map[string]any{
		"update_id": 1,
		"callback_query": map[string]any{
			"id":   "cbq-1",
			"from": map[string]any{"id": 100},
			"message": map[string]any{
				"message_id": 7,
				"chat":       map[string]any{"id": 100, "type": "private"},
			},
			"data": "approve",
		},
	})

	tr := newTestTransport(t, f, Options{})
	ch := make(chanHandler, 8)
	runTransport(t, tr, ch)

	select {
	case m := <-ch:
		if m.ActionID != "cbq-1" || m.Text != "approve" || m.ChatID != "100" ||
			m.UserID != "100" || m.MessageID != "7" {
			t.Errorf("unexpected callback inbound: %+v", m)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("callback inbound never arrived")
	}

	select {
	case body := <-acked:
		var req struct {
			ID string `json:"callback_query_id"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			t.Fatal(err)
		}
		if req.ID != "cbq-1" {
			t.Errorf("ack callback_query_id: %q", req.ID)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("answerCallbackQuery never called")
	}
}

// =============================================================================
// outbound request-body assertions (no Start needed)
// =============================================================================

func TestSendMessage_HTMLReplyAndButtons(t *testing.T) {
	f := newFakeAPI(t)
	f.handle("sendMessage", func(_ []byte, w http.ResponseWriter, _ *http.Request) {
		respondResult(w, map[string]any{"message_id": 321})
	})
	tr := newTestTransport(t, f, Options{})

	longValue := strings.Repeat("v", 80)
	id, err := tr.SendMessage(context.Background(), "100", transport.OutboundMessage{
		Text:      "**bold** & `code`",
		ReplyToID: "55",
		Buttons: [][]transport.Button{
			{{Text: "Yes", Value: "yes"}, {Text: "No", Value: "no"}},
			{{Text: "Long", Value: longValue}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if id != "321" {
		t.Errorf("message id: %q", id)
	}

	bodies := f.recorded("sendMessage")
	if len(bodies) != 1 {
		t.Fatalf("expected 1 sendMessage, got %d", len(bodies))
	}
	var req struct {
		ChatID    string `json:"chat_id"`
		Text      string `json:"text"`
		ParseMode string `json:"parse_mode"`
		ReplyParm struct {
			MessageID int64 `json:"message_id"`
		} `json:"reply_parameters"`
		ReplyMarkup struct {
			InlineKeyboard [][]struct {
				Text         string `json:"text"`
				CallbackData string `json:"callback_data"`
			} `json:"inline_keyboard"`
		} `json:"reply_markup"`
	}
	if err := json.Unmarshal(bodies[0], &req); err != nil {
		t.Fatal(err)
	}
	if req.ChatID != "100" || req.ParseMode != "HTML" {
		t.Errorf("chat_id/parse_mode: %q / %q", req.ChatID, req.ParseMode)
	}
	if req.Text != "<b>bold</b> &amp; <code>code</code>" {
		t.Errorf("text: %q", req.Text)
	}
	if req.ReplyParm.MessageID != 55 {
		t.Errorf("reply_parameters.message_id: %d", req.ReplyParm.MessageID)
	}
	kb := req.ReplyMarkup.InlineKeyboard
	if len(kb) != 2 || len(kb[0]) != 2 || len(kb[1]) != 1 {
		t.Fatalf("keyboard shape: %+v", kb)
	}
	if kb[0][0].Text != "Yes" || kb[0][0].CallbackData != "yes" {
		t.Errorf("button: %+v", kb[0][0])
	}
	if len(kb[1][0].CallbackData) != 64 {
		t.Errorf("long callback_data should be truncated to 64 bytes, got %d", len(kb[1][0].CallbackData))
	}
}

func TestSendMessage_ParseErrorFallsBackToPlainText(t *testing.T) {
	f := newFakeAPI(t)
	var callMu sync.Mutex
	calls := 0
	f.handle("sendMessage", func(_ []byte, w http.ResponseWriter, _ *http.Request) {
		callMu.Lock()
		calls++
		first := calls == 1
		callMu.Unlock()
		if first {
			respondError(w, 400, "Bad Request: can't parse entities: unexpected end tag")
			return
		}
		respondResult(w, map[string]any{"message_id": 9})
	})
	tr := newTestTransport(t, f, Options{})

	id, err := tr.SendMessage(context.Background(), "100", transport.OutboundMessage{Text: "**broken"})
	if err != nil {
		t.Fatal(err)
	}
	if id != "9" {
		t.Errorf("message id: %q", id)
	}

	bodies := f.recorded("sendMessage")
	if len(bodies) != 2 {
		t.Fatalf("expected 2 attempts, got %d", len(bodies))
	}
	var retry map[string]any
	if err := json.Unmarshal(bodies[1], &retry); err != nil {
		t.Fatal(err)
	}
	if _, hasParse := retry["parse_mode"]; hasParse {
		t.Error("retry should drop parse_mode")
	}
	if retry["text"] != "**broken" {
		t.Errorf("retry should send the raw markdown: %q", retry["text"])
	}
}

func TestSendMessage_HardErrorSurfaces(t *testing.T) {
	f := newFakeAPI(t)
	f.handle("sendMessage", func(_ []byte, w http.ResponseWriter, _ *http.Request) {
		respondError(w, 403, "Forbidden: bot was blocked by the user")
	})
	tr := newTestTransport(t, f, Options{})
	if _, err := tr.SendMessage(context.Background(), "100", transport.OutboundMessage{Text: "x"}); err == nil {
		t.Error("expected error for non-parse API failure")
	} else if !strings.Contains(err.Error(), "blocked") {
		t.Errorf("description should propagate: %v", err)
	}
}

func TestEditMessage_BodyAndNotModified(t *testing.T) {
	f := newFakeAPI(t)
	f.handle("editMessageText", func(_ []byte, w http.ResponseWriter, _ *http.Request) {
		respondResult(w, map[string]any{"message_id": 7})
	})
	tr := newTestTransport(t, f, Options{})

	if err := tr.EditMessage(context.Background(), "100", "7", transport.OutboundMessage{Text: "*new*"}); err != nil {
		t.Fatal(err)
	}
	var req struct {
		ChatID    string `json:"chat_id"`
		MessageID int64  `json:"message_id"`
		Text      string `json:"text"`
		ParseMode string `json:"parse_mode"`
	}
	if err := json.Unmarshal(f.recorded("editMessageText")[0], &req); err != nil {
		t.Fatal(err)
	}
	if req.ChatID != "100" || req.MessageID != 7 || req.Text != "<i>new</i>" || req.ParseMode != "HTML" {
		t.Errorf("edit body: %+v", req)
	}

	// "message is not modified" maps to success.
	f.handle("editMessageText", func(_ []byte, w http.ResponseWriter, _ *http.Request) {
		respondError(w, 400, "Bad Request: message is not modified")
	})
	if err := tr.EditMessage(context.Background(), "100", "7", transport.OutboundMessage{Text: "same"}); err != nil {
		t.Errorf("'message is not modified' should be treated as success, got %v", err)
	}
}

func TestEndStream_NoOp(t *testing.T) {
	f := newFakeAPI(t)
	tr := newTestTransport(t, f, Options{})
	if err := tr.EndStream(context.Background(), "100", "7"); err != nil {
		t.Errorf("EndStream should be a nil no-op, got %v", err)
	}
	if n := len(f.recorded("editMessageText")); n != 0 {
		t.Errorf("EndStream should make no API calls, saw %d", n)
	}
}

func TestDeleteMessage(t *testing.T) {
	f := newFakeAPIWithBool(t, "deleteMessage")
	tr := newTestTransport(t, f, Options{})
	if err := tr.DeleteMessage(context.Background(), "100", "7"); err != nil {
		t.Fatal(err)
	}
	var req struct {
		ChatID    string `json:"chat_id"`
		MessageID int64  `json:"message_id"`
	}
	if err := json.Unmarshal(f.recorded("deleteMessage")[0], &req); err != nil {
		t.Fatal(err)
	}
	if req.ChatID != "100" || req.MessageID != 7 {
		t.Errorf("delete body: %+v", req)
	}
}

func TestShowTyping(t *testing.T) {
	f := newFakeAPIWithBool(t, "sendChatAction")
	tr := newTestTransport(t, f, Options{})
	if err := tr.ShowTyping(context.Background(), "100"); err != nil {
		t.Fatal(err)
	}
	var req struct {
		ChatID string `json:"chat_id"`
		Action string `json:"action"`
	}
	if err := json.Unmarshal(f.recorded("sendChatAction")[0], &req); err != nil {
		t.Fatal(err)
	}
	if req.ChatID != "100" || req.Action != "typing" {
		t.Errorf("chat action body: %+v", req)
	}
}

// newFakeAPIWithBool installs a {"ok":true,"result":true} responder for
// methods whose result is a bare bool.
func newFakeAPIWithBool(t *testing.T, methods ...string) *fakeAPI {
	f := newFakeAPI(t)
	for _, m := range methods {
		f.handle(m, func(_ []byte, w http.ResponseWriter, _ *http.Request) {
			respondResult(w, true)
		})
	}
	return f
}

func TestReactions(t *testing.T) {
	f := newFakeAPIWithBool(t, "setMessageReaction")
	tr := newTestTransport(t, f, Options{})

	if err := tr.AddReaction(context.Background(), "100", "7", "👀"); err != nil {
		t.Fatal(err)
	}
	if err := tr.RemoveReaction(context.Background(), "100", "7", "👀"); err != nil {
		t.Fatal(err)
	}

	bodies := f.recorded("setMessageReaction")
	if len(bodies) != 2 {
		t.Fatalf("expected 2 calls, got %d", len(bodies))
	}
	var add struct {
		ChatID    string `json:"chat_id"`
		MessageID int64  `json:"message_id"`
		Reaction  []struct {
			Type  string `json:"type"`
			Emoji string `json:"emoji"`
		} `json:"reaction"`
	}
	if err := json.Unmarshal(bodies[0], &add); err != nil {
		t.Fatal(err)
	}
	if add.ChatID != "100" || add.MessageID != 7 ||
		len(add.Reaction) != 1 || add.Reaction[0].Type != "emoji" || add.Reaction[0].Emoji != "👀" {
		t.Errorf("add reaction body: %+v", add)
	}
	var remove struct {
		Reaction []any `json:"reaction"`
	}
	if err := json.Unmarshal(bodies[1], &remove); err != nil {
		t.Fatal(err)
	}
	if len(remove.Reaction) != 0 {
		t.Errorf("remove should send an empty reaction array, got %+v", remove.Reaction)
	}
}

func TestSendAttachment(t *testing.T) {
	f := newFakeAPI(t)
	type upload struct {
		chatID, caption, field, filename string
	}
	var gotMu sync.Mutex
	got := make(map[string]upload)
	lookup := func(method string) upload {
		gotMu.Lock()
		defer gotMu.Unlock()
		return got[method]
	}
	record := func(method string) func([]byte, http.ResponseWriter, *http.Request) {
		return func(_ []byte, w http.ResponseWriter, r *http.Request) {
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				respondError(w, 400, "not multipart: "+err.Error())
				return
			}
			var u upload
			u.chatID = r.FormValue("chat_id")
			u.caption = r.FormValue("caption")
			for field, files := range r.MultipartForm.File {
				u.field = field
				u.filename = files[0].Filename
			}
			gotMu.Lock()
			got[method] = u
			gotMu.Unlock()
			respondResult(w, map[string]any{"message_id": 77})
		}
	}
	f.handle("sendPhoto", record("sendPhoto"))
	f.handle("sendDocument", record("sendDocument"))
	tr := newTestTransport(t, f, Options{})

	dir := t.TempDir()
	imgPath := filepath.Join(dir, "shot.png")
	if err := os.WriteFile(imgPath, []byte("png-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}

	id, err := tr.SendAttachment(context.Background(), "100", transport.OutboundAttachment{
		Kind: transport.AttachmentImage, Path: imgPath, Caption: "看这个",
	})
	if err != nil {
		t.Fatal(err)
	}
	if id != "77" {
		t.Errorf("message id: %q", id)
	}
	if u := lookup("sendPhoto"); u.chatID != "100" || u.caption != "看这个" || u.field != "photo" || u.filename != "shot.png" {
		t.Errorf("sendPhoto upload: %+v", u)
	}

	docPath := filepath.Join(dir, "report.pdf")
	if err := os.WriteFile(docPath, []byte("pdf-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := tr.SendAttachment(context.Background(), "100", transport.OutboundAttachment{
		Kind: transport.AttachmentFile, Path: docPath,
	}); err != nil {
		t.Fatal(err)
	}
	if u := lookup("sendDocument"); u.field != "document" || u.filename != "report.pdf" || u.caption != "" {
		t.Errorf("sendDocument upload: %+v", u)
	}
}

// =============================================================================
// inbound media
// =============================================================================

// pngMagic is enough of a PNG header for inbox.GuessImageExt.
var pngMagic = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}

func TestStart_InboundPhotoPersistedToInbox(t *testing.T) {
	f := newFakeAPI(t)
	f.serveGetMe("vettabot")
	f.serveUpdatesOnce(map[string]any{
		"update_id": 1,
		"message": map[string]any{
			"message_id": 7,
			"from":       map[string]any{"id": 100},
			"chat":       map[string]any{"id": 100, "type": "private"},
			"photo": []map[string]any{
				{"file_id": "small", "width": 90, "height": 90},
				{"file_id": "big", "width": 800, "height": 600},
			},
		},
	})
	f.handle("getFile", func(body []byte, w http.ResponseWriter, _ *http.Request) {
		var req struct {
			FileID string `json:"file_id"`
		}
		_ = json.Unmarshal(body, &req)
		if req.FileID != "big" {
			respondError(w, 400, fmt.Sprintf("expected the largest photo size, got %q", req.FileID))
			return
		}
		respondResult(w, map[string]any{"file_id": req.FileID, "file_path": "photos/big.dat"})
	})
	f.handle("_file", func(_ []byte, w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/photos/big.dat") {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(pngMagic)
	})

	inboxDir := t.TempDir()
	tr := newTestTransport(t, f, Options{InboxDir: inboxDir})
	ch := make(chanHandler, 8)
	runTransport(t, tr, ch)

	select {
	case m := <-ch:
		if len(m.Attachments) != 1 {
			t.Fatalf("expected 1 attachment, got %+v", m)
		}
		att := m.Attachments[0]
		if att.Kind != transport.AttachmentImage {
			t.Errorf("kind: %q", att.Kind)
		}
		if !strings.HasSuffix(att.URL, ".png") || !filepath.IsAbs(att.URL) {
			t.Errorf("URL should be an absolute .png path: %q", att.URL)
		}
		if !strings.HasPrefix(att.URL, inboxDir) {
			t.Errorf("URL should live under the inbox dir: %q", att.URL)
		}
		b, err := os.ReadFile(att.URL)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(b, pngMagic) {
			t.Errorf("persisted bytes mismatch")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("photo inbound never arrived")
	}
}

func TestStart_InboundMediaWithoutInboxHint(t *testing.T) {
	f := newFakeAPI(t)
	f.serveGetMe("vettabot")

	hinted := make(chan []byte, 1)
	f.handle("sendMessage", func(body []byte, w http.ResponseWriter, _ *http.Request) {
		hinted <- body
		respondResult(w, map[string]any{"message_id": 1})
	})
	f.serveUpdatesOnce(map[string]any{
		"update_id": 1,
		"message": map[string]any{
			"message_id": 7,
			"from":       map[string]any{"id": 100},
			"chat":       map[string]any{"id": 100, "type": "private"},
			"document":   map[string]any{"file_id": "doc1", "file_name": "a.pdf"},
		},
	})

	tr := newTestTransport(t, f, Options{}) // no InboxDir
	ch := make(chanHandler, 8)
	runTransport(t, tr, ch)

	select {
	case body := <-hinted:
		var req struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(req.Text, "附件") {
			t.Errorf("hint text: %q", req.Text)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("hint reply never sent")
	}
	select {
	case m := <-ch:
		t.Errorf("media-only message without inbox should not reach handler: %+v", m)
	default:
	}
	if n := len(f.recorded("getFile")); n != 0 {
		t.Errorf("no download should happen without an inbox dir, saw %d getFile calls", n)
	}
}

// =============================================================================
// lifecycle
// =============================================================================

func TestStop_Idempotent(t *testing.T) {
	f := newFakeAPI(t)
	tr := newTestTransport(t, f, Options{})
	if err := tr.Stop(); err != nil {
		t.Fatal(err)
	}
	if err := tr.Stop(); err != nil {
		t.Errorf("second Stop should be a no-op, got %v", err)
	}
	if err := tr.Start(context.Background(), make(chanHandler, 1)); err == nil {
		t.Error("Start after Stop should error")
	}
}

// =============================================================================
// Integration test (gated)
// =============================================================================
//
// Set TELEGRAM_INTEGRATION_TEST=1 plus IM_GATEWAY_TELEGRAM_BOT_TOKEN in env
// to run a real connect cycle against api.telegram.org. The test briefly
// Start()s the transport and Stop()s it; no messages are sent.
func TestTelegram_Integration_ConnectAndStop(t *testing.T) {
	if os.Getenv("TELEGRAM_INTEGRATION_TEST") != "1" {
		t.Skip("set TELEGRAM_INTEGRATION_TEST=1 to run")
	}
	token := os.Getenv("IM_GATEWAY_TELEGRAM_BOT_TOKEN")
	if token == "" {
		t.Skip("integration test requires IM_GATEWAY_TELEGRAM_BOT_TOKEN")
	}

	tr, err := New(Options{BotToken: token})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- tr.Start(ctx, transport.MessageHandlerFunc(func(_ context.Context, msg transport.InboundMessage) error {
			t.Logf("received: %+v", msg)
			return nil
		}))
	}()

	time.Sleep(2 * time.Second)
	_ = tr.Stop()
	cancel()

	select {
	case err := <-done:
		if err != nil && !strings.Contains(err.Error(), "context canceled") {
			t.Errorf("Start returned: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Error("Start did not return after Stop+cancel")
	}
}
