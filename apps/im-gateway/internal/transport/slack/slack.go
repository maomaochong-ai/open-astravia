// Package slack implements transport.Transport for Slack using Socket Mode.
//
// Socket Mode needs no public webhook: the socketmode.Client opens a
// WebSocket via apps.connections.open (authorized by the xapp- app-level
// token) and delivers Events API + interactive payloads over it. Outbound
// traffic goes through the regular Web API (xoxb- bot token).
//
// Inbound scope:
//   - DM (channel_type "im") message events are always processed (subject to
//     AllowedUserIDs); bot messages, self messages and edit subtypes are
//     ignored.
//   - Channel messages are only processed via app_mention events (the
//     <@BOTID> mention is stripped before forwarding).
//   - block_actions interactive callbacks are forwarded as InboundMessage
//     with ActionID set and Text carrying the pressed button's value.
//
// Every Socket Mode envelope is acked; Slack redelivers unacked envelopes.
//
// ChatID is the Slack channel ID and MessageID is the message ts — the pair
// (channel, ts) addresses a message in every Web API call we use.
package slack

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	slackapi "github.com/slack-go/slack"
	"github.com/slack-go/slack/slackevents"
	"github.com/slack-go/slack/socketmode"

	"vetta-im-gateway/internal/transport"
	"vetta-im-gateway/internal/transport/inbox"
)

// MaxInboundAttachmentBytes caps a single inbound file we will download +
// persist, mirroring the feishu/wechat transports' defensive ceiling.
const MaxInboundAttachmentBytes = 50 * 1024 * 1024

// inboundMediaHint is sent when a user shares files but the gateway has no
// inbox configured, so the bytes cannot be persisted for the agent.
const inboundMediaHint = "当前网关未配置附件收件目录，暂时无法接收文件，请发送文字消息。"

// Options configures Transport. BotToken + AppToken are required.
type Options struct {
	// BotToken is the Web API bot token ("xoxb-...").
	BotToken string
	// AppToken is the app-level token used for Socket Mode ("xapp-...").
	AppToken string
	// AllowedUserIDs restricts inbound processing to these Slack user IDs.
	// Empty allows every user.
	AllowedUserIDs []string
	// AllowedChannelIDs restricts inbound processing to these channel IDs
	// (IDs, not names). Empty allows every channel.
	AllowedChannelIDs []string
	// InboxDir is where inbound files are persisted (per-day subdirectory
	// via the shared inbox package). Empty disables inbound file handling —
	// files are dropped and the user gets a hint reply.
	InboxDir string
}

// Transport implements transport.Transport (and transport.Reactor) for Slack.
type Transport struct {
	opts            Options
	api             *slackapi.Client
	httpClient      *http.Client
	inboxDir        string
	allowedUsers    map[string]struct{}
	allowedChannels map[string]struct{}

	// botUserID is resolved via auth.test in Start, before the event loop
	// begins; the dispatch goroutines only ever read it.
	botUserID string

	closed atomic.Bool
	done   chan struct{}
}

// New constructs a Slack Transport. Validates the token prefixes so a
// swapped bot/app token pair fails fast instead of at connect time.
func New(opts Options) (*Transport, error) {
	if !strings.HasPrefix(opts.BotToken, "xoxb-") {
		return nil, errors.New(`slack transport: BotToken must start with "xoxb-"`)
	}
	if !strings.HasPrefix(opts.AppToken, "xapp-") {
		return nil, errors.New(`slack transport: AppToken must start with "xapp-"`)
	}
	t := &Transport{
		opts: opts,
		api: slackapi.New(opts.BotToken,
			slackapi.OptionAppLevelToken(opts.AppToken)),
		httpClient:      &http.Client{},
		inboxDir:        opts.InboxDir,
		allowedUsers:    toSet(opts.AllowedUserIDs),
		allowedChannels: toSet(opts.AllowedChannelIDs),
		done:            make(chan struct{}),
	}
	return t, nil
}

// Compile-time interface checks.
var (
	_ transport.Transport = (*Transport)(nil)
	_ transport.Reactor   = (*Transport)(nil)
)

func (t *Transport) Name() string { return "slack" }

func (t *Transport) Capabilities() transport.Capabilities {
	return transport.Capabilities{
		SupportsMessageEdit: true,
		// Slack Block Kit is not a card canvas in the feishu sense; rich
		// output is rendered as mrkdwn text + blocks, so Cards stays false.
		SupportsCards:      false,
		SupportsButtons:    true,
		SupportsFileUpload: true,
		SupportsThreads:    true,
		SupportsReactions:  true,
		// chat.postMessage truncates text past 40000 characters.
		MaxMessageLength: 40000,
	}
}

