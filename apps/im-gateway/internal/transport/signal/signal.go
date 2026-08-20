// Package signalcli implements transport.Transport for Signal by talking to
// a locally running signal-cli daemon over its HTTP JSON-RPC + SSE endpoints.
//
// The package is named signalcli (directory: internal/transport/signal) to
// avoid clashing with the platform name in call sites that also import a
// hypothetical stdlib-ish "signal" identifier (os/signal).
//
// The user runs the daemon themselves, e.g.:
//
//	signal-cli -a +8613800000000 daemon --http 127.0.0.1:8080
//
// Inbound: GET /api/v1/events is a long-lived SSE stream where every frame's
// data payload is a JSON-RPC notification {"method":"receive","params":
// {"envelope":{...}}}. The stream is consumed on Start and reconnected with
// exponential backoff (1s → 30s, mirroring the wechat poll loop) until the
// context is cancelled or Stop is called.
//
// Outbound: POST /api/v1/rpc with JSON-RPC 2.0 (`send`, `sendReaction`,
// `sendTyping`, `remoteDelete`).
//
// ChatID convention: private chats use the peer's E.164 number ("+86138...");
// groups use "group:<base64 groupId>". MessageID is the decimal string of the
// Signal envelope timestamp (Signal's canonical message identity).
package signalcli

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"vetta-im-gateway/internal/transport"
	"vetta-im-gateway/internal/transport/inbox"
)

// MaxAttachmentBytes caps both inbound attachments we copy into the inbox and
// outbound files we base64-embed into a `send` call. Mirrors the wechat and
// feishu transports' defensive ceiling.
const MaxAttachmentBytes = 50 * 1024 * 1024

// groupChatPrefix marks a ChatID as a Signal group; the remainder is the
// base64 groupId exactly as signal-cli reports it.
const groupChatPrefix = "group:"

// maxSSELineBytes bounds one SSE line. A receive frame carries only metadata
// plus message text (attachment bytes stay on disk), so 4MB is generous.
const maxSSELineBytes = 4 * 1024 * 1024

// Options configures the Signal transport.
type Options struct {
	// Endpoint is the daemon's HTTP base URL, e.g. "http://127.0.0.1:8080".
	Endpoint string
	// Account is the bot's own E.164 number the daemon is registered as.
	Account string
	// AllowedNumbers restricts which private-chat senders are forwarded.
	// Empty means all senders are allowed. Group messages are not filtered.
	AllowedNumbers []string
	// InboxDir is where inbound attachments are persisted (via the shared
	// inbox package). Empty disables inbound media handling — attachments
	// are dropped and only text survives.
	InboxDir string
	// AttachmentsDir is signal-cli's own attachment cache directory
	// (typically ~/.local/share/signal-cli/attachments). The daemon stores
	// inbound attachment bytes there under their attachment id; we copy
	// them into InboxDir. Empty disables attachment pickup even when
	// InboxDir is set.
	AttachmentsDir string
}

// Transport implements transport.Transport (and transport.Reactor) for
// Signal via signal-cli.
type Transport struct {
	opts    Options
	allowed map[string]struct{}

	// rpcClient has a request timeout; eventClient must not (the SSE stream
	// is long-lived and lifecycle is governed by the Start context).
	rpcClient   *http.Client
	eventClient *http.Client

	rpcID atomic.Int64

	// Backoff bounds for the SSE reconnect loop. Set to defaults in New;
	// overridable from tests (same package) to keep tests sleep-free.
	backoffInitial time.Duration
	backoffMax     time.Duration

	mu      sync.Mutex
	stopped bool
	cancel  context.CancelFunc
}

// Compile-time interface checks.
var (
	_ transport.Transport = (*Transport)(nil)
	_ transport.Reactor   = (*Transport)(nil)
)

