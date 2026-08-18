package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"vetta-im-gateway/internal/hostclient"
	"vetta-im-gateway/internal/transport"
)

// EditThrottle is the minimum gap between successive edit calls when the
// transport supports message editing. Default mirrors the typical IM rate
// limit window.
const EditThrottle = 800 * time.Millisecond

// TypingHeartbeatInterval is how often the bridge re-asserts the platform's
// native "typing" indicator (e.g. WeChat's "对方正在输入") while a turn is in
// flight in DeferUntilTurnEnd mode. The indicator's server-side lifetime is
// short, so it must be re-sent below that ceiling to stay visible. This
// replaces the old "still processing" ack message — progress is shown via the
// native typing status instead of a pushed placeholder.
const TypingHeartbeatInterval = 5 * time.Second

// DeferredEmptyText is shown in the digest when a turn ends with no
// final assistant text and no error to report.
const DeferredEmptyText = "⚠️ 未返回文本内容"

// HostResponder is the optional callback the bridge uses to answer
// `host_request` events emitted by built-in coding-agent tools (see
// ADR-0006). Receiving a host_request and not having a responder set is
// not an error — the bridge logs and drops the request.
//
// The send function is expected to be a thin adapter over
// hostclient.HostSession.Send; the bridge does not care about the
// response (the agent side waits on stdin for the host_response command).
type HostResponder func(ctx context.Context, cmd hostclient.Command) error

// PathChangeHandler is the optional callback the bridge invokes when the agent
// emits a `session_path_changed` event (memory-mode rollover, ADR-0009). The
// router uses it to repoint the (user, chat) → sessionPath mapping at the new
// .jsonl so the next inbound message resumes the rolled-over session rather
// than the archived one.
type PathChangeHandler func(newPath string)

// Bridge translates a stream of agent events into outbound IM messages.
//
// One Bridge instance per (transport, chatID) pair; constructed at the
// router level when an inbound message arrives, run for the duration of
// the agent's response, then discarded.
//
// Two output strategies, picked at construction time from the transport's
// Capabilities:
//
//  1. Edit-in-place: send one initial message, then edit it as text deltas
//     arrive. Throttled to ≥ EditThrottle between edit calls. The transport
//     must declare SupportsMessageEdit=true.
//
//  2. Chunk fallback: buffer text until a flush boundary or the transport's
//     MaxMessageLength, then SendMessage a new chunk. This is what mock /
//     telegram / most simple platforms get.
//
// thinking_delta is emitted as a separate message. Tool execution events
// flush pending output and emit a one-line tool summary.
type Bridge struct {
	tr         transport.Transport
	chatID     string
	caps       transport.Capabilities
	responder  HostResponder
	pathChange PathChangeHandler

	// streaming state
	buf           strings.Builder
	thinkingBuf   strings.Builder
	editMessageID string    // empty if not yet sent
	lastEdit      time.Time // throttle anchor for edit mode

	// pendingErrors accumulates error events seen during this turn. We
	// deliberately do NOT push each error to the user as a separate IM
	// card: coding-agent's startup pipeline (skill / extension / theme
	// loading, model probe retries) emits non-fatal `type:"error"`
	// events that it then recovers from, and forwarding each one
	// floods the chat with "(agent error)" bubbles before the real
	// reply. We surface them only if the whole turn produces no text
	// (see flushAll). Reset to nil on any successful text send.
	pendingErrors []string

	// anyOutputSent tracks whether this turn produced any user-visible
	// IM message (text / chunk / tool summary). Drives the
	// "suppress transient errors" rule above.
	anyOutputSent bool

	// Deferred-digest mode (caps.DeferUntilTurnEnd=true) state. All
	// intermediate emissions are suppressed; we accumulate stats here
	// and emit one digest message on agent_end. See runDeferred /
	// handleDeferred / sendDeferredDigest.
	deferred *deferredState
}

// deferredState tracks what one turn produced when the transport defers
// emission to agent_end. The bridge keeps last-assistant-message text
// (overwriting on each message_end so an intermediate "I'll look that
// up" gets discarded in favour of the final answer), the tool-call
// count, and any error text. Progress is shown via the native typing
// indicator (see typingHeartbeat), not a pushed ack message.
type deferredState struct {
	promptAt          time.Time
	toolCount         int
	lastAssistantText string
	lastErrorText     string

	mu        sync.Mutex
	finalSent bool
}

