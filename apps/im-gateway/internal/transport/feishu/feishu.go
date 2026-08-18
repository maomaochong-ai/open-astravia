// Package feishu implements transport.Transport for Feishu (Lark) using the
// official oapi-sdk-go/v3 long-connection event subscription.
//
// Personal mode does not need a public webhook: the SDK's ws.Client opens
// a long-running WebSocket to the Feishu open platform and the event
// dispatcher delivers messages to a handler we register. Outgoing messages
// go through the regular Im.Message API client.
//
// Outbound paths (selected per OutboundMessage.Streaming):
//
//   - One-shot replies (command output, errors, hints): a card JSON 2.0
//     with a single inline `markdown` element is sent directly via
//     `Im.Message.Create` with msg_type=interactive. One round trip.
//
//   - Streaming responses (LLM output via the bridge): the transport
//     creates a cardkit "card entity" first (`Cardkit.V1.Card.Create`)
//     with `streaming_mode: true`, then sends an `Im.Message.Create`
//     whose content references the card_id. Subsequent EditMessage calls
//     are routed to the cardkit content API
//     (`Cardkit.V1.CardElement.Content`) so the Feishu client renders the
//     incremental updates with a typewriter effect. EndStream flips
//     `streaming_mode` back to false on the underlying card so the
//     blinking cursor goes away.
//
// Scope:
//   - private chats only (group / topic_group are silently dropped per
//     the Non-Goals in the spec)
//   - inbound: text + image + file + post rich-text (downloaded to the
//     inbox and surfaced as `@<path>` mentions); audio / video /
//     merge_forward / sticker still get a hint reply and drop. See ADR-0008.
//   - outbound media via SendAttachment (image upload with file fallback,
//     file upload, caption as a follow-up text). See ADR-0008.
//   - automatic reconnect via SDK default behavior (autoReconnect=true,
//     unlimited retries, 2-minute interval)
//
// Card JSON 2.0 + cardkit streaming both require Feishu client ≥ 7.20.
package feishu

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcardkit "github.com/larksuite/oapi-sdk-go/v3/service/cardkit/v1"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	"github.com/larksuite/oapi-sdk-go/v3/event/dispatcher"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"

	"vetta-im-gateway/internal/transport"
	"vetta-im-gateway/internal/transport/inbox"
)

// MaxInboundAttachmentBytes caps a single inbound media we will download +
// persist. Feishu's own bot limits are smaller (image ≤10MB, file ≤30MB);
// this is a defensive ceiling so a misconfigured peer cannot OOM the
// gateway. Mirrors the wechat transport's cap.
const MaxInboundAttachmentBytes = 50 * 1024 * 1024

// streamElementID is the fixed element_id we assign to the single markdown
// component inside every streaming card. The cardkit content-update API
// addresses elements by id, so we need a stable name to patch into.
const streamElementID = "streaming_text"

// streamRegistryCap caps the number of in-flight streaming cards we
// remember. A streaming card lives only for the duration of one assistant
// turn (created on SendMessage(streaming=true), dropped on EndStream), so
// 256 is far more than the steady-state need; it exists purely to bound
// memory if a turn ever fails to call EndStream (e.g. context cancelled
// mid-turn).
const streamRegistryCap = 256

// Options configures Transport. AppID + AppSecret are required.
type Options struct {
	AppID     string
	AppSecret string

	// Domain optionally overrides the Feishu base URL (e.g. for the lark
	// international tenant). Empty defaults to the SDK's standard
	// open.feishu.cn endpoint.
	Domain string

	// LogLevel for the SDK's internal logger. Defaults to Warn.
	LogLevel larkcore.LogLevel

	// InboxDir is where the transport persists downloaded inbound media
	// (image / file / post-embedded images). Each file is written under a
	// per-day subdirectory via the shared inbox package. Empty disables
	// inbound media handling — image/file/post images are dropped and only
	// text survives, matching the text-only behaviour from before ADR-0008.
	InboxDir string
}

// streamHandle remembers what cardkit card backs an in-flight streaming
// IM message, and the last sequence number we sent. Sequences must be
// strictly monotonic within one card's streaming cycle (Feishu rejects
// non-increasing values) and Feishu's server parses the field as int32,
// so we use a per-card counter starting at 1 instead of a wall-clock
// timestamp (millisecond timestamps overflow int32; even second
// timestamps will overflow in 2038). The reference Python implementation
// in tarichuo/codex-feishu-bot does the same.
type streamHandle struct {
	cardID  string
	lastSeq int32
}

// Transport implements transport.Transport for Feishu.
type Transport struct {
	opts     Options
	api      *lark.Client
	ws       *larkws.Client
	inboxDir string
	mu       sync.Mutex
	closed   atomic.Bool
	done     chan struct{}

	// Streaming state. The map is keyed by IM message ID (what the bridge
	// holds onto) and stores the cardkit card_id we need for subsequent
	// content updates and the EndStream call. order tracks insertion order
	// for FIFO eviction. Both are guarded by streamMu (separate from mu so
	// streaming traffic doesn't contend with start/stop).
	streamMu sync.Mutex
	streams  map[string]*streamHandle
	order    []string
}

