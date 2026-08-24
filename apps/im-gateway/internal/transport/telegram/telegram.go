// Package telegram implements transport.Transport for Telegram bots using
// the plain HTTP Bot API (getUpdates long polling). No third-party SDK — the
// wire surface we need is small and a hand-rolled client keeps the gateway's
// dependency budget flat, mirroring the wechat/ilink precedent.
//
// Inbound:
//   - private chats: accepted, optionally filtered by AllowedUserIDs.
//   - group / supergroup chats: only messages that @-mention the bot are
//     forwarded (mention stripped); everything else is dropped so the bot
//     can sit in a busy group without answering every message.
//   - callback_query (inline keyboard presses): acked via
//     answerCallbackQuery, then delivered with ActionID set.
//   - photo / document / voice: downloaded via getFile and persisted to the
//     inbox when InboxDir is configured; otherwise dropped with a hint.
//
// Outbound: markdown from the agent is converted to Telegram HTML
// (parse_mode=HTML). When Telegram rejects the entities we retry once as
// plain text so the user always gets the content.
package telegram

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"vetta-im-gateway/internal/transport"
	"vetta-im-gateway/internal/transport/inbox"
)

// MaxInboundAttachmentBytes caps a single inbound media download. Telegram
// bots can only getFile files ≤20MB anyway; this is a defensive ceiling so
// a misbehaving server cannot OOM the gateway. Mirrors feishu/wechat.
const MaxInboundAttachmentBytes = 50 * 1024 * 1024

// maxCallbackDataBytes is Telegram's hard cap on callback_data. Longer
// Button.Values are truncated (on a rune boundary) rather than rejected so
// an over-long agent payload degrades instead of failing the whole send.
const maxCallbackDataBytes = 64

// defaultBaseURL is the public Bot API endpoint. Options.BaseURL overrides
// it for tests (httptest.Server) or self-hosted bot-api instances.
const defaultBaseURL = "https://api.telegram.org"

// pollTimeoutSeconds is the getUpdates long-poll window. The HTTP client
// timeout in api.go must stay comfortably above this.
const pollTimeoutSeconds = 50

// inboundMediaHint is the reply sent when media arrives but no InboxDir is
// configured, so the bytes have nowhere to land. Mirrors feishu.
const inboundMediaHint = "当前未配置附件收件目录，图片/文件/语音已被忽略，请发送文字。"

// Options configures Transport. BotToken is required.
type Options struct {
	BotToken string

	// BaseURL overrides the Bot API endpoint (default
	// https://api.telegram.org). Used by tests to point at a fake server.
	BaseURL string

	// AllowedUserIDs restricts which Telegram user IDs may talk to the bot
	// in private chats. Empty means accept all private chats. Group-chat
	// gating is done by @-mention instead, not by this list.
	AllowedUserIDs []int64

	// InboxDir is where inbound media (photo / document / voice) is
	// persisted via the shared inbox package. Empty disables inbound media:
	// the media is dropped and the user gets a hint reply.
	InboxDir string
}

// Transport implements transport.Transport (and transport.Reactor) for
// Telegram. Construct via New; the zero value is not usable.
type Transport struct {
	opts    Options
	api     *apiClient
	allowed map[int64]bool

	// botUsername is resolved via getMe at Start and used to detect group
	// @-mentions. Written once before polling begins.
	botUsername string

	closed atomic.Bool
	done   chan struct{}
}

// New constructs a Telegram Transport. Validates required fields.
func New(opts Options) (*Transport, error) {
	if opts.BotToken == "" {
		return nil, errors.New("telegram transport: BotToken is required")
	}
	base := opts.BaseURL
	if base == "" {
		base = defaultBaseURL
	}
	allowed := make(map[int64]bool, len(opts.AllowedUserIDs))
	for _, id := range opts.AllowedUserIDs {
		allowed[id] = true
	}
	return &Transport{
		opts:    opts,
		api:     newAPIClient(base, opts.BotToken),
		allowed: allowed,
		done:    make(chan struct{}),
	}, nil
}

