/**
 * TypeScript counterpart of vetta-im-gateway/internal/hostproto.
 *
 * Defines the NDJSON frames exchanged with the im-gateway sidecar over its
 * stdin/stdout pipes. Frames flowing parent → child are written to the
 * sidecar's stdin; frames flowing child → parent are read from stdout.
 *
 * Keep this file in lockstep with frames.go in the Go package — drift will
 * cause silent JSON misinterpretation.
 */

// =============================================================================
// Frame type discriminators (must match Go constants exactly)
// =============================================================================

export const FRAME_INIT = "init" as const;
export const FRAME_CONFIG_UPDATE = "config_update" as const;
export const FRAME_SHUTDOWN = "shutdown" as const;
export const FRAME_WECHAT_BIND_START = "wechat_bind_start" as const;
export const FRAME_WECHAT_LOGOUT = "wechat_logout" as const;
export const FRAME_WHATSAPP_BIND_START = "whatsapp_bind_start" as const;
export const FRAME_WHATSAPP_LOGOUT = "whatsapp_logout" as const;
export const FRAME_SIGNAL_BIND_START = "signal_bind_start" as const;
export const FRAME_SIGNAL_LOGOUT = "signal_logout" as const;

export const EVENT_READY = "ready" as const;
export const EVENT_LOG = "log" as const;
export const EVENT_STATUS = "status" as const;
export const EVENT_STATE_PATCH = "state_patch" as const;
export const EVENT_METRIC = "metric" as const;
export const EVENT_WECHAT_QR = "wechat_qr" as const;
export const EVENT_WECHAT_BIND_STATUS = "wechat_bind_status" as const;
export const EVENT_WECHAT_BOUND = "wechat_bound" as const;
export const EVENT_WECHAT_UNBOUND = "wechat_unbound" as const;
export const EVENT_WHATSAPP_QR = "whatsapp_qr" as const;
export const EVENT_WHATSAPP_BIND_STATUS = "whatsapp_bind_status" as const;
export const EVENT_WHATSAPP_BOUND = "whatsapp_bound" as const;
export const EVENT_WHATSAPP_UNBOUND = "whatsapp_unbound" as const;
export const EVENT_SIGNAL_QR = "signal_qr" as const;
export const EVENT_SIGNAL_BIND_STATUS = "signal_bind_status" as const;
export const EVENT_SIGNAL_BOUND = "signal_bound" as const;
export const EVENT_SIGNAL_UNBOUND = "signal_unbound" as const;

// =============================================================================
// Shared payload types
// =============================================================================

export interface FeishuConfig {
	appId: string;
	appSecret: string;
	verificationToken?: string;
	encryptKey?: string;
	baseUrl?: string;
}

/**
 * Wechat (iLink) slot in InitFrame / ConfigUpdateFrame.
 *
 * Unlike feishu, the protocol carries no long-lived credentials — the
 * bot_token is obtained dynamically via the QR scan flow and persisted by
 * the sidecar itself in `statePath`. This struct only carries:
 *
 *   - `enabled`: tells the sidecar to select wechat as the active transport
 *   - `statePath`: absolute path to the persistent credentials JSON,
 *     letting the parent override the wechat package's default
 *     `~/.vetta/im-gateway/wechat.json` so the file lives next to other
 *     desktop-app vetta data.
 */
export interface WechatConfig {
	enabled: boolean;
	statePath?: string;
}

/**
 * Telegram slot (official Bot API, long polling — no public ingress
 * needed). `allowedUserIds` empty/absent means accept all DMs.
 */
export interface TelegramConfig {
	botToken: string;
	allowedUserIds?: number[];
}

/**
 * Slack slot (Socket Mode: bot token + app-level token, no public
 * ingress). `allowedChannelIds` carries channel IDs, not names.
 */
export interface SlackConfig {
	botToken: string;
	appToken: string;
	allowedUserIds?: string[];
	allowedChannelIds?: string[];
}

export interface DiscordConfig {
	botToken: string;
	allowedUserIds?: string[];
	allowedGuildIds?: string[];
}

/**
 * Signal slot: points the transport at a user-managed signal-cli daemon
 * (HTTP JSON-RPC + SSE). The daemon owns the Signal credentials; this
 * slot only says where it listens and which account it serves.
 * `attachmentsDir` is signal-cli's attachment cache, for inbound media.
 */
/**
 * Signal slot. Two modes share it:
 *
 *   - managed (the default): `endpoint` is empty and the sidecar locates
 *     the user's signal-cli install, drives the device-link QR flow, and
 *     runs `signal-cli daemon --http` itself on a loopback port. `account`
 *     is discovered from signal-cli, so the user never types it.
 *   - user-managed (advanced): `endpoint` points at a daemon the user runs
 *     themselves and `account` names the number it serves.
 *
 * signal-cli — not this protocol — always owns the Signal credentials.
 */
