package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"vetta-im-gateway/internal/command"
	"vetta-im-gateway/internal/hostclient"
	hclocal "vetta-im-gateway/internal/hostclient/local"
	"vetta-im-gateway/internal/hostproto"
	"vetta-im-gateway/internal/router"
	"vetta-im-gateway/internal/state"
	"vetta-im-gateway/internal/transport"
	"vetta-im-gateway/internal/transport/feishu"
	"vetta-im-gateway/internal/transport/wechat"
	"vetta-im-gateway/internal/transport/wechat/ilink"
)

// transportBuilder constructs a transport.Transport from the active
// transport selection. Returns errAwaitingBind when the wechat slot is
// selected but no credentials have been persisted yet — the caller treats
// this as a non-fatal "park the runtime, wait for bind frames".
//
// Production uses buildHostTransport; tests inject a stub.
type transportBuilder func(*buildSpec) (transport.Transport, error)

// hostOptions configures runHostWithIO. Used so tests can inject mock IO
// streams and a stub transport builder.
type hostOptions struct {
	stdin          io.Reader
	stdout         io.Writer
	buildTransport transportBuilder
	initTimeout    time.Duration
	shutdownGrace  time.Duration
}

// runHost is the entry point for the embedded host mode. The sidecar reads
// configuration from stdin (NDJSON hostproto frames) and writes events back
// to stdout, never touching the filesystem for config / credentials / state.
//
// Lifecycle:
//
//	parent spawns sidecar
//	parent → child: init frame (within initTimeout)
//	child  → parent: ready event
//	... runtime: parent may send config_update / shutdown ...
//	stdin EOF or shutdown frame → graceful close → exit 0
//
// Returns the process exit code.
func runHost(_ []string) int {
	return runHostWithIO(hostOptions{
		stdin:          os.Stdin,
		stdout:         os.Stdout,
		buildTransport: buildHostTransport,
	})
}

