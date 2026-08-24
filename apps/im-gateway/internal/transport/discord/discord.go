// Package discord implements transport.Transport for Discord using the
// bwmarrin/discordgo gateway (websocket) connection.
//
// Scope:
//   - DMs are always accepted (subject to AllowedUserIDs); guild channel
//     messages are only accepted when the bot is @-mentioned (subject to
//     AllowedGuildIDs), with the mention token stripped from the text.
//   - ChatID is the Discord channel ID, MessageID the message ID.
//   - Outbound text is sent as-is: Discord renders markdown natively. The
//     bridge chunks long output via Capabilities.MaxMessageLength; the
//     transport keeps a hard 2000-char truncation as a last-resort guard.
//   - Buttons become message components (one ActionsRow per Button row);
//     a press comes back through InteractionCreate as an InboundMessage
//     with ActionID set and Text = the pressed button's CustomID.
//   - Inbound attachments are downloaded (capped) and persisted to the
//     inbox when InboxDir is configured; otherwise they are dropped with a
//     hint reply.
package discord

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/bwmarrin/discordgo"

	"vetta-im-gateway/internal/transport"
	"vetta-im-gateway/internal/transport/inbox"
)

// MaxInboundAttachmentBytes caps a single inbound attachment we will
// download + persist. Defensive ceiling so a huge upload cannot OOM the
// gateway; mirrors the feishu/wechat transports.
const MaxInboundAttachmentBytes = 50 * 1024 * 1024

// maxMessageChars is Discord's hard limit on message content length,
// counted in characters (runes), not bytes.
const maxMessageChars = 2000

// maxCustomIDChars is Discord's limit on a component custom_id.
const maxCustomIDChars = 100

// maxButtonLabelChars is Discord's limit on a button label.
const maxButtonLabelChars = 80

// maxComponentRows and maxButtonsPerRow are Discord's layout limits for
// message components. Extra rows/buttons are dropped rather than erroring
// so a slightly-too-large keyboard still reaches the user.
const (
	maxComponentRows = 5
	maxButtonsPerRow = 5
)

// Gateway dial retry defaults. A dropped dial to gateway.discord.gg is
// common on flaky or filtered networks; absorbing it here keeps one blip
// from tearing down the whole sidecar.
const (
	defaultConnectInitialBackoff = 2 * time.Second
	defaultConnectMaxBackoff     = 60 * time.Second
	defaultConnectMaxAttempts    = 6
)

// inboundMediaHint is the friendly reply sent when a message carries
// attachments but the gateway has no inbox configured to receive them.
const inboundMediaHint = "暂不支持接收文件：网关未配置收件目录，请仅发送文字。"

// gatewayIntents is the minimal intent set: guilds plus guild and DM
// messages.
//
// MessageContent is deliberately NOT requested. It is a privileged intent,
// so Discord rejects the identify with websocket close 4014 ("Disallowed
// intent(s)") for every bot whose owner has not flipped the MESSAGE
// CONTENT toggle in the developer portal — the bridge then fails to
// connect at all. Discord delivers message content without the privilege
// for exactly the two cases this transport accepts: direct messages to
// the bot, and guild messages that @-mention it (handleMessageCreate
// drops every other guild message). Adding the intent would therefore buy
// nothing and cost every unconfigured bot its connection.
const gatewayIntents = discordgo.IntentGuilds |
	discordgo.IntentGuildMessages |
	discordgo.IntentDirectMessages

// Options configures Transport. BotToken is required.
type Options struct {
	BotToken string

	// AllowedUserIDs restricts which users' DMs are accepted. Empty allows
	// everyone.
	AllowedUserIDs []string

	// AllowedGuildIDs restricts which guilds' channel messages are
	// accepted. Empty allows every guild the bot is a member of.
	AllowedGuildIDs []string

	// InboxDir is where inbound attachments are persisted (per-day subdirs
	// via the shared inbox package). Empty disables inbound media: messages
	// carrying attachments get a hint reply and only their text survives.
	InboxDir string

	// ConnectInitialBackoff / ConnectMaxBackoff / ConnectMaxAttempts govern
	// how a failed gateway dial is retried. Zero values take the package
	// defaults; tests shrink them to keep the retry path fast.
	ConnectInitialBackoff time.Duration
	ConnectMaxBackoff     time.Duration
	ConnectMaxAttempts    int
}

