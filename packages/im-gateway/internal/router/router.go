package router

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"vetta-im-gateway/internal/bridge"
	"vetta-im-gateway/internal/command"
	"vetta-im-gateway/internal/hostclient"
	"vetta-im-gateway/internal/state"
	"vetta-im-gateway/internal/transport"
)

// Router is the gateway's central message dispatcher. It implements
// transport.MessageHandler so transports can hand it inbound messages
// directly. The router decides whether each message is a slash-command
// (delegated to command.Router) or a normal prompt (forwarded to the
// agent via hostclient + bridge).
//
// All sessions live in conversationCwd (desktop-app's virtual "对话"
// project). Per-(user, chatID) goroutine: each unique conversation gets
// its own processing goroutine, so messages from the same user in the
// same chat are handled in arrival order without holding a global lock.
// Messages from different conversations run in parallel.
type Router struct {
	tr              transport.Transport
	commands        *command.Router
	state           state.Store
	pool            *hostclient.ProcessPool
	conversationCwd string
	// datedCwd, when true, runs each agent in a per-day subdirectory
	// <conversationCwd>/<YYYY-MM-DD>/ (the dated work log, ADR-0009) instead of
	// the conversation root. Set via SetDatedCwd by the embedded host runtime.
	datedCwd bool

	mu     sync.Mutex
	queues map[string]chan transport.InboundMessage
	closed bool

	wg sync.WaitGroup
}

// New constructs a Router. None of the arguments may be nil; conversationCwd
// must be an absolute path (the cwd of desktop-app's default "对话" project).
func New(
	tr transport.Transport,
	commands *command.Router,
	st state.Store,
	pool *hostclient.ProcessPool,
	conversationCwd string,
) *Router {
	return &Router{
		tr:              tr,
		commands:        commands,
		state:           st,
		pool:            pool,
		conversationCwd: conversationCwd,
		queues:          make(map[string]chan transport.InboundMessage),
	}
}

// Compile-time interface conformance.
var _ transport.MessageHandler = (*Router)(nil)

// SetTransport replaces the transport used for outbound sends. Used by
// the host runtime when the wechat bind flow completes (or any other
// in-process transport swap) so the router's reply path targets the new
// transport rather than the placeholder it was constructed with.
//
// Reads of r.tr go through getTransport so they share the same mutex
// (concurrent writes would otherwise race the per-conversation
// goroutines that call SendMessage).
func (r *Router) SetTransport(tr transport.Transport) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	r.tr = tr
}

// getTransport returns the current transport under lock. Per-conversation
// goroutines use this for every outbound SendMessage call so a concurrent
// SetTransport from the host runtime is race-free.
func (r *Router) getTransport() transport.Transport {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.tr
}

// HandleInbound enqueues the message onto the per-conversation goroutine.
// Returns immediately; processing is asynchronous.
func (r *Router) HandleInbound(ctx context.Context, msg transport.InboundMessage) error {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return fmt.Errorf("router: shut down")
	}

	key := convKey(msg.UserID, msg.ChatID)
	q, ok := r.queues[key]
	if !ok {
		q = make(chan transport.InboundMessage, 32)
		r.queues[key] = q
		r.wg.Add(1)
		go r.processConversation(ctx, q)
	}
	r.mu.Unlock()

	select {
	case q <- msg:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Shutdown closes all per-conversation queues and waits for the workers
// to drain. Safe to call multiple times.
func (r *Router) Shutdown() {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return
	}
	r.closed = true
	for _, q := range r.queues {
		close(q)
	}
	r.queues = nil
	r.mu.Unlock()
	r.wg.Wait()
}

func convKey(userID, chatID string) string {
	return userID + "::" + chatID
}

// processConversation drains one queue, implementing the live-turn state
// machine (ADR-0010). A message received while no turn is active (IDLE) is
// either a slash-command (handled inline, no turn) or the seed of a new turn.
// Messages that arrive while a turn is live fold into it — merged into the
// initial prompt during the acquire window, or steered into the running agent
// afterwards. The turn ends at agent_end; the next message starts a fresh one.
func (r *Router) processConversation(ctx context.Context, queue chan transport.InboundMessage) {
	defer r.wg.Done()

	// pending carries a message that was dequeued but turned out to belong to
	// the next turn — set by runTurn when a turn ends in the narrow window
	// between dequeue and fold. nil the rest of the time.
	var pending *transport.InboundMessage
	for {
		var seed transport.InboundMessage
		if pending != nil {
			seed, pending = *pending, nil
		} else {
			m, ok := <-queue
			if !ok {
				return
			}
			seed = m
		}

		// IDLE: a slash-command is handled here and does not start a turn.
		handled, err := r.tryCommand(ctx, seed)
		if err != nil {
			r.replyError(ctx, seed.ChatID, err)
			continue
		}
		if handled {
			continue
		}

		next, err := r.runTurn(ctx, queue, seed)
		if err != nil {
			r.replyError(ctx, seed.ChatID, err)
		}
		pending = next
	}
}

