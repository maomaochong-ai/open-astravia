package slack

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	slackapi "github.com/slack-go/slack"
	"github.com/slack-go/slack/slackevents"

	"vetta-im-gateway/internal/transport"
)

func TestNew_ValidatesTokenPrefixes(t *testing.T) {
	if _, err := New(Options{}); err == nil {
		t.Error("expected error for missing tokens")
	}
	if _, err := New(Options{BotToken: "xoxb-1", AppToken: "wrong"}); err == nil {
		t.Error("expected error for bad AppToken prefix")
	}
	if _, err := New(Options{BotToken: "wrong", AppToken: "xapp-1"}); err == nil {
		t.Error("expected error for bad BotToken prefix")
	}
	if _, err := New(Options{BotToken: "xoxb-1", AppToken: "xapp-1"}); err != nil {
		t.Errorf("valid tokens should construct, got %v", err)
	}
}

func TestCapabilities(t *testing.T) {
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	caps := tr.Capabilities()
	if !caps.SupportsMessageEdit || !caps.SupportsButtons || !caps.SupportsFileUpload ||
		!caps.SupportsThreads || !caps.SupportsReactions {
		t.Errorf("capability flags wrong: %+v", caps)
	}
	if caps.SupportsCards {
		t.Error("Slack should not advertise SupportsCards")
	}
	if caps.MaxMessageLength != 40000 {
		t.Errorf("MaxMessageLength: %d", caps.MaxMessageLength)
	}
}

func TestStop_Idempotent(t *testing.T) {
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	if err := tr.Stop(); err != nil {
		t.Fatal(err)
	}
	if err := tr.Stop(); err != nil {
		t.Fatal(err)
	}
}

// =============================================================================
// pure helpers
// =============================================================================

