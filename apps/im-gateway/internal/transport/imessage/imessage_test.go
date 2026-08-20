package imessage

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"vetta-im-gateway/internal/transport"
)

// =============================================================================
// fixtures
// =============================================================================

// captureHandler records every inbound message it receives.
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

func (h *captureHandler) messages() []transport.InboundMessage {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]transport.InboundMessage(nil), h.msgs...)
}

// fakeRunner captures every AppleScript the transport tries to execute.
type fakeRunner struct {
	mu      sync.Mutex
	scripts []string
	err     error
}

func (f *fakeRunner) run(_ context.Context, script string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.scripts = append(f.scripts, script)
	return "", f.err
}

func (f *fakeRunner) all() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.scripts...)
}

// fakeDB is a writable handle on a minimal chat.db replica in a temp dir.
type fakeDB struct {
	t    *testing.T
	path string
	db   *sql.DB
}

// newFakeChatDB creates the minimal subset of the Messages.app schema the
// transport's queries touch.
func newFakeChatDB(t *testing.T) *fakeDB {
	t.Helper()
	path := filepath.Join(t.TempDir(), "chat.db")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatalf("open fake chat.db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	schema := []string{
		`CREATE TABLE message (
			ROWID INTEGER PRIMARY KEY,
			guid TEXT,
			text TEXT,
			attributedBody BLOB,
			date INTEGER,
			is_from_me INTEGER DEFAULT 0,
			handle_id INTEGER DEFAULT 0
		)`,
		`CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT)`,
		`CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT)`,
		`CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER)`,
		`CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, filename TEXT, transfer_name TEXT, mime_type TEXT)`,
		`CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER)`,
	}
	for _, stmt := range schema {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("create schema: %v", err)
		}
	}
	return &fakeDB{t: t, path: path, db: db}
}

func (f *fakeDB) exec(query string, args ...any) {
	f.t.Helper()
	if _, err := f.db.Exec(query, args...); err != nil {
		f.t.Fatalf("exec %q: %v", query, err)
	}
}

func (f *fakeDB) addHandle(rowID int64, id string) {
	f.exec(`INSERT INTO handle (ROWID, id) VALUES (?, ?)`, rowID, id)
}

func (f *fakeDB) addChat(rowID int64, guid string) {
	f.exec(`INSERT INTO chat (ROWID, guid) VALUES (?, ?)`, rowID, guid)
}