// Start resolves the bot identity, opens the Socket Mode connection, and
// blocks delivering inbound envelopes to handler until ctx is cancelled or
// Stop() is called.
func (t *Transport) Start(ctx context.Context, handler transport.MessageHandler) error {
	auth, err := t.api.AuthTestContext(ctx)
	if err != nil {
		return fmt.Errorf("slack auth test: %w", err)
	}
	t.botUserID = auth.UserID

	sm := socketmode.New(t.api)

	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- sm.RunContext(runCtx)
	}()
	go func() {
		for {
			select {
			case <-runCtx.Done():
				return
			case evt, ok := <-sm.Events:
				if !ok {
					return
				}
				t.dispatch(runCtx, sm, evt, handler)
			}
		}
	}()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.done:
		return nil
	case err := <-errCh:
		return err
	}
}

// Stop signals the connection to close. Safe to call multiple times; the
// underlying socketmode loop is torn down by Start's deferred cancel.
func (t *Transport) Stop() error {
	if t.closed.Swap(true) {
		return nil
	}
	close(t.done)
	return nil
}

// dispatch routes one socketmode event. Every envelope (evt.Request != nil)
// is acked first — Slack redelivers unacked envelopes, and none of our
// handlers produce a response payload. Connection lifecycle events
// (connecting/connected/hello/...) carry no envelope and are ignored.
func (t *Transport) dispatch(ctx context.Context, sm *socketmode.Client, evt socketmode.Event, handler transport.MessageHandler) {
	if evt.Request != nil {
		_ = sm.Ack(*evt.Request)
	}
	switch evt.Type {
	case socketmode.EventTypeEventsAPI:
		if apiEvt, ok := evt.Data.(slackevents.EventsAPIEvent); ok {
			_ = t.handleEventsAPI(ctx, apiEvt, handler)
		}
	case socketmode.EventTypeInteractive:
		if cb, ok := evt.Data.(slackapi.InteractionCallback); ok {
			_ = t.handleInteractive(ctx, cb, handler)
		}
	}
}

// handleEventsAPI translates one Events API callback into the gateway's
// normalized InboundMessage. Pure with respect to the socket: it can be
// exercised in tests with hand-built slackevents structs.
func (t *Transport) handleEventsAPI(ctx context.Context, apiEvt slackevents.EventsAPIEvent, handler transport.MessageHandler) error {
	if apiEvt.Type != slackevents.CallbackEvent {
		return nil
	}
	switch ev := apiEvt.InnerEvent.Data.(type) {
	case *slackevents.MessageEvent:
		return t.handleMessageEvent(ctx, ev, handler)
	case *slackevents.AppMentionEvent:
		return t.handleAppMention(ctx, ev, handler)
	}
	return nil
}

// handleMessageEvent processes DM ("im") message events. Channel messages
// arrive here too but are dropped — the bot only responds to channel
// traffic via app_mention.
func (t *Transport) handleMessageEvent(ctx context.Context, ev *slackevents.MessageEvent, handler transport.MessageHandler) error {
	if ev.ChannelType != slackevents.ChannelTypeIM {
		return nil
	}
	// SubType covers edits (message_changed), deletions, bot_message and
	// other non-user-authored shapes; BotID covers bot messages without a
	// subtype. Both must be empty for a plain user message.
	if ev.SubType != "" || ev.BotID != "" {
		return nil
	}
	if ev.User == "" || ev.User == t.botUserID {
		return nil
	}
	if !t.userAllowed(ev.User) || !t.channelAllowed(ev.Channel) {
		return nil
	}

	var files []slackapi.File
	if ev.Message != nil {
		files = ev.Message.Files
	}
	return t.forwardInbound(ctx, handler, transport.InboundMessage{
		Platform:  "slack",
		ChatID:    ev.Channel,
		UserID:    ev.User,
		MessageID: ev.TimeStamp,
		ReplyToID: ev.ThreadTimeStamp,
		Text:      strings.TrimSpace(ev.Text),
		Raw:       ev,
	}, files)
}

