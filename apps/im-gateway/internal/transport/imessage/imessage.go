// Package imessage implements transport.Transport for Apple iMessage on
// macOS using the local-account approach popularized by mautrix-imessage
// and OpenClaw's imsg channel:
//
//   - Inbound: poll ~/Library/Messages/chat.db (the Messages.app SQLite
//     store) read-only for new message rows past a ROWID cursor taken at
//     startup (history is never replayed).
//   - Outbound: drive Messages.app via `osascript -e` AppleScript. There
//     is no API to observe the resulting message, so send paths return a
//     synthetic message ID.
//
// The package compiles and unit-tests on every OS: the SQLite driver is
// pure Go (modernc.org/sqlite) and osascript execution is behind an
// injectable scriptRunner. Start refuses to run outside darwin.
//
// Reading chat.db requires the Full Disk Access privacy grant for the
// process; sending via osascript requires the Automation grant for
// Messages.app. Both are macOS user-approval dialogs, not code.
package imessage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"

	"vetta-im-gateway/internal/transport"
	"vetta-im-gateway/internal/transport/inbox"
)

// pollQuery selects every message row past the cursor, joined to its
// sender handle and containing chat. Notes on the schema:
//
//   - message.date is nanoseconds since 2001-01-01 on modern macOS.
//   - attributedBody carries the NSKeyedArchiver typedstream payload used
//     when message.text is NULL (newer macOS versions).
//   - The inner JOIN on handle drops rows with handle_id=0; those are
//     is_from_me rows (our own sends), which we skip anyway.
//   - chat.guid looks like "iMessage;-;+15551234567" and doubles as the
//     AppleScript `chat id` address for replies.
const pollQuery = `
SELECT m.ROWID, m.guid, m.text, m.attributedBody, m.date, m.is_from_me,
       h.id AS handle, c.guid AS chat_guid
FROM message m
JOIN handle h ON m.handle_id = h.ROWID
JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
JOIN chat c ON c.ROWID = cmj.chat_id
WHERE m.ROWID > ?
ORDER BY m.ROWID`

// attachmentQuery lists the file attachments of one message row.
// attachment.filename is an absolute path (often "~/Library/Messages/
// Attachments/...") into the local filesystem.
const attachmentQuery = `
SELECT a.filename, a.transfer_name, a.mime_type
FROM attachment a
JOIN message_attachment_join maj ON maj.attachment_id = a.ROWID
WHERE maj.message_id = ?`

// cursorQuery seeds the ROWID cursor at startup so history is not replayed.
const cursorQuery = `SELECT COALESCE(MAX(ROWID), 0) FROM message`

// attachmentDropHint is sent back to the chat when an inbound message
// consists only of attachments but no InboxDir is configured, so the user
// knows the file went nowhere.
const attachmentDropHint = "收到附件，但网关未配置收件目录，附件已被忽略，请发送文字消息。"

// appleEpochUnix is the Unix timestamp of the Apple reference date
// (2001-01-01 00:00:00 UTC), the epoch of message.date.
const appleEpochUnix = 978307200

// scriptRunner executes one AppleScript source string and returns its
// stdout. Abstracted so tests can capture the generated script without
// requiring osascript (or macOS) to exist.
type scriptRunner func(ctx context.Context, script string) (string, error)

// osascriptRunner is the production runner: `osascript -e <script>`.
func osascriptRunner(ctx context.Context, script string) (string, error) {
	out, err := exec.CommandContext(ctx, "osascript", "-e", script).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("osascript: %w (output: %s)", err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// Options configures the iMessage transport.
type Options struct {
	// DBPath is the Messages.app SQLite store. Defaults to
	// ~/Library/Messages/chat.db.
	DBPath string

	// PollInterval is the delay between chat.db polls. Defaults to 2s.
	PollInterval time.Duration

	// AllowedHandles restricts inbound messages to these sender handles
	// (phone numbers in +E.164 form or iCloud email addresses, as stored
	// in the handle table). Empty allows every sender.
	AllowedHandles []string

	// InboxDir is where inbound attachments are copied (via the shared
	// inbox package) so the agent can read them. Empty drops attachments
	// with a hint reply.
	InboxDir string
}

// Transport implements transport.Transport for iMessage.
type Transport struct {
	opts    Options
	allowed map[string]struct{} // lowercased handles; nil = allow all

	runScript scriptRunner

	db     *sql.DB
	cursor int64 // highest message.ROWID already processed

	mu      sync.Mutex
	stopped bool
	cancel  context.CancelFunc
}

// Compile-time interface check.
var _ transport.Transport = (*Transport)(nil)

// New constructs the transport. The database is opened lazily in Start so
// that construction works on machines where chat.db is not yet readable.
func New(opts Options) (*Transport, error) {
	if opts.DBPath == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("imessage new: resolve home dir: %w", err)
		}
		opts.DBPath = filepath.Join(home, "Library", "Messages", "chat.db")
	}
	if opts.PollInterval <= 0 {
		opts.PollInterval = 2 * time.Second
	}
	var allowed map[string]struct{}
	if len(opts.AllowedHandles) > 0 {
		allowed = make(map[string]struct{}, len(opts.AllowedHandles))
		for _, h := range opts.AllowedHandles {
			allowed[strings.ToLower(strings.TrimSpace(h))] = struct{}{}
		}
	}
	return &Transport{
		opts:      opts,
		allowed:   allowed,
		runScript: osascriptRunner,
	}, nil
}