func TestMarkdownToMrkdwn(t *testing.T) {
	cases := map[string]string{
		"**bold**":                   "*bold*",
		"pre **a** mid **b** post":   "pre *a* mid *b* post",
		"[link](https://x.io/a)":     "<https://x.io/a|link>",
		"see [docs](http://d) now":   "see <http://d|docs> now",
		"plain text stays":           "plain text stays",
		"`**not bold**`":             "`**not bold**`",
		"```\n**raw** [a](b)\n```":   "```\n**raw** [a](b)\n```",
		"**b** `**c**` **d**":        "*b* `**c**` *d*",
		"中文 **加粗** 保持":               "中文 *加粗* 保持",
		"```go\nx := \"**y**\"\n```": "```go\nx := \"**y**\"\n```",
	}
	for in, want := range cases {
		if got := markdownToMrkdwn(in); got != want {
			t.Errorf("markdownToMrkdwn(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestEmojiToSlackName(t *testing.T) {
	cases := map[string]string{
		"👀": "eyes",
		"✅": "white_check_mark",
		"❌": "x",
	}
	for emoji, want := range cases {
		got, err := emojiToSlackName(emoji)
		if err != nil {
			t.Fatalf("emojiToSlackName(%q): %v", emoji, err)
		}
		if got != want {
			t.Errorf("emojiToSlackName(%q) = %q, want %q", emoji, got, want)
		}
	}
	if _, err := emojiToSlackName("🦄"); err == nil || !strings.Contains(err.Error(), "unsupported emoji") {
		t.Errorf("unsupported emoji should error, got %v", err)
	}
}

func TestStripBotMention(t *testing.T) {
	if got := stripBotMention("<@U123> hello", "U123"); got != "hello" {
		t.Errorf("got %q", got)
	}
	if got := stripBotMention("<@U123|vetta> hi <@U123>", "U123"); got != "hi" {
		t.Errorf("got %q", got)
	}
	// A mention of a different user is user content, not bot noise.
	if got := stripBotMention("ask <@U999> please", "U123"); got != "ask <@U999> please" {
		t.Errorf("got %q", got)
	}
	if got := stripBotMention("  raw  ", ""); got != "raw" {
		t.Errorf("got %q", got)
	}
}

func TestBuildButtonBlocks(t *testing.T) {
	blocks := buildButtonBlocks("pick one", [][]transport.Button{
		{{Text: "Yes", Value: "yes"}, {Text: "No", Value: "no"}},
		{{Text: "Later", Value: "later"}},
	})
	if len(blocks) != 3 {
		t.Fatalf("expected section + 2 action rows, got %d blocks", len(blocks))
	}
	section, ok := blocks[0].(*slackapi.SectionBlock)
	if !ok {
		t.Fatalf("first block should be a section, got %T", blocks[0])
	}
	if section.Text == nil || section.Text.Text != "pick one" || section.Text.Type != slackapi.MarkdownType {
		t.Errorf("section text wrong: %+v", section.Text)
	}
	row0, ok := blocks[1].(*slackapi.ActionBlock)
	if !ok {
		t.Fatalf("second block should be actions, got %T", blocks[1])
	}
	if len(row0.Elements.ElementSet) != 2 {
		t.Fatalf("row0 should have 2 buttons, got %d", len(row0.Elements.ElementSet))
	}
	btn, ok := row0.Elements.ElementSet[1].(*slackapi.ButtonBlockElement)
	if !ok {
		t.Fatalf("element should be a button, got %T", row0.Elements.ElementSet[1])
	}
	if btn.ActionID != "vetta_btn_0_1" || btn.Value != "no" || btn.Text.Text != "No" {
		t.Errorf("button wrong: %+v", btn)
	}
	row1 := blocks[2].(*slackapi.ActionBlock)
	btn2 := row1.Elements.ElementSet[0].(*slackapi.ButtonBlockElement)
	if btn2.ActionID != "vetta_btn_1_0" || btn2.Value != "later" {
		t.Errorf("row1 button wrong: %+v", btn2)
	}
}

// =============================================================================
// inbound event handling
// =============================================================================

// captureHandler records inbound messages for assertions.
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

func (h *captureHandler) snapshot() []transport.InboundMessage {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]transport.InboundMessage, len(h.msgs))
	copy(out, h.msgs)
	return out
}

func newTestTransport(t *testing.T, opts Options) *Transport {
	t.Helper()
	tr, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	return tr
}

// wrapCallback wraps an inner event the way socketmode's parseEvent does:
// slackevents.ParseEvent stores a pointer to the typed inner event.
func wrapCallback(innerType string, data any) slackevents.EventsAPIEvent {
	return slackevents.EventsAPIEvent{
		Type:       slackevents.CallbackEvent,
		InnerEvent: slackevents.EventsAPIInnerEvent{Type: innerType, Data: data},
	}
}

func dmMessage(user, channel, text string) *slackevents.MessageEvent {
	return &slackevents.MessageEvent{
		Type:        "message",
		User:        user,
		Text:        text,
		TimeStamp:   "1700000000.000100",
		Channel:     channel,
		ChannelType: slackevents.ChannelTypeIM,
	}
}

func TestHandleEventsAPI_DMText(t *testing.T) {
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	tr.botUserID = "UBOT"
	h := &captureHandler{}

	ev := wrapCallback("message", dmMessage("U1", "D1", "hello"))
	if err := tr.handleEventsAPI(context.Background(), ev, h); err != nil {
		t.Fatal(err)
	}
	got := h.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1 inbound, got %d", len(got))
	}
	m := got[0]
	if m.Platform != "slack" || m.ChatID != "D1" || m.UserID != "U1" {
		t.Errorf("routing fields wrong: %+v", m)
	}
	if m.MessageID != "1700000000.000100" {
		t.Errorf("MessageID should be the message ts, got %q", m.MessageID)
	}
	if m.Text != "hello" || m.ActionID != "" {
		t.Errorf("content wrong: %+v", m)
	}
}

func TestHandleEventsAPI_DMThreadReply(t *testing.T) {
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	h := &captureHandler{}

	msg := dmMessage("U1", "D1", "in thread")
	msg.ThreadTimeStamp = "1699999999.000001"
	_ = tr.handleEventsAPI(context.Background(), wrapCallback("message", msg), h)
	got := h.snapshot()
	if len(got) != 1 || got[0].ReplyToID != "1699999999.000001" {
		t.Fatalf("thread_ts should map to ReplyToID, got %+v", got)
	}
}

