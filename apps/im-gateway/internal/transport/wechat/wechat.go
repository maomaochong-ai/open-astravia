// Package wechat implements transport.Transport over the WeChat iLink bot
// protocol.
//
// The protocol is a third-party-friendly HTTP/JSON API maintained by the
// Tencent ClawBot team for OpenClaw integration. We bypass OpenClaw and
// speak iLink directly via the internal/transport/wechat/ilink subpackage.
// See apps/im-gateway/docs/ilink-protocol.md for the full protocol
// reference.
//
// Scope (M1):
//
//   - Text-only 1-on-1 chats
//   - QR-scan binding (driven by `im-gateway wechat login`)
//   - Persistent credentials, long-poll cursor, and per-peer context_token
//     map under ~/.vetta/im-gateway/wechat.json
//   - 24h/10-msg quota tracking per peer (server-side enforced; we shadow
//     it client-side to fail fast)
//
// Out of scope: streaming responses, message edit, voice transcoding,
// typing indicators, group chat, multi-account. Image and generic-file
// receive + send ARE in scope as of ADR-0006.
package wechat

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"

	"vetta-im-gateway/internal/transport"
	"vetta-im-gateway/internal/transport/inbox"
	"vetta-im-gateway/internal/transport/wechat/ilink"
)

// MaxInboundAttachmentBytes caps the size of a single inbound media we
// will download + decrypt + persist. Wechat itself enforces a sub-100MB
// limit; we add our own ceiling so a misconfigured peer cannot OOM the
// gateway.
const MaxInboundAttachmentBytes = 50 * 1024 * 1024

// ErrNotBound is returned by New when the on-disk state has no credentials
// yet. The caller should run `im-gateway wechat login` to populate them.
var ErrNotBound = errors.New("wechat: no bound account; run `im-gateway wechat login` first")

// ErrQuotaExhausted is returned by SendMessage when the local quota
// tracker indicates the per-peer 24h/10-message ceiling has been hit.
// The caller (the bridge) is responsible for translating this into
// whatever user-facing message is appropriate.
var ErrQuotaExhausted = errors.New("wechat: per-peer 24h send quota exhausted; user must reply to reset the window")

// Options configures Transport construction.
type Options struct {
	// StatePath is the JSON file holding credentials, cursor, and
	// context-token map. Created on first save if its parent directory
	// does not yet exist.
	StatePath string

	// Logger receives operational logs. Optional; falls back to a no-op.
	Logger *zap.Logger

	// QuotaPerWindow caps successful sends per peer per QuotaWindow.
	// Defaults to 10.
	QuotaPerWindow int

	// QuotaWindow is the rolling window length for QuotaPerWindow.
	// Defaults to 24h.
	QuotaWindow time.Duration

	// PollBackoff is the maximum exponential backoff between getupdates
	// retries on hard errors. Defaults to 30s. Long-poll timeouts and
	// "no new messages" do NOT trigger backoff — only real failures.
	PollBackoff time.Duration

	// PollInitialBackoff is the initial backoff between retries.
	// Defaults to 1s.
	PollInitialBackoff time.Duration

	// InboxDir is where the transport persists decrypted inbound media
	// (image / file). Each file is written under a per-day subdirectory:
	// `<InboxDir>/<YYYY-MM-DD>/<msgId>-<filename-or-ext>`. Required when
	// the agent should be able to read attachments via `@<path>` mentions.
	// Empty disables inbound media handling — image/file messages are
	// dropped just like in M1.
	InboxDir string
}

// Transport implements transport.Transport. Construct via New; the zero
// value is not usable.
type Transport struct {
	store    *stateStore
	client   *ilink.Client
	quota    *Quota
	log      *zap.Logger
	inboxDir string

	pollMaxBackoff     time.Duration
	pollInitialBackoff time.Duration

	mu      sync.Mutex
	stopped bool
	cancel  context.CancelFunc
}

// Compile-time interface check.
var _ transport.Transport = (*Transport)(nil)

