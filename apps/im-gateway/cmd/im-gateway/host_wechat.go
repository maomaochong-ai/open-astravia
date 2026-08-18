package main

import (
	"context"
	"errors"
	"sync"

	"vetta-im-gateway/internal/hostproto"
	"vetta-im-gateway/internal/transport/wechat"
	"vetta-im-gateway/internal/transport/wechat/ilink"
)

// errAwaitingBind is the sentinel buildHostTransport returns when the
// active transport is wechat but no credentials are persisted yet. The
// host runtime catches it specially: instead of failing init, it leaves
// the transport unbuilt, emits awaiting_bind status, and waits for the
// parent to drive a TypeWechatBindStart frame.
var errAwaitingBind = errors.New("im-gateway host: wechat selected but no credentials")

// buildSpec is what transportBuilder consumes. Exactly one of Feishu /
// Wechat should be non-nil; both nil is an error.
type buildSpec struct {
	Feishu          *hostproto.FeishuConfig
	Wechat          *hostproto.WechatConfig
	WechatStatePath string // resolved absolute path; empty → use wechat package default

	// ConversationCwd is the host runtime's working directory for the
	// gateway. The wechat transport uses `<ConversationCwd>/inbox/` (well,
	// the directory itself per ADR-0006) as the destination for decrypted
	// inbound media. Empty disables inbound media handling.
	ConversationCwd string
}

// fromInit constructs a buildSpec from an InitFrame.
func specFromInit(f *hostproto.InitFrame) *buildSpec {
	s := &buildSpec{Feishu: f.Feishu, Wechat: f.Wechat, ConversationCwd: f.ConversationCwd}
	if s.Wechat != nil {
		s.WechatStatePath = s.Wechat.StatePath
	}
	return s
}

// fromConfigUpdate constructs a buildSpec from a ConfigUpdateFrame.
func specFromConfigUpdate(f *hostproto.ConfigUpdateFrame) *buildSpec {
	s := &buildSpec{Feishu: f.Feishu, Wechat: f.Wechat}
	if s.Wechat != nil {
		s.WechatStatePath = s.Wechat.StatePath
	}
	return s
}

// wechatBindCoordinator owns the lifecycle of an in-progress QR scan
// flow: at most one concurrent bind goroutine per coordinator. Events are
// emitted through the supplied hostproto.Writer; on success the
// credentials are persisted via the wechat package's CLI store helper and
// the rebuildCh is signalled so the main loop can construct and start the
// real wechat transport.
type wechatBindCoordinator struct {
	statePath string
	out       *hostproto.Writer
	emitLog   func(level, msg string, fields map[string]any)
	rebuildCh chan<- struct{}

	mu     sync.Mutex
	cancel context.CancelFunc
}

// newWechatBindCoordinator constructs a coordinator for the given state
// path. rebuildCh is non-buffered or buffered≥1 — the coordinator does a
// non-blocking send so a stalled main loop never wedges the bind flow.
func newWechatBindCoordinator(
	statePath string,
	out *hostproto.Writer,
	emitLog func(level, msg string, fields map[string]any),
	rebuildCh chan<- struct{},
) *wechatBindCoordinator {
	return &wechatBindCoordinator{
		statePath: statePath,
		out:       out,
		emitLog:   emitLog,
		rebuildCh: rebuildCh,
	}
}

// Start kicks off the bind flow in a background goroutine. Calling Start
// while a bind is already in progress is a no-op (the existing flow keeps
// running). Returns immediately.
func (c *wechatBindCoordinator) Start(ctx context.Context) {
	c.mu.Lock()
	if c.cancel != nil {
		c.mu.Unlock()
		c.emitLog("info", "wechat bind already in progress, ignoring duplicate start", nil)
		return
	}
	bindCtx, cancel := context.WithCancel(ctx)
	c.cancel = cancel
	c.mu.Unlock()

	go c.run(bindCtx)
}

// Cancel aborts an in-progress bind, if any. Idempotent.
func (c *wechatBindCoordinator) Cancel() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
}

