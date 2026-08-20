package bridge

import (
	"context"
	"testing"

	"vetta-im-gateway/internal/hostclient"
	"vetta-im-gateway/internal/transport"
)

// reactingTransport extends fakeTransport with the optional Reactor
// interface so tests can exercise the bridge's status-reaction path.
type reactingTransport struct {
	*fakeTransport
}

func newReactingTransport(caps transport.Capabilities) *reactingTransport {
	return &reactingTransport{fakeTransport: newFakeTransport(caps)}
}

func (r *reactingTransport) AddReaction(_ context.Context, chatID, messageID, emoji string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, transportCall{Action: "react+", ChatID: chatID, MessageID: messageID, Text: emoji})
	return nil
}

func (r *reactingTransport) RemoveReaction(_ context.Context, chatID, messageID, emoji string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, transportCall{Action: "react-", ChatID: chatID, MessageID: messageID, Text: emoji})
	return nil
}

func reactionsOnly(calls []transportCall) []transportCall {
	out := make([]transportCall, 0, len(calls))
	for _, c := range calls {
		if c.Action == "react+" || c.Action == "react-" {
			out = append(out, c)
		}
	}
	return out
}

func runTurn(t *testing.T, b *Bridge, evs ...hostclient.AgentEvent) error {
	t.Helper()
	events := make(chan hostclient.AgentEvent, len(evs))
	for _, ev := range evs {
		events <- ev
	}
	return b.Run(context.Background(), events)
}

func TestStatusReactions_SuccessLifecycle(t *testing.T) {
	tr := newReactingTransport(transport.Capabilities{SupportsReactions: true, MaxMessageLength: 1000})
	b := New(tr, "c1")
	b.SetInboundRef("in-1")

	if err := runTurn(t, b, textDelta("hi"), plainEvent(hostclient.AgentEventTypeAgentEnd)); err != nil {
		t.Fatalf("run: %v", err)
	}

	got := reactionsOnly(tr.snapshot())
	want := []transportCall{
		{Action: "react+", ChatID: "c1", MessageID: "in-1", Text: StatusReactionWorking},
		{Action: "react-", ChatID: "c1", MessageID: "in-1", Text: StatusReactionWorking},
		{Action: "react+", ChatID: "c1", MessageID: "in-1", Text: StatusReactionDone},
	}
	if len(got) != len(want) {
		t.Fatalf("reactions = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("reaction[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestStatusReactions_FailureLifecycle(t *testing.T) {
	tr := newReactingTransport(transport.Capabilities{SupportsReactions: true, MaxMessageLength: 1000})
	b := New(tr, "c1")
	b.SetInboundRef("in-1")

	// Close the events channel without agent_end: subprocess-died path.
	events := make(chan hostclient.AgentEvent)
	close(events)
	if err := b.Run(context.Background(), events); err == nil {
		t.Fatal("expected error from closed event stream")
	}

	got := reactionsOnly(tr.snapshot())
	if len(got) == 0 || got[len(got)-1].Text != StatusReactionFailed {
		t.Fatalf("last reaction = %+v, want failed %q", got, StatusReactionFailed)
	}
}

func TestStatusReactions_SkippedWithoutCapability(t *testing.T) {
	// Transport implements Reactor but does not declare the capability:
	// the bridge must not call it.
	tr := newReactingTransport(transport.Capabilities{MaxMessageLength: 1000})
	b := New(tr, "c1")
	b.SetInboundRef("in-1")

	if err := runTurn(t, b, textDelta("hi"), plainEvent(hostclient.AgentEventTypeAgentEnd)); err != nil {
		t.Fatalf("run: %v", err)
	}
	if got := reactionsOnly(tr.snapshot()); len(got) != 0 {
		t.Fatalf("expected no reactions, got %+v", got)
	}
}

func TestStatusReactions_SkippedWithoutInboundRef(t *testing.T) {
	tr := newReactingTransport(transport.Capabilities{SupportsReactions: true, MaxMessageLength: 1000})
	b := New(tr, "c1")

	if err := runTurn(t, b, textDelta("hi"), plainEvent(hostclient.AgentEventTypeAgentEnd)); err != nil {
		t.Fatalf("run: %v", err)
	}
	if got := reactionsOnly(tr.snapshot()); len(got) != 0 {
		t.Fatalf("expected no reactions, got %+v", got)
	}
}

func TestReplyAnchor_FirstMessageOnly(t *testing.T) {
	tr := newFakeTransport(transport.Capabilities{SupportsThreads: true, MaxMessageLength: 1000})
	b := New(tr, "c1")
	b.SetInboundRef("in-9")

	err := runTurn(t, b,
		textDelta("first"),
		plainEvent(hostclient.AgentEventTypeMessageEnd),
		textDelta("second"),
		plainEvent(hostclient.AgentEventTypeAgentEnd),
	)
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	sends := sendsOnly(tr.snapshot())
	if len(sends) != 2 {
		t.Fatalf("expected 2 sends, got %+v", sends)
	}
	if sends[0].ReplyToID != "in-9" {
		t.Fatalf("first send ReplyToID = %q, want in-9", sends[0].ReplyToID)
	}
	if sends[1].ReplyToID != "" {
		t.Fatalf("second send ReplyToID = %q, want empty", sends[1].ReplyToID)
	}
}

func TestReplyAnchor_SkippedWithoutThreadSupport(t *testing.T) {
	tr := newFakeTransport(transport.Capabilities{MaxMessageLength: 1000})
	b := New(tr, "c1")
	b.SetInboundRef("in-9")

	if err := runTurn(t, b, textDelta("hi"), plainEvent(hostclient.AgentEventTypeAgentEnd)); err != nil {
		t.Fatalf("run: %v", err)
	}
	sends := sendsOnly(tr.snapshot())
	if len(sends) != 1 || sends[0].ReplyToID != "" {
		t.Fatalf("expected 1 unanchored send, got %+v", sends)
	}
}