// New constructs a Transport from persisted state. Returns ErrNotBound if
// no credentials have been recorded yet — the caller should run
// `im-gateway wechat login` first.
func New(opts Options) (*Transport, error) {
	if opts.StatePath == "" {
		return nil, errors.New("wechat: Options.StatePath is required")
	}
	store, err := newStateStore(opts.StatePath)
	if err != nil {
		return nil, err
	}
	if !store.HasCredentials() {
		return nil, ErrNotBound
	}

	logger := opts.Logger
	if logger == nil {
		logger = zap.NewNop()
	}

	quotaPer := opts.QuotaPerWindow
	if quotaPer == 0 {
		quotaPer = 10
	}
	quotaWin := opts.QuotaWindow
	if quotaWin == 0 {
		quotaWin = 24 * time.Hour
	}

	pollMax := opts.PollBackoff
	if pollMax == 0 {
		pollMax = 30 * time.Second
	}
	pollInit := opts.PollInitialBackoff
	if pollInit == 0 {
		pollInit = 1 * time.Second
	}

	client := ilink.Restore(store.Credentials(), ilink.Options{
		Logger: zapShim{logger},
	})

	return &Transport{
		store:              store,
		client:             client,
		quota:              NewQuota(quotaPer, quotaWin, time.Now),
		log:                logger,
		inboxDir:           opts.InboxDir,
		pollMaxBackoff:     pollMax,
		pollInitialBackoff: pollInit,
	}, nil
}

// Name returns the transport identifier used in InboundMessage.Platform.
func (t *Transport) Name() string { return "wechat" }

// Capabilities reports what the WeChat iLink protocol can and cannot do.
//
// SupportsMessageEdit is the most consequential field: false here forces
// the bridge into the "send a fresh message per agent reply" path because
// iLink has no edit endpoint. Streaming responses are deliberately not
// supported in M1.
func (t *Transport) Capabilities() transport.Capabilities {
	return transport.Capabilities{
		SupportsMessageEdit: false,
		SupportsCards:       false,
		SupportsButtons:     false,
		SupportsFileUpload:  true, // image + file via SendAttachment (ADR-0006)
		SupportsThreads:     false,
		MaxMessageLength:    0, // unknown; will be probed in real testing
		// iLink enforces ≤10 outbound messages per peer until the next
		// inbound resets the window. Streaming chunks would burn that
		// budget in one turn, so the bridge defers everything to a
		// single digest message at agent_end (plus an optional ack).
		DeferUntilTurnEnd: true,
	}
}