export interface SignalConfig {
	endpoint?: string;
	account?: string;
	/** Explicit signal-cli executable. Empty lets the sidecar search. */
	cliPath?: string;
	/** signal-cli `--config` directory. */
	configDir?: string;
	/**
	 * Marks configDir as created and owned by this app, which is what
	 * allows an unbind to delete the local account data. Never set for a
	 * directory the user manages themselves.
	 */
	ownsConfigDir?: boolean;
	allowedNumbers?: string[];
	attachmentsDir?: string;
}

/**
 * Whatsapp slot, mirroring WechatConfig's shape: no long-lived
 * credentials in the protocol — the session is established via the QR
 * pairing flow (whatsapp_bind_start) and persisted by the sidecar in
 * `statePath` (a sqlite database owned by whatsmeow).
 */
export interface WhatsappConfig {
	enabled: boolean;
	statePath?: string;
	allowedNumbers?: string[];
}

/**
 * macOS-local imessage transport (chat.db polling + Messages.app
 * automation). No credentials — access is granted via macOS permissions
 * (Full Disk Access + Automation) on the host Mac. `dbPath` defaults to
 * ~/Library/Messages/chat.db on the sidecar side.
 */
export interface IMessageConfig {
	enabled: boolean;
	dbPath?: string;
	allowedHandles?: string[];
}

export interface SessionStateEntry {
	userId: string;
	chatId: string;
	sessionPath?: string;
	updatedAt?: string;
}

// =============================================================================
// Inbound frames (parent → child)
// =============================================================================

/**
 * The active transport is determined by which sub-config slot is non-nil:
 * exactly one of `feishu` / `wechat` should be set per init / config_update
 * frame. The sidecar's buildHostTransport prefers wechat when both are set
 * but the parent should never rely on that.
 *
 * `conversationCwd` is the absolute cwd shared by all IM sessions
 * (`DEFAULT_IM_CONVERSATION_CWD`, `~/.vetta/im-gateway/conversation`). It
 * is physically separate from desktop-app's "对话" cwd (ADR-0005) so the
 * two sides don't share sessions or generated artifacts.
 */
/**
 * Overrides how the sidecar invokes the coding-agent subprocess. When
 * omitted, the sidecar falls back to `vetta` on PATH — only valid in dev
 * where workspace linking puts it there. Production must populate this so
 * the sidecar can spawn the packaged Vetta.app executable (which detects
 * `--agent-rpc` in argv and short-circuits into coding-agent's main).
 *
 * Final argv: [bin, ...prefixArgs, "--mode", "rpc", "--cwd", <cwd>, ...].
 */
export interface CodingAgentSpec {
	bin: string;
	prefixArgs?: string[];
	/**
	 * When true, the sidecar sets `ELECTRON_RUN_AS_NODE=1` before spawning
	 * `bin`. Windows packaged builds need this because the GUI Electron
	 * executable closes stdio too early for the RPC protocol.
	 */
	runAsNode?: boolean;
	/**
	 * Forwarded to the spawned coding-agent subprocess as
	 * `VETTA_PACKAGE_DIR`. The agent's `getPackageDir()` falls back to
	 * walking up `__dirname` to find `package.json`, which lands on the
	 * host bundle's tree once coding-agent is Vite-bundled into Electron's
	 * main process. Setting this explicitly points at the staged
	 * `coding-agent/` directory (resources in prod, workspace in dev) so
	 * `getThemesDir()` / `getExportTemplateDir()` resolve correctly.
	 */
	packageDir?: string;
	/**
	 * Forwarded as `VETTA_SERVER_URL`. coding-agent's main.ts reads this env
	 * ahead of `~/.vetta/agent/settings.json`, so an IM-session subprocess
	 * uses the host's compile-time gateway URL instead of any stale
	 * `serverUrl` left in the settings file (e.g. from a previous dev/LAN
	 * login). Without it, prod desktop-app + stale settings produced
	 * "Unknown provider" exits on the first IM message because remote model
	 * loading 401'd against the wrong gateway.
	 */
	serverUrl?: string;
}

export interface InitFrame {
	type: typeof FRAME_INIT;
	feishu?: FeishuConfig;
	wechat?: WechatConfig;
	telegram?: TelegramConfig;
	slack?: SlackConfig;
	discord?: DiscordConfig;
	signal?: SignalConfig;
	whatsapp?: WhatsappConfig;
	imessage?: IMessageConfig;
	conversationCwd: string;
	state: SessionStateEntry[];
	logLevel?: "debug" | "info" | "warn" | "error";
	codingAgent?: CodingAgentSpec;
}

