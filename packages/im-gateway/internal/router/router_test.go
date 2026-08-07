package router

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"strings"
	"sync"
	"testing"
	"time"

	"vetta-im-gateway/internal/command"
	"vetta-im-gateway/internal/hostclient"
	"vetta-im-gateway/internal/state"
	"vetta-im-gateway/internal/transport"
)

// =============================================================================
// fakes
// =============================================================================

type fakeStore struct {
	mu      sync.Mutex
	entries map[string]state.SessionEntry
}

func newFakeStore() *fakeStore { return &fakeStore{entries: make(map[string]state.SessionEntry)} }

func (s *fakeStore) Load(_ context.Context) (state.RouterState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := state.RouterState{Version: state.CurrentVersion, Sessions: make(map[string]state.SessionEntry)}
	maps.Copy(out.Sessions, s.entries)
	return out, nil
}
func (s *fakeStore) Save(_ context.Context, _ state.RouterState) error { return nil }
func (s *fakeStore) GetSession(_ context.Context, userID, chatID string) (state.SessionEntry, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[state.SessionKey(userID, chatID)]
	return e, ok, nil
}
func (s *fakeStore) SetSession(_ context.Context, e state.SessionEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[state.SessionKey(e.UserID, e.ChatID)] = e
	return nil
}

// fakeTransport captures sends so tests can assert.
type fakeTransport struct {
	caps   transport.Capabilities
	mu     sync.Mutex
	sends  []sendRecord
	nextID int
}

type sendRecord struct {
	ChatID string
	Text   string
}

func newFakeTransport() *fakeTransport {
	return &fakeTransport{
		caps: transport.Capabilities{
			SupportsMessageEdit: false,
			MaxMessageLength:    1000,
		},
	}
}

func (t *fakeTransport) Name() string                         { return "fake" }
func (t *fakeTransport) Capabilities() transport.Capabilities { return t.caps }
func (t *fakeTransport) Start(_ context.Context, _ transport.MessageHandler) error {
	return nil
}
func (t *fakeTransport) Stop() error { return nil }
func (t *fakeTransport) SendMessage(_ context.Context, chatID string, msg transport.OutboundMessage) (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.nextID++
	t.sends = append(t.sends, sendRecord{ChatID: chatID, Text: msg.Text})
	return "m" + itoa(t.nextID), nil
}
func (t *fakeTransport) EditMessage(_ context.Context, _, _ string, _ transport.OutboundMessage) error {
	return nil
}
func (t *fakeTransport) DeleteMessage(_ context.Context, _, _ string) error { return nil }
func (t *fakeTransport) ShowTyping(_ context.Context, _ string) error       { return nil }
func (t *fakeTransport) SendAttachment(_ context.Context, _ string, _ transport.OutboundAttachment) (string, error) {
	return "", errors.New("fake: not supported")
}
func (t *fakeTransport) EndStream(_ context.Context, _, _ string) error { return nil }

func (t *fakeTransport) snapshot() []sendRecord {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]sendRecord, len(t.sends))
	copy(out, t.sends)
	return out
}

func itoa(n int) string {
	s := ""
	for n > 0 {
		s = string('0'+rune(n%10)) + s
		n /= 10
	}
	if s == "" {
		s = "0"
	}
	return s
}

const testCwd = "/home/u/.vetta/conversation"

func TestRouter_FirstMessageStartsSession_PersistsResolvedPath(t *testing.T) {
	// First message in a fresh chat: state has no entry yet. Router should
	// acquire a fresh session (sessionPath=""), then persist the resolved
	// path so subsequent messages in this chat reuse the same .jsonl.
	tr := newFakeTransport()
	st := newFakeStore()
	pool := hostclient.NewProcessPool(&streamingFakeClient{reply: "ok"}, 4)
	r := New(tr, command.NewRouter(), st, pool, testCwd)
	defer r.Shutdown()

	if err := r.HandleInbound(context.Background(), transport.InboundMessage{
		Platform: "fake", ChatID: "c1", UserID: "u1", MessageID: "m1", Text: "hello",
	}); err != nil {
		t.Fatal(err)
	}
	waitForSend(t, tr, 1, 2*time.Second)

	entry, ok, _ := st.GetSession(context.Background(), "u1", "c1")
	if !ok {
		t.Fatal("expected first message to persist a session entry")
	}
	if entry.SessionPath == "" {
		t.Error("forwardToAgent should have persisted the resolved sessionPath")
	}
}

