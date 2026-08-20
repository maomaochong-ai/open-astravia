// Package whatsapp implements transport.Transport over the WhatsApp
// multi-device web protocol via whatsmeow (personal account, QR pairing).
//
// Session model (mirrors the wechat transport): credentials live in a local
// sqlite database managed by whatsmeow's sqlstore. Start returns
// ErrNotLoggedIn while the device is unpaired; the host layer drives the
// pairing flow through the non-Transport helpers LoggedIn / PairQR / Logout.
// A successful QR pairing persists the credentials into the store
// automatically, so subsequent Start calls connect directly.
//
// Scope:
//   - private chats (optionally filtered by an E.164 allowlist) and group
//     chats where the bot is @-mentioned
//   - inbound text + image/document/audio/video media (downloaded to the
//     inbox, mirroring feishu/wechat per ADR-0006/0008)
//   - outbound text (minimal markdown → WhatsApp formatting), replies,
//     edits (server-enforced ~20-minute window), revokes, reactions,
//     typing indicators, and image/file attachments
package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"

	"vetta-im-gateway/internal/transport"

	// Register the pure-Go sqlite driver under the name "sqlite" for
	// database/sql, which sqlstore.New opens by dialect name.
	_ "modernc.org/sqlite"
)

// MaxAttachmentBytes caps a single attachment in either direction. WhatsApp's
// own document limit is higher (2GB); this is a defensive ceiling so a huge
// file cannot OOM the gateway (mirrors feishu/wechat).
const MaxAttachmentBytes = 50 * 1024 * 1024

// ErrNotLoggedIn is returned by Start while the sqlite store holds no paired
// session. The host layer uses it to trigger the QR binding flow (PairQR).
var ErrNotLoggedIn = errors.New("whatsapp: not logged in")

// inboundMediaHint is the friendly reply for media messages received while
// no InboxDir is configured (mirrors feishu's inboundMediaHint).
const inboundMediaHint = "暂不支持接收媒体消息（未配置收件目录），请发送文字。"

// quoteRegistryCap bounds the inbound messageID → sender map used to fill
// ContextInfo.Participant on replies and reactions. Entries are only needed
// for messages the agent may still reply to, so a small FIFO window suffices.
const quoteRegistryCap = 512

// Options configures Transport construction.
type Options struct {
	// StatePath is the sqlite file holding the whatsmeow session store
	// (credentials, prekeys, app state). Required.
	StatePath string

	// AllowedNumbers optionally restricts private chats to these E.164
	// numbers (e.g. "+8613800138000"). Empty allows everyone. Group
	// messages are gated by @-mention instead and ignore this list.
	AllowedNumbers []string

	// InboxDir is where inbound media is persisted (per-day subdirs via the
	// shared inbox package). Empty disables inbound media: media-only
	// messages get a hint reply and are dropped.
	InboxDir string
}

// PairEvent is one step of the QR pairing flow emitted by PairQR.
type PairEvent struct {
	QRCode string // non-empty: render this code for the user to scan
	Done   bool   // pairing succeeded; credentials are persisted
	Err    error  // pairing failed / timed out; terminal
}

// Transport implements transport.Transport (and transport.Reactor) for
// WhatsApp. Construct via New; the zero value is not usable.
type Transport struct {
	client    *whatsmeow.Client
	container *sqlstore.Container
	inboxDir  string
	allowed   map[string]struct{} // digits-only numbers; empty = allow all

	// Self identity, filled at Start from the paired device. Kept as plain
	// fields (not read from client.Store) so normalizeMessage is directly
	// testable without a live client.
	selfUser string // phone-number JID user part
	selfLID  string // hidden-user (LID) JID user part, may be empty

	// quotes maps recent inbound message IDs to their sender JID string so
	// outbound replies/reactions can fill ContextInfo.Participant / the
	// reaction key sender. FIFO-bounded by quoteRegistryCap.
	quoteMu    sync.Mutex
	quotes     map[string]string
	quoteOrder []string

	closed atomic.Bool
	done   chan struct{}
}

// Compile-time interface checks.
var (
	_ transport.Transport = (*Transport)(nil)
	_ transport.Reactor   = (*Transport)(nil)
)

