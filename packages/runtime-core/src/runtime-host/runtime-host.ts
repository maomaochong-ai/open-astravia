import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import type { ThinkingLevel } from "@vetta/agent-core";
import type { Message } from "@vetta/ai";
import {
	type AgentSession,
	type SessionEntry as CodingSessionEntry,
	type ConversationScenario,
	type CreateAgentSessionOptions,
	createAgentSession,
	DEFAULT_SCENARIO,
	type ExtensionUIContext,
	loadEntriesFromFile,
	type ModelRegistry,
	type SessionInfo,
	SessionManager,
	type SubagentSnapshot,
} from "@vetta/coding-agent";
import type {
	AgentPluginContinuationInvoker,
	AgentPluginRuntimeConfig,
	AgentPluginSystemPromptInvoker,
	AgentPluginToolInvoker,
	BackgroundTaskInfo,
	HistoryEntry,
	ProjectInfo,
	PromptRequest,
	RuntimeQuestionItem,
	RuntimeSandboxGrantDecision,
	RuntimeSandboxGrantInfo,
	RuntimeSandboxGrantRequest,
	RuntimeUserConfirmationRequest,
	RuntimeUserQuestionRequest,
	RuntimeUserQuestionResult,
	SessionConfig,
	SessionEvent,
	SessionExecutionMode,
	SessionFacade,
	SessionHistoryInfo,
	SessionStateSnapshot,
	SettingsPatch,
} from "../contracts.js";
import { runtimeError } from "../errors.js";
import {
	clearSessionGrants,
	listSessionGrants,
	revokeAllSessionGrants,
	revokeSessionGrant,
} from "../execution-mode/sandbox-permissions.js";
import { buildSandboxToolDefinitions } from "../execution-mode/sandbox-tools.js";
import { branchFromFileEntries, entriesToHistory } from "./history.js";
import { generateAutoTitle, generateNextPromptSuggestions } from "./peripheral-tasks.js";
import { debugPluginAgent, summarizeAgentPlugins } from "./plugin-debug.js";
import {
	baseSessionEvent,
	flushPendingError,
	lifecycleSessionEvent,
	type MapAgentEventState,
	mapAgentSessionEvent,
} from "./session-events.js";
import type { InFlightBuffer, RunningChangedReason, RuntimeHostOptions, SessionHandle } from "./types.js";

export type { RunningChangedReason, RuntimeHostOptions } from "./types.js";

/**
 * 空闲会话提前 apply 挂起插件配置的防抖窗口。插件 activate 期间会按工具逐个
 * reconfigure，这个窗口把它们合成一次 runtime 重建。
 */
const IDLE_AGENT_PLUGIN_APPLY_DELAY_MS = 300;

/**
 * 运行时宿主：会话生命周期、事件订阅、执行模式与沙箱授权的编排层。
 * 历史解析 / 事件映射 / 周边 LLM 任务已拆到同目录独立模块。
 */
export class RuntimeHost implements SessionFacade {
	private sessions = new Map<string, SessionHandle>();
	private currentTurnStartedAt = new Map<string, number>();
	/** 见 session-events.ts「错误延迟发射」：prompt() 收尾时兑现。 */
	private pendingError: MapAgentEventState["pendingError"] = new Map();
	private inFlightBuffers = new Map<string, InFlightBuffer>();
	private inFlightUnsubscribers = new Map<string, () => void>();
	/**
	 * 外部订阅者表。`subscribe()` 在挂到 session.subscribe 的同时把 handler 也
	 * 登记在这里，方便 RuntimeHost 自己注入合成事件（例如 prompt 同步抛错时
	 * 把 error 事件广播出去，否则错误只会以 IPC reject 形式回到调用方，
	 * 一旦调用方没 try/catch 就被静默吞掉）。
	 */
	private externalSubscribers = new Map<string, Set<(event: SessionEvent) => void>>();
	/**
	 * session 级订阅清理函数。一个 session 只应挂一次
	 * handle.session.subscribe()，后续 subscribe() 调用只把 handler
	 * 追加到 externalSubscribers 中，由同一个 session 级监听器广播。
	 */
	private sessionSubscriptions = new Map<string, () => void>();
	/**
	 * 当前正在 streaming 的 session 集合（key 为 sessionPath / sessionFile）。
	 * 在 attachInFlightBuffer 里随 agent_start/agent_end/aborted 同步维护，并通过
	 * runningChangedHandlers 广播给宿主（main 进程 IPC 层），用于侧边栏渲染 spin。
	 */
	private runningSessionPaths = new Set<string>();
	private runningChangedHandlers = new Set<
		(sessionPath: string, running: boolean, sessionId?: string, reason?: RunningChangedReason) => void
	>();
	private readonly getDefaultExecutionMode: () => SessionExecutionMode | Promise<SessionExecutionMode>;
	private readonly additionalSkillPaths: string[];
	private readonly sandboxHostPath: string | undefined;
	private readonly linuxBubblewrapPath: string | undefined;
	private readonly macosSandboxExecPath: string | undefined;
	private readonly serverUrl: string | undefined;
	private readonly modelRegistry: ModelRegistry | undefined;
	private userConfirmationHandler:
		| ((request: RuntimeUserConfirmationRequest, signal?: AbortSignal) => Promise<boolean>)
		| undefined;
	private userQuestionHandler:
		| ((request: RuntimeUserQuestionRequest, signal?: AbortSignal) => Promise<RuntimeUserQuestionResult>)
		| undefined;
	private userSandboxGrantHandler:
		| ((request: RuntimeSandboxGrantRequest, signal?: AbortSignal) => Promise<RuntimeSandboxGrantDecision>)
		| undefined;
	private pluginToolInvoker: AgentPluginToolInvoker | undefined;
	private pluginContinuationInvoker: AgentPluginContinuationInvoker | undefined;
	private pluginSystemPromptInvoker: AgentPluginSystemPromptInvoker | undefined;

	constructor(options: RuntimeHostOptions = {}) {
		this.getDefaultExecutionMode = options.getDefaultExecutionMode ?? (() => "sandbox");
		this.additionalSkillPaths = [...(options.additionalSkillPaths ?? [])];
		this.sandboxHostPath = options.sandboxHostPath;
		this.linuxBubblewrapPath = options.linuxBubblewrapPath;
		this.macosSandboxExecPath = options.macosSandboxExecPath;
		this.serverUrl = options.serverUrl;
		this.modelRegistry = options.modelRegistry;
		this.userConfirmationHandler = options.userConfirmationHandler;
		this.userQuestionHandler = options.userQuestionHandler;
		this.userSandboxGrantHandler = options.userSandboxGrantHandler;
	}

