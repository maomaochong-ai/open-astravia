package main

import (
	"context"
	"sync"

	"astravia-im-gateway/internal/hostproto"
	"astravia-im-gateway/internal/transport/whatsapp"
)

// whatsappBindCoordinator drives the WhatsApp QR pairing flow for the host
// runtime: at most one scan goroutine at a time, events emitted as NDJSON
// frames, and a rebuild signal once the session is persisted.
//
// Mirrors wechatBindCoordinator on purpose — both are "scan this code with
// your phone" channels, so the parent's bind dialog is the same shape. The
// difference is where the session lands: WhatsApp keeps it in whatsmeow's
// sqlite store at StatePath, which PairQR writes itself, so there is no
// separate credential file to save.
type whatsappBindCoordinator struct {
	out       *hostproto.Writer
	emitLog   func(level, msg string, fields map[string]any)
	rebuildCh chan<- struct{}

	mu        sync.Mutex
	statePath string
	allowed   []string
	cancel    context.CancelFunc
}

// Compile-time check: the host runtime drives coordinators through this
// interface only.
var _ bindCoordinator = (*whatsappBindCoordinator)(nil)

func newWhatsappBindCoordinator(
	statePath string,
	allowed []string,
	out *hostproto.Writer,
	emitLog func(level, msg string, fields map[string]any),
	rebuildCh chan<- struct{},
) *whatsappBindCoordinator {
	return &whatsappBindCoordinator{
		out:       out,
		emitLog:   emitLog,
		rebuildCh: rebuildCh,
		statePath: statePath,
		allowed:   allowed,
	}
}

// Adopt picks up the state path / allow-list from the latest config_update.
func (c *whatsappBindCoordinator) Adopt(spec *buildSpec) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.statePath = spec.WhatsappStatePath
	if spec.Whatsapp != nil {
		c.allowed = spec.Whatsapp.AllowedNumbers
	}
}

// Start kicks off the pairing flow. A second Start while a flow is running is
// a no-op: reconnecting mid-scan would invalidate the code already on screen.
func (c *whatsappBindCoordinator) Start(ctx context.Context) {
	c.mu.Lock()
	if c.cancel != nil {
		c.mu.Unlock()
		c.emitLog("info", "whatsapp bind already in progress, ignoring duplicate start", nil)
		return
	}
	bindCtx, cancel := context.WithCancel(ctx)
	c.cancel = cancel
	c.mu.Unlock()

	go c.run(bindCtx)
}

// Cancel aborts an in-progress pairing, if any. Idempotent.
func (c *whatsappBindCoordinator) Cancel() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
}

