package command

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"vetta-im-gateway/internal/hostclient"
	"vetta-im-gateway/internal/state"
	"vetta-im-gateway/internal/transport"
)

// flushMemoryTimeout bounds the memory-consolidation step on /new so a slow or
// hung LLM flush can never wedge the command indefinitely.
const flushMemoryTimeout = 60 * time.Second

// Result is what a Handler returns. Reply, if non-empty, is the message
// the gateway should deliver back to the user. Mutated, if true, signals
// that the routing table changed and the caller should persist any
// derived in-memory state. NotACommand is true when the message did not
// look like a command at all (parser fell through) — the caller should
// then forward the message to the agent bridge.
type Result struct {
	Reply       transport.OutboundMessage
	Mutated     bool
	NotACommand bool
}

// Handler executes one slash command.
type Handler interface {
	Name() string
	Help() string
	Run(ctx context.Context, env Env, args []string) (Result, error)
}

// Env carries dependencies the handlers need. Constructed once per
// gateway lifetime; passed by value into each Run call so handlers can
// access without coupling to a global.
type Env struct {
	UserID          string // platform user id (e.g. feishu open_id)
	ChatID          string // platform chat id; routes to one session per chat
	ConversationCwd string // absolute cwd of the default "对话" project
	State           state.Store
	HostPool        HostPool
	HostBin         string // for /whoami diagnostic only
}

// HostPool is the subset of hostclient.ProcessPool the command layer needs.
// Defined as an interface so command tests can use a fake.
type HostPool interface {
	Acquire(ctx context.Context, cwd, sessionPath string) (*hostclient.Acquired, error)
	Stats() hostclient.Stats
}

// Router is the entry point. Construct via NewRouter and call Dispatch
// for every inbound message before falling through to the agent bridge.
type Router struct {
	handlers map[string]Handler
}

// NewRouter constructs a router pre-populated with the post-collapse
// command set: /new /whoami /help. Project commands (/projects /use)
// are gone — every IM session lives in conversationCwd.
func NewRouter() *Router {
	r := &Router{handlers: make(map[string]Handler)}
	r.Register(&newCmd{})
	r.Register(&whoamiCmd{})
	r.Register(&helpCmd{router: r})
	return r
}

// Register adds a handler. Handler.Name() determines the slash-command
// keyword. Re-registering an existing name overwrites it.
func (r *Router) Register(h Handler) {
	r.handlers[h.Name()] = h
}

// Dispatch parses text and runs the matching handler. If text doesn't
// look like a command, returns Result{NotACommand: true} so the caller
// can forward to the bridge.
//
// The leading "/" is required; mention prefixes (@bot) are stripped by
// the transport before reaching here.
func (r *Router) Dispatch(ctx context.Context, env Env, text string) (Result, error) {
	text = strings.TrimSpace(text)
	if !strings.HasPrefix(text, "/") {
		return Result{NotACommand: true}, nil
	}
	parts := splitArgs(text[1:])
	if len(parts) == 0 {
		return Result{NotACommand: true}, nil
	}
	name, args := parts[0], parts[1:]
	h, ok := r.handlers[name]
	if !ok {
		return reply(fmt.Sprintf("未知命令 `/%s`，使用 `/help` 查看可用命令。", name)), nil
	}
	return h.Run(ctx, env, args)
}

// splitArgs is a tiny argv splitter that respects single quotes for cases
// like /new "my session". Not a full shell parser; supports double-quoted
// strings only and treats backslash literally.
func splitArgs(s string) []string {
	var out []string
	var cur strings.Builder
	inQuote := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '"':
			inQuote = !inQuote
		case c == ' ' && !inQuote:
			if cur.Len() > 0 {
				out = append(out, cur.String())
				cur.Reset()
			}
		default:
			cur.WriteByte(c)
		}
	}
	if cur.Len() > 0 {
		out = append(out, cur.String())
	}
	return out
}

// reply is a tiny convenience for plain-text replies.
func reply(text string) Result {
	return Result{Reply: transport.OutboundMessage{Text: text}}
}

// =============================================================================
// /new
// =============================================================================

// newCmd discards the current chat's session binding and starts a fresh
// session in conversationCwd on the next prompt. Avoids unbounded context
// growth without forcing the user to abandon the chat window.
type newCmd struct{}

func (newCmd) Name() string { return "new" }
func (newCmd) Help() string {
	return "`/new` — 在当前对话中开启新会话（清空上下文）"
}