	setUserConfirmationHandler(
		handler: ((request: RuntimeUserConfirmationRequest, signal?: AbortSignal) => Promise<boolean>) | undefined,
	): void {
		this.userConfirmationHandler = handler;
	}

	setUserQuestionHandler(
		handler:
			| ((request: RuntimeUserQuestionRequest, signal?: AbortSignal) => Promise<RuntimeUserQuestionResult>)
			| undefined,
	): void {
		this.userQuestionHandler = handler;
	}

	setUserSandboxGrantHandler(
		handler:
			| ((request: RuntimeSandboxGrantRequest, signal?: AbortSignal) => Promise<RuntimeSandboxGrantDecision>)
			| undefined,
	): void {
		this.userSandboxGrantHandler = handler;
	}

	setPluginToolInvoker(handler: AgentPluginToolInvoker | undefined): void {
		this.pluginToolInvoker = handler;
	}

	setPluginContinuationInvoker(handler: AgentPluginContinuationInvoker | undefined): void {
		this.pluginContinuationInvoker = handler;
	}

	setPluginSystemPromptInvoker(handler: AgentPluginSystemPromptInvoker | undefined): void {
		this.pluginSystemPromptInvoker = handler;
	}

	private withAdditionalSkillPaths(
		agentPlugins: AgentPluginRuntimeConfig | undefined,
	): AgentPluginRuntimeConfig | undefined {
		if (this.additionalSkillPaths.length === 0) return agentPlugins;
		return {
			...(agentPlugins ?? {}),
			skillPathContributions: [
				...(agentPlugins?.skillPathContributions ?? []),
				{
					pluginId: "runtime-host:additional-skills",
					paths: this.additionalSkillPaths,
				},
			],
		};
	}

	reconfigureAgentPlugins(agentPlugins: AgentPluginRuntimeConfig | undefined): void {
		const nextAgentPlugins = this.withAdditionalSkillPaths(agentPlugins);
		debugPluginAgent("runtime reconfigure requested", {
			sessionCount: this.sessions.size,
			...summarizeAgentPlugins(nextAgentPlugins),
		});
		for (const [sessionId, handle] of this.sessions) {
			if (!handle.agentPluginsEnabled) {
				debugPluginAgent("runtime reconfigure skip: plugins disabled", { sessionId });
				continue;
			}
			handle.pendingAgentPlugins = nextAgentPlugins;
			handle.hasPendingAgentPlugins = true;
			debugPluginAgent("runtime reconfigure deferred until prompt", { sessionId });
			this.scheduleIdleAgentPluginApply(sessionId, handle);
		}
	}

	/**
	 * 空闲会话不必等到下一次 prompt 才 apply：插件是在会话创建之后才异步 activate 的，
	 * 若一直挂起，renderer 拿到的 activeToolNames 会长期停在插件就绪之前的旧集合
	 * （输入栏 badge 因此不出现）。streaming / bash 运行中仍走原来的 turn 边界路径。
	 */
	private scheduleIdleAgentPluginApply(sessionId: string, handle: SessionHandle): void {
		if (handle.idleAgentPluginTimer) clearTimeout(handle.idleAgentPluginTimer);
		handle.idleAgentPluginTimer = setTimeout(() => {
			handle.idleAgentPluginTimer = undefined;
			if (!this.sessions.has(sessionId)) return;
			void this.applyPendingAgentPlugins(sessionId, handle).catch((error: unknown) => {
				console.warn(`[RuntimeHost.scheduleIdleAgentPluginApply] session=${sessionId} apply failed:`, error);
			});
		}, IDLE_AGENT_PLUGIN_APPLY_DELAY_MS);
	}

	/**
	 * 激活工具集变化时向订阅者广播一次快照（同一集合不重复广播）。
	 */
	private broadcastActiveToolNames(sessionId: string, handle: SessionHandle): void {
		const activeToolNames = handle.session.getActiveToolNames();
		const fingerprint = [...activeToolNames].sort().join(" ");
		if (handle.lastBroadcastActiveToolNames === fingerprint) return;
		handle.lastBroadcastActiveToolNames = fingerprint;
		this.broadcastSyntheticEvent(sessionId, {
			...baseSessionEvent(sessionId, "runtime-core"),
			type: "active_tools_update",
			activeToolNames,
		});
	}

	listSandboxGrants(sessionId: string): RuntimeSandboxGrantInfo[] {
		return listSessionGrants(sessionId).map((entry) => ({
			id: entry.id,
			sessionId: entry.sessionId,
			toolName: entry.toolName,
			capability: entry.capability,
			grantRoot: entry.grantRoot,
			firstTarget: entry.firstTarget,
			createdAt: entry.createdAt,
		}));
	}

	revokeSandboxGrant(sessionId: string, grantId: string): boolean {
		return revokeSessionGrant(sessionId, grantId);
	}

	revokeAllSandboxGrants(sessionId: string): number {
		return revokeAllSessionGrants(sessionId);
	}

	/**
	 * 清除指定 session 中已结束的「后台工作」条目（bash 后台任务 + 终端态子代理）。
	 * 活动面板「清除已结束」共用此入口；返回合计清除数量。
	 */
	clearFinishedBackgroundTasks(sessionId: string): number {
		const handle = this.sessions.get(sessionId);
		if (!handle) return 0;
		const bash = handle.session.backgroundTasks.clearFinished();
		const subagents = handle.session.clearFinishedSubagents();
		return bash + subagents;
	}

	/**
	 * 用户从 UI 手动终止后台任务。
	 * 成功时进程结束会触发 onNotify，向 agent 注入「用户手动终止」的 task-notification。
	 */
	killBackgroundTask(sessionId: string, taskId: string): boolean {
		const handle = this.sessions.get(sessionId);
		if (!handle) return false;
		return handle.session.backgroundTasks.kill(taskId, "user");
	}

	/**
	 * 当前后台任务快照。renderer 重载后 atom 状态丢失而注册表仍在内存，
	 * 订阅方用它在重新订阅时回放一次全量状态（事件流只在状态变化时推送）。
	 */
	listBackgroundTasks(sessionId: string): BackgroundTaskInfo[] {
		const handle = this.sessions.get(sessionId);
		if (!handle) return [];
		return handle.session.backgroundTasks.list();
	}

	/** Full subagent snapshot for UI rehydrate (same role as listBackgroundTasks). */
	listSubagents(sessionId: string): SubagentSnapshot[] {
		const handle = this.sessions.get(sessionId);
		if (!handle) return [];
		return [...handle.session.listSubagents()];
	}

	interruptSubagent(sessionId: string, target: string): SubagentSnapshot | undefined {
		const handle = this.sessions.get(sessionId);
		if (!handle) return undefined;
		return handle.session.interruptSubagent(target);
	}