// run is the bind state machine. Runs in its own goroutine.
func (c *wechatBindCoordinator) run(ctx context.Context) {
	defer func() {
		c.mu.Lock()
		c.cancel = nil
		c.mu.Unlock()
	}()

	client := ilink.New(ilink.Options{Logger: ilinkLogShim{c.emitLog}})

	c.emitLog("info", "wechat bind: generating QR", nil)
	code, err := client.GenerateQR(ctx)
	if err != nil {
		if ctx.Err() != nil {
			c.emitBindStatus(hostproto.WechatBindStatusCancelled, "")
			return
		}
		c.emitLog("error", "wechat bind: get QR failed", map[string]any{"err": err.Error()})
		c.emitBindStatus(hostproto.WechatBindStatusFailed, err.Error())
		return
	}
	c.emitQR(code.ImgContent, 1)

	attempt := 1
	res, err := client.WaitForBind(ctx, code, func(e ilink.BindEvent) {
		switch e.Status {
		case ilink.QRStatusScaned:
			c.emitBindStatus(hostproto.WechatBindStatusScanned, "")
		case ilink.QRStatusExpired:
			c.emitBindStatus(hostproto.WechatBindStatusExpired, "")
			if e.Refresh != nil {
				attempt++
				c.emitQR(e.Refresh.ImgContent, attempt)
			}
		case ilink.QRStatusScanedButRedirect:
			c.emitBindStatus(hostproto.WechatBindStatusRedirected, "")
		}
	})
	if err != nil {
		if errors.Is(err, context.Canceled) {
			c.emitBindStatus(hostproto.WechatBindStatusCancelled, "")
			return
		}
		c.emitLog("error", "wechat bind: WaitForBind failed", map[string]any{"err": err.Error()})
		c.emitBindStatus(hostproto.WechatBindStatusFailed, err.Error())
		return
	}

	// Persist credentials via the public CLI store helper. This writes the
	// same wechat.json that the wechat transport will load on next build.
	store, err := wechat.NewStateStoreForCLI(c.statePath)
	if err != nil {
		c.emitLog("error", "wechat bind: open state store failed", map[string]any{"err": err.Error()})
		c.emitBindStatus(hostproto.WechatBindStatusFailed, err.Error())
		return
	}
	if err := store.SetCredentials(res.Credentials); err != nil {
		c.emitLog("error", "wechat bind: persist credentials failed", map[string]any{"err": err.Error()})
		c.emitBindStatus(hostproto.WechatBindStatusFailed, err.Error())
		return
	}

	c.emitBindStatus(hostproto.WechatBindStatusConfirmed, "")
	_ = c.out.WriteFrame(hostproto.WechatBoundEvent{
		Type:        hostproto.TypeWechatBound,
		ILinkBotID:  res.Credentials.ILinkBotID,
		ILinkUserID: res.Credentials.ILinkUserID,
		BaseURL:     res.Credentials.BaseURL,
	})
	c.emitLog("info", "wechat bind confirmed", map[string]any{
		"bot_id": res.Credentials.ILinkBotID,
	})

	// Tell the main loop to (re)build the transport with the freshly
	// persisted credentials. Non-blocking so a busy main loop never
	// wedges the bind goroutine.
	select {
	case c.rebuildCh <- struct{}{}:
	default:
	}
}

func (c *wechatBindCoordinator) emitQR(url string, attempt int) {
	_ = c.out.WriteFrame(hostproto.WechatQREvent{
		Type:    hostproto.TypeWechatQR,
		URL:     url,
		Attempt: attempt,
	})
}

func (c *wechatBindCoordinator) emitBindStatus(status, errMsg string) {
	_ = c.out.WriteFrame(hostproto.WechatBindStatusEvent{
		Type:   hostproto.TypeWechatBindStatus,
		Status: status,
		Error:  errMsg,
	})
}

// LogoutAndClear cancels any in-progress bind and removes the persisted
// credentials. Emits a TypeWechatUnbound event so the parent updates its
// UI. Safe to call when nothing is bound — Clear is idempotent.
func (c *wechatBindCoordinator) LogoutAndClear(reason string) error {
	c.Cancel()
	store, err := wechat.NewStateStoreForCLI(c.statePath)
	if err != nil {
		return err
	}
	if err := store.Clear(); err != nil {
		return err
	}
	_ = c.out.WriteFrame(hostproto.WechatUnboundEvent{
		Type:   hostproto.TypeWechatUnbound,
		Reason: reason,
	})
	return nil
}

// ilinkLogShim adapts the host runtime's emitLog signature to the
// ilink.Logger interface. Lives here so the wechat bind code can plug
// into the same NDJSON log stream as the rest of the sidecar.
type ilinkLogShim struct {
	emitLog func(level, msg string, fields map[string]any)
}

func (s ilinkLogShim) Debug(msg string, fields ...any) { s.emit("debug", msg, fields) }
func (s ilinkLogShim) Info(msg string, fields ...any)  { s.emit("info", msg, fields) }
func (s ilinkLogShim) Warn(msg string, fields ...any)  { s.emit("warn", msg, fields) }
func (s ilinkLogShim) Error(msg string, fields ...any) { s.emit("error", msg, fields) }

// emit folds the variadic field pairs into a map[string]any so the host
// runtime's structured-log helper can process them like any other event.
// Pairs missing a value are silently dropped (defensive — ilink callers
// always pass even pairs).
func (s ilinkLogShim) emit(level, msg string, fields []any) {
	if s.emitLog == nil {
		return
	}
	if len(fields) == 0 {
		s.emitLog(level, msg, nil)
		return
	}
	m := make(map[string]any, len(fields)/2)
	for i := 0; i+1 < len(fields); i += 2 {
		key, ok := fields[i].(string)
		if !ok {
			continue
		}
		m[key] = fields[i+1]
	}
	s.emitLog(level, msg, m)
}
