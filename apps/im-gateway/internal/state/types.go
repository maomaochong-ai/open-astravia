package state

import (
	"context"
	"time"
)

// Schema version. Bump when RouterState fields change in an incompatible way
// and add a migration path in Store.Load.
const CurrentVersion = 2

// RouterState is the gateway's persistent routing table — a flat map from
// (im_user, chatID) to the agent session that should handle messages for
// that pair.
//
// All sessions live in desktop-app's default "对话" cwd; the gateway no
// longer routes per project. ChatID is the platform-native conversation id
// (feishu open_chat_id, wechat chat id, ...). Same user in private chat vs
// a group gets two independent sessions.
//
// Note: this state intentionally does NOT contain any conversation content.
// The agent's session manager owns the .jsonl files; the gateway only
// remembers which file belongs to which user/chat pair, so it can
// reattach after restart.
type RouterState struct {
	Version  int                     `json:"version"`
	Sessions map[string]SessionEntry `json:"sessions"` // key = SessionKey(userID, chatID)
}

// SessionEntry is one mapping from (user, chat) to a concrete session
// file. Persisted in state.json under a key derived from the user and
// chat IDs.
type SessionEntry struct {
	UserID      string    `json:"userId"`
	ChatID      string    `json:"chatId"`
	SessionPath string    `json:"sessionPath"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Store is the persistence interface for RouterState. The default
// implementation writes to ~/.vetta/im-gateway/state.json using the standard
// write-temp + fsync + rename atomic-write pattern, mirroring the convention
// already established in desktop-app's atomic-write util and SessionManager's
// lockfile module.
type Store interface {
	// Load reads the persisted state from disk. Returns an empty RouterState
	// (not an error) if the file does not exist — this is the first-run
	// case. Malformed files return an error.
	Load(ctx context.Context) (RouterState, error)

	// Save atomically writes the entire state to disk. Concurrent Save calls
	// are serialized internally so callers don't need to take their own
	// mutex.
	Save(ctx context.Context, state RouterState) error

	// GetSession looks up the current session entry for a (user, chat)
	// pair. Returns false if no entry exists.
	GetSession(ctx context.Context, userID, chatID string) (SessionEntry, bool, error)

	// SetSession upserts a session entry and persists the new state.
	SetSession(ctx context.Context, entry SessionEntry) error
}

// SessionKey is the canonical key used to index Sessions in RouterState.
// Exported so tests and migration tools can use it.
func SessionKey(userID, chatID string) string {
	return userID + "::" + chatID
}
