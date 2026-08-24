package discord

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"

	"vetta-im-gateway/internal/transport"
)

func TestNew_RequiresToken(t *testing.T) {
	if _, err := New(Options{}); err == nil {
		t.Error("expected error for missing BotToken")
	}
}

func TestCapabilities(t *testing.T) {
	tr := newTestTransport(t, Options{BotToken: "x"})
	caps := tr.Capabilities()
	if !caps.SupportsMessageEdit || !caps.SupportsButtons || !caps.SupportsFileUpload ||
		!caps.SupportsThreads || !caps.SupportsReactions {
		t.Errorf("capability flags wrong: %+v", caps)
	}
	if caps.SupportsCards {
		t.Error("Discord should not advertise SupportsCards")
	}
	if caps.MaxMessageLength != 2000 {
		t.Errorf("MaxMessageLength: %d", caps.MaxMessageLength)
	}
}

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
	if opts.BotToken == "" {
		opts.BotToken = "test-token"
	}
	tr, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	tr.setBotUserID("bot-1")
	// Neutralize the network-touching seams; individual tests override.
	tr.ack = func(*discordgo.Interaction) error { return nil }
	tr.notify = func(context.Context, string, string) {}
	return tr
}

// makeMessage builds a minimal MessageCreate. guildID=="" means DM.
func makeMessage(guildID, channelID, userID, content string) *discordgo.MessageCreate {
	return &discordgo.MessageCreate{
		Message: &discordgo.Message{
			ID:        "msg-1",
			ChannelID: channelID,
			GuildID:   guildID,
			Content:   content,
			Author:    &discordgo.User{ID: userID},
		},
	}
}

func TestHandleMessageCreate_DMDelivered(t *testing.T) {
	tr := newTestTransport(t, Options{})
	h := &captureHandler{}

	tr.handleMessageCreate(context.Background(), makeMessage("", "ch-1", "u-1", "hello"), h)

	got := h.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1 inbound, got %d", len(got))
	}
	m := got[0]
	if m.Platform != "discord" || m.ChatID != "ch-1" || m.UserID != "u-1" || m.MessageID != "msg-1" {
		t.Errorf("fields wrong: %+v", m)
	}
	if m.Text != "hello" {
		t.Errorf("Text: %q", m.Text)
	}
	if m.ActionID != "" {
		t.Errorf("ActionID should be empty for a plain message, got %q", m.ActionID)
	}
}

func TestHandleMessageCreate_BotAndSelfIgnored(t *testing.T) {
	tr := newTestTransport(t, Options{})
	h := &captureHandler{}

	bot := makeMessage("", "ch-1", "u-2", "from a bot")
	bot.Author.Bot = true
	tr.handleMessageCreate(context.Background(), bot, h)

	self := makeMessage("", "ch-1", "bot-1", "from ourselves")
	tr.handleMessageCreate(context.Background(), self, h)

	webhook := makeMessage("", "ch-1", "u-3", "from a webhook")
	webhook.WebhookID = "wh-1"
	tr.handleMessageCreate(context.Background(), webhook, h)

	if len(h.snapshot()) != 0 {
		t.Error("bot / self / webhook messages must be ignored")
	}
}

func TestHandleMessageCreate_GuildRequiresMention(t *testing.T) {
	tr := newTestTransport(t, Options{})
	h := &captureHandler{}

	// No mention: dropped.
	tr.handleMessageCreate(context.Background(), makeMessage("g-1", "ch-1", "u-1", "hi all"), h)
	if len(h.snapshot()) != 0 {
		t.Fatal("guild message without @bot mention must be dropped")
	}

	// Mentioned: delivered with the mention token stripped.
	m := makeMessage("g-1", "ch-1", "u-1", "<@bot-1> do the thing")
	m.Mentions = []*discordgo.User{{ID: "bot-1"}}
	tr.handleMessageCreate(context.Background(), m, h)

	got := h.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1 inbound, got %d", len(got))
	}
	if got[0].Text != "do the thing" {
		t.Errorf("mention not stripped: %q", got[0].Text)
	}
}

func TestHandleMessageCreate_NicknameMentionStripped(t *testing.T) {
	tr := newTestTransport(t, Options{})
	h := &captureHandler{}

	m := makeMessage("g-1", "ch-1", "u-1", "<@!bot-1> hello")
	m.Mentions = []*discordgo.User{{ID: "bot-1"}}
	tr.handleMessageCreate(context.Background(), m, h)

	got := h.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1 inbound, got %d", len(got))
	}
	if got[0].Text != "hello" {
		t.Errorf("nickname mention not stripped: %q", got[0].Text)
	}
}

