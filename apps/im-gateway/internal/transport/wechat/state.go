package wechat

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"sync"

	"vetta-im-gateway/internal/transport/wechat/ilink"
)

// stateFileVersion is the schema version embedded in the persisted state
// file. Bumped on any breaking change to State.
const stateFileVersion = 1

// State is the on-disk persistence model for one bound WeChat account.
//
// The file holds three things in one place: the credentials returned by
// the QR bind flow, the long-poll cursor (so we resume after a restart
// without losing messages), and the per-peer context_token map (so we can
// reply with the right "context" linkage even after a restart).
//
// Single-account is the M1 assumption. To go multi-account, key the file
// path on ilink_bot_id and add an enclosing map at the call sites — the
// State struct itself does not need to change.
type State struct {
	Version       int                `json:"version"`
	Credentials   ilink.Credentials  `json:"credentials"`
	GetUpdatesBuf string             `json:"get_updates_buf"`
	ContextTokens map[string]string  `json:"context_tokens"` // peer ilink_user_id → token
}

// stateStore is the goroutine-safe atomic-write JSON store backing State.
//
// Concurrent calls to Save are serialized by the mutex; the same lock
// guards the in-memory copy so callers can read and write through the
// store without external coordination.
type stateStore struct {
	path string

	mu    sync.Mutex
	cache State
}

// newStateStore opens (or creates) the store at path. The parent directory
// is created on first save if it does not yet exist. Reading a missing
// file is not an error — it yields a zero-value State that the caller can
// populate after binding.
func newStateStore(path string) (*stateStore, error) {
	s := &stateStore{path: path, cache: State{Version: stateFileVersion, ContextTokens: make(map[string]string)}}
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s, nil
		}
		return nil, fmt.Errorf("wechat: read state %s: %w", path, err)
	}
	var loaded State
	if err := json.Unmarshal(raw, &loaded); err != nil {
		return nil, fmt.Errorf("wechat: parse state %s: %w", path, err)
	}
	if loaded.ContextTokens == nil {
		loaded.ContextTokens = make(map[string]string)
	}
	loaded.Version = stateFileVersion
	s.cache = loaded
	return s, nil
}

// Snapshot returns a defensive copy of the current state. Safe to mutate.
func (s *stateStore) Snapshot() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.cache
	out.ContextTokens = make(map[string]string, len(s.cache.ContextTokens))
	maps.Copy(out.ContextTokens, s.cache.ContextTokens)
	return out
}

// HasCredentials reports whether the persisted state contains a usable
// (post-bind) credential set.
func (s *stateStore) HasCredentials() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.cache.Credentials
	return c.BotToken != "" && c.BaseURL != "" && c.ILinkBotID != ""
}

// SetCredentials installs a fresh credential set (typically from the QR
// bind flow). Resets the cursor and per-peer context tokens — they are
// not portable across accounts.
func (s *stateStore) SetCredentials(creds ilink.Credentials) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cache.Credentials = creds
	s.cache.GetUpdatesBuf = ""
	s.cache.ContextTokens = make(map[string]string)
	return s.saveLocked()
}

// SetCursor persists a new long-poll cursor. Called after every successful
// getupdates call.
func (s *stateStore) SetCursor(buf string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cache.GetUpdatesBuf == buf {
		return nil
	}
	s.cache.GetUpdatesBuf = buf
	return s.saveLocked()
}

// Cursor returns the most-recent persisted cursor. Empty on first run.
func (s *stateStore) Cursor() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cache.GetUpdatesBuf
}

// Credentials returns a copy of the current credentials.
func (s *stateStore) Credentials() ilink.Credentials {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cache.Credentials
}

// SetContextToken updates the per-peer context_token map and persists.
func (s *stateStore) SetContextToken(peerID, token string) error {
	if peerID == "" || token == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cache.ContextTokens[peerID] == token {
		return nil
	}
	s.cache.ContextTokens[peerID] = token
	return s.saveLocked()
}

// ContextToken looks up a peer's most-recent context_token. Returns "" if
// none have been recorded yet (which forces the next outbound message to
// go without context_token, i.e. as a proactive push).
func (s *stateStore) ContextToken(peerID string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cache.ContextTokens[peerID]
}

// Clear wipes the entire store (memory + disk). Used by `wechat logout`.
func (s *stateStore) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cache = State{Version: stateFileVersion, ContextTokens: make(map[string]string)}
	if err := os.Remove(s.path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("wechat: remove state %s: %w", s.path, err)
	}
	return nil
}

// saveLocked writes the cache to disk via the standard tempfile + rename
// dance. Caller must hold s.mu.
func (s *stateStore) saveLocked() error {
	s.cache.Version = stateFileVersion
	if s.cache.ContextTokens == nil {
		s.cache.ContextTokens = make(map[string]string)
	}

	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("wechat: create state dir: %w", err)
	}
	data, err := json.MarshalIndent(s.cache, "", "  ")
	if err != nil {
		return fmt.Errorf("wechat: marshal state: %w", err)
	}
	data = append(data, '\n')

	tmp := fmt.Sprintf("%s.%d.tmp", s.path, os.Getpid())
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("wechat: open temp state: %w", err)
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return fmt.Errorf("wechat: write temp state: %w", err)
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return fmt.Errorf("wechat: fsync temp state: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("wechat: close temp state: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("wechat: rename state: %w", err)
	}
	return nil
}