// handleAppMention processes channel messages that @-mention the bot.
func (t *Transport) handleAppMention(ctx context.Context, ev *slackevents.AppMentionEvent, handler transport.MessageHandler) error {
	if ev.BotID != "" || ev.User == "" || ev.User == t.botUserID {
		return nil
	}
	// A mention inside a DM already arrives as a message event; forwarding
	// both would double-deliver. DM channel IDs start with "D".
	if strings.HasPrefix(ev.Channel, "D") {
		return nil
	}
	if !t.userAllowed(ev.User) || !t.channelAllowed(ev.Channel) {
		return nil
	}
	return t.forwardInbound(ctx, handler, transport.InboundMessage{
		Platform:  "slack",
		ChatID:    ev.Channel,
		UserID:    ev.User,
		MessageID: ev.TimeStamp,
		ReplyToID: ev.ThreadTimeStamp,
		Text:      stripBotMention(ev.Text, t.botUserID),
		Raw:       ev,
	}, ev.Files)
}

// forwardInbound resolves inbound files (download + inbox persist) and hands
// the finished InboundMessage to the handler. Messages that end up with
// neither text nor attachments are dropped; if that happened because files
// could not be persisted (no inbox configured) the user gets a hint reply.
func (t *Transport) forwardInbound(ctx context.Context, handler transport.MessageHandler, msg transport.InboundMessage, files []slackapi.File) error {
	if len(files) > 0 {
		if t.inboxDir == "" {
			if msg.Text == "" {
				_, _ = t.SendMessage(ctx, msg.ChatID, transport.OutboundMessage{Text: inboundMediaHint})
				return nil
			}
		} else {
			msg.Attachments = t.collectInboundFiles(ctx, msg.MessageID, files)
		}
	}
	if msg.Text == "" && len(msg.Attachments) == 0 {
		return nil
	}
	msg.ReceivedAt = time.Now()
	return handler.HandleInbound(ctx, msg)
}

// collectInboundFiles downloads each shared file via its authenticated
// url_private_download and persists it to the inbox. Per-file failures are
// swallowed (the remaining files and the text still go through).
func (t *Transport) collectInboundFiles(ctx context.Context, msgID string, files []slackapi.File) []transport.Attachment {
	var out []transport.Attachment
	for i, f := range files {
		if f.URLPrivateDownload == "" {
			continue
		}
		b, err := t.downloadInboundFile(ctx, f.URLPrivateDownload)
		if err != nil {
			continue
		}
		name := f.Name
		if name == "" {
			name = fmt.Sprintf("file-%d", i)
		}
		filename := fmt.Sprintf("%s-%s", inbox.SanitizeForFilename(msgID), filepath.Base(name))
		absPath, err := inbox.Persist(t.inboxDir, filename, b)
		if err != nil {
			continue
		}
		kind := transport.AttachmentFile
		if strings.HasPrefix(f.Mimetype, "image/") {
			kind = transport.AttachmentImage
		}
		mime := f.Mimetype
		if mime == "" {
			mime = inbox.MimeFromExt(filepath.Ext(name))
		}
		out = append(out, transport.Attachment{
			Kind:     kind,
			Name:     filepath.Base(absPath),
			MimeType: mime,
			URL:      absPath,
		})
	}
	return out
}

// downloadInboundFile fetches one url_private_download resource. These URLs
// require the bot token as a Bearer header; an unauthenticated request gets
// an HTML login page instead of the bytes.
func (t *Transport) downloadInboundFile(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("slack download: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+t.opts.BotToken)
	resp, err := t.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("slack download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("slack download: unexpected status %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, MaxInboundAttachmentBytes+1))
	if err != nil {
		return nil, fmt.Errorf("slack download: %w", err)
	}
	if len(b) > MaxInboundAttachmentBytes {
		return nil, fmt.Errorf("slack download: file exceeds %d-byte cap", MaxInboundAttachmentBytes)
	}
	return b, nil
}

// handleInteractive translates block_actions callbacks into InboundMessages
// with ActionID set. One InboundMessage per pressed action (block_actions
// payloads carry exactly one for button presses).
func (t *Transport) handleInteractive(ctx context.Context, cb slackapi.InteractionCallback, handler transport.MessageHandler) error {
	if cb.Type != slackapi.InteractionTypeBlockActions {
		return nil
	}
	if !t.userAllowed(cb.User.ID) || !t.channelAllowed(cb.Channel.ID) {
		return nil
	}
	for _, action := range cb.ActionCallback.BlockActions {
		if action == nil {
			continue
		}
		actionID := action.ActionID
		if actionID == "" {
			actionID = cb.CallbackID
		}
		msg := transport.InboundMessage{
			Platform:   "slack",
			ChatID:     cb.Channel.ID,
			UserID:     cb.User.ID,
			MessageID:  cb.Message.Timestamp,
			Text:       action.Value,
			ActionID:   actionID,
			ReceivedAt: time.Now(),
			Raw:        cb,
		}
		if err := handler.HandleInbound(ctx, msg); err != nil {
			return err
		}
	}
	return nil
}

