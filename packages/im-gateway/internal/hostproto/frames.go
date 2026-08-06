package hostproto

import (
	"encoding/json"
	"fmt"
	"time"
)

// Frame type discriminators. Strings are the wire format.
const (
	// Inbound (parent → child)
	TypeInit            = "init"
	TypeConfigUpdate    = "config_update"
	TypeShutdown        = "shutdown"
	TypeWechatBindStart = "wechat_bind_start"
	TypeWechatLogout    = "wechat_logout"

	// Outbound (child → parent)
	TypeReady            = "ready"
	TypeLog              = "log"
	TypeStatus           = "status"
	TypeStatePatch       = "state_patch"
	TypeMetric           = "metric"
	TypeWechatQR         = "wechat_qr"
	TypeWechatBindStatus = "wechat_bind_status"
	TypeWechatBound      = "wechat_bound"
	TypeWechatUnbound    = "wechat_unbound"
)

// Transport status values reported on TypeStatus events.
//
// TransportStatusAwaitingBind is wechat-specific: the sidecar is up and the
// wechat config slot is selected, but no credentials exist on disk yet so
// no transport is running. The parent should drive the bind flow via
// TypeWechatBindStart.
const (
	TransportStatusOffline      = "offline"
	TransportStatusConnecting   = "connecting"
	TransportStatusOnline       = "online"
	TransportStatusError        = "error"
	TransportStatusAwaitingBind = "awaiting_bind"
)

// FeishuConfig carries the credentials and options needed to spin up a
// feishu transport. Mirrors the configuration the parent persists in its
// own credential store.
type FeishuConfig struct {
	AppID             string `json:"appId"`
	AppSecret         string `json:"appSecret"`
	VerificationToken string `json:"verificationToken,omitempty"`
	EncryptKey        string `json:"encryptKey,omitempty"`
	BaseURL           string `json:"baseUrl,omitempty"`
}

// WechatConfig is the (small) wechat slot in InitFrame. Unlike feishu,
// wechat has NO long-lived credentials in the protocol — the bot_token is
// obtained dynamically via the QR scan flow and persisted by the sidecar
// itself in StatePath. This struct only carries:
//
//   - the runtime flag (Enabled) so the host knows to select wechat as
//     the active transport;
//   - the absolute path to the persistent state file (so the parent can
//     keep that file alongside its other vetta data and override the
//     ~/.vetta/im-gateway/wechat.json default).
type WechatConfig struct {
	Enabled   bool   `json:"enabled"`
	StatePath string `json:"statePath,omitempty"`
}

// SessionStateEntry mirrors a single (im_user, chatID) routing entry.
type SessionStateEntry struct {
	UserID      string    `json:"userId"`
	ChatID      string    `json:"chatId"`
	SessionPath string    `json:"sessionPath,omitempty"`
	UpdatedAt   time.Time `json:"updatedAt,omitzero"`
}

// InitFrame is the first frame the parent must send after spawn. The sidecar
// blocks for up to 10s waiting for it; absence triggers a non-zero exit.
//
// ConversationCwd is the absolute cwd of desktop-app's virtual "对话" project
// (DEFAULT_CONVERSATION_CWD in fs.ts). All IM sessions live under this cwd;
// the gateway no longer carries a project list.
//
// The active transport is determined by which sub-config is non-nil:
//
//   - Feishu non-nil → run the feishu transport with these credentials
//   - Wechat non-nil with Enabled=true → run the wechat transport. Sidecar
//     loads credentials from Wechat.StatePath; if missing, sidecar enters
//     awaiting_bind state and waits for a TypeWechatBindStart frame.
//
// Exactly one of Feishu / Wechat should be non-nil for a configured run;
// neither yields the legacy "fall back to mock" behavior used in tests.
type InitFrame struct {
	Type            string              `json:"type"` // always TypeInit
	Feishu          *FeishuConfig       `json:"feishu,omitempty"`
	Wechat          *WechatConfig       `json:"wechat,omitempty"`
	ConversationCwd string              `json:"conversationCwd"`
	State           []SessionStateEntry `json:"state"`
	LogLevel        string              `json:"logLevel,omitempty"` // debug|info|warn|error
	// CodingAgent overrides how the sidecar invokes the coding-agent
	// subprocess for IM sessions. When omitted, the sidecar falls back to
	// looking up `vetta` on PATH — fine for dev (where `bun link` puts it
	// there) but broken in production where the Vetta.app bundle does not
	// install a global CLI. Desktop-app's host runtime populates this with
	// the Vetta.app executable path + the `--agent-rpc` discriminator so
	// the spawned Electron process short-circuits into coding-agent's main.
	CodingAgent *CodingAgentSpec `json:"codingAgent,omitempty"`
}

