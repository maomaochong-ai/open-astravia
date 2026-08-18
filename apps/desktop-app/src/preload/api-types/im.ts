// =============================================================================
// IM bridge (im-gateway sidecar)
// =============================================================================

export type ImTransportStatus = "offline" | "connecting" | "online" | "error" | "awaiting_bind";

export type ImTransportSelector = "feishu" | "wechat";

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
	testConnection(payload: ImSetConfigPayload["feishu"]): Promise<ImTestConnectionResult>;
	restart(): Promise<{ ok: boolean }>;
	getRecentLogs(): Promise<ImLogEvent[]>;
	getPaths(): Promise<ImPathInfo>;
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
}