// Transport implements transport.Transport (and transport.Reactor) for
// Discord.
type Transport struct {
	opts          Options
	session       *discordgo.Session
	allowedUsers  map[string]struct{}
	allowedGuilds map[string]struct{}
	inboxDir      string

	connectInitialBackoff time.Duration
	connectMaxBackoff     time.Duration
	connectMaxAttempts    int

	closed atomic.Bool
	done   chan struct{}

	// botUserID is learned from the Ready event; guarded by mu because the
	// gateway handlers run on the session's goroutines. Tests set it
	// directly via setBotUserID.
	mu        sync.Mutex
	botUserID string

	// Injection seams so the inbound handlers are unit-testable without a
	// live session. New wires them to the real session-backed calls.
	ack        func(i *discordgo.Interaction) error
	notify     func(ctx context.Context, chatID, text string)
	httpClient *http.Client
}

// New constructs a Discord Transport. Validates required fields.
func New(opts Options) (*Transport, error) {
	if opts.BotToken == "" {
		return nil, errors.New("discord transport: BotToken is required")
	}
	session, err := discordgo.New("Bot " + opts.BotToken)
	if err != nil {
		return nil, fmt.Errorf("discord new session: %w", err)
	}
	session.Identify.Intents = gatewayIntents

	t := &Transport{
		opts:                  opts,
		session:               session,
		allowedUsers:          toSet(opts.AllowedUserIDs),
		allowedGuilds:         toSet(opts.AllowedGuildIDs),
		inboxDir:              opts.InboxDir,
		done:                  make(chan struct{}),
		httpClient:            &http.Client{Timeout: 60 * time.Second},
		connectInitialBackoff: orDuration(opts.ConnectInitialBackoff, defaultConnectInitialBackoff),
		connectMaxBackoff:     orDuration(opts.ConnectMaxBackoff, defaultConnectMaxBackoff),
		connectMaxAttempts:    orInt(opts.ConnectMaxAttempts, defaultConnectMaxAttempts),
	}
	t.ack = func(i *discordgo.Interaction) error {
		return session.InteractionRespond(i, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseDeferredMessageUpdate,
		})
	}
	t.notify = func(ctx context.Context, chatID, text string) {
		// Best effort: hint failures must not break inbound handling.
		_, _ = t.SendMessage(ctx, chatID, transport.OutboundMessage{Text: text})
	}
	return t, nil
}

// Compile-time interface checks.
var (
	_ transport.Transport = (*Transport)(nil)
	_ transport.Reactor   = (*Transport)(nil)
)

func (t *Transport) Name() string { return "discord" }

func (t *Transport) Capabilities() transport.Capabilities {
	return transport.Capabilities{
		SupportsMessageEdit: true,
		SupportsCards:       false,
		SupportsButtons:     true,
		SupportsFileUpload:  true,
		SupportsThreads:     true,
		SupportsReactions:   true,
		MaxMessageLength:    maxMessageChars,
	}
}

// Start opens the gateway connection and blocks delivering inbound
// messages to handler until ctx is canceled or Stop() is called.
//
// Handlers are invoked from the session's own goroutines, so the
// MessageHandler must be cheap or hand off to a worker.
func (t *Transport) Start(ctx context.Context, handler transport.MessageHandler) error {
	t.session.AddHandler(func(_ *discordgo.Session, r *discordgo.Ready) {
		if r.User != nil {
			t.setBotUserID(r.User.ID)
		}
	})
	t.session.AddHandler(func(_ *discordgo.Session, m *discordgo.MessageCreate) {
		t.handleMessageCreate(ctx, m, handler)
	})
	t.session.AddHandler(func(_ *discordgo.Session, i *discordgo.InteractionCreate) {
		t.handleInteraction(ctx, i, handler)
	})

	if err := t.openWithRetry(ctx); err != nil {
		return err
	}

	select {
	case <-ctx.Done():
		_ = t.Stop()
		return ctx.Err()
	case <-t.done:
		return nil
	}
}