// New constructs a Feishu Transport. Validates required fields.
func New(opts Options) (*Transport, error) {
	if opts.AppID == "" || opts.AppSecret == "" {
		return nil, errors.New("feishu transport: AppID and AppSecret are required")
	}
	if opts.LogLevel == 0 {
		opts.LogLevel = larkcore.LogLevelWarn
	}

	apiOpts := []lark.ClientOptionFunc{
		lark.WithLogLevel(opts.LogLevel),
	}
	if opts.Domain != "" {
		apiOpts = append(apiOpts, lark.WithOpenBaseUrl(opts.Domain))
	}

	t := &Transport{
		opts:     opts,
		api:      lark.NewClient(opts.AppID, opts.AppSecret, apiOpts...),
		inboxDir: opts.InboxDir,
		done:     make(chan struct{}),
		streams:  make(map[string]*streamHandle),
	}
	return t, nil
}

// Compile-time interface check.
var _ transport.Transport = (*Transport)(nil)

func (t *Transport) Name() string { return "feishu" }

func (t *Transport) Capabilities() transport.Capabilities {
	return transport.Capabilities{
		// Streaming responses use the cardkit content-update API which
		// is purpose-built for incremental edits and not subject to the
		// im/messages PATCH "interactive only" limitation. The bridge
		// uses commitEdit ⇒ SendMessage(streaming=true) ⇒ repeated
		// EditMessage(streaming=true) ⇒ EndStream — see the package doc.
		SupportsMessageEdit: true,
		SupportsCards:       true,
		SupportsButtons:     true,
		SupportsFileUpload:  true,
		SupportsThreads:     true,
		// Feishu's text message body limit is 150KB. We pick a generous
		// 30000-character cap to leave headroom for JSON escaping.
		MaxMessageLength: 30000,
	}
}