// New constructs a Bridge for one outbound conversation.
func New(tr transport.Transport, chatID string) *Bridge {
	b := &Bridge{
		tr:     tr,
		chatID: chatID,
		caps:   tr.Capabilities(),
	}
	if b.caps.DeferUntilTurnEnd {
		// The "prompt received" anchor: bridge.New runs immediately
		// after router.go's pool.Acquire+Send, so this is within a
		// few ms of the real prompt delivery — close enough for
		// elapsed-time display rounded to whole seconds.
		b.deferred = &deferredState{promptAt: time.Now()}
	}
	return b
}

// SetHostResponder installs the callback used to answer `host_request`
// events. Optional — when unset, host_request events are logged and dropped.
func (b *Bridge) SetHostResponder(r HostResponder) { b.responder = r }

// SetPathChangeHandler installs the callback invoked on `session_path_changed`
// events (memory-mode rollover). Optional — when unset, the event is ignored.
func (b *Bridge) SetPathChangeHandler(h PathChangeHandler) { b.pathChange = h }

// handleSessionPathChanged parses a session_path_changed event and forwards the
// new path to the handler. Best-effort: a malformed event or empty `to` is
// dropped silently (the next message would re-handshake the live path anyway).
func (b *Bridge) handleSessionPathChanged(raw json.RawMessage) {
	if b.pathChange == nil {
		return
	}
	var ev struct {
		To string `json:"to"`
	}
	if err := json.Unmarshal(raw, &ev); err != nil {
		return
	}
	if ev.To != "" {
		b.pathChange(ev.To)
	}
}

// Run consumes events until the agent's turn ends and emits IM messages
// along the way. A turn ends on the first of:
//
//   - an agent_end event (the agent finished one prompt's worth of work;
//     the subprocess stays alive for the next prompt — this is the normal
//     happy path and is what allows multi-turn conversations to work)
//   - the events channel closing (subprocess died)
//   - ctx cancellation
//
// Returns the first error encountered along the way (subsequent errors
// are swallowed; the bridge tries to deliver as much as possible before
// reporting). Run is intended to be called from one goroutine; the caller
// owns goroutine lifetime.
func (b *Bridge) Run(ctx context.Context, events <-chan hostclient.AgentEvent) error {
	if b.caps.DeferUntilTurnEnd {
		return b.runDeferred(ctx, events)
	}
	var firstErr error
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case ev, ok := <-events:
			if !ok {
				// Channel closed: subprocess exited unexpectedly. Flush
				// whatever we still have buffered so the user sees a final
				// state instead of a silent dropoff.
				if err := b.flushAll(ctx); err != nil && firstErr == nil {
					firstErr = err
				}
				return eventStreamClosedFailure(firstErr)
			}
			if err := b.handle(ctx, ev); err != nil && firstErr == nil {
				firstErr = err
			}
			// agent_end marks the end of one turn. The subprocess is still
			// alive and we MUST return so the per-conversation goroutine can
			// process the next inbound message; otherwise users can only
			// ever exchange one message per session.
			if ev.Type == hostclient.AgentEventTypeAgentEnd {
				return firstErr
			}
		}
	}
}

// runDeferred is the wechat-style path: suppress every intermediate emission
// and send a single digest message at agent_end. While the turn runs, the
// native typing indicator is kept alive via typingHeartbeat so the user sees
// "对方正在输入" instead of a pushed "still processing" placeholder.
func (b *Bridge) runDeferred(ctx context.Context, events <-chan hostclient.AgentEvent) error {
	typingCtx, stopTyping := context.WithCancel(ctx)
	defer stopTyping()
	go b.typingHeartbeat(typingCtx)

	var firstErr error
	// finish stops the typing indicator and emits the single digest. Called on
	// every exit path; stopping typing before the digest avoids the indicator
	// lingering for a heartbeat interval after the reply already landed.
	finish := func(allowEmpty bool) {
		stopTyping()
		if err := b.sendDeferredDigest(ctx, allowEmpty); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	for {
		select {
		case <-ctx.Done():
			finish(true)
			if firstErr == nil {
				return ctx.Err()
			}
			return firstErr
		case ev, ok := <-events:
			if !ok {
				finish(false)
				return eventStreamClosedFailure(firstErr)
			}
			if err := b.handleDeferred(ctx, ev); err != nil && firstErr == nil {
				firstErr = err
			}
			if ev.Type == hostclient.AgentEventTypeAgentEnd {
				finish(true)
				return firstErr
			}
		}
	}
}

// typingHeartbeat keeps the transport's native typing indicator visible for
// the life of ctx by re-asserting it every TypingHeartbeatInterval. The first
// pulse fires immediately so the indicator appears as soon as the prompt
// lands. ShowTyping errors are ignored (best-effort progress hint); transports
// without a typing indicator implement it as a no-op.
func (b *Bridge) typingHeartbeat(ctx context.Context) {
	_ = b.tr.ShowTyping(ctx, b.chatID)
	ticker := time.NewTicker(TypingHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = b.tr.ShowTyping(ctx, b.chatID)
		}
	}
}