// runHostWithIO is the testable core of the host command. All side
// effects funnel through the supplied options.
func runHostWithIO(opts hostOptions) int {
	if opts.initTimeout == 0 {
		opts.initTimeout = 10 * time.Second
	}
	if opts.shutdownGrace == 0 {
		opts.shutdownGrace = 5 * time.Second
	}
	if opts.buildTransport == nil {
		opts.buildTransport = buildHostTransport
	}
	initTimeout := opts.initTimeout
	shutdownGrace := opts.shutdownGrace

	out := hostproto.NewWriter(opts.stdout)
	rdr := hostproto.NewReader(opts.stdin)
	rctx, rcancel := context.WithCancel(context.Background())
	defer rcancel()
	go rdr.Run(rctx)

	emitLog := func(level, msg string, fields map[string]any) {
		_ = out.WriteFrame(hostproto.LogEvent{
			Type:   hostproto.TypeLog,
			Level:  level,
			Msg:    msg,
			Fields: fields,
			Time:   time.Now().UTC(),
		})
	}
	emitStatus := func(status, lastErr string) {
		_ = out.WriteFrame(hostproto.StatusEvent{
			Type:      hostproto.TypeStatus,
			Transport: status,
			LastError: lastErr,
			Time:      time.Now().UTC(),
		})
	}

	// 1. Wait for init frame (or stdin EOF / timeout).
	initFrame, err := waitForInit(rdr, initTimeout)
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway host: %v\n", err)
		return 1
	}
	if initFrame.ConversationCwd == "" {
		fmt.Fprintln(os.Stderr, "im-gateway host: init frame missing conversationCwd")
		return 1
	}

	// 2. Build runtime components.
	// State store with patch hook → forward to parent as state_patch events.
	stateStore := state.NewMemoryStore(func(entry state.SessionEntry) {
		_ = out.WriteFrame(hostproto.StatePatchEvent{
			Type:        hostproto.TypeStatePatch,
			UserID:      entry.UserID,
			ChatID:      entry.ChatID,
			SessionPath: entry.SessionPath,
			UpdatedAt:   entry.UpdatedAt,
		})
	})
	stateStore.Replace(stateFromFrames(initFrame.State))

	// Mirror desktop-app's resolveSessionDirForCwd convention: the IM
	// conversation cwd stores its sessions under <cwd>/.vetta/sessions/
	// instead of the global ~/.vetta/agent/sessions/<encoded-cwd>/. desktop-
	// app's Claw tab reads from this same directory to render IM sessions
	// read-only.
	hclocalOpts := hclocal.Options{
		SessionDir: filepath.Join(initFrame.ConversationCwd, ".vetta", "sessions"),
		// Always enable the host-bridge channel in embedded mode: it's how
		// im-gateway-driven sessions deliver IM attachments via
		// im_send_attachment / host_request. Other agents (desktop, TUI,
		// CLI) never set this flag and the tool stays invisible to them.
		EnableHostBridge: true,
		// memory-mode (ADR-0009): Claw is a fixed, single project, so memory is
		// always on for the embedded gateway. MEMORY.md lives at the conversation
		// root — a stable path independent of the per-day run cwd the router
		// spawns the agent in. SessionDir above is likewise pinned to the root.
		MemoryMode: true,
		MemoryFile: filepath.Join(initFrame.ConversationCwd, "MEMORY.md"),
	}
	if initFrame.CodingAgent != nil && initFrame.CodingAgent.Bin != "" {
		hclocalOpts.Bin = initFrame.CodingAgent.Bin
		hclocalOpts.BinPrefixArgs = initFrame.CodingAgent.PrefixArgs
		if initFrame.CodingAgent.RunAsNode {
			if hclocalOpts.ExtraEnv == nil {
				hclocalOpts.ExtraEnv = map[string]string{}
			}
			hclocalOpts.ExtraEnv["ELECTRON_RUN_AS_NODE"] = "1"
		}
		if initFrame.CodingAgent.PackageDir != "" {
			if hclocalOpts.ExtraEnv == nil {
				hclocalOpts.ExtraEnv = map[string]string{}
			}
			hclocalOpts.ExtraEnv["VETTA_PACKAGE_DIR"] = initFrame.CodingAgent.PackageDir
		}
		if initFrame.CodingAgent.ServerURL != "" {
			if hclocalOpts.ExtraEnv == nil {
				hclocalOpts.ExtraEnv = map[string]string{}
			}
			hclocalOpts.ExtraEnv["VETTA_SERVER_URL"] = initFrame.CodingAgent.ServerURL
		}
		emitLog("info", "coding-agent binary configured by parent",
			map[string]any{
				"bin":        initFrame.CodingAgent.Bin,
				"prefixArgs": initFrame.CodingAgent.PrefixArgs,
				"runAsNode":  initFrame.CodingAgent.RunAsNode,
				"packageDir": initFrame.CodingAgent.PackageDir,
				"serverUrl":  initFrame.CodingAgent.ServerURL,
			})
	}
	hostClient := hclocal.New(hclocalOpts)
	pool := hostclient.NewProcessPool(hostClient, 0)
	// IM messages arrive sparsely. Keep coding-agent subprocesses warm
	// between turns of the SAME chat is wasteful, and — worse — the
	// subprocess holds the session-file lockfile for its entire lifetime,
	// which would block desktop-app from opening that session in its
	// sidebar. Close on idle.
	pool.SetCloseOnIdle(true)

	// 3. Build transport from injected config. errAwaitingBind is a
	//    legitimate startup state for the wechat slot — we park the
	//    runtime instead of failing.
	currentSpec := specFromInit(initFrame)
	tr, err := opts.buildTransport(currentSpec)
	awaitingBind := false
	if errors.Is(err, errAwaitingBind) {
		awaitingBind = true
		tr = nil
		err = nil
	}
	if err != nil {
		emitLog("error", "build transport", map[string]any{"err": err.Error()})
		fmt.Fprintf(os.Stderr, "im-gateway host: %v\n", err)
		_ = pool.Shutdown(context.Background())
		return 1
	}

	// Router needs a transport at construction time — even in
	// awaiting_bind mode we hand it a no-op stand-in so the rest of the
	// machinery (command parser, host client pool wiring) is alive and
	// ready to be wired to the real transport once bind succeeds.
	if tr == nil {
		tr = newPlaceholderTransport()
	}
	r := router.New(tr, command.NewRouter(), stateStore, pool, initFrame.ConversationCwd)
	// Dated work log (ADR-0009): run each agent in <conversationCwd>/<date>/ so
	// artifacts, inbound media, and JOURNAL.md group by day.
	r.SetDatedCwd(true)

	// 4. Start transport (or skip if awaiting bind).
	tCtx, tCancel := context.WithCancel(context.Background())
	var transportDone chan error
	startTransport := func(t transport.Transport) {
		// Emit "connecting" synchronously before spawning the start
		// goroutine. Emitting from inside the goroutine races with the
		// caller's subsequent "online" emit and can leave the renderer
		// stuck on "connecting" if the goroutine is scheduled after.
		emitStatus(hostproto.TransportStatusConnecting, "")
		transportDone = make(chan error, 1)
		go func(t transport.Transport, ctx context.Context, done chan error) {
			done <- t.Start(ctx, r)
		}(t, tCtx, transportDone)
	}

	if !awaitingBind {
		startTransport(tr)
	}

	// 5. Emit ready + initial status.
	if err := out.WriteFrame(hostproto.ReadyEvent{
		Type:      hostproto.TypeReady,
		Version:   version,
		Transport: tr.Name(),
	}); err != nil {
		emitLog("error", "write ready", map[string]any{"err": err.Error()})
	}
	if awaitingBind {
		emitStatus(hostproto.TransportStatusAwaitingBind, "")
	} else {
		emitStatus(hostproto.TransportStatusOnline, "")
	}
	emitLog("info", "im-gateway host ready",
		map[string]any{
			"transport":       tr.Name(),
			"version":         version,
			"conversationCwd": initFrame.ConversationCwd,
			"state":           len(initFrame.State),
			"awaitingBind":    awaitingBind,
		})

	// 5b. Set up the wechat bind coordinator if wechat is the active
	//     transport. The rebuild channel signals the main loop that a
	//     bind has just succeeded and the transport should be (re)built.
	wechatRebuildCh := make(chan struct{}, 1)
	var wcoord *wechatBindCoordinator
	if currentSpec.Wechat != nil && currentSpec.Wechat.Enabled {
		wcoord = newWechatBindCoordinator(
			currentSpec.WechatStatePath,
			out,
			emitLog,
			wechatRebuildCh,
		)
	}

	// 6. Main loop: handle inbound control frames until EOF / shutdown /
	// transport failure.
	shutdownReason := "stdin closed"
	var trErr error
	hostState := &hostRuntime{
		out:        out,
		stateStore: stateStore,
		emitLog:    emitLog,
		emitStatus: emitStatus,
		wcoord:     wcoord,
		spec:       currentSpec,
	}

	// rebuildTransport tears down the current transport (if any) and
	// builds a fresh one from hostState.spec, then starts it.
	rebuildTransport := func() {
		// Cancel the old transport (or placeholder).
		tCancel()
		if transportDone != nil {
			select {
			case <-transportDone:
			case <-time.After(2 * time.Second):
				emitLog("warn", "previous transport did not stop in 2s", nil)
			}
			transportDone = nil
		}
		_ = tr.Stop()

		// Fresh context for the new transport.
		newCtx, newCancel := context.WithCancel(context.Background())
		tCtx = newCtx
		tCancel = newCancel

		newTr, buildErr := opts.buildTransport(hostState.spec)
		if errors.Is(buildErr, errAwaitingBind) {
			tr = newPlaceholderTransport()
			r.SetTransport(tr)
			emitStatus(hostproto.TransportStatusAwaitingBind, "")
			emitLog("info", "transport awaiting wechat bind", nil)
			return
		}
		if buildErr != nil {
			emitLog("error", "rebuild transport", map[string]any{"err": buildErr.Error()})
			emitStatus(hostproto.TransportStatusError, buildErr.Error())
			tr = newPlaceholderTransport()
			r.SetTransport(tr)
			return
		}
		tr = newTr
		r.SetTransport(tr)
		startTransport(tr)
		emitStatus(hostproto.TransportStatusOnline, "")
		emitLog("info", "transport (re)started", map[string]any{"transport": tr.Name()})
	}