// Start opens the long-connection and blocks delivering inbound messages
// to handler until ctx is cancelled or Stop() is called. Returns the
// underlying SDK's connect/run error, if any.
//
// The handler is invoked from inside the SDK's event dispatcher goroutine,
// so handlers MUST be cheap or hand off the message to a worker.
func (t *Transport) Start(ctx context.Context, handler transport.MessageHandler) error {
	d := dispatcher.NewEventDispatcher("", "").
		OnP2MessageReceiveV1(func(ctx context.Context, event *larkim.P2MessageReceiveV1) error {
			return t.handleInbound(ctx, event, handler)
		}).
		// Noop handlers for events Feishu always delivers but we don't use.
		// Without these, the SDK logs an [Error] line for every "user opened
		// the chat" or "user read a message" event, drowning the real logs.
		OnP2ChatAccessEventBotP2pChatEnteredV1(func(_ context.Context, _ *larkim.P2ChatAccessEventBotP2pChatEnteredV1) error {
			return nil
		}).
		OnP2MessageReadV1(func(_ context.Context, _ *larkim.P2MessageReadV1) error {
			return nil
		})

	wsOpts := []larkws.ClientOption{
		larkws.WithEventHandler(d),
		larkws.WithLogLevel(t.opts.LogLevel),
	}
	if t.opts.Domain != "" {
		wsOpts = append(wsOpts, larkws.WithDomain(t.opts.Domain))
	}

	t.mu.Lock()
	t.ws = larkws.NewClient(t.opts.AppID, t.opts.AppSecret, wsOpts...)
	t.mu.Unlock()

	// SDK Start blocks; run it on a goroutine so we can react to ctx and
	// Stop concurrently.
	errCh := make(chan error, 1)
	go func() {
		errCh <- t.ws.Start(ctx)
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

// Stop signals the connection to close. The SDK doesn't expose an explicit
// shutdown for ws.Client; we close our done channel to unblock Start, and
// rely on context cancellation from the caller to terminate the underlying
// connect/reconnect loop.
func (t *Transport) Stop() error {
	if t.closed.Swap(true) {
		return nil
	}
	close(t.done)
	return nil
}

// inboundMediaHint is the friendly reply sent for message types we still
// don't support (audio / video / merge_forward / sticker ...). Image, file
// and post are handled as of ADR-0008.
const inboundMediaHint = "暂不支持该消息类型（语音/视频/合并转发等），请发送文字、图片或文件。"

// handleInbound translates a Feishu P2MessageReceiveV1 event into the
// gateway's normalized InboundMessage and forwards it to the handler.
//
// Supported message types (ADR-0008):
//   - text:  plain text, @-mentions stripped.
//   - image: the image_key is downloaded + persisted to the inbox and
//     surfaced as an image Attachment.
//   - file:  the file_key is downloaded + persisted and surfaced as a file
//     Attachment.
//   - post:  the rich-text runs are flattened into Text and every embedded
//     image_key becomes an image Attachment.
//
// Filters:
//   - Group / topic_group chats are silently dropped (Non-Goal). The bot
//     still receives the events but does nothing.
//   - Other message types (audio / video / merge_forward / sticker) get a
//     friendly hint then drop.
//   - Bot-self messages should not loop back here (Feishu's open platform
//     doesn't deliver them) but we defensively check anyway.
//
// Media download happens synchronously here. larkws dispatches each inbound
// frame on its own goroutine (ws/client.go `go handleMessage`) and runs the
// ping loop independently, so a slow download blocks only this message, not
// heartbeats or other events.
func (t *Transport) handleInbound(ctx context.Context, event *larkim.P2MessageReceiveV1, handler transport.MessageHandler) error {
	if event == nil || event.Event == nil || event.Event.Message == nil || event.Event.Sender == nil {
		return nil
	}
	msg := event.Event.Message

	chatType := strVal(msg.ChatType)
	if chatType != "p2p" {
		// Group / topic_group: Non-Goal. Drop silently.
		return nil
	}

	userID := ""
	if event.Event.Sender.SenderId != nil {
		userID = strVal(event.Event.Sender.SenderId.OpenId)
	}
	if userID == "" {
		return nil
	}

	chatID := strVal(msg.ChatId)
	msgID := strVal(msg.MessageId)
	content := strVal(msg.Content)

	var text string
	var attachments []transport.Attachment

	switch strVal(msg.MessageType) {
	case "text":
		text = stripBotMentions(extractText(content), msg.Mentions)
	case "image":
		if key := extractImageKey(content); key != "" {
			if att, err := t.fetchInboundImage(ctx, msgID, 0, key); err == nil {
				attachments = append(attachments, att)
			}
		}
	case "file":
		if key, name := extractFileKey(content); key != "" {
			if att, err := t.fetchInboundFile(ctx, msgID, key, name); err == nil {
				attachments = append(attachments, att)
			}
		}
	case "post":
		var imageKeys []string
		text, imageKeys = extractPost(content)
		for i, key := range imageKeys {
			if att, err := t.fetchInboundImage(ctx, msgID, i, key); err == nil {
				attachments = append(attachments, att)
			}
		}
	default:
		if chatID != "" {
			_, _ = t.SendMessage(ctx, chatID, transport.OutboundMessage{Text: inboundMediaHint})
		}
		return nil
	}

	if text == "" && len(attachments) == 0 {
		// Either an empty text, or media whose downloads all failed (errors
		// are swallowed per-item above). Nothing useful to forward.
		return nil
	}

	inbound := transport.InboundMessage{
		Platform:    "feishu",
		ChatID:      chatID,
		UserID:      userID,
		MessageID:   msgID,
		Text:        text,
		Attachments: attachments,
		Raw:         event,
	}
	return handler.HandleInbound(ctx, inbound)
}

// fetchInboundImage downloads an image resource (image message or a
// post-embedded image), persists it to the inbox, and returns the
// resulting Attachment. Requires inboxDir to be set.
func (t *Transport) fetchInboundImage(ctx context.Context, msgID string, idx int, imageKey string) (transport.Attachment, error) {
	if t.inboxDir == "" {
		return transport.Attachment{}, errors.New("feishu: inbox dir not configured")
	}
	b, err := t.downloadResource(ctx, msgID, imageKey, "image")
	if err != nil {
		return transport.Attachment{}, err
	}
	ext := inbox.GuessImageExt(b)
	filename := fmt.Sprintf("%s-img-%d%s", inbox.SanitizeForFilename(msgID), idx, ext)
	absPath, err := inbox.Persist(t.inboxDir, filename, b)
	if err != nil {
		return transport.Attachment{}, err
	}
	return transport.Attachment{
		Kind:     transport.AttachmentImage,
		Name:     filepath.Base(absPath),
		MimeType: inbox.MimeFromExt(ext),
		URL:      absPath,
	}, nil
}

// fetchInboundFile downloads a file resource, persists it to the inbox, and
// returns the resulting Attachment. Requires inboxDir to be set.
func (t *Transport) fetchInboundFile(ctx context.Context, msgID, fileKey, name string) (transport.Attachment, error) {
	if t.inboxDir == "" {
		return transport.Attachment{}, errors.New("feishu: inbox dir not configured")
	}
	b, err := t.downloadResource(ctx, msgID, fileKey, "file")
	if err != nil {
		return transport.Attachment{}, err
	}
	if name == "" {
		name = "file.bin"
	}
	filename := fmt.Sprintf("%s-%s", inbox.SanitizeForFilename(msgID), filepath.Base(name))
	absPath, err := inbox.Persist(t.inboxDir, filename, b)
	if err != nil {
		return transport.Attachment{}, err
	}
	return transport.Attachment{
		Kind:     transport.AttachmentFile,
		Name:     filepath.Base(absPath),
		MimeType: inbox.MimeFromExt(filepath.Ext(name)),
		URL:      absPath,
	}, nil
}

// downloadResource fetches one message resource (image_key / file_key) via
// the authenticated Im.MessageResource.Get API. `typ` is "image" for image
// resources and "file" for everything else. Unlike wechat there is no
// decryption step — the SDK returns the plaintext bytes directly. The read
// is capped at MaxInboundAttachmentBytes.
func (t *Transport) downloadResource(ctx context.Context, msgID, fileKey, typ string) ([]byte, error) {
	if msgID == "" || fileKey == "" {
		return nil, errors.New("feishu resource: empty message_id or file_key")
	}
	req := larkim.NewGetMessageResourceReqBuilder().
		MessageId(msgID).
		FileKey(fileKey).
		Type(typ).
		Build()
	resp, err := t.api.Im.MessageResource.Get(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("feishu get resource: %w", err)
	}
	if !resp.Success() {
		return nil, fmt.Errorf("feishu get resource: %s (%d)", resp.Msg, resp.Code)
	}
	if resp.File == nil {
		return nil, errors.New("feishu get resource: empty body")
	}
	b, err := io.ReadAll(io.LimitReader(resp.File, MaxInboundAttachmentBytes+1))
	if err != nil {
		return nil, fmt.Errorf("feishu read resource: %w", err)
	}
	if len(b) > MaxInboundAttachmentBytes {
		return nil, fmt.Errorf("feishu resource exceeds %d-byte cap", MaxInboundAttachmentBytes)
	}
	return b, nil
}

// SendMessage delivers a message to the chat. Two paths:
//
//   - msg.Streaming=false: a one-shot card 2.0 markdown message sent
//     directly via Im.Message.Create. One round trip; no cardkit state.
//
//   - msg.Streaming=true: provision a cardkit card entity in streaming
//     mode, send an interactive message that references its card_id, and
//     remember the binding so subsequent EditMessage calls can patch the
//     card's content via the cardkit content API.
//
// Returns the platform message_id either way.
func (t *Transport) SendMessage(ctx context.Context, chatID string, msg transport.OutboundMessage) (string, error) {
	if msg.Streaming {
		return t.sendStreamingMessage(ctx, chatID, msg.Text)
	}
	return t.sendStaticCard(ctx, chatID, msg.Text)
}

// sendStaticCard is the simple one-shot path used by command replies,
// errors, and any other non-streaming output.
func (t *Transport) sendStaticCard(ctx context.Context, chatID, text string) (string, error) {
	body, err := encodeMarkdownCard(text)
	if err != nil {
		return "", err
	}
	return t.sendRawMessage(ctx, chatID, "interactive", body)
}

// sendRawMessage is the shared Im.Message.Create tail: it sends one message
// of the given msg_type with the already-encoded content string to chatID
// and returns the platform message_id. Used by the card, image, and file
// send paths.
func (t *Transport) sendRawMessage(ctx context.Context, chatID, msgType, content string) (string, error) {
	req := larkim.NewCreateMessageReqBuilder().
		ReceiveIdType("chat_id").
		Body(larkim.NewCreateMessageReqBodyBuilder().
			ReceiveId(chatID).
			MsgType(msgType).
			Content(content).
			Build()).
		Build()

	resp, err := t.api.Im.Message.Create(ctx, req)
	if err != nil {
		return "", fmt.Errorf("feishu send: %w", err)
	}
	if !resp.Success() {
		return "", fmt.Errorf("feishu send: %s (%d)", resp.Msg, resp.Code)
	}
	if resp.Data == nil || resp.Data.MessageId == nil {
		return "", errors.New("feishu send: missing message id in response")
	}
	return *resp.Data.MessageId, nil
}

// sendStreamingMessage provisions a cardkit card entity, switches it into
// streaming mode, sends it via the IM API as a `card`-type interactive
// message, and registers the resulting (message_id, card_id) binding so
// EditMessage / EndStream can find it.
//
// Order matters: streaming_mode must be enabled via Card.Settings BEFORE
// the IM message is sent. Setting `streaming_mode: true` inline in the
// initial Card.Create config does not take effect — verified against the
// reference impl in tarichuo/codex-feishu-bot. Without this step, all
// subsequent CardElement.Content calls are silently dropped and the user
// sees a card stuck at its initial content forever.
func (t *Transport) sendStreamingMessage(ctx context.Context, chatID, text string) (string, error) {
	cardJSON, err := encodeStreamingCardJSON(text)
	if err != nil {
		return "", err
	}

	createReq := larkcardkit.NewCreateCardReqBuilder().
		Body(larkcardkit.NewCreateCardReqBodyBuilder().
			Type("card_json").
			Data(cardJSON).
			Build()).
		Build()
	createResp, err := t.api.Cardkit.V1.Card.Create(ctx, createReq)
	if err != nil {
		return "", fmt.Errorf("feishu cardkit create: %w", err)
	}
	if !createResp.Success() {
		return "", fmt.Errorf("feishu cardkit create: %s (%d)", createResp.Msg, createResp.Code)
	}
	if createResp.Data == nil || createResp.Data.CardId == nil {
		return "", errors.New("feishu cardkit create: missing card_id in response")
	}
	cardID := *createResp.Data.CardId

	// Provisional handle so we can hand the registry a sequence counter and
	// keep numbering monotonic across enable/edit/end calls. Sequence
	// starts at 0; bumpSequence/nextSequence return 1, 2, 3, ...
	h := &streamHandle{cardID: cardID}

	// Enable streaming mode on the card. This MUST happen before we send
	// the IM message that references it.
	settingsJSON, err := encodeStreamingEnabledSettings()
	if err != nil {
		return "", err
	}
	settingsReq := larkcardkit.NewSettingsCardReqBuilder().
		CardId(cardID).
		Body(larkcardkit.NewSettingsCardReqBodyBuilder().
			Settings(settingsJSON).
			Sequence(int(t.bumpSequence(h))).
			Build()).
		Build()
	settingsResp, err := t.api.Cardkit.V1.Card.Settings(ctx, settingsReq)
	if err != nil {
		return "", fmt.Errorf("feishu cardkit settings(enable): %w", err)
	}
	if !settingsResp.Success() {
		return "", fmt.Errorf("feishu cardkit settings(enable): %s (%d)", settingsResp.Msg, settingsResp.Code)
	}

	// Reference the card_id from an interactive message. The IM API expects
	// content as a JSON string of {"type":"card","data":{"card_id":"..."}}.
	refBody, err := encodeCardReferenceContent(cardID)
	if err != nil {
		return "", err
	}
	imReq := larkim.NewCreateMessageReqBuilder().
		ReceiveIdType("chat_id").
		Body(larkim.NewCreateMessageReqBodyBuilder().
			ReceiveId(chatID).
			MsgType("interactive").
			Content(refBody).
			Build()).
		Build()
	imResp, err := t.api.Im.Message.Create(ctx, imReq)
	if err != nil {
		return "", fmt.Errorf("feishu send (cardkit): %w", err)
	}
	if !imResp.Success() {
		return "", fmt.Errorf("feishu send (cardkit): %s (%d)", imResp.Msg, imResp.Code)
	}
	if imResp.Data == nil || imResp.Data.MessageId == nil {
		return "", errors.New("feishu send (cardkit): missing message id in response")
	}
	messageID := *imResp.Data.MessageId
	t.adoptStream(messageID, h)
	return messageID, nil
}

// EditMessage updates a streaming message in place. The bridge only calls
// this for messages it created via SendMessage(streaming=true), so the
// (message_id → card_id) binding must already be registered. We push the
// new full text (raw markdown — NOT JSON-wrapped) to cardkit's content
// API which diffs against the previous content and renders the change as
// a typewriter effect on the client.
func (t *Transport) EditMessage(ctx context.Context, _ string, messageID string, msg transport.OutboundMessage) error {
	h := t.lookupStream(messageID)
	if h == nil {
		return fmt.Errorf("feishu edit: no streaming card for message %s", messageID)
	}

	seq := t.nextSequence(h)
	req := larkcardkit.NewContentCardElementReqBuilder().
		CardId(h.cardID).
		ElementId(streamElementID).
		Body(larkcardkit.NewContentCardElementReqBodyBuilder().
			Content(msg.Text).
			Sequence(int(seq)).
			Build()).
		Build()
	resp, err := t.api.Cardkit.V1.CardElement.Content(ctx, req)
	if err != nil {
		return fmt.Errorf("feishu cardkit content: %w", err)
	}
	if !resp.Success() {
		return fmt.Errorf("feishu cardkit content: %s (%d)", resp.Msg, resp.Code)
	}
	return nil
}

// EndStream marks a streaming card as finished by flipping streaming_mode
// off via the cardkit settings API, then drops the (message_id → card_id)
// binding. EndStream on an unknown message_id is a no-op (returning nil)
// so the bridge can call it unconditionally.
func (t *Transport) EndStream(ctx context.Context, _ string, messageID string) error {
	h := t.unregisterStream(messageID)
	if h == nil {
		return nil
	}
	seq := t.nextSequence(h)
	settingsJSON, err := encodeStreamingFinishedSettings()
	if err != nil {
		return err
	}
	req := larkcardkit.NewSettingsCardReqBuilder().
		CardId(h.cardID).
		Body(larkcardkit.NewSettingsCardReqBodyBuilder().
			Settings(settingsJSON).
			Sequence(int(seq)).
			Build()).
		Build()
	resp, err := t.api.Cardkit.V1.Card.Settings(ctx, req)
	if err != nil {
		return fmt.Errorf("feishu cardkit settings: %w", err)
	}
	if !resp.Success() {
		return fmt.Errorf("feishu cardkit settings: %s (%d)", resp.Msg, resp.Code)
	}
	return nil
}

// DeleteMessage removes a previously sent message.
func (t *Transport) DeleteMessage(ctx context.Context, _ string, messageID string) error {
	req := larkim.NewDeleteMessageReqBuilder().MessageId(messageID).Build()
	resp, err := t.api.Im.Message.Delete(ctx, req)
	if err != nil {
		return fmt.Errorf("feishu delete: %w", err)
	}
	if !resp.Success() {
		return fmt.Errorf("feishu delete: %s (%d)", resp.Msg, resp.Code)
	}
	return nil
}

// ShowTyping is a no-op on Feishu — the open platform doesn't expose a
// typing indicator API for bots. Returning nil keeps the bridge happy.
func (t *Transport) ShowTyping(_ context.Context, _ string) error {
	return nil
}

// SendAttachment uploads a local file to Feishu and sends it to the chat as
// an image or generic file (ADR-0008).
//
//   - kind=image: upload via Im.Image.Create → send msg_type=image. If the
//     upload fails (Feishu's image API only accepts jpg/png/webp/gif/bmp and
//     enforces a size cap), fall back to sending it as a file so the user
//     still receives the bytes.
//   - kind=file: upload via Im.File.Create (FileType derived from the
//     extension, default "stream") → send msg_type=file.
//
// A non-empty caption is sent as a follow-up text card (mirrors wechat).
// Best-effort: a caption failure does not undo the attachment send. Feishu
// has no per-peer quota, so unlike wechat there is no quota gating.
func (t *Transport) SendAttachment(ctx context.Context, chatID string, att transport.OutboundAttachment) (string, error) {
	if chatID == "" {
		return "", errors.New("feishu: chatID required")
	}
	if att.Path == "" {
		return "", errors.New("feishu: attachment path required")
	}

	var (
		messageID string
		err       error
	)
	switch att.Kind {
	case transport.AttachmentImage:
		messageID, err = t.sendImage(ctx, chatID, att.Path)
		if err != nil {
			// Format/size reject (svg, oversized tiff, ...): fall back to a
			// plain file send so the user still gets the bytes.
			messageID, err = t.sendFile(ctx, chatID, att.Path)
		}
	case transport.AttachmentFile, "":
		messageID, err = t.sendFile(ctx, chatID, att.Path)
	default:
		return "", fmt.Errorf("feishu: unsupported attachment kind %q", att.Kind)
	}
	if err != nil {
		return "", err
	}

	if att.Caption != "" {
		// Best effort; swallow caption errors (the attachment already landed).
		_, _ = t.sendStaticCard(ctx, chatID, att.Caption)
	}
	return messageID, nil
}

// sendImage uploads the file at path as a message image and sends it. The
// caller falls back to sendFile when this returns an error.
func (t *Transport) sendImage(ctx context.Context, chatID, path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("feishu: open image: %w", err)
	}
	defer f.Close()

	up, err := t.api.Im.Image.Create(ctx, larkim.NewCreateImageReqBuilder().
		Body(larkim.NewCreateImageReqBodyBuilder().
			ImageType(larkim.ImageTypeMessage).
			Image(f).
			Build()).
		Build())
	if err != nil {
		return "", fmt.Errorf("feishu image upload: %w", err)
	}
	if !up.Success() {
		return "", fmt.Errorf("feishu image upload: %s (%d)", up.Msg, up.Code)
	}
	if up.Data == nil || up.Data.ImageKey == nil {
		return "", errors.New("feishu image upload: missing image_key")
	}
	content, err := (&larkim.MessageImage{ImageKey: *up.Data.ImageKey}).String()
	if err != nil {
		return "", fmt.Errorf("feishu image content: %w", err)
	}
	return t.sendRawMessage(ctx, chatID, larkim.MsgTypeImage, content)
}

// sendFile uploads the file at path and sends it as a msg_type=file message.
func (t *Transport) sendFile(ctx context.Context, chatID, path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("feishu: open file: %w", err)
	}
	defer f.Close()

	fileName := filepath.Base(path)
	up, err := t.api.Im.File.Create(ctx, larkim.NewCreateFileReqBuilder().
		Body(larkim.NewCreateFileReqBodyBuilder().
			FileType(feishuFileType(fileName)).
			FileName(fileName).
			File(f).
			Build()).
		Build())
	if err != nil {
		return "", fmt.Errorf("feishu file upload: %w", err)
	}
	if !up.Success() {
		return "", fmt.Errorf("feishu file upload: %s (%d)", up.Msg, up.Code)
	}
	if up.Data == nil || up.Data.FileKey == nil {
		return "", errors.New("feishu file upload: missing file_key")
	}
	content, err := (&larkim.MessageFile{FileKey: *up.Data.FileKey}).String()
	if err != nil {
		return "", fmt.Errorf("feishu file content: %w", err)
	}
	return t.sendRawMessage(ctx, chatID, larkim.MsgTypeFile, content)
}

