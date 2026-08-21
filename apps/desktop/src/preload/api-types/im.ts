// =============================================================================
// IM bridge (im-gateway sidecar)
// =============================================================================

export type ImTransportStatus = "offline" | "connecting" | "online" | "error" | "awaiting_bind";

// Manual snapshot of src/main/im-host/channels.ts → ImTransportSelector.
// Keep in sync by hand: preload contracts are independent copies.
export type ImTransportSelector =
	| "feishu"
	| "wechat"
	| "telegram"
	| "slack"
	| "discord"
	| "signal"
	| "whatsapp"
	| "imessage";

export interface ImAgentModelRef {
	provider: string;
	model: string;
	/** 推理档位；未设置时按模型 api 预设/默认档。"off" 关闭思考。 */
	reasoningLevel?: string;
}

export interface ImBridgeConfig {
	enabled: boolean;
	transport: ImTransportSelector;
	feishu: {
		appId: string;
		appSecret: string;
		verificationToken: string;
		encryptKey: string;
		baseUrl?: string;
	};
	wechat: {
		bound: boolean;
		ilinkBotId?: string;
		ilinkUserId?: string;
	};
	telegram: {
		botToken: string;
		allowedUserIds?: number[];
	};
	slack: {
		botToken: string;
		appToken: string;
		allowedUserIds?: string[];
		allowedChannelIds?: string[];
	};
	discord: {
		botToken: string;
		allowedUserIds?: string[];
		allowedGuildIds?: string[];
	};
	signal: {
		/** A signal-cli device is linked. */
		bound: boolean;
		/** Number signal-cli is registered as, once linked. */
		account?: string;
		/** Advanced mode only: a signal-cli daemon the user runs. */
		endpoint?: string;
		cliPath?: string;
		allowedNumbers?: string[];
		attachmentsDir?: string;
		/** Resolved signal-cli path; undefined when it is not installed. */
		cliDetectedPath?: string;
		/** Install command to show when signal-cli is missing. */
		cliInstallHint: string;
	};
	whatsapp: {
		bound: boolean;
		allowedNumbers?: string[];
	};
	imessage: {
		dbPath?: string;
		allowedHandles?: string[];
	};
	transportMode: "long-connection";
	encryptionAvailable: boolean;
	agentModel?: ImAgentModelRef;
}

export interface ImSetConfigPayload {
	enabled: boolean;
	transport?: ImTransportSelector;
	feishu?: {
		appId: string;
		appSecret?: string;
		verificationToken?: string;
		encryptKey?: string;
		baseUrl?: string;
	};
	// Per-channel blocks: omitting a block preserves the stored values;
	// sending one replaces that channel's config (and secret credentials).
	telegram?: {
		botToken?: string;
		allowedUserIds?: number[];
	};
	slack?: {
		botToken?: string;
		appToken?: string;
		allowedUserIds?: string[];
		allowedChannelIds?: string[];
	};
	discord?: {
		botToken?: string;
		allowedUserIds?: string[];
		allowedGuildIds?: string[];
	};
	signal?: {
		/** Leave empty to keep Signal in managed mode (recommended). */
		endpoint?: string;
		account?: string;
		cliPath?: string;
		allowedNumbers?: string[];
		attachmentsDir?: string;
	};
	whatsapp?: {
		allowedNumbers?: string[];
	};
	imessage?: {
		dbPath?: string;
		allowedHandles?: string[];
	};
	// null clears the override; undefined preserves the current value.
	agentModel?: ImAgentModelRef | null;
}

export interface ImSetConfigResult {
	ok: boolean;
	mode?: "plaintext";
	error?: string;
}

export interface ImBridgeStatus {
	transport: ImTransportStatus;
	lastError?: string;
	lastErrorAt?: string;
	activeSessions: number;
	sidecarPid?: number;
	sidecarStartedAt?: string;
	consecutiveStartFailures: number;
	binaryPath?: string;
}

