package main

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"vetta-im-gateway/internal/hostproto"
	"vetta-im-gateway/internal/transport/feishu"
)

// registerSource tags the QR URL so the platform can attribute apps
// created through this gateway.
const feishuRegisterSource = "vetta-im-gateway"

// feishuBotName / feishuBotDesc pre-fill the app-creation page. Both
// support the platform's "{user}" placeholder, which the page expands to
// the scanning user's name.
const (
	feishuBotName = "Vetta"
	feishuBotDesc = "Vetta 编程助手，在飞书私聊里直接和你的项目对话。"
)

// feishuInboundEvent is the single event the bridge lives on: a private
// message addressed to the bot.
const feishuInboundEvent = "im.message.receive_v1"

// feishuRegisterAddons is the configuration pre-filled into the page the
// user confirms after scanning: it replaces the manual scope-ticking and
// event subscription in the developer console.
//
// The declarations layer on top of the platform's default template rather
// than replacing it (no preset=false). Dropping the template left apps
// whose bot was reachable but whose event subscription was never
// established, which presents as a bot that reads and ignores you.
//
//   - im:message / im:message:send_as_bot / im:message.p2p_msg — read and
//     send private-chat messages, recall its own message
//   - im:resource — upload outbound images/files and download inbound ones
//   - cardkit:card:write — the streaming card used for assistant output
//   - application:application:patch — lets the app state its own event
//     subscription right after the scan; see feishuBindCoordinator.run.
func feishuRegisterAddons() *feishu.RegisterAddons {
	return &feishu.RegisterAddons{
		Scopes: &feishu.RegisterScopes{
			Tenant: []string{
				"im:message",
				"im:message:send_as_bot",
				"im:message.p2p_msg",
				"im:resource",
				"cardkit:card:write",
				"application:application:patch",
			},
		},
		Events: &feishu.RegisterEvents{
			Items: &feishu.RegisterEventItems{
				Tenant: []string{feishuInboundEvent},
			},
		},
	}
}

// larkOpenBaseURL is the international API host, pinned on the config
// when the registration happened inside a Lark tenant.
const larkOpenBaseURL = "https://open.larksuite.com"

// feishuBindCoordinator owns at most one in-progress one-click app
// registration, mirroring the wechat / signal coordinators: the QR URL and
// status transitions go out as hostproto events, and a successful
// registration signals rebuildCh so the main loop builds the real
// transport with the freshly minted credentials.
//
// Unlike the other channels the sidecar persists nothing: the credentials
// belong to the parent's credential store, so they travel back in a
// feishu_bound event and are only held in cfg for the lifetime of this
// process.
type feishuBindCoordinator struct {
	cfg       *hostproto.FeishuConfig
	out       *hostproto.Writer
	emitLog   func(level, msg string, fields map[string]any)
	rebuildCh chan<- struct{}

	mu     sync.Mutex
	cancel context.CancelFunc
	// pendingSync is set by a successful registration and consumed by
	// SyncAfterBind once the rebuilt transport is live.
	pendingSync bool
}

func newFeishuBindCoordinator(
	cfg *hostproto.FeishuConfig,
	out *hostproto.Writer,
	emitLog func(level, msg string, fields map[string]any),
	rebuildCh chan<- struct{},
) *feishuBindCoordinator {
	return &feishuBindCoordinator{cfg: cfg, out: out, emitLog: emitLog, rebuildCh: rebuildCh}
}

// Adopt picks up the feishu slot from the latest config_update, so a scan
// that finishes afterwards writes its credentials where the next transport
// build will read them.
func (c *feishuBindCoordinator) Adopt(spec *buildSpec) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if spec.Feishu != nil {
		c.cfg = spec.Feishu
	}
}

// Start kicks off the registration flow in a background goroutine. A flow
// already in progress is left running.
func (c *feishuBindCoordinator) Start(ctx context.Context) {
	c.mu.Lock()
	if c.cancel != nil {
		c.mu.Unlock()
		c.emitLog("info", "feishu registration already in progress, ignoring duplicate start", nil)
		return
	}
	bindCtx, cancel := context.WithCancel(ctx)
	c.cancel = cancel
	c.mu.Unlock()

	go c.run(bindCtx)
}

// Cancel aborts an in-progress registration, if any. Idempotent.
func (c *feishuBindCoordinator) Cancel() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
}

func (c *feishuBindCoordinator) run(ctx context.Context) {
	defer func() {
		c.mu.Lock()
		c.cancel = nil
		c.mu.Unlock()
	}()

	attempt := 0
	c.emitLog("info", "feishu registration: starting", nil)
	result, err := feishu.Register(ctx, feishu.RegisterOptions{
		Domain: c.cfg.AccountsDomain,
		Source: feishuRegisterSource,
		Addons: feishuRegisterAddons(),
		AppPreset: &feishu.RegisterAppPreset{
			Name: feishuBotName,
			Desc: feishuBotDesc,
		},
		// Binding an app the user already uses elsewhere would rewrite its
		// configuration; the scan flow here always mints a new one.
		CreateOnly: true,
		OnQRCode: func(qr feishu.RegisterQRCode) {
			attempt++
			_ = c.out.WriteFrame(hostproto.FeishuQREvent{
				Type:     hostproto.TypeFeishuQR,
				URL:      qr.URL,
				ExpireIn: qr.ExpireIn,
				Attempt:  attempt,
			})
		},
		OnStatus: func(status string) {
			if status == feishu.RegisterStatusSlowDown || status == feishu.RegisterStatusDomainSwitched {
				c.emitLog("info", "feishu registration: "+status, nil)
			}
		},
	})
	if err != nil {
		c.reportFailure(err)
		return
	}

	// Credentials stay in memory here and are persisted by the parent.
	c.cfg.AppID = result.AppID
	c.cfg.AppSecret = result.AppSecret
	// An app minted inside a Lark tenant lives on the international API
	// host; without this the rebuilt transport would call open.feishu.cn
	// with credentials it does not know.
	if result.TenantBrand == "lark" && c.cfg.BaseURL == "" {
		c.cfg.BaseURL = larkOpenBaseURL
	}
	c.emitBindStatus(hostproto.WechatBindStatusConfirmed, "")
	_ = c.out.WriteFrame(hostproto.FeishuBoundEvent{
		Type:        hostproto.TypeFeishuBound,
		AppID:       result.AppID,
		AppSecret:   result.AppSecret,
		TenantBrand: result.TenantBrand,
		OpenID:      result.OpenID,
	})
	c.emitLog("info", "feishu registration confirmed", map[string]any{
		"appId":       result.AppID,
		"tenantBrand": result.TenantBrand,
	})

	c.mu.Lock()
	c.pendingSync = true
	c.mu.Unlock()

	select {
	case c.rebuildCh <- struct{}{}:
	default:
	}
}