func (newCmd) Run(ctx context.Context, env Env, _ []string) (Result, error) {
	if env.ConversationCwd == "" {
		return reply("**未配置对话目录**，请稍后再试。"), nil
	}

	// Consolidate the current session's durable facts into MEMORY.md before we
	// discard it (ADR-0009). The automatic flush only fires at a rollover, so a
	// short session the user abandons via /new before ever hitting the threshold
	// would otherwise lose its memory. Best-effort: a flush failure must not
	// block /new.
	wrote := flushSessionMemory(ctx, env)

	// Clear the existing routing entry — next prompt will spawn a fresh
	// session via the pool (sessionPath="" semantics in router).
	if err := env.State.SetSession(ctx, state.SessionEntry{
		UserID:      env.UserID,
		ChatID:      env.ChatID,
		SessionPath: "",
	}); err != nil {
		return Result{}, fmt.Errorf("clear session: %w", err)
	}

	text := "已开启新会话，下一条消息将从空上下文开始。"
	if wrote > 0 {
		text = fmt.Sprintf("已开启新会话（已凝结 %d 条记忆到长期记忆），下一条消息将从空上下文开始。", wrote)
	}
	return Result{
		Reply:   transport.OutboundMessage{Text: text},
		Mutated: true,
	}, nil
}

// flushSessionMemory drives a one-shot memory consolidation on the chat's
// current session before it is discarded. Returns the number of entries
// written (0 on any error, no existing session, or when memory-mode is off —
// coding-agent answers flush_memory with written:0 in that case). Best-effort
// throughout: nothing here blocks or fails /new.
func flushSessionMemory(ctx context.Context, env Env) int {
	if env.HostPool == nil || env.State == nil {
		return 0
	}
	entry, ok, err := env.State.GetSession(ctx, env.UserID, env.ChatID)
	if err != nil || !ok || entry.SessionPath == "" {
		return 0
	}

	fctx, cancel := context.WithTimeout(ctx, flushMemoryTimeout)
	defer cancel()

	// cwd is irrelevant to the flush: MEMORY.md is fixed by the spawn args
	// (<conversationCwd>/MEMORY.md) regardless of run cwd, and flush touches no
	// tools or the dated work log.
	acq, err := env.HostPool.Acquire(fctx, env.ConversationCwd, entry.SessionPath)
	if err != nil {
		return 0
	}
	defer acq.Release()

	resp, err := acq.Session.Send(fctx, hostclient.Command{Type: hostclient.CommandTypeFlushMemory})
	if err != nil || !resp.Success {
		return 0
	}
	if w, ok := resp.Data["written"].(float64); ok {
		return int(w)
	}
	return 0
}

// =============================================================================
// /whoami
// =============================================================================

type whoamiCmd struct{}

func (whoamiCmd) Name() string { return "whoami" }
func (whoamiCmd) Help() string {
	return "`/whoami` — 查看当前用户、会话与连接池状态"
}

func (whoamiCmd) Run(ctx context.Context, env Env, _ []string) (Result, error) {
	var b strings.Builder
	b.WriteString("**当前状态**\n\n")
	fmt.Fprintf(&b, "- **用户**：`%s`\n", env.UserID)
	fmt.Fprintf(&b, "- **会话目录**：`%s`\n", env.ConversationCwd)

	if env.State != nil {
		if entry, ok, _ := env.State.GetSession(ctx, env.UserID, env.ChatID); ok && entry.SessionPath != "" {
			fmt.Fprintf(&b, "- **会话**：`%s`\n", entry.SessionPath)
		} else {
			b.WriteString("- **会话**：*(尚未开启，发送任意消息即可启动)*\n")
		}
	}

	if env.HostPool != nil {
		st := env.HostPool.Stats()
		fmt.Fprintf(&b, "- **连接池**：%d/%d 会话，%d 进行中\n", st.Size, st.MaxSize, st.InFlight)
	}
	return reply(strings.TrimRight(b.String(), "\n")), nil
}

// =============================================================================
// /help
// =============================================================================

type helpCmd struct {
	router *Router
}

func (helpCmd) Name() string { return "help" }
func (helpCmd) Help() string { return "`/help` — 显示本帮助" }

func (h helpCmd) Run(_ context.Context, _ Env, _ []string) (Result, error) {
	names := make([]string, 0, len(h.router.handlers))
	for n := range h.router.handlers {
		names = append(names, n)
	}
	sort.Strings(names)

	var b strings.Builder
	b.WriteString("**可用命令**\n\n")
	for _, n := range names {
		fmt.Fprintf(&b, "- %s\n", h.router.handlers[n].Help())
	}
	return reply(strings.TrimRight(b.String(), "\n")), nil
}
