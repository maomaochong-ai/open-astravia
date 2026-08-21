import { DEFAULT_IM_CONVERSATION_CWD } from "../ipc/fs.js";
import { getAppLogger } from "../logger.js";
import { probeModelProvider } from "../models/probe.js";
import { resolveImGatewayBinary } from "./binary-resolver.js";
import { getImChannelDescriptor } from "./channels.js";
import { buildCodingAgentSpec } from "./coding-agent-spec.js";
import {
	defaultImConfig,
	defaultImConfigPath,
	defaultSignalConfigDir,
	defaultWechatStatePath,
	defaultWhatsappStatePath,
	type ImConfig,
	type ImTransportSelector,
	loadImConfig,
	saveImConfig,
} from "./config-store.js";
import { defaultCredentialsPath, type ImCredentials, loadCredentials, saveCredentials } from "./credential-store.js";
import type {
	DiscordConfig,
	FeishuConfig,
	IMessageConfig,
	LogEvent,
	SessionStateEntry,
	SignalBindStatusEvent,
	SignalBoundEvent,
	SignalConfig,
	SignalQREvent,
	SignalUnboundEvent,
	SlackConfig,
	TelegramConfig,
	WechatBindStatusEvent,
	WechatBoundEvent,
	WechatConfig,
	WechatQREvent,
	WechatUnboundEvent,
	WhatsappBindStatusEvent,
	WhatsappBoundEvent,
	WhatsappConfig,
	WhatsappQREvent,
	WhatsappUnboundEvent,
} from "./host-protocol.js";
import { LogBuffer } from "./log-buffer.js";
import { archiveLegacyFiles, detectLegacyImGateway, type LegacyDetection } from "./migration.js";
import { electronProxyResolver, resolveSidecarProxyEnv } from "./proxy-env.js";
import { type SidecarConfig, SidecarManager } from "./sidecar-manager.js";
import { detectSignalCli } from "./signal-cli-locator.js";
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
	// Static-credential channels mirror the feishu pattern: secrets are
	// echoed back so the settings form can re-render saved values.
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
		/** A signal-cli device is linked (cached; see ImConfig.signal). */
		bound: boolean;
		/** Account signal-cli is registered as, once linked. */
		account?: string;
		/** Set only in the advanced "I run my own daemon" mode. */
		endpoint?: string;
		cliPath?: string;
		allowedNumbers?: string[];
		attachmentsDir?: string;
		/** Resolved signal-cli path, or undefined when it is not installed. */
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
	// Per-channel blocks follow the feishu convention: omitting a block
	// preserves the stored values; sending one replaces that channel's
	// config (and, for secret fields, its credentials).
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
		// Empty endpoint (the default) keeps Signal in managed mode: the
		// sidecar runs signal-cli itself and the account comes from the
		// device link, so neither field needs filling in.
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

/** Whatsapp counterpart of WechatBindEvent, same dispatch shape. */
export type WhatsappBindEvent =
	| ({ kind: "qr" } & WhatsappQREvent)
	| ({ kind: "status" } & WhatsappBindStatusEvent)
	| ({ kind: "bound" } & WhatsappBoundEvent)
	| ({ kind: "unbound" } & WhatsappUnboundEvent);

/**
 * Signal counterpart of WechatBindEvent. The "qr" variant carries the
 * `sgnl://linkdevice?...` URI signal-cli printed rather than an image.
 */