// tryCommand dispatches msg through the command router. handled=true means it
// was a slash-command (already executed, reply sent); handled=false means it's
// a normal prompt that should seed or fold into a turn. Slash-commands are only
// recognised in IDLE — messages folded into a live turn are never dispatched
// here (ADR-0010), they go to the agent as plain text.
func (r *Router) tryCommand(ctx context.Context, msg transport.InboundMessage) (bool, error) {
	env := command.Env{
		UserID:          msg.UserID,
		ChatID:          msg.ChatID,
		ConversationCwd: r.conversationCwd,
		State:           r.state,
		HostPool:        r.pool,
	}
	res, err := r.commands.Dispatch(ctx, env, msg.Text)
	if err != nil {
		return false, err
	}
	if res.Reply.Text != "" || len(res.Reply.Blocks) > 0 {
		if _, err := r.getTransport().SendMessage(ctx, msg.ChatID, res.Reply); err != nil {
			return false, err
		}
	}
	return !res.NotACommand, nil
}

// runTurn drives one live turn (ADR-0010): look up the (user, chat) session,
// acquire a HostSession, send the seed prompt (merging any messages that
// arrived during the acquire window), run the Bridge in its own goroutine, and
// fold any further inbound messages into the running agent via steer until the
// agent reaches agent_end. Returns a non-nil *message when a dequeued message
// turned out to belong to the next turn (the turn ended before it could be
// folded), so the caller seeds the next turn with it instead of losing it.
func (r *Router) runTurn(
	ctx context.Context,
	queue chan transport.InboundMessage,
	seed transport.InboundMessage,
) (*transport.InboundMessage, error) {
	entry, _, _ := r.state.GetSession(ctx, seed.UserID, seed.ChatID)

	cwd, err := r.agentCwd()
	if err != nil {
		return nil, err
	}

	acq, err := r.pool.Acquire(ctx, cwd, entry.SessionPath)
	if err != nil {
		return nil, fmt.Errorf("acquire session: %w", err)
	}
	defer acq.Release()

	// Persist the actual session path reported by the agent. This covers both
	// a fresh session and a Legacy source that was migrated to a new Greenfield
	// conversation during startup.
	if real := acq.Session.SessionPath(); real != "" && real != entry.SessionPath {
		_ = r.state.SetSession(ctx, state.SessionEntry{
			UserID:      seed.UserID,
			ChatID:      seed.ChatID,
			SessionPath: real,
		})
	}

	// Acquire window (ADR-0010): cold-start latency is a free coalescing
	// window — no debounce timer. Drain whatever already queued during Acquire
	// and merge it into the seed prompt so a burst of messages becomes one.
	prompt := buildPromptMessage(seed)
drain:
	for {
		select {
		case m := <-queue:
			prompt += "\n" + buildPromptMessage(m)
		default:
			break drain
		}
	}

	if _, err := acq.Session.Send(ctx, hostclient.Command{
		Type: hostclient.CommandTypePrompt,
		Data: map[string]any{"message": prompt},
	}); err != nil {
		discardRestartRequiredSession(acq, err)
		return nil, fmt.Errorf("send prompt: %w", err)
	}

	br := bridge.New(r.tr, seed.ChatID)
	// host_request → host_response reverse RPC. The bridge invokes this
	// when the agent's `im_send_attachment` tool fires; we route the
	// command back to the same coding-agent subprocess via the session's
	// stdin. SendNoReply because the agent never echoes a `response`
	// frame for host_response — registering a pending entry would leak.
	session := acq.Session
	br.SetHostResponder(func(rctx context.Context, cmd hostclient.Command) error {
		return session.SendNoReply(rctx, cmd)
	})
	// memory-mode rollover (ADR-0009): when the agent rolls the session into a
	// fresh .jsonl, repoint this chat's routing state at the new path so the
	// next message resumes the rolled-over session, not the archived one.
	br.SetPathChangeHandler(func(newPath string) {
		_ = r.state.SetSession(ctx, state.SessionEntry{
			UserID:      seed.UserID,
			ChatID:      seed.ChatID,
			SessionPath: newPath,
		})
	})

	// The bridge consumes events until agent_end (then returns). Running it in
	// its own goroutine lets this loop keep draining the queue and steering
	// folds into the still-streaming agent — a steered message defers agent_end
	// so the bridge keeps producing into the same turn (one reply).
	done := make(chan error, 1)
	go func() { done <- br.Run(ctx, session.Events()) }()

	for {
		select {
		case err := <-done:
			discardRestartRequiredSession(acq, err)
			return nil, err
		case <-ctx.Done():
			return nil, ctx.Err()
		case m := <-queue:
			// A message arrived during the live turn. If the turn just ended,
			// hand it back as the next turn's seed rather than steering it into
			// an agent that is no longer listening.
			select {
			case err := <-done:
				discardRestartRequiredSession(acq, err)
				return &m, err
			default:
			}
			if err := r.steer(ctx, session, m); err != nil && discardRestartRequiredSession(acq, err) {
				return nil, err
			}
		}
	}
}