func TestRouter_MigratedSessionReplacesPersistedLegacyPath(t *testing.T) {
	tr := newFakeTransport()
	st := newFakeStore()
	st.entries[state.SessionKey("u1", "c1")] = state.SessionEntry{
		UserID: "u1", ChatID: "c1", SessionPath: "/sessions/legacy.jsonl",
	}
	pool := hostclient.NewProcessPool(&resolvedPathFakeClient{
		resolvedPath: "/sessions/migrated.conversation.jsonl",
	}, 4)
	r := New(tr, command.NewRouter(), st, pool, testCwd)
	defer r.Shutdown()

	if err := r.HandleInbound(context.Background(), transport.InboundMessage{
		Platform: "fake", ChatID: "c1", UserID: "u1", MessageID: "m1", Text: "hello",
	}); err != nil {
		t.Fatal(err)
	}
	waitForSend(t, tr, 1, 2*time.Second)

	entry, ok, _ := st.GetSession(context.Background(), "u1", "c1")
	if !ok || entry.SessionPath != "/sessions/migrated.conversation.jsonl" {
		t.Fatalf("persisted migrated path: got %+v", entry)
	}
}

type resolvedPathFakeClient struct {
	resolvedPath string
}

func (c *resolvedPathFakeClient) OpenSession(_ context.Context, _, _ string) (hostclient.HostSession, error) {
	return &streamingFakeSession{
		path:   c.resolvedPath,
		events: make(chan hostclient.AgentEvent, 16),
		reply:  "ok",
	}, nil
}

// recordingFakeClient records every OpenSession call so tests can assert
// the router passed the right cwd / sessionPath.
type recordingFakeClient struct {
	reply string
	mu    sync.Mutex
	opens []openCall
}

type openCall struct {
	cwd         string
	sessionPath string
}

func (c *recordingFakeClient) OpenSession(_ context.Context, cwd string, sessionPath string) (hostclient.HostSession, error) {
	c.mu.Lock()
	c.opens = append(c.opens, openCall{cwd: cwd, sessionPath: sessionPath})
	c.mu.Unlock()
	resolved := sessionPath
	if resolved == "" {
		resolved = "/sessions/synthesized/fake.jsonl"
	}
	return &streamingFakeSession{
		path:   resolved,
		events: make(chan hostclient.AgentEvent, 16),
		reply:  c.reply,
	}, nil
}

func TestRouter_RoutesToConversationCwd(t *testing.T) {
	// Every message must hit conversationCwd, regardless of who sends it.
	tr := newFakeTransport()
	st := newFakeStore()
	fc := &recordingFakeClient{reply: "ok"}
	pool := hostclient.NewProcessPool(fc, 4)
	r := New(tr, command.NewRouter(), st, pool, testCwd)
	defer r.Shutdown()

	if err := r.HandleInbound(context.Background(), transport.InboundMessage{
		Platform: "fake", ChatID: "c1", UserID: "u1", Text: "hi",
	}); err != nil {
		t.Fatal(err)
	}
	waitForSend(t, tr, 1, 2*time.Second)

	fc.mu.Lock()
	defer fc.mu.Unlock()
	if len(fc.opens) == 0 {
		t.Fatal("expected OpenSession to be called")
	}
	if got := fc.opens[0].cwd; got != testCwd {
		t.Errorf("OpenSession cwd: got %q, want %q", got, testCwd)
	}
}

