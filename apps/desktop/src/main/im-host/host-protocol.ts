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

export const EVENT_READY = "ready" as const;
export const EVENT_LOG = "log" as const;
export const EVENT_STATUS = "status" as const;
export const EVENT_STATE_PATCH = "state_patch" as const;
export const EVENT_METRIC = "metric" as const;
export const EVENT_WECHAT_QR = "wechat_qr" as const;
export const EVENT_WECHAT_BIND_STATUS = "wechat_bind_status" as const;
export const EVENT_WECHAT_BOUND = "wechat_bound" as const;
export const EVENT_WECHAT_UNBOUND = "wechat_unbound" as const;

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
	conversationCwd: string;
	state: SessionStateEntry[];
	logLevel?: "debug" | "info" | "warn" | "error";
	codingAgent?: CodingAgentSpec;
}

export interface ConfigUpdateFrame {
	type: typeof FRAME_CONFIG_UPDATE;
	feishu?: FeishuConfig;
	wechat?: WechatConfig;
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

export type InboundFrame = InitFrame | ConfigUpdateFrame | ShutdownFrame | WechatBindStartFrame | WechatLogoutFrame;

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

export type OutboundEvent =
	| ReadyEvent
	| LogEvent
	| StatusEvent
	| StatePatchEvent
	| MetricEvent
	| WechatQREvent
	| WechatBindStatusEvent
	| WechatBoundEvent
	| WechatUnboundEvent;

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
			return parsed as OutboundEvent;
		default:
			throw new Error(`hostproto: unknown event type "${parsed.type}"`);
	}
}