// Compile-time interface checks.
var (
	_ transport.Transport = (*Transport)(nil)
	_ transport.Reactor   = (*Transport)(nil)
)

func (t *Transport) Name() string { return "telegram" }

func (t *Transport) Capabilities() transport.Capabilities {
	return transport.Capabilities{
		SupportsMessageEdit: true,  // editMessageText
		SupportsCards:       false, // no card/block concept in Bot API
		SupportsButtons:     true,  // inline_keyboard
		SupportsFileUpload:  true,  // sendPhoto / sendDocument
		SupportsThreads:     true,  // reply_parameters
		SupportsReactions:   true,  // setMessageReaction
		MaxMessageLength:    4096,  // Bot API text limit
	}
}

// Start resolves the bot identity (getMe) then runs the getUpdates long-poll
// loop until ctx is canceled or Stop is called. Hard errors back off
// exponentially (1s → 30s), same shape as the wechat poll loop; a long-poll
// window simply expiring with no updates is a success and does not back off.
func (t *Transport) Start(ctx context.Context, handler transport.MessageHandler) error {
	if t.closed.Load() {
		return errors.New("telegram: Start called after Stop")
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		select {
		case <-t.done:
			cancel()
		case <-ctx.Done():
		}
	}()

	const (
		initialBackoff = 1 * time.Second
		maxBackoff     = 30 * time.Second
	)

	backoff := initialBackoff
	// Resolve bot username first — group mention gating depends on it.
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		me, err := t.api.getMe(ctx)
		if err == nil {
			t.botUsername = me.Username
			break
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		backoff = nextBackoff(backoff, maxBackoff)
	}

	backoff = initialBackoff
	var offset int64
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		updates, err := t.api.getUpdates(ctx, offset, pollTimeoutSeconds)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
			backoff = nextBackoff(backoff, maxBackoff)
			continue
		}
		backoff = initialBackoff

		for i := range updates {
			if updates[i].UpdateID >= offset {
				offset = updates[i].UpdateID + 1
			}
			t.handleUpdate(ctx, &updates[i], handler)
		}
	}
}

func nextBackoff(cur, max time.Duration) time.Duration {
	cur *= 2
	if cur > max {
		return max
	}
	return cur
}

// Stop signals the poll loop to exit. Idempotent.
func (t *Transport) Stop() error {
	if t.closed.Swap(true) {
		return nil
	}
	close(t.done)
	return nil
}

// =============================================================================
// inbound
// =============================================================================

// handleUpdate routes one update to the message or callback path. Handler
// errors are swallowed — one bad message must not stall the poll loop.
func (t *Transport) handleUpdate(ctx context.Context, u *update, handler transport.MessageHandler) {
	switch {
	case u.CallbackQuery != nil:
		t.handleCallback(ctx, u.CallbackQuery, handler)
	case u.Message != nil:
		t.handleMessage(ctx, u.Message, handler)
	}
}

// handleMessage normalizes a regular inbound message and forwards it.
func (t *Transport) handleMessage(ctx context.Context, m *tgMessage, handler transport.MessageHandler) {
	if m.From == nil {
		return
	}
	chatID := strconv.FormatInt(m.Chat.ID, 10)

	text := m.Text
	if text == "" {
		text = m.Caption
	}

	switch m.Chat.Type {
	case "private":
		if len(t.allowed) > 0 && !t.allowed[m.From.ID] {
			return
		}
	case "group", "supergroup":
		// Only respond when explicitly addressed; strip the mention so the
		// agent sees a clean prompt.
		stripped, mentioned := stripBotMention(text, t.botUsername)
		if !mentioned {
			return
		}
		text = stripped
	default:
		// channel posts etc. — out of scope.
		return
	}

	attachments, mediaDropped := t.collectAttachments(ctx, m)
	if mediaDropped {
		_, _ = t.SendMessage(ctx, chatID, transport.OutboundMessage{Text: inboundMediaHint})
	}
	if text == "" && len(attachments) == 0 {
		return
	}

	replyTo := ""
	if m.ReplyToMessage != nil {
		replyTo = strconv.FormatInt(m.ReplyToMessage.MessageID, 10)
	}

	_ = handler.HandleInbound(ctx, transport.InboundMessage{
		Platform:    "telegram",
		ChatID:      chatID,
		UserID:      strconv.FormatInt(m.From.ID, 10),
		MessageID:   strconv.FormatInt(m.MessageID, 10),
		ReplyToID:   replyTo,
		Text:        text,
		Attachments: attachments,
		ReceivedAt:  time.Now(),
		Raw:         m,
	})
}