// =============================================================================
// helpers
// =============================================================================

// encodeMarkdownCard wraps a markdown string into a Feishu card JSON 2.0
// payload that renders as a single markdown element. The result is the
// stringified JSON expected by `Im.Message.Create` when MsgType is
// "interactive". JSON encoding handles all escaping.
//
// Used by the non-streaming send path (one-shot replies). Card JSON 2.0
// requires Feishu client ≥ 7.20.
func encodeMarkdownCard(markdown string) (string, error) {
	card := map[string]any{
		"schema": "2.0",
		"config": map[string]any{
			"update_multi": true,
		},
		"body": map[string]any{
			"elements": []any{
				map[string]any{
					"tag":     "markdown",
					"content": markdown,
				},
			},
		},
	}
	body, err := json.Marshal(card)
	if err != nil {
		return "", fmt.Errorf("encode markdown card: %w", err)
	}
	return string(body), nil
}

// encodeStreamingCardJSON builds the card JSON 2.0 body handed to cardkit's
// Card.Create. It pins a stable element_id on the markdown element so
// CardElement.Content can address it later.
//
// Notably it does NOT set `streaming_mode: true` here. Empirically that
// flag has no effect when set inline at create time — it must be enabled
// in a separate Card.Settings call BEFORE the IM message that references
// the card_id is sent. See sendStreamingMessage.
//
// `initial` is the markdown body to seed the card with. Empty string is
// allowed; the bridge guards against creating a card before the buffer
// has any text, but we still substitute a single space if the caller
// passes empty so the card has something to render against on the first
// frame.
func encodeStreamingCardJSON(initial string) (string, error) {
	if initial == "" {
		initial = " "
	}
	card := map[string]any{
		"schema": "2.0",
		"config": map[string]any{
			"update_multi":     true,
			"wide_screen_mode": true,
		},
		"body": map[string]any{
			"elements": []any{
				map[string]any{
					"tag":        "markdown",
					"element_id": streamElementID,
					"content":    initial,
				},
			},
		},
	}
	body, err := json.Marshal(card)
	if err != nil {
		return "", fmt.Errorf("encode streaming card: %w", err)
	}
	return string(body), nil
}