// New opens (creating if needed) the sqlite session store and constructs the
// Transport. New succeeds regardless of pairing state; Start reports
// ErrNotLoggedIn when the store has no session.
func New(opts Options) (*Transport, error) {
	if opts.StatePath == "" {
		return nil, errors.New("whatsapp: Options.StatePath is required")
	}
	dsn := "file:" + opts.StatePath + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(10000)"
	container, err := sqlstore.New(context.Background(), "sqlite", dsn, waLog.Noop)
	if err != nil {
		return nil, fmt.Errorf("whatsapp open store: %w", err)
	}
	device, err := container.GetFirstDevice(context.Background())
	if err != nil {
		return nil, fmt.Errorf("whatsapp load device: %w", err)
	}
	return &Transport{
		client:    whatsmeow.NewClient(device, waLog.Noop),
		container: container,
		inboxDir:  opts.InboxDir,
		allowed:   normalizeAllowedNumbers(opts.AllowedNumbers),
		quotes:    make(map[string]string),
		done:      make(chan struct{}),
	}, nil
}

func (t *Transport) Name() string { return "whatsapp" }

func (t *Transport) Capabilities() transport.Capabilities {
	return transport.Capabilities{
		SupportsMessageEdit: true,
		SupportsCards:       false,
		SupportsButtons:     false, // interactive messages are unreliable for personal accounts; numbered fallback instead
		SupportsFileUpload:  true,
		SupportsThreads:     true, // quoted replies via ContextInfo.StanzaID
		SupportsReactions:   true,
		// WhatsApp's practical text ceiling is 65536; leave headroom.
		MaxMessageLength: 60000,
	}
}

// LoggedIn reports whether the store holds a paired session. Not part of
// transport.Transport — the host layer uses it to decide whether to run the
// pairing flow.
func (t *Transport) LoggedIn() bool {
	return t.client.Store.ID != nil
}

// PairQR runs the QR pairing flow. It emits a PairEvent with a fresh QRCode
// each time the previous code expires, then a terminal event with Done=true
// (credentials persisted to the store) or Err set. The returned channel is
// closed after the terminal event. Must not be called while Start is running.
func (t *Transport) PairQR(ctx context.Context) (<-chan PairEvent, error) {
	if t.LoggedIn() {
		return nil, errors.New("whatsapp pair: already logged in")
	}
	// GetQRChannel must be called before Connect.
	qrChan, err := t.client.GetQRChannel(ctx)
	if err != nil {
		return nil, fmt.Errorf("whatsapp pair: %w", err)
	}
	if err := t.client.Connect(); err != nil {
		return nil, fmt.Errorf("whatsapp pair connect: %w", err)
	}
	out := make(chan PairEvent, 8)
	go func() {
		defer close(out)
		for item := range qrChan {
			switch item.Event {
			case whatsmeow.QRChannelEventCode:
				out <- PairEvent{QRCode: item.Code}
			case whatsmeow.QRChannelSuccess.Event:
				out <- PairEvent{Done: true}
			case whatsmeow.QRChannelEventError:
				out <- PairEvent{Err: fmt.Errorf("whatsapp pair: %w", item.Error)}
			default:
				// timeout / client-outdated / unexpected-state — all terminal.
				out <- PairEvent{Err: fmt.Errorf("whatsapp pair: %s", item.Event)}
			}
		}
	}()
	return out, nil
}

// Logout unlinks this device from the account and wipes the session from the
// store. Requires an active connection (Connect is attempted if needed).
func (t *Transport) Logout(ctx context.Context) error {
	if !t.client.IsConnected() {
		if err := t.client.Connect(); err != nil && !errors.Is(err, whatsmeow.ErrAlreadyConnected) {
			return fmt.Errorf("whatsapp logout connect: %w", err)
		}
	}
	if err := t.client.Logout(ctx); err != nil {
		return fmt.Errorf("whatsapp logout: %w", err)
	}
	return nil
}