// handleCallback acks a button press then forwards it as an ActionID
// message. The ack is best-effort: even if answerCallbackQuery fails the
// press itself must still reach the agent.
func (t *Transport) handleCallback(ctx context.Context, cb *callbackQuery, handler transport.MessageHandler) {
	_ = t.api.call(ctx, "answerCallbackQuery", map[string]any{
		"callback_query_id": cb.ID,
	}, nil)

	chatID := ""
	messageID := ""
	if cb.Message != nil {
		chatID = strconv.FormatInt(cb.Message.Chat.ID, 10)
		messageID = strconv.FormatInt(cb.Message.MessageID, 10)
	} else {
		// Message can be absent for very old inline messages; fall back to
		// the presser's own chat so the reply still lands somewhere.
		chatID = strconv.FormatInt(cb.From.ID, 10)
	}

	_ = handler.HandleInbound(ctx, transport.InboundMessage{
		Platform:   "telegram",
		ChatID:     chatID,
		UserID:     strconv.FormatInt(cb.From.ID, 10),
		MessageID:  messageID,
		ActionID:   cb.ID,
		Text:       cb.Data,
		ReceivedAt: time.Now(),
		Raw:        cb,
	})
}

// stripBotMention reports whether text @-mentions username, returning the
// text with every mention removed. Matching is case-insensitive on the
// username per Telegram semantics. Empty username never matches.
func stripBotMention(text, username string) (string, bool) {
	if username == "" {
		return text, false
	}
	mention := "@" + username
	lower := strings.ToLower(text)
	needle := strings.ToLower(mention)
	if !strings.Contains(lower, needle) {
		return text, false
	}
	var b strings.Builder
	for {
		i := strings.Index(strings.ToLower(text), needle)
		if i < 0 {
			b.WriteString(text)
			break
		}
		b.WriteString(text[:i])
		text = text[i+len(mention):]
	}
	return strings.TrimSpace(b.String()), true
}

// collectAttachments downloads + persists the message's media. Returns the
// attachments and whether media was present but dropped for lack of an
// InboxDir (download failures are swallowed per-item, matching feishu).
func (t *Transport) collectAttachments(ctx context.Context, m *tgMessage) ([]transport.Attachment, bool) {
	fileID, name, kind := pickMedia(m)
	if fileID == "" {
		return nil, false
	}
	if t.opts.InboxDir == "" {
		return nil, true
	}
	att, err := t.fetchInboundMedia(ctx, m.MessageID, fileID, name, kind)
	if err != nil {
		return nil, false
	}
	return []transport.Attachment{att}, false
}

// pickMedia selects the single media item we handle per message: the
// largest photo size, or the document, or the voice note.
func pickMedia(m *tgMessage) (fileID, name string, kind transport.AttachmentKind) {
	if len(m.Photo) > 0 {
		best := m.Photo[0]
		for _, p := range m.Photo[1:] {
			if p.Width*p.Height > best.Width*best.Height {
				best = p
			}
		}
		return best.FileID, "", transport.AttachmentImage
	}
	if m.Document != nil {
		return m.Document.FileID, m.Document.FileName, transport.AttachmentFile
	}
	if m.Voice != nil {
		return m.Voice.FileID, "voice.ogg", transport.AttachmentFile
	}
	return "", "", ""
}