// SendMessage posts a new message via chat.postMessage. ReplyToID maps to
// thread_ts (the reply lands in the thread) and Buttons become Block Kit
// actions blocks below a section carrying the text.
func (t *Transport) SendMessage(ctx context.Context, chatID string, msg transport.OutboundMessage) (string, error) {
	text := markdownToMrkdwn(msg.Text)
	opts := []slackapi.MsgOption{slackapi.MsgOptionText(text, false)}
	if msg.ReplyToID != "" {
		opts = append(opts, slackapi.MsgOptionTS(msg.ReplyToID))
	}
	if len(msg.Buttons) > 0 {
		opts = append(opts, slackapi.MsgOptionBlocks(buildButtonBlocks(text, msg.Buttons)...))
	}
	_, ts, err := t.api.PostMessageContext(ctx, chatID, opts...)
	if err != nil {
		return "", fmt.Errorf("slack send: %w", err)
	}
	return ts, nil
}

// EditMessage replaces a message's content via chat.update.
func (t *Transport) EditMessage(ctx context.Context, chatID, messageID string, msg transport.OutboundMessage) error {
	text := markdownToMrkdwn(msg.Text)
	opts := []slackapi.MsgOption{slackapi.MsgOptionText(text, false)}
	if len(msg.Buttons) > 0 {
		opts = append(opts, slackapi.MsgOptionBlocks(buildButtonBlocks(text, msg.Buttons)...))
	}
	if _, _, _, err := t.api.UpdateMessageContext(ctx, chatID, messageID, opts...); err != nil {
		return fmt.Errorf("slack edit: %w", err)
	}
	return nil
}

// EndStream is a no-op: Slack has no server-side streaming state to close —
// streaming output is plain edit-in-place via chat.update.
func (t *Transport) EndStream(_ context.Context, _, _ string) error {
	return nil
}

// DeleteMessage removes a message via chat.delete.
func (t *Transport) DeleteMessage(ctx context.Context, chatID, messageID string) error {
	if _, _, err := t.api.DeleteMessageContext(ctx, chatID, messageID); err != nil {
		return fmt.Errorf("slack delete: %w", err)
	}
	return nil
}

// ShowTyping is a no-op: Slack's Web API exposes no typing indicator for
// bots (the RTM-era typing event is unavailable to Socket Mode apps).
func (t *Transport) ShowTyping(_ context.Context, _ string) error {
	return nil
}

// SendAttachment uploads a local file to the chat via the files upload flow
// (files.getUploadURLExternal → POST → files.completeUploadExternal, which
// needs both the channel and the exact file size). The caption travels as
// initial_comment. The returned ID is Slack's file ID — the upload API does
// not surface the ts of the share message.
func (t *Transport) SendAttachment(ctx context.Context, chatID string, att transport.OutboundAttachment) (string, error) {
	if chatID == "" {
		return "", errors.New("slack upload: chatID required")
	}
	if att.Path == "" {
		return "", errors.New("slack upload: attachment path required")
	}
	fi, err := os.Stat(att.Path)
	if err != nil {
		return "", fmt.Errorf("slack upload: %w", err)
	}
	sum, err := t.api.UploadFileContext(ctx, slackapi.UploadFileParameters{
		File:           att.Path,
		FileSize:       int(fi.Size()),
		Filename:       filepath.Base(att.Path),
		Channel:        chatID,
		InitialComment: att.Caption,
	})
	if err != nil {
		return "", fmt.Errorf("slack upload: %w", err)
	}
	return sum.ID, nil
}

// AddReaction attaches an emoji reaction via reactions.add. Reacting twice
// with the same emoji is treated as success.
func (t *Transport) AddReaction(ctx context.Context, chatID, messageID, emoji string) error {
	name, err := emojiToSlackName(emoji)
	if err != nil {
		return fmt.Errorf("slack reaction add: %w", err)
	}
	if err := t.api.AddReactionContext(ctx, name, slackapi.NewRefToMessage(chatID, messageID)); err != nil {
		if err.Error() == "already_reacted" {
			return nil
		}
		return fmt.Errorf("slack reaction add: %w", err)
	}
	return nil
}