// openWithRetry dials the gateway, absorbing transient dial failures with
// exponential backoff.
//
// A single dropped dial ("Open() error connecting to gateway
// wss://gateway.discord.gg/..., EOF") used to abort Start outright. The host
// treats a returned Start error as fatal and shuts the sidecar down, so the
// desktop respawned the whole process — one network blip cost a full process
// rebuild and the bridge visibly flapped between online and error. Transient
// failures are retried here instead. A permanent rejection (bad token,
// refused intents, sharding required) still fails immediately, and giving up
// after connectMaxAttempts keeps a genuinely unreachable gateway visible
// instead of retrying forever behind an "online" badge.
func (t *Transport) openWithRetry(ctx context.Context) error {
	backoff := t.connectInitialBackoff
	var lastErr error
	for attempt := 1; attempt <= t.connectMaxAttempts; attempt++ {
		err := t.session.Open()
		if err == nil {
			return nil
		}
		lastErr = err
		if hint, permanent := openFailure(err); permanent {
			return fmt.Errorf("discord open: %w%s", err, hint)
		}
		if attempt == t.connectMaxAttempts {
			break
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("discord open: %w (last dial error: %v)", ctx.Err(), err)
		case <-t.done:
			return fmt.Errorf("discord open: stopped while retrying (last dial error: %v)", err)
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, t.connectMaxBackoff)
	}
	return fmt.Errorf("discord open: gave up after %d attempts: %w", t.connectMaxAttempts, lastErr)
}

// Stop closes the gateway session. Safe to call multiple times.
func (t *Transport) Stop() error {
	if t.closed.Swap(true) {
		return nil
	}
	close(t.done)
	if err := t.session.Close(); err != nil {
		return fmt.Errorf("discord close: %w", err)
	}
	return nil
}

func (t *Transport) setBotUserID(id string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.botUserID = id
}

func (t *Transport) getBotUserID() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.botUserID
}

// handleMessageCreate translates a MessageCreate gateway event into the
// normalized InboundMessage and forwards it to the handler.
//
// Filters:
//   - messages from bots (including ourselves) and webhooks are ignored;
//   - DMs (GuildID empty) are always eligible, subject to AllowedUserIDs;
//   - guild channel messages require the bot to be @-mentioned (mention
//     tokens stripped from the text), subject to AllowedGuildIDs.
func (t *Transport) handleMessageCreate(ctx context.Context, m *discordgo.MessageCreate, handler transport.MessageHandler) {
	if m == nil || m.Message == nil || m.Author == nil {
		return
	}
	if m.Author.Bot || m.WebhookID != "" {
		return
	}
	botID := t.getBotUserID()
	if botID != "" && m.Author.ID == botID {
		return
	}

	text := m.Content
	if m.GuildID == "" {
		// DM
		if !allowed(t.allowedUsers, m.Author.ID) {
			return
		}
	} else {
		if !allowed(t.allowedGuilds, m.GuildID) {
			return
		}
		if !mentionsUser(m.Mentions, botID) {
			return
		}
		text = stripUserMention(text, botID)
	}
	text = strings.TrimSpace(text)

	var attachments []transport.Attachment
	if len(m.Attachments) > 0 {
		if t.inboxDir == "" {
			t.notify(ctx, m.ChannelID, inboundMediaHint)
		} else {
			for _, a := range m.Attachments {
				if a == nil || a.URL == "" {
					continue
				}
				att, err := t.fetchInboundAttachment(ctx, m.ID, a)
				if err != nil {
					// Per-item best effort, matching the feishu transport.
					continue
				}
				attachments = append(attachments, att)
			}
		}
	}

	if text == "" && len(attachments) == 0 {
		return
	}

	replyTo := ""
	if m.MessageReference != nil {
		replyTo = m.MessageReference.MessageID
	}

	inbound := transport.InboundMessage{
		Platform:    "discord",
		ChatID:      m.ChannelID,
		UserID:      m.Author.ID,
		MessageID:   m.ID,
		ReplyToID:   replyTo,
		Text:        text,
		Attachments: attachments,
		ReceivedAt:  time.Now(),
		Raw:         m,
	}
	_ = handler.HandleInbound(ctx, inbound)
}