// Start connects and blocks delivering inbound messages to handler until ctx
// is cancelled, Stop is called, or the server logs the device out (in which
// case the returned error wraps ErrNotLoggedIn so the host can rebind).
// Returns ErrNotLoggedIn immediately when the store has no paired session.
func (t *Transport) Start(ctx context.Context, handler transport.MessageHandler) error {
	if !t.LoggedIn() {
		return fmt.Errorf("whatsapp start: %w", ErrNotLoggedIn)
	}
	t.selfUser = t.client.Store.ID.User
	if !t.client.Store.LID.IsEmpty() {
		t.selfLID = t.client.Store.LID.User
	}

	fatal := make(chan error, 1)
	handlerID := t.client.AddEventHandler(func(rawEvt any) {
		switch evt := rawEvt.(type) {
		case *events.Message:
			t.handleMessage(ctx, evt, handler)
		case *events.LoggedOut:
			select {
			case fatal <- fmt.Errorf("whatsapp: server logged out this device (reason %s): %w", evt.Reason, ErrNotLoggedIn):
			default:
			}
			// events.Disconnected is deliberately ignored: whatsmeow
			// auto-reconnects (EnableAutoReconnect defaults to true).
		}
	})
	defer t.client.RemoveEventHandler(handlerID)

	if err := t.client.Connect(); err != nil && !errors.Is(err, whatsmeow.ErrAlreadyConnected) {
		return fmt.Errorf("whatsapp connect: %w", err)
	}
	defer t.client.Disconnect()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.done:
		return nil
	case err := <-fatal:
		return err
	}
}

// Stop signals Start to return and disconnects. Safe to call multiple times.
func (t *Transport) Stop() error {
	if t.closed.Swap(true) {
		return nil
	}
	close(t.done)
	t.client.Disconnect()
	return nil
}

// handleMessage is the events.Message entry point: normalize, resolve media,
// forward to the handler. Runs on whatsmeow's event dispatch goroutine.
func (t *Transport) handleMessage(ctx context.Context, evt *events.Message, handler transport.MessageHandler) {
	msg, ok := t.normalizeMessage(evt)
	if !ok {
		return
	}
	t.rememberQuote(evt.Info.ID, evt.Info.Sender.ToNonAD().String())

	parts := mediaParts(evt.Message)
	if len(parts) > 0 {
		if t.inboxDir == "" {
			if msg.Text == "" {
				// Media-only message and nowhere to put it: hint and drop.
				_, _ = t.SendMessage(ctx, msg.ChatID, transport.OutboundMessage{Text: inboundMediaHint})
				return
			}
			// Caption survives as text; media silently dropped.
		} else {
			msg.Attachments = t.downloadAttachments(ctx, evt.Info.ID, parts)
		}
	}
	if msg.Text == "" && len(msg.Attachments) == 0 {
		return
	}
	_ = handler.HandleInbound(ctx, *msg)
}

// SendMessage sends one text message. Markdown is minimally converted to
// WhatsApp formatting; Buttons render as a numbered plain-text list.
func (t *Transport) SendMessage(ctx context.Context, chatID string, msg transport.OutboundMessage) (string, error) {
	jid, err := parseChatJID(chatID)
	if err != nil {
		return "", fmt.Errorf("whatsapp send: %w", err)
	}
	resp, err := t.client.SendMessage(ctx, jid, &waE2E.Message{
		ExtendedTextMessage: t.buildExtendedText(jid, msg),
	})
	if err != nil {
		return "", fmt.Errorf("whatsapp send: %w", err)
	}
	return resp.ID, nil
}

// buildExtendedText renders an OutboundMessage into an ExtendedTextMessage,
// attaching the minimal quoted-reply ContextInfo when ReplyToID is set. The
// QuotedMessage placeholder is required by WhatsApp clients to render the
// quote bubble; its content is not verified against the original.
func (t *Transport) buildExtendedText(chat types.JID, msg transport.OutboundMessage) *waE2E.ExtendedTextMessage {
	text := markdownToWhatsApp(msg.Text)
	if len(msg.Buttons) > 0 {
		text += renderButtonsFallback(msg.Buttons)
	}
	ext := &waE2E.ExtendedTextMessage{Text: ptrString(text)}
	if msg.ReplyToID != "" {
		ext.ContextInfo = &waE2E.ContextInfo{
			StanzaID:      ptrString(msg.ReplyToID),
			Participant:   ptrString(t.quoteParticipant(msg.ReplyToID, chat)),
			QuotedMessage: &waE2E.Message{Conversation: ptrString("")},
		}
	}
	return ext
}

