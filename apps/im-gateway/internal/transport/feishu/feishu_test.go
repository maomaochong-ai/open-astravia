package feishu

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"

	"vetta-im-gateway/internal/transport"
)

func TestNew_RequiresCredentials(t *testing.T) {
	if _, err := New(Options{}); err == nil {
		t.Error("expected error for missing credentials")
	}
	if _, err := New(Options{AppID: "x"}); err == nil {
		t.Error("expected error for missing AppSecret")
	}
}

func TestCapabilities(t *testing.T) {
	tr, err := New(Options{AppID: "x", AppSecret: "y"})
	if err != nil {
		t.Fatal(err)
	}
	caps := tr.Capabilities()
	// Streaming responses use the cardkit content-update API which is
	// purpose-built for incremental edits. See the package doc.
	if !caps.SupportsMessageEdit {
		t.Error("Feishu should advertise SupportsMessageEdit=true (cardkit streaming path)")
	}
	if caps.MaxMessageLength <= 0 {
		t.Error("MaxMessageLength should be positive")
	}
}

func TestEncodeStreamingCardJSON_NoInlineStreamingMode(t *testing.T) {
	got, err := encodeStreamingCardJSON("hello")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Schema string `json:"schema"`
		Config map[string]any `json:"config"`
		Body   struct {
			Elements []struct {
				Tag       string `json:"tag"`
				ElementID string `json:"element_id"`
				Content   string `json:"content"`
			} `json:"elements"`
		} `json:"body"`
	}
	if err := json.Unmarshal([]byte(got), &v); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}
	if v.Schema != "2.0" {
		t.Errorf("schema: %q", v.Schema)
	}
	// streaming_mode is enabled via a separate Card.Settings call, NOT
	// inline in Card.Create — see sendStreamingMessage. Putting it inline
	// has no effect on the server side and was the cause of the
	// "blank card" bug.
	if _, present := v.Config["streaming_mode"]; present {
		t.Errorf("streaming_mode should NOT be set inline at create time, got %+v", v.Config)
	}
	if len(v.Body.Elements) != 1 {
		t.Fatalf("expected 1 element, got %d", len(v.Body.Elements))
	}
	if v.Body.Elements[0].Tag != "markdown" {
		t.Errorf("tag: %q", v.Body.Elements[0].Tag)
	}
	if v.Body.Elements[0].ElementID != streamElementID {
		t.Errorf("element_id: %q want %q", v.Body.Elements[0].ElementID, streamElementID)
	}
	if v.Body.Elements[0].Content != "hello" {
		t.Errorf("content: %q", v.Body.Elements[0].Content)
	}
}

func TestEncodeStreamingCardJSON_EmptyInitialBecomesSpace(t *testing.T) {
	got, err := encodeStreamingCardJSON("")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Body struct {
			Elements []struct {
				Content string `json:"content"`
			} `json:"elements"`
		} `json:"body"`
	}
	if err := json.Unmarshal([]byte(got), &v); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}
	if v.Body.Elements[0].Content != " " {
		t.Errorf("empty initial should be substituted with a space, got %q", v.Body.Elements[0].Content)
	}
}

func TestEncodeStreamingEnabledSettings(t *testing.T) {
	got, err := encodeStreamingEnabledSettings()
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Config struct {
			StreamingMode bool `json:"streaming_mode"`
		} `json:"config"`
	}
	if err := json.Unmarshal([]byte(got), &v); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}
	if !v.Config.StreamingMode {
		t.Error("streaming_mode should be true in the enable-settings payload")
	}
}

