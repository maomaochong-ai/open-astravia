import { DEFAULT_IM_CONVERSATION_CWD } from "../ipc/fs.js";
import { getAppLogger } from "../logger.js";
import { probeModelProvider } from "../models/probe.js";
import { resolveImGatewayBinary } from "./binary-resolver.js";
import { buildCodingAgentSpec } from "./coding-agent-spec.js";
import {
	defaultImConfig,
	defaultImConfigPath,
	defaultWechatStatePath,
	type ImConfig,
	type ImTransportSelector,
	loadImConfig,
	saveImConfig,
} from "./config-store.js";
import { defaultCredentialsPath, type ImCredentials, loadCredentials, saveCredentials } from "./credential-store.js";
import type {
	FeishuConfig,
	LogEvent,
	SessionStateEntry,
	WechatBindStatusEvent,
	WechatBoundEvent,
	WechatConfig,
	WechatQREvent,
	WechatUnboundEvent,
} from "./host-protocol.js";
import { LogBuffer } from "./log-buffer.js";
import { archiveLegacyFiles, detectLegacyImGateway, type LegacyDetection } from "./migration.js";
import { SidecarManager } from "./sidecar-manager.js";
import { applyStatePatch, defaultImStatePath, type ImStateFile, loadImState, saveImState } from "./state-store.js";
import { type ImBridgeStatus, StatusStore } from "./status-store.js";

/**
 * Top-level orchestrator for the IM bridge subsystem inside desktop-app.
 *
 * Responsibilities:
 *  - Load persisted config / credentials / state on startup.
 *  - Combine them into a SidecarConfig and feed the SidecarManager.
 *  - Persist state_patch events to disk via the state-store.
 *  - Push log/status events into LogBuffer / StatusStore.
 *  - Provide a small public API used by IPC handlers (start/stop/restart/
 *    setConfig/applyProjects/getStatus/getRecentLogs).
 *
 * Single instance per process. Created in main.ts at app.whenReady() and
 * disposed via shutdownForQuit() in app.before-quit.
 */
export interface ImAgentModelRef {
	provider: string;
	model: string;
	reasoningLevel?: string;
}

export interface ImHostPublicConfig {
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
	// Retained for backwards compat with renderer; always false now that
	// we no longer encrypt via safeStorage.
	encryptionAvailable: boolean;
	// Optional override telling IM-session coding-agent which model to
	// use. Undefined → fall back to agent settings default.
	agentModel?: ImAgentModelRef;
}

export interface SetConfigPayload {
	enabled: boolean;
	// Optional: lets the renderer flip the active transport in the same
	// call as a feishu credential update. Omitting it preserves the
	// current selection.
	transport?: ImTransportSelector;
	feishu?: {
		appId: string;
		appSecret?: string;
		verificationToken?: string;
		encryptKey?: string;
		baseUrl?: string;
	};
	// `null` clears the override (use agent settings default).
	// `undefined` (key omitted) preserves the existing value.
	agentModel?: ImAgentModelRef | null;
}

export interface SetConfigResult {
	ok: boolean;
	mode?: "plaintext";
	error?: string;
}

/**
 * Public union of bind-flow events the renderer can subscribe to. The
 * IPC layer maps each onWechat* hook from SidecarManager into this
 * tagged union and pushes it through one observable.
 */
export type WechatBindEvent =
	| ({ kind: "qr" } & WechatQREvent)
	| ({ kind: "status" } & WechatBindStatusEvent)
	| ({ kind: "bound" } & WechatBoundEvent)
	| ({ kind: "unbound" } & WechatUnboundEvent);

export class ImHost {
	readonly statusStore = new StatusStore();
	readonly logBuffer = new LogBuffer(500);

	private readonly logger = getAppLogger("sidecar", "im");
	private config: ImConfig = defaultImConfig();
	private credentials: ImCredentials = {};
	private state: ImStateFile = { version: 3, sessions: [] };

	private manager: SidecarManager;
	private binaryPath?: string;

	// Wechat bind subscribers. Multiple renderer windows may subscribe;
	// each gets every event in arrival order.
	private wechatBindHandlers: Set<(event: WechatBindEvent) => void> = new Set();

