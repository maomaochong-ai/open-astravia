package state

import (
	"context"
	"maps"
	"sync"
	"time"
)

// PatchHook is invoked synchronously after a successful SetSession on a
// MemoryStore. It receives a copy of the entry just written so the caller
// can forward the change (e.g. via hostproto state_patch events) without
// touching MemoryStore internals.
type PatchHook func(SessionEntry)

// MemoryStore is the host-mode implementation of Store: routing data lives
// only in memory, and the parent process is responsible for persistence.
// On every SetSession the store invokes a PatchHook so the parent receives
// the change as a state_patch event and can write it to its own atomic
// JSON file.
//
// Compared to FileStore this is simpler: no atomic writes, no temp files,
// no caching/dirty bookkeeping. The trade-off is the parent must replay
// the full state on every sidecar restart via the init frame.
type MemoryStore struct {
	mu       sync.Mutex
	sessions map[string]SessionEntry
	hook     PatchHook
}

// NewMemoryStore returns an empty store. Hook may be nil; without a hook
// the store still works but state changes are not reported to anyone.
func NewMemoryStore(hook PatchHook) *MemoryStore {
	return &MemoryStore{
		sessions: make(map[string]SessionEntry),
		hook:     hook,
	}
}

// Replace atomically swaps the in-memory routing table. Used when the
// parent injects an init frame containing a snapshot.
func (m *MemoryStore) Replace(state RouterState) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions = make(map[string]SessionEntry, len(state.Sessions))
	maps.Copy(m.sessions, state.Sessions)
}

// Load returns the current in-memory snapshot. The context is unused.
func (m *MemoryStore) Load(_ context.Context) (RouterState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := RouterState{
		Version:  CurrentVersion,
		Sessions: make(map[string]SessionEntry, len(m.sessions)),
	}
	maps.Copy(out.Sessions, m.sessions)
	return out, nil
}

// Save replaces the in-memory snapshot wholesale. Used by tests; the
// router itself goes through SetSession which fires the hook per-entry.
func (m *MemoryStore) Save(_ context.Context, state RouterState) error {
	m.Replace(state)
	return nil
}

// GetSession looks up a single (user, chat) entry.
func (m *MemoryStore) GetSession(_ context.Context, userID, chatID string) (SessionEntry, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	entry, ok := m.sessions[SessionKey(userID, chatID)]
	return entry, ok, nil
}

// SetSession upserts an entry and fires the patch hook (outside the lock).
func (m *MemoryStore) SetSession(_ context.Context, entry SessionEntry) error {
	entry.UpdatedAt = time.Now().UTC()
	m.mu.Lock()
	m.sessions[SessionKey(entry.UserID, entry.ChatID)] = entry
	hook := m.hook
	m.mu.Unlock()
	if hook != nil {
		hook(entry)
	}
	return nil
}

var _ Store = (*MemoryStore)(nil)