func TestEncodeCardReferenceContent(t *testing.T) {
	got, err := encodeCardReferenceContent("card-123")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Type string `json:"type"`
		Data struct {
			CardID string `json:"card_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(got), &v); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}
	if v.Type != "card" || v.Data.CardID != "card-123" {
		t.Errorf("got %+v", v)
	}
}

func TestStreamRegistry_RegisterLookupUnregister(t *testing.T) {
	tr, _ := New(Options{AppID: "x", AppSecret: "y"})
	tr.registerStream("m1", "card-A")
	tr.registerStream("m2", "card-B")
	if h := tr.lookupStream("m1"); h == nil || h.cardID != "card-A" {
		t.Errorf("lookup m1: %+v", h)
	}
	if h := tr.lookupStream("m2"); h == nil || h.cardID != "card-B" {
		t.Errorf("lookup m2: %+v", h)
	}
	if h := tr.unregisterStream("m1"); h == nil || h.cardID != "card-A" {
		t.Errorf("unregister m1: %+v", h)
	}
	if h := tr.lookupStream("m1"); h != nil {
		t.Errorf("m1 should be gone after unregister")
	}
	if h := tr.unregisterStream("missing"); h != nil {
		t.Errorf("unregister missing should return nil, got %+v", h)
	}
}

func TestStreamRegistry_FIFOEviction(t *testing.T) {
	tr, _ := New(Options{AppID: "x", AppSecret: "y"})
	for i := range streamRegistryCap + 5 {
		tr.registerStream(fmt.Sprintf("m%d", i), fmt.Sprintf("card-%d", i))
	}
	if len(tr.streams) != streamRegistryCap {
		t.Errorf("expected len=%d, got %d", streamRegistryCap, len(tr.streams))
	}
	// First 5 should have been evicted.
	for i := range 5 {
		if tr.lookupStream(fmt.Sprintf("m%d", i)) != nil {
			t.Errorf("m%d should have been evicted", i)
		}
	}
	// The newest should still be there.
	if tr.lookupStream(fmt.Sprintf("m%d", streamRegistryCap+4)) == nil {
		t.Error("newest entry should still be present")
	}
}

func TestStreamRegistry_NextSequenceMonotonic(t *testing.T) {
	tr, _ := New(Options{AppID: "x", AppSecret: "y"})
	tr.registerStream("m1", "card-A")
	h := tr.lookupStream("m1")
	var prev int32
	for i := range 1000 {
		seq := tr.nextSequence(h)
		if seq <= prev {
			t.Fatalf("sequence not monotonic at i=%d: prev=%d cur=%d", i, prev, seq)
		}
		prev = seq
	}
	// First call should yield 1, the 1000th call yields 1000.
	if prev != 1000 {
		t.Errorf("expected last seq=1000, got %d", prev)
	}
}

func TestEncodeMarkdownCard_RoundTrip(t *testing.T) {
	cases := []string{
		"hello",
		`with "quotes" inside`,
		"line1\nline2",
		"中文测试",
		"emoji 🚀 emoji",
		"# Heading\n\n- item 1\n- item 2\n\n```go\nfmt.Println(\"hi\")\n```",
	}
	for _, in := range cases {
		got, err := encodeMarkdownCard(in)
		if err != nil {
			t.Fatalf("encode %q: %v", in, err)
		}
		var v struct {
			Schema string `json:"schema"`
			Body   struct {
				Elements []struct {
					Tag     string `json:"tag"`
					Content string `json:"content"`
				} `json:"elements"`
			} `json:"body"`
		}
		if err := json.Unmarshal([]byte(got), &v); err != nil {
			t.Errorf("encoded %q is not valid JSON: %v", in, err)
			continue
		}
		if v.Schema != "2.0" {
			t.Errorf("schema: got %q, want %q", v.Schema, "2.0")
		}
		if len(v.Body.Elements) != 1 {
			t.Fatalf("expected 1 element, got %d", len(v.Body.Elements))
		}
		if v.Body.Elements[0].Tag != "markdown" {
			t.Errorf("element tag: got %q, want %q", v.Body.Elements[0].Tag, "markdown")
		}
		if v.Body.Elements[0].Content != in {
			t.Errorf("round-trip mismatch: in=%q out=%q", in, v.Body.Elements[0].Content)
		}
	}
}

func TestExtractText_HappyPath(t *testing.T) {
	got := extractText(`{"text":"hello world"}`)
	if got != "hello world" {
		t.Errorf("got %q", got)
	}
}

func TestExtractText_NotJSON(t *testing.T) {
	if got := extractText("not json"); got != "" {
		t.Errorf("expected empty string for invalid content, got %q", got)
	}
}

func TestExtractText_Empty(t *testing.T) {
	if got := extractText(""); got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

func TestStripBotMentions_RemovesKeyTokens(t *testing.T) {
	key := "@_user_1"
	mentions := []*larkim.MentionEvent{
		{Key: &key},
	}
	got := stripBotMentions("@_user_1 hello agent", mentions)
	if got != "hello agent" {
		t.Errorf("got %q", got)
	}
}

func TestStripBotMentions_NoMentions(t *testing.T) {
	got := stripBotMentions("  hello agent  ", nil)
	if got != "hello agent" {
		t.Errorf("got %q", got)
	}
}

// captureHandler records inbound messages from handleInbound for assertions.
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

// makeP2 builds a minimal P2MessageReceiveV1 for handleInbound tests.
func makeP2(chatType, msgType, content, openID, chatID string) *larkim.P2MessageReceiveV1 {
	return &larkim.P2MessageReceiveV1{
		Event: &larkim.P2MessageReceiveV1Data{
			Sender: &larkim.EventSender{
				SenderId: &larkim.UserId{OpenId: ptr(openID)},
			},
			Message: &larkim.EventMessage{
				MessageId:   ptr("om_test"),
				ChatId:      ptr(chatID),
				ChatType:    ptr(chatType),
				MessageType: ptr(msgType),
				Content:     ptr(content),
			},
		},
	}
}

func ptr(s string) *string { return &s }

func TestHandleInbound_PrivateText(t *testing.T) {
	tr, _ := New(Options{AppID: "x", AppSecret: "y"})
	h := &captureHandler{}

	ev := makeP2("p2p", "text", `{"text":"hello"}`, "ou_user_1", "oc_chat_1")
	if err := tr.handleInbound(context.Background(), ev, h); err != nil {
		t.Fatal(err)
	}

	got := h.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1 inbound, got %d", len(got))
	}
	m := got[0]
	if m.Platform != "feishu" {
		t.Errorf("Platform: %q", m.Platform)
	}
	if m.UserID != "ou_user_1" || m.ChatID != "oc_chat_1" {
		t.Errorf("user/chat wrong: %+v", m)
	}
	if m.Text != "hello" {
		t.Errorf("Text: %q", m.Text)
	}
}

func TestHandleInbound_GroupDropped(t *testing.T) {
	tr, _ := New(Options{AppID: "x", AppSecret: "y"})
	h := &captureHandler{}

	ev := makeP2("group", "text", `{"text":"hello group"}`, "ou_user_1", "oc_group_1")
	_ = tr.handleInbound(context.Background(), ev, h)
	if len(h.snapshot()) != 0 {
		t.Error("group messages should be silently dropped (Non-Goal)")
	}
}

func TestHandleInbound_UnsupportedTypeDropped(t *testing.T) {
	// Still-unsupported types (audio / video / merge_forward / sticker)
	// trigger a hint reply (which would call SendMessage against the Feishu
	// API — silent failure in tests) and never reach the handler.
	tr, _ := New(Options{AppID: "x", AppSecret: "y"})
	h := &captureHandler{}

	ev := makeP2("p2p", "audio", `{"file_key":"f1"}`, "ou_user_1", "oc_chat_1")
	_ = tr.handleInbound(context.Background(), ev, h)
	if len(h.snapshot()) != 0 {
		t.Error("unsupported types should not reach the handler")
	}
}

func TestHandleInbound_ImageWithoutInboxDropped(t *testing.T) {
	// With no InboxDir configured the transport cannot persist media, so an
	// image message yields no attachment and (having no text) is dropped
	// without any network call.
	tr, _ := New(Options{AppID: "x", AppSecret: "y"})
	h := &captureHandler{}

	ev := makeP2("p2p", "image", `{"image_key":"img1"}`, "ou_user_1", "oc_chat_1")
	_ = tr.handleInbound(context.Background(), ev, h)
	if len(h.snapshot()) != 0 {
		t.Error("image with no inbox configured should be dropped")
	}
}

func TestHandleInbound_PostTextOnly(t *testing.T) {
	// A post with only text runs (no embedded images) needs no download and
	// reaches the handler with the flattened text — even without an inbox.
	tr, _ := New(Options{AppID: "x", AppSecret: "y"})
	h := &captureHandler{}

	content := `{"title":"标题","content":[[{"tag":"text","text":"hello "},{"tag":"a","text":"链接","href":"https://x.io"}]]}`
	ev := makeP2("p2p", "post", content, "ou_user_1", "oc_chat_1")
	if err := tr.handleInbound(context.Background(), ev, h); err != nil {
		t.Fatal(err)
	}
	got := h.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1 inbound, got %d", len(got))
	}
	if got[0].Text != "标题\nhello 链接(https://x.io)" {
		t.Errorf("post text flatten: %q", got[0].Text)
	}
}