export interface ImLogEvent {
	type: "log";
	level: "debug" | "info" | "warn" | "error";
	msg: string;
	fields?: Record<string, unknown>;
	time: string;
}

/**
 * Superset of every channel's testable fields; `transport` selects which
 * channel validates it (absent → feishu for backwards compat). Mirror of
 * src/main/im-host/channels.ts → ImTestConnectionPayload.
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

export interface ImTestConnectionResult {
	ok: boolean;
	error?: string;
	message?: string;
}

export interface ImPathInfo {
	config: string;
	credentials: string;
	state: string;
	wechatState: string;
	whatsappState: string;
	signalConfigDir: string;
}

// =============================================================================
// Wechat (iLink) bind flow
// =============================================================================

export type ImWechatBindStatus = "scanned" | "expired" | "redirected" | "confirmed" | "failed" | "cancelled";

/**
 * Tagged-union of bind-flow events the renderer's bind dialog reacts to.
 *
 *   qr       — a fresh QR url is ready; render and display
 *   status   — bind state machine transition
 *   bound    — credentials persisted, sidecar starting wechat transport
 *   unbound  — credentials cleared (logout or expiry)
 */
export type ImWechatBindEvent =
	| { kind: "qr"; type: "wechat_qr"; url: string; attempt: number }
	| {
			kind: "status";
			type: "wechat_bind_status";
			status: ImWechatBindStatus;
			error?: string;
	  }
	| {
			kind: "bound";
			type: "wechat_bound";
			ilink_bot_id: string;
			ilink_user_id?: string;
			base_url?: string;
	  }
	| { kind: "unbound"; type: "wechat_unbound"; reason?: string };

export interface ImWechatStartBindResult {
	ok: boolean;
	error?: string;
}

export interface ImWechatLogoutResult {
	ok: boolean;
	error?: string;
}

export interface ImWechatApi {
	/**
	 * Start (or restart) a QR scan flow. Auto-flips the active transport
	 * to wechat if needed. Returns immediately; live progress arrives via
	 * subscribeBind().
	 */
	startBind(): Promise<ImWechatStartBindResult>;
	/** Forget the bound account and re-enter awaiting_bind state. */
	logout(): Promise<ImWechatLogoutResult>;
	/**
	 * Subscribe to live bind-flow events. The handler is called with every
	 * qr / status / bound / unbound event in arrival order. Returns an
	 * unsubscribe function.
	 */
	subscribeBind(handler: (event: ImWechatBindEvent) => void): Promise<() => void>;
}

// =============================================================================
// Whatsapp bind flow (mirrors the wechat flow; QR carries a raw pairing
// code instead of a URL, and bound carries the account JID)
// =============================================================================

export type ImWhatsappBindStatus = ImWechatBindStatus;

export type ImWhatsappBindEvent =
	| { kind: "qr"; type: "whatsapp_qr"; code: string; attempt: number }
	| {
			kind: "status";
			type: "whatsapp_bind_status";
			status: ImWhatsappBindStatus;
			error?: string;
	  }
	| { kind: "bound"; type: "whatsapp_bound"; jid?: string }
	| { kind: "unbound"; type: "whatsapp_unbound"; reason?: string };

export interface ImWhatsappStartBindResult {
	ok: boolean;
	error?: string;
}

export interface ImWhatsappLogoutResult {
	ok: boolean;
	error?: string;
}

export interface ImWhatsappApi {
	/**
	 * Start (or restart) a QR pairing flow. Auto-flips the active
	 * transport to whatsapp if needed. Returns immediately; live progress
	 * arrives via subscribeBind().
	 */
	startBind(): Promise<ImWhatsappStartBindResult>;
	/** Forget the paired session and re-enter awaiting_bind state. */
	logout(): Promise<ImWhatsappLogoutResult>;
	/**
	 * Subscribe to live bind-flow events. The handler is called with every
	 * qr / status / bound / unbound event in arrival order. Returns an
	 * unsubscribe function.
	 */
	subscribeBind(handler: (event: ImWhatsappBindEvent) => void): Promise<() => void>;
}