func TestHandleEventsAPI_DropsBotAndEditedMessages(t *testing.T) {
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	tr.botUserID = "UBOT"
	h := &captureHandler{}

	botMsg := dmMessage("U1", "D1", "from a bot")
	botMsg.BotID = "B42"
	edited := dmMessage("U1", "D1", "edited")
	edited.SubType = "message_changed"
	self := dmMessage("UBOT", "D1", "echo of ourselves")
	noUser := dmMessage("", "D1", "no user")

	for name, ev := range map[string]*slackevents.MessageEvent{
		"bot_id": botMsg, "subtype": edited, "self": self, "no_user": noUser,
	} {
		if err := tr.handleEventsAPI(context.Background(), wrapCallback("message", ev), h); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if len(h.snapshot()) != 0 {
		t.Errorf("bot/edited/self messages should be dropped, got %+v", h.snapshot())
	}
}

func TestHandleEventsAPI_ChannelMessageWithoutMentionDropped(t *testing.T) {
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	h := &captureHandler{}

	msg := dmMessage("U1", "C1", "just chatting")
	msg.ChannelType = slackevents.ChannelTypeChannel
	_ = tr.handleEventsAPI(context.Background(), wrapCallback("message", msg), h)
	if len(h.snapshot()) != 0 {
		t.Error("channel messages without app_mention should be dropped")
	}
}

func TestHandleEventsAPI_AllowedUserFilter(t *testing.T) {
	tr := newTestTransport(t, Options{
		BotToken: "xoxb-1", AppToken: "xapp-1",
		AllowedUserIDs: []string{"UOK"},
	})
	h := &captureHandler{}

	_ = tr.handleEventsAPI(context.Background(), wrapCallback("message", dmMessage("UNOPE", "D1", "hi")), h)
	if len(h.snapshot()) != 0 {
		t.Error("disallowed user should be dropped")
	}
	_ = tr.handleEventsAPI(context.Background(), wrapCallback("message", dmMessage("UOK", "D1", "hi")), h)
	if len(h.snapshot()) != 1 {
		t.Error("allowed user should pass")
	}
}

func TestHandleEventsAPI_AppMention(t *testing.T) {
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	tr.botUserID = "UBOT"
	h := &captureHandler{}

	ev := wrapCallback("app_mention", &slackevents.AppMentionEvent{
		Type:      "app_mention",
		User:      "U1",
		Text:      "<@UBOT> deploy please",
		TimeStamp: "1700000001.000200",
		Channel:   "C1",
	})
	if err := tr.handleEventsAPI(context.Background(), ev, h); err != nil {
		t.Fatal(err)
	}
	got := h.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1 inbound, got %d", len(got))
	}
	if got[0].Text != "deploy please" {
		t.Errorf("mention should be stripped, got %q", got[0].Text)
	}
	if got[0].ChatID != "C1" || got[0].MessageID != "1700000001.000200" {
		t.Errorf("routing wrong: %+v", got[0])
	}
}

func TestHandleEventsAPI_AppMentionChannelFilter(t *testing.T) {
	tr := newTestTransport(t, Options{
		BotToken: "xoxb-1", AppToken: "xapp-1",
		AllowedChannelIDs: []string{"COK"},
	})
	tr.botUserID = "UBOT"
	h := &captureHandler{}

	mention := func(channel string) slackevents.EventsAPIEvent {
		return wrapCallback("app_mention", &slackevents.AppMentionEvent{
			User: "U1", Text: "<@UBOT> hi", TimeStamp: "1.2", Channel: channel,
		})
	}
	_ = tr.handleEventsAPI(context.Background(), mention("CNOPE"), h)
	if len(h.snapshot()) != 0 {
		t.Error("disallowed channel should be dropped")
	}
	_ = tr.handleEventsAPI(context.Background(), mention("COK"), h)
	if len(h.snapshot()) != 1 {
		t.Error("allowed channel should pass")
	}
}

func TestHandleEventsAPI_AppMentionInDMDeduplicated(t *testing.T) {
	// A mention inside a DM also fires a message event; the app_mention
	// copy must be dropped to avoid double delivery.
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	tr.botUserID = "UBOT"
	h := &captureHandler{}

	ev := wrapCallback("app_mention", &slackevents.AppMentionEvent{
		User: "U1", Text: "<@UBOT> hi", TimeStamp: "1.2", Channel: "D1",
	})
	_ = tr.handleEventsAPI(context.Background(), ev, h)
	if len(h.snapshot()) != 0 {
		t.Error("app_mention in a DM channel should be dropped")
	}
}

func TestHandleEventsAPI_NonCallbackIgnored(t *testing.T) {
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	h := &captureHandler{}
	ev := slackevents.EventsAPIEvent{Type: "url_verification"}
	if err := tr.handleEventsAPI(context.Background(), ev, h); err != nil {
		t.Fatal(err)
	}
	if len(h.snapshot()) != 0 {
		t.Error("non-callback events should be ignored")
	}
}