func (b *Bridge) handleDeferred(ctx context.Context, ev hostclient.AgentEvent) error {
	d := b.deferred
	switch ev.Type {
	case "host_request":
		// host_request events are handled identically in deferred and
		// streaming modes — attachment sends happen *now*, not at
		// turn-end, so the agent gets a real result to continue from.
		b.handleHostRequest(ctx, ev.Raw)
		return nil
	case hostclient.AgentEventTypeSessionPathChanged:
		b.handleSessionPathChanged(ev.Raw)
		return nil
	case hostclient.AgentEventTypeToolExecutionStart:
		d.toolCount++
	case hostclient.AgentEventTypeMessageEnd:
		// Capture the text content of every assistant message_end so the
		// last one wins. An intermediate "I'll look that up" gets
		// overwritten by the real answer; if the agent never produced a
		// final answer the last partial stays as a best-effort fallback.
		if text := extractAssistantText(ev.Raw); text != "" {
			d.lastAssistantText = text
		}
		if errText := extractMessageEndError(ev.Raw); errText != "" {
			d.lastErrorText = errText
		}
	case hostclient.AgentEventTypeError:
		if t := extractErrorText(ev.Raw); t != "" {
			d.lastErrorText = t
		}
	}
	return nil
}

// sendDeferredDigest assembles the single digest message for this turn
// and sends it. Idempotent: subsequent calls are no-ops, so the
// channel-closed / ctx-cancelled / agent_end paths can all call it
// without coordinating.
func (b *Bridge) sendDeferredDigest(ctx context.Context, allowEmpty bool) error {
	d := b.deferred
	if !allowEmpty && d.lastAssistantText == "" && d.lastErrorText == "" {
		return nil
	}
	d.mu.Lock()
	if d.finalSent {
		d.mu.Unlock()
		return nil
	}
	d.finalSent = true
	d.mu.Unlock()

	elapsedSec := int(math.Ceil(time.Since(d.promptAt).Seconds()))
	if elapsedSec < 0 {
		elapsedSec = 0
	}

	text := d.lastAssistantText
	errText := d.lastErrorText

	var body string
	switch {
	case errText != "" && text == "":
		body = "⚠️ " + errText
	case errText != "" && text != "":
		// Both present: prefer surfacing the recovered text but keep
		// the error note as a footnote so the user knows something
		// went sideways mid-turn.
		body = text + "\n\n⚠️ " + errText
	case text != "":
		body = text
	default:
		body = DeferredEmptyText
	}

	out := body
	if d.toolCount > 0 {
		out = fmt.Sprintf("调用了 %d 次工具，耗时 %d 秒。\n\n%s", d.toolCount, elapsedSec, body)
	}
	_, err := b.tr.SendMessage(ctx, b.chatID, transport.OutboundMessage{Text: out})
	return err
}

func eventStreamClosedFailure(cause error) *hostclient.HostFailure {
	return &hostclient.HostFailure{
		Code:           hostclient.FailureCodeProcessExited,
		Phase:          hostclient.FailurePhaseTurn,
		Recoverability: hostclient.FailureRestartSession,
		Message:        "bridge: agent event stream closed before agent_end",
		Cause:          cause,
	}
}