// =============================================================================
// Signal device link (mirrors the whatsapp flow; the QR payload is the
// `sgnl://linkdevice?...` URI signal-cli printed, and bound carries the
// discovered account number)
// =============================================================================

export type ImSignalBindStatus = ImWechatBindStatus;

export type ImSignalBindEvent =
	| { kind: "qr"; type: "signal_qr"; uri: string; attempt: number }
	| {
			kind: "status";
			type: "signal_bind_status";
			status: ImSignalBindStatus;
			error?: string;
	  }
	| { kind: "bound"; type: "signal_bound"; account?: string }
	| { kind: "unbound"; type: "signal_unbound"; reason?: string };

export interface ImSignalStartBindResult {
	ok: boolean;
	error?: string;
}

export interface ImSignalLogoutResult {
	ok: boolean;
	error?: string;
}

export interface ImSignalApi {
	/**
	 * Start (or restart) the signal-cli device-link flow. Auto-flips the
	 * active transport to signal if needed. Fails immediately when
	 * signal-cli is not installed — the error carries the install command.
	 */
	startBind(): Promise<ImSignalStartBindResult>;
	/** Forget the linked device and re-enter awaiting_bind state. */
	logout(): Promise<ImSignalLogoutResult>;
	/**
	 * Subscribe to live link-flow events. Returns an unsubscribe function.
	 */
	subscribeBind(handler: (event: ImSignalBindEvent) => void): Promise<() => void>;
}

export interface ImLegacyDetection {
	hasLegacyData: boolean;
	configPath?: string;
	credentialsPath?: string;
	statePath?: string;
	parsed?: {
		feishu?: { appId?: string; appSecret?: string; baseUrl?: string };
		stateEntries?: Array<{ userId: string; projectId: string; sessionPath: string; updatedAt?: string }>;
	};
	error?: string;
}

export interface DesktopImApi {
	getConfig(): Promise<ImBridgeConfig>;
	setConfig(payload: ImSetConfigPayload): Promise<ImSetConfigResult>;
	getStatus(): Promise<ImBridgeStatus>;
	subscribeStatus(
		handler: (snapshot: ImBridgeStatus) => void,
		onLog: (event: ImLogEvent) => void,
	): Promise<() => void>;
	testConnection(payload: ImTestConnectionPayload): Promise<ImTestConnectionResult>;
	restart(): Promise<{ ok: boolean }>;
	getRecentLogs(): Promise<ImLogEvent[]>;
	getPaths(): Promise<ImPathInfo>;
	/**
	 * Disconnect one channel: clears its credentials/identifiers and, for
	 * QR-paired channels, makes the sidecar forget its session. Clearing
	 * the active channel also switches the bridge off when it can no
	 * longer run.
	 */
	clearChannel(transport: ImTransportSelector): Promise<{ ok: boolean; error?: string }>;
	/** Reachability check for an IM-session model. Used by the bridge
	 * settings page's "测试连通" button and gated automatically on
	 * setConfig(enabled=true). ok=true also for HTTP 4xx — host is up,
	 * auth is a separate concern. */
	probeAgentModel(ref: ImAgentModelRef): Promise<{ ok: boolean; message?: string; error?: string }>;
	detectLegacy(): Promise<ImLegacyDetection>;
	importLegacy(detection: ImLegacyDetection): Promise<{ ok: boolean; error?: string }>;
	/** Subscribe to "IM routing table changed" pings emitted by the sidecar's
	 * state_patch events. Renderer uses this to refresh the sidebar's
	 * default "对话" project session list without manual reload. Returns
	 * an unsubscribe function. */
	onSessionChanged(handler: () => void): () => void;
	/** Wechat (iLink) bind flow. See ImWechatApi. */
	wechat: ImWechatApi;
	/** Whatsapp QR pairing flow. See ImWhatsappApi. */
	whatsapp: ImWhatsappApi;
	/** Signal device link flow. See ImSignalApi. */
	signal: ImSignalApi;
}