// encodeStreamingEnabledSettings produces the partial card-settings JSON
// the cardkit Settings endpoint expects to switch a card INTO streaming
// mode. Used by sendStreamingMessage right after Card.Create.
func encodeStreamingEnabledSettings() (string, error) {
	body, err := json.Marshal(map[string]any{
		"config": map[string]any{
			"streaming_mode": true,
		},
	})
	if err != nil {
		return "", fmt.Errorf("encode streaming-enabled settings: %w", err)
	}
	return string(body), nil
}

// encodeCardReferenceContent builds the JSON the IM messages-create
// endpoint expects when sending an interactive card by reference (rather
// than inlining the card body): {"type":"card","data":{"card_id":"..."}}.
func encodeCardReferenceContent(cardID string) (string, error) {
	body, err := json.Marshal(map[string]any{
		"type": "card",
		"data": map[string]any{
			"card_id": cardID,
		},
	})
	if err != nil {
		return "", fmt.Errorf("encode card reference: %w", err)
	}
	return string(body), nil
}

// encodeStreamingFinishedSettings produces the partial card-settings JSON
// the cardkit Settings endpoint expects to flip a card out of streaming
// mode. We only touch streaming_mode; everything else stays as it was.
func encodeStreamingFinishedSettings() (string, error) {
	body, err := json.Marshal(map[string]any{
		"config": map[string]any{
			"streaming_mode": false,
		},
	})
	if err != nil {
		return "", fmt.Errorf("encode streaming-finished settings: %w", err)
	}
	return string(body), nil
}