// =============================================================================
// interactive (block_actions)
// =============================================================================

func blockActionsCallback(user, channel, msgTS, actionID, value string) slackapi.InteractionCallback {
	cb := slackapi.InteractionCallback{
		Type: slackapi.InteractionTypeBlockActions,
		User: slackapi.User{ID: user},
		ActionCallback: slackapi.ActionCallbacks{
			BlockActions: []*slackapi.BlockAction{{ActionID: actionID, Value: value}},
		},
	}
	cb.Channel.ID = channel
	cb.Message.Timestamp = msgTS
	return cb
}

func TestHandleInteractive_BlockAction(t *testing.T) {
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	h := &captureHandler{}

	cb := blockActionsCallback("U1", "C1", "1700000002.000300", "vetta_btn_0_1", "no")
	if err := tr.handleInteractive(context.Background(), cb, h); err != nil {
		t.Fatal(err)
	}
	got := h.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1 inbound, got %d", len(got))
	}
	m := got[0]
	if m.ActionID != "vetta_btn_0_1" || m.Text != "no" {
		t.Errorf("action fields wrong: %+v", m)
	}
	if m.ChatID != "C1" || m.UserID != "U1" || m.MessageID != "1700000002.000300" {
		t.Errorf("routing fields wrong: %+v", m)
	}
}

func TestHandleInteractive_FallsBackToCallbackID(t *testing.T) {
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	h := &captureHandler{}

	cb := blockActionsCallback("U1", "C1", "1.2", "", "v")
	cb.CallbackID = "legacy_cb"
	_ = tr.handleInteractive(context.Background(), cb, h)
	got := h.snapshot()
	if len(got) != 1 || got[0].ActionID != "legacy_cb" {
		t.Fatalf("expected CallbackID fallback, got %+v", got)
	}
}

func TestHandleInteractive_NonBlockActionsIgnored(t *testing.T) {
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	h := &captureHandler{}

	cb := blockActionsCallback("U1", "C1", "1.2", "a", "v")
	cb.Type = slackapi.InteractionTypeViewSubmission
	_ = tr.handleInteractive(context.Background(), cb, h)
	if len(h.snapshot()) != 0 {
		t.Error("non-block_actions callbacks should be ignored")
	}
}

func TestHandleInteractive_UserFilter(t *testing.T) {
	tr := newTestTransport(t, Options{
		BotToken: "xoxb-1", AppToken: "xapp-1",
		AllowedUserIDs: []string{"UOK"},
	})
	h := &captureHandler{}
	_ = tr.handleInteractive(context.Background(), blockActionsCallback("UNOPE", "C1", "1.2", "a", "v"), h)
	if len(h.snapshot()) != 0 {
		t.Error("disallowed user's button press should be dropped")
	}
}

// =============================================================================
// inbound files
// =============================================================================

func TestForwardInbound_DownloadsAndPersistsFile(t *testing.T) {
	var gotAuth string
	fileSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte("file-bytes"))
	}))
	defer fileSrv.Close()

	dir := t.TempDir()
	tr := newTestTransport(t, Options{BotToken: "xoxb-secret", AppToken: "xapp-1", InboxDir: dir})
	h := &captureHandler{}

	msg := dmMessage("U1", "D1", "see attachment")
	msg.Message = &slackapi.Msg{Files: []slackapi.File{{
		Name:               "notes.txt",
		Mimetype:           "text/plain",
		URLPrivateDownload: fileSrv.URL + "/files/notes.txt",
	}}}
	if err := tr.handleEventsAPI(context.Background(), wrapCallback("message", msg), h); err != nil {
		t.Fatal(err)
	}

	if gotAuth != "Bearer xoxb-secret" {
		t.Errorf("download must use Bearer bot token, got %q", gotAuth)
	}
	got := h.snapshot()
	if len(got) != 1 || len(got[0].Attachments) != 1 {
		t.Fatalf("expected 1 message with 1 attachment, got %+v", got)
	}
	att := got[0].Attachments[0]
	if att.Kind != transport.AttachmentFile || att.MimeType != "text/plain" {
		t.Errorf("attachment meta wrong: %+v", att)
	}
	b, err := os.ReadFile(att.URL)
	if err != nil {
		t.Fatalf("persisted file unreadable: %v", err)
	}
	if string(b) != "file-bytes" {
		t.Errorf("persisted content wrong: %q", b)
	}
	if !strings.HasPrefix(att.URL, filepath.Join(dir, time.Now().Format("2006-01-02"))) {
		t.Errorf("file should land in the per-day inbox dir, got %q", att.URL)
	}
}