loop:
	for {
		select {
		case frame, ok := <-rdr.Frames():
			if !ok {
				// EOF == implicit shutdown.
				break loop
			}
			action := hostState.handleFrame(frame)
			if action.stop {
				shutdownReason = "shutdown frame"
				break loop
			}
			if action.startBind && hostState.wcoord != nil {
				hostState.wcoord.Start(context.Background())
			}
			if action.logout && hostState.wcoord != nil {
				if err := hostState.wcoord.LogoutAndClear("user logout"); err != nil {
					emitLog("error", "wechat logout failed", map[string]any{"err": err.Error()})
				} else {
					rebuildTransport()
				}
			}
			if action.rebuild {
				rebuildTransport()
			}
		case <-wechatRebuildCh:
			// Bind goroutine signalled success.
			rebuildTransport()
		case err := <-rdr.Err():
			emitLog("error", "stdin reader error", map[string]any{"err": err.Error()})
			shutdownReason = "stdin error"
			break loop
		case err := <-transportDone:
			transportDone = nil
			// wechat session timeout (-14) is recoverable: the bot token is
			// dead but the user can rescan. Clear the persisted credentials,
			// drop back to a placeholder + awaiting_bind, and keep the
			// sidecar alive so the next wechat_bind_start works.
			if err != nil && errors.Is(err, ilink.ErrSessionTimeout) && hostState.wcoord != nil {
				emitLog("warn", "wechat session expired, awaiting re-bind", map[string]any{"err": err.Error()})
				if clearErr := hostState.wcoord.LogoutAndClear("session timeout"); clearErr != nil {
					emitLog("error", "wechat clear after session timeout failed", map[string]any{"err": clearErr.Error()})
				}
				tCancel()
				_ = tr.Stop()
				newCtx, newCancel := context.WithCancel(context.Background())
				tCtx = newCtx
				tCancel = newCancel
				tr = newPlaceholderTransport()
				r.SetTransport(tr)
				emitStatus(hostproto.TransportStatusAwaitingBind, "")
				continue
			}
			trErr = err
			if err != nil && !errors.Is(err, context.Canceled) {
				emitLog("error", "transport stopped with error", map[string]any{"err": err.Error()})
				emitStatus(hostproto.TransportStatusError, err.Error())
			} else {
				emitStatus(hostproto.TransportStatusOffline, "")
			}
			shutdownReason = "transport stopped"
			break loop
		}
	}

	// 7. Graceful shutdown sequence.
	emitLog("info", "shutting down", map[string]any{"reason": shutdownReason})
	tCancel()
	_ = tr.Stop()
	r.Shutdown()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), shutdownGrace)
	defer shutdownCancel()
	if err := pool.Shutdown(shutdownCtx); err != nil {
		emitLog("warn", "pool shutdown", map[string]any{"err": err.Error()})
	}

	// Drain transport goroutine if still running.
	if transportDone != nil {
		select {
		case <-transportDone:
		case <-time.After(shutdownGrace):
		}
	}

	if trErr != nil && !errors.Is(trErr, context.Canceled) {
		return 1
	}
	return 0
}