	/**
	 * Push a new server token to the ModelRegistry and refresh remote models.
	 * Call this after login / logout so long-lived sessions pick up auth changes
	 * without an app restart.
	 *
	 * 共享 modelRegistry 模式（desktop-app）：单点更新，所有 session 立即看到。
	 * 兼容旧模式（无共享 registry）：遍历每个 session 的 registry。
	 */
	async reloadServerAuth(token: string | undefined): Promise<void> {
		if (this.modelRegistry) {
			try {
				this.modelRegistry.setServerToken(token);
				// 没 token 时 loadRemoteModels 内部直接早退；有 token 时拉一次最新。
				await this.modelRegistry.loadRemoteModels();
			} catch (err) {
				console.warn("[RuntimeHost] reloadServerAuth (shared) failed:", err);
			}
			return;
		}
		const handles = Array.from(this.sessions.values());
		await Promise.all(
			handles.map(async ({ session }) => {
				try {
					session.modelRegistry.setServerToken(token);
					await session.modelRegistry.loadRemoteModels();
				} catch (err) {
					console.warn("[RuntimeHost] reloadServerAuth failed for session:", err);
				}
			}),
		);
	}

	/**
	 * Look up an open SessionHandle by absolute session file path.
	 * Used to dedupe re-opens of the same file (avoids self-conflicts on the
	 * file lock, since SessionManager rejects same-pid re-acquisition).
	 */
	private findHandleBySessionPath(sessionPath: string): { sessionId: string; handle: SessionHandle } | undefined {
		const target = resolvePath(sessionPath);
		for (const [sessionId, handle] of this.sessions) {
			const openPath = handle.session.sessionFile;
			if (openPath && resolvePath(openPath) === target) {
				return { sessionId, handle };
			}
		}
		return undefined;
	}

	async createSession(config: SessionConfig = {}): Promise<{ sessionId: string }> {
		// Dedupe by sessionPath: a SessionManager.open() takes an exclusive file
		// lock, and the lock module treats same-pid re-acquisition as a real
		// conflict. So if the renderer reopens a session this RuntimeHost is
		// already holding, we must return the existing handle instead of opening
		// a second one.
		if (config.sessionPath && config.sessionPath.trim().length > 0) {
			const existing = this.findHandleBySessionPath(config.sessionPath);
			if (existing) {
				if (config.executionMode !== undefined && config.executionMode !== existing.handle.executionMode) {
					await this.setExecutionMode(existing.sessionId, config.executionMode);
				}
				if (config.enableAgentPlugins === true && !existing.handle.agentPluginsEnabled) {
					existing.handle.agentPluginsEnabled = true;
					existing.handle.pendingAgentPlugins = this.withAdditionalSkillPaths(config.agentPlugins);
					existing.handle.hasPendingAgentPlugins = true;
					this.scheduleIdleAgentPluginApply(existing.sessionId, existing.handle);
				}
				await existing.handle.session.bindExtensions({
					uiContext: this.createExtensionUIContext({ current: existing.sessionId }),
				});
				return { sessionId: existing.sessionId };
			}
		}

		const sessionManager =
			config.sessionPath && config.sessionPath.trim().length > 0
				? SessionManager.open(config.sessionPath)
				: config.cwd
					? SessionManager.create(config.cwd, config.sessionDir)
					: undefined;

		const requestedMode = config.executionMode;
		const defaultMode = await this.getDefaultExecutionMode();
		const executionMode = requestedMode ?? defaultMode;
		const effectiveCwd = config.cwd ?? process.cwd();
		const sessionIdRef: { current?: string } = {};
		const baseCustomTools = this.resolveExecutionModeTools(executionMode, effectiveCwd, () => sessionIdRef.current);
		const customTools = baseCustomTools;
		debugPluginAgent("runtime createSession start", {
			enableAgentPlugins: config.enableAgentPlugins === true,
			hasPluginToolInvoker: this.pluginToolInvoker != null,
			...summarizeAgentPlugins(config.agentPlugins),
		});
		const options: CreateAgentSessionOptions = {
			cwd: config.cwd,
			agentDir: config.agentDir,
			sessionManager,
			model: config.model,
			thinkingLevel: config.thinkingLevel,
			scenario: config.scenario,
			agentMode: config.agentMode,
			customTools,
			appendSystemPrompt: config.appendSystemPrompt,
			env: config.env,
			enableBackgroundTasks: config.enableBackgroundTasks,
			// Fail-closed product gate: only interactive conversation/project/cli roots.
			// batch/automation/kb-processing/im-claw stay off until lifecycle is designed.
			enableSubagents: shouldEnableSubagents(config.scenario),
			includeAgentSkills: config.includeAgentSkills,
			agentPlugins: this.withAdditionalSkillPaths(config.agentPlugins),
			invokePluginTool: this.pluginToolInvoker
				? (invocation, signal) =>
						this.pluginToolInvoker?.(invocation, signal) ?? Promise.resolve({ value: undefined, effects: [] })
				: undefined,
			invokePluginContinuation: this.pluginContinuationInvoker
				? (invocation, signal) =>
						this.pluginContinuationInvoker?.(invocation, signal) ?? Promise.resolve({ value: null, effects: [] })
				: undefined,
			invokePluginSystemPrompt: this.pluginSystemPromptInvoker
				? (invocation, signal) => this.pluginSystemPromptInvoker?.(invocation, signal) ?? Promise.resolve([])
				: undefined,
			// 「向用户提问」能力：只有宿主显式允许的 session 才会注册工具；
			// isEnabled / ask 仍实时读取 this.userQuestionHandler，保留动态开关能力。
			askUserQuestion:
				config.askUserQuestion === true
					? {
							isEnabled: () => this.userQuestionHandler != null,
							ask: async (
								request: { questions: RuntimeQuestionItem[] },
								signal?: AbortSignal,
							): Promise<RuntimeUserQuestionResult> => {
								const handler = this.userQuestionHandler;
								if (!handler || signal?.aborted) {
									return { cancelled: true, answers: [] };
								}
								return handler(
									{
										requestId: randomUUID(),
										sessionId: sessionIdRef.current ?? "",
										questions: request.questions,
									},
									signal,
								);
							},
						}
					: undefined,
			serverUrl: this.serverUrl,
			// 传入共享 registry，sdk 内部就会跳过它自己的远程 fetch 分支
			// （sdk.ts: `if (!options.modelRegistry) { ... loadRemoteModels() }`）。
			modelRegistry: this.modelRegistry,
		};

		const { session } = await createAgentSession(options);
		const sessionId = session.sessionId;
		sessionIdRef.current = sessionId;
		await session.bindExtensions({ uiContext: this.createExtensionUIContext(sessionIdRef) });
		this.sessions.set(sessionId, {
			session,
			executionMode,
			agentPluginsEnabled: config.enableAgentPlugins === true,
			pendingAgentPlugins: undefined,
			hasPendingAgentPlugins: false,
			scenario: config.scenario ?? DEFAULT_SCENARIO,
			agentMode: config.agentMode,
			pendingAgentMode: undefined,
			hasPendingAgentMode: false,
			idleAgentPluginTimer: undefined,
			agentPluginApplyInFlight: undefined,
			lastBroadcastActiveToolNames: undefined,
		});
		debugPluginAgent("runtime createSession registered", {
			sessionId,
			agentPluginsEnabled: config.enableAgentPlugins === true,
		});
		this.attachInFlightBuffer(sessionId, session);

		// Stale-while-revalidate：当前的远程 model 数据已就绪可用（来自启动预热
		// 或上一次刷新），这里再 fire-and-forget 一次刷新，不 await。
		// - loadRemoteModels 内部对 inflight 做了 dedupe，并发安全；
		// - 未登录时该方法立即早退，无副作用；
		// - 任何错误已在 doLoadRemoteModels 内静默吞掉，不会扩散。
		// 效果：用户每次 createSession 都会触发一次"下一次会更新"的后台刷新。
		if (this.modelRegistry) {
			void this.modelRegistry.loadRemoteModels();
		}
		return { sessionId };
	}

