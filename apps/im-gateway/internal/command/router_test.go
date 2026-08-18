package command

import (
	"context"
	"maps"
	"strings"
	"testing"
	"time"

	"vetta-im-gateway/internal/hostclient"
	"vetta-im-gateway/internal/state"
)

// fakeStore is a minimal in-memory state.Store implementation.
type fakeStore struct {
	entries map[string]state.SessionEntry
}

func newFakeStore() *fakeStore { return &fakeStore{entries: make(map[string]state.SessionEntry)} }

func (s *fakeStore) Load(_ context.Context) (state.RouterState, error) {
	out := state.RouterState{Version: state.CurrentVersion, Sessions: make(map[string]state.SessionEntry)}
	maps.Copy(out.Sessions, s.entries)
	return out, nil
}

func (s *fakeStore) Save(_ context.Context, st state.RouterState) error {
	s.entries = make(map[string]state.SessionEntry)
	maps.Copy(s.entries, st.Sessions)
	return nil
}

func (s *fakeStore) GetSession(_ context.Context, userID, chatID string) (state.SessionEntry, bool, error) {
	e, ok := s.entries[state.SessionKey(userID, chatID)]
	return e, ok, nil
}

func (s *fakeStore) SetSession(_ context.Context, e state.SessionEntry) error {
	if e.UpdatedAt.IsZero() {
		e.UpdatedAt = time.Now().UTC()
	}
	s.entries[state.SessionKey(e.UserID, e.ChatID)] = e
	return nil
}

// fakePool / fakeSession implement HostPool / hostclient.HostSession.
type fakePool struct {
	openErr error
	stats   hostclient.Stats
}

func (p *fakePool) Acquire(_ context.Context, _ string, sessionPath string) (*hostclient.Acquired, error) {
	if p.openErr != nil {
		return nil, p.openErr
	}
	return &hostclient.Acquired{Session: &fakeSess{path: sessionPath}}, nil
}

func (p *fakePool) Stats() hostclient.Stats { return p.stats }

type fakeSess struct {
	path string
}

func (s *fakeSess) Send(_ context.Context, _ hostclient.Command) (hostclient.Response, error) {
	return hostclient.Response{Success: true}, nil
}
func (s *fakeSess) SendNoReply(_ context.Context, _ hostclient.Command) error { return nil }
func (s *fakeSess) Events() <-chan hostclient.AgentEvent {
	ch := make(chan hostclient.AgentEvent)
	close(ch)
	return ch
}
func (s *fakeSess) SessionPath() string { return s.path }
func (s *fakeSess) Close() error        { return nil }

func defaultEnv() Env {
	return Env{
		UserID:          "u1",
		ChatID:          "c1",
		ConversationCwd: "/home/u/.vetta/conversation",
		State:           newFakeStore(),
		HostPool:        &fakePool{},
	}
}

func TestDispatch_NotACommand(t *testing.T) {
	r := NewRouter()
	res, err := r.Dispatch(context.Background(), defaultEnv(), "hello world")
	if err != nil {
		t.Fatal(err)
	}
	if !res.NotACommand {
		t.Error("plain text should be NotACommand")
	}
}

func TestDispatch_UnknownCommand(t *testing.T) {
	r := NewRouter()
	res, err := r.Dispatch(context.Background(), defaultEnv(), "/nope")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.Reply.Text, "未知命令") {
		t.Errorf("expected unknown-command reply, got %q", res.Reply.Text)
	}
}

func TestDispatch_Help(t *testing.T) {
	r := NewRouter()
	res, _ := r.Dispatch(context.Background(), defaultEnv(), "/help")
	for _, want := range []string{"/new", "/whoami", "/help", "可用命令"} {
		if !strings.Contains(res.Reply.Text, want) {
			t.Errorf("/help should mention %s, got:\n%s", want, res.Reply.Text)
		}
	}
	// No more project commands.
	for _, gone := range []string{"/projects", "/use"} {
		if strings.Contains(res.Reply.Text, gone) {
			t.Errorf("/help still mentions removed command %s:\n%s", gone, res.Reply.Text)
		}
	}
}

func TestDispatch_New_ClearsSession(t *testing.T) {
	r := NewRouter()
	env := defaultEnv()
	_ = env.State.SetSession(context.Background(), state.SessionEntry{
		UserID: "u1", ChatID: "c1", SessionPath: "/old/path.jsonl",
	})
	res, _ := r.Dispatch(context.Background(), env, "/new")
	if !strings.Contains(res.Reply.Text, "已开启新会话") {
		t.Errorf("got %q", res.Reply.Text)
	}
	entry, ok, _ := env.State.GetSession(context.Background(), "u1", "c1")
	if !ok {
		t.Fatal("expected entry to exist (with empty sessionPath)")
	}
	if entry.SessionPath != "" {
		t.Errorf("/new should clear sessionPath, got %q", entry.SessionPath)
	}
}

func TestDispatch_Whoami_NoSession(t *testing.T) {
	r := NewRouter()
	res, _ := r.Dispatch(context.Background(), defaultEnv(), "/whoami")
	if !strings.Contains(res.Reply.Text, "尚未开启") {
		t.Errorf("got %q", res.Reply.Text)
	}
}

func TestDispatch_Whoami_WithSession(t *testing.T) {
	r := NewRouter()
	env := defaultEnv()
	_ = env.State.SetSession(context.Background(), state.SessionEntry{
		UserID: "u1", ChatID: "c1", SessionPath: "/sessions/foo.jsonl",
	})
	res, _ := r.Dispatch(context.Background(), env, "/whoami")
	for _, want := range []string{"u1", "/sessions/foo.jsonl", "/home/u/.vetta/conversation"} {
		if !strings.Contains(res.Reply.Text, want) {
			t.Errorf("/whoami should contain %q, got:\n%s", want, res.Reply.Text)
		}
	}
}

func TestSplitArgs_BasicAndQuoted(t *testing.T) {
	cases := map[string][]string{
		"foo":              {"foo"},
		"foo bar":          {"foo", "bar"},
		`use "my project"`: {"use", "my project"},
		"  trim  ":         {"trim"},
		"":                 nil,
	}
	for in, want := range cases {
		got := splitArgs(in)
		if len(got) != len(want) {
			t.Errorf("splitArgs(%q) length: got %d want %d", in, len(got), len(want))
			continue
		}
		for i := range got {
			if got[i] != want[i] {
				t.Errorf("splitArgs(%q)[%d] = %q, want %q", in, i, got[i], want[i])
			}
		}
	}
}