// hostRuntime bundles helpers shared by frame handlers so the main loop
// stays readable.
type hostRuntime struct {
	out        *hostproto.Writer
	stateStore *state.MemoryStore
	emitLog    func(level, msg string, fields map[string]any)
	emitStatus func(status, lastErr string)

	// wcoord is the wechat bind coordinator. nil when wechat is not the
	// active transport (or has not been selected via config_update yet).
	wcoord *wechatBindCoordinator

	// spec is the most-recent build spec. Updated by config_update so
	// rebuild calls always use the latest selection.
	spec *buildSpec
}

// frameAction is what handleFrame returns to the main loop. Multiple
// flags may be set; the main loop processes them in a fixed order.
type frameAction struct {
	stop      bool // shutdown frame received
	rebuild   bool // config_update with a new transport selection
	startBind bool // wechat_bind_start
	logout    bool // wechat_logout
}

// handleFrame processes one control frame.
func (h *hostRuntime) handleFrame(frame any) frameAction {
	switch f := frame.(type) {
	case *hostproto.InitFrame:
		// Late init: ignore (already processed). Log a warning.
		h.emitLog("warn", "ignoring duplicate init frame", nil)
		return frameAction{}

	case *hostproto.ConfigUpdateFrame:
		if f.Feishu == nil && f.Wechat == nil {
			h.emitLog("warn", "config_update with empty body, ignored", nil)
			return frameAction{}
		}
		h.spec = specFromConfigUpdate(f)
		// If the active transport is now wechat, ensure the bind
		// coordinator is constructed (or refreshed with the new path).
		if h.spec.Wechat != nil && h.spec.Wechat.Enabled {
			if h.wcoord == nil {
				h.wcoord = newWechatBindCoordinator(h.spec.WechatStatePath, h.out, h.emitLog, nil)
			}
		} else {
			// Switching away from wechat — drop the coordinator so
			// future bind frames are ignored.
			if h.wcoord != nil {
				h.wcoord.Cancel()
				h.wcoord = nil
			}
		}
		return frameAction{rebuild: true}

	case *hostproto.WechatBindStartFrame:
		if h.wcoord == nil {
			h.emitLog("warn", "wechat_bind_start ignored: wechat not active", nil)
			return frameAction{}
		}
		return frameAction{startBind: true}

	case *hostproto.WechatLogoutFrame:
		if h.wcoord == nil {
			h.emitLog("warn", "wechat_logout ignored: wechat not active", nil)
			return frameAction{}
		}
		return frameAction{logout: true}

	case *hostproto.ShutdownFrame:
		return frameAction{stop: true}

	default:
		h.emitLog("warn", "unknown frame", map[string]any{"type": fmt.Sprintf("%T", frame)})
		return frameAction{}
	}
}