// handleInteraction turns a message-component press (button click) into an
// InboundMessage with ActionID set. The interaction is acked first with a
// DeferredMessageUpdate so Discord doesn't show "interaction failed".
func (t *Transport) handleInteraction(ctx context.Context, i *discordgo.InteractionCreate, handler transport.MessageHandler) {
	if i == nil || i.Interaction == nil || i.Type != discordgo.InteractionMessageComponent {
		return
	}
	data, ok := i.Data.(discordgo.MessageComponentInteractionData)
	if !ok {
		return
	}

	userID := ""
	switch {
	case i.Member != nil && i.Member.User != nil:
		userID = i.Member.User.ID
	case i.User != nil:
		userID = i.User.ID
	}
	if userID == "" {
		return
	}
	if i.GuildID == "" {
		if !allowed(t.allowedUsers, userID) {
			return
		}
	} else if !allowed(t.allowedGuilds, i.GuildID) {
		return
	}

	// Ack even if delivery fails later; a lost ack only degrades UX
	// (Discord shows a failure toast), so best effort.
	_ = t.ack(i.Interaction)

	messageID := ""
	if i.Message != nil {
		messageID = i.Message.ID
	}

	inbound := transport.InboundMessage{
		Platform:   "discord",
		ChatID:     i.ChannelID,
		UserID:     userID,
		MessageID:  messageID,
		Text:       data.CustomID,
		ActionID:   i.ID,
		ReceivedAt: time.Now(),
		Raw:        i,
	}
	_ = handler.HandleInbound(ctx, inbound)
}

// fetchInboundAttachment downloads one message attachment (capped at
// MaxInboundAttachmentBytes), persists it to the inbox, and returns the
// resulting normalized Attachment.
func (t *Transport) fetchInboundAttachment(ctx context.Context, msgID string, a *discordgo.MessageAttachment) (transport.Attachment, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	if err != nil {
		return transport.Attachment{}, fmt.Errorf("discord attachment request: %w", err)
	}
	resp, err := t.httpClient.Do(req)
	if err != nil {
		return transport.Attachment{}, fmt.Errorf("discord attachment download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return transport.Attachment{}, fmt.Errorf("discord attachment download: status %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, MaxInboundAttachmentBytes+1))
	if err != nil {
		return transport.Attachment{}, fmt.Errorf("discord attachment read: %w", err)
	}
	if len(b) > MaxInboundAttachmentBytes {
		return transport.Attachment{}, fmt.Errorf("discord attachment exceeds %d-byte cap", MaxInboundAttachmentBytes)
	}

	name := a.Filename
	if name == "" {
		name = "file.bin"
	}
	filename := fmt.Sprintf("%s-%s", inbox.SanitizeForFilename(msgID), filepath.Base(name))
	absPath, err := inbox.Persist(t.inboxDir, filename, b)
	if err != nil {
		return transport.Attachment{}, err
	}
	mime := a.ContentType
	if mime == "" {
		mime = inbox.MimeFromExt(filepath.Ext(name))
	}
	return transport.Attachment{
		Kind:     attachmentKind(a.ContentType),
		Name:     filepath.Base(absPath),
		MimeType: mime,
		URL:      absPath,
	}, nil
}

// SendMessage delivers a message to the channel. Discord renders markdown
// natively, so Text is sent as-is (hard-truncated to the 2000-char limit
// as a last-resort guard; the bridge already chunks by MaxMessageLength).
func (t *Transport) SendMessage(ctx context.Context, chatID string, msg transport.OutboundMessage) (string, error) {
	sent, err := t.session.ChannelMessageSendComplex(chatID, buildMessageSend(chatID, msg), discordgo.WithContext(ctx))
	if err != nil {
		return "", fmt.Errorf("discord send: %w", err)
	}
	return sent.ID, nil
}

// EditMessage replaces the content (and components) of an earlier message.
func (t *Transport) EditMessage(ctx context.Context, chatID, messageID string, msg transport.OutboundMessage) error {
	edit := buildMessageEdit(chatID, messageID, msg)
	if _, err := t.session.ChannelMessageEditComplex(edit, discordgo.WithContext(ctx)); err != nil {
		return fmt.Errorf("discord edit: %w", err)
	}
	return nil
}