	// Listeners notified after every state_patch is applied. The IPC layer
	// uses this to broadcast "im session list changed" to the renderer so
	// the sidebar refreshes without the user having to manually reload.
	private stateChangeHandlers: Set<() => void> = new Set();

	constructor() {
		this.manager = new SidecarManager({
			hooks: {
				onReady: (event) => {
					// Don't override an awaiting_bind status that the
					// sidecar emits immediately after ready: the wechat
					// path uses ready+awaiting_bind as a normal state.
					if (this.statusStore.get().transport !== "awaiting_bind") {
						this.statusStore.patch({ transport: "online", lastError: undefined });
					}
					this.pushLog({
						type: "log",
						level: "info",
						msg: `sidecar ready ${event.transport} v${event.version}`,
						time: new Date().toISOString(),
					});
				},
				onStatus: (event) => {
					this.statusStore.patch({
						transport: event.transport,
						lastError: event.lastError,
						lastErrorAt: event.lastError ? event.time : undefined,
					});
				},
				onLog: (event) => {
					this.pushLog(event);
				},
				onMetric: (event) => {
					if (event.name === "active_sessions") {
						this.statusStore.patch({ activeSessions: Math.round(event.value) });
					}
				},
				onStatePatch: (event) => {
					this.state = applyStatePatch(this.state, {
						userId: event.userId,
						chatId: event.chatId,
						sessionPath: event.sessionPath,
						updatedAt: event.updatedAt,
					});
					try {
						saveImState(this.state);
					} catch (err) {
						this.appendLog("warn", `state save failed: ${(err as Error).message}`);
					}
					for (const h of this.stateChangeHandlers) {
						try {
							h();
						} catch (err) {
							this.appendLog("warn", `state change handler threw: ${(err as Error).message}`);
						}
					}
				},
				onSpawned: (pid) => {
					this.statusStore.patch({
						sidecarPid: pid,
						sidecarStartedAt: new Date().toISOString(),
						consecutiveStartFailures: 0,
					});
				},
				onExit: () => {
					this.statusStore.patch({ sidecarPid: undefined });
				},
				onFatal: (reason) => {
					this.statusStore.patch({
						transport: "error",
						lastError: reason,
						lastErrorAt: new Date().toISOString(),
					});
					this.appendLog("error", reason);
				},
				onWechatQR: (event) => {
					this.dispatchWechatBindEvent({ kind: "qr", ...event });
				},
				onWechatBindStatus: (event) => {
					this.dispatchWechatBindEvent({ kind: "status", ...event });
				},
				onWechatBound: (event) => {
					// Persist the bound state into im-config so the
					// renderer can show "已绑定" without an extra
					// roundtrip on next launch.
					this.config = {
						...this.config,
						wechat: {
							bound: true,
							ilinkBotId: event.ilink_bot_id,
							ilinkUserId: event.ilink_user_id,
						},
					};
					try {
						saveImConfig(this.config);
					} catch (err) {
						this.appendLog("warn", `save wechat bound state failed: ${(err as Error).message}`);
					}
					this.dispatchWechatBindEvent({ kind: "bound", ...event });
				},
				onWechatUnbound: (event) => {
					this.config = {
						...this.config,
						wechat: { bound: false },
					};
					try {
						saveImConfig(this.config);
					} catch (err) {
						this.appendLog("warn", `save wechat unbound state failed: ${(err as Error).message}`);
					}
					this.dispatchWechatBindEvent({ kind: "unbound", ...event });
				},
			},
		});
	}

	/** One-time bootstrap on app.whenReady. Loads disk state and (if
	 * enabled and credentials present) starts the sidecar. */
	async bootstrap(): Promise<void> {
		try {
			this.config = loadImConfig();
		} catch {
			this.config = defaultImConfig();
		}
		try {
			this.credentials = loadCredentials();
		} catch {
			this.credentials = {};
		}
		try {
			this.state = loadImState();
		} catch {
			this.state = { version: 3, sessions: [] };
		}

		if (this.config.enabled && this.hasRequiredCredentials()) {
			await this.startSidecar();
		}
	}

	// =========================================================================
	// wechat bind flow API
	// =========================================================================