func (b *Bridge) handle(ctx context.Context, ev hostclient.AgentEvent) error {
	switch ev.Type {
	case "host_request":
		b.handleHostRequest(ctx, ev.Raw)
		return nil
	case hostclient.AgentEventTypeSessionPathChanged:
		b.handleSessionPathChanged(ev.Raw)
		return nil
	case hostclient.AgentEventTypeMessageUpdate:
		eventType, delta := extractAssistantMessageDelta(ev.Raw)
		switch eventType {
		case "text_delta":
			if delta == "" {
				return nil
			}
			return b.appendText(ctx, delta)
		case "thinking_delta":
			if delta == "" {
				return nil
			}
			return b.appendThinking(ctx, delta)
		default:
			return nil
		}

	case hostclient.AgentEventTypeMessageEnd:
		// End of one assistant message. Two responsibilities here:
		// 1) If the agent emitted a message-level error (stopReason ==
		//    "error" with an errorMessage) — e.g. the LLM call returned
		//    a fetch failure / 4xx / rate limit — record it so the
		//    user sees something other than silence. The bridge only
		//    surfaces it if the turn ends with no other text output
		//    (same suppression policy as type:"error" events).
		// 2) flush so the next message starts fresh in chunk mode and
		//    edit mode commits final state.
		if errText := extractMessageEndError(ev.Raw); errText != "" {
			b.pendingErrors = append(b.pendingErrors, errText)
		}
		return b.flushAll(ctx)

	case hostclient.AgentEventTypeToolExecutionStart:
		if err := b.flushAll(ctx); err != nil {
			return err
		}
		return b.sendToolCallSummary(ctx, ev.Raw)

	case hostclient.AgentEventTypeToolExecutionEnd:
		// Same: flush so any text the agent emits while still mid-turn
		// is visible.
		return b.flushAll(ctx)

	case hostclient.AgentEventTypeAgentEnd:
		return b.flushAll(ctx)

	case hostclient.AgentEventTypeError:
		// Buffer the error rather than sending immediately. Most error
		// events the upstream agent emits during startup are recovered
		// from before the turn ends; forwarding each one floods the
		// chat with redundant "(agent error)" cards.
		text := extractErrorText(ev.Raw)
		if text == "" {
			// Fallback: include a truncated raw snippet so the next
			// person debugging this can see what actually happened.
			snippet := string(ev.Raw)
			if len(snippet) > 240 {
				snippet = snippet[:240] + "…"
			}
			text = "(agent error) " + snippet
		}
		b.pendingErrors = append(b.pendingErrors, text)
		return nil
	}
	return nil
}

// markOutputSent records that this turn produced a visible IM message.
// Drops any buffered transient errors — the agent clearly recovered.
func (b *Bridge) markOutputSent() {
	b.anyOutputSent = true
	b.pendingErrors = nil
}

// appendText incorporates a text delta into the bridge's buffer and
// (depending on capabilities) either edits the live message or sends a
// new chunk if the buffer crossed a threshold.
func (b *Bridge) appendText(ctx context.Context, delta string) error {
	if b.thinkingBuf.Len() > 0 {
		if err := b.flushThinking(ctx); err != nil {
			return err
		}
	}
	b.buf.WriteString(delta)

	if b.caps.SupportsMessageEdit {
		return b.maybeEdit(ctx, false)
	}
	return b.maybeChunk(ctx)
}

func (b *Bridge) appendThinking(ctx context.Context, delta string) error {
	if b.buf.Len() > 0 {
		if err := b.flushText(ctx); err != nil {
			return err
		}
	}
	b.thinkingBuf.WriteString(delta)
	return nil
}

// maybeEdit sends or edits the in-flight message. force=true bypasses
// the throttle (used by flush).
func (b *Bridge) maybeEdit(ctx context.Context, force bool) error {
	now := time.Now()
	if !force && !b.lastEdit.IsZero() && now.Sub(b.lastEdit) < EditThrottle {
		return nil
	}
	text := b.buf.String()
	if text == "" {
		return nil
	}
	if b.caps.MaxMessageLength > 0 && len(text) > b.caps.MaxMessageLength {
		// Even in edit mode, respect a hard cap. Send the head, then
		// switch to a fresh message for the tail. This is a rare path
		// but feishu does have a (large) cap.
		head := text[:b.caps.MaxMessageLength]
		tail := text[b.caps.MaxMessageLength:]
		if err := b.commitEdit(ctx, head); err != nil {
			return err
		}
		b.editMessageID = ""
		b.buf.Reset()
		b.buf.WriteString(tail)
		return b.maybeEdit(ctx, true)
	}
	return b.commitEdit(ctx, text)
}