// EndStream is a no-op: Discord has no dedicated streaming mode; streaming
// output is delivered via plain edits.
func (t *Transport) EndStream(_ context.Context, _, _ string) error {
	return nil
}

// DeleteMessage removes a previously sent message.
func (t *Transport) DeleteMessage(ctx context.Context, chatID, messageID string) error {
	if err := t.session.ChannelMessageDelete(chatID, messageID, discordgo.WithContext(ctx)); err != nil {
		return fmt.Errorf("discord delete: %w", err)
	}
	return nil
}

// ShowTyping triggers Discord's ~10s typing indicator on the channel.
func (t *Transport) ShowTyping(ctx context.Context, chatID string) error {
	if err := t.session.ChannelTyping(chatID, discordgo.WithContext(ctx)); err != nil {
		return fmt.Errorf("discord typing: %w", err)
	}
	return nil
}

// SendAttachment uploads a local file to the channel. Discord accepts any
// file type through the same endpoint and inlines image previews itself,
// so Kind needs no special handling. Caption rides along as content.
func (t *Transport) SendAttachment(ctx context.Context, chatID string, att transport.OutboundAttachment) (string, error) {
	if att.Path == "" {
		return "", errors.New("discord attachment: path required")
	}
	f, err := os.Open(att.Path)
	if err != nil {
		return "", fmt.Errorf("discord attachment open: %w", err)
	}
	defer f.Close()

	caption := truncateText(att.Caption, maxMessageChars)
	sent, err := t.session.ChannelFileSendWithMessage(chatID, caption, filepath.Base(att.Path), f, discordgo.WithContext(ctx))
	if err != nil {
		return "", fmt.Errorf("discord attachment send: %w", err)
	}
	return sent.ID, nil
}

// AddReaction attaches a unicode emoji reaction to a message.
func (t *Transport) AddReaction(ctx context.Context, chatID, messageID, emoji string) error {
	if err := t.session.MessageReactionAdd(chatID, messageID, emoji, discordgo.WithContext(ctx)); err != nil {
		return fmt.Errorf("discord reaction add: %w", err)
	}
	return nil
}

// RemoveReaction removes the bot's own reaction. Removing a reaction that
// is not present is a no-op per the Reactor contract, so 404s are
// swallowed.
func (t *Transport) RemoveReaction(ctx context.Context, chatID, messageID, emoji string) error {
	err := t.session.MessageReactionRemove(chatID, messageID, emoji, "@me", discordgo.WithContext(ctx))
	if err != nil {
		var restErr *discordgo.RESTError
		if errors.As(err, &restErr) && restErr.Response != nil && restErr.Response.StatusCode == http.StatusNotFound {
			return nil
		}
		return fmt.Errorf("discord reaction remove: %w", err)
	}
	return nil
}

// =============================================================================
// pure conversion helpers
// =============================================================================

// buildMessageSend converts an OutboundMessage into the discordgo send
// payload: truncated content, reply reference, and button components.
func buildMessageSend(chatID string, msg transport.OutboundMessage) *discordgo.MessageSend {
	send := &discordgo.MessageSend{
		Content:    truncateText(msg.Text, maxMessageChars),
		Components: buttonsToComponents(msg.Buttons),
	}
	if msg.ReplyToID != "" {
		send.Reference = &discordgo.MessageReference{
			MessageID: msg.ReplyToID,
			ChannelID: chatID,
		}
	}
	return send
}

// buildMessageEdit converts an OutboundMessage into the discordgo edit
// payload. Components are always set (possibly to empty) so an edit can
// remove a previously sent keyboard.
func buildMessageEdit(chatID, messageID string, msg transport.OutboundMessage) *discordgo.MessageEdit {
	content := truncateText(msg.Text, maxMessageChars)
	components := buttonsToComponents(msg.Buttons)
	return &discordgo.MessageEdit{
		ID:         messageID,
		Channel:    chatID,
		Content:    &content,
		Components: &components,
	}
}