// New constructs a Signal transport. Endpoint and Account are required.
func New(opts Options) (*Transport, error) {
	if opts.Endpoint == "" {
		return nil, errors.New("signal: Options.Endpoint is required")
	}
	if opts.Account == "" {
		return nil, errors.New("signal: Options.Account is required")
	}
	opts.Endpoint = strings.TrimRight(opts.Endpoint, "/")

	allowed := make(map[string]struct{}, len(opts.AllowedNumbers))
	for _, n := range opts.AllowedNumbers {
		if n != "" {
			allowed[n] = struct{}{}
		}
	}

	return &Transport{
		opts:           opts,
		allowed:        allowed,
		rpcClient:      &http.Client{Timeout: 30 * time.Second},
		eventClient:    &http.Client{},
		backoffInitial: 1 * time.Second,
		backoffMax:     30 * time.Second,
	}, nil
}

func (t *Transport) Name() string { return "signal" }

// Capabilities: signal-cli has no message-edit RPC exposed, no rich cards
// and no inline keyboards; quotes serve as threads, reactions and file
// upload are native, and Signal has no practical text length cap for our
// purposes.
func (t *Transport) Capabilities() transport.Capabilities {
	return transport.Capabilities{
		SupportsMessageEdit: false,
		SupportsCards:       false,
		SupportsButtons:     false,
		SupportsFileUpload:  true,
		SupportsThreads:     true,
		SupportsReactions:   true,
		MaxMessageLength:    0,
	}
}

// Start consumes the SSE event stream, reconnecting with exponential backoff
// on failures, until ctx is cancelled or Stop is called.
func (t *Transport) Start(ctx context.Context, handler transport.MessageHandler) error {
	t.mu.Lock()
	if t.stopped {
		t.mu.Unlock()
		return errors.New("signal: Start called after Stop")
	}
	ctx, cancel := context.WithCancel(ctx)
	t.cancel = cancel
	t.mu.Unlock()
	defer cancel()

	backoff := t.backoffInitial
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		connected, err := t.consumeEvents(ctx, handler)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if connected {
			backoff = t.backoffInitial
		}
		_ = err // stream errors are transient by design; retry with backoff
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > t.backoffMax {
			backoff = t.backoffMax
		}
	}
}

// Stop cancels the running Start loop. Safe to call multiple times.
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

// consumeEvents opens one SSE connection and dispatches frames until the
// stream ends. Returns connected=true once a 200 response was obtained so
// the caller can reset its backoff.
func (t *Transport) consumeEvents(ctx context.Context, handler transport.MessageHandler) (connected bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, t.opts.Endpoint+"/api/v1/events", nil)
	if err != nil {
		return false, fmt.Errorf("signal events: %w", err)
	}
	req.Header.Set("Accept", "text/event-stream")

	resp, err := t.eventClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("signal events: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("signal events: unexpected status %d", resp.StatusCode)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), maxSSELineBytes)
	var data bytes.Buffer
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		switch {
		case line == "":
			if data.Len() > 0 {
				t.dispatchFrame(ctx, data.Bytes(), handler)
				data.Reset()
			}
		case strings.HasPrefix(line, "data:"):
			payload := strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " ")
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.WriteString(payload)
		default:
			// event:/id:/retry:/comment lines carry nothing we need.
		}
	}
	// Flush a trailing frame that was not terminated by a blank line.
	if data.Len() > 0 {
		t.dispatchFrame(ctx, data.Bytes(), handler)
	}
	if serr := scanner.Err(); serr != nil {
		return true, fmt.Errorf("signal events: %w", serr)
	}
	return true, fmt.Errorf("signal events: stream closed")
}

// dispatchFrame parses one SSE data payload, applies the transport's filters,
// resolves attachments, and forwards the normalized message. Handler errors
// are swallowed — one bad message must not kill the stream.
func (t *Transport) dispatchFrame(ctx context.Context, data []byte, handler transport.MessageHandler) {
	env, err := parseEventFrame(data)
	if err != nil || env == nil {
		return
	}
	msg, ok := normalizeEnvelope(env)
	if !ok {
		return
	}
	if !t.senderAllowed(msg) {
		return
	}
	msg.Attachments = t.collectAttachments(env, msg.MessageID)
	if msg.Text == "" && len(msg.Attachments) == 0 {
		return
	}
	_ = handler.HandleInbound(ctx, msg)
}