// EditMessage replaces the content of a previously sent message. WhatsApp
// enforces an edit window server-side (whatsmeow.EditWindow, currently 20
// minutes); out-of-window errors are returned as-is.
func (t *Transport) EditMessage(ctx context.Context, chatID, messageID string, msg transport.OutboundMessage) error {
	jid, err := parseChatJID(chatID)
	if err != nil {
		return fmt.Errorf("whatsapp edit: %w", err)
	}
	edit := t.client.BuildEdit(jid, messageID, &waE2E.Message{
		ExtendedTextMessage: t.buildExtendedText(jid, msg),
	})
	if _, err := t.client.SendMessage(ctx, jid, edit); err != nil {
		return fmt.Errorf("whatsapp edit: %w", err)
	}
	return nil
}

// EndStream is a no-op: WhatsApp has no dedicated streaming path; the bridge
// streams via EditMessage.
func (t *Transport) EndStream(_ context.Context, _, _ string) error { return nil }

// DeleteMessage revokes a previously sent message for everyone.
func (t *Transport) DeleteMessage(ctx context.Context, chatID, messageID string) error {
	jid, err := parseChatJID(chatID)
	if err != nil {
		return fmt.Errorf("whatsapp delete: %w", err)
	}
	// Empty sender = own message (BuildMessageKey sets FromMe=true).
	revoke := t.client.BuildRevoke(jid, types.EmptyJID, messageID)
	if _, err := t.client.SendMessage(ctx, jid, revoke); err != nil {
		return fmt.Errorf("whatsapp delete: %w", err)
	}
	return nil
}

// ShowTyping sends a "composing" chat presence pulse. The indicator expires
// server-side after a few seconds; the bridge re-calls on a heartbeat. The
// matching "paused" after the reply is deliberately omitted — sending the
// actual message clears the indicator.
func (t *Transport) ShowTyping(ctx context.Context, chatID string) error {
	jid, err := parseChatJID(chatID)
	if err != nil {
		return fmt.Errorf("whatsapp typing: %w", err)
	}
	if err := t.client.SendChatPresence(ctx, jid, types.ChatPresenceComposing, types.ChatPresenceMediaText); err != nil {
		return fmt.Errorf("whatsapp typing: %w", err)
	}
	return nil
}

// AddReaction attaches an emoji reaction to a message. The reaction key needs
// the original sender: for inbound messages we use the remembered sender,
// falling back to the chat JID (correct for DMs, best-effort for groups).
func (t *Transport) AddReaction(ctx context.Context, chatID, messageID, emoji string) error {
	return t.sendReaction(ctx, chatID, messageID, emoji, "react")
}

// RemoveReaction removes a reaction by sending an empty reaction for the same
// key. Removing a reaction that is not present is accepted by the server.
func (t *Transport) RemoveReaction(ctx context.Context, chatID, messageID, _ string) error {
	return t.sendReaction(ctx, chatID, messageID, "", "unreact")
}

func (t *Transport) sendReaction(ctx context.Context, chatID, messageID, emoji, op string) error {
	jid, err := parseChatJID(chatID)
	if err != nil {
		return fmt.Errorf("whatsapp %s: %w", op, err)
	}
	sender := jid
	if s, ok := t.lookupQuote(messageID); ok {
		if parsed, perr := types.ParseJID(s); perr == nil {
			sender = parsed
		}
	}
	reaction := t.client.BuildReaction(jid, sender, messageID, emoji)
	if _, err := t.client.SendMessage(ctx, jid, reaction); err != nil {
		return fmt.Errorf("whatsapp %s: %w", op, err)
	}
	return nil
}

