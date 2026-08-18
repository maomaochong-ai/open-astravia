package wechat

import (
	"testing"
	"time"
)

func TestQuota_AllowsUpToLimit(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	clock := &fakeClock{t: now}
	q := NewQuota(3, time.Hour, clock.Now)

	for i := range 3 {
		if !q.CanSend("peer1") {
			t.Fatalf("send %d should be allowed", i)
		}
		q.RecordSend("peer1")
	}
	if q.CanSend("peer1") {
		t.Errorf("send 4 should be blocked")
	}
	if got := q.Remaining("peer1"); got != 0 {
		t.Errorf("Remaining = %d, want 0", got)
	}
}

func TestQuota_PerPeer(t *testing.T) {
	q := NewQuota(2, time.Hour, time.Now)
	q.RecordSend("a")
	q.RecordSend("a")
	if q.CanSend("a") {
		t.Error("a blocked")
	}
	if !q.CanSend("b") {
		t.Error("b should still be allowed (independent)")
	}
}

func TestQuota_OnInboundResets(t *testing.T) {
	q := NewQuota(2, time.Hour, time.Now)
	q.RecordSend("p")
	q.RecordSend("p")
	if q.CanSend("p") {
		t.Error("p should be blocked")
	}
	q.OnInbound("p")
	if !q.CanSend("p") {
		t.Error("OnInbound should reset")
	}
	if got := q.Remaining("p"); got != 2 {
		t.Errorf("Remaining = %d, want 2", got)
	}
}

func TestQuota_RollingWindow(t *testing.T) {
	clock := &fakeClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	q := NewQuota(2, time.Hour, clock.Now)

	q.RecordSend("p")
	q.RecordSend("p")
	if q.CanSend("p") {
		t.Fatal("expected blocked at limit")
	}
	// Advance past the window — old entries should age out.
	clock.advance(2 * time.Hour)
	if !q.CanSend("p") {
		t.Errorf("expected unblocked after window")
	}
	if got := q.Remaining("p"); got != 2 {
		t.Errorf("Remaining = %d, want 2", got)
	}
}

func TestQuota_PartialWindowExpiry(t *testing.T) {
	clock := &fakeClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	q := NewQuota(3, time.Hour, clock.Now)

	q.RecordSend("p") // t=0
	clock.advance(30 * time.Minute)
	q.RecordSend("p") // t=30m
	clock.advance(40 * time.Minute) // t=70m, first send is now > 1h old
	q.RecordSend("p") // t=70m

	if got := q.Remaining("p"); got != 1 {
		t.Errorf("Remaining = %d, want 1 (only the t=30m and t=70m sends still in window)", got)
	}
}

type fakeClock struct {
	t time.Time
}

func (c *fakeClock) Now() time.Time           { return c.t }
func (c *fakeClock) advance(d time.Duration)  { c.t = c.t.Add(d) }