// Start runs the long-poll loop until ctx is canceled, Stop is called, or
// an unrecoverable credential error (ErrSessionTimeout) is returned by the
// server.
func (t *Transport) Start(ctx context.Context, handler transport.MessageHandler) error {
	t.mu.Lock()
	if t.stopped {
		t.mu.Unlock()
		return errors.New("wechat: Start called after Stop")
	}
	ctx, t.cancel = context.WithCancel(ctx)
	t.mu.Unlock()

	t.log.Info("wechat transport starting",
		zap.String("base_url", t.client.MessagingBaseURL()),
	)

	backoff := t.pollInitialBackoff
	for {
		if err := ctx.Err(); err != nil {
			return err
		}

		resp, err := t.client.GetUpdates(ctx, t.store.Cursor())
		if err != nil {
			if errors.Is(err, ilink.ErrSessionTimeout) {
				// Bot token is dead. Stop the loop; the caller is
				// expected to surface this to the user (re-bind).
				t.log.Warn("wechat session expired, stopping", zap.Error(err))
				return err
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			t.log.Warn("wechat getupdates failed, backing off",
				zap.Duration("backoff", backoff),
				zap.Error(err),
			)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
			backoff *= 2
			if backoff > t.pollMaxBackoff {
				backoff = t.pollMaxBackoff
			}
			continue
		}
		// Success: reset backoff.
		backoff = t.pollInitialBackoff

		for i := range resp.Msgs {
			t.dispatchInbound(ctx, &resp.Msgs[i], handler)
		}

		// Persist the cursor AFTER dispatching so a crash mid-dispatch
		// re-delivers (at-least-once), not silently drops.
		if resp.GetUpdatesBuf != "" {
			if err := t.store.SetCursor(resp.GetUpdatesBuf); err != nil {
				t.log.Warn("wechat persist cursor failed", zap.Error(err))
			}
		}
	}
}

// dispatchInbound translates one WeixinMessage into transport.InboundMessage,
// records the new context_token + quota reset, and invokes the handler.
// Errors from the handler are logged and swallowed — one bad message must
// not stall the poll loop.
//
// Image/file items are downloaded + AES-128-ECB decrypted + persisted to
// the per-day inbox before being surfaced as transport.Attachment entries.
// Text messages still flow through Text. A message with media but no text
// reaches the bridge with an empty Text and a non-empty Attachments slice;
// the bridge prepends `@<absPath>` lines onto the prompt the agent sees.
func (t *Transport) dispatchInbound(ctx context.Context, msg *ilink.WeixinMessage, handler transport.MessageHandler) {
	peer := msg.FromUserID
	if peer == "" {
		t.log.Debug("wechat dropping message with empty from_user_id")
		return
	}

	text := extractText(msg)
	attachments := t.extractAndPersistAttachments(ctx, peer, msg)

	if text == "" && len(attachments) == 0 {
		t.log.Debug("wechat dropping unsupported message",
			zap.String("peer", peer),
			zap.Int("items", len(msg.ItemList)),
		)
		return
	}

	// Reset the per-peer quota window: any inbound message reopens the
	// 24h/10 budget per the upstream protocol rules.
	t.quota.OnInbound(peer)

	// Persist the latest context_token for this peer so subsequent sends
	// can echo it. Survives gateway restart.
	if msg.ContextToken != "" {
		if err := t.store.SetContextToken(peer, msg.ContextToken); err != nil {
			t.log.Warn("wechat persist context_token failed",
				zap.String("peer", peer),
				zap.Error(err),
			)
		}
	}

	in := transport.InboundMessage{
		Platform:    "wechat",
		ChatID:      peer, // 1-on-1 only in M1: chat == peer
		UserID:      peer,
		MessageID:   formatMessageID(msg),
		Text:        text,
		Attachments: attachments,
		ReceivedAt:  time.Now(),
		Raw:         msg,
	}

	if err := handler.HandleInbound(ctx, in); err != nil {
		t.log.Warn("wechat handler error",
			zap.String("peer", peer),
			zap.Error(err),
		)
	}
}

// extractAndPersistAttachments walks msg.ItemList, downloads and decrypts
// image/file media into the configured inbox, and returns the resulting
// transport.Attachment list (URL field populated with the absolute local
// path; the bridge consumes this).
//
// Voice and video items are deliberately skipped (see ADR-0006 scope).
// Errors on a single item are logged and silently dropped so one bad
// download cannot stall the rest of the message.
func (t *Transport) extractAndPersistAttachments(ctx context.Context, peer string, msg *ilink.WeixinMessage) []transport.Attachment {
	if t.inboxDir == "" {
		return nil
	}
	var out []transport.Attachment
	msgID := formatMessageID(msg)
	for i := range msg.ItemList {
		item := &msg.ItemList[i]
		switch item.Type {
		case ilink.MessageItemTypeImage:
			if item.ImageItem == nil {
				continue
			}
			att, err := t.fetchImage(ctx, msgID, i, item.ImageItem)
			if err != nil {
				t.log.Warn("wechat inbound image fetch failed",
					zap.String("peer", peer),
					zap.Int("itemIndex", i),
					zap.Error(err),
				)
				continue
			}
			out = append(out, att)
		case ilink.MessageItemTypeFile:
			if item.FileItem == nil {
				continue
			}
			att, err := t.fetchFile(ctx, msgID, i, item.FileItem)
			if err != nil {
				t.log.Warn("wechat inbound file fetch failed",
					zap.String("peer", peer),
					zap.Int("itemIndex", i),
					zap.Error(err),
				)
				continue
			}
			out = append(out, att)
		}
	}
	return out
}

// fetchImage downloads + decrypts + persists one ImageItem.
func (t *Transport) fetchImage(ctx context.Context, msgID string, idx int, img *ilink.ImageItem) (transport.Attachment, error) {
	url, aesKey := imageDownloadFields(img)
	if url == "" {
		return transport.Attachment{}, errors.New("image_item has no downloadable url")
	}
	plaintext, err := t.client.DownloadAndDecrypt(ctx, url, aesKey)
	if err != nil {
		return transport.Attachment{}, err
	}
	if len(plaintext) > MaxInboundAttachmentBytes {
		return transport.Attachment{}, fmt.Errorf("image exceeds %d-byte cap (%d)", MaxInboundAttachmentBytes, len(plaintext))
	}
	ext := inbox.GuessImageExt(plaintext)
	filename := fmt.Sprintf("%s-img-%d%s", inbox.SanitizeForFilename(msgID), idx, ext)
	absPath, err := inbox.Persist(t.inboxDir, filename, plaintext)
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

// fetchFile downloads + decrypts + persists one FileItem.
func (t *Transport) fetchFile(ctx context.Context, msgID string, idx int, f *ilink.FileItem) (transport.Attachment, error) {
	if f.Media == nil || f.Media.EncryptQueryParam == "" {
		return transport.Attachment{}, errors.New("file_item has no media reference")
	}
	url := ilink.BuildCDNDownloadURL(ilink.DefaultCDNBaseURL, f.Media.EncryptQueryParam)
	plaintext, err := t.client.DownloadAndDecrypt(ctx, url, f.Media.AESKey)
	if err != nil {
		return transport.Attachment{}, err
	}
	if len(plaintext) > MaxInboundAttachmentBytes {
		return transport.Attachment{}, fmt.Errorf("file exceeds %d-byte cap (%d)", MaxInboundAttachmentBytes, len(plaintext))
	}
	name := f.FileName
	if name == "" {
		name = fmt.Sprintf("file-%d.bin", idx)
	}
	filename := fmt.Sprintf("%s-%s", inbox.SanitizeForFilename(msgID), filepath.Base(name))
	absPath, err := inbox.Persist(t.inboxDir, filename, plaintext)
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

// imageDownloadFields picks the right url+aeskey pair from an ImageItem.
// The newer media.CDNMedia form wins when present; falls back to the
// legacy top-level URL + aeskey (hex) form.
func imageDownloadFields(img *ilink.ImageItem) (url, aesKey string) {
	if img.Media != nil && img.Media.EncryptQueryParam != "" {
		return ilink.BuildCDNDownloadURL(ilink.DefaultCDNBaseURL, img.Media.EncryptQueryParam), img.Media.AESKey
	}
	if img.URL != "" {
		return img.URL, img.AESKey
	}
	return "", ""
}

// Stop signals Start to return. Safe to call multiple times.
func (t *Transport) Stop() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.stopped {
		return nil
	}
	t.stopped = true
	if t.cancel != nil {
		t.cancel()
	}
	return nil
}

// SendMessage sends one text message to a peer. Returns ErrQuotaExhausted
// if the local quota tracker says we are out of budget for this peer in
// the current 24h window. The bridge should turn that into a user-visible
// notice rather than crashing.
func (t *Transport) SendMessage(ctx context.Context, chatID string, msg transport.OutboundMessage) (string, error) {
	if chatID == "" {
		return "", errors.New("wechat: chatID required")
	}
	text := flattenOutbound(msg)
	if text == "" {
		return "", errors.New("wechat: empty outbound message")
	}

	if !t.quota.CanSend(chatID) {
		t.log.Warn("wechat quota exhausted, refusing send",
			zap.String("peer", chatID),
		)
		return "", ErrQuotaExhausted
	}

	ctxToken := t.store.ContextToken(chatID)
	if ctxToken == "" {
		t.log.Warn("wechat sending without context_token (proactive push)",
			zap.String("peer", chatID),
		)
	}

	cid, err := t.client.SendText(ctx, ilink.SendTextOptions{
		PeerUserID:   chatID,
		Text:         text,
		ContextToken: ctxToken,
	})
	if err != nil {
		return "", fmt.Errorf("wechat send: %w", err)
	}
	t.quota.RecordSend(chatID)
	t.log.Debug("wechat send ok",
		zap.String("peer", chatID),
		zap.String("client_id", cid),
		zap.Int("remaining", t.quota.Remaining(chatID)),
	)
	return cid, nil
}

// EditMessage is intentionally a hard error: the iLink protocol has no
// edit endpoint. Capabilities.SupportsMessageEdit=false should prevent the
// bridge from ever calling this; if it does, returning an error helps
// catch the bug in tests.
func (t *Transport) EditMessage(_ context.Context, _, _ string, _ transport.OutboundMessage) error {
	return errors.New("wechat: edit not supported")
}

// EndStream is a no-op; M1 does not support streaming.
func (t *Transport) EndStream(_ context.Context, _, _ string) error { return nil }

// DeleteMessage returns an error; the protocol has no delete endpoint.
func (t *Transport) DeleteMessage(_ context.Context, _, _ string) error {
	return errors.New("wechat: delete not supported")
}

// ShowTyping sends one "对方正在输入" pulse to the peer. The indicator's
// server-side lifetime is short (~5-8s); the bridge re-calls this on a
// heartbeat while the agent is working (replacing the old "still processing"
// ack message). Does not consume the send quota — typing is not a message.
// Best-effort: errors (missing credentials, expired ticket) are returned for
// the caller to ignore rather than surfaced to the user.
func (t *Transport) ShowTyping(ctx context.Context, chatID string) error {
	if chatID == "" {
		return errors.New("wechat: chatID required")
	}
	return t.client.SendTyping(ctx, chatID, t.store.ContextToken(chatID), true)
}

// SendAttachment uploads a local file via the iLink CDN flow and sends it
// to the peer as an image (kind="image") or generic file (kind="file").
// Consumes one slot of the per-peer 24h send quota. ErrQuotaExhausted is
// returned when the local quota tracker says we are out of budget.
func (t *Transport) SendAttachment(ctx context.Context, chatID string, att transport.OutboundAttachment) (string, error) {
	if chatID == "" {
		return "", errors.New("wechat: chatID required")
	}
	if att.Path == "" {
		return "", errors.New("wechat: attachment path required")
	}
	if !t.quota.CanSend(chatID) {
		t.log.Warn("wechat quota exhausted, refusing attachment send",
			zap.String("peer", chatID),
			zap.String("kind", string(att.Kind)),
		)
		return "", ErrQuotaExhausted
	}

	plaintext, err := os.ReadFile(att.Path)
	if err != nil {
		return "", fmt.Errorf("wechat: read attachment: %w", err)
	}
	if len(plaintext) == 0 {
		return "", errors.New("wechat: attachment is empty")
	}

	ctxToken := t.store.ContextToken(chatID)
	if ctxToken == "" {
		t.log.Warn("wechat sending attachment without context_token (proactive push)",
			zap.String("peer", chatID),
		)
	}

	var cid string
	switch att.Kind {
	case transport.AttachmentImage:
		cid, err = t.client.SendImage(ctx, ilink.SendImageOptions{
			PeerUserID:   chatID,
			Plaintext:    plaintext,
			ContextToken: ctxToken,
		})
	case transport.AttachmentFile, "":
		cid, err = t.client.SendFile(ctx, ilink.SendFileOptions{
			PeerUserID:   chatID,
			Plaintext:    plaintext,
			FileName:     filepath.Base(att.Path),
			ContextToken: ctxToken,
		})
	default:
		return "", fmt.Errorf("wechat: unsupported attachment kind %q", att.Kind)
	}
	if err != nil {
		return "", fmt.Errorf("wechat send attachment: %w", err)
	}
	t.quota.RecordSend(chatID)

	// If a caption was supplied, send it as a follow-up text message. Best
	// effort — failing here doesn't undo the attachment send. We deliberately
	// do NOT count caption against quota separately: the agent already chose
	// to spend a slot on the attachment and the caption is "free" only if
	// budget remains.
	if att.Caption != "" {
		if t.quota.CanSend(chatID) {
			if _, capErr := t.client.SendText(ctx, ilink.SendTextOptions{
				PeerUserID:   chatID,
				Text:         att.Caption,
				ContextToken: ctxToken,
			}); capErr != nil {
				t.log.Warn("wechat attachment caption send failed",
					zap.String("peer", chatID),
					zap.Error(capErr),
				)
			} else {
				t.quota.RecordSend(chatID)
			}
		} else {
			t.log.Info("wechat skipping caption: quota exhausted",
				zap.String("peer", chatID),
			)
		}
	}

	t.log.Debug("wechat attachment send ok",
		zap.String("peer", chatID),
		zap.String("kind", string(att.Kind)),
		zap.String("client_id", cid),
		zap.Int("bytes", len(plaintext)),
		zap.Int("remaining", t.quota.Remaining(chatID)),
	)
	return cid, nil
}

// =============================================================================
// helpers
// =============================================================================

// extractText pulls user-readable text out of a WeixinMessage. Mirrors the
// upstream `bodyFromItemList` logic in src/messaging/inbound.ts:
//
//   - Prefer the first TEXT item; if it has a ref_msg, prefix the body
//     with a "[引用: ...]\n" line so the agent can see what was quoted.
//   - Fall back to a VOICE item that already has server-side STT
//     (`voice_item.text`).
//
// Returns "" if no readable text is present (e.g. pure image/file message
// — those are dropped in M1).
func extractText(msg *ilink.WeixinMessage) string {
	for i := range msg.ItemList {
		item := &msg.ItemList[i]
		if item.Type == ilink.MessageItemTypeText && item.TextItem != nil && item.TextItem.Text != "" {
			text := item.TextItem.Text
			if item.RefMsg == nil {
				return text
			}
			ref := item.RefMsg
			// If the quoted message was media, we cannot inline it
			// here (M1 has no media support); just return the bare text.
			if ref.MessageItem != nil && isMediaItem(ref.MessageItem) {
				return text
			}
			parts := []string{}
			if ref.Title != "" {
				parts = append(parts, ref.Title)
			}
			if ref.MessageItem != nil {
				if refBody := extractItemText(ref.MessageItem); refBody != "" {
					parts = append(parts, refBody)
				}
			}
			if len(parts) == 0 {
				return text
			}
			quoted := parts[0]
			for _, p := range parts[1:] {
				quoted += " | " + p
			}
			return "[引用: " + quoted + "]\n" + text
		}
		if item.Type == ilink.MessageItemTypeVoice && item.VoiceItem != nil && item.VoiceItem.Text != "" {
			return item.VoiceItem.Text
		}
	}
	return ""
}

// extractItemText is the single-item variant used for ref_msg bodies.
func extractItemText(item *ilink.MessageItem) string {
	if item == nil {
		return ""
	}
	if item.Type == ilink.MessageItemTypeText && item.TextItem != nil {
		return item.TextItem.Text
	}
	if item.Type == ilink.MessageItemTypeVoice && item.VoiceItem != nil {
		return item.VoiceItem.Text
	}
	return ""
}

// isMediaItem reports whether an item is one of the media kinds (used to
// decide whether a quoted ref_msg can be inlined).
func isMediaItem(item *ilink.MessageItem) bool {
	switch item.Type {
	case ilink.MessageItemTypeImage,
		ilink.MessageItemTypeVoice,
		ilink.MessageItemTypeFile,
		ilink.MessageItemTypeVideo:
		return true
	}
	return false
}

// flattenOutbound collapses an OutboundMessage to plain text. wechat
// declares SupportsCards=false so the bridge always populates Text, but
// we defensively concatenate Block text as well in case some upstream
// path drops Text.
func flattenOutbound(m transport.OutboundMessage) string {
	if m.Text != "" {
		return m.Text
	}
	if len(m.Blocks) == 0 {
		return ""
	}
	var sb strings.Builder
	for i, b := range m.Blocks {
		if i > 0 {
			sb.WriteString("\n")
		}
		sb.WriteString(b.Text)
	}
	return sb.String()
}

// formatMessageID gives upstream layers a stable id for an inbound msg.
// We prefer the protocol-level message_id when present, falling back to
// client_id, then to "<seq>".
func formatMessageID(msg *ilink.WeixinMessage) string {
	if msg.MessageID != 0 {
		return fmt.Sprintf("wx-%d", msg.MessageID)
	}
	if msg.ClientID != "" {
		return msg.ClientID
	}
	return fmt.Sprintf("wx-seq-%d", msg.Seq)
}

// zapShim adapts *zap.Logger to ilink.Logger so the protocol package does
// not need to import zap.
type zapShim struct{ l *zap.Logger }

func (z zapShim) Debug(msg string, fields ...any) { z.l.Sugar().Debugw(msg, fields...) }
func (z zapShim) Info(msg string, fields ...any)  { z.l.Sugar().Infow(msg, fields...) }
func (z zapShim) Warn(msg string, fields ...any)  { z.l.Sugar().Warnw(msg, fields...) }
func (z zapShim) Error(msg string, fields ...any) { z.l.Sugar().Errorw(msg, fields...) }
