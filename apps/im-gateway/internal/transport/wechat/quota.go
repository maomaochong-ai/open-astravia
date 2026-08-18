package wechat

import (
	"sync"
	"time"
)

// Quota tracks the per-peer rolling-window send quota the iLink protocol
// enforces server-side.
//
// The protocol does not expose remaining quota in any response, so we
// shadow the limit on the client side and bail out before issuing a send
// that would surely fail. The two relevant rules (observed from upstream
// reverse engineering and the brief Tencent Cloud article on the
// protocol):
//
//  1. A bot may send at most QuotaPerWindow messages within QuotaWindow to
//     a single peer.
//  2. Any inbound message from that peer resets the window to "fresh".
//
// The quota is per-peer because the inbound reset is per-peer; a busy
// conversation with one user does not unblock pushes to a quiet user.
type Quota struct {
	per   int
	win   time.Duration
	now   func() time.Time

	mu    sync.Mutex
	state map[string]*peerWindow
}

// peerWindow holds the rolling window for one peer.
type peerWindow struct {
	// timestamps holds the time of each successful send within the
	// current window. Capped at per; older entries are pruned lazily.
	timestamps []time.Time
}

// NewQuota constructs a Quota with the given limits. A typical caller
// passes (10, 24*time.Hour, time.Now).
func NewQuota(per int, window time.Duration, now func() time.Time) *Quota {
	if per <= 0 {
		per = 10
	}
	if window <= 0 {
		window = 24 * time.Hour
	}
	if now == nil {
		now = time.Now
	}
	return &Quota{
		per:   per,
		win:   window,
		now:   now,
		state: make(map[string]*peerWindow),
	}
}

// CanSend reports whether a send to peerID would currently fit inside the
// rolling window. It does NOT record the send — call RecordSend after the
// HTTP call actually succeeds.
func (q *Quota) CanSend(peerID string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	pw := q.state[peerID]
	if pw == nil {
		return true
	}
	q.pruneLocked(pw)
	return len(pw.timestamps) < q.per
}

// RecordSend appends a successful-send timestamp for peerID. Should be
// called only after the upstream sendmessage call returned 2xx.
func (q *Quota) RecordSend(peerID string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	pw := q.state[peerID]
	if pw == nil {
		pw = &peerWindow{}
		q.state[peerID] = pw
	}
	q.pruneLocked(pw)
	pw.timestamps = append(pw.timestamps, q.now())
}

// OnInbound resets the per-peer window. Called when an inbound message
// from peerID arrives — under the protocol's "any user message reopens the
// quota" rule, we drop all prior history for that peer.
func (q *Quota) OnInbound(peerID string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	delete(q.state, peerID)
}

// Remaining returns how many sends are still available for peerID before
// the rolling window blocks. Useful for warning the user when they are
// about to be cut off.
func (q *Quota) Remaining(peerID string) int {
	q.mu.Lock()
	defer q.mu.Unlock()
	pw := q.state[peerID]
	if pw == nil {
		return q.per
	}
	q.pruneLocked(pw)
	rem := q.per - len(pw.timestamps)
	if rem < 0 {
		return 0
	}
	return rem
}

// pruneLocked drops timestamps that have fallen out of the rolling window.
// Caller must hold q.mu.
func (q *Quota) pruneLocked(pw *peerWindow) {
	cutoff := q.now().Add(-q.win)
	keep := pw.timestamps[:0]
	for _, ts := range pw.timestamps {
		if ts.After(cutoff) {
			keep = append(keep, ts)
		}
	}
	pw.timestamps = keep
}
