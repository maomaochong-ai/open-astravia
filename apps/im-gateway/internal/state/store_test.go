package state

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestFileStore_LoadMissingFile(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "missing.json"))
	state, err := store.Load(context.Background())
	if err != nil {
		t.Fatalf("Load missing should not error: %v", err)
	}
	if state.Version != CurrentVersion {
		t.Errorf("default version: want %d, got %d", CurrentVersion, state.Version)
	}
	if len(state.Sessions) != 0 {
		t.Errorf("expected empty sessions, got %d", len(state.Sessions))
	}
}

func TestFileStore_SaveAndReload(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store := NewFileStore(path)

	if err := store.SetSession(context.Background(), SessionEntry{
		UserID:      "user1",
		ChatID:      "proj1",
		SessionPath: "/tmp/session1.jsonl",
	}); err != nil {
		t.Fatalf("SetSession: %v", err)
	}

	// Reload from disk via a fresh store
	store2 := NewFileStore(path)
	got, ok, err := store2.GetSession(context.Background(), "user1", "proj1")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if !ok {
		t.Fatal("expected session entry to exist after reload")
	}
	if got.SessionPath != "/tmp/session1.jsonl" {
		t.Errorf("unexpected path: %s", got.SessionPath)
	}
	if got.UpdatedAt.IsZero() {
		t.Error("UpdatedAt should be populated")
	}
}

func TestFileStore_GetSession_Missing(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "state.json"))
	_, ok, err := store.GetSession(context.Background(), "nope", "nope")
	if err != nil {
		t.Fatalf("GetSession on empty store: %v", err)
	}
	if ok {
		t.Error("expected ok=false for missing entry")
	}
}

func TestFileStore_AtomicWrite_NoTempLeftBehind(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.json")
	store := NewFileStore(path)
	if err := store.SetSession(context.Background(), SessionEntry{
		UserID: "u", ChatID: "p", SessionPath: "/a",
	}); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() != "state.json" {
			t.Errorf("unexpected file in state dir: %s", e.Name())
		}
	}
}

func TestFileStore_AtomicWrite_WellFormedJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store := NewFileStore(path)
	if err := store.SetSession(context.Background(), SessionEntry{
		UserID: "u", ChatID: "p", SessionPath: "/a",
	}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var parsed RouterState
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("state.json should be well-formed JSON: %v\n%s", err, raw)
	}
	if parsed.Version != CurrentVersion {
		t.Errorf("persisted version: want %d, got %d", CurrentVersion, parsed.Version)
	}
}

func TestFileStore_ConcurrentSaves_Serialized(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store := NewFileStore(path)

	const N = 50
	var wg sync.WaitGroup
	wg.Add(N)
	for i := range N {
		go func(i int) {
			defer wg.Done()
			_ = store.SetSession(context.Background(), SessionEntry{
				UserID:      "user",
				ChatID:      "proj",
				SessionPath: "/sessions/" + string(rune('a'+i%26)),
			})
		}(i)
	}
	wg.Wait()

	// File should still parse cleanly after all the parallel writes
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var parsed RouterState
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("concurrent saves corrupted state: %v\n%s", err, raw)
	}
	if _, ok := parsed.Sessions[SessionKey("user", "proj")]; !ok {
		t.Error("entry missing after concurrent saves")
	}
}

func TestFileStore_PreservesOtherEntriesWhenSetting(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store := NewFileStore(path)

	if err := store.SetSession(context.Background(), SessionEntry{
		UserID: "u1", ChatID: "p1", SessionPath: "/a",
	}); err != nil {
		t.Fatal(err)
	}

	// Fresh store reading the same file — must not lose u1/p1
	store2 := NewFileStore(path)
	if err := store2.SetSession(context.Background(), SessionEntry{
		UserID: "u2", ChatID: "p2", SessionPath: "/b",
	}); err != nil {
		t.Fatal(err)
	}

	store3 := NewFileStore(path)
	if _, ok, _ := store3.GetSession(context.Background(), "u1", "p1"); !ok {
		t.Error("u1/p1 lost after second store wrote u2/p2")
	}
	if _, ok, _ := store3.GetSession(context.Background(), "u2", "p2"); !ok {
		t.Error("u2/p2 should be present")
	}
}

func TestFileStore_MalformedFile_ReturnsError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	if err := os.WriteFile(path, []byte("not valid json"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := NewFileStore(path)
	_, err := store.Load(context.Background())
	if err == nil {
		t.Fatal("expected error on malformed state file")
	}
}