func TestHandleMessageCreate_UserAllowlist(t *testing.T) {
	tr := newTestTransport(t, Options{AllowedUserIDs: []string{"u-ok"}})
	h := &captureHandler{}

	tr.handleMessageCreate(context.Background(), makeMessage("", "ch-1", "u-blocked", "hi"), h)
	if len(h.snapshot()) != 0 {
		t.Fatal("DM from a user outside the allowlist must be dropped")
	}

	tr.handleMessageCreate(context.Background(), makeMessage("", "ch-1", "u-ok", "hi"), h)
	if len(h.snapshot()) != 1 {
		t.Error("DM from an allowlisted user must be delivered")
	}
}

func TestHandleMessageCreate_GuildAllowlist(t *testing.T) {
	tr := newTestTransport(t, Options{AllowedGuildIDs: []string{"g-ok"}})
	h := &captureHandler{}

	m := makeMessage("g-blocked", "ch-1", "u-1", "<@bot-1> hi")
	m.Mentions = []*discordgo.User{{ID: "bot-1"}}
	tr.handleMessageCreate(context.Background(), m, h)
	if len(h.snapshot()) != 0 {
		t.Fatal("message from a guild outside the allowlist must be dropped")
	}

	m = makeMessage("g-ok", "ch-1", "u-1", "<@bot-1> hi")
	m.Mentions = []*discordgo.User{{ID: "bot-1"}}
	tr.handleMessageCreate(context.Background(), m, h)
	if len(h.snapshot()) != 1 {
		t.Error("message from an allowlisted guild must be delivered")
	}
}

func TestHandleMessageCreate_ReplyToID(t *testing.T) {
	tr := newTestTransport(t, Options{})
	h := &captureHandler{}

	m := makeMessage("", "ch-1", "u-1", "replying")
	m.MessageReference = &discordgo.MessageReference{MessageID: "orig-1"}
	tr.handleMessageCreate(context.Background(), m, h)

	got := h.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1 inbound, got %d", len(got))
	}
	if got[0].ReplyToID != "orig-1" {
		t.Errorf("ReplyToID: %q", got[0].ReplyToID)
	}
}

func TestHandleMessageCreate_AttachmentPersisted(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("file-bytes"))
	}))
	defer srv.Close()

	dir := t.TempDir()
	tr := newTestTransport(t, Options{InboxDir: dir})
	h := &captureHandler{}

	m := makeMessage("", "ch-1", "u-1", "see attached")
	m.Attachments = []*discordgo.MessageAttachment{
		{URL: srv.URL + "/pic.png", Filename: "pic.png", ContentType: "image/png"},
		{URL: srv.URL + "/doc.pdf", Filename: "doc.pdf", ContentType: "application/pdf"},
	}
	tr.handleMessageCreate(context.Background(), m, h)

	got := h.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1 inbound, got %d", len(got))
	}
	atts := got[0].Attachments
	if len(atts) != 2 {
		t.Fatalf("expected 2 attachments, got %d", len(atts))
	}
	if atts[0].Kind != transport.AttachmentImage {
		t.Errorf("first attachment kind: %q", atts[0].Kind)
	}
	if atts[1].Kind != transport.AttachmentFile {
		t.Errorf("second attachment kind: %q", atts[1].Kind)
	}
	for _, a := range atts {
		b, err := os.ReadFile(a.URL)
		if err != nil {
			t.Fatalf("attachment not persisted: %v", err)
		}
		if string(b) != "file-bytes" {
			t.Errorf("persisted bytes wrong: %q", b)
		}
	}
}

func TestHandleMessageCreate_AttachmentWithoutInboxHints(t *testing.T) {
	tr := newTestTransport(t, Options{})
	h := &captureHandler{}

	var hints []string
	tr.notify = func(_ context.Context, chatID, text string) {
		hints = append(hints, chatID+"|"+text)
	}

	m := makeMessage("", "ch-1", "u-1", "")
	m.Attachments = []*discordgo.MessageAttachment{{URL: "https://cdn.example/x.png", Filename: "x.png"}}
	tr.handleMessageCreate(context.Background(), m, h)

	if len(h.snapshot()) != 0 {
		t.Error("attachment-only message without inbox must be dropped")
	}
	if len(hints) != 1 || !strings.HasPrefix(hints[0], "ch-1|") {
		t.Errorf("expected one hint to ch-1, got %v", hints)
	}
}

// makeButtonInteraction builds a component-press InteractionCreate.
// guildID=="" simulates a DM press (User set instead of Member).
func makeButtonInteraction(guildID, channelID, userID, customID string) *discordgo.InteractionCreate {
	i := &discordgo.Interaction{
		ID:        "int-1",
		Type:      discordgo.InteractionMessageComponent,
		GuildID:   guildID,
		ChannelID: channelID,
		Data:      discordgo.MessageComponentInteractionData{CustomID: customID},
		Message:   &discordgo.Message{ID: "msg-btn"},
	}
	if guildID == "" {
		i.User = &discordgo.User{ID: userID}
	} else {
		i.Member = &discordgo.Member{User: &discordgo.User{ID: userID}}
	}
	return &discordgo.InteractionCreate{Interaction: i}
}