func (t *Transport) Name() string { return "imessage" }

// Capabilities: AppleScript can only fire-and-forget new messages — no
// edit, delete, card, button, thread, typing, or reaction control is
// exposed — so everything except file sending is off. Tapbacks would need
// private APIs, hence no Reactor implementation either.
func (t *Transport) Capabilities() transport.Capabilities {
	return transport.Capabilities{
		SupportsFileUpload: true, // via `send POSIX file ...`
	}
}

// Start opens chat.db, seeds the ROWID cursor at the current maximum, and
// blocks polling for new rows until ctx is cancelled or Stop is called.
// Poll errors back off exponentially (capped) instead of aborting: chat.db
// is briefly locked whenever Messages.app writes.
func (t *Transport) Start(ctx context.Context, handler transport.MessageHandler) error {
	if runtime.GOOS != "darwin" {
		return errors.New("imessage transport requires macOS")
	}

	t.mu.Lock()
	if t.stopped {
		t.mu.Unlock()
		return errors.New("imessage: Start called after Stop")
	}
	ctx, t.cancel = context.WithCancel(ctx)
	t.mu.Unlock()

	if err := t.openDB(); err != nil {
		return err
	}
	if err := t.initCursor(ctx); err != nil {
		return err
	}

	const maxBackoff = 30 * time.Second
	delay := t.opts.PollInterval
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
		if err := t.pollOnce(ctx, handler); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			delay *= 2
			if delay > maxBackoff {
				delay = maxBackoff
			}
			continue
		}
		delay = t.opts.PollInterval
	}
}

// openDB opens chat.db read-only. Messages.app holds the write lock;
// mode=ro plus a busy_timeout keeps us from ever blocking its writes or
// erroring on a transient lock.
func (t *Transport) openDB() error {
	dsn := "file:" + escapeDSNPath(t.opts.DBPath) +
		"?mode=ro&immutable=0&_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", dsn)
	if err == nil {
		err = db.Ping()
	}
	if err != nil {
		if db != nil {
			_ = db.Close()
		}
		return fmt.Errorf("imessage open db %s: %w (on macOS, grant Full Disk Access to this process in System Settings > Privacy & Security > Full Disk Access)", t.opts.DBPath, err)
	}
	t.db = db
	return nil
}

// initCursor records the current MAX(ROWID) so polling only ever sees
// messages that arrive after startup.
func (t *Transport) initCursor(ctx context.Context) error {
	if err := t.db.QueryRowContext(ctx, cursorQuery).Scan(&t.cursor); err != nil {
		return fmt.Errorf("imessage init cursor: %w", err)
	}
	return nil
}