// fetchInboundMedia getFile-resolves and downloads one media item, persists
// it to the inbox, and returns the resulting Attachment.
func (t *Transport) fetchInboundMedia(ctx context.Context, msgID int64, fileID, name string, kind transport.AttachmentKind) (transport.Attachment, error) {
	b, err := t.api.downloadFile(ctx, fileID, MaxInboundAttachmentBytes)
	if err != nil {
		return transport.Attachment{}, err
	}
	stem := inbox.SanitizeForFilename(strconv.FormatInt(msgID, 10))
	var filename, mime string
	if kind == transport.AttachmentImage {
		ext := inbox.GuessImageExt(b)
		filename = stem + "-img" + ext
		mime = inbox.MimeFromExt(ext)
	} else {
		if name == "" {
			name = "file.bin"
		}
		filename = stem + "-" + inbox.SanitizeForFilename(filepath.Base(name))
		mime = inbox.MimeFromExt(filepath.Ext(name))
	}
	absPath, err := inbox.Persist(t.opts.InboxDir, filename, b)
	if err != nil {
		return transport.Attachment{}, err
	}
	return transport.Attachment{
		Kind:     kind,
		Name:     filepath.Base(absPath),
		MimeType: mime,
		URL:      absPath,
	}, nil
}

// =============================================================================
// outbound
// =============================================================================

// SendMessage delivers msg to the chat as HTML. If Telegram rejects the
// entities (malformed markup after conversion) we retry once as plain text
// so content always gets through.
func (t *Transport) SendMessage(ctx context.Context, chatID string, msg transport.OutboundMessage) (string, error) {
	params := map[string]any{
		"chat_id":    chatID,
		"text":       markdownToHTML(msg.Text),
		"parse_mode": "HTML",
	}
	if msg.ReplyToID != "" {
		if id, err := strconv.ParseInt(msg.ReplyToID, 10, 64); err == nil {
			params["reply_parameters"] = map[string]any{"message_id": id}
		}
	}
	if kb := buildInlineKeyboard(msg.Buttons); kb != nil {
		params["reply_markup"] = kb
	}

	var out tgMessage
	err := t.api.call(ctx, "sendMessage", params, &out)
	if isParseError(err) {
		params["text"] = msg.Text
		delete(params, "parse_mode")
		err = t.api.call(ctx, "sendMessage", params, &out)
	}
	if err != nil {
		return "", fmt.Errorf("telegram send: %w", err)
	}
	return strconv.FormatInt(out.MessageID, 10), nil
}

// EditMessage replaces a previously sent message's text. Telegram returns
// "message is not modified" when the new content equals the old — for our
// purposes that's success (the bridge re-sends identical frames at stream
// boundaries), so it maps to nil.
func (t *Transport) EditMessage(ctx context.Context, chatID, messageID string, msg transport.OutboundMessage) error {
	id, err := strconv.ParseInt(messageID, 10, 64)
	if err != nil {
		return fmt.Errorf("telegram edit: bad message id %q: %w", messageID, err)
	}
	params := map[string]any{
		"chat_id":    chatID,
		"message_id": id,
		"text":       markdownToHTML(msg.Text),
		"parse_mode": "HTML",
	}
	if kb := buildInlineKeyboard(msg.Buttons); kb != nil {
		params["reply_markup"] = kb
	}
	callErr := t.api.call(ctx, "editMessageText", params, nil)
	if isParseError(callErr) {
		params["text"] = msg.Text
		delete(params, "parse_mode")
		callErr = t.api.call(ctx, "editMessageText", params, nil)
	}
	if callErr != nil {
		if isNotModified(callErr) {
			return nil
		}
		return fmt.Errorf("telegram edit: %w", callErr)
	}
	return nil
}

// EndStream is a no-op: Telegram has no dedicated streaming mode, edits are
// plain edits.
func (t *Transport) EndStream(_ context.Context, _, _ string) error { return nil }