// steer folds a message into the running agent. Sent as a prompt with
// streamingBehavior "steer" so coding-agent queues it as a steering message
// while streaming, or — if the turn ended in the meantime — runs it as a fresh
// prompt (see rpc-mode.ts). A failed fold is non-fatal and intentionally not
// surfaced to the user: it only happens on a dead session, which the bridge's
// done error reports anyway.
func (r *Router) steer(ctx context.Context, session hostclient.HostSession, msg transport.InboundMessage) error {
	_, err := session.Send(ctx, hostclient.Command{
		Type: hostclient.CommandTypePrompt,
		Data: map[string]any{
			"message":           buildPromptMessage(msg),
			"streamingBehavior": "steer",
		},
	})
	return err
}

func discardRestartRequiredSession(acquired *hostclient.Acquired, err error) bool {
	if err == nil {
		return false
	}
	var failure hostclient.TypedFailure
	if !errors.As(err, &failure) || failure.FailureRecoverability() != hostclient.FailureRestartSession {
		return false
	}
	_ = acquired.Discard()
	return true
}

// SetDatedCwd toggles per-day run directories (ADR-0009). Called by the
// embedded host runtime for the Claw conversation; left off for standalone
// dev mode and tests.
func (r *Router) SetDatedCwd(enabled bool) { r.datedCwd = enabled }

// agentCwd returns the working directory to spawn the agent in. With datedCwd
// off it's the conversation root (legacy behaviour). With it on it's today's
// date subdirectory <conversationCwd>/<YYYY-MM-DD>/ (created if missing),
// matching the inbox layout so inbound media, artifacts, and JOURNAL.md share
// one per-day directory.
func (r *Router) agentCwd() (string, error) {
	if !r.datedCwd {
		return r.conversationCwd, nil
	}
	cwd := filepath.Join(r.conversationCwd, time.Now().Format("2006-01-02"))
	if err := os.MkdirAll(cwd, 0o755); err != nil {
		return "", fmt.Errorf("create dated cwd: %w", err)
	}
	return cwd, nil
}

// buildPromptMessage assembles the text the agent sees. Mirrors desktop-app's
// `mentionedFile` convention: each attachment becomes an `@<absolute-path>`
// line prepended to the user's text. Agent reads each path via its own Read
// tool — `resizeImageBuffer` handles image sizing automatically, see ADR-0006.
//
// Returns msg.Text unchanged when no attachments are present so plain text
// flows behave identically to before.
func buildPromptMessage(msg transport.InboundMessage) string {
	if len(msg.Attachments) == 0 {
		return msg.Text
	}
	var b strings.Builder
	for _, a := range msg.Attachments {
		if a.URL == "" {
			continue
		}
		b.WriteString("@")
		b.WriteString(a.URL)
		b.WriteString("\n")
	}
	b.WriteString(msg.Text)
	return b.String()
}

func (r *Router) replyError(ctx context.Context, chatID string, err error) {
	_, _ = r.getTransport().SendMessage(ctx, chatID, transport.OutboundMessage{
		Text: fmt.Sprintf("error: %v", err),
	})
}