func TestRouter_PlainPromptForwardsToAgent(t *testing.T) {
	tr := newFakeTransport()
	st := newFakeStore()
	pool := hostclient.NewProcessPool(&streamingFakeClient{reply: "hi"}, 4)
	r := New(tr, command.NewRouter(), st, pool, testCwd)
	defer r.Shutdown()

	if err := r.HandleInbound(context.Background(), transport.InboundMessage{
		Platform: "fake", ChatID: "c1", UserID: "u1", MessageID: "m1", Text: "hello agent",
	}); err != nil {
		t.Fatal(err)
	}

	waitForSend(t, tr, 1, 2*time.Second)

	got := tr.snapshot()
	if len(got) == 0 {
		t.Fatal("expected at least one outbound message")
	}
	last := got[len(got)-1]
	if !strings.Contains(last.Text, "hi") || !strings.Contains(last.Text, "hello agent") {
		t.Errorf("expected agent reply containing prompt echo, got %q", last.Text)
	}
}

func TestRouter_CommandHandledLocally(t *testing.T) {
	tr := newFakeTransport()
	st := newFakeStore()
	pool := hostclient.NewProcessPool(&streamingFakeClient{}, 4)
	r := New(tr, command.NewRouter(), st, pool, testCwd)
	defer r.Shutdown()

	_ = r.HandleInbound(context.Background(), transport.InboundMessage{
		Platform: "fake", ChatID: "c1", UserID: "u1", Text: "/help",
	})
	waitForSend(t, tr, 1, 2*time.Second)

	got := tr.snapshot()
	if !strings.Contains(got[0].Text, "/help") {
		t.Errorf("expected help text, got %q", got[0].Text)
	}
}

func TestRouter_PerChatIsolation(t *testing.T) {
	// Same user, two chats → two independent sessions. The router's
	// per-(userID, chatID) goroutine keying must not collapse them.
	tr := newFakeTransport()
	st := newFakeStore()
	pool := hostclient.NewProcessPool(&streamingFakeClient{reply: "ok"}, 4)
	r := New(tr, command.NewRouter(), st, pool, testCwd)
	defer r.Shutdown()

	for _, chat := range []string{"c-private", "c-group"} {
		_ = r.HandleInbound(context.Background(), transport.InboundMessage{
			Platform: "fake", ChatID: chat, UserID: "u1", Text: "hi",
		})
	}
	waitForSend(t, tr, 2, 3*time.Second)

	got := tr.snapshot()
	chats := map[string]int{}
	for _, s := range got {
		chats[s.ChatID]++
	}
	if chats["c-private"] == 0 || chats["c-group"] == 0 {
		t.Errorf("both chats should receive a reply, got %v", chats)
	}

	// Each chat should have its own session entry persisted.
	if _, ok, _ := st.GetSession(context.Background(), "u1", "c-private"); !ok {
		t.Error("expected per-chat state entry for c-private")
	}
	if _, ok, _ := st.GetSession(context.Background(), "u1", "c-group"); !ok {
		t.Error("expected per-chat state entry for c-group")
	}
}

// gatedClient blocks OpenSession until release is closed, signalling via
// opened once the first OpenSession is reached. Lets a test deterministically
// enqueue a second message inside the acquire window (ADR-0010).
type gatedClient struct {
	reply   string
	release chan struct{}
	opened  chan struct{}
	once    sync.Once
}

func (c *gatedClient) OpenSession(_ context.Context, _ string, sessionPath string) (hostclient.HostSession, error) {
	c.once.Do(func() { close(c.opened) })
	<-c.release
	resolved := sessionPath
	if resolved == "" {
		resolved = "/sessions/synthesized/gated.jsonl"
	}
	return &streamingFakeSession{
		path:   resolved,
		events: make(chan hostclient.AgentEvent, 16),
		reply:  c.reply,
	}, nil
}