export interface ConfigUpdateFrame {
	type: typeof FRAME_CONFIG_UPDATE;
	feishu?: FeishuConfig;
	wechat?: WechatConfig;
	telegram?: TelegramConfig;
	slack?: SlackConfig;
	discord?: DiscordConfig;
	signal?: SignalConfig;
	whatsapp?: WhatsappConfig;
	imessage?: IMessageConfig;
}

export interface ShutdownFrame {
	type: typeof FRAME_SHUTDOWN;
}

/**
 * Request the sidecar begin (or restart) a wechat QR scan flow. No
 * payload — the sidecar uses the StatePath from the most recent
 * Init/ConfigUpdate frame. Issuing this while a bind is in progress is a
 * no-op.
 */
export interface WechatBindStartFrame {
	type: typeof FRAME_WECHAT_BIND_START;
}

/**
 * Request the sidecar drop persisted wechat credentials, stop any running
 * wechat transport, and re-enter awaiting_bind state.
 */
export interface WechatLogoutFrame {
	type: typeof FRAME_WECHAT_LOGOUT;
}

/**
 * Request the sidecar begin (or restart) a whatsapp QR pairing flow. Same
 * semantics as WechatBindStartFrame: no payload, the sidecar knows
 * StatePath from the latest init/config_update; a bind already in
 * progress continues.
 */
export interface WhatsappBindStartFrame {
	type: typeof FRAME_WHATSAPP_BIND_START;
}

/**
 * Request the sidecar drop the persisted whatsapp session, stop any
 * running whatsapp transport, and re-enter awaiting_bind state.
 */
export interface WhatsappLogoutFrame {
	type: typeof FRAME_WHATSAPP_LOGOUT;
}

/**
 * Ask the sidecar to begin (or restart) a signal-cli device-link flow. An
 * in-progress link keeps running.
 */
export interface SignalBindStartFrame {
	type: typeof FRAME_SIGNAL_BIND_START;
}

/**
 * Ask the sidecar to stop the signal transport and forget the linked
 * account. Local account data is only deleted when the config directory
 * belongs to this app (SignalConfig.ownsConfigDir).
 */
export interface SignalLogoutFrame {
	type: typeof FRAME_SIGNAL_LOGOUT;
}

export type InboundFrame =
	| InitFrame
	| ConfigUpdateFrame
	| ShutdownFrame
	| WechatBindStartFrame
	| WechatLogoutFrame
	| WhatsappBindStartFrame
	| WhatsappLogoutFrame
	| SignalBindStartFrame
	| SignalLogoutFrame;

// =============================================================================
// Outbound events (child → parent)
// =============================================================================

export type TransportStatus = "offline" | "connecting" | "online" | "error" | "awaiting_bind";

export type WechatBindStatus = "scanned" | "expired" | "redirected" | "confirmed" | "failed" | "cancelled";

export interface ReadyEvent {
	type: typeof EVENT_READY;
	version: string;
	transport: string;
}

export interface LogEvent {
	type: typeof EVENT_LOG;
	level: "debug" | "info" | "warn" | "error";
	msg: string;
	fields?: Record<string, unknown>;
	time: string;
}

export interface StatusEvent {
	type: typeof EVENT_STATUS;
	transport: TransportStatus;
	lastError?: string;
	time: string;
}

export interface StatePatchEvent {
	type: typeof EVENT_STATE_PATCH;
	userId: string;
	chatId: string;
	sessionPath: string;
	updatedAt: string;
}

export interface MetricEvent {
	type: typeof EVENT_METRIC;
	name: string;
	value: number;
}

/**
 * One QR code for the parent to render. `url` is the raw URL string the
 * iLink server returned; the parent renders it as a scannable QR image.
 * `attempt` is 1-indexed and increments on each refresh after a previous
 * expiration.
 */
export interface WechatQREvent {
	type: typeof EVENT_WECHAT_QR;
	url: string;
	attempt: number;
}

/** A transition in the bind state machine. */
export interface WechatBindStatusEvent {
	type: typeof EVENT_WECHAT_BIND_STATUS;
	status: WechatBindStatus;
	error?: string;
}

/**
 * Successful bind. Emitted exactly once per bind, after the credentials
 * have been persisted to disk and just before the sidecar (re)starts the
 * real wechat transport.
 */
export interface WechatBoundEvent {
	type: typeof EVENT_WECHAT_BOUND;
	ilink_bot_id: string;
	ilink_user_id?: string;
	base_url?: string;
}

/**
 * Credentials cleared (explicit logout or server-side -14 expiry). After
 * this event the sidecar is in awaiting_bind state.
 */