func TestForwardInbound_ImageKindFromMimetype(t *testing.T) {
	fileSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte{0x89, 'P', 'N', 'G', 0, 0, 0, 0})
	}))
	defer fileSrv.Close()

	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1", InboxDir: t.TempDir()})
	h := &captureHandler{}
	msg := dmMessage("U1", "D1", "")
	msg.Message = &slackapi.Msg{Files: []slackapi.File{{
		Name: "shot.png", Mimetype: "image/png", URLPrivateDownload: fileSrv.URL + "/shot.png",
	}}}
	_ = tr.handleEventsAPI(context.Background(), wrapCallback("message", msg), h)
	got := h.snapshot()
	if len(got) != 1 || len(got[0].Attachments) != 1 {
		t.Fatalf("expected image attachment, got %+v", got)
	}
	if got[0].Attachments[0].Kind != transport.AttachmentImage {
		t.Errorf("image mimetype should map to AttachmentImage, got %q", got[0].Attachments[0].Kind)
	}
}

func TestForwardInbound_NoInboxSendsHint(t *testing.T) {
	// File-only message with no inbox: dropped, user gets the hint via
	// chat.postMessage.
	var posted url.Values
	apiSrv := newWebAPIServer(t, map[string]func(url.Values) string{
		"/chat.postMessage": func(v url.Values) string {
			posted = v
			return `{"ok":true,"channel":"D1","ts":"1.1"}`
		},
	})
	defer apiSrv.Close()

	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	tr.api = slackapi.New("xoxb-1", slackapi.OptionAPIURL(apiSrv.URL+"/"))
	h := &captureHandler{}

	msg := dmMessage("U1", "D1", "")
	msg.Message = &slackapi.Msg{Files: []slackapi.File{{Name: "a.bin", URLPrivateDownload: "https://example.invalid/a"}}}
	if err := tr.handleEventsAPI(context.Background(), wrapCallback("message", msg), h); err != nil {
		t.Fatal(err)
	}
	if len(h.snapshot()) != 0 {
		t.Error("file-only message without inbox should not reach the handler")
	}
	if posted == nil || posted.Get("text") != inboundMediaHint {
		t.Errorf("hint should be posted, got %v", posted)
	}
}

// =============================================================================
// outbound Web API calls (httptest against slack.OptionAPIURL)
// =============================================================================