func (b *Bridge) commitEdit(ctx context.Context, text string) error {
	if b.editMessageID == "" {
		// First frame of a streaming response — hint the transport so it
		// can pick its dedicated streaming path (e.g. cardkit on Feishu).
		id, err := b.tr.SendMessage(ctx, b.chatID, transport.OutboundMessage{Text: text, Streaming: true})
		if err != nil {
			return err
		}
		b.editMessageID = id
	} else {
		if err := b.tr.EditMessage(ctx, b.chatID, b.editMessageID, transport.OutboundMessage{Text: text, Streaming: true}); err != nil {
			return err
		}
	}
	b.markOutputSent()
	b.lastEdit = time.Now()
	return nil
}

// maybeChunk emits messages ONLY when the buffer would exceed the
// platform's hard length limit. Otherwise it accumulates silently and
// waits for flush() to emit the buffered text as a single coherent
// message at a natural boundary (tool execution, message_end, agent_end).
//
// We deliberately do NOT auto-split on paragraph boundaries: doing so
// would chop a single coherent assistant answer into a flood of small
// IM messages whenever the agent uses markdown. Sending one message per
// assistant turn is much friendlier in IM contexts.
func (b *Bridge) maybeChunk(ctx context.Context) error {
	limit := b.caps.MaxMessageLength
	if limit <= 0 {
		// No hard cap — just keep buffering until flush.
		return nil
	}
	for b.buf.Len() >= limit {
		text := b.buf.String()
		// Try to split at the last newline within the limit so we don't
		// chop mid-line; fall back to a hard cut if the limit is reached
		// without any newline.
		split := limit
		candidate := text[:limit]
		if nl := strings.LastIndex(candidate, "\n"); nl > 0 {
			split = nl + 1
		}
		head := strings.TrimRight(text[:split], "\n")
		if head != "" {
			if _, err := b.tr.SendMessage(ctx, b.chatID, transport.OutboundMessage{Text: head}); err != nil {
				return err
			}
			b.markOutputSent()
		}
		tail := text[split:]
		b.buf.Reset()
		b.buf.WriteString(tail)
	}
	return nil
}

// flush emits whatever is in the buffer immediately, regardless of
// throttle / chunk thresholds. Called on tool execution boundaries,
// message_end, and on the events channel closing.
func (b *Bridge) flushAll(ctx context.Context) error {
	if err := b.flushThinking(ctx); err != nil {
		return err
	}
	return b.flushText(ctx)
}

func (b *Bridge) flushThinking(ctx context.Context) error {
	text := strings.TrimSpace(b.thinkingBuf.String())
	if text == "" {
		b.thinkingBuf.Reset()
		return nil
	}
	b.thinkingBuf.Reset()
	_, err := b.tr.SendMessage(ctx, b.chatID, transport.OutboundMessage{
		Text: "思考：\n" + text,
	})
	return err
}

func (b *Bridge) flushText(ctx context.Context) error {
	if b.caps.SupportsMessageEdit {
		if err := b.maybeEdit(ctx, true); err != nil {
			return err
		}
		// Tell the transport this streaming response is done so it can
		// clean up server-side state (e.g. flip cardkit's streaming_mode
		// off so the typewriter cursor stops blinking). EndStream is a
		// no-op when there's no streaming message in flight.
		if b.editMessageID != "" {
			if err := b.tr.EndStream(ctx, b.chatID, b.editMessageID); err != nil {
				return err
			}
		}
		// Reset edit state so the next message starts a new bubble.
		b.editMessageID = ""
		b.buf.Reset()
		b.lastEdit = time.Time{}
		return b.flushPendingErrors(ctx)
	}
	text := b.buf.String()
	if text == "" {
		return b.flushPendingErrors(ctx)
	}
	b.buf.Reset()
	if _, err := b.tr.SendMessage(ctx, b.chatID, transport.OutboundMessage{Text: text}); err != nil {
		return err
	}
	b.markOutputSent()
	return nil
}