// CodingAgentSpec describes the executable the sidecar should spawn for
// each IM-session coding-agent subprocess. The final argv is:
//
//	[Bin, PrefixArgs..., "--mode", "rpc", "--cwd", <cwd>, ...]
//
// PrefixArgs is where the parent stuffs e.g. `--agent-rpc` (to switch
// Vetta.app into CLI mode) or, in dev, the Electron main-entry path.
type CodingAgentSpec struct {
	Bin        string   `json:"bin"`
	PrefixArgs []string `json:"prefixArgs,omitempty"`
	// RunAsNode, when true, asks the sidecar to set ELECTRON_RUN_AS_NODE=1
	// before spawning Bin. Windows packaged desktop builds use this to run
	// the Electron executable as a Node runtime for coding-agent's CLI,
	// because the normal GUI mode closes stdio before RPC can handshake.
	RunAsNode bool `json:"runAsNode,omitempty"`
	// PackageDir, when non-empty, is forwarded to the spawned subprocess
	// as the `VETTA_PACKAGE_DIR` environment variable. The agent's
	// `getPackageDir()` defaults to walking up `__dirname` to find
	// `package.json` — which lands on the host bundle when coding-agent is
	// Vite-bundled into Electron's main process. Setting this explicitly
	// points at the staged assets dir so theme / template lookups
	// resolve correctly.
	PackageDir string `json:"packageDir,omitempty"`
	// ServerURL, when non-empty, is forwarded to the spawned subprocess as
	// the `VETTA_SERVER_URL` environment variable. coding-agent's main.ts
	// otherwise reads serverUrl from `~/.vetta/agent/settings.json`, which
	// may carry a stale LAN address (test env / fresh dev login residue)
	// that produces 401 on the prod gateway. With this env present the
	// agent ignores the settings residue and uses the host-injected URL.
	// Desktop-app populates it with its compile-time DEFAULT_SERVER_URL so
	// IM-session subprocesses talk to the same gateway the GUI does.
	ServerURL string `json:"serverUrl,omitempty"`
}

// ConfigUpdateFrame replaces the active credentials and/or switches the
// active transport. Triggers a reconnect because the underlying clients
// cannot swap creds in flight. Same nil-discriminator rule as InitFrame.
type ConfigUpdateFrame struct {
	Type   string        `json:"type"` // always TypeConfigUpdate
	Feishu *FeishuConfig `json:"feishu,omitempty"`
	Wechat *WechatConfig `json:"wechat,omitempty"`
}

// ShutdownFrame requests graceful shutdown. Equivalent semantics to closing
// stdin.
type ShutdownFrame struct {
	Type string `json:"type"` // always TypeShutdown
}

// WechatBindStartFrame requests the sidecar begin (or restart) a wechat QR
// scan flow. Has no payload — the sidecar already knows the StatePath from
// the most recent InitFrame / ConfigUpdateFrame. Issuing this while a bind
// is in progress is a no-op (the existing flow continues).
type WechatBindStartFrame struct {
	Type string `json:"type"` // always TypeWechatBindStart
}

// WechatLogoutFrame requests the sidecar drop the persisted wechat
// credentials, stop any running wechat transport, and re-enter
// awaiting_bind state. The next TypeWechatBindStart frame can then start
// a fresh bind.
type WechatLogoutFrame struct {
	Type string `json:"type"` // always TypeWechatLogout
}

// ReadyEvent is the first frame the sidecar emits after init succeeds and
// the transport has been started. Indicates the parent may begin sending
// runtime updates.
type ReadyEvent struct {
	Type      string `json:"type"` // always TypeReady
	Version   string `json:"version"`
	Transport string `json:"transport"`
}

// LogEvent is a structured log line. Replaces file-based logging in host
// mode; the parent forwards these to its own log buffer / file sink.
type LogEvent struct {
	Type   string         `json:"type"` // always TypeLog
	Level  string         `json:"level"`
	Msg    string         `json:"msg"`
	Fields map[string]any `json:"fields,omitempty"`
	Time   time.Time      `json:"time"`
}

// StatusEvent reports transport connectivity. Sent on every state change.
type StatusEvent struct {
	Type      string    `json:"type"` // always TypeStatus
	Transport string    `json:"transport"`
	LastError string    `json:"lastError,omitempty"`
	Time      time.Time `json:"time"`
}