func (c *whatsappBindCoordinator) run(ctx context.Context) {
	defer func() {
		c.mu.Lock()
		c.cancel = nil
		c.mu.Unlock()
	}()

	c.mu.Lock()
	statePath := c.statePath
	allowed := c.allowed
	c.mu.Unlock()

	if statePath == "" {
		c.emitLog("error", "whatsapp bind: state path is empty", nil)
		c.emitBindStatus(hostproto.WechatBindStatusFailed, "whatsapp state path not configured")
		return
	}

	tr, err := whatsapp.New(whatsapp.Options{StatePath: statePath, AllowedNumbers: allowed})
	if err != nil {
		if ctx.Err() != nil {
			c.emitBindStatus(hostproto.WechatBindStatusCancelled, "")
			return
		}
		c.emitLog("error", "whatsapp bind: open store failed", map[string]any{"err": err.Error()})
		c.emitBindStatus(hostproto.WechatBindStatusFailed, err.Error())
		return
	}
	// The pairing transport is throwaway: once the session is in the store the
	// host rebuilds a real one, and two clients cannot share the sqlite store —
	// on Windows a still-open handle makes the second open fail outright, so this
	// must be Close (Stop leaves the sqlite handle alive).
	defer func() { _ = tr.Close() }()

	// Log before the call: GetQRChannel + Connect blocks until the websocket
	// handshake finishes, so a silent gap here means "cannot reach WhatsApp",
	// not "no QR produced".
	c.emitLog("info", "whatsapp bind: opening pairing channel", nil)
	events, err := tr.PairQR(ctx)
	if err != nil {
		if ctx.Err() != nil {
			c.emitBindStatus(hostproto.WechatBindStatusCancelled, "")
			return
		}
		c.emitLog("error", "whatsapp bind: start pairing failed", map[string]any{"err": err.Error()})
		c.emitBindStatus(hostproto.WechatBindStatusFailed, err.Error())
		return
	}

	c.emitLog("info", "whatsapp bind: waiting for scan", nil)
	attempt := 0
	for ev := range events {
		switch {
		case ev.QRCode != "":
			// A new code after the first means the previous one expired; tell
			// the dialog so it can say "refreshed" instead of silently swapping
			// the image under the user's phone camera.
			if attempt > 0 {
				c.emitBindStatus(hostproto.WechatBindStatusExpired, "")
			}
			attempt++
			c.emitQR(ev.QRCode, attempt)

		case ev.Done:
			jid := tr.PairedJID()
			c.emitBindStatus(hostproto.WechatBindStatusConfirmed, "")
			_ = c.out.WriteFrame(hostproto.WhatsappBoundEvent{
				Type: hostproto.TypeWhatsappBound,
				JID:  jid,
			})
			c.emitLog("info", "whatsapp bind confirmed", map[string]any{"jid": jid})
			// Non-blocking: a busy main loop must never wedge the bind goroutine.
			select {
			case c.rebuildCh <- struct{}{}:
			default:
			}
			return

		case ev.Err != nil:
			if ctx.Err() != nil {
				c.emitBindStatus(hostproto.WechatBindStatusCancelled, "")
				return
			}
			c.emitLog("error", "whatsapp bind failed", map[string]any{"err": ev.Err.Error()})
			c.emitBindStatus(hostproto.WechatBindStatusFailed, ev.Err.Error())
			return
		}
	}

	// Channel closed with no terminal event: whatsmeow gave up (timeout or a
	// server-side rejection) without us seeing an explicit error.
	if ctx.Err() != nil {
		c.emitBindStatus(hostproto.WechatBindStatusCancelled, "")
		return
	}
	c.emitBindStatus(hostproto.WechatBindStatusFailed, "whatsapp pairing ended without a result")
}

// LogoutAndClear unlinks the paired device and wipes the local session.
//
// whatsmeow keeps the session in the sqlite store, so "clear" means asking the
// server to unlink first (otherwise the phone still lists this device) and then
// dropping the store: we reopen with a fresh StatePath only if the unlink
// failed, which keeps the failure visible instead of faking a clean logout.
func (c *whatsappBindCoordinator) LogoutAndClear(reason string) error {
	c.Cancel()

	c.mu.Lock()
	statePath := c.statePath
	c.mu.Unlock()

	if statePath != "" {
		if tr, err := whatsapp.New(whatsapp.Options{StatePath: statePath}); err == nil {
			if logoutErr := tr.Logout(context.Background()); logoutErr != nil {
				c.emitLog("warn", "whatsapp logout: server unlink failed", map[string]any{"err": logoutErr.Error()})
			}
			_ = tr.Close()
		}
	}

	_ = c.out.WriteFrame(hostproto.WhatsappUnboundEvent{
		Type:   hostproto.TypeWhatsappUnbound,
		Reason: reason,
	})
	return nil
}

func (c *whatsappBindCoordinator) emitQR(code string, attempt int) {
	_ = c.out.WriteFrame(hostproto.WhatsappQREvent{
		Type:    hostproto.TypeWhatsappQR,
		Code:    code,
		Attempt: attempt,
	})
}

func (c *whatsappBindCoordinator) emitBindStatus(status, errMsg string) {
	_ = c.out.WriteFrame(hostproto.WhatsappBindStatusEvent{
		Type:   hostproto.TypeWhatsappBindStatus,
		Status: status,
		Error:  errMsg,
	})
}