func TestHandleInteraction_ButtonPressDelivered(t *testing.T) {
	tr := newTestTransport(t, Options{})
	h := &captureHandler{}

	acked := 0
	tr.ack = func(i *discordgo.Interaction) error {
		acked++
		if i.ID != "int-1" {
			t.Errorf("acked wrong interaction: %q", i.ID)
		}
		return nil
	}

	tr.handleInteraction(context.Background(), makeButtonInteraction("g-1", "ch-1", "u-1", "yes"), h)

	if acked != 1 {
		t.Errorf("expected exactly one ack, got %d", acked)
	}
	got := h.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1 inbound, got %d", len(got))
	}
	m := got[0]
	if m.ActionID != "int-1" {
		t.Errorf("ActionID: %q", m.ActionID)
	}
	if m.Text != "yes" {
		t.Errorf("Text should carry the pressed CustomID, got %q", m.Text)
	}
	if m.ChatID != "ch-1" || m.UserID != "u-1" || m.MessageID != "msg-btn" {
		t.Errorf("fields wrong: %+v", m)
	}
}

func TestHandleInteraction_DMUserFromUserField(t *testing.T) {
	tr := newTestTransport(t, Options{})
	h := &captureHandler{}

	tr.handleInteraction(context.Background(), makeButtonInteraction("", "ch-1", "u-dm", "ok"), h)

	got := h.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1 inbound, got %d", len(got))
	}
	if got[0].UserID != "u-dm" {
		t.Errorf("UserID: %q", got[0].UserID)
	}
}

func TestHandleInteraction_NonComponentIgnored(t *testing.T) {
	tr := newTestTransport(t, Options{})
	h := &captureHandler{}

	i := &discordgo.InteractionCreate{Interaction: &discordgo.Interaction{
		ID:   "int-2",
		Type: discordgo.InteractionApplicationCommand,
	}}
	tr.handleInteraction(context.Background(), i, h)
	if len(h.snapshot()) != 0 {
		t.Error("non-component interactions must be ignored")
	}
}

func TestHandleInteraction_GuildAllowlist(t *testing.T) {
	tr := newTestTransport(t, Options{AllowedGuildIDs: []string{"g-ok"}})
	h := &captureHandler{}

	tr.handleInteraction(context.Background(), makeButtonInteraction("g-blocked", "ch-1", "u-1", "x"), h)
	if len(h.snapshot()) != 0 {
		t.Error("interaction from a non-allowlisted guild must be dropped")
	}
}

func TestBuildMessageSend(t *testing.T) {
	msg := transport.OutboundMessage{
		Text:      "hello",
		ReplyToID: "orig-9",
		Buttons: [][]transport.Button{
			{{Text: "Yes", Value: "yes"}, {Text: "No", Value: "no"}},
			{{Text: "Maybe", Value: "maybe"}},
		},
	}
	send := buildMessageSend("ch-7", msg)
	if send.Content != "hello" {
		t.Errorf("Content: %q", send.Content)
	}
	if send.Reference == nil || send.Reference.MessageID != "orig-9" || send.Reference.ChannelID != "ch-7" {
		t.Errorf("Reference: %+v", send.Reference)
	}
	if len(send.Components) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(send.Components))
	}
	row, ok := send.Components[0].(discordgo.ActionsRow)
	if !ok {
		t.Fatalf("row type: %T", send.Components[0])
	}
	if len(row.Components) != 2 {
		t.Fatalf("expected 2 buttons in row 0, got %d", len(row.Components))
	}
	btn, ok := row.Components[0].(discordgo.Button)
	if !ok {
		t.Fatalf("button type: %T", row.Components[0])
	}
	if btn.Label != "Yes" || btn.CustomID != "yes" {
		t.Errorf("button: %+v", btn)
	}
}

func TestBuildMessageSend_NoReplyNoButtons(t *testing.T) {
	send := buildMessageSend("ch-1", transport.OutboundMessage{Text: "plain"})
	if send.Reference != nil {
		t.Errorf("Reference should be nil, got %+v", send.Reference)
	}
	if send.Components != nil {
		t.Errorf("Components should be nil, got %+v", send.Components)
	}
}