// buttonsToComponents maps normalized button rows to Discord message
// components: one ActionsRow per row, CustomID = Button.Value. Rows and
// per-row buttons beyond Discord's layout limits are dropped; CustomID and
// Label are truncated to their platform caps.
func buttonsToComponents(rows [][]transport.Button) []discordgo.MessageComponent {
	if len(rows) == 0 {
		return nil
	}
	var out []discordgo.MessageComponent
	for _, row := range rows {
		if len(row) == 0 {
			continue
		}
		if len(row) > maxButtonsPerRow {
			row = row[:maxButtonsPerRow]
		}
		var buttons []discordgo.MessageComponent
		for _, b := range row {
			buttons = append(buttons, discordgo.Button{
				Label:    truncateText(b.Text, maxButtonLabelChars),
				Style:    discordgo.PrimaryButton,
				CustomID: truncateText(b.Value, maxCustomIDChars),
			})
		}
		out = append(out, discordgo.ActionsRow{Components: buttons})
		if len(out) == maxComponentRows {
			break
		}
	}
	return out
}

// truncateText hard-caps s at maxRunes characters (Discord counts limits
// in characters, not bytes). When truncation is needed it prefers cutting
// at the last newline in the kept portion — as long as that keeps at
// least half the budget — so a mid-line cut is avoided where possible.
func truncateText(s string, maxRunes int) string {
	if utf8.RuneCountInString(s) <= maxRunes {
		return s
	}
	cut := string([]rune(s)[:maxRunes])
	if i := strings.LastIndexByte(cut, '\n'); i > len(cut)/2 {
		return cut[:i]
	}
	return cut
}

// openFailure classifies a failed gateway dial. permanent reports whether
// retrying can possibly help; hint is an actionable explanation so the
// bridge status shows a fixable cause instead of a bare websocket error.
//
// The close code is matched on the error text: discordgo surfaces the raw
// *websocket.CloseError from gorilla, and reaching that type would make an
// otherwise-indirect dependency direct. A missed match costs only the hint
// and one wasted retry cycle, never correctness.
func openFailure(err error) (hint string, permanent bool) {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "4004"):
		return " (bot token rejected: check the token in Vetta Claw settings, or reset it in the Discord developer portal)", true
	case strings.Contains(msg, "4014"), strings.Contains(msg, "4013"):
		return " (gateway refused the requested intents: the bot must be invited with the bot scope; " +
			"this build does not request any privileged intent)", true
	case strings.Contains(msg, "4011"):
		return " (Discord requires sharding for this bot; the bridge does not support sharded gateways)", true
	default:
		// Network-level failures (dial EOF, timeout, DNS) are transient.
		return "", false
	}
}

func orDuration(value, fallback time.Duration) time.Duration {
	if value > 0 {
		return value
	}
	return fallback
}

func orInt(value, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}

// mentionsUser reports whether the mention list contains the given user.
func mentionsUser(mentions []*discordgo.User, userID string) bool {
	if userID == "" {
		return false
	}
	for _, u := range mentions {
		if u != nil && u.ID == userID {
			return true
		}
	}
	return false
}

// stripUserMention removes <@id> / <@!id> mention tokens for the given
// user from the text. Discord sends mentions inline in Content; the user
// did not literally type the raw token, so the agent shouldn't see it.
func stripUserMention(text, userID string) string {
	if userID == "" {
		return text
	}
	text = strings.ReplaceAll(text, "<@!"+userID+">", "")
	text = strings.ReplaceAll(text, "<@"+userID+">", "")
	return text
}

// attachmentKind maps a Discord attachment content type to the normalized
// attachment kind: inline-renderable images vs everything else.
func attachmentKind(contentType string) transport.AttachmentKind {
	if strings.HasPrefix(contentType, "image/") {
		return transport.AttachmentImage
	}
	return transport.AttachmentFile
}

// allowed implements the "empty allowlist admits everyone" rule.
func allowed(set map[string]struct{}, id string) bool {
	if len(set) == 0 {
		return true
	}
	_, ok := set[id]
	return ok
}

func toSet(ids []string) map[string]struct{} {
	if len(ids) == 0 {
		return nil
	}
	set := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if id != "" {
			set[id] = struct{}{}
		}
	}
	return set
}