// senderAllowed applies the AllowedNumbers allowlist. Only private chats are
// filtered; group traffic passes (group membership is the daemon's concern).
func (t *Transport) senderAllowed(msg transport.InboundMessage) bool {
	if len(t.allowed) == 0 {
		return true
	}
	if strings.HasPrefix(msg.ChatID, groupChatPrefix) {
		return true
	}
	_, ok := t.allowed[msg.UserID]
	return ok
}

// collectAttachments copies the envelope's attachments from signal-cli's
// local cache (AttachmentsDir/<id>) into the inbox. Requires both InboxDir
// and AttachmentsDir; otherwise attachments are dropped and only the text
// survives. Per-item failures are skipped so one broken file cannot drop
// the whole message.
func (t *Transport) collectAttachments(env *envelope, msgID string) []transport.Attachment {
	if t.opts.InboxDir == "" || t.opts.AttachmentsDir == "" || env.DataMessage == nil {
		return nil
	}
	var out []transport.Attachment
	for i, meta := range env.DataMessage.Attachments {
		if meta.ID == "" {
			continue
		}
		src := filepath.Join(t.opts.AttachmentsDir, meta.ID)
		info, err := os.Stat(src)
		if err != nil || info.Size() > MaxAttachmentBytes {
			continue
		}
		b, err := os.ReadFile(src)
		if err != nil {
			continue
		}
		name := meta.Filename
		if name == "" {
			name = meta.ID
		}
		filename := fmt.Sprintf("%s-%d-%s", inbox.SanitizeForFilename(msgID), i, inbox.SanitizeForFilename(filepath.Base(name)))
		absPath, err := inbox.Persist(t.opts.InboxDir, filename, b)
		if err != nil {
			continue
		}
		kind := transport.AttachmentFile
		if strings.HasPrefix(meta.ContentType, "image/") {
			kind = transport.AttachmentImage
		}
		out = append(out, transport.Attachment{
			Kind:     kind,
			Name:     filepath.Base(absPath),
			MimeType: meta.ContentType,
			URL:      absPath,
		})
	}
	return out
}

// SendMessage delivers one text message via the JSON-RPC `send` method.
// Buttons are rendered into the text as a numbered fallback list (Signal has
// no inline keyboards). ReplyToID becomes a quote.
func (t *Transport) SendMessage(ctx context.Context, chatID string, msg transport.OutboundMessage) (string, error) {
	recipient, groupID, err := resolveTarget(chatID)
	if err != nil {
		return "", fmt.Errorf("signal send: %w", err)
	}
	text := renderButtonsFallback(flattenOutbound(msg), msg.Buttons)
	if text == "" {
		return "", errors.New("signal send: empty outbound message")
	}

	params := sendParams{
		Account:   t.opts.Account,
		Recipient: recipient,
		GroupID:   groupID,
		Message:   text,
	}
	if msg.ReplyToID != "" {
		ts, perr := strconv.ParseInt(msg.ReplyToID, 10, 64)
		if perr != nil {
			return "", fmt.Errorf("signal send: invalid reply-to id %q", msg.ReplyToID)
		}
		params.QuoteTimestamp = ts
		// quoteAuthor: in a private chat the quoted message's author is the
		// peer (the bridge only ever quotes inbound messages). In a group we
		// don't know the author from ChatID alone, so the quote is dropped —
		// best-effort threading rather than a wrong attribution.
		if groupID == "" {
			params.QuoteAuthor = chatID
		} else {
			params.QuoteTimestamp = 0
		}
	}

	result, err := t.rpcCall(ctx, "send", "send", params)
	if err != nil {
		return "", err
	}
	return sendResultID(result, "send")
}

// EditMessage is unsupported: signal-cli exposes no edit RPC.
// Capabilities.SupportsMessageEdit=false keeps the bridge away from here.
func (t *Transport) EditMessage(_ context.Context, _, _ string, _ transport.OutboundMessage) error {
	return errors.New("signal: edit not supported")
}

// EndStream is a no-op; the transport has no dedicated streaming path.
func (t *Transport) EndStream(_ context.Context, _, _ string) error { return nil }