func (f *fakeDB) addMessage(rowID int64, guid string, text any, attributed []byte, date int64, isFromMe int, handleID, chatID int64) {
	f.exec(`INSERT INTO message (ROWID, guid, text, attributedBody, date, is_from_me, handle_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		rowID, guid, text, attributed, date, isFromMe, handleID)
	f.exec(`INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)`, chatID, rowID)
}

func (f *fakeDB) addAttachment(attRowID, msgRowID int64, filename, transferName, mimeType string) {
	f.exec(`INSERT INTO attachment (ROWID, filename, transfer_name, mime_type) VALUES (?, ?, ?, ?)`,
		attRowID, filename, transferName, mimeType)
	f.exec(`INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)`, msgRowID, attRowID)
}

// newTestTransport builds a Transport over the fake chat.db with the DB
// opened and the cursor seeded (as Start would do), plus a fake runner.
func newTestTransport(t *testing.T, f *fakeDB, opts Options) (*Transport, *fakeRunner) {
	t.Helper()
	opts.DBPath = f.path
	tr, err := New(opts)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	runner := &fakeRunner{}
	tr.runScript = runner.run
	if err := tr.openDB(); err != nil {
		t.Fatalf("openDB: %v", err)
	}
	t.Cleanup(func() { _ = tr.Stop() })
	if err := tr.initCursor(context.Background()); err != nil {
		t.Fatalf("initCursor: %v", err)
	}
	return tr, runner
}

// sampleAttributedBody builds a simplified typedstream-shaped blob that
// extractAttributedText understands: garbage prefix, the NSString marker,
// the version bytes, '+', a one-byte length, then the text.
func sampleAttributedBody(text string) []byte {
	b := []byte{0x04, 0x0b, 's', 't', 'r', 'e', 'a', 'm', 't', 'y', 'p', 'e', 'd'}
	b = append(b, []byte("NSString")...)
	b = append(b, 0x01, 0x94, 0x84, 0x01, '+')
	b = append(b, byte(len(text)))
	b = append(b, []byte(text)...)
	b = append(b, 0x86) // trailing typedstream noise
	return b
}

// =============================================================================
// polling
// =============================================================================

func TestPollOnce_DeliversNewMessages(t *testing.T) {
	f := newFakeChatDB(t)
	f.addHandle(1, "+15551234567")
	f.addChat(1, "iMessage;-;+15551234567")

	tr, _ := newTestTransport(t, f, Options{})
	// Inserted AFTER the cursor was seeded, so it counts as new.
	f.addMessage(10, "guid-1", "hello", nil, 1_000_000_000, 0, 1, 1)

	h := &captureHandler{}
	if err := tr.pollOnce(context.Background(), h); err != nil {
		t.Fatalf("pollOnce: %v", err)
	}
	msgs := h.messages()
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	m := msgs[0]
	if m.Platform != "imessage" {
		t.Errorf("Platform = %q", m.Platform)
	}
	if m.ChatID != "iMessage;-;+15551234567" {
		t.Errorf("ChatID = %q", m.ChatID)
	}
	if m.UserID != "+15551234567" {
		t.Errorf("UserID = %q", m.UserID)
	}
	if m.MessageID != "guid-1" {
		t.Errorf("MessageID = %q", m.MessageID)
	}
	if m.Text != "hello" {
		t.Errorf("Text = %q", m.Text)
	}
	want := time.Date(2001, 1, 1, 0, 0, 1, 0, time.UTC)
	if !m.ReceivedAt.Equal(want) {
		t.Errorf("ReceivedAt = %v, want %v", m.ReceivedAt, want)
	}
}

func TestPollOnce_NoHistoryReplay(t *testing.T) {
	f := newFakeChatDB(t)
	f.addHandle(1, "+15551234567")
	f.addChat(1, "iMessage;-;+15551234567")
	// Pre-existing history: must not be replayed because initCursor seeds
	// the cursor at the current MAX(ROWID).
	f.addMessage(5, "guid-old", "old", nil, 0, 0, 1, 1)

	tr, _ := newTestTransport(t, f, Options{})
	h := &captureHandler{}
	if err := tr.pollOnce(context.Background(), h); err != nil {
		t.Fatalf("pollOnce: %v", err)
	}
	if len(h.messages()) != 0 {
		t.Fatalf("history should not be replayed, got %d messages", len(h.messages()))
	}
}

func TestPollOnce_SkipsFromMe(t *testing.T) {
	f := newFakeChatDB(t)
	f.addHandle(1, "+15551234567")
	f.addChat(1, "iMessage;-;+15551234567")

	tr, _ := newTestTransport(t, f, Options{})
	f.addMessage(10, "guid-mine", "me talking", nil, 0, 1, 1, 1)
	f.addMessage(11, "guid-theirs", "them talking", nil, 0, 0, 1, 1)

	h := &captureHandler{}
	if err := tr.pollOnce(context.Background(), h); err != nil {
		t.Fatalf("pollOnce: %v", err)
	}
	msgs := h.messages()
	if len(msgs) != 1 || msgs[0].MessageID != "guid-theirs" {
		t.Fatalf("expected only the inbound message, got %+v", msgs)
	}
}

func TestPollOnce_AllowedHandlesFilter(t *testing.T) {
	f := newFakeChatDB(t)
	f.addHandle(1, "+15551234567")
	f.addHandle(2, "stranger@example.com")
	f.addChat(1, "iMessage;-;+15551234567")
	f.addChat(2, "iMessage;-;stranger@example.com")

	tr, _ := newTestTransport(t, f, Options{AllowedHandles: []string{"+15551234567"}})
	f.addMessage(10, "guid-ok", "hi", nil, 0, 0, 1, 1)
	f.addMessage(11, "guid-blocked", "spam", nil, 0, 0, 2, 2)

	h := &captureHandler{}
	if err := tr.pollOnce(context.Background(), h); err != nil {
		t.Fatalf("pollOnce: %v", err)
	}
	msgs := h.messages()
	if len(msgs) != 1 || msgs[0].MessageID != "guid-ok" {
		t.Fatalf("allowlist should filter, got %+v", msgs)
	}
}

func TestPollOnce_CursorAdvancesNoRedelivery(t *testing.T) {
	f := newFakeChatDB(t)
	f.addHandle(1, "+15551234567")
	f.addChat(1, "iMessage;-;+15551234567")

	tr, _ := newTestTransport(t, f, Options{})
	f.addMessage(10, "guid-1", "one", nil, 0, 0, 1, 1)

	h := &captureHandler{}
	ctx := context.Background()
	if err := tr.pollOnce(ctx, h); err != nil {
		t.Fatalf("pollOnce #1: %v", err)
	}
	if err := tr.pollOnce(ctx, h); err != nil {
		t.Fatalf("pollOnce #2: %v", err)
	}
	if len(h.messages()) != 1 {
		t.Fatalf("message redelivered: got %d", len(h.messages()))
	}

	f.addMessage(11, "guid-2", "two", nil, 0, 0, 1, 1)
	if err := tr.pollOnce(ctx, h); err != nil {
		t.Fatalf("pollOnce #3: %v", err)
	}
	msgs := h.messages()
	if len(msgs) != 2 || msgs[1].MessageID != "guid-2" {
		t.Fatalf("expected exactly the new message, got %+v", msgs)
	}
}

func TestPollOnce_CursorAdvancesPastSkippedRows(t *testing.T) {
	f := newFakeChatDB(t)
	f.addHandle(1, "+15551234567")
	f.addChat(1, "iMessage;-;+15551234567")

	tr, _ := newTestTransport(t, f, Options{})
	// Only a from-me row this round; the cursor must still move past it.
	f.addMessage(10, "guid-mine", "me", nil, 0, 1, 1, 1)

	h := &captureHandler{}
	ctx := context.Background()
	if err := tr.pollOnce(ctx, h); err != nil {
		t.Fatalf("pollOnce: %v", err)
	}
	if tr.cursor != 10 {
		t.Fatalf("cursor = %d, want 10", tr.cursor)
	}
}

func TestPollOnce_NullTextUsesAttributedBody(t *testing.T) {
	f := newFakeChatDB(t)
	f.addHandle(1, "+15551234567")
	f.addChat(1, "iMessage;-;+15551234567")

	tr, _ := newTestTransport(t, f, Options{})
	f.addMessage(10, "guid-ab", nil, sampleAttributedBody("hidden text"), 0, 0, 1, 1)

	h := &captureHandler{}
	if err := tr.pollOnce(context.Background(), h); err != nil {
		t.Fatalf("pollOnce: %v", err)
	}
	msgs := h.messages()
	if len(msgs) != 1 || msgs[0].Text != "hidden text" {
		t.Fatalf("attributedBody fallback failed, got %+v", msgs)
	}
}

func TestPollOnce_AttachmentPersistedToInbox(t *testing.T) {
	f := newFakeChatDB(t)
	f.addHandle(1, "+15551234567")
	f.addChat(1, "iMessage;-;+15551234567")

	srcDir := t.TempDir()
	srcPath := filepath.Join(srcDir, "photo.png")
	payload := []byte{0x89, 'P', 'N', 'G', 0, 0, 0, 0, 1, 2, 3}
	if err := os.WriteFile(srcPath, payload, 0o644); err != nil {
		t.Fatal(err)
	}

	inboxDir := t.TempDir()
	tr, _ := newTestTransport(t, f, Options{InboxDir: inboxDir})
	f.addMessage(10, "guid-att", "look at this", nil, 0, 0, 1, 1)
	f.addAttachment(1, 10, srcPath, "photo.png", "image/png")

	h := &captureHandler{}
	if err := tr.pollOnce(context.Background(), h); err != nil {
		t.Fatalf("pollOnce: %v", err)
	}
	msgs := h.messages()
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	atts := msgs[0].Attachments
	if len(atts) != 1 {
		t.Fatalf("expected 1 attachment, got %d", len(atts))
	}
	if atts[0].Kind != transport.AttachmentImage {
		t.Errorf("Kind = %q", atts[0].Kind)
	}
	if atts[0].MimeType != "image/png" {
		t.Errorf("MimeType = %q", atts[0].MimeType)
	}
	got, err := os.ReadFile(atts[0].URL)
	if err != nil {
		t.Fatalf("read persisted attachment: %v", err)
	}
	if string(got) != string(payload) {
		t.Error("persisted bytes differ from source")
	}
	if !strings.HasPrefix(atts[0].URL, inboxDir) {
		t.Errorf("attachment not under inbox dir: %s", atts[0].URL)
	}
}

func TestPollOnce_AttachmentOnlyWithoutInboxSendsHint(t *testing.T) {
	f := newFakeChatDB(t)
	f.addHandle(1, "+15551234567")
	f.addChat(1, "iMessage;-;+15551234567")

	tr, runner := newTestTransport(t, f, Options{}) // no InboxDir
	f.addMessage(10, "guid-att", nil, nil, 0, 0, 1, 1)
	f.addAttachment(1, 10, "/nonexistent/file.png", "file.png", "image/png")

	h := &captureHandler{}
	if err := tr.pollOnce(context.Background(), h); err != nil {
		t.Fatalf("pollOnce: %v", err)
	}
	if len(h.messages()) != 0 {
		t.Fatalf("attachment-only message should be dropped, got %+v", h.messages())
	}
	scripts := runner.all()
	if len(scripts) != 1 || !strings.Contains(scripts[0], attachmentDropHint) {
		t.Fatalf("expected hint reply script, got %v", scripts)
	}
}

// =============================================================================
// outbound
// =============================================================================

func TestSendMessage_Script(t *testing.T) {
	tr, err := New(Options{DBPath: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	runner := &fakeRunner{}
	tr.runScript = runner.run

	id, err := tr.SendMessage(context.Background(), `iMessage;-;+15551234567`, transport.OutboundMessage{
		Text: "hi \"there\"\nsecond line \\ end",
	})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if !strings.HasPrefix(id, "osa:") {
		t.Errorf("synthetic id = %q", id)
	}
	scripts := runner.all()
	if len(scripts) != 1 {
		t.Fatalf("expected 1 script, got %d", len(scripts))
	}
	want := `tell application "Messages" to send "hi \"there\"\nsecond line \\ end" to chat id "iMessage;-;+15551234567"`
	if scripts[0] != want {
		t.Errorf("script:\n got: %s\nwant: %s", scripts[0], want)
	}
}

func TestSendMessage_ButtonsRenderedAsList(t *testing.T) {
	tr, err := New(Options{DBPath: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	runner := &fakeRunner{}
	tr.runScript = runner.run

	_, err = tr.SendMessage(context.Background(), "chat", transport.OutboundMessage{
		Text: "pick one",
		Buttons: [][]transport.Button{
			{{Text: "Yes", Value: "y"}, {Text: "No", Value: "n"}},
			{{Text: "Maybe", Value: "m"}},
		},
	})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	script := runner.all()[0]
	for _, frag := range []string{`1. Yes`, `2. No`, `3. Maybe`} {
		if !strings.Contains(script, frag) {
			t.Errorf("script missing %q: %s", frag, script)
		}
	}
}

func TestSendAttachment_ScriptAndCaption(t *testing.T) {
	tr, err := New(Options{DBPath: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	runner := &fakeRunner{}
	tr.runScript = runner.run

	id, err := tr.SendAttachment(context.Background(), "iMessage;-;a@b.com", transport.OutboundAttachment{
		Kind:    transport.AttachmentFile,
		Path:    "/tmp/report final.pdf",
		Caption: "the report",
	})
	if err != nil {
		t.Fatalf("SendAttachment: %v", err)
	}
	if !strings.HasPrefix(id, "osa:") {
		t.Errorf("synthetic id = %q", id)
	}
	scripts := runner.all()
	if len(scripts) != 2 {
		t.Fatalf("expected file + caption scripts, got %d", len(scripts))
	}
	wantFile := `tell application "Messages" to send POSIX file "/tmp/report final.pdf" to chat id "iMessage;-;a@b.com"`
	if scripts[0] != wantFile {
		t.Errorf("file script:\n got: %s\nwant: %s", scripts[0], wantFile)
	}
	if !strings.Contains(scripts[1], `"the report"`) {
		t.Errorf("caption script: %s", scripts[1])
	}
}

func TestSendAttachment_CaptionFailureSwallowed(t *testing.T) {
	tr, err := New(Options{DBPath: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	tr.runScript = func(_ context.Context, _ string) (string, error) {
		calls++
		if calls == 2 {
			return "", context.DeadlineExceeded // caption send fails
		}
		return "", nil
	}
	if _, err := tr.SendAttachment(context.Background(), "chat", transport.OutboundAttachment{
		Path:    "/tmp/x.bin",
		Caption: "cap",
	}); err != nil {
		t.Fatalf("caption failure should be swallowed, got %v", err)
	}
}

func TestUnsupportedOps(t *testing.T) {
	tr, err := New(Options{DBPath: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := tr.EditMessage(ctx, "c", "m", transport.OutboundMessage{}); err == nil {
		t.Error("EditMessage should error")
	}
	if err := tr.DeleteMessage(ctx, "c", "m"); err == nil {
		t.Error("DeleteMessage should error")
	}
	if err := tr.EndStream(ctx, "c", "m"); err != nil {
		t.Errorf("EndStream should be a nil no-op, got %v", err)
	}
	if err := tr.ShowTyping(ctx, "c"); err != nil {
		t.Errorf("ShowTyping should be a nil no-op, got %v", err)
	}
}

func TestCapabilities(t *testing.T) {
	tr, err := New(Options{DBPath: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	caps := tr.Capabilities()
	if !caps.SupportsFileUpload {
		t.Error("SupportsFileUpload should be true")
	}
	if caps.SupportsMessageEdit || caps.SupportsCards || caps.SupportsButtons ||
		caps.SupportsThreads || caps.SupportsReactions || caps.DeferUntilTurnEnd {
		t.Errorf("all other capabilities should be false: %+v", caps)
	}
	if caps.MaxMessageLength != 0 {
		t.Errorf("MaxMessageLength = %d, want 0", caps.MaxMessageLength)
	}
}

// =============================================================================
// lifecycle
// =============================================================================

func TestStart_NonDarwinRefuses(t *testing.T) {
	if runtime.GOOS == "darwin" {
		t.Skip("only asserts on non-darwin hosts")
	}
	tr, err := New(Options{DBPath: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	if err := tr.Start(context.Background(), &captureHandler{}); err == nil ||
		!strings.Contains(err.Error(), "requires macOS") {
		t.Fatalf("expected macOS-required error, got %v", err)
	}
}

func TestStop_Idempotent(t *testing.T) {
	tr, err := New(Options{DBPath: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	if err := tr.Stop(); err != nil {
		t.Fatal(err)
	}
	if err := tr.Stop(); err != nil {
		t.Fatal(err)
	}
}

func TestOpenDB_MissingFileMentionsFullDiskAccess(t *testing.T) {
	tr, err := New(Options{DBPath: filepath.Join(t.TempDir(), "missing", "chat.db")})
	if err != nil {
		t.Fatal(err)
	}
	openErr := tr.openDB()
	if openErr == nil {
		t.Fatal("expected open error for missing db")
	}
	if !strings.Contains(openErr.Error(), "Full Disk Access") {
		t.Errorf("error should hint at Full Disk Access: %v", openErr)
	}
}

// =============================================================================
// pure helpers
// =============================================================================

func TestEscapeAppleScript(t *testing.T) {
	cases := []struct{ in, want string }{
		{"plain", "plain"},
		{`back\slash`, `back\\slash`},
		{`say "hi"`, `say \"hi\"`},
		{"line1\nline2", `line1\nline2`},
		{"line1\r\nline2", `line1\nline2`},
		{"line1\rline2", `line1\nline2`},
		{`mix "\` + "\n", `mix \"\\\n`},
		{"", ""},
	}
	for _, c := range cases {
		if got := escapeAppleScript(c.in); got != c.want {
			t.Errorf("escapeAppleScript(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestRenderButtonsFallback(t *testing.T) {
	cases := []struct {
		name    string
		text    string
		buttons [][]transport.Button
		want    string
	}{
		{"no buttons", "hello", nil, "hello"},
		{
			"single row",
			"pick",
			[][]transport.Button{{{Text: "A", Value: "a"}, {Text: "B", Value: "b"}}},
			"pick\n1. A\n2. B",
		},
		{
			"multi row numbering continues",
			"q",
			[][]transport.Button{{{Text: "A"}}, {{Text: "B"}}},
			"q\n1. A\n2. B",
		},
		{
			"empty text still lists",
			"",
			[][]transport.Button{{{Text: "Only"}}},
			"1. Only",
		},
	}
	for _, c := range cases {
		if got := renderButtonsFallback(c.text, c.buttons); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestAppleTimestampToTime(t *testing.T) {
	cases := []struct {
		ns   int64
		want time.Time
	}{
		{0, time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)},
		{1_000_000_000, time.Date(2001, 1, 1, 0, 0, 1, 0, time.UTC)},
		{694224000_000_000_000, time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC)},
	}
	for _, c := range cases {
		if got := appleTimestampToTime(c.ns); !got.Equal(c.want) {
			t.Errorf("appleTimestampToTime(%d) = %v, want %v", c.ns, got, c.want)
		}
	}
}

func TestExtractAttributedText(t *testing.T) {
	longText := strings.Repeat("x", 300)
	longSample := []byte("junkNSString")
	longSample = append(longSample, 0x01, 0x94, 0x84, 0x01, '+', 0x81, byte(300&0xff), byte(300>>8))
	longSample = append(longSample, []byte(longText)...)

	cases := []struct {
		name string
		in   []byte
		want string
	}{
		{"nil", nil, ""},
		{"empty", []byte{}, ""},
		{"no marker", []byte("random bytes without the token"), ""},
		{"simple sample", sampleAttributedBody("hello world"), "hello world"},
		{"utf8 sample", sampleAttributedBody("你好"), "你好"},
		{"two-byte length", longSample, longText},
		{"marker but truncated", []byte("NSString\x01\x94\x84\x01+"), ""},
		{"length past end", append([]byte("NSString\x01\x94\x84\x01+"), 0x50, 'h', 'i'), ""},
		{"mutable string marker", func() []byte {
			b := []byte("NSMutableString")
			return append(b, 0x01, 0x94, 0x84, 0x01, '+', 0x02, 'o', 'k')
		}(), "ok"},
	}
	for _, c := range cases {
		if got := extractAttributedText(c.in); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// =============================================================================
// real-machine integration (opt-in)
// =============================================================================

// TestIntegration_RealChatDB opens the live chat.db read-only and seeds a
// cursor. Gated because it needs macOS + Full Disk Access. It sends
// nothing.
func TestIntegration_RealChatDB(t *testing.T) {
	if os.Getenv("IMESSAGE_INTEGRATION_TEST") != "1" {
		t.Skip("set IMESSAGE_INTEGRATION_TEST=1 to run against the live chat.db")
	}
	if runtime.GOOS != "darwin" {
		t.Skip("darwin only")
	}
	tr, err := New(Options{})
	if err != nil {
		t.Fatal(err)
	}
	if err := tr.openDB(); err != nil {
		t.Fatalf("openDB: %v", err)
	}
	defer func() { _ = tr.Stop() }()
	if err := tr.initCursor(context.Background()); err != nil {
		t.Fatalf("initCursor: %v", err)
	}
	if tr.cursor <= 0 {
		t.Logf("cursor = %d (empty message table?)", tr.cursor)
	}
	if err := tr.pollOnce(context.Background(), &captureHandler{}); err != nil {
		t.Fatalf("pollOnce: %v", err)
	}
}