// =============================================================================
// streaming registry
// =============================================================================

// registerStream stores a (message_id → card_id) binding, evicting the
// oldest entry FIFO if we're at capacity. Sequence starts at 0;
// nextSequence/bumpSequence will hand out 1, 2, 3, ... in order.
func (t *Transport) registerStream(messageID, cardID string) {
	t.adoptStream(messageID, &streamHandle{cardID: cardID})
}

// adoptStream stores an existing streamHandle (carrying its already-bumped
// sequence counter) under messageID. Used by sendStreamingMessage which
// has to issue a Settings call with a sequence BEFORE the message_id is
// known.
func (t *Transport) adoptStream(messageID string, h *streamHandle) {
	t.streamMu.Lock()
	defer t.streamMu.Unlock()
	if _, exists := t.streams[messageID]; exists {
		t.streams[messageID] = h
		return
	}
	if len(t.streams) >= streamRegistryCap {
		oldest := t.order[0]
		t.order = t.order[1:]
		delete(t.streams, oldest)
	}
	t.streams[messageID] = h
	t.order = append(t.order, messageID)
}

// bumpSequence advances the sequence counter on a streamHandle that may
// not yet be registered (used during the create/enable flow before we
// know the message_id). Identical bookkeeping to nextSequence.
func (t *Transport) bumpSequence(h *streamHandle) int32 {
	t.streamMu.Lock()
	defer t.streamMu.Unlock()
	h.lastSeq++
	return h.lastSeq
}