// pollOnce runs one poll cycle: query rows past the cursor, dispatch each
// eligible one to handler, and advance the cursor to the highest ROWID
// seen (including skipped rows, so they are never re-examined). Handler
// errors are swallowed — one bad message must not stall the loop.
func (t *Transport) pollOnce(ctx context.Context, handler transport.MessageHandler) error {
	rows, err := t.db.QueryContext(ctx, pollQuery, t.cursor)
	if err != nil {
		return fmt.Errorf("imessage poll: %w", err)
	}
	defer rows.Close()

	maxRowID := t.cursor
	for rows.Next() {
		var (
			rowID      int64
			guid       string
			text       sql.NullString
			attributed []byte
			date       int64
			isFromMe   int
			handle     string
			chatGUID   string
		)
		if err := rows.Scan(&rowID, &guid, &text, &attributed, &date, &isFromMe, &handle, &chatGUID); err != nil {
			return fmt.Errorf("imessage poll scan: %w", err)
		}
		if rowID > maxRowID {
			maxRowID = rowID
		}
		if isFromMe == 1 {
			continue
		}
		if !t.handleAllowed(handle) {
			continue
		}

		body := text.String
		if body == "" {
			body = extractAttributedText(attributed)
		}
		attachments, hadAttachmentRows := t.collectAttachments(ctx, rowID, guid)

		if body == "" && len(attachments) == 0 {
			if hadAttachmentRows && t.opts.InboxDir == "" {
				// Attachment-only message with no inbox configured: tell
				// the user their file went nowhere. Best effort.
				_, _ = t.SendMessage(ctx, chatGUID, transport.OutboundMessage{Text: attachmentDropHint})
			}
			continue
		}

		msg := transport.InboundMessage{
			Platform:    "imessage",
			ChatID:      chatGUID,
			UserID:      handle,
			MessageID:   guid,
			Text:        body,
			Attachments: attachments,
			ReceivedAt:  appleTimestampToTime(date),
		}
		_ = handler.HandleInbound(ctx, msg)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("imessage poll rows: %w", err)
	}
	t.cursor = maxRowID
	return nil
}

// handleAllowed reports whether the sender handle passes AllowedHandles.
func (t *Transport) handleAllowed(handle string) bool {
	if t.allowed == nil {
		return true
	}
	_, ok := t.allowed[strings.ToLower(strings.TrimSpace(handle))]
	return ok
}

// collectAttachments copies each attachment file of one message row into
// the inbox and returns the resulting Attachment list. hadRows reports
// whether the message had any attachment rows at all (used for the
// no-inbox hint). Per-item errors (file moved/deleted, iCloud-evicted)
// are swallowed so one bad file does not drop the message text.
func (t *Transport) collectAttachments(ctx context.Context, rowID int64, msgGUID string) (out []transport.Attachment, hadRows bool) {
	rows, err := t.db.QueryContext(ctx, attachmentQuery, rowID)
	if err != nil {
		return nil, false
	}
	defer rows.Close()

	for rows.Next() {
		var filename, transferName, mimeType sql.NullString
		if err := rows.Scan(&filename, &transferName, &mimeType); err != nil {
			continue
		}
		hadRows = true
		if t.opts.InboxDir == "" || filename.String == "" {
			continue
		}
		att, err := t.persistAttachment(msgGUID, filename.String, transferName.String, mimeType.String)
		if err != nil {
			continue
		}
		out = append(out, att)
	}
	return out, hadRows
}

// persistAttachment copies one attachment file into the inbox.
func (t *Transport) persistAttachment(msgGUID, filename, transferName, mimeType string) (transport.Attachment, error) {
	path := expandHome(filename)
	b, err := os.ReadFile(path)
	if err != nil {
		return transport.Attachment{}, err
	}
	name := transferName
	if name == "" {
		name = filepath.Base(path)
	}
	inboxName := fmt.Sprintf("%s-%s", inbox.SanitizeForFilename(msgGUID), filepath.Base(name))
	absPath, err := inbox.Persist(t.opts.InboxDir, inboxName, b)
	if err != nil {
		return transport.Attachment{}, err
	}
	kind := transport.AttachmentFile
	if strings.HasPrefix(mimeType, "image/") {
		kind = transport.AttachmentImage
	}
	mt := mimeType
	if mt == "" {
		mt = inbox.MimeFromExt(filepath.Ext(name))
	}
	return transport.Attachment{
		Kind:     kind,
		Name:     filepath.Base(absPath),
		MimeType: mt,
		URL:      absPath,
	}, nil
}

// expandHome resolves a leading "~/" — attachment.filename rows are stored
// in that form.
func expandHome(p string) string {
	if strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, p[2:])
		}
	}
	return p
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
	if t.db != nil {
		_ = t.db.Close()
	}
	return nil
}

// SendMessage sends plain text via AppleScript. Buttons are rendered as a
// numbered plain-text list (SupportsButtons=false); ReplyToID is ignored
// (no thread addressing in AppleScript).
//
// AppleScript gives no way to observe the message GUID Messages.app
// assigns, so the returned ID is synthetic ("osa:<unix-nanos>") — good
// enough for logging, useless for edit/delete, which the platform does
// not support anyway.
func (t *Transport) SendMessage(ctx context.Context, chatID string, msg transport.OutboundMessage) (string, error) {
	if chatID == "" {
		return "", errors.New("imessage send: chatID required")
	}
	text := renderButtonsFallback(msg.Text, msg.Buttons)
	if text == "" {
		return "", errors.New("imessage send: empty outbound message")
	}
	script := buildSendTextScript(chatID, text)
	if _, err := t.runScript(ctx, script); err != nil {
		return "", fmt.Errorf("imessage send: %w", err)
	}
	return syntheticMessageID(), nil
}