func TestBuildMessageEdit(t *testing.T) {
	edit := buildMessageEdit("ch-1", "msg-5", transport.OutboundMessage{Text: "updated"})
	if edit.ID != "msg-5" || edit.Channel != "ch-1" {
		t.Errorf("ids wrong: %+v", edit)
	}
	if edit.Content == nil || *edit.Content != "updated" {
		t.Errorf("Content: %v", edit.Content)
	}
	if edit.Components == nil || len(*edit.Components) != 0 {
		t.Errorf("Components should be set (empty) so edits can clear keyboards: %v", edit.Components)
	}
}

func TestButtonsToComponents_Limits(t *testing.T) {
	longValue := strings.Repeat("v", 150)
	wideRow := make([]transport.Button, 8)
	for i := range wideRow {
		wideRow[i] = transport.Button{Text: "b", Value: "v"}
	}
	rows := [][]transport.Button{
		{{Text: strings.Repeat("L", 100), Value: longValue}},
		wideRow,
	}
	for range 6 {
		rows = append(rows, []transport.Button{{Text: "x", Value: "x"}})
	}

	comps := buttonsToComponents(rows)
	if len(comps) != maxComponentRows {
		t.Fatalf("expected %d rows, got %d", maxComponentRows, len(comps))
	}
	row0 := comps[0].(discordgo.ActionsRow)
	btn := row0.Components[0].(discordgo.Button)
	if len(btn.CustomID) != maxCustomIDChars {
		t.Errorf("CustomID not truncated to %d, got %d", maxCustomIDChars, len(btn.CustomID))
	}
	if len(btn.Label) != maxButtonLabelChars {
		t.Errorf("Label not truncated to %d, got %d", maxButtonLabelChars, len(btn.Label))
	}
	row1 := comps[1].(discordgo.ActionsRow)
	if len(row1.Components) != maxButtonsPerRow {
		t.Errorf("row not capped at %d buttons, got %d", maxButtonsPerRow, len(row1.Components))
	}
}

func TestTruncateText(t *testing.T) {
	if got := truncateText("short", 10); got != "short" {
		t.Errorf("under-limit text must pass through, got %q", got)
	}

	// Prefers a newline boundary in the second half of the budget.
	in := strings.Repeat("a", 8) + "\n" + strings.Repeat("b", 8)
	if got := truncateText(in, 12); got != strings.Repeat("a", 8) {
		t.Errorf("expected newline-boundary cut, got %q", got)
	}

	// Falls back to a hard cut when the only newline is too early.
	in = "a\n" + strings.Repeat("b", 20)
	if got := truncateText(in, 10); len([]rune(got)) != 10 {
		t.Errorf("expected hard cut at 10 runes, got %d (%q)", len([]rune(got)), got)
	}

	// Counts runes, not bytes.
	in = strings.Repeat("中", 30)
	got := truncateText(in, 10)
	if got != strings.Repeat("中", 10) {
		t.Errorf("rune truncation wrong: %q", got)
	}
}

func TestAttachmentKind(t *testing.T) {
	if attachmentKind("image/png") != transport.AttachmentImage {
		t.Error("image/* should map to image")
	}
	if attachmentKind("application/pdf") != transport.AttachmentFile {
		t.Error("non-image should map to file")
	}
	if attachmentKind("") != transport.AttachmentFile {
		t.Error("missing content type should map to file")
	}
}

func TestStripUserMention(t *testing.T) {
	if got := stripUserMention("<@b1> hi <@!b1> there", "b1"); strings.Contains(got, "b1") {
		t.Errorf("mention tokens not stripped: %q", got)
	}
	if got := stripUserMention("keep <@other> intact", "b1"); got != "keep <@other> intact" {
		t.Errorf("other mentions must survive: %q", got)
	}
}

func TestAllowed(t *testing.T) {
	if !allowed(nil, "anyone") {
		t.Error("empty allowlist must admit everyone")
	}
	set := toSet([]string{"a", "b"})
	if !allowed(set, "a") || allowed(set, "c") {
		t.Error("allowlist membership wrong")
	}
}

// =============================================================================
// Integration test (gated)
// =============================================================================
//
// Set DISCORD_INTEGRATION_TEST=1 plus IM_GATEWAY_DISCORD_BOT_TOKEN in env
// to run a real connect cycle. The test Start()s the transport briefly and
// Stop()s it; no messages are sent.
func TestDiscord_Integration_ConnectAndStop(t *testing.T) {
	if os.Getenv("DISCORD_INTEGRATION_TEST") != "1" {
		t.Skip("set DISCORD_INTEGRATION_TEST=1 to run")
	}
	token := os.Getenv("IM_GATEWAY_DISCORD_BOT_TOKEN")
	if token == "" {
		t.Skip("integration test requires IM_GATEWAY_DISCORD_BOT_TOKEN")
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
	case <-time.After(5 * time.Second):
		t.Error("Start did not return after Stop+cancel")
	}
}
