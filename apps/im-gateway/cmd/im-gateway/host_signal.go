package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"vetta-im-gateway/internal/hostproto"
	signalcli "vetta-im-gateway/internal/transport/signal"
)

// accountLookupTimeout bounds the `signal-cli listAccounts` probe used to
// decide between "linked" and awaiting_bind. signal-cli on a JVM is slow to
// start but this is a single short-lived command.
const accountLookupTimeout = 30 * time.Second

// signalDeviceName is what shows up in Signal → Settings → Linked devices.
const signalDeviceName = "Vetta"

// signalManaged reports whether the slot asks the sidecar to run signal-cli
// itself. An explicit Endpoint means the user runs their own daemon and we
// stay out of its lifecycle.
func signalManaged(cfg *hostproto.SignalConfig) bool {
	return cfg != nil && cfg.Endpoint == ""
}

// signalCLIOptions lifts the CLI locator out of the config slot.
func signalCLIOptions(cfg *hostproto.SignalConfig) signalcli.CLIOptions {
	return signalcli.CLIOptions{Path: cfg.CLIPath, ConfigDir: cfg.ConfigDir}
}

// resolveSignalAccount determines which number the transport should send as.
//
// An account configured by the parent wins. Otherwise (managed mode) we ask
// signal-cli what it has linked: exactly the step the user used to perform
// by hand and paste into settings. No account yet → errAwaitingBind, which
// parks the sidecar until the parent drives a link flow.
func resolveSignalAccount(cfg *hostproto.SignalConfig) (string, error) {
	if cfg.Account != "" {
		return cfg.Account, nil
	}
	if !signalManaged(cfg) {
		return "", errors.New("signal config missing account")
	}
	ctx, cancel := context.WithTimeout(context.Background(), accountLookupTimeout)
	defer cancel()
	accounts, err := signalcli.ListAccounts(ctx, signalCLIOptions(cfg))
	if err != nil {
		if errors.Is(err, signalcli.ErrCLINotFound) {
			return "", fmt.Errorf("%w（安装后重试：%s）", err, signalcli.InstallHint())
		}
		return "", err
	}
	if len(accounts) == 0 {
		return "", errAwaitingBind
	}
	return accounts[0], nil
}

// signalBindCoordinator owns at most one in-progress `signal-cli link`
// flow, mirroring wechatBindCoordinator: QR and status transitions go out
// as hostproto events, and a successful link signals rebuildCh so the main
// loop can build the real transport.
type signalBindCoordinator struct {
	cfg       *hostproto.SignalConfig
	out       *hostproto.Writer
	emitLog   func(level, msg string, fields map[string]any)
	rebuildCh chan<- struct{}

	mu     sync.Mutex
	cancel context.CancelFunc
}

func newSignalBindCoordinator(
	cfg *hostproto.SignalConfig,
	out *hostproto.Writer,
	emitLog func(level, msg string, fields map[string]any),
	rebuildCh chan<- struct{},
) *signalBindCoordinator {
	return &signalBindCoordinator{cfg: cfg, out: out, emitLog: emitLog, rebuildCh: rebuildCh}
}

// Start kicks off the link flow in a background goroutine. A flow already
// in progress is left running.
func (c *signalBindCoordinator) Start(ctx context.Context) {
	c.mu.Lock()
	if c.cancel != nil {
		c.mu.Unlock()
		c.emitLog("info", "signal link already in progress, ignoring duplicate start", nil)
		return
	}
	bindCtx, cancel := context.WithCancel(ctx)
	c.cancel = cancel
	c.mu.Unlock()

	go c.run(bindCtx)
}

// Cancel aborts an in-progress link, if any. Idempotent.
func (c *signalBindCoordinator) Cancel() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
}

// run drives `signal-cli link` to completion.
func (c *signalBindCoordinator) run(ctx context.Context) {
	defer func() {
		c.mu.Lock()
		c.cancel = nil
		c.mu.Unlock()
	}()

	attempt := 0
	c.emitLog("info", "signal link: starting", map[string]any{"configDir": c.cfg.ConfigDir})
	account, err := signalcli.Link(ctx, signalCLIOptions(c.cfg), signalDeviceName, func(uri string) {
		attempt++
		_ = c.out.WriteFrame(hostproto.SignalQREvent{
			Type:    hostproto.TypeSignalQR,
			URI:     uri,
			Attempt: attempt,
		})
	})
	if err != nil {
		switch {
		case errors.Is(err, context.Canceled):
			c.emitBindStatus(hostproto.WechatBindStatusCancelled, "")
		case errors.Is(err, signalcli.ErrCLINotFound):
			msg := fmt.Sprintf("%v（安装后重试：%s）", err, signalcli.InstallHint())
			c.emitLog("error", "signal link failed", map[string]any{"err": msg})
			c.emitBindStatus(hostproto.WechatBindStatusFailed, msg)
		case errors.Is(err, signalcli.ErrNoLinkURI):
			// signal-cli never got far enough to produce a code: it could
			// not reach the Signal servers. Say that, instead of leaving
			// the user staring at "exit status 1".
			msg := fmt.Sprintf("signal-cli 无法连接 Signal 服务器，未能生成关联二维码。请检查网络或代理设置后重试。（%v）", err)
			c.emitLog("error", "signal link failed: no device-link URI", map[string]any{"err": err.Error()})
			c.emitBindStatus(hostproto.WechatBindStatusFailed, msg)
		default:
			c.emitLog("error", "signal link failed", map[string]any{"err": err.Error()})
			c.emitBindStatus(hostproto.WechatBindStatusFailed, err.Error())
		}
		return
	}

	// signal-cli persisted the linked device itself; the transport picks it
	// up on the next build via listAccounts.
	c.cfg.Account = account
	c.emitBindStatus(hostproto.WechatBindStatusConfirmed, "")
	_ = c.out.WriteFrame(hostproto.SignalBoundEvent{
		Type:    hostproto.TypeSignalBound,
		Account: account,
	})
	c.emitLog("info", "signal link confirmed", map[string]any{"account": account})

	select {
	case c.rebuildCh <- struct{}{}:
	default:
	}
}

func (c *signalBindCoordinator) emitBindStatus(status, errMsg string) {
	_ = c.out.WriteFrame(hostproto.SignalBindStatusEvent{
		Type:   hostproto.TypeSignalBindStatus,
		Status: status,
		Error:  errMsg,
	})
}

// LogoutAndClear cancels any in-progress link and drops the local Signal
// registration so the next start goes back to awaiting_bind.
//
// The account data is only deleted when the config directory belongs to us
// (OwnsConfigDir — the desktop app creates a Vetta-private signal-cli
// directory). Pointed at a directory the user manages themselves, we merely
// stop using it: wiping someone's own signal-cli install because they
// clicked "unbind" in Vetta would be destructive far beyond this app.
func (c *signalBindCoordinator) LogoutAndClear(reason string) error {
	c.Cancel()
	if c.cfg.OwnsConfigDir && c.cfg.ConfigDir != "" {
		if err := os.RemoveAll(c.cfg.ConfigDir); err != nil {
			return fmt.Errorf("signal logout: clear %s: %w", c.cfg.ConfigDir, err)
		}
		c.emitLog("info", "signal logout: cleared local account data", map[string]any{"configDir": c.cfg.ConfigDir})
	} else {
		c.emitLog("info", "signal logout: leaving user-managed signal-cli data untouched", nil)
	}
	c.cfg.Account = ""
	_ = c.out.WriteFrame(hostproto.SignalUnboundEvent{
		Type:   hostproto.TypeSignalUnbound,
		Reason: reason,
	})
	return nil
}