export interface WechatUnboundEvent {
	type: typeof EVENT_WECHAT_UNBOUND;
	reason?: string;
}

/**
 * One QR pairing code for the parent to render. `code` is the raw pairing
 * string WhatsApp expects inside the QR image. `attempt` is 1-indexed and
 * increments on each refresh after expiry.
 */
export interface WhatsappQREvent {
	type: typeof EVENT_WHATSAPP_QR;
	code: string;
	attempt: number;
}

/**
 * A transition in the whatsapp pairing state machine. Status reuses the
 * WechatBindStatus values; `error` is set only on "failed".
 */
export interface WhatsappBindStatusEvent {
	type: typeof EVENT_WHATSAPP_BIND_STATUS;
	status: WechatBindStatus;
	error?: string;
}

/**
 * Successful pairing, emitted after the session has been persisted to
 * StatePath. `jid` is the paired account's WhatsApp JID
 * (user@s.whatsapp.net).
 */
export interface WhatsappBoundEvent {
	type: typeof EVENT_WHATSAPP_BOUND;
	jid?: string;
}

/**
 * Whatsapp session cleared (explicit logout frame or server-side logout).
 * After this event the sidecar is in awaiting_bind state.
 */
export interface WhatsappUnboundEvent {
	type: typeof EVENT_WHATSAPP_UNBOUND;
	reason?: string;
}

/**
 * The `sgnl://linkdevice?...` URI signal-cli printed, for the parent to
 * render as a QR code (Signal → Settings → Linked devices).
 */
export interface SignalQREvent {
	type: typeof EVENT_SIGNAL_QR;
	uri: string;
	attempt: number;
}

/**
 * A transition in the signal link flow. Status reuses the WechatBindStatus
 * values (confirmed / failed / cancelled); `error` is set only on "failed".
 */
export interface SignalBindStatusEvent {
	type: typeof EVENT_SIGNAL_BIND_STATUS;
	status: WechatBindStatus;
	error?: string;
}

/** Completed link, carrying the account signal-cli is registered as. */
export interface SignalBoundEvent {
	type: typeof EVENT_SIGNAL_BOUND;
	account?: string;
}

/** Signal link dropped; the sidecar is back in awaiting_bind. */
export interface SignalUnboundEvent {
	type: typeof EVENT_SIGNAL_UNBOUND;
	reason?: string;
}

export type OutboundEvent =
	| ReadyEvent
	| LogEvent
	| StatusEvent
	| StatePatchEvent
	| MetricEvent
	| WechatQREvent
	| WechatBindStatusEvent
	| WechatBoundEvent
	| WechatUnboundEvent
	| WhatsappQREvent
	| WhatsappBindStatusEvent
	| WhatsappBoundEvent
	| WhatsappUnboundEvent
	| SignalQREvent
	| SignalBindStatusEvent
	| SignalBoundEvent
	| SignalUnboundEvent;

// =============================================================================
// Encode / decode helpers
// =============================================================================

/**
 * Serialize a frame for transmission. Returns a string ending with '\n' so it
 * can be written directly to a child's stdin.
 */
export function encodeFrame(frame: InboundFrame): string {
	return `${JSON.stringify(frame)}\n`;
}

/**
 * Parse a single NDJSON line from the child. Returns null for empty lines.
 * Throws on malformed JSON or missing/unknown discriminator.
 */
export function decodeEvent(line: string): OutboundEvent | null {
	const trimmed = line.trim();
	if (trimmed.length === 0) return null;
	const parsed = JSON.parse(trimmed) as { type?: string };
	if (!parsed || typeof parsed.type !== "string") {
		throw new Error(`hostproto: missing type in event: ${trimmed}`);
	}
	switch (parsed.type) {
		case EVENT_READY:
		case EVENT_LOG:
		case EVENT_STATUS:
		case EVENT_STATE_PATCH:
		case EVENT_METRIC:
		case EVENT_WECHAT_QR:
		case EVENT_WECHAT_BIND_STATUS:
		case EVENT_WECHAT_BOUND:
		case EVENT_WECHAT_UNBOUND:
		case EVENT_WHATSAPP_QR:
		case EVENT_WHATSAPP_BIND_STATUS:
		case EVENT_WHATSAPP_BOUND:
		case EVENT_WHATSAPP_UNBOUND:
		case EVENT_SIGNAL_QR:
		case EVENT_SIGNAL_BIND_STATUS:
		case EVENT_SIGNAL_BOUND:
		case EVENT_SIGNAL_UNBOUND:
			return parsed as OutboundEvent;
		default:
			throw new Error(`hostproto: unknown event type "${parsed.type}"`);
	}
}