	/**
	 * Attach a permanent listener to the session that maintains the in-flight
	 * buffer regardless of whether any external subscriber is connected. Replayed
	 * by `subscribe()` so a re-subscribing renderer sees prior in-flight content.
	 */
	private attachInFlightBuffer(sessionId: string, session: AgentSession): void {
		const buffer: InFlightBuffer = {
			turnStartedAt: 0,
			text: "",
			thinking: "",
			toolCallStarts: [],
			isActive: false,
		};
		this.inFlightBuffers.set(sessionId, buffer);
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "agent_start") {
				buffer.turnStartedAt = Date.now();
				buffer.text = "";
				buffer.thinking = "";
				buffer.toolCallStarts = [];
				buffer.isActive = true;
				this.markRunning(session.sessionFile, true, sessionId);
				return;
			}
			if (event.type === "agent_end") {
				buffer.text = "";
				buffer.thinking = "";
				buffer.toolCallStarts = [];
				buffer.isActive = false;
				// 区分自然结束 / abort / error：agent-loop 保证 agent_end 的 messages
				// 末条恒为 assistant，stopReason 即回合结局。仅自然结束（非 aborted/error）
				// 透传 "agent_end" reason，触发 renderer 侧队列出队。
				const last = event.messages.at(-1);
				const stopReason = last?.role === "assistant" ? last.stopReason : undefined;
				const reason: RunningChangedReason =
					stopReason === "aborted" ? "aborted" : stopReason === "error" ? "error" : "agent_end";
				this.markRunning(session.sessionFile, false, sessionId, reason);
				return;
			}
			if (event.type === "message_end") {
				// Each LLM call inside a multi-step turn ends with message_end and
				// its content gets persisted to history. The chat draft in the UI
				// keeps accumulating across calls, but the buffer should reset so
				// it only ever holds the *current* in-flight LLM call's deltas.
				buffer.text = "";
				buffer.thinking = "";
				buffer.toolCallStarts = [];
				return;
			}
			if (event.type === "message_update") {
				const sub = event.assistantMessageEvent;
				if (sub.type === "text_delta") {
					buffer.text += sub.delta;
				} else if (sub.type === "thinking_delta") {
					buffer.thinking += sub.delta;
				} else if (sub.type === "toolcall_start") {
					const idx = sub.contentIndex;
					const tc = sub.partial?.content?.[idx];
					if (tc && tc.type === "toolCall") {
						buffer.toolCallStarts.push({
							toolCallId: String(tc.id ?? ""),
							toolName: String(tc.name ?? ""),
						});
					}
				}
			}
		});
		this.inFlightUnsubscribers.set(sessionId, unsubscribe);
	}

	async setExecutionMode(sessionId: string, mode: SessionExecutionMode): Promise<void> {
		const handle = this.requireSession(sessionId);
		if (handle.executionMode === mode) return;
		this.assertCanSwitchExecutionMode(handle);

		const sessionAny = handle.session as AgentSession & {
			reconfigureCustomTools?: (customTools: CreateAgentSessionOptions["customTools"]) => void;
		};
		if (typeof sessionAny.reconfigureCustomTools !== "function") {
			throw runtimeError("INTERNAL_ERROR", "Session does not support execution mode reconfiguration.", false);
		}

		const cwd = handle.session.sessionManager.getCwd() ?? process.cwd();
		const customTools = this.resolveExecutionModeTools(mode, cwd, () => sessionId);
		sessionAny.reconfigureCustomTools(customTools);
		handle.executionMode = mode;
	}

	async setGlobalExecutionMode(mode: SessionExecutionMode): Promise<void> {
		const pending = Array.from(this.sessions.entries()).filter(([, handle]) => handle.executionMode !== mode);
		for (const [, handle] of pending) {
			this.assertCanSwitchExecutionMode(handle);
		}
		for (const [sessionId] of pending) {
			await this.setExecutionMode(sessionId, mode);
		}
	}

	/**
	 * 全局切换工作模式（agent_mode 轴，纯全局态）。对每个 mode 不同的活跃 session 写 pending，
	 * 于各自下一个 turn 边界（prompt 入口）apply，避免 streaming 中途换工具集。见 ADR-0046。
	 */
	setGlobalAgentMode(mode: string): void {
		for (const handle of this.sessions.values()) {
			if (handle.agentMode === mode) {
				handle.pendingAgentMode = undefined;
				handle.hasPendingAgentMode = false;
				continue;
			}
			handle.pendingAgentMode = mode;
			handle.hasPendingAgentMode = true;
		}
	}

	async prompt(sessionId: string, request: PromptRequest): Promise<void> {
		const handle = this.requireSession(sessionId);
		await this.applyPendingAgentPlugins(sessionId, handle);
		this.applyPendingAgentMode(handle);

		// Ensure the session model matches the requested model BEFORE prompting,
		// so the model actually used is always the one the UI displays.
		if (request.modelKey) {
			const [provider, ...rest] = request.modelKey.split("/");
			const modelId = rest.join("/");
			// getAvailable() filters out providers where authStorage.hasAuth() is
			// false. Local custom providers (e.g. a self-hosted qwen-local) can
			// fail that check even when fully configured in models.json — the
			// fallback resolver depends on construction-time state and some
			// host-process scenarios race with it. Fall back to find() so an
			// explicit user selection isn't silently dropped; if auth is truly
			// missing, the provider request itself will return a clean error.
			const available = handle.session.modelRegistry.getAvailable();
			const model =
				available.find((m) => m.provider === provider && m.id === modelId) ??
				handle.session.modelRegistry.find(provider, modelId);
			if (model) {
				const current = handle.session.model;
				if (!current || current.provider !== provider || current.id !== modelId) {
					await handle.session.setModel(model);
				}
			}
		}

		// Apply the per-turn reasoning level (rides alongside modelKey) BEFORE prompting so
		// the model and its chosen effort stay consistent. setModel above re-clamps thinking
		// to the new model, so this must run after it.
		if (request.reasoning) {
			handle.session.setThinkingLevel(request.reasoning);
		}

		// Session cwd (esp. desktop ADR-0007 per-session dirs) may have been deleted
		// while the handle stayed open (clear-artifacts, manual cleanup). Heal before tools run.
		const sessionCwd = handle.session.sessionManager.getCwd();
		if (sessionCwd) {
			try {
				await mkdir(sessionCwd, { recursive: true });
			} catch (err) {
				console.warn(`[RuntimeHost.prompt] failed to ensure session cwd ${sessionCwd}:`, err);
			}
		}

		let images = request.images;
		let text = request.text;
		if (images && images.length > 0) {
			const model = handle.session.model;
			if (!model?.input?.includes("image")) {
				console.warn(
					`[RuntimeHost.prompt] Model ${model?.id} does not support image input (input=${JSON.stringify(model?.input)}), stripping ${images.length} images`,
				);
				images = undefined;
				if (text === "(see attached images)") {
					text =
						"(User attempted to send images, but the current model does not support image input. Please inform the user that this model cannot process images.)";
				}
			}
		}
		try {
			await handle.session.prompt(text, {
				images,
				streamingBehavior: request.streamingBehavior,
				promptRef: request.promptRef,
				attachments: request.attachments,
				source: "extension",
				metadata: request.metadata,
			});
		} catch (err) {
			// session.prompt 在进入 agent.start 之前会做同步校验（"No model
			// selected"、"No API key found"、"Agent is already processing"
			// 等），抛出的异常 *不会* 经由 session 事件流回到订阅者。如果不
			// 主动把它转换成一个 error 事件，renderer 这边的体验就是「发了一
			// 条消息但完全没反应、没气泡、没 spinner、没报错」（issue 现象）。
			// 这里合成一个 error 事件广播给所有 subscribe() 拿过 handler 的
			// 订阅者，然后照原样把异常再向上抛，scheduler / batch-tasks 等
			// 已经自带 try/catch 的调用方仍然能拿到 reject 做重试 / 落账。
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[RuntimeHost.prompt] session=${sessionId} pre-stream error: ${message}`);
			this.broadcastSyntheticEvent(sessionId, {
				...baseSessionEvent(sessionId, "agent"),
				type: "error",
				error: runtimeError("INTERNAL_ERROR", message, false, "runtime"),
			});
			throw err;
		} finally {
			// 延迟发射的错误在这里兑现：prompt() 等待的是含自动重试的整个 agent
			// 循环，走到这一步重试已尘埃落定。abort / throw 也过 finally，所以
			// 不存在错误被永久吞掉的路径。详见 session-events.ts 与 ADR-0038。
			this.flushPendingSessionError(sessionId);
		}
	}

	/** 把挂起的 assistant 错误兑现成一条 error 事件广播出去（没有则静默返回）。 */
	private flushPendingSessionError(sessionId: string): void {
		const event = flushPendingError(sessionId, {
			currentTurnStartedAt: this.currentTurnStartedAt,
			pendingError: this.pendingError,
		});
		if (event) this.broadcastSyntheticEvent(sessionId, event);
	}

	async continue(sessionId: string): Promise<void> {
		const handle = this.requireSession(sessionId);
		await this.applyPendingAgentPlugins(sessionId, handle);
		this.applyPendingAgentMode(handle);
		try {
			await handle.session.agent.continue();
		} finally {
			// continue() 同样跑完整个 agent 循环，与 prompt() 一样要兑现挂起错误。
			this.flushPendingSessionError(sessionId);
		}
	}

	async abort(sessionId: string): Promise<void> {
		const handle = this.requireSession(sessionId);
		await handle.session.abort();
	}

	/**
	 * 清空 session 的 todo 列表。被 scene 等机制 lock 时拒绝清空。
	 * 返回是否实际执行了清空。
	 */
	async clearTodos(sessionId: string): Promise<boolean> {
		const handle = this.requireSession(sessionId);
		const store = handle.session.todoStore;
		if (store.isLocked()) return false;
		if (store.getAll().length === 0) return false;
		store.clear();
		return true;
	}

	subscribe(sessionId: string, handler: (event: SessionEvent) => void): () => void {
		const handle = this.requireSession(sessionId);
		handler(lifecycleSessionEvent(sessionId, "created"));

		// Push current todo state so late subscribers (e.g., user navigating into
		// an already-running session) see the todo panel immediately.
		const todoItems = handle.session.todoStore.getAll();
		if (todoItems.length > 0) {
			handler({
				...baseSessionEvent(sessionId, "agent"),
				type: "todo_update",
				items: [...todoItems],
			} as SessionEvent);
		}

		// Replay in-flight assistant deltas accumulated since agent_start so that
		// a renderer reconnecting mid-stream (e.g. after switching sessions away
		// and back) sees the partial assistant content. Without this, any text
		// produced before reconnection would be lost (the runtime only persists
		// assistant messages on message_end, and a fresh subscribe only forwards
		// future events).
		const buffer = this.inFlightBuffers.get(sessionId);
		if (buffer?.isActive) {
			if (buffer.thinking) {
				handler({
					...baseSessionEvent(sessionId, "agent"),
					type: "thinking.delta",
					delta: buffer.thinking,
				});
			}
			if (buffer.text) {
				handler({
					...baseSessionEvent(sessionId, "agent"),
					type: "message.delta",
					delta: buffer.text,
				});
			}
			for (const tc of buffer.toolCallStarts) {
				handler({
					...baseSessionEvent(sessionId, "agent"),
					type: "toolcall.start",
					toolCallId: tc.toolCallId,
					toolName: tc.toolName,
				});
			}
		}

		// 登记到外部订阅者表，便于 prompt() 等同步路径直接广播合成事件
		// （session.subscribe 链路要求事件先经过 session.emit → mapEvent，
		// 而 prompt 期的 throw 拿不到 session emit 这一条线）。
		let externals = this.externalSubscribers.get(sessionId);
		if (!externals) {
			externals = new Set();
			this.externalSubscribers.set(sessionId, externals);
		}
		externals.add(handler);

		// 一个 session 只挂一次 session 级订阅，后续 handler 共享同一事件流。
		// 避免多个 runtime.subscribe() 调用创建多个 AgentSession 监听器，
		// 导致 mapEvent 中的副作用（如 persistAssistantTurnTiming）重复执行。
		if (!this.sessionSubscriptions.has(sessionId)) {
			const unsubscribeSession = handle.session.subscribe((event) => {
				const mapped = mapAgentSessionEvent(sessionId, event, handle.session, {
					currentTurnStartedAt: this.currentTurnStartedAt,
					pendingError: this.pendingError,
				});
				const subs = this.externalSubscribers.get(sessionId);
				if (!subs) return;
				for (const sub of subs) {
					for (const m of mapped) {
						sub(m);
					}
				}
			});
			this.sessionSubscriptions.set(sessionId, unsubscribeSession);
		}

		return () => {
			const set = this.externalSubscribers.get(sessionId);
			if (set) {
				set.delete(handler);
				if (set.size === 0) {
					this.externalSubscribers.delete(sessionId);
					const unsub = this.sessionSubscriptions.get(sessionId);
					if (unsub) {
						unsub();
						this.sessionSubscriptions.delete(sessionId);
					}
				}
			}
		};
	}

	/**
	 * 向某个 session 当前所有的外部订阅者广播一个合成事件。仅用于 RuntimeHost
	 * 内部，覆盖那些 session 事件流本身覆盖不到的边界（例如 prompt 入参校验
	 * 同步 throw 的场景）。
	 */
	private broadcastSyntheticEvent(sessionId: string, event: SessionEvent): void {
		const subscribers = this.externalSubscribers.get(sessionId);
		if (!subscribers || subscribers.size === 0) return;
		for (const handler of subscribers) {
			try {
				handler(event);
			} catch (err) {
				console.warn(`[RuntimeHost.broadcastSyntheticEvent] subscriber threw:`, err);
			}
		}
	}

	async updateSettings(sessionId: string, partialSettings: SettingsPatch): Promise<void> {
		const handle = this.requireSession(sessionId);
		if (partialSettings.modelKey) {
			const [provider, ...rest] = partialSettings.modelKey.split("/");
			const modelId = rest.join("/");
			// 见 prompt() 中的同名注释：getAvailable() 会因为 hasAuth 误判把本地 provider 过滤
			// 掉，导致用户的显式选择被静默丢弃。先尝试 available，再回退到 registry.find()。
			const available = handle.session.modelRegistry.getAvailable();
			const model =
				available.find((m) => m.provider === provider && m.id === modelId) ??
				handle.session.modelRegistry.find(provider, modelId);
			if (model) {
				await handle.session.setModel(model);
			}
		}
		if (partialSettings.thinkingLevel) {
			handle.session.setThinkingLevel(partialSettings.thinkingLevel);
		}
		if (partialSettings.steeringMode) {
			handle.session.setSteeringMode(partialSettings.steeringMode);
		}
		if (partialSettings.followUpMode) {
			handle.session.setFollowUpMode(partialSettings.followUpMode);
		}
	}

	updateGlobalThinkingLevel(level: ThinkingLevel): void {
		for (const handle of this.sessions.values()) {
			handle.session.setThinkingLevel(level);
		}
	}

	getState(sessionId: string): SessionStateSnapshot {
		const handle = this.requireSession(sessionId);
		const contextUsage = handle.session.getContextUsage();
		const header = handle.session.sessionManager.getHeader();
		return {
			sessionId,
			model: handle.session.model,
			thinkingLevel: handle.session.thinkingLevel,
			executionMode: handle.executionMode,
			isStreaming: handle.session.isStreaming,
			currentTurnStartedAt: this.currentTurnStartedAt.get(sessionId),
			messageCount: handle.session.messages.length,
			contextPercent: contextUsage?.percent ?? null,
			contextWindow: contextUsage?.contextWindow ?? 0,
			activeToolNames: handle.session.getActiveToolNames(),
			scenario: handle.scenario,
			parentSessionPath: header?.parentSession,
			parentEntryId: header?.parentEntryId,
		};
	}

	getMessages(sessionId: string): Message[] {
		const handle = this.requireSession(sessionId);
		return handle.session.messages.filter((message): message is Message => {
			return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
		});
	}

	getFullHistory(sessionId: string): HistoryEntry[] {
		const handle = this.requireSession(sessionId);
		const sm = handle.session.sessionManager;
		const branch = handle.session.getSessionBranch();
		return entriesToHistory(branch, { allEntries: sm.getEntries() });
	}

	/**
	 * Read a session .jsonl directly from disk and translate to HistoryEntry[].
	 * Does NOT acquire the session-file lock — used by the desktop sidebar's
	 * read-only viewer for IM sessions where the sidecar may be actively
	 * writing to the same file.
	 */
	readSessionHistoryFromFile(path: string): { history: HistoryEntry[] } {
		const fileEntries = loadEntriesFromFile(path);
		const branch = branchFromFileEntries(fileEntries);
		const allEntries = fileEntries.filter((e): e is CodingSessionEntry => e.type !== "session");
		return { history: entriesToHistory(branch, { allEntries }) };
	}

	/**
	 * Prepare re-edit of a user message (leaf → parent). Returns extracted text.
	 * Does not send a prompt; the host should prompt after the user edits.
	 * Throws if entryId is missing from this session (stale pending edit after fork/switch).
	 */
	async navigateForEdit(sessionId: string, entryId: string): Promise<{ text: string; cancelled: boolean }> {
		const handle = this.requireSession(sessionId);
		if (handle.session.isStreaming || handle.session.isBashRunning) {
			throw new Error("Cannot edit message while the session is streaming");
		}
		const entry = handle.session.sessionManager.getEntry(entryId);
		if (!entry) {
			throw new Error(`Entry ${entryId} not found`);
		}
		const result = await handle.session.navigateTree(entryId, { summarize: false });
		if (result.cancelled) {
			return { text: "", cancelled: true };
		}
		return { text: result.editorText ?? "", cancelled: false };
	}

	/** Switch leaf to the tip of another branch (same session file). */
	async switchBranch(sessionId: string, entryId: string): Promise<{ leafId: string }> {
		const handle = this.requireSession(sessionId);
		if (handle.session.isStreaming || handle.session.isBashRunning) {
			throw new Error("Cannot switch branch while the session is streaming");
		}
		return handle.session.switchBranch(entryId);
	}

	/** Delete one message while retaining the rest of the active branch. */
	async deleteMessage(sessionId: string, entryId: string): Promise<{ leafId: string | null }> {
		const handle = this.requireSession(sessionId);
		if (handle.session.isStreaming || handle.session.isBashRunning) {
			throw new Error("Cannot delete a message while the session is streaming");
		}
		return handle.session.deleteMessage(entryId);
	}

	/** Remove the active branch's last user turn so the next prompt replaces it in place. */
	async replaceLastUserMessage(sessionId: string, entryId: string): Promise<{ leafId: string | null }> {
		const handle = this.requireSession(sessionId);
		if (handle.session.isStreaming || handle.session.isBashRunning) {
			throw new Error("Cannot replace a message while the session is streaming");
		}
		const result = handle.session.sessionManager.replaceLastUserMessage(entryId);
		handle.session.agent.replaceMessages(handle.session.sessionManager.buildSessionContext().messages);
		return result;
	}

	/**
	 * Export a fork as a new session file without leaving the current session.
	 */
	async forkSession(sessionId: string, entryId: string): Promise<{ path: string; text: string }> {
		const handle = this.requireSession(sessionId);
		if (handle.session.isStreaming || handle.session.isBashRunning) {
			throw new Error("Cannot fork while the session is streaming");
		}
		return handle.session.exportForkToNewFile(entryId);
	}

	async listProjects(): Promise<ProjectInfo[]> {
		const sessions = await SessionManager.listAll();
		const byCwd = new Map<string, number>();
		for (const session of sessions) {
			const key = session.cwd || process.cwd();
			byCwd.set(key, (byCwd.get(key) ?? 0) + 1);
		}
		return Array.from(byCwd.entries())
			.map(([cwd, sessionCount]) => ({ cwd, sessionCount }))
			.sort((a, b) => a.cwd.localeCompare(b.cwd));
	}

	async listSessions(cwd: string, sessionDir?: string): Promise<SessionHistoryInfo[]> {
		const sessions = await SessionManager.list(cwd, sessionDir);
		return sessions.map((session: SessionInfo) => ({
			id: session.id,
			path: session.path,
			cwd: session.cwd,
			name: session.name,
			firstMessage: session.firstMessage,
			modifiedAt: session.modified.getTime(),
			lastMessagePreview: session.lastMessagePreview,
			parentSessionPath: session.parentSessionPath,
			parentEntryId: session.parentEntryId,
		}));
	}

	async deleteSession(sessionPath: string): Promise<void> {
		// If we currently hold this session open, dispose it first so the file
		// lock is released and the in-memory handle does not outlive the file.
		const existing = this.findHandleBySessionPath(sessionPath);
		if (existing) {
			this.inFlightUnsubscribers.get(existing.sessionId)?.();
			this.inFlightUnsubscribers.delete(existing.sessionId);
			this.inFlightBuffers.delete(existing.sessionId);
			// session 销毁不是回合结束：传 sessionId 但不带 reason，避免触发出队。
			this.markRunning(existing.handle.session.sessionFile, false, existing.sessionId);
			existing.handle.session.dispose();
			this.sessions.delete(existing.sessionId);
		}
		await rm(sessionPath, { force: true });
		// Clean up any orphaned sentinel lock file (sibling .lock).
		await rm(`${sessionPath}.lock`, { force: true });
	}

	async renameSession(sessionPath: string, name: string): Promise<void> {
		// Prefer the live handle if we already hold one — opening a second
		// SessionManager on the same file would deadlock against our own lock.
		const existing = this.findHandleBySessionPath(sessionPath);
		if (existing) {
			existing.handle.session.setSessionName(name);
			return;
		}
		const manager = SessionManager.open(sessionPath);
		try {
			manager.appendSessionInfo(name);
		} finally {
			manager.close();
		}
	}

	/** Snapshot of session paths whose agent loop is currently active. */
	getRunningSessionPaths(): string[] {
		return Array.from(this.runningSessionPaths);
	}

	/**
	 * Subscribe to running-set changes. Handler receives (sessionPath, running).
	 * Returns an unsubscribe function.
	 */
	onRunningChanged(
		handler: (sessionPath: string, running: boolean, sessionId?: string, reason?: RunningChangedReason) => void,
	): () => void {
		this.runningChangedHandlers.add(handler);
		return () => {
			this.runningChangedHandlers.delete(handler);
		};
	}

	private markRunning(
		sessionPath: string | undefined,
		running: boolean,
		sessionId?: string,
		reason?: RunningChangedReason,
	): void {
		if (!sessionPath) return;
		const had = this.runningSessionPaths.has(sessionPath);
		if (running && had) return;
		if (!running && !had) return;
		if (running) this.runningSessionPaths.add(sessionPath);
		else this.runningSessionPaths.delete(sessionPath);
		for (const h of this.runningChangedHandlers) {
			try {
				h(sessionPath, running, sessionId, reason);
			} catch (err) {
				console.warn("[RuntimeHost.markRunning] handler threw:", err);
			}
		}
	}

	getSessionPath(sessionId: string): string | undefined {
		const handle = this.sessions.get(sessionId);
		if (!handle) return undefined;
		return handle.session.sessionFile;
	}

	renameSessionById(sessionId: string, name: string): void {
		// We already hold the live AgentSession — rename through it directly so
		// we never open a second SessionManager (and second lock) on the file.
		const handle = this.requireSession(sessionId);
		handle.session.setSessionName(name);
	}

	/**
	 * Generate a short title from the first round of conversation and persist it
	 * onto the session. Returns the persisted name, or null when no model is
	 * available or every candidate failed / produced no usable text.
	 */
	async autoTitleSession(sessionId: string, userText: string, assistantText: string): Promise<string | null> {
		const handle = this.requireSession(sessionId);
		const cleaned = await generateAutoTitle(
			{ modelRegistry: handle.session.modelRegistry, sessionModel: handle.session.model },
			sessionId,
			userText,
			assistantText,
		);
		if (!cleaned) return null;
		handle.session.setSessionName(cleaned);
		return cleaned;
	}

	/**
	 * 输入预测：基于最近几轮对话，预测用户下一个可能输入的 prompt。
	 * 自动选用可用模型并失败轮转；返回 0-3 条建议。无可用模型或全部失败时返回 []。
	 * 注意：模型成功返回空建议（对话已收尾）视为合法结果，不轮转。
	 */
	async nextPromptSuggestions(sessionId: string, conversation: string): Promise<string[]> {
		const handle = this.requireSession(sessionId);
		return generateNextPromptSuggestions(
			{ modelRegistry: handle.session.modelRegistry, sessionModel: handle.session.model },
			sessionId,
			conversation,
		);
	}

	async disposeSession(sessionId: string): Promise<void> {
		const handle = this.sessions.get(sessionId);
		if (!handle) return;
		if (handle.idleAgentPluginTimer) {
			clearTimeout(handle.idleAgentPluginTimer);
			handle.idleAgentPluginTimer = undefined;
		}
		this.inFlightUnsubscribers.get(sessionId)?.();
		this.inFlightUnsubscribers.delete(sessionId);
		this.inFlightBuffers.delete(sessionId);
		this.externalSubscribers.delete(sessionId);
		// session 销毁不是回合结束：传 sessionId 但不带 reason，避免触发出队。
		this.markRunning(handle.session.sessionFile, false, sessionId);
		handle.session.dispose();
		this.sessions.delete(sessionId);
		this.currentTurnStartedAt.delete(sessionId);
		this.pendingError.delete(sessionId);
		clearSessionGrants(sessionId);
	}

	/**
	 * Dispose every open session this host owns and release all file locks.
	 * Call from the IPC layer when its host (e.g. an Electron WebContents) is
	 * being torn down — otherwise SessionManager locks survive until process exit.
	 */
	async disposeAllSessions(): Promise<void> {
		for (const [sessionId, handle] of this.sessions) {
			try {
				if (handle.idleAgentPluginTimer) {
					clearTimeout(handle.idleAgentPluginTimer);
					handle.idleAgentPluginTimer = undefined;
				}
				this.inFlightUnsubscribers.get(sessionId)?.();
				handle.session.dispose();
			} catch (err) {
				console.error(`[RuntimeHost.disposeAllSessions] failed to dispose ${sessionId}:`, err);
			}
			clearSessionGrants(sessionId);
		}
		const wasRunning = Array.from(this.runningSessionPaths);
		this.sessions.clear();
		this.currentTurnStartedAt.clear();
		this.pendingError.clear();
		this.inFlightUnsubscribers.clear();
		this.inFlightBuffers.clear();
		this.externalSubscribers.clear();
		this.runningSessionPaths.clear();
		for (const p of wasRunning) {
			for (const h of this.runningChangedHandlers) {
				try {
					h(p, false);
				} catch {
					// 忽略，下游接收方异常不影响其他处理器
				}
			}
		}
	}

	private requireSession(sessionId: string): SessionHandle {
		const handle = this.sessions.get(sessionId);
		if (!handle) {
			throw runtimeError("SESSION_NOT_FOUND", `Session not found: ${sessionId}`, false);
		}
		return handle;
	}

	private async applyPendingAgentPlugins(sessionId: string, handle: SessionHandle): Promise<void> {
		// 空闲期定时 apply 可能正在跑；先等它落定，否则本次 prompt 会跑在重建到一半的工具集上。
		if (handle.agentPluginApplyInFlight) {
			await handle.agentPluginApplyInFlight.catch(() => {
				// 失败已由发起方记录，这里只做同步点。
			});
		}
		if (!handle.agentPluginsEnabled || !handle.hasPendingAgentPlugins) return;
		if (handle.session.isStreaming || handle.session.isBashRunning) return;
		const apply = this.applyPendingAgentPluginsOnce(sessionId, handle);
		handle.agentPluginApplyInFlight = apply.then(
			() => undefined,
			() => undefined,
		);
		try {
			await apply;
		} finally {
			handle.agentPluginApplyInFlight = undefined;
		}
	}

	private async applyPendingAgentPluginsOnce(sessionId: string, handle: SessionHandle): Promise<void> {
		debugPluginAgent("runtime deferred reconfigure apply", { sessionId });
		const pendingAgentPlugins = handle.pendingAgentPlugins;
		handle.pendingAgentPlugins = undefined;
		handle.hasPendingAgentPlugins = false;
		try {
			await handle.session.reconfigureAgentPlugins(pendingAgentPlugins);
		} catch (error) {
			if (!handle.hasPendingAgentPlugins) {
				handle.pendingAgentPlugins = pendingAgentPlugins;
				handle.hasPendingAgentPlugins = true;
			}
			throw error;
		}
		this.broadcastActiveToolNames(sessionId, handle);
	}

	/**
	 * 在 turn 边界应用挂起的工作模式切换（仿 applyPendingAgentPlugins）。
	 * streaming / bash 运行中不 apply，留到再下一个 turn 边界。见 ADR-0046。
	 */
	private applyPendingAgentMode(handle: SessionHandle): void {
		if (!handle.hasPendingAgentMode) return;
		if (handle.session.isStreaming || handle.session.isBashRunning) return;
		const pendingAgentMode = handle.pendingAgentMode;
		handle.pendingAgentMode = undefined;
		handle.hasPendingAgentMode = false;
		handle.agentMode = pendingAgentMode;
		handle.session.setAgentMode(pendingAgentMode);
	}

	private assertCanSwitchExecutionMode(handle: SessionHandle): void {
		if (handle.session.isStreaming || handle.session.isBashRunning) {
			throw runtimeError(
				"EXECUTION_MODE_SWITCH_BLOCKED",
				"Cannot switch execution mode while the agent is running.",
				true,
			);
		}
	}

	private resolveExecutionModeTools(
		executionMode: SessionExecutionMode,
		cwd: string,
		getSessionId: () => string | undefined,
	): CreateAgentSessionOptions["customTools"] {
		if (executionMode !== "sandbox") return undefined;
		return buildSandboxToolDefinitions({
			cwd,
			windowsSandboxHostPath: this.sandboxHostPath,
			linuxBubblewrapPath: this.linuxBubblewrapPath,
			macosSandboxExecPath: this.macosSandboxExecPath,
			getSessionId,
		});
	}

	private createExtensionUIContext(sessionIdRef: { current?: string }): ExtensionUIContext {
		return {
			select: async () => undefined,
			confirm: async (title, message, opts) => {
				const handler = this.userConfirmationHandler;
				if (!handler || opts?.signal?.aborted) return false;
				return handler(
					{
						requestId: randomUUID(),
						sessionId: sessionIdRef.current ?? "",
						title,
						message,
					},
					opts?.signal,
				);
			},
			input: async () => undefined,
			notify: () => {},
			onTerminalInput: () => () => {},
			setStatus: () => {},
			setWorkingMessage: () => {},
			setWidget: () => {},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: () => {},
			custom: async () => undefined as never,
			pasteToEditor: () => {},
			setEditorText: () => {},
			getEditorText: () => "",
			editor: async () => undefined,
			setEditorComponent: () => {},
			theme: {} as ExtensionUIContext["theme"],
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: false, error: "Desktop runtime theme switching is unavailable." }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
			requestSandboxGrant: async (request) => {
				const handler = this.userSandboxGrantHandler;
				if (!handler) return "deny";
				return handler({
					requestId: randomUUID(),
					sessionId: sessionIdRef.current ?? "",
					title: request.title,
					message: request.message,
					toolName: request.toolName,
					capability: request.capability,
					target: request.target,
					resolvedTarget: request.resolvedTarget,
					grantRoot: request.grantRoot,
					command: request.command,
					sensitive: request.sensitive,
				});
			},
		};
	}
}

/** Subagents first ship on interactive roots only (docs/agent/vetta). */
function shouldEnableSubagents(scenario: ConversationScenario | undefined): boolean {
	const s = scenario ?? DEFAULT_SCENARIO;
	return s === "conversation" || s === "project" || s === "cli";
}