export type SignalBindEvent =
	| ({ kind: "qr" } & SignalQREvent)
	| ({ kind: "status" } & SignalBindStatusEvent)
	| ({ kind: "bound" } & SignalBoundEvent)
	| ({ kind: "unbound" } & SignalUnboundEvent);

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

	// Whatsapp bind subscribers, same semantics as wechatBindHandlers.
	private whatsappBindHandlers: Set<(event: WhatsappBindEvent) => void> = new Set();
	private signalBindHandlers: Set<(event: SignalBindEvent) => void> = new Set();

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
				onWhatsappQR: (event) => {
					this.dispatchWhatsappBindEvent({ kind: "qr", ...event });
				},
				onWhatsappBindStatus: (event) => {
					this.dispatchWhatsappBindEvent({ kind: "status", ...event });
				},
				onWhatsappBound: (event) => {
					// Same convenience-cache persistence as the wechat path:
					// flip `bound` so the renderer shows the state without an
					// extra roundtrip on next launch.
					this.config = {
						...this.config,
						whatsapp: { ...this.config.whatsapp, bound: true },
					};
					try {
						saveImConfig(this.config);
					} catch (err) {
						this.appendLog("warn", `save whatsapp bound state failed: ${(err as Error).message}`);
					}
					this.dispatchWhatsappBindEvent({ kind: "bound", ...event });
				},
				onWhatsappUnbound: (event) => {
					this.config = {
						...this.config,
						whatsapp: { ...this.config.whatsapp, bound: false },
					};
					try {
						saveImConfig(this.config);
					} catch (err) {
						this.appendLog("warn", `save whatsapp unbound state failed: ${(err as Error).message}`);
					}
					this.dispatchWhatsappBindEvent({ kind: "unbound", ...event });
				},
				onSignalQR: (event) => {
					this.dispatchSignalBindEvent({ kind: "qr", ...event });
				},
				onSignalBindStatus: (event) => {
					this.dispatchSignalBindEvent({ kind: "status", ...event });
				},
				onSignalBound: (event) => {
					// Cache both the linked flag and the discovered number:
					// the account is what the user would otherwise have had
					// to look up and type into settings.
					this.config = {
						...this.config,
						signal: { ...this.config.signal, bound: true, account: event.account },
					};
					try {
						saveImConfig(this.config);
					} catch (err) {
						this.appendLog("warn", `save signal bound state failed: ${(err as Error).message}`);
					}
					this.dispatchSignalBindEvent({ kind: "bound", ...event });
				},
				onSignalUnbound: (event) => {
					this.config = {
						...this.config,
						signal: { ...this.config.signal, bound: false, account: undefined },
					};
					try {
						saveImConfig(this.config);
					} catch (err) {
						this.appendLog("warn", `save signal unbound state failed: ${(err as Error).message}`);
					}
					this.dispatchSignalBindEvent({ kind: "unbound", ...event });
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

	// =========================================================================
	// whatsapp bind flow API (mirrors the wechat flow above)
	// =========================================================================

	/**
	 * Begin (or restart) a whatsapp QR pairing flow. Transparently flips
	 * the config to whatsapp + enabled if needed so the bind dialog "just
	 * works" from any starting state, then waits briefly for the sidecar
	 * to reach awaiting_bind before sending the bind-start frame.
	 */
	async startWhatsappBind(): Promise<{ ok: boolean; error?: string }> {
		if (this.config.transport !== "whatsapp" || !this.config.enabled) {
			const flip = await this.setConfig({
				enabled: true,
				transport: "whatsapp",
			});
			if (!flip.ok) {
				return { ok: false, error: flip.error ?? "切换到 WhatsApp 失败" };
			}
		}
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			if (this.statusStore.get().transport === "awaiting_bind" || this.config.whatsapp.bound) {
				break;
			}
			await new Promise((r) => setTimeout(r, 100));
		}
		this.manager.startWhatsappBind();
		return { ok: true };
	}

	/**
	 * Clear the sidecar-owned whatsapp session and re-enter awaiting_bind
	 * state. When the sidecar isn't running on whatsapp, only the cached
	 * bound flag is wiped so the UI updates.
	 */
	async whatsappLogout(): Promise<{ ok: boolean; error?: string }> {
		if (this.config.transport === "whatsapp" && this.manager.getCurrentChild()) {
			this.manager.whatsappLogout();
		} else {
			this.config = { ...this.config, whatsapp: { ...this.config.whatsapp, bound: false } };
			try {
				saveImConfig(this.config);
			} catch (err) {
				return { ok: false, error: (err as Error).message };
			}
		}
		return { ok: true };
	}

	/**
	 * Subscribe to whatsapp bind-flow events. Returns an unsubscribe
	 * function. Multiple subscribers are supported (one per renderer
	 * window).
	 */
	subscribeWhatsappBind(handler: (event: WhatsappBindEvent) => void): () => void {
		this.whatsappBindHandlers.add(handler);
		return () => {
			this.whatsappBindHandlers.delete(handler);
		};
	}

	private dispatchWhatsappBindEvent(event: WhatsappBindEvent): void {
		for (const h of this.whatsappBindHandlers) {
			try {
				h(event);
			} catch (err) {
				this.appendLog("warn", `whatsapp bind handler threw: ${(err as Error).message}`);
			}
		}
	}

	// =========================================================================
	// signal link flow API (mirrors the whatsapp flow above)
	// =========================================================================

	/**
	 * Begin (or restart) the signal-cli device-link flow, flipping the
	 * active transport to signal first so the button works from any
	 * starting state.
	 *
	 * Fails fast when signal-cli is not installed: there is nothing the
	 * sidecar could do, and the user needs the install command rather than
	 * a QR dialog that never fills in.
	 */
	async startSignalBind(): Promise<{ ok: boolean; error?: string }> {
		const detected = detectSignalCli(this.config.signal.cliPath);
		if (!detected.path) {
			return { ok: false, error: `未检测到 signal-cli，请先安装：${detected.installHint}` };
		}
		if (this.config.transport !== "signal" || !this.config.enabled) {
			const flip = await this.setConfig({ enabled: true, transport: "signal" });
			if (!flip.ok) {
				return { ok: false, error: flip.error ?? "切换到 Signal 失败" };
			}
		}
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			if (this.statusStore.get().transport === "awaiting_bind" || this.config.signal.bound) {
				break;
			}
			await new Promise((r) => setTimeout(r, 100));
		}
		this.manager.startSignalBind();
		return { ok: true };
	}

	/**
	 * Drop the linked Signal device. When the sidecar is running on
	 * signal it also clears the Vetta-owned signal-cli data; otherwise
	 * only the cached flag is wiped so the UI updates.
	 */
	async signalLogout(): Promise<{ ok: boolean; error?: string }> {
		if (this.config.transport === "signal" && this.manager.getCurrentChild()) {
			this.manager.signalLogout();
		} else {
			this.config = {
				...this.config,
				signal: { ...this.config.signal, bound: false, account: undefined },
			};
			try {
				saveImConfig(this.config);
			} catch (err) {
				return { ok: false, error: (err as Error).message };
			}
		}
		return { ok: true };
	}

	// =========================================================================
	// unbind (every channel)
	// =========================================================================

	/**
	 * Disconnect one channel: drop its credentials/identifiers and, for the
	 * pairing-based ones, tell the sidecar to forget its session too.
	 *
	 * Static-credential channels cannot run without their tokens, so if the
	 * cleared channel is the active transport the bridge is switched off and
	 * the sidecar stopped — otherwise it would restart-loop against an empty
	 * config. Pairing channels keep running: the sidecar parks in
	 * awaiting_bind, ready for the next scan.
	 */
	async clearChannel(transport: ImTransportSelector): Promise<{ ok: boolean; error?: string }> {
		const descriptor = getImChannelDescriptor(transport);
		const isActive = this.config.transport === transport;

		// Pairing channels own state inside the sidecar (wechat credentials
		// file, whatsapp session db, signal-cli config dir). Let the
		// existing logout paths clear it while the sidecar is still up.
		if (descriptor.credentialKind === "qr-bind" && isActive && this.manager.getCurrentChild()) {
			if (transport === "wechat") this.manager.wechatLogout();
			if (transport === "whatsapp") this.manager.whatsappLogout();
			if (transport === "signal") this.manager.signalLogout();
		}

		const nextConfig = descriptor.clearConfig(this.config);
		const nextCredentials = descriptor.clearCredentials(this.credentials);
		const mustDisable = isActive && !descriptor.hasRequiredCredentials(nextConfig, nextCredentials);

		this.config = mustDisable ? { ...nextConfig, enabled: false } : nextConfig;
		this.credentials = nextCredentials;

		try {
			saveImConfig(this.config);
		} catch (err) {
			return { ok: false, error: `save config failed: ${(err as Error).message}` };
		}
		try {
			saveCredentials(this.credentials);
		} catch (err) {
			return { ok: false, error: `save credentials failed: ${(err as Error).message}` };
		}

		this.appendLog("info", `channel ${transport} disconnected by user`);

		if (!isActive) {
			return { ok: true };
		}
		if (this.config.enabled && this.hasRequiredCredentials()) {
			if (this.manager.getCurrentChild()) {
				await this.manager.applyConfig(this.buildSidecarConfig());
			}
		} else {
			await this.manager.stop();
			this.statusStore.patch({ transport: "offline", lastError: undefined });
		}
		return { ok: true };
	}

	/** Subscribe to signal link-flow events. Returns an unsubscribe fn. */
	subscribeSignalBind(handler: (event: SignalBindEvent) => void): () => void {
		this.signalBindHandlers.add(handler);
		return () => {
			this.signalBindHandlers.delete(handler);
		};
	}

	private dispatchSignalBindEvent(event: SignalBindEvent): void {
		for (const h of this.signalBindHandlers) {
			try {
				h(event);
			} catch (err) {
				this.appendLog("warn", `signal bind handler threw: ${(err as Error).message}`);
			}
		}
	}

	getPublicConfig(): ImHostPublicConfig {
		// Detection is filesystem state, not saved config: the user may
		// install signal-cli while this settings page is open.
		const signalCli = detectSignalCli(this.config.signal.cliPath);
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
			telegram: {
				botToken: this.credentials.telegram?.botToken ?? "",
				allowedUserIds: this.config.telegram.allowedUserIds,
			},
			slack: {
				botToken: this.credentials.slack?.botToken ?? "",
				appToken: this.credentials.slack?.appToken ?? "",
				allowedUserIds: this.config.slack.allowedUserIds,
				allowedChannelIds: this.config.slack.allowedChannelIds,
			},
			discord: {
				botToken: this.credentials.discord?.botToken ?? "",
				allowedUserIds: this.config.discord.allowedUserIds,
				allowedGuildIds: this.config.discord.allowedGuildIds,
			},
			signal: {
				bound: this.config.signal.bound,
				account: this.config.signal.account,
				endpoint: this.config.signal.endpoint,
				cliPath: this.config.signal.cliPath,
				allowedNumbers: this.config.signal.allowedNumbers,
				attachmentsDir: this.config.signal.attachmentsDir,
				cliDetectedPath: signalCli.path,
				cliInstallHint: signalCli.installHint,
			},
			whatsapp: {
				bound: this.config.whatsapp.bound,
				allowedNumbers: this.config.whatsapp.allowedNumbers,
			},
			imessage: {
				dbPath: this.config.imessage.dbPath,
				allowedHandles: this.config.imessage.allowedHandles,
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
			telegram: payload.telegram ? { allowedUserIds: payload.telegram.allowedUserIds } : this.config.telegram,
			slack: payload.slack
				? {
						allowedUserIds: payload.slack.allowedUserIds,
						allowedChannelIds: payload.slack.allowedChannelIds,
					}
				: this.config.slack,
			discord: payload.discord
				? {
						allowedUserIds: payload.discord.allowedUserIds,
						allowedGuildIds: payload.discord.allowedGuildIds,
					}
				: this.config.discord,
			signal: payload.signal
				? {
						// `bound` is sidecar-owned state, never sent by the
						// settings form.
						bound: this.config.signal.bound,
						endpoint: payload.signal.endpoint || undefined,
						account: payload.signal.account || undefined,
						cliPath: payload.signal.cliPath || undefined,
						allowedNumbers: payload.signal.allowedNumbers,
						attachmentsDir: payload.signal.attachmentsDir,
					}
				: this.config.signal,
			whatsapp: payload.whatsapp
				? {
						bound: this.config.whatsapp.bound,
						allowedNumbers: payload.whatsapp.allowedNumbers,
					}
				: this.config.whatsapp,
			imessage: payload.imessage
				? {
						dbPath: payload.imessage.dbPath,
						allowedHandles: payload.imessage.allowedHandles,
					}
				: this.config.imessage,
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

		// Update credentials only for the channels whose block the payload
		// sent — same convention as the config merge above. Secrets never
		// enter config-store; non-secret allow-lists never enter here.
		const nextCreds: ImCredentials = { ...this.credentials };
		if (payload.feishu) {
			nextCreds.feishu = {
				appSecret: payload.feishu.appSecret ?? "",
				verificationToken: payload.feishu.verificationToken,
				encryptKey: payload.feishu.encryptKey,
			};
		}
		if (payload.telegram) {
			nextCreds.telegram = { botToken: payload.telegram.botToken ?? "" };
		}
		if (payload.slack) {
			nextCreds.slack = {
				botToken: payload.slack.botToken ?? "",
				appToken: payload.slack.appToken ?? "",
			};
		}
		if (payload.discord) {
			nextCreds.discord = { botToken: payload.discord.botToken ?? "" };
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

	getPaths(): {
		config: string;
		credentials: string;
		state: string;
		wechatState: string;
		whatsappState: string;
		signalConfigDir: string;
	} {
		return {
			config: defaultImConfigPath(),
			credentials: defaultCredentialsPath(),
			state: defaultImStatePath(),
			wechatState: defaultWechatStatePath(),
			whatsappState: defaultWhatsappStatePath(),
			signalConfigDir: defaultSignalConfigDir(),
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

	/** Whether the active transport has enough info to start the sidecar.
	 * The per-channel rules live in the descriptor registry (channels.ts). */
	private hasRequiredCredentials(): boolean {
		return getImChannelDescriptor(this.config.transport).hasRequiredCredentials(this.config, this.credentials);
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

	private buildTelegramConfig(): TelegramConfig {
		return {
			botToken: this.credentials.telegram?.botToken ?? "",
			allowedUserIds: this.config.telegram.allowedUserIds,
		};
	}

	private buildSlackConfig(): SlackConfig {
		return {
			botToken: this.credentials.slack?.botToken ?? "",
			appToken: this.credentials.slack?.appToken ?? "",
			allowedUserIds: this.config.slack.allowedUserIds,
			allowedChannelIds: this.config.slack.allowedChannelIds,
		};
	}

	private buildDiscordConfig(): DiscordConfig {
		return {
			botToken: this.credentials.discord?.botToken ?? "",
			allowedUserIds: this.config.discord.allowedUserIds,
			allowedGuildIds: this.config.discord.allowedGuildIds,
		};
	}

	/**
	 * Signal slot. With no endpoint configured the sidecar runs signal-cli
	 * itself, so we hand it the executable we resolved (a launched .app has
	 * a minimal PATH, and the sidecar inherits it) plus a Vetta-owned
	 * config directory that an unbind may safely clear.
	 */
	private buildSignalConfig(): SignalConfig {
		const managed = !this.config.signal.endpoint;
		const detected = detectSignalCli(this.config.signal.cliPath);
		return {
			endpoint: this.config.signal.endpoint,
			account: this.config.signal.account,
			cliPath: detected.path,
			configDir: managed ? defaultSignalConfigDir() : undefined,
			ownsConfigDir: managed,
			allowedNumbers: this.config.signal.allowedNumbers,
			attachmentsDir: this.config.signal.attachmentsDir,
		};
	}

	private buildWhatsappConfig(): WhatsappConfig {
		return {
			enabled: true,
			statePath: defaultWhatsappStatePath(),
			allowedNumbers: this.config.whatsapp.allowedNumbers,
		};
	}

	private buildIMessageConfig(): IMessageConfig {
		return {
			enabled: true,
			dbPath: this.config.imessage.dbPath,
			allowedHandles: this.config.imessage.allowedHandles,
		};
	}

	/**
	 * Per-transport channel slot builders. Exactly one slot is sent per
	 * init/config_update frame — the sidecar uses nil-discrimination to
	 * pick which transport to start.
	 */
	private readonly channelSlotBuilders: Record<ImTransportSelector, () => Partial<SidecarConfig>> = {
		feishu: () => ({ feishu: this.buildFeishuConfig() }),
		wechat: () => ({ wechat: this.buildWechatConfig() }),
		telegram: () => ({ telegram: this.buildTelegramConfig() }),
		slack: () => ({ slack: this.buildSlackConfig() }),
		discord: () => ({ discord: this.buildDiscordConfig() }),
		signal: () => ({ signal: this.buildSignalConfig() }),
		whatsapp: () => ({ whatsapp: this.buildWhatsappConfig() }),
		imessage: () => ({ imessage: this.buildIMessageConfig() }),
	};

	/**
	 * Proxy env handed to the sidecar, refreshed each time it is started.
	 * Empty when the machine goes direct or already exports a proxy.
	 */
	private proxyEnv: Record<string, string> = {};

	/**
	 * Resolve the proxy the way Electron would and log the outcome, so a
	 * "cannot reach the platform" report can be told apart from a bad
	 * credential at a glance.
	 */
	private async refreshProxyEnv(): Promise<void> {
		const resolved = await resolveSidecarProxyEnv(electronProxyResolver);
		this.proxyEnv = resolved.env;
		if (resolved.source === "system") {
			this.appendLog("info", `sidecar proxy: following system proxy ${resolved.proxy}`);
		} else if (resolved.source === "inherited") {
			this.appendLog("info", "sidecar proxy: inheriting proxy environment from the app");
		}
	}

	private buildSidecarConfig(): SidecarConfig {
		if (!this.binaryPath) {
			this.binaryPath = resolveImGatewayBinary().path;
			this.statusStore.patch({ binaryPath: this.binaryPath });
		}
		const codingAgent = buildCodingAgentSpec({ agentModel: this.config.agentModel });
		return {
			binaryPath: this.binaryPath,
			conversationCwd: DEFAULT_IM_CONVERSATION_CWD,
			state: this.stateAsEntries(),
			codingAgent,
			proxyEnv: this.proxyEnv,
			...this.channelSlotBuilders[this.config.transport](),
		};
	}

	private stateAsEntries(): SessionStateEntry[] {
		return this.state.sessions.map((s) => ({ ...s }));
	}

	private async startSidecar(): Promise<void> {
		try {
			await this.refreshProxyEnv();
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
