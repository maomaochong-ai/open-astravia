package state

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// FileStore persists RouterState as JSON to a single file. Writes go through
// the standard write-temp + fsync + rename atomic-write pattern, mirroring
// the convention used in desktop-app's atomic-write util and the
// SessionManager lockfile module. Concurrent Save calls are serialized
// internally; concurrent Load + Save is also safe (Load takes a read-side
// lock).
type FileStore struct {
	path string

	mu    sync.Mutex
	cache RouterState
	dirty bool // false until Load or Save establishes the in-memory cache
}

// NewFileStore returns a Store backed by the given path. The path's parent
// directory is created on first Save if it does not exist.
func NewFileStore(path string) *FileStore {
	return &FileStore{path: path}
}

// Load reads state from disk into the in-memory cache. Returns an empty
// RouterState (and stores it in the cache) when the file does not exist.
//
// Repeated calls re-read from disk so external edits are picked up.
func (s *FileStore) Load(_ context.Context) (RouterState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := readStateFile(s.path)
	if err != nil {
		return RouterState{}, err
	}
	s.cache = state
	s.dirty = true
	return cloneState(state), nil
}

// Save writes state to disk atomically and updates the in-memory cache.
func (s *FileStore) Save(_ context.Context, state RouterState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked(state)
}

// GetSession looks up a session entry. Loads from disk if the cache has not
// been primed.
func (s *FileStore) GetSession(ctx context.Context, userID, chatID string) (SessionEntry, bool, error) {
	s.mu.Lock()
	if !s.dirty {
		s.mu.Unlock()
		if _, err := s.Load(ctx); err != nil {
			return SessionEntry{}, false, err
		}
		s.mu.Lock()
	}
	defer s.mu.Unlock()
	entry, ok := s.cache.Sessions[SessionKey(userID, chatID)]
	return entry, ok, nil
}

// SetSession upserts an entry in the routing table and persists the new
// state. UpdatedAt is overwritten with time.Now().
func (s *FileStore) SetSession(ctx context.Context, entry SessionEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.dirty {
		// Prime the cache from disk first so we don't blow away other
		// entries that were not in memory yet.
		state, err := readStateFile(s.path)
		if err != nil {
			return err
		}
		s.cache = state
		s.dirty = true
	}

	if s.cache.Sessions == nil {
		s.cache.Sessions = make(map[string]SessionEntry)
	}
	entry.UpdatedAt = time.Now().UTC()
	s.cache.Sessions[SessionKey(entry.UserID, entry.ChatID)] = entry
	return s.saveLocked(s.cache)
}

func (s *FileStore) saveLocked(state RouterState) error {
	state.Version = CurrentVersion
	if state.Sessions == nil {
		state.Sessions = make(map[string]SessionEntry)
	}

	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create state dir: %w", err)
	}

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal state: %w", err)
	}
	data = append(data, '\n')

	tmpPath := fmt.Sprintf("%s.%d.tmp", s.path, os.Getpid())
	f, err := os.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("open temp state file: %w", err)
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("write temp state: %w", err)
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("fsync temp state: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("close temp state: %w", err)
	}
	if err := os.Rename(tmpPath, s.path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename temp state: %w", err)
	}

	s.cache = cloneState(state)
	s.dirty = true
	return nil
}

// readStateFile loads RouterState from disk. Returns an empty state when
// the file does not exist (this is the first-run case) or when the file
// is in the legacy (userID, projectID) format. Returns an error for
// malformed files.
//
// Legacy detection: pre-v2 files use a different routing key (projectId
// instead of chatId) and the entries reference sessionPaths rooted under
// per-project cwds. There is no useful migration — the new model collapses
// every IM session into the default "对话" cwd, which is a different
// directory entirely. We drop the file and start fresh.
func readStateFile(path string) (RouterState, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return RouterState{Version: CurrentVersion, Sessions: make(map[string]SessionEntry)}, nil
		}
		return RouterState{}, fmt.Errorf("read state %s: %w", path, err)
	}
	// Probe the version field before full unmarshal so we can recognize the
	// legacy schema without forcing struct compatibility.
	var probe struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(raw, &probe); err == nil && probe.Version != 0 && probe.Version < CurrentVersion {
		return RouterState{Version: CurrentVersion, Sessions: make(map[string]SessionEntry)}, nil
	}
	var state RouterState
	if err := json.Unmarshal(raw, &state); err != nil {
		return RouterState{}, fmt.Errorf("parse state %s: %w", path, err)
	}
	if state.Sessions == nil {
		state.Sessions = make(map[string]SessionEntry)
	}
	return state, nil
}

// cloneState returns a deep-ish copy so the caller can mutate without
// touching the cache. Sessions is a map so it needs an explicit copy;
// SessionEntry has no nested heap allocations.
func cloneState(s RouterState) RouterState {
	out := RouterState{
		Version:  s.Version,
		Sessions: make(map[string]SessionEntry, len(s.Sessions)),
	}
	maps.Copy(out.Sessions, s.Sessions)
	return out
}

// Compile-time check that FileStore satisfies the Store interface defined
// in types.go.
var _ Store = (*FileStore)(nil)