func TestRouter_CoalescesBurstDuringAcquire(t *testing.T) {
	// Two messages from the same chat, the second arriving while the agent is
	// still being acquired (cold start), must coalesce into a single prompt and
	// produce exactly one reply — not two turns, two replies (ADR-0010).
	tr := newFakeTransport()
	st := newFakeStore()
	gc := &gatedClient{reply: "ok", release: make(chan struct{}), opened: make(chan struct{})}
	pool := hostclient.NewProcessPool(gc, 4)
	r := New(tr, command.NewRouter(), st, pool, testCwd)
	defer r.Shutdown()

	// First message seeds the turn; runTurn blocks inside Acquire/OpenSession.
	if err := r.HandleInbound(context.Background(), transport.InboundMessage{
		Platform: "fake", ChatID: "c1", UserID: "u1", Text: "part one",
	}); err != nil {
		t.Fatal(err)
	}
	<-gc.opened // runTurn is now blocked in the acquire window

	// Second message lands in the queue before Acquire returns. HandleInbound
	// returns only after the message is enqueued, so releasing afterwards
	// guarantees the drain sees it — coalescing it into the seed prompt.
	if err := r.HandleInbound(context.Background(), transport.InboundMessage{
		Platform: "fake", ChatID: "c1", UserID: "u1", Text: "part two",
	}); err != nil {
		t.Fatal(err)
	}
	close(gc.release)

	waitForSend(t, tr, 1, 2*time.Second)
	// Give any erroneous second turn a chance to surface before asserting.
	time.Sleep(100 * time.Millisecond)

	got := tr.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected exactly one coalesced reply, got %d: %v", len(got), got)
	}
	if !strings.Contains(got[0].Text, "part one") || !strings.Contains(got[0].Text, "part two") {
		t.Errorf("coalesced reply should contain both messages, got %q", got[0].Text)
	}
}

// streamingFakeClient hands out a fresh streamingFakeSession on every Acquire.
// Each call gets a unique synthesized sessionPath so the pool (keyed by
// resolved path) doesn't collapse independent sessions onto a single
// already-drained event channel.
type streamingFakeClient struct {
	reply string
	mu    sync.Mutex
	seq   int
}

func (c *streamingFakeClient) OpenSession(_ context.Context, _ string, sessionPath string) (hostclient.HostSession, error) {
	resolved := sessionPath
	if resolved == "" {
		// Simulate the real local hostclient: when the caller passes an
		// empty path, the agent invents a fresh session file and returns
		// it via the handshake's get_state. SessionPath() should report
		// the resolved value.
		c.mu.Lock()
		c.seq++
		resolved = "/sessions/synthesized/fake-" + itoa(c.seq) + ".jsonl"
		c.mu.Unlock()
	}
	return &streamingFakeSession{
		path:   resolved,
		events: make(chan hostclient.AgentEvent, 16),
		reply:  c.reply,
	}, nil
}

type streamingFakeSession struct {
	path   string
	events chan hostclient.AgentEvent
	reply  string
}

func (s *streamingFakeSession) SendNoReply(_ context.Context, _ hostclient.Command) error { return nil }

func (s *streamingFakeSession) Send(_ context.Context, cmd hostclient.Command) (hostclient.Response, error) {
	if cmd.Type == hostclient.CommandTypePrompt {
		text := s.reply
		if text == "" {
			text = "echo:"
		}
		prompt, _ := cmd.Data["message"].(string)
		go func() {
			delta, _ := json.Marshal(map[string]any{
				"type": hostclient.AgentEventTypeMessageUpdate,
				"assistantMessageEvent": map[string]any{
					"type":  "text_delta",
					"delta": text + " " + prompt,
				},
			})
			end, _ := json.Marshal(map[string]any{"type": hostclient.AgentEventTypeAgentEnd})
			s.events <- hostclient.AgentEvent{Type: hostclient.AgentEventTypeMessageUpdate, Raw: delta}
			s.events <- hostclient.AgentEvent{Type: hostclient.AgentEventTypeAgentEnd, Raw: end}
			close(s.events)
		}()
		return hostclient.Response{Success: true}, nil
	}
	if cmd.Type == hostclient.CommandTypeGetState {
		return hostclient.Response{Success: true, Data: map[string]any{"sessionFile": s.path}}, nil
	}
	return hostclient.Response{Success: true}, nil
}
func (s *streamingFakeSession) Events() <-chan hostclient.AgentEvent { return s.events }
func (s *streamingFakeSession) SessionPath() string                  { return s.path }
func (s *streamingFakeSession) Close() error                         { return nil }

type crashRecoveryClient struct {
	mu      sync.Mutex
	opens   int
	prompts []string
}