// SendAttachment uploads a local file and sends it as an ImageMessage
// (kind=image) or DocumentMessage (anything else). Caption goes into the
// message's own caption field.
func (t *Transport) SendAttachment(ctx context.Context, chatID string, att transport.OutboundAttachment) (string, error) {
	jid, err := parseChatJID(chatID)
	if err != nil {
		return "", fmt.Errorf("whatsapp send attachment: %w", err)
	}
	if att.Path == "" {
		return "", errors.New("whatsapp send attachment: path required")
	}
	data, err := os.ReadFile(att.Path)
	if err != nil {
		return "", fmt.Errorf("whatsapp send attachment: %w", err)
	}
	if len(data) == 0 {
		return "", errors.New("whatsapp send attachment: file is empty")
	}
	if len(data) > MaxAttachmentBytes {
		return "", fmt.Errorf("whatsapp send attachment: file exceeds %d-byte cap (%d)", MaxAttachmentBytes, len(data))
	}

	var msg *waE2E.Message
	switch att.Kind {
	case transport.AttachmentImage:
		up, upErr := t.client.Upload(ctx, data, whatsmeow.MediaImage)
		if upErr != nil {
			return "", fmt.Errorf("whatsapp upload: %w", upErr)
		}
		msg = &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
			URL:           ptrString(up.URL),
			DirectPath:    ptrString(up.DirectPath),
			MediaKey:      up.MediaKey,
			Mimetype:      ptrString(mimeForUpload(att.Path, data)),
			FileEncSHA256: up.FileEncSHA256,
			FileSHA256:    up.FileSHA256,
			FileLength:    ptrUint64(up.FileLength),
			Caption:       optionalString(att.Caption),
		}}
	case transport.AttachmentFile, "":
		up, upErr := t.client.Upload(ctx, data, whatsmeow.MediaDocument)
		if upErr != nil {
			return "", fmt.Errorf("whatsapp upload: %w", upErr)
		}
		name := filepath.Base(att.Path)
		msg = &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
			URL:           ptrString(up.URL),
			DirectPath:    ptrString(up.DirectPath),
			MediaKey:      up.MediaKey,
			Mimetype:      ptrString(mimeForUpload(att.Path, data)),
			FileEncSHA256: up.FileEncSHA256,
			FileSHA256:    up.FileSHA256,
			FileLength:    ptrUint64(up.FileLength),
			FileName:      ptrString(name),
			Title:         ptrString(name),
			Caption:       optionalString(att.Caption),
		}}
	default:
		return "", fmt.Errorf("whatsapp send attachment: unsupported kind %q", att.Kind)
	}

	resp, err := t.client.SendMessage(ctx, jid, msg)
	if err != nil {
		return "", fmt.Errorf("whatsapp send attachment: %w", err)
	}
	return resp.ID, nil
}

func optionalString(s string) *string {
	if s == "" {
		return nil
	}
	return ptrString(s)
}

// Local pointer helpers so the package does not import
// google.golang.org/protobuf directly (kept indirect in go.mod).
func ptrString(s string) *string { return &s }

func ptrUint64(v uint64) *uint64 { return &v }

// =============================================================================
// quote registry
// =============================================================================

// rememberQuote records an inbound message's sender so later replies and
// reactions can address the original message. FIFO-bounded.
func (t *Transport) rememberQuote(messageID, sender string) {
	if messageID == "" || sender == "" {
		return
	}
	t.quoteMu.Lock()
	defer t.quoteMu.Unlock()
	if _, exists := t.quotes[messageID]; exists {
		t.quotes[messageID] = sender
		return
	}
	if len(t.quotes) >= quoteRegistryCap {
		oldest := t.quoteOrder[0]
		t.quoteOrder = t.quoteOrder[1:]
		delete(t.quotes, oldest)
	}
	t.quotes[messageID] = sender
	t.quoteOrder = append(t.quoteOrder, messageID)
}

func (t *Transport) lookupQuote(messageID string) (string, bool) {
	t.quoteMu.Lock()
	defer t.quoteMu.Unlock()
	s, ok := t.quotes[messageID]
	return s, ok
}

// quoteParticipant resolves the sender JID string for a quoted-reply
// ContextInfo. Falls back to the chat JID, which is correct for DMs (the
// quoted message came from the peer) and best-effort for groups.
func (t *Transport) quoteParticipant(messageID string, chat types.JID) string {
	if s, ok := t.lookupQuote(messageID); ok {
		return s
	}
	return chat.ToNonAD().String()
}