// SyncAfterBind states the app's event subscription explicitly, right
// after a scan-created app has come online.
//
// The registration URL cannot carry the delivery mode, so an app can come
// out of the scan reachable but never subscribed — the transport connects,
// reports "online", and no message ever arrives. This closes that gap. It
// has to run *after* the transport is up: the platform only accepts the
// long-connection subscription while such a connection is actually live.
//
// Only a registration this process just completed is repaired; credentials
// the user typed in by hand belong to an app they configured themselves,
// and rewriting its subscription behind their back would be presumptuous.
func (c *feishuBindCoordinator) SyncAfterBind(ctx context.Context) {
	c.mu.Lock()
	pending := c.pendingSync
	c.pendingSync = false
	appID, appSecret, baseURL := c.cfg.AppID, c.cfg.AppSecret, c.cfg.BaseURL
	c.mu.Unlock()
	if !pending || appID == "" {
		return
	}

	err := feishu.EnsureWebsocketEvents(ctx, feishu.AppConfigOptions{
		AppID:     appID,
		AppSecret: appSecret,
		Domain:    baseURL,
		Events:    []string{feishuInboundEvent},
	})
	if err == nil {
		c.emitLog("info", "feishu event subscription confirmed", map[string]any{"appId": appID})
		return
	}
	// A failure here does not break the connection that is already up, so
	// it is reported rather than fatal: the user can finish the one
	// remaining switch by hand.
	c.emitLog("warn", "feishu event subscription could not be set automatically", map[string]any{
		"appId": appID,
		"err":   err.Error(),
	})
	c.emitBindStatus(hostproto.WechatBindStatusFailed, feishuSubscriptionHint(err))
}

// feishuSubscriptionHint turns the platform's refusal into the one action
// the user can take about it.
func feishuSubscriptionHint(err error) string {
	var apiErr *feishu.APIError
	if errors.As(err, &apiErr) {
		return fmt.Sprintf(
			"机器人已创建，但自动开启「接收消息」失败（%s）。请到飞书开放平台的应用「事件订阅」里选择长连接、添加 im.message.receive_v1 并发布一次版本。",
			apiErr.Msg,
		)
	}
	return "机器人已创建，但自动开启「接收消息」失败。请到飞书开放平台的应用「事件订阅」里选择长连接、添加 im.message.receive_v1 并发布一次版本。"
}

// reportFailure maps a registration error onto the bind status the parent
// renders. Cancellation is a user action, not a failure.
func (c *feishuBindCoordinator) reportFailure(err error) {
	if errors.Is(err, context.Canceled) {
		c.emitBindStatus(hostproto.WechatBindStatusCancelled, "")
		return
	}
	var regErr *feishu.RegisterError
	if errors.As(err, &regErr) {
		switch regErr.Code {
		case feishu.RegisterErrAccessDenied:
			c.emitLog("info", "feishu registration denied by user", nil)
			c.emitBindStatus(hostproto.WechatBindStatusFailed, "授权被拒绝，可重新扫码。")
			return
		case feishu.RegisterErrExpiredToken:
			c.emitLog("info", "feishu registration expired", nil)
			c.emitBindStatus(hostproto.WechatBindStatusExpired, "")
			return
		}
	}
	c.emitLog("error", "feishu registration failed", map[string]any{"err": err.Error()})
	c.emitBindStatus(hostproto.WechatBindStatusFailed, err.Error())
}

func (c *feishuBindCoordinator) emitBindStatus(status, errMsg string) {
	_ = c.out.WriteFrame(hostproto.FeishuBindStatusEvent{
		Type:   hostproto.TypeFeishuBindStatus,
		Status: status,
		Error:  errMsg,
	})
}

// LogoutAndClear cancels any in-progress registration and drops the
// in-memory credentials so the next build parks in awaiting_bind.
//
// The app itself is left alone on the Feishu Open Platform: only its owner
// can delete it there, and a user who unbinds in Vetta may well want to
// keep (or re-enter) the same app later.
func (c *feishuBindCoordinator) LogoutAndClear(reason string) error {
	c.Cancel()
	c.mu.Lock()
	c.pendingSync = false
	c.mu.Unlock()
	c.cfg.AppID = ""
	c.cfg.AppSecret = ""
	_ = c.out.WriteFrame(hostproto.FeishuUnboundEvent{
		Type:   hostproto.TypeFeishuUnbound,
		Reason: reason,
	})
	c.emitLog("info", "feishu credentials dropped", map[string]any{"reason": reason})
	return nil
}