// flushPendingErrors emits a single consolidated error message when the
// turn ended with no user-visible output and at least one error event
// was buffered. No-op when output was produced (errors get dropped by
// markOutputSent) or when no errors were seen.
func (b *Bridge) flushPendingErrors(ctx context.Context) error {
	if b.anyOutputSent || len(b.pendingErrors) == 0 {
		b.pendingErrors = nil
		return nil
	}
	combined := strings.Join(b.pendingErrors, "\n")
	b.pendingErrors = nil
	_, err := b.tr.SendMessage(ctx, b.chatID, transport.OutboundMessage{Text: combined})
	return err
}

func (b *Bridge) sendToolCallSummary(ctx context.Context, raw json.RawMessage) error {
	toolName := extractToolName(raw)
	if toolName == "" {
		toolName = "unknown"
	}
	if _, err := b.tr.SendMessage(ctx, b.chatID, transport.OutboundMessage{
		Text: "调用工具：`" + toolName + "`",
	}); err != nil {
		return err
	}
	b.markOutputSent()
	return nil
}

// extractAssistantMessageDelta extracts the message_update subtype and delta.
//
// The upstream agent emits several flavors of message_update during a turn:
//
//   - text_delta:     incremental user-visible text
//   - thinking_delta: incremental reasoning text
//   - toolcall_delta: incremental JSON args of an in-flight tool call
//   - *_start / *_end: lifecycle bookends, no delta payload
//
// The bridge decides how to render each subtype; toolcall_delta remains
// hidden so users do not see partial JSON arguments.
func extractAssistantMessageDelta(raw json.RawMessage) (eventType string, delta string) {
	var v struct {
		AssistantMessageEvent struct {
			Type  string `json:"type"`
			Delta string `json:"delta"`
		} `json:"assistantMessageEvent"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return "", ""
	}
	return v.AssistantMessageEvent.Type, v.AssistantMessageEvent.Delta
}

func extractToolName(raw json.RawMessage) string {
	var v struct {
		ToolName string `json:"toolName"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return ""
	}
	return strings.TrimSpace(v.ToolName)
}

// extractMessageEndError pulls a user-facing error string from a
// `message_end` event whose payload is a fully-formed AssistantMessage
// with stopReason == "error". Returns "" when the message ended normally.
//
// Shape we read (subset of @vetta/coding-agent's AssistantMessage):
//
//	{ "message": { "stopReason": "error", "errorMessage": "Connection error." } }
//
// We deliberately ignore other stop reasons (aborted / end_turn / etc.)
// — those are normal terminations, no IM-side notice needed.
func extractMessageEndError(raw json.RawMessage) string {
	var v struct {
		Message struct {
			StopReason   string `json:"stopReason"`
			ErrorMessage string `json:"errorMessage"`
		} `json:"message"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return ""
	}
	if v.Message.StopReason != "error" {
		return ""
	}
	if v.Message.ErrorMessage != "" {
		return v.Message.ErrorMessage
	}
	// stopReason=error but no explicit message — surface a generic note
	// rather than going silent so the user at least knows something
	// broke. Should be rare; coding-agent normally fills errorMessage.
	return "⚠ 模型调用失败（无具体错误信息）"
}

// extractAssistantText pulls the concatenated plain text from a
// message_end event's final assistant message. Returns "" for user
// messages or messages with no text blocks (e.g. tool-call-only).
//
// Shape we read (subset of coding-agent's AssistantMessage):
//
//	{ "message": { "role": "assistant", "content": [
//	    { "type": "text", "text": "..." }, ...
//	] } }
func extractAssistantText(raw json.RawMessage) string {
	var v struct {
		Message struct {
			Role    string `json:"role"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"message"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return ""
	}
	if v.Message.Role != "assistant" {
		return ""
	}
	var sb strings.Builder
	for _, c := range v.Message.Content {
		if c.Type == "text" && c.Text != "" {
			sb.WriteString(c.Text)
		}
	}
	return sb.String()
}

// hostRequest is the on-wire shape of an agent-emitted reverse RPC. The
// only `method` currently understood is `send_attachment` — see ADR-0006
// and packages/coding-agent/docs/rpc.md.
type hostRequest struct {
	Type   string `json:"type"`
	ID     string `json:"id"`
	Method string `json:"method"`
	Params struct {
		Path    string `json:"path"`
		Kind    string `json:"kind"`
		Caption string `json:"caption"`
	} `json:"params"`
}