func (t *Transport) lookupStream(messageID string) *streamHandle {
	t.streamMu.Lock()
	defer t.streamMu.Unlock()
	return t.streams[messageID]
}

func (t *Transport) unregisterStream(messageID string) *streamHandle {
	t.streamMu.Lock()
	defer t.streamMu.Unlock()
	h := t.streams[messageID]
	if h == nil {
		return nil
	}
	delete(t.streams, messageID)
	for i, id := range t.order {
		if id == messageID {
			t.order = append(t.order[:i], t.order[i+1:]...)
			break
		}
	}
	return h
}

// nextSequence returns the next strictly-increasing sequence number for
// the given stream — simply the per-card counter incremented by one.
func (t *Transport) nextSequence(h *streamHandle) int32 {
	t.streamMu.Lock()
	defer t.streamMu.Unlock()
	h.lastSeq++
	return h.lastSeq
}

// extractText pulls the user-visible text out of Feishu's text-message
// content envelope (`{"text":"..."}`). Returns empty string when the
// content is not parseable as a text message.
func extractText(content string) string {
	if content == "" {
		return ""
	}
	var v struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal([]byte(content), &v); err != nil {
		return ""
	}
	return v.Text
}

// extractImageKey pulls image_key out of an image message's content
// envelope (`{"image_key":"img_v2_..."}`).
func extractImageKey(content string) string {
	var v struct {
		ImageKey string `json:"image_key"`
	}
	if err := json.Unmarshal([]byte(content), &v); err != nil {
		return ""
	}
	return v.ImageKey
}

