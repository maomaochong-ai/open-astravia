import type { ImConfig } from "./config-store.js";
import type { ImCredentials } from "./credential-store.js";

/**
 * IM channel descriptor registry.
 *
 * One descriptor per supported transport. This is the single main-process
 * source of truth for:
 *   - the transport selector union (`ImTransportSelector`)
 *   - how each channel proves it has enough credentials/config to start
 *     the sidecar (`hasRequiredCredentials`)
 *   - the lightweight structural validation used by the renderer's
 *     "test connection" button (`validate`)
 *
 * NOTE: the preload copy of `ImTransportSelector`
 * (src/preload/api-types/im.ts) is an independent contract snapshot and
 * must be kept in sync by hand when this union changes.
 */

export const IM_TRANSPORT_SELECTORS = [
	"feishu",
	"wechat",
	"telegram",
	"slack",
	"discord",
	"signal",
	"whatsapp",
	"imessage",
] as const;

export type ImTransportSelector = (typeof IM_TRANSPORT_SELECTORS)[number];

export function isImTransportSelector(value: unknown): value is ImTransportSelector {
	return typeof value === "string" && (IM_TRANSPORT_SELECTORS as readonly string[]).includes(value);
}

/**
 * How a channel obtains the ability to run:
 *   - "static": user pastes long-lived tokens/identifiers into settings.
 *     Secrets go to credential-store; non-secret identifiers (e.g. signal
 *     endpoint/account) go to config-store.
 *   - "qr-bind": no long-lived credentials in the protocol — the sidecar
 *     acquires them via a QR scan flow and persists them itself.
 *   - "scan-or-static": either route works. Feishu credentials can be
 *     minted by the sidecar's one-click registration scan (it hands them
 *     back for the parent to persist) or typed in from the developer
 *     console, so an empty slot is startable — the sidecar parks in
 *     awaiting_bind and waits for the scan.
 *   - "local-permission": no credentials at all; access is granted by OS
 *     permissions on the host machine (e.g. imessage Full Disk Access).
 */
export type ImCredentialKind = "static" | "qr-bind" | "scan-or-static" | "local-permission";

/**
 * Payload shape accepted by the test-connection IPC. A superset of every
 * channel's testable fields; `transport` selects which descriptor
 * validates it. Absent transport defaults to feishu for backwards compat
 * with the pre-registry renderer.
 */
export interface ImTestConnectionPayload {
	transport?: ImTransportSelector;
	// feishu
	appId?: string;
	appSecret?: string;
	verificationToken?: string;
	encryptKey?: string;
	baseUrl?: string;
	// telegram / slack / discord
	botToken?: string;
	// slack
	appToken?: string;
	// signal
	endpoint?: string;
	account?: string;
}

export interface ImChannelDescriptor {
	id: ImTransportSelector;
	credentialKind: ImCredentialKind;
	/**
	 * Whether the persisted config + credentials are sufficient to start
	 * the sidecar on this transport. qr-bind / local-permission channels
	 * are always startable (the sidecar enters awaiting_bind / relies on
	 * OS permissions respectively).
	 */
	hasRequiredCredentials(config: ImConfig, credentials: ImCredentials): boolean;
	/**
	 * Strip this channel's identifiers from the config. Pure: the caller
	 * persists the result. Fields owned by the sidecar (wechat/whatsapp
	 * `bound`, signal's linked account) are reset here too, but clearing
	 * the sidecar's own on-disk state is the caller's job — see
	 * ImHost.clearChannel.
	 */
	clearConfig(config: ImConfig): ImConfig;
	/**
	 * Strip this channel's secrets from the credential store. Channels
	 * without secrets return the input unchanged.
	 */
	clearCredentials(credentials: ImCredentials): ImCredentials;
	/**
	 * Lightweight structural check for the renderer's test-connection
	 * button. Returns a user-facing error string or null when the payload
	 * passes. Channels without testable fields omit it.
	 *
	 * NOTE: error strings are hardcoded Chinese for now, mirroring the
	 * pre-existing feishu messages in ipc/im.ts. A follow-up i18n task
	 * should move these to message keys.
	 */
	validate?(payload: ImTestConnectionPayload): string | null;
}

/** Shared success message for a passing structural validation. */
export const TEST_CONNECTION_PASS_MESSAGE = "字段格式校验通过；保存后将由桥接进程进行真实连接验证。";

function trimmed(value: string | undefined): string {
	return (value ?? "").trim();
}

