package bridge

import (
	"context"
	"time"

	"vetta-im-gateway/internal/transport"
)

// Status reactions the bridge attaches to the triggering inbound message on
// platforms with reaction support (Capabilities.SupportsReactions + the
// transport implementing transport.Reactor). One at a time: working while the
// turn runs, then swapped for done/failed. Unicode emoji per the Reactor
// contract; transports translate to platform-native naming.
const (
	StatusReactionWorking = "👀"
	StatusReactionDone    = "✅"
	StatusReactionFailed  = "❌"
)

// finalReactionTimeout bounds the terminal status-reaction call, which runs
// after the turn's ctx may already be cancelled (WithoutCancel).
const finalReactionTimeout = 5 * time.Second

// SetInboundRef records the platform message ID of the inbound message that
// triggered this turn. Optional — when unset the bridge sends plain messages
// with no reply anchor and no status reactions.
func (b *Bridge) SetInboundRef(messageID string) { b.inboundRef = messageID }

// setStatusReaction swaps the status reaction on the triggering inbound
// message. Best-effort: reaction failures never affect the turn.
func (b *Bridge) setStatusReaction(ctx context.Context, emoji string) {
	if b.reactor == nil || b.inboundRef == "" || b.statusReaction == emoji {
		return
	}
	if b.statusReaction != "" {
		_ = b.reactor.RemoveReaction(ctx, b.chatID, b.inboundRef, b.statusReaction)
	}
	b.statusReaction = ""
	if emoji != "" {
		if err := b.reactor.AddReaction(ctx, b.chatID, b.inboundRef, emoji); err == nil {
			b.statusReaction = emoji
		}
	}
}

// finishStatusReaction applies the terminal done/failed reaction. Runs on a
// detached context because the turn's ctx is often already cancelled by the
// time the result is known.
func (b *Bridge) finishStatusReaction(ctx context.Context, turnErr error) {
	if b.reactor == nil || b.inboundRef == "" {
		return
	}
	final := StatusReactionDone
	if turnErr != nil {
		final = StatusReactionFailed
	}
	detached, cancel := context.WithTimeout(context.WithoutCancel(ctx), finalReactionTimeout)
	defer cancel()
	b.setStatusReaction(detached, final)
}

// outbound stamps the turn's reply anchor onto the first outbound message on
// thread-capable platforms, leaving later messages un-anchored.
func (b *Bridge) outbound(msg transport.OutboundMessage) transport.OutboundMessage {
	if b.caps.SupportsThreads && b.inboundRef != "" && !b.replyAnchored {
		msg.ReplyToID = b.inboundRef
		b.replyAnchored = true
	}
	return msg
}