// EditMessage is unsupported: Messages.app exposes no edit automation.
func (t *Transport) EditMessage(_ context.Context, _, _ string, _ transport.OutboundMessage) error {
	return errors.New("imessage: edit not supported")
}

// EndStream is a no-op; there is no streaming path.
func (t *Transport) EndStream(_ context.Context, _, _ string) error { return nil }

// DeleteMessage is unsupported: Messages.app exposes no delete automation.
func (t *Transport) DeleteMessage(_ context.Context, _, _ string) error {
	return errors.New("imessage: delete not supported")
}

// ShowTyping is a no-op: no typing-indicator automation exists.
func (t *Transport) ShowTyping(_ context.Context, _ string) error { return nil }

// SendAttachment sends a local file via AppleScript's POSIX file form. A
// non-empty caption is sent as a follow-up text message; caption failures
// are swallowed (the attachment already landed), mirroring feishu/wechat.
func (t *Transport) SendAttachment(ctx context.Context, chatID string, att transport.OutboundAttachment) (string, error) {
	if chatID == "" {
		return "", errors.New("imessage send attachment: chatID required")
	}
	if att.Path == "" {
		return "", errors.New("imessage send attachment: path required")
	}
	script := buildSendFileScript(chatID, att.Path)
	if _, err := t.runScript(ctx, script); err != nil {
		return "", fmt.Errorf("imessage send attachment: %w", err)
	}
	if att.Caption != "" {
		_, _ = t.SendMessage(ctx, chatID, transport.OutboundMessage{Text: att.Caption})
	}
	return syntheticMessageID(), nil
}

// =============================================================================
// pure helpers
// =============================================================================

// appleTimestampToTime converts a message.date value (nanoseconds since
// 2001-01-01 00:00:00 UTC on modern macOS) into a time.Time.
func appleTimestampToTime(ns int64) time.Time {
	return time.Unix(appleEpochUnix, ns).UTC()
}

// escapeAppleScript escapes a string for inclusion inside a double-quoted
// AppleScript string literal: backslash, double quote, and line breaks.
func escapeAppleScript(s string) string {
	r := strings.NewReplacer(
		`\`, `\\`,
		`"`, `\"`,
		"\r\n", `\n`,
		"\n", `\n`,
		"\r", `\n`,
	)
	return r.Replace(s)
}

// buildSendTextScript renders the AppleScript that sends text to a chat
// addressed by its GUID (chat.guid == AppleScript `chat id`).
func buildSendTextScript(chatGUID, text string) string {
	return fmt.Sprintf(`tell application "Messages" to send "%s" to chat id "%s"`,
		escapeAppleScript(text), escapeAppleScript(chatGUID))
}

// buildSendFileScript renders the AppleScript that sends a local file.
func buildSendFileScript(chatGUID, path string) string {
	return fmt.Sprintf(`tell application "Messages" to send POSIX file "%s" to chat id "%s"`,
		escapeAppleScript(path), escapeAppleScript(chatGUID))
}

// renderButtonsFallback appends buttons as a numbered plain-text list so
// the user can answer by typing the number or the value. Rows are
// flattened in order. Returns text unchanged when there are no buttons.
func renderButtonsFallback(text string, buttons [][]transport.Button) string {
	if len(buttons) == 0 {
		return text
	}
	var sb strings.Builder
	sb.WriteString(text)
	n := 0
	for _, row := range buttons {
		for _, b := range row {
			n++
			if sb.Len() > 0 {
				sb.WriteString("\n")
			}
			fmt.Fprintf(&sb, "%d. %s", n, b.Text)
		}
	}
	return sb.String()
}

// escapeDSNPath percent-encodes the characters that would terminate or
// corrupt the path portion of a SQLite `file:` URI. Slashes stay literal;
// SQLite decodes %XX escapes in URI filenames.
func escapeDSNPath(p string) string {
	return strings.NewReplacer("%", "%25", "?", "%3f", "#", "%23").Replace(p)
}

// syntheticMessageID fabricates an outbound message ID. See SendMessage.
func syntheticMessageID() string {
	return fmt.Sprintf("osa:%d", time.Now().UnixNano())
}