func (c *crashRecoveryClient) OpenSession(_ context.Context, _, _ string) (hostclient.HostSession, error) {
	c.mu.Lock()
	c.opens++
	crash := c.opens == 1
	c.mu.Unlock()
	return &crashRecoverySession{
		client: c,
		path:   "/sessions/crash-recovery.jsonl",
		events: make(chan hostclient.AgentEvent, 4),
		crash:  crash,
	}, nil
}

func (c *crashRecoveryClient) snapshot() (int, []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.opens, append([]string(nil), c.prompts...)
}

type crashRecoverySession struct {
	client    *crashRecoveryClient
	path      string
	events    chan hostclient.AgentEvent
	crash     bool
	closeOnce sync.Once
}

func (s *crashRecoverySession) Send(_ context.Context, cmd hostclient.Command) (hostclient.Response, error) {
	if cmd.Type != hostclient.CommandTypePrompt {
		return hostclient.Response{Success: true}, nil
	}
	prompt, _ := cmd.Data["message"].(string)
	s.client.mu.Lock()
	s.client.prompts = append(s.client.prompts, prompt)
	s.client.mu.Unlock()
	if s.crash {
		go s.closeEvents()
		return hostclient.Response{Success: true}, nil
	}
	go func() {
		delta, _ := json.Marshal(map[string]any{
			"type": hostclient.AgentEventTypeMessageUpdate,
			"assistantMessageEvent": map[string]any{
				"type":  "text_delta",
				"delta": "recovered: " + prompt,
			},
		})
		end, _ := json.Marshal(map[string]any{"type": hostclient.AgentEventTypeAgentEnd})
		s.events <- hostclient.AgentEvent{Type: hostclient.AgentEventTypeMessageUpdate, Raw: delta}
		s.events <- hostclient.AgentEvent{Type: hostclient.AgentEventTypeAgentEnd, Raw: end}
	}()
	return hostclient.Response{Success: true}, nil
}

func (s *crashRecoverySession) SendNoReply(_ context.Context, _ hostclient.Command) error {
	return nil
}
func (s *crashRecoverySession) Events() <-chan hostclient.AgentEvent { return s.events }
func (s *crashRecoverySession) SessionPath() string                  { return s.path }
func (s *crashRecoverySession) Close() error {
	s.closeEvents()
	return nil
}
func (s *crashRecoverySession) closeEvents() { s.closeOnce.Do(func() { close(s.events) }) }

func TestRouter_DiscardsCrashedSessionWithoutReplayingTurn(t *testing.T) {
	tr := newFakeTransport()
	st := newFakeStore()
	client := &crashRecoveryClient{}
	pool := hostclient.NewProcessPool(client, 1)
	r := New(tr, command.NewRouter(), st, pool, testCwd)
	defer r.Shutdown()

	if err := r.HandleInbound(context.Background(), transport.InboundMessage{
		Platform: "fake", ChatID: "c1", UserID: "u1", Text: "first prompt",
	}); err != nil {
		t.Fatal(err)
	}
	waitForSend(t, tr, 1, 2*time.Second)
	deadline := time.Now().Add(2 * time.Second)
	for pool.Stats().Size != 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if stats := pool.Stats(); stats.Size != 0 {
		t.Fatalf("crashed session remained reusable: %+v", stats)
	}
	opens, prompts := client.snapshot()
	if opens != 1 || len(prompts) != 1 || prompts[0] != "first prompt" {
		t.Fatalf("crashed turn was unexpectedly replayed: opens=%d prompts=%v", opens, prompts)
	}

	if err := r.HandleInbound(context.Background(), transport.InboundMessage{
		Platform: "fake", ChatID: "c1", UserID: "u1", Text: "second prompt",
	}); err != nil {
		t.Fatal(err)
	}
	waitForSend(t, tr, 2, 2*time.Second)
	opens, prompts = client.snapshot()
	if opens != 2 {
		t.Fatalf("next user action did not create a fresh process: opens=%d", opens)
	}
	if len(prompts) != 2 || prompts[0] != "first prompt" || prompts[1] != "second prompt" {
		t.Fatalf("unexpected prompt delivery history: %v", prompts)
	}
}

func waitForSend(t *testing.T, tr *fakeTransport, n int, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if len(tr.snapshot()) >= n {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d sends, got %d", n, len(tr.snapshot()))
}