func TestExtractImageKey(t *testing.T) {
	if got := extractImageKey(`{"image_key":"img_v2_abc"}`); got != "img_v2_abc" {
		t.Errorf("got %q", got)
	}
	if got := extractImageKey("not json"); got != "" {
		t.Errorf("invalid content should yield empty, got %q", got)
	}
}

func TestExtractFileKey(t *testing.T) {
	key, name := extractFileKey(`{"file_key":"file_v2_x","file_name":"report.pdf"}`)
	if key != "file_v2_x" || name != "report.pdf" {
		t.Errorf("got key=%q name=%q", key, name)
	}
}

func TestExtractPost(t *testing.T) {
	content := `{"title":"T","content":[` +
		`[{"tag":"text","text":"line1 "},{"tag":"at","user_name":"bob"},{"tag":"img","image_key":"img_a"}],` +
		`[{"tag":"img","image_key":"img_b"},{"tag":"text","text":"end"}]]}`
	text, keys := extractPost(content)
	want := "T\nline1 @bob\nend"
	if text != want {
		t.Errorf("text: got %q want %q", text, want)
	}
	if len(keys) != 2 || keys[0] != "img_a" || keys[1] != "img_b" {
		t.Errorf("image keys: %v", keys)
	}
}

func TestFeishuFileType(t *testing.T) {
	cases := map[string]string{
		"a.pdf":  "pdf",
		"a.DOCX": "doc",
		"a.xlsx": "xls",
		"a.ppt":  "ppt",
		"a.mp4":  "mp4",
		"a.opus": "opus",
		"a.zip":  "stream",
		"noext":  "stream",
	}
	for name, want := range cases {
		if got := feishuFileType(name); got != want {
			t.Errorf("feishuFileType(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestHandleInbound_MissingFields(t *testing.T) {
	tr, _ := New(Options{AppID: "x", AppSecret: "y"})
	h := &captureHandler{}

	if err := tr.handleInbound(context.Background(), nil, h); err != nil {
		t.Errorf("nil event should be a noop, got error: %v", err)
	}
	if len(h.snapshot()) != 0 {
		t.Error("nil event should not invoke handler")
	}
}

func TestHandleInbound_StripsBotMention(t *testing.T) {
	tr, _ := New(Options{AppID: "x", AppSecret: "y"})
	h := &captureHandler{}

	ev := makeP2("p2p", "text", `{"text":"@_user_1 hello agent"}`, "ou_user_1", "oc_chat_1")
	key := "@_user_1"
	ev.Event.Message.Mentions = []*larkim.MentionEvent{{Key: &key}}

	_ = tr.handleInbound(context.Background(), ev, h)
	got := h.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1, got %d", len(got))
	}
	if got[0].Text != "hello agent" {
		t.Errorf("mention not stripped: %q", got[0].Text)
	}
}

// =============================================================================
// Integration test (gated)
// =============================================================================
//
// Set FEISHU_INTEGRATION_TEST=1 plus IM_GATEWAY_FEISHU_APP_ID /
// IM_GATEWAY_FEISHU_APP_SECRET in env to run a real connect cycle. The
// test creates a Transport, briefly Start()s it, and immediately Stop()s.
// It does not send any messages.
func TestFeishu_Integration_ConnectAndStop(t *testing.T) {
	if os.Getenv("FEISHU_INTEGRATION_TEST") != "1" {
		t.Skip("set FEISHU_INTEGRATION_TEST=1 to run")
	}
	appID := os.Getenv("IM_GATEWAY_FEISHU_APP_ID")
	appSecret := os.Getenv("IM_GATEWAY_FEISHU_APP_SECRET")
	if appID == "" || appSecret == "" {
		t.Skip("integration test requires FEISHU app id + secret env vars")
	}

	tr, err := New(Options{AppID: appID, AppSecret: appSecret})
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

	// Brief connect window
	time.Sleep(2 * time.Second)
	_ = tr.Stop()
	cancel()

	select {
	case err := <-done:
		if err != nil && !strings.Contains(err.Error(), "context canceled") {
			t.Errorf("Start returned: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Error("Start did not return after Stop+cancel")
	}
}