// DeleteMessage issues a `remoteDelete` for the given envelope timestamp.
func (t *Transport) DeleteMessage(ctx context.Context, chatID, messageID string) error {
	recipient, groupID, err := resolveTarget(chatID)
	if err != nil {
		return fmt.Errorf("signal delete: %w", err)
	}
	ts, err := strconv.ParseInt(messageID, 10, 64)
	if err != nil {
		return fmt.Errorf("signal delete: invalid message id %q", messageID)
	}
	_, err = t.rpcCall(ctx, "delete", "remoteDelete", remoteDeleteParams{
		Account:         t.opts.Account,
		Recipient:       recipient,
		GroupID:         groupID,
		TargetTimestamp: ts,
	})
	return err
}

// ShowTyping sends one typing-started pulse.
func (t *Transport) ShowTyping(ctx context.Context, chatID string) error {
	recipient, groupID, err := resolveTarget(chatID)
	if err != nil {
		return fmt.Errorf("signal typing: %w", err)
	}
	_, err = t.rpcCall(ctx, "typing", "sendTyping", typingParams{
		Account:   t.opts.Account,
		Recipient: recipient,
		GroupID:   groupID,
	})
	return err
}

// AddReaction implements transport.Reactor via `sendReaction`.
func (t *Transport) AddReaction(ctx context.Context, chatID, messageID, emoji string) error {
	return t.sendReaction(ctx, chatID, messageID, emoji, false)
}

// RemoveReaction implements transport.Reactor via `sendReaction` remove=true.
func (t *Transport) RemoveReaction(ctx context.Context, chatID, messageID, emoji string) error {
	return t.sendReaction(ctx, chatID, messageID, emoji, true)
}

func (t *Transport) sendReaction(ctx context.Context, chatID, messageID, emoji string, remove bool) error {
	recipient, groupID, err := resolveTarget(chatID)
	if err != nil {
		return fmt.Errorf("signal reaction: %w", err)
	}
	ts, err := strconv.ParseInt(messageID, 10, 64)
	if err != nil {
		return fmt.Errorf("signal reaction: invalid message id %q", messageID)
	}
	p := reactionParams{
		Account:         t.opts.Account,
		Recipient:       recipient,
		GroupID:         groupID,
		Reaction:        emoji,
		TargetTimestamp: ts,
		Remove:          remove,
	}
	// targetAuthor: reacting always targets an inbound message; in a private
	// chat its author is the peer. In a group the author is not derivable
	// from ChatID, so the field is omitted (best-effort — the daemon may
	// reject it, and the bridge treats reaction failures as non-fatal).
	if groupID == "" {
		p.TargetAuthor = chatID
	}
	_, err = t.rpcCall(ctx, "reaction", "sendReaction", p)
	return err
}

// SendAttachment reads a local file, embeds it into a `send` call as a
// base64 data URI, and returns the resulting message timestamp.
func (t *Transport) SendAttachment(ctx context.Context, chatID string, att transport.OutboundAttachment) (string, error) {
	recipient, groupID, err := resolveTarget(chatID)
	if err != nil {
		return "", fmt.Errorf("signal attachment: %w", err)
	}
	if att.Path == "" {
		return "", errors.New("signal attachment: path required")
	}
	info, err := os.Stat(att.Path)
	if err != nil {
		return "", fmt.Errorf("signal attachment: %w", err)
	}
	if info.Size() > MaxAttachmentBytes {
		return "", fmt.Errorf("signal attachment: file exceeds %d-byte cap (%d)", MaxAttachmentBytes, info.Size())
	}
	b, err := os.ReadFile(att.Path)
	if err != nil {
		return "", fmt.Errorf("signal attachment: %w", err)
	}
	uri := "data:" + inbox.MimeFromExt(filepath.Ext(att.Path)) + ";base64," + base64.StdEncoding.EncodeToString(b)

	result, err := t.rpcCall(ctx, "attachment", "send", sendParams{
		Account:     t.opts.Account,
		Recipient:   recipient,
		GroupID:     groupID,
		Message:     att.Caption,
		Attachments: []string{uri},
	})
	if err != nil {
		return "", err
	}
	return sendResultID(result, "attachment")
}

// =============================================================================
// JSON-RPC client
// =============================================================================

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int64  `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params"`
}

type rpcResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *rpcError       `json:"error"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *rpcError) Error() string {
	return fmt.Sprintf("rpc error %d: %s", e.Code, e.Message)
}

// rpcCall performs one JSON-RPC 2.0 round trip against /api/v1/rpc. `op` is
// the human-facing operation name used in the error prefix.
func (t *Transport) rpcCall(ctx context.Context, op, method string, params any) (json.RawMessage, error) {
	body, err := json.Marshal(rpcRequest{
		JSONRPC: "2.0",
		ID:      t.rpcID.Add(1),
		Method:  method,
		Params:  params,
	})
	if err != nil {
		return nil, fmt.Errorf("signal %s: %w", op, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.opts.Endpoint+"/api/v1/rpc", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("signal %s: %w", op, err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.rpcClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("signal %s: %w", op, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("signal %s: unexpected status %d", op, resp.StatusCode)
	}
	var out rpcResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("signal %s: decode response: %w", op, err)
	}
	if out.Error != nil {
		return nil, fmt.Errorf("signal %s: %w", op, out.Error)
	}
	return out.Result, nil
}

// sendResultID extracts the message timestamp from a `send` result and
// formats it as the transport's MessageID.
func sendResultID(result json.RawMessage, op string) (string, error) {
	var v struct {
		Timestamp int64 `json:"timestamp"`
	}
	if len(result) > 0 {
		if err := json.Unmarshal(result, &v); err != nil {
			return "", fmt.Errorf("signal %s: decode result: %w", op, err)
		}
	}
	if v.Timestamp == 0 {
		return "", fmt.Errorf("signal %s: missing timestamp in result", op)
	}
	return strconv.FormatInt(v.Timestamp, 10), nil
}

// =============================================================================
// RPC params (wire shapes)
// =============================================================================

type sendParams struct {
	Account        string   `json:"account,omitempty"`
	Recipient      []string `json:"recipient,omitempty"`
	GroupID        string   `json:"groupId,omitempty"`
	Message        string   `json:"message,omitempty"`
	QuoteTimestamp int64    `json:"quoteTimestamp,omitempty"`
	QuoteAuthor    string   `json:"quoteAuthor,omitempty"`
	Attachments    []string `json:"attachments,omitempty"`
}

type remoteDeleteParams struct {
	Account         string   `json:"account,omitempty"`
	Recipient       []string `json:"recipient,omitempty"`
	GroupID         string   `json:"groupId,omitempty"`
	TargetTimestamp int64    `json:"targetTimestamp"`
}

type typingParams struct {
	Account   string   `json:"account,omitempty"`
	Recipient []string `json:"recipient,omitempty"`
	GroupID   string   `json:"groupId,omitempty"`
	Stop      bool     `json:"stop,omitempty"`
}

type reactionParams struct {
	Account         string   `json:"account,omitempty"`
	Recipient       []string `json:"recipient,omitempty"`
	GroupID         string   `json:"groupId,omitempty"`
	Reaction        string   `json:"reaction"`
	TargetAuthor    string   `json:"targetAuthor,omitempty"`
	TargetTimestamp int64    `json:"targetTimestamp"`
	Remove          bool     `json:"remove,omitempty"`
}

// =============================================================================
// inbound wire parsing (pure functions)
// =============================================================================

// eventFrame is the JSON-RPC notification carried in one SSE data payload.
type eventFrame struct {
	Method string `json:"method"`
	Params struct {
		Envelope envelope `json:"envelope"`
	} `json:"params"`
}

// envelope is the subset of signal-cli's receive envelope we consume. The
// presence-only raw fields let us classify receipt/typing/sync envelopes
// without modelling their bodies.
type envelope struct {
	SourceNumber   string          `json:"sourceNumber"`
	SourceUUID     string          `json:"sourceUuid"`
	Timestamp      int64           `json:"timestamp"`
	DataMessage    *dataMessage    `json:"dataMessage"`
	SyncMessage    json.RawMessage `json:"syncMessage"`
	ReceiptMessage json.RawMessage `json:"receiptMessage"`
	TypingMessage  json.RawMessage `json:"typingMessage"`
}

type dataMessage struct {
	Message     string           `json:"message"`
	Timestamp   int64            `json:"timestamp"`
	GroupInfo   *groupInfo       `json:"groupInfo"`
	Attachments []attachmentMeta `json:"attachments"`
	Quote       *quote           `json:"quote"`
}

type groupInfo struct {
	GroupID string `json:"groupId"`
}

type attachmentMeta struct {
	ContentType string `json:"contentType"`
	Filename    string `json:"filename"`
	ID          string `json:"id"`
}

type quote struct {
	ID     int64  `json:"id"`
	Author string `json:"author"`
}

// parseEventFrame decodes one SSE data payload. Non-"receive" notifications
// yield (nil, nil): not an error, just nothing to do.
func parseEventFrame(data []byte) (*envelope, error) {
	var f eventFrame
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, fmt.Errorf("signal events: decode frame: %w", err)
	}
	if f.Method != "receive" {
		return nil, nil
	}
	return &f.Params.Envelope, nil
}

// normalizeEnvelope maps a receive envelope onto the gateway's normalized
// InboundMessage (attachments are resolved separately — they need the
// filesystem). ok=false means the envelope should be ignored: sync messages
// (our own sends echoed back), receipts, typing notifications, and envelopes
// without a data message.
func normalizeEnvelope(env *envelope) (transport.InboundMessage, bool) {
	if env.SyncMessage != nil || env.ReceiptMessage != nil || env.TypingMessage != nil {
		return transport.InboundMessage{}, false
	}
	dm := env.DataMessage
	if dm == nil {
		return transport.InboundMessage{}, false
	}

	userID := env.SourceNumber
	if userID == "" {
		userID = env.SourceUUID
	}
	if userID == "" {
		return transport.InboundMessage{}, false
	}

	chatID := env.SourceNumber
	if chatID == "" {
		chatID = env.SourceUUID
	}
	if dm.GroupInfo != nil && dm.GroupInfo.GroupID != "" {
		chatID = groupChatPrefix + dm.GroupInfo.GroupID
	}

	ts := env.Timestamp
	if ts == 0 {
		ts = dm.Timestamp
	}

	replyTo := ""
	if dm.Quote != nil && dm.Quote.ID != 0 {
		replyTo = strconv.FormatInt(dm.Quote.ID, 10)
	}

	return transport.InboundMessage{
		Platform:   "signal",
		ChatID:     chatID,
		UserID:     userID,
		MessageID:  strconv.FormatInt(ts, 10),
		ReplyToID:  replyTo,
		Text:       dm.Message,
		ReceivedAt: time.Now(),
		Raw:        env,
	}, true
}

// =============================================================================
// outbound helpers (pure functions)
// =============================================================================

// resolveTarget splits a ChatID into the JSON-RPC recipient/groupId pair.
func resolveTarget(chatID string) (recipient []string, groupID string, err error) {
	if chatID == "" {
		return nil, "", errors.New("chatID required")
	}
	if g, ok := strings.CutPrefix(chatID, groupChatPrefix); ok {
		if g == "" {
			return nil, "", errors.New("empty group id")
		}
		return nil, g, nil
	}
	return []string{chatID}, "", nil
}

// flattenOutbound collapses an OutboundMessage to plain text. Signal declares
// SupportsCards=false so the bridge always populates Text; Blocks are a
// defensive fallback.
func flattenOutbound(m transport.OutboundMessage) string {
	if m.Text != "" {
		return m.Text
	}
	var parts []string
	for _, b := range m.Blocks {
		if b.Text != "" {
			parts = append(parts, b.Text)
		}
	}
	return strings.Join(parts, "\n")
}

// renderButtonsFallback appends a numbered plain-text list for the inline
// keyboard the platform cannot render (types.go convention). Numbering is
// continuous across rows. When a button's Value differs from its label it is
// shown in brackets so the user can answer with either the number or the
// value.
func renderButtonsFallback(text string, rows [][]transport.Button) string {
	var lines []string
	for _, row := range rows {
		for _, btn := range row {
			line := fmt.Sprintf("%d. %s", len(lines)+1, btn.Text)
			if btn.Value != "" && btn.Value != btn.Text {
				line += " [" + btn.Value + "]"
			}
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 {
		return text
	}
	list := strings.Join(lines, "\n")
	if text == "" {
		return list
	}
	return text + "\n\n" + list
}
