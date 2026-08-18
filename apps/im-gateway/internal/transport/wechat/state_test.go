package wechat

import (
	"path/filepath"
	"testing"

	"vetta-im-gateway/internal/transport/wechat/ilink"
)

func TestStateStore_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "wechat.json")

	s, err := newStateStore(path)
	if err != nil {
		t.Fatalf("newStateStore: %v", err)
	}
	if s.HasCredentials() {
		t.Error("fresh store should not have credentials")
	}

	creds := ilink.Credentials{
		BotToken:    "tok",
		ILinkBotID:  "bot",
		ILinkUserID: "user",
		BaseURL:     "https://msg.example.invalid",
	}
	if err := s.SetCredentials(creds); err != nil {
		t.Fatalf("SetCredentials: %v", err)
	}
	if err := s.SetCursor("cursor-1"); err != nil {
		t.Fatalf("SetCursor: %v", err)
	}
	if err := s.SetContextToken("alice", "ctx-a"); err != nil {
		t.Fatalf("SetContextToken: %v", err)
	}
	if err := s.SetContextToken("bob", "ctx-b"); err != nil {
		t.Fatalf("SetContextToken: %v", err)
	}

	// Reopen and verify everything round-tripped.
	s2, err := newStateStore(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if !s2.HasCredentials() {
		t.Fatal("reloaded store missing credentials")
	}
	if got := s2.Credentials(); got != creds {
		t.Errorf("creds = %+v, want %+v", got, creds)
	}
	if got := s2.Cursor(); got != "cursor-1" {
		t.Errorf("cursor = %q", got)
	}
	if got := s2.ContextToken("alice"); got != "ctx-a" {
		t.Errorf("alice ctx = %q", got)
	}
	if got := s2.ContextToken("bob"); got != "ctx-b" {
		t.Errorf("bob ctx = %q", got)
	}
	if got := s2.ContextToken("nobody"); got != "" {
		t.Errorf("unknown peer should yield empty: %q", got)
	}
}

func TestStateStore_SetCredentialsResetsCursorAndTokens(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "wechat.json")

	s, _ := newStateStore(path)
	_ = s.SetCredentials(ilink.Credentials{BotToken: "a", BaseURL: "u", ILinkBotID: "b"})
	_ = s.SetCursor("c1")
	_ = s.SetContextToken("p", "tok")

	// Re-bind.
	_ = s.SetCredentials(ilink.Credentials{BotToken: "z", BaseURL: "u2", ILinkBotID: "b2"})

	if s.Cursor() != "" {
		t.Errorf("rebind should clear cursor")
	}
	if s.ContextToken("p") != "" {
		t.Errorf("rebind should clear context tokens")
	}
}

func TestStateStore_Clear(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "wechat.json")
	s, _ := newStateStore(path)
	_ = s.SetCredentials(ilink.Credentials{BotToken: "a", BaseURL: "u", ILinkBotID: "b"})
	if err := s.Clear(); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	if s.HasCredentials() {
		t.Error("Clear should drop credentials")
	}
	// Re-clear should be idempotent.
	if err := s.Clear(); err != nil {
		t.Errorf("re-Clear: %v", err)
	}
}

func TestStateStore_MissingFileIsNotError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nope.json")
	s, err := newStateStore(path)
	if err != nil {
		t.Fatalf("newStateStore: %v", err)
	}
	if s.HasCredentials() {
		t.Error("missing file should yield zero state")
	}
}