	/**
	 * Begin (or restart) a wechat QR scan flow. The sidecar must already
	 * be running with wechat as the active transport (handled by the
	 * UI clicking "扫码绑定" → setConfig({transport:"wechat",enabled:true}) →
	 * sidecar boots into awaiting_bind → this method).
	 */
	async startWechatBind(): Promise<{ ok: boolean; error?: string }> {
		// Make sure the sidecar is running and configured for wechat. If
		// not, transparently flip the config so the bind dialog "just works"
		// from any starting state.
		if (this.config.transport !== "wechat" || !this.config.enabled) {
			const flip = await this.setConfig({
				enabled: true,
				transport: "wechat",
			});
			if (!flip.ok) {
				return { ok: false, error: flip.error ?? "切换到微信失败" };
			}
		}
		// Wait briefly for the sidecar to actually be running. The
		// SidecarManager spawn → ready handshake takes a few hundred ms.
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			if (this.statusStore.get().transport === "awaiting_bind" || this.config.wechat.bound) {
				break;
			}
			await new Promise((r) => setTimeout(r, 100));
		}
		this.manager.startWechatBind();
		return { ok: true };
	}

	/**
	 * Clear the persisted wechat credentials and re-enter awaiting_bind
	 * state. The sidecar (if running and on wechat transport) handles the
	 * actual file removal and emits a wechat_unbound event.
	 */
	async wechatLogout(): Promise<{ ok: boolean; error?: string }> {
		if (this.config.transport === "wechat" && this.manager.getCurrentChild()) {
			this.manager.wechatLogout();
		} else {
			// Sidecar isn't running on wechat — wipe the cached bound state
			// directly so the UI updates.
			this.config = { ...this.config, wechat: { bound: false } };
			try {
				saveImConfig(this.config);
			} catch (err) {
				return { ok: false, error: (err as Error).message };
			}
		}
		return { ok: true };
	}

	/**
	 * Subscribe to bind-flow events. Returns an unsubscribe function.
	 * Multiple subscribers are supported (one per renderer window).
	 */
	subscribeWechatBind(handler: (event: WechatBindEvent) => void): () => void {
		this.wechatBindHandlers.add(handler);
		return () => {
			this.wechatBindHandlers.delete(handler);
		};
	}

	private dispatchWechatBindEvent(event: WechatBindEvent): void {
		for (const h of this.wechatBindHandlers) {
			try {
				h(event);
			} catch (err) {
				this.appendLog("warn", `wechat bind handler threw: ${(err as Error).message}`);
			}
		}
	}

	getPublicConfig(): ImHostPublicConfig {
		return {
			enabled: this.config.enabled,
			transport: this.config.transport,
			feishu: {
				appId: this.config.feishu.appId,
				appSecret: this.credentials.feishu?.appSecret ?? "",
				verificationToken: this.credentials.feishu?.verificationToken ?? "",
				encryptKey: this.credentials.feishu?.encryptKey ?? "",
				baseUrl: this.config.feishu.baseUrl,
			},
			wechat: {
				bound: this.config.wechat.bound,
				ilinkBotId: this.config.wechat.ilinkBotId,
				ilinkUserId: this.config.wechat.ilinkUserId,
			},
			transportMode: this.config.transportMode,
			encryptionAvailable: false,
			agentModel: this.config.agentModel,
		};
	}

	async setConfig(payload: SetConfigPayload): Promise<SetConfigResult> {
		// Build the next config, preserving fields the payload didn't
		// touch. The transport selector defaults to whatever was in the
		// previous config so callers can update enabled / feishu without
		// resetting the user's choice.
		const nextTransport: ImTransportSelector = payload.transport ?? this.config.transport;

		// agentModel handling: `undefined` in the payload means "no change",
		// explicit `null` means "clear the override".
		let nextAgentModel = this.config.agentModel;
		if (payload.agentModel === null) {
			nextAgentModel = undefined;
		} else if (payload.agentModel !== undefined) {
			nextAgentModel = payload.agentModel;
		}

		const nextConfig: ImConfig = {
			enabled: payload.enabled,
			transport: nextTransport,
			feishu: payload.feishu
				? {
						appId: payload.feishu.appId,
						baseUrl: payload.feishu.baseUrl,
					}
				: this.config.feishu,
			wechat: this.config.wechat,
			transportMode: "long-connection",
			agentModel: nextAgentModel,
		};

		// Enabling the bridge requires a working agent model. Probe the
		// configured provider's baseUrl so users get a fast actionable
		// error instead of "Connection error." on every IM message. Done
		// BEFORE persisting so a failed probe leaves the on-disk config
		// untouched (enabled stays off).
		const prevEnabled = this.config.enabled;
		if (nextConfig.enabled && !prevEnabled) {
			if (!nextConfig.agentModel) {
				return { ok: false, error: "请先在「对话模型」里选择 IM 桥接使用的模型" };
			}
			const probe = await this.probeAgentModel(nextConfig.agentModel);
			if (!probe.ok) {
				return { ok: false, error: `模型连通性检查失败：${probe.error ?? "未知错误"}` };
			}
		}

		// Update credentials only when the payload sent a feishu block.
		const nextCreds: ImCredentials = { ...this.credentials };
		if (payload.feishu) {
			nextCreds.feishu = {
				appSecret: payload.feishu.appSecret ?? "",
				verificationToken: payload.feishu.verificationToken,
				encryptKey: payload.feishu.encryptKey,
			};
		}

		this.config = nextConfig;
		this.credentials = nextCreds;

		try {
			saveImConfig(this.config);
		} catch (err) {
			return { ok: false, error: `save config failed: ${(err as Error).message}` };
		}
		let mode: "plaintext" = "plaintext";
		try {
			mode = saveCredentials(this.credentials).mode;
		} catch (err) {
			return { ok: false, error: `save credentials failed: ${(err as Error).message}` };
		}

		// Apply runtime change.
		if (this.config.enabled && this.hasRequiredCredentials()) {
			if (this.manager.getCurrentChild()) {
				await this.manager.applyConfig(this.buildSidecarConfig());
			} else {
				await this.startSidecar();
			}
		} else {
			await this.manager.stop();
			this.statusStore.patch({ transport: "offline", lastError: undefined });
		}

		return { ok: true, mode };
	}

	async restart(): Promise<void> {
		if (this.config.enabled && this.hasRequiredCredentials()) {
			await this.manager.restart();
		}
	}

	async shutdownForQuit(): Promise<void> {
		await this.manager.shutdownForQuit();
	}

	getStatus(): ImBridgeStatus {
		return this.statusStore.get();
	}

	getRecentLogs(): LogEvent[] {
		return this.logBuffer.snapshot();
	}

	subscribeStatus(handler: (snapshot: ImBridgeStatus) => void): () => void {
		return this.statusStore.subscribe(handler);
	}

	subscribeLog(handler: (event: LogEvent) => void): () => void {
		return this.logBuffer.subscribe(handler);
	}

	/** Fire-and-forget notification that the IM routing table changed
	 * (state_patch from sidecar). Subscribers typically reload the
	 * affected project's session list. */
	subscribeStateChange(handler: () => void): () => void {
		this.stateChangeHandlers.add(handler);
		return () => {
			this.stateChangeHandlers.delete(handler);
		};
	}

	getPaths(): { config: string; credentials: string; state: string; wechatState: string } {
		return {
			config: defaultImConfigPath(),
			credentials: defaultCredentialsPath(),
			state: defaultImStatePath(),
			wechatState: defaultWechatStatePath(),
		};
	}

	/**
	 * Detect legacy im-gateway data on disk. Returns a description that
	 * the renderer can use to render an import wizard. Idempotent (no
	 * mutation), safe to call multiple times.
	 */
	detectLegacy(): LegacyDetection {
		// Don't surface a wizard if the user already has new-format
		// credentials — this is a "fresh install upgrade" scenario.
		if (this.hasRequiredCredentials()) {
			return { hasLegacyData: false };
		}
		return detectLegacyImGateway();
	}

	/**
	 * Apply a legacy detection result: copy the parsed feishu credentials
	 * into the new credential store and rename the old files to .bak.
	 */
	async importLegacy(detection: LegacyDetection): Promise<{ ok: boolean; error?: string }> {
		if (!detection.parsed?.feishu?.appId || !detection.parsed.feishu.appSecret) {
			return { ok: false, error: "旧配置中未找到 App ID / App Secret" };
		}
		const result = await this.setConfig({
			enabled: false,
			feishu: {
				appId: detection.parsed.feishu.appId,
				appSecret: detection.parsed.feishu.appSecret,
				baseUrl: detection.parsed.feishu.baseUrl,
			},
		});
		if (!result.ok) return { ok: false, error: result.error };
		archiveLegacyFiles(detection);
		return { ok: true };
	}

	// =========================================================================
	// internals
	// =========================================================================

	/**
	 * Whether the active transport has enough info to start the sidecar.
	 *
	 *   - feishu: needs both app id and secret in credentials
	 *   - wechat: always true — the sidecar boots into awaiting_bind when
	 *     no credentials are present and waits for the user to scan a QR
	 */
	/**
	 * Probe the given (provider, model)'s baseUrl to see if the model
	 * server is reachable. Returns ok=true on a 2xx/4xx response (4xx
	 * still proves the host answered — auth issue is a separate concern
	 * and shouldn't block the bridge), ok=false on network / DNS / TLS
	 * failures.
	 *
	 * Uses electron.net.fetch deliberately so we go through Chromium's
	 * network stack and bypass macOS 15 LNP — the same reason the main
	 * process swaps globalThis.fetch for the GUI session. We don't rely
	 * on globalThis.fetch here because installChromiumFetchForMain might
	 * not have run yet at probe time.
	 *
	 * Public so the renderer can re-probe on demand (test-connect button).
	 */
	async probeAgentModel(ref: {
		provider: string;
		model: string;
	}): Promise<{ ok: boolean; message?: string; error?: string }> {
		return probeModelProvider(ref);
	}

	private hasRequiredCredentials(): boolean {
		if (this.config.transport === "wechat") {
			return true;
		}
		return Boolean(this.config.feishu.appId && this.credentials.feishu?.appSecret);
	}

	private buildFeishuConfig(): FeishuConfig {
		return {
			appId: this.config.feishu.appId,
			appSecret: this.credentials.feishu?.appSecret ?? "",
			verificationToken: this.credentials.feishu?.verificationToken,
			encryptKey: this.credentials.feishu?.encryptKey,
			baseUrl: this.config.feishu.baseUrl,
		};
	}

	private buildWechatConfig(): WechatConfig {
		return {
			enabled: true,
			statePath: defaultWechatStatePath(),
		};
	}

	private buildSidecarConfig() {
		if (!this.binaryPath) {
			this.binaryPath = resolveImGatewayBinary().path;
			this.statusStore.patch({ binaryPath: this.binaryPath });
		}
		const codingAgent = buildCodingAgentSpec({ agentModel: this.config.agentModel });
		// Send only the slot for the currently selected transport. The
		// sidecar uses nil-discriminator to pick which to start.
		if (this.config.transport === "wechat") {
			return {
				binaryPath: this.binaryPath,
				wechat: this.buildWechatConfig(),
				conversationCwd: DEFAULT_IM_CONVERSATION_CWD,
				state: this.stateAsEntries(),
				codingAgent,
			};
		}
		return {
			binaryPath: this.binaryPath,
			feishu: this.buildFeishuConfig(),
			conversationCwd: DEFAULT_IM_CONVERSATION_CWD,
			state: this.stateAsEntries(),
			codingAgent,
		};
	}

	private stateAsEntries(): SessionStateEntry[] {
		return this.state.sessions.map((s) => ({ ...s }));
	}

	private async startSidecar(): Promise<void> {
		try {
			const cfg = this.buildSidecarConfig();
			this.statusStore.patch({ transport: "connecting", lastError: undefined });
			await this.manager.start(cfg);
		} catch (err) {
			const msg = (err as Error).message;
			this.statusStore.patch({
				transport: "error",
				lastError: msg,
				lastErrorAt: new Date().toISOString(),
			});
			this.appendLog("error", `start sidecar failed: ${msg}`);
		}
	}

	private appendLog(level: LogEvent["level"], msg: string): void {
		this.pushLog({
			type: "log",
			level,
			msg,
			time: new Date().toISOString(),
		});
	}

	private pushLog(event: LogEvent): void {
		const args = event.fields ? [event.msg, event.fields] : [event.msg];
		this.logger[event.level](...args);
		this.logBuffer.push(event);
	}
}

let instance: ImHost | undefined;

export function getImHost(): ImHost {
	if (!instance) instance = new ImHost();
	return instance;
}

export function disposeImHost(): void {
	instance = undefined;
}