// StatePatchEvent reports a routing-table mutation. Parent persists the
// patch to its own state file.
type StatePatchEvent struct {
	Type   string `json:"type"` // always TypeStatePatch
	UserID string `json:"userId"`
	ChatID string `json:"chatId"`
	// SessionPath empty means "delete this entry". Non-empty means upsert.
	SessionPath string    `json:"sessionPath"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// MetricEvent is a generic numeric metric (active session count, etc).
type MetricEvent struct {
	Type  string  `json:"type"` // always TypeMetric
	Name  string  `json:"name"`
	Value float64 `json:"value"`
}

// WechatQREvent carries one QR code for the parent to render. Url is the
// raw URL string the iLink server returned; the parent renders it as a
// scannable QR image (typically via the `qrcode` npm package). Attempt is
// 1-indexed and increments on each refresh after a previous expiration.
type WechatQREvent struct {
	Type    string `json:"type"` // always TypeWechatQR
	URL     string `json:"url"`
	Attempt int    `json:"attempt"`
}

// WechatBindStatusEvent reports a transition in the bind state machine.
// Status is one of WechatBindStatus*. Error is populated only when Status
// is WechatBindStatusFailed.
type WechatBindStatusEvent struct {
	Type   string `json:"type"` // always TypeWechatBindStatus
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

// WechatBoundEvent reports a successful bind. Emitted exactly once per
// bind, after WechatBindStatusEvent{confirmed} and after the credentials
// have been persisted to disk. The parent should treat receipt of this
// event as the cue to update its UI to "bound".
type WechatBoundEvent struct {
	Type        string `json:"type"` // always TypeWechatBound
	ILinkBotID  string `json:"ilink_bot_id"`
	ILinkUserID string `json:"ilink_user_id,omitempty"`
	BaseURL     string `json:"base_url,omitempty"`
}

// WechatUnboundEvent reports that credentials have been cleared (either by
// an explicit logout frame or by a server-side -14 expiry). After this
// event the sidecar is in awaiting_bind state.
type WechatUnboundEvent struct {
	Type   string `json:"type"` // always TypeWechatUnbound
	Reason string `json:"reason,omitempty"`
}

// Wechat bind status values reported on TypeWechatBindStatus events.
const (
	WechatBindStatusScanned    = "scanned"
	WechatBindStatusExpired    = "expired" // a refresh follows in WechatQREvent
	WechatBindStatusRedirected = "redirected"
	WechatBindStatusConfirmed  = "confirmed"
	WechatBindStatusFailed     = "failed"
	WechatBindStatusCancelled  = "cancelled"
)

// envelope is a minimal probe used to discriminate inbound frames before
// dispatching to the typed decoder.
type envelope struct {
	Type string `json:"type"`
}

// DecodeInbound parses one line of NDJSON into the appropriate inbound
// frame variant. Returns a typed pointer (*InitFrame, *ConfigUpdateFrame,
// *ShutdownFrame) or an error.
func DecodeInbound(line []byte) (any, error) {
	var env envelope
	if err := json.Unmarshal(line, &env); err != nil {
		return nil, fmt.Errorf("hostproto: parse envelope: %w", err)
	}
	switch env.Type {
	case TypeInit:
		var f InitFrame
		if err := json.Unmarshal(line, &f); err != nil {
			return nil, fmt.Errorf("hostproto: parse init: %w", err)
		}
		return &f, nil
	case TypeConfigUpdate:
		var f ConfigUpdateFrame
		if err := json.Unmarshal(line, &f); err != nil {
			return nil, fmt.Errorf("hostproto: parse config_update: %w", err)
		}
		return &f, nil
	case TypeShutdown:
		var f ShutdownFrame
		if err := json.Unmarshal(line, &f); err != nil {
			return nil, fmt.Errorf("hostproto: parse shutdown: %w", err)
		}
		return &f, nil
	case TypeWechatBindStart:
		var f WechatBindStartFrame
		if err := json.Unmarshal(line, &f); err != nil {
			return nil, fmt.Errorf("hostproto: parse wechat_bind_start: %w", err)
		}
		return &f, nil
	case TypeWechatLogout:
		var f WechatLogoutFrame
		if err := json.Unmarshal(line, &f); err != nil {
			return nil, fmt.Errorf("hostproto: parse wechat_logout: %w", err)
		}
		return &f, nil
	case "":
		return nil, fmt.Errorf("hostproto: missing type field")
	default:
		return nil, fmt.Errorf("hostproto: unknown inbound type %q", env.Type)
	}
}

// EncodeFrame marshals an outbound event into a single-line JSON byte slice
// terminated by '\n'. The "type" tag must already be set on the value.
func EncodeFrame(v any) ([]byte, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("hostproto: marshal: %w", err)
	}
	return append(data, '\n'), nil
}