// extractFileKey pulls file_key + file_name out of a file message's content
// envelope (`{"file_key":"file_v2_...","file_name":"report.pdf"}`).
func extractFileKey(content string) (key, name string) {
	var v struct {
		FileKey  string `json:"file_key"`
		FileName string `json:"file_name"`
	}
	if err := json.Unmarshal([]byte(content), &v); err != nil {
		return "", ""
	}
	return v.FileKey, v.FileName
}

// postNode is one inline element of a post (rich-text) message paragraph.
type postNode struct {
	Tag      string `json:"tag"`
	Text     string `json:"text"`
	Href     string `json:"href"`
	UserName string `json:"user_name"`
	ImageKey string `json:"image_key"`
}

// extractPost flattens a post (rich-text) message into plain text plus the
// list of embedded image_keys, in document order. The content envelope is
// `{"title":"...","content":[[node, ...], ...]}` where the outer array is
// paragraphs and the inner array is inline nodes. Links render as
// "text(href)", @-mentions as "@name", and img nodes contribute an
// image_key (their text placeholder is dropped).
func extractPost(content string) (text string, imageKeys []string) {
	var v struct {
		Title   string       `json:"title"`
		Content [][]postNode `json:"content"`
	}
	if err := json.Unmarshal([]byte(content), &v); err != nil {
		return "", nil
	}
	var sb strings.Builder
	if v.Title != "" {
		sb.WriteString(v.Title)
		sb.WriteString("\n")
	}
	for _, line := range v.Content {
		for _, node := range line {
			switch node.Tag {
			case "text":
				sb.WriteString(node.Text)
			case "a":
				if node.Href != "" {
					sb.WriteString(node.Text + "(" + node.Href + ")")
				} else {
					sb.WriteString(node.Text)
				}
			case "at":
				sb.WriteString("@" + node.UserName)
			case "img":
				if node.ImageKey != "" {
					imageKeys = append(imageKeys, node.ImageKey)
				}
			}
		}
		sb.WriteString("\n")
	}
	return strings.TrimSpace(sb.String()), imageKeys
}

// feishuFileType maps a filename extension to the Feishu file_type enum used
// by Im.File.Create. The typed values give the client a proper preview
// (PDF/Office/video); everything else falls back to "stream", which always
// works but renders as a generic file.
func feishuFileType(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".pdf":
		return "pdf"
	case ".doc", ".docx":
		return "doc"
	case ".xls", ".xlsx":
		return "xls"
	case ".ppt", ".pptx":
		return "ppt"
	case ".mp4":
		return "mp4"
	case ".opus":
		return "opus"
	}
	return "stream"
}

// stripBotMentions removes leading "@bot " noise from message text. Feishu
// delivers @-mentions as a separate Mentions array; the inline text still
// contains "@_user_1" or similar tokens that the user did not literally
// type. We blunt-strip them so the agent receives clean prompts.
func stripBotMentions(text string, mentions []*larkim.MentionEvent) string {
	if len(mentions) == 0 {
		return strings.TrimSpace(text)
	}
	for _, m := range mentions {
		if m == nil || m.Key == nil {
			continue
		}
		text = strings.ReplaceAll(text, *m.Key, "")
	}
	return strings.TrimSpace(text)
}

func strVal(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