// newWebAPIServer serves canned JSON per Web API path and lets the test
// capture the posted form values.
func newWebAPIServer(t *testing.T, routes map[string]func(url.Values) string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse form: %v", err)
		}
		handler, ok := routes[r.URL.Path]
		if !ok {
			t.Errorf("unexpected Web API call: %s", r.URL.Path)
			_, _ = w.Write([]byte(`{"ok":false,"error":"unexpected_call"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(handler(r.PostForm)))
	}))
}

func newAPITransport(t *testing.T, routes map[string]func(url.Values) string) (*Transport, *httptest.Server) {
	t.Helper()
	srv := newWebAPIServer(t, routes)
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	tr.api = slackapi.New("xoxb-1", slackapi.OptionAPIURL(srv.URL+"/"))
	return tr, srv
}

func TestSendMessage_PostsMrkdwnAndThread(t *testing.T) {
	var posted url.Values
	tr, srv := newAPITransport(t, map[string]func(url.Values) string{
		"/chat.postMessage": func(v url.Values) string {
			posted = v
			return `{"ok":true,"channel":"C1","ts":"1700000003.000400"}`
		},
	})
	defer srv.Close()

	ts, err := tr.SendMessage(context.Background(), "C1", transport.OutboundMessage{
		Text:      "**done** see [log](https://x.io/l)",
		ReplyToID: "1699999998.000009",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ts != "1700000003.000400" {
		t.Errorf("returned ts wrong: %q", ts)
	}
	if posted.Get("channel") != "C1" {
		t.Errorf("channel: %q", posted.Get("channel"))
	}
	if posted.Get("text") != "*done* see <https://x.io/l|log>" {
		t.Errorf("text should be mrkdwn-converted: %q", posted.Get("text"))
	}
	if posted.Get("thread_ts") != "1699999998.000009" {
		t.Errorf("ReplyToID should map to thread_ts: %q", posted.Get("thread_ts"))
	}
}

func TestSendMessage_ButtonsBecomeBlocks(t *testing.T) {
	var posted url.Values
	tr, srv := newAPITransport(t, map[string]func(url.Values) string{
		"/chat.postMessage": func(v url.Values) string {
			posted = v
			return `{"ok":true,"channel":"C1","ts":"1.2"}`
		},
	})
	defer srv.Close()

	_, err := tr.SendMessage(context.Background(), "C1", transport.OutboundMessage{
		Text:    "choose",
		Buttons: [][]transport.Button{{{Text: "Go", Value: "go"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	var blocks []struct {
		Type     string `json:"type"`
		Elements []struct {
			Type     string `json:"type"`
			ActionID string `json:"action_id"`
			Value    string `json:"value"`
			Text     struct {
				Text string `json:"text"`
			} `json:"text"`
		} `json:"elements"`
		Text *struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"text"`
	}
	if err := json.Unmarshal([]byte(posted.Get("blocks")), &blocks); err != nil {
		t.Fatalf("blocks not valid JSON: %v (%q)", err, posted.Get("blocks"))
	}
	if len(blocks) != 2 || blocks[0].Type != "section" || blocks[1].Type != "actions" {
		t.Fatalf("expected [section, actions], got %+v", blocks)
	}
	if blocks[0].Text == nil || blocks[0].Text.Text != "choose" || blocks[0].Text.Type != "mrkdwn" {
		t.Errorf("section text wrong: %+v", blocks[0].Text)
	}
	el := blocks[1].Elements[0]
	if el.Type != "button" || el.ActionID != "vetta_btn_0_0" || el.Value != "go" || el.Text.Text != "Go" {
		t.Errorf("button element wrong: %+v", el)
	}
}

func TestEditMessage_UsesChatUpdate(t *testing.T) {
	var posted url.Values
	tr, srv := newAPITransport(t, map[string]func(url.Values) string{
		"/chat.update": func(v url.Values) string {
			posted = v
			return `{"ok":true,"channel":"C1","ts":"1.2","text":"x"}`
		},
	})
	defer srv.Close()

	err := tr.EditMessage(context.Background(), "C1", "1700000000.000100", transport.OutboundMessage{Text: "**new**"})
	if err != nil {
		t.Fatal(err)
	}
	if posted.Get("channel") != "C1" || posted.Get("ts") != "1700000000.000100" {
		t.Errorf("chat.update addressing wrong: %v", posted)
	}
	if posted.Get("text") != "*new*" {
		t.Errorf("text: %q", posted.Get("text"))
	}
}

func TestDeleteMessage(t *testing.T) {
	var posted url.Values
	tr, srv := newAPITransport(t, map[string]func(url.Values) string{
		"/chat.delete": func(v url.Values) string {
			posted = v
			return `{"ok":true,"channel":"C1","ts":"1.2"}`
		},
	})
	defer srv.Close()

	if err := tr.DeleteMessage(context.Background(), "C1", "1.2"); err != nil {
		t.Fatal(err)
	}
	if posted.Get("channel") != "C1" || posted.Get("ts") != "1.2" {
		t.Errorf("chat.delete addressing wrong: %v", posted)
	}
}

func TestAddReaction_TranslatesEmoji(t *testing.T) {
	var posted url.Values
	tr, srv := newAPITransport(t, map[string]func(url.Values) string{
		"/reactions.add": func(v url.Values) string {
			posted = v
			return `{"ok":true}`
		},
	})
	defer srv.Close()

	if err := tr.AddReaction(context.Background(), "C1", "1.2", "👀"); err != nil {
		t.Fatal(err)
	}
	if posted.Get("name") != "eyes" {
		t.Errorf("emoji should translate to Slack name, got %q", posted.Get("name"))
	}
	if posted.Get("channel") != "C1" || posted.Get("timestamp") != "1.2" {
		t.Errorf("reaction addressing wrong: %v", posted)
	}
}

func TestAddReaction_UnsupportedEmoji(t *testing.T) {
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	err := tr.AddReaction(context.Background(), "C1", "1.2", "🦄")
	if err == nil || !strings.Contains(err.Error(), "unsupported emoji") {
		t.Errorf("expected unsupported emoji error, got %v", err)
	}
}

func TestRemoveReaction_NotPresentIsNoop(t *testing.T) {
	tr, srv := newAPITransport(t, map[string]func(url.Values) string{
		"/reactions.remove": func(url.Values) string {
			return `{"ok":false,"error":"no_reaction"}`
		},
	})
	defer srv.Close()

	if err := tr.RemoveReaction(context.Background(), "C1", "1.2", "✅"); err != nil {
		t.Errorf("removing an absent reaction should be a no-op, got %v", err)
	}
}

func TestEndStreamAndShowTyping_AreNoops(t *testing.T) {
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	if err := tr.EndStream(context.Background(), "C1", "1.2"); err != nil {
		t.Errorf("EndStream: %v", err)
	}
	if err := tr.ShowTyping(context.Background(), "C1"); err != nil {
		t.Errorf("ShowTyping: %v", err)
	}
}

func TestSendAttachment_RequiresPath(t *testing.T) {
	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	if _, err := tr.SendAttachment(context.Background(), "C1", transport.OutboundAttachment{}); err == nil {
		t.Error("empty path should error")
	}
	if _, err := tr.SendAttachment(context.Background(), "", transport.OutboundAttachment{Path: "/x"}); err == nil {
		t.Error("empty chatID should error")
	}
}

func TestSendAttachment_UploadFlow(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "report.txt")
	if err := os.WriteFile(path, []byte("hello upload"), 0o644); err != nil {
		t.Fatal(err)
	}

	var (
		getURLValues   url.Values
		completeValues url.Values
		uploadedBody   bool
	)
	// The upload URL host must be this same server, so register the routes
	// after creating it.
	var srv *httptest.Server
	mux := http.NewServeMux()
	mux.HandleFunc("/files.getUploadURLExternal", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		getURLValues = r.Form
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"upload_url":"` + srv.URL + `/upload-here","file_id":"F123"}`))
	})
	mux.HandleFunc("/upload-here", func(w http.ResponseWriter, _ *http.Request) {
		uploadedBody = true
		_, _ = w.Write([]byte("OK"))
	})
	mux.HandleFunc("/files.completeUploadExternal", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		completeValues = r.Form
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"files":[{"id":"F123","title":"report.txt"}]}`))
	})
	srv = httptest.NewServer(mux)
	defer srv.Close()

	tr := newTestTransport(t, Options{BotToken: "xoxb-1", AppToken: "xapp-1"})
	tr.api = slackapi.New("xoxb-1", slackapi.OptionAPIURL(srv.URL+"/"))

	id, err := tr.SendAttachment(context.Background(), "C1", transport.OutboundAttachment{
		Kind: transport.AttachmentFile, Path: path, Caption: "weekly report",
	})
	if err != nil {
		t.Fatal(err)
	}
	if id != "F123" {
		t.Errorf("returned id: %q", id)
	}
	if getURLValues.Get("filename") != "report.txt" || getURLValues.Get("length") != "12" {
		t.Errorf("getUploadURLExternal params wrong: %v", getURLValues)
	}
	if !uploadedBody {
		t.Error("file bytes were never posted to the upload URL")
	}
	if completeValues.Get("channel_id") != "C1" {
		t.Errorf("completeUploadExternal channel wrong: %v", completeValues)
	}
	if completeValues.Get("initial_comment") != "weekly report" {
		t.Errorf("caption should map to initial_comment: %v", completeValues)
	}
}

// =============================================================================
// Integration test (gated)
// =============================================================================
//
// Set SLACK_INTEGRATION_TEST=1 plus IM_GATEWAY_SLACK_BOT_TOKEN /
// IM_GATEWAY_SLACK_APP_TOKEN in env to run a real connect cycle. The test
// creates a Transport, briefly Start()s it, and immediately Stop()s. It does
// not send any messages.
func TestSlack_Integration_ConnectAndStop(t *testing.T) {
	if os.Getenv("SLACK_INTEGRATION_TEST") != "1" {
		t.Skip("set SLACK_INTEGRATION_TEST=1 to run")
	}
	botToken := os.Getenv("IM_GATEWAY_SLACK_BOT_TOKEN")
	appToken := os.Getenv("IM_GATEWAY_SLACK_APP_TOKEN")
	if botToken == "" || appToken == "" {
		t.Skip("integration test requires SLACK bot + app token env vars")
	}

	tr, err := New(Options{BotToken: botToken, AppToken: appToken})
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

	time.Sleep(3 * time.Second)
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
