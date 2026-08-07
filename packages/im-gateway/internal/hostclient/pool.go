package hostclient

import (
	"container/list"
	"context"
	"errors"
	"fmt"
	"sync"
)

// ProcessPool keeps a small bounded set of HostSessions alive so consecutive
// messages on the same conversation reuse the same coding-agent subprocess
// instead of paying spawn / handshake cost every turn. Sessions are keyed
// by absolute session-file path; this is the same key the lockfile uses,
// so the pool also serves as the in-process enforcement of "one writer per
// session file".
//
// Eviction policy: bounded LRU. When Acquire would push the pool past
// MaxSize, the least-recently-used session that has no in-flight requests
// is closed and removed. If no idle session can be evicted, Acquire returns
// an error rather than block — the caller (router) decides how to react.
//
// Concurrency: Acquire / Release / Shutdown are safe to call from many
// goroutines. The pool serializes its own bookkeeping under one mutex;
// per-session Send / Events traffic is independent.
type ProcessPool struct {
	client  HostClient
	maxSize int

	// closeOnIdle, if true, immediately closes a session (and removes it
	// from the pool) when its in-flight count drops to 0 in release().
	// Set by IM host runtime: IM messages arrive sparsely and the
	// coding-agent subprocess holds the session-file lock for as long as
	// it is alive, which would otherwise block desktop-app from opening
	// the same session from its sidebar.
	closeOnIdle bool

	mu      sync.Mutex
	entries map[string]*list.Element // sessionPath → list element
	lru     *list.List               // front = MRU, back = LRU
	closed  bool
}

type pooledSession struct {
	cwd         string
	sessionPath string
	session     HostSession
	inFlight    int
}

// NewProcessPool constructs a pool. maxSize must be ≥ 1; values lower than
// 1 are clamped to 1.
func NewProcessPool(client HostClient, maxSize int) *ProcessPool {
	if maxSize < 1 {
		maxSize = 1
	}
	return &ProcessPool{
		client:  client,
		maxSize: maxSize,
		entries: make(map[string]*list.Element),
		lru:     list.New(),
	}
}

// SetCloseOnIdle toggles whether the pool closes a session as soon as
// its in-flight count drops to 0. Used by IM host runtime so the lockfile
// is released between sparse IM messages, allowing desktop-app to open
// the same session for inspection. Safe to call before any Acquire; do
// not toggle at runtime.
func (p *ProcessPool) SetCloseOnIdle(enabled bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closeOnIdle = enabled
}

// Acquired wraps a HostSession with the bookkeeping the pool needs to know
// when the caller is done. Always Release after use, even on error paths.
type Acquired struct {
	pool        *ProcessPool
	sessionPath string
	Session     HostSession
}

// Release marks the in-flight count down and bumps the entry's LRU position
// to MRU.
func (a *Acquired) Release() {
	if a == nil || a.pool == nil {
		return
	}
	a.pool.release(a.sessionPath)
	a.pool = nil
}

// Discard removes the acquired session from the pool and closes it. Use this
// when a typed failure says the process must be restarted. A deferred Release
// after Discard is a no-op.
func (a *Acquired) Discard() error {
	if a == nil || a.pool == nil {
		return nil
	}
	pool := a.pool
	a.pool = nil
	return pool.discard(a.sessionPath, a.Session)
}

// Acquire returns a HostSession for the given (cwd, sessionPath). If a
// session is already in the pool for the same sessionPath, it is reused
// and bumped to MRU. Otherwise a new HostSession is opened (which may
// trigger LRU eviction first to make room).
//
// On a successful Acquire the caller MUST eventually call Acquired.Release.
func (p *ProcessPool) Acquire(ctx context.Context, cwd, sessionPath string) (*Acquired, error) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, errors.New("hostclient: pool is shut down")
	}

	// Hit: reuse and bump.
	if elem, ok := p.entries[sessionPath]; ok {
		ps := elem.Value.(*pooledSession)
		ps.inFlight++
		p.lru.MoveToFront(elem)
		p.mu.Unlock()
		return &Acquired{pool: p, sessionPath: sessionPath, Session: ps.session}, nil
	}

	// Miss: may need to evict before opening a new session. Note we do
	// the eviction *before* the OpenSession call so the new session is
	// counted under the cap from the start.
	if len(p.entries) >= p.maxSize {
		if err := p.evictOldestIdleLocked(); err != nil {
			p.mu.Unlock()
			return nil, fmt.Errorf("hostclient: pool full and no idle session to evict: %w", err)
		}
	}
	p.mu.Unlock()

	// Open without holding the mutex — OpenSession may take seconds
	// (handshake) and we don't want other Acquire calls to block on it.
	session, err := p.client.OpenSession(ctx, cwd, sessionPath)
	if err != nil {
		return nil, err
	}

	// Index by the session file the agent ACTUALLY writes to, not by
	// the caller's requested path. When the caller passes an empty
	// string (first prompt after /use, before any agent has run in
	// this project) the agent synthesizes a fresh .jsonl and reports
	// it via the handshake's get_state response; HostSession.SessionPath()
	// surfaces that resolved path.
	//
	// If we instead keyed under the caller's input, the next acquire —
	// which the router makes with the now-known resolved path — would
	// miss the cache, evict the still-live subprocess, and respawn a
	// new one that races the previous process for the session-file
	// lockfile. This is what broke multi-turn conversations on the
	// WeChat bridge: first reply arrived, second reply went silent
	// because the reopened subprocess either hit ErrSessionLocked or
	// its outbound error reply was swallowed by the transport.
	actualPath := session.SessionPath()
	if actualPath == "" {
		actualPath = sessionPath
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	// Race: another goroutine may have opened the same resolved path
	// while we were waiting for handshake. If so, close ours and reuse
	// theirs.
	if elem, ok := p.entries[actualPath]; ok {
		_ = session.Close()
		ps := elem.Value.(*pooledSession)
		ps.inFlight++
		p.lru.MoveToFront(elem)
		return &Acquired{pool: p, sessionPath: actualPath, Session: ps.session}, nil
	}

	// Race: pool may have been Shutdown while we were opening.
	if p.closed {
		_ = session.Close()
		return nil, errors.New("hostclient: pool was shut down during open")
	}

	ps := &pooledSession{
		cwd:         cwd,
		sessionPath: actualPath,
		session:     session,
		inFlight:    1,
	}
	elem := p.lru.PushFront(ps)
	p.entries[actualPath] = elem
	return &Acquired{pool: p, sessionPath: actualPath, Session: session}, nil
}