// waitForInit blocks until the first frame arrives or the timeout fires.
// The first frame must be an InitFrame; anything else is an error.
func waitForInit(rdr *hostproto.Reader, timeout time.Duration) (*hostproto.InitFrame, error) {
	select {
	case frame, ok := <-rdr.Frames():
		if !ok {
			return nil, errors.New("stdin closed before init frame")
		}
		init, ok := frame.(*hostproto.InitFrame)
		if !ok {
			return nil, fmt.Errorf("first frame must be init, got %T", frame)
		}
		return init, nil
	case err := <-rdr.Err():
		return nil, fmt.Errorf("read init: %w", err)
	case <-time.After(timeout):
		return nil, fmt.Errorf("init frame timeout after %s", timeout)
	}
}

// buildHostTransport constructs the IM transport from the supplied
// build spec.
//
// Selection rule: spec.Wechat takes precedence over spec.Feishu when
// both are non-nil. The parent is expected to send only one slot at a
// time, but defending against both lets us evolve the protocol without
// risking a hard error.
//
// Returns errAwaitingBind when wechat is selected but no credentials
// have been persisted yet — the host runtime catches this and parks the
// sidecar in awaiting_bind mode instead of failing init.
func buildHostTransport(spec *buildSpec) (transport.Transport, error) {
	if spec == nil {
		return nil, errors.New("build spec missing")
	}
	if spec.Wechat != nil && spec.Wechat.Enabled {
		tr, err := wechat.New(wechat.Options{
			StatePath: spec.WechatStatePath,
			InboxDir:  spec.ConversationCwd,
		})
		if err != nil {
			if errors.Is(err, wechat.ErrNotBound) {
				return nil, errAwaitingBind
			}
			return nil, fmt.Errorf("build wechat transport: %w", err)
		}
		return tr, nil
	}
	if spec.Feishu != nil {
		if spec.Feishu.AppID == "" || spec.Feishu.AppSecret == "" {
			return nil, errors.New("feishu config missing AppID/AppSecret")
		}
		return feishu.New(feishu.Options{
			AppID:     spec.Feishu.AppID,
			AppSecret: spec.Feishu.AppSecret,
			Domain:    spec.Feishu.BaseURL,
			InboxDir:  spec.ConversationCwd,
		})
	}
	return nil, errors.New("build spec selects no transport")
}

// placeholderTransport is a no-op transport.Transport used while the
// sidecar is in awaiting_bind state. It satisfies the interface so the
// router can be constructed before any real transport exists, and is
// swapped out via Router.SetTransport once a bind succeeds.
type placeholderTransport struct{}

func newPlaceholderTransport() *placeholderTransport { return &placeholderTransport{} }

func (placeholderTransport) Name() string { return "placeholder" }
func (placeholderTransport) Capabilities() transport.Capabilities {
	return transport.Capabilities{}
}
func (placeholderTransport) Start(ctx context.Context, _ transport.MessageHandler) error {
	<-ctx.Done()
	return ctx.Err()
}
func (placeholderTransport) Stop() error { return nil }
func (placeholderTransport) SendMessage(_ context.Context, _ string, _ transport.OutboundMessage) (string, error) {
	return "", errors.New("placeholder transport: not bound")
}
func (placeholderTransport) EditMessage(_ context.Context, _, _ string, _ transport.OutboundMessage) error {
	return errors.New("placeholder transport: not bound")
}
func (placeholderTransport) EndStream(_ context.Context, _, _ string) error { return nil }
func (placeholderTransport) DeleteMessage(_ context.Context, _, _ string) error {
	return errors.New("placeholder transport: not bound")
}
func (placeholderTransport) ShowTyping(_ context.Context, _ string) error { return nil }
func (placeholderTransport) SendAttachment(_ context.Context, _ string, _ transport.OutboundAttachment) (string, error) {
	return "", errors.New("placeholder transport: not bound")
}

// Compile-time interface check.
var _ transport.Transport = (*placeholderTransport)(nil)

// stateFromFrames converts wire entries into RouterState for MemoryStore.
func stateFromFrames(in []hostproto.SessionStateEntry) state.RouterState {
	out := state.RouterState{
		Version:  state.CurrentVersion,
		Sessions: make(map[string]state.SessionEntry, len(in)),
	}
	for _, e := range in {
		updated := e.UpdatedAt
		if updated.IsZero() {
			updated = time.Now().UTC()
		}
		out.Sessions[state.SessionKey(e.UserID, e.ChatID)] = state.SessionEntry{
			UserID:      e.UserID,
			ChatID:      e.ChatID,
			SessionPath: e.SessionPath,
			UpdatedAt:   updated,
		}
	}
	return out
}