export const IM_CHANNEL_DESCRIPTORS: Record<ImTransportSelector, ImChannelDescriptor> = {
	feishu: {
		id: "feishu",
		credentialKind: "scan-or-static",
		// Always startable: without credentials the sidecar parks in
		// awaiting_bind, which is where the registration scan begins.
		hasRequiredCredentials: () => true,
		clearConfig: (config) => ({ ...config, feishu: { appId: "" } }),
		clearCredentials: ({ feishu: _dropped, ...rest }) => rest,
		validate: (payload) => {
			const appId = trimmed(payload.appId);
			if (appId === "") return "App ID 不能为空";
			if (trimmed(payload.appSecret) === "") return "App Secret 不能为空";
			if (!/^cli_[a-zA-Z0-9]+$/.test(appId)) return "App ID 格式不正确（应以 cli_ 开头）";
			return null;
		},
	},
	wechat: {
		id: "wechat",
		credentialKind: "qr-bind",
		// The sidecar boots into awaiting_bind when no credentials exist,
		// so wechat is always startable.
		hasRequiredCredentials: () => true,
		clearConfig: (config) => ({ ...config, wechat: { bound: false } }),
		clearCredentials: (credentials) => credentials,
	},
	telegram: {
		id: "telegram",
		credentialKind: "static",
		hasRequiredCredentials: (_config, credentials) => Boolean(credentials.telegram?.botToken),
		clearConfig: (config) => ({ ...config, telegram: {} }),
		clearCredentials: ({ telegram: _dropped, ...rest }) => rest,
		validate: (payload) => {
			const token = trimmed(payload.botToken);
			if (token === "") return "Bot Token 不能为空";
			if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) return "Bot Token 格式不正确（应为 <数字>:<密钥> 形式）";
			return null;
		},
	},
	slack: {
		id: "slack",
		credentialKind: "static",
		hasRequiredCredentials: (_config, credentials) =>
			Boolean(credentials.slack?.botToken && credentials.slack?.appToken),
		clearConfig: (config) => ({ ...config, slack: {} }),
		clearCredentials: ({ slack: _dropped, ...rest }) => rest,
		validate: (payload) => {
			const botToken = trimmed(payload.botToken);
			const appToken = trimmed(payload.appToken);
			if (botToken === "") return "Bot Token 不能为空";
			if (!botToken.startsWith("xoxb-")) return "Bot Token 格式不正确（应以 xoxb- 开头）";
			if (appToken === "") return "App Token 不能为空";
			if (!appToken.startsWith("xapp-")) return "App Token 格式不正确（应以 xapp- 开头）";
			return null;
		},
	},
	discord: {
		id: "discord",
		credentialKind: "static",
		hasRequiredCredentials: (_config, credentials) => Boolean(credentials.discord?.botToken),
		clearConfig: (config) => ({ ...config, discord: {} }),
		clearCredentials: ({ discord: _dropped, ...rest }) => rest,
		validate: (payload) => {
			if (trimmed(payload.botToken) === "") return "Bot Token 不能为空";
			return null;
		},
	},
	signal: {
		id: "signal",
		// Managed by default: the sidecar finds signal-cli, drives the
		// device link via QR, and runs the daemon itself, so there is
		// nothing to type — same shape as wechat/whatsapp. The advanced
		// mode (user-run daemon) still takes an endpoint + account, and
		// those are non-secret identifiers kept in the plaintext config.
		credentialKind: "qr-bind",
		// The sidecar boots into awaiting_bind when no device is linked,
		// so signal is always startable in managed mode; the advanced mode
		// needs both identifiers before the transport can build.
		hasRequiredCredentials: (config) => !config.signal.endpoint || Boolean(config.signal.account),
		// The linked device itself lives in signal-cli's config directory;
		// the sidecar clears that on signal_logout.
		clearConfig: (config) => ({ ...config, signal: { bound: false } }),
		clearCredentials: (credentials) => credentials,
		validate: (payload) => {
			const endpoint = trimmed(payload.endpoint);
			const account = trimmed(payload.account);
			// Managed mode: nothing to validate structurally — the QR flow
			// is the check.
			if (endpoint === "" && account === "") return null;
			if (endpoint !== "" && !/^https?:\/\//.test(endpoint)) {
				return "signal-cli 服务地址格式不正确（应以 http:// 或 https:// 开头）";
			}
			if (endpoint !== "" && account === "") return "填写了服务地址时，账号不能为空";
			if (account !== "" && !/^\+\d{5,}$/.test(account)) {
				return "账号格式不正确（应为 E.164 格式，如 +8613800000000）";
			}
			return null;
		},
	},
	whatsapp: {
		id: "whatsapp",
		credentialKind: "qr-bind",
		// Same as wechat: sidecar enters awaiting_bind without a session.
		hasRequiredCredentials: () => true,
		clearConfig: (config) => ({ ...config, whatsapp: { bound: false } }),
		clearCredentials: (credentials) => credentials,
	},
	imessage: {
		id: "imessage",
		credentialKind: "local-permission",
		// Access is macOS permission-gated on the host; nothing to check here.
		hasRequiredCredentials: () => true,
		// No credentials to drop — clearing resets the local overrides. The
		// macOS permissions themselves are the user's to revoke in System
		// Settings; no app can take them back on their behalf.
		clearConfig: (config) => ({ ...config, imessage: {} }),
		clearCredentials: (credentials) => credentials,
	},
};

export function getImChannelDescriptor(transport: ImTransportSelector): ImChannelDescriptor {
	return IM_CHANNEL_DESCRIPTORS[transport];
}