func (p *ProcessPool) release(sessionPath string) {
	p.mu.Lock()
	elem, ok := p.entries[sessionPath]
	if !ok {
		p.mu.Unlock()
		return
	}
	ps := elem.Value.(*pooledSession)
	if ps.inFlight > 0 {
		ps.inFlight--
	}
	p.lru.MoveToFront(elem)

	// IM mode: drop the entry and close the subprocess as soon as nothing
	// is in flight. The coding-agent subprocess holds the session-file
	// lockfile for as long as it is alive; keeping it warm in the pool
	// would block desktop-app from opening the same session.
	if p.closeOnIdle && ps.inFlight == 0 {
		delete(p.entries, sessionPath)
		p.lru.Remove(elem)
		session := ps.session
		p.mu.Unlock()
		_ = session.Close()
		return
	}
	p.mu.Unlock()
}

func (p *ProcessPool) discard(sessionPath string, session HostSession) error {
	p.mu.Lock()
	elem, ok := p.entries[sessionPath]
	if !ok {
		p.mu.Unlock()
		return nil
	}
	ps := elem.Value.(*pooledSession)
	if ps.session != session {
		p.mu.Unlock()
		return nil
	}
	delete(p.entries, sessionPath)
	p.lru.Remove(elem)
	p.mu.Unlock()
	return session.Close()
}

// evictOldestIdleLocked removes the least-recently-used session that has no
// in-flight requests. Caller must hold p.mu.
func (p *ProcessPool) evictOldestIdleLocked() error {
	for elem := p.lru.Back(); elem != nil; elem = elem.Prev() {
		ps := elem.Value.(*pooledSession)
		if ps.inFlight == 0 {
			delete(p.entries, ps.sessionPath)
			p.lru.Remove(elem)
			// Close outside the lock would be ideal but we're already in
			// the locked critical section; the close is bounded by the
			// session's CloseTimeout (default 5s). Acceptable for a
			// background eviction; if it becomes a hot path we move to a
			// background closer goroutine.
			_ = ps.session.Close()
			return nil
		}
	}
	return errors.New("all sessions in flight")
}

// Stats reports the pool's current population. Useful for /whoami and
// `im-gateway status`.
type Stats struct {
	Size         int
	MaxSize      int
	InFlight     int
	SessionPaths []string
}

// Stats snapshots the pool. Cheap; takes the bookkeeping mutex briefly.
func (p *ProcessPool) Stats() Stats {
	p.mu.Lock()
	defer p.mu.Unlock()

	out := Stats{
		Size:    len(p.entries),
		MaxSize: p.maxSize,
	}
	out.SessionPaths = make([]string, 0, len(p.entries))
	for path, elem := range p.entries {
		out.SessionPaths = append(out.SessionPaths, path)
		ps := elem.Value.(*pooledSession)
		out.InFlight += ps.inFlight
	}
	return out
}

// Shutdown closes every session in the pool. After Shutdown, Acquire
// returns an error. Safe to call multiple times.
func (p *ProcessPool) Shutdown(_ context.Context) error {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil
	}
	p.closed = true
	sessions := make([]HostSession, 0, len(p.entries))
	for _, elem := range p.entries {
		ps := elem.Value.(*pooledSession)
		sessions = append(sessions, ps.session)
	}
	p.entries = nil
	p.lru = list.New()
	p.mu.Unlock()

	var firstErr error
	for _, s := range sessions {
		if err := s.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}