// handleHostRequest dispatches one `host_request` event. The reply (via
// the installed HostResponder) carries a matching `host_response` command
// the agent will read off its stdin and resolve the in-flight tool call.
//
// Failures (missing responder, missing method, transport error) are all
// reported back to the agent as host_response{success:false}; we never
// drop the request silently because that would leave the tool hanging
// until its 30s timeout.
func (b *Bridge) handleHostRequest(ctx context.Context, raw json.RawMessage) {
	var req hostRequest
	if err := json.Unmarshal(raw, &req); err != nil || req.ID == "" {
		// No id → no way to correlate. Best effort: drop.
		return
	}
	if b.responder == nil {
		b.replyHostError(ctx, req.ID, "no_responder", "host bridge not configured for this session")
		return
	}
	switch req.Method {
	case "send_attachment":
		b.dispatchSendAttachment(ctx, req)
	default:
		b.replyHostError(ctx, req.ID, "unknown_method", fmt.Sprintf("unknown host_request method %q", req.Method))
	}
}

func (b *Bridge) dispatchSendAttachment(ctx context.Context, req hostRequest) {
	kind := transport.AttachmentKind(strings.ToLower(req.Params.Kind))
	if kind != transport.AttachmentImage && kind != transport.AttachmentFile {
		b.replyHostError(ctx, req.ID, "bad_kind", fmt.Sprintf("kind must be image|file, got %q", req.Params.Kind))
		return
	}
	if req.Params.Path == "" {
		b.replyHostError(ctx, req.ID, "bad_path", "params.path is required")
		return
	}
	messageID, err := b.tr.SendAttachment(ctx, b.chatID, transport.OutboundAttachment{
		Kind:    kind,
		Path:    req.Params.Path,
		Caption: req.Params.Caption,
	})
	if err != nil {
		code := classifyAttachmentError(err)
		b.replyHostError(ctx, req.ID, code, err.Error())
		return
	}
	// Mark output so any buffered transient errors are dropped — the user
	// just received a real attachment, that's clearly progress.
	b.markOutputSent()
	b.replyHostSuccess(ctx, req.ID, messageID)
}

// classifyAttachmentError maps a transport error to a short slug agent-side
// callers can branch on. Currently only quota_exhausted is recognised
// specially; everything else funnels into transport_error.
func classifyAttachmentError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	if strings.Contains(msg, "quota") {
		return "quota_exhausted"
	}
	if strings.Contains(msg, "not supported") {
		return "unsupported_transport"
	}
	return "transport_error"
}

func (b *Bridge) replyHostSuccess(ctx context.Context, id, messageID string) {
	// CRITICAL: id must go in cmd.ID, not cmd.Data["id"]. hostclient.local's
	// writeCommand explicitly skips Data["id"] / Data["type"] to prevent
	// callers from clobbering the protocol's reserved keys — so an id buried
	// in Data ends up as "" on the wire, the agent's pendingHostRequests
	// lookup misses, and the tool times out at 30s. Same applies to
	// replyHostError below.
	cmd := hostclient.Command{
		ID:   id,
		Type: "host_response",
		Data: map[string]any{
			"success": true,
		},
	}
	if messageID != "" {
		cmd.Data["data"] = map[string]any{"messageId": messageID}
	}
	if err := b.responder(ctx, cmd); err != nil {
		// Nothing we can do — the agent's tool call will time out. Don't
		// retry: at-most-once delivery is fine here, the user-visible
		// damage was already done (or not) on the transport side.
		_ = err
	}
}

func (b *Bridge) replyHostError(ctx context.Context, id, code, message string) {
	if b.responder == nil {
		return
	}
	data := map[string]any{
		"success": false,
		"error":   message,
	}
	if code != "" {
		data["errorCode"] = code
	}
	_ = b.responder(ctx, hostclient.Command{
		ID:   id,
		Type: "host_response",
		Data: data,
	})
}

// extractErrorText pulls a human-readable error string from an error event.
func extractErrorText(raw json.RawMessage) string {
	var v struct {
		Error   string `json:"error"`
		Message string `json:"message"`
		Data    struct {
			Error   string `json:"error"`
			Message string `json:"message"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return ""
	}
	if v.Error != "" {
		return v.Error
	}
	if v.Message != "" {
		return v.Message
	}
	if v.Data.Error != "" {
		return v.Data.Error
	}
	return v.Data.Message
}