// RemoveReaction removes a reaction via reactions.remove. Removing a
// reaction that is not present is a no-op per the Reactor contract.
func (t *Transport) RemoveReaction(ctx context.Context, chatID, messageID, emoji string) error {
	name, err := emojiToSlackName(emoji)
	if err != nil {
		return fmt.Errorf("slack reaction remove: %w", err)
	}
	if err := t.api.RemoveReactionContext(ctx, name, slackapi.NewRefToMessage(chatID, messageID)); err != nil {
		if err.Error() == "no_reaction" {
			return nil
		}
		return fmt.Errorf("slack reaction remove: %w", err)
	}
	return nil
}

// =============================================================================
// pure helpers
// =============================================================================

// emojiByName maps the unicode emoji the bridge uses to Slack reaction
// names. Slack's reactions API addresses emoji by name, never by codepoint.
var emojiByName = map[string]string{
	"👀":  "eyes",
	"✅":  "white_check_mark",
	"❌":  "x",
	"👍":  "thumbsup",
	"👎":  "thumbsdown",
	"🎉":  "tada",
	"❤️": "heart",
	"🚀":  "rocket",
	"⚠️": "warning",
}

func emojiToSlackName(emoji string) (string, error) {
	if name, ok := emojiByName[emoji]; ok {
		return name, nil
	}
	return "", fmt.Errorf("unsupported emoji %q", emoji)
}

// codeSpanRe matches fenced code blocks and inline code spans, which must
// pass through markdownToMrkdwn untouched.
var codeSpanRe = regexp.MustCompile("(?s)```.*?```|`[^`\n]*`")

var (
	mrkdwnLinkRe = regexp.MustCompile(`\[([^\]]+)\]\(([^)\s]+)\)`)
	mrkdwnBoldRe = regexp.MustCompile(`\*\*(.+?)\*\*`)
)

// markdownToMrkdwn converts standard markdown to Slack mrkdwn:
// **bold** → *bold*, [text](url) → <url|text>. Code blocks and inline code
// are left as-is (Slack renders standard backtick fences natively).
func markdownToMrkdwn(s string) string {
	spans := codeSpanRe.FindAllStringIndex(s, -1)
	var b strings.Builder
	prev := 0
	for _, span := range spans {
		b.WriteString(mrkdwnInline(s[prev:span[0]]))
		b.WriteString(s[span[0]:span[1]])
		prev = span[1]
	}
	b.WriteString(mrkdwnInline(s[prev:]))
	return b.String()
}

// mrkdwnInline applies the non-code transforms. Links first so bold markers
// inside link text are still visible to the bold pass afterwards.
func mrkdwnInline(s string) string {
	s = mrkdwnLinkRe.ReplaceAllString(s, "<$2|$1>")
	s = mrkdwnBoldRe.ReplaceAllString(s, "*$1*")
	return s
}

// stripBotMention removes <@BOTID> (and the <@BOTID|name> variant) tokens
// from an app_mention text so the agent receives a clean prompt.
func stripBotMention(text, botUserID string) string {
	if botUserID != "" {
		re := regexp.MustCompile(`<@` + regexp.QuoteMeta(botUserID) + `(\|[^>]*)?>`)
		text = re.ReplaceAllString(text, "")
	}
	return strings.TrimSpace(text)
}

// buildButtonBlocks renders text + inline keyboard rows as Block Kit: one
// mrkdwn section followed by one actions block per row. Each button's
// action_id is "vetta_btn_<row>_<col>" and its value round-trips back as
// InboundMessage.Text when pressed.
func buildButtonBlocks(text string, rows [][]transport.Button) []slackapi.Block {
	blocks := []slackapi.Block{
		slackapi.NewSectionBlock(
			slackapi.NewTextBlockObject(slackapi.MarkdownType, text, false, false),
			nil, nil),
	}
	for r, row := range rows {
		elems := make([]slackapi.BlockElement, 0, len(row))
		for c, btn := range row {
			elems = append(elems, slackapi.NewButtonBlockElement(
				fmt.Sprintf("vetta_btn_%d_%d", r, c),
				btn.Value,
				slackapi.NewTextBlockObject(slackapi.PlainTextType, btn.Text, false, false)))
		}
		blocks = append(blocks, slackapi.NewActionBlock(fmt.Sprintf("vetta_btn_row_%d", r), elems...))
	}
	return blocks
}

func (t *Transport) userAllowed(id string) bool {
	return len(t.allowedUsers) == 0 || contains(t.allowedUsers, id)
}

func (t *Transport) channelAllowed(id string) bool {
	return len(t.allowedChannels) == 0 || contains(t.allowedChannels, id)
}

func contains(set map[string]struct{}, id string) bool {
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