// DeleteMessage removes a previously sent message.
func (t *Transport) DeleteMessage(ctx context.Context, chatID, messageID string) error {
	id, err := strconv.ParseInt(messageID, 10, 64)
	if err != nil {
		return fmt.Errorf("telegram delete: bad message id %q: %w", messageID, err)
	}
	if err := t.api.call(ctx, "deleteMessage", map[string]any{
		"chat_id":    chatID,
		"message_id": id,
	}, nil); err != nil {
		return fmt.Errorf("telegram delete: %w", err)
	}
	return nil
}

// ShowTyping flashes the "typing…" chat action (Telegram auto-expires it
// after ~5s or on the next message).
func (t *Transport) ShowTyping(ctx context.Context, chatID string) error {
	if err := t.api.call(ctx, "sendChatAction", map[string]any{
		"chat_id": chatID,
		"action":  "typing",
	}, nil); err != nil {
		return fmt.Errorf("telegram typing: %w", err)
	}
	return nil
}

// SendAttachment uploads a local file as a photo (kind=image) or document.
func (t *Transport) SendAttachment(ctx context.Context, chatID string, att transport.OutboundAttachment) (string, error) {
	if chatID == "" {
		return "", errors.New("telegram: chatID required")
	}
	if att.Path == "" {
		return "", errors.New("telegram: attachment path required")
	}
	method, field := "sendDocument", "document"
	if att.Kind == transport.AttachmentImage {
		method, field = "sendPhoto", "photo"
	}
	var out tgMessage
	if err := t.api.upload(ctx, method, chatID, field, att.Path, att.Caption, &out); err != nil {
		return "", fmt.Errorf("telegram %s: %w", method, err)
	}
	return strconv.FormatInt(out.MessageID, 10), nil
}

// AddReaction sets an emoji reaction on a message. Note setMessageReaction
// replaces the bot's whole reaction list, so with our one-at-a-time usage
// each Add overwrites the previous reaction — which is exactly the turn
// status semantics the bridge wants.
func (t *Transport) AddReaction(ctx context.Context, chatID, messageID, emoji string) error {
	return t.setReaction(ctx, chatID, messageID, []map[string]any{
		{"type": "emoji", "emoji": emoji},
	})
}

// RemoveReaction clears the bot's reactions on the message. The Bot API can
// only replace the full reaction list, not remove one emoji selectively;
// since the bridge keeps at most one reaction alive at a time, clearing is
// equivalent.
func (t *Transport) RemoveReaction(ctx context.Context, chatID, messageID, _ string) error {
	return t.setReaction(ctx, chatID, messageID, []map[string]any{})
}

func (t *Transport) setReaction(ctx context.Context, chatID, messageID string, reaction []map[string]any) error {
	id, err := strconv.ParseInt(messageID, 10, 64)
	if err != nil {
		return fmt.Errorf("telegram reaction: bad message id %q: %w", messageID, err)
	}
	if err := t.api.call(ctx, "setMessageReaction", map[string]any{
		"chat_id":    chatID,
		"message_id": id,
		"reaction":   reaction,
	}, nil); err != nil {
		return fmt.Errorf("telegram reaction: %w", err)
	}
	return nil
}

// buildInlineKeyboard converts Button rows into Telegram's reply_markup
// shape. Returns nil when there are no buttons so the field is omitted.
func buildInlineKeyboard(rows [][]transport.Button) map[string]any {
	if len(rows) == 0 {
		return nil
	}
	keyboard := make([][]map[string]any, 0, len(rows))
	for _, row := range rows {
		if len(row) == 0 {
			continue
		}
		r := make([]map[string]any, 0, len(row))
		for _, b := range row {
			r = append(r, map[string]any{
				"text":          b.Text,
				"callback_data": truncateUTF8(b.Value, maxCallbackDataBytes),
			})
		}
		keyboard = append(keyboard, r)
	}
	if len(keyboard) == 0 {
		return nil
	}
	return map[string]any{"inline_keyboard": keyboard}
}

// truncateUTF8 cuts s to at most n bytes without splitting a rune.
func truncateUTF8(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && s[n]&0xC0 == 0x80 {
		n--
	}
	return s[:n]
}
