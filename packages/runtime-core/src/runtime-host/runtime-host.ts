import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import type { ThinkingLevel } from "@vetta/agent-core";
import type { Message } from "@vetta/ai";
import type {
	AgentPluginContinuationInvoker,
	AgentPluginHookInvoker,
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
import { isSessionError, runtimeError } from "../errors.js";
import {
	clearSessionGrants,
	listSessionGrants,
	revokeAllSessionGrants,
	revokeSessionGrant,
} from "../execution-mode/sandbox-permissions.js";
import { generateAutoTitle, generateNextPromptSuggestions } from "./peripheral-tasks.js";
import { debugPluginAgent, summarizeAgentPlugins } from "./plugin-debug.js";
import type { RuntimeHostSessionBackend, RuntimeSessionCreateRequest } from "./session-backend.js";
import { baseSessionEvent, lifecycleSessionEvent } from "./session-events.js";
import type {
	RuntimeSessionEventStream,
	RuntimeSessionHostInteractionContext,
	RuntimeSubagentSnapshot,
} from "./session-ports.js";
import type {
	RuntimeSessionAccess,
	RuntimeSessionAccessResolver,
	RuntimeSessionCatalog,
	RuntimeSessionFileHistoryReader,
	RuntimeSharedModelController,
} from "./session-services.js";
import type { InFlightBuffer, RunningChangedReason, RuntimeHostOptions, SessionHandle } from "./types.js";

export type { RunningChangedReason, RuntimeHostOptions } from "./types.js";

const DEFAULT_RUNTIME_SCENARIO: NonNullable<SessionConfig["scenario"]> = "cli";

/** 合并插件激活期间连续产生的配置更新，空闲会话只重建一次工具面。 */
const IDLE_AGENT_PLUGIN_APPLY_DELAY_MS = 300;

/**
 * 运行时宿主：会话生命周期、事件订阅、执行模式与沙箱授权的编排层。
 * 历史解析 / 事件映射 / 周边 LLM 任务已拆到同目录独立模块。
 */
export class RuntimeHost implements SessionFacade {
	private sessions = new Map<string, SessionHandle>();
	private currentTurnStartedAt = new Map<string, number>();
	private inFlightBuffers = new Map<string, InFlightBuffer>();
	private inFlightUnsubscribers = new Map<string, () => void>();
	/**
	 * 外部订阅者表。`subscribe()` 在挂到 Event Stream 的同时把 handler 也
	 * 登记在这里，方便 RuntimeHost 自己注入合成事件（例如 prompt 同步抛错时
	 * 把 error 事件广播出去，否则错误只会以 IPC reject 形式回到调用方，
	 * 一旦调用方没 try/catch 就被静默吞掉）。
	 */
	private externalSubscribers = new Map<string, Set<(event: SessionEvent) => void>>();
	/**
	 * session 级订阅清理函数。一个 session 只应挂一次
	 * handle.eventStream.subscribe()，后续 subscribe() 调用只把 handler
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
	private readonly sessionBackend: RuntimeHostSessionBackend | undefined;
	private readonly sessionCatalog: RuntimeSessionCatalog | undefined;
	private readonly sessionFileHistoryReader: RuntimeSessionFileHistoryReader | undefined;
	private readonly sessionAccessResolver: RuntimeSessionAccessResolver | undefined;
	private readonly sharedModelController: RuntimeSharedModelController | undefined;
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
	private pluginHookInvoker: AgentPluginHookInvoker | undefined;
	private pluginContinuationInvoker: AgentPluginContinuationInvoker | undefined;
	private pluginSystemPromptInvoker: AgentPluginSystemPromptInvoker | undefined;

	constructor(options: RuntimeHostOptions = {}) {
		this.getDefaultExecutionMode = options.getDefaultExecutionMode ?? (() => "sandbox");
		this.additionalSkillPaths = [...(options.additionalSkillPaths ?? [])];
		this.sandboxHostPath = options.sandboxHostPath;
		this.linuxBubblewrapPath = options.linuxBubblewrapPath;
		this.macosSandboxExecPath = options.macosSandboxExecPath;
		this.serverUrl = options.serverUrl;
		this.sessionCatalog = options.sessionCatalog;
		this.sessionFileHistoryReader = options.sessionFileHistoryReader;
		this.sessionAccessResolver = options.sessionAccessResolver;
		this.sharedModelController = options.sharedModelController;
		this.sessionBackend = options.sessionBackend;
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

	setPluginHookInvoker(handler: AgentPluginHookInvoker | undefined): void {
		this.pluginHookInvoker = handler;
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

	private broadcastActiveToolNames(sessionId: string, handle: SessionHandle): void {
		const activeToolNames = [...handle.stateReader.readState().activeToolNames];
		const fingerprint = [...activeToolNames].sort().join("\0");
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
		return handle.backgroundWorkController.clearFinished();
	}

	/**
	 * 用户从 UI 手动终止后台任务。
	 * 成功时进程结束会触发 onNotify，向 agent 注入「用户手动终止」的 task-notification。
	 */
	killBackgroundTask(sessionId: string, taskId: string): boolean {
		const handle = this.sessions.get(sessionId);
		if (!handle) return false;
		return handle.backgroundWorkController.killTask(taskId);
	}

	/**
	 * 当前后台任务快照。renderer 重载后 atom 状态丢失而注册表仍在内存，
	 * 订阅方用它在重新订阅时回放一次全量状态（事件流只在状态变化时推送）。
	 */
	listBackgroundTasks(sessionId: string): BackgroundTaskInfo[] {
		const handle = this.sessions.get(sessionId);
		if (!handle) return [];
		return [...handle.backgroundWorkController.readTasks()];
	}

	/** Full subagent snapshot for UI rehydrate (same role as listBackgroundTasks). */
	listSubagents(sessionId: string): RuntimeSubagentSnapshot[] {
		const handle = this.sessions.get(sessionId);
		if (!handle) return [];
		return [...handle.backgroundWorkController.readSubagents()];
	}

	interruptSubagent(sessionId: string, target: string): RuntimeSubagentSnapshot | undefined {
		const handle = this.sessions.get(sessionId);
		if (!handle) return undefined;
		return handle.backgroundWorkController.interruptSubagent(target);
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
		if (this.sharedModelController) {
			try {
				await this.sharedModelController.refreshAuth(token);
			} catch (err) {
				console.warn("[RuntimeHost] reloadServerAuth (shared) failed:", err);
			}
			return;
		}
		const handles = Array.from(this.sessions.values());
		await Promise.all(
			handles.map(async ({ modelController }) => {
				try {
					await modelController.refreshAuth(token);
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
			const openPath = handle.lifecycle.sessionPath;
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
				await existing.handle.hostInteraction.bind(
					this.createHostInteractionContext({ current: existing.sessionId }),
				);
				return { sessionId: existing.sessionId };
			}
		}

		const requestedMode = config.executionMode;
		const defaultMode = await this.getDefaultExecutionMode();
		const executionMode = requestedMode ?? defaultMode;
		const sessionIdRef: { current?: string } = {};
		debugPluginAgent("runtime createSession start", {
			enableAgentPlugins: config.enableAgentPlugins === true,
			hasPluginToolInvoker: this.pluginToolInvoker != null,
			...summarizeAgentPlugins(config.agentPlugins),
		});
		const request: RuntimeSessionCreateRequest = {
			cwd: config.cwd,
			agentDir: config.agentDir,
			sessionPath: config.sessionPath,
			sessionDir: config.sessionDir,
			model: config.model,
			thinkingLevel: config.thinkingLevel,
			scenario: config.scenario,
			agentMode: config.agentMode,
			executionMode,
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
			invokePluginHook: this.pluginHookInvoker
				? (invocation, signal) =>
						this.pluginHookInvoker?.(invocation, signal) ?? Promise.resolve({ value: undefined, effects: [] })
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
			sandboxHostPath: this.sandboxHostPath,
			linuxBubblewrapPath: this.linuxBubblewrapPath,
			macosSandboxExecPath: this.macosSandboxExecPath,
			getSessionId: () => sessionIdRef.current,
		};

		const {
			lifecycle,
			historyReader,
			historyController,
			hostInteraction,
			executionController,
			workspaceView,
			backgroundWorkController,
			todoController,
			configurationController,
			modelController,
			modelView,
			corePorts,
		} = await this.requireSessionBackend().createAssembly(request);
		const sessionId = lifecycle.sessionId;
		sessionIdRef.current = sessionId;
		await hostInteraction.bind(this.createHostInteractionContext(sessionIdRef));
		this.sessions.set(sessionId, {
			lifecycle,
			historyReader,
			historyController,
			hostInteraction,
			executionController,
			workspaceView,
			backgroundWorkController,
			todoController,
			configurationController,
			modelController,
			modelView,
			...corePorts,
			executionMode,
			agentPluginsEnabled: config.enableAgentPlugins === true,
			pendingAgentPlugins: undefined,
			hasPendingAgentPlugins: false,
			scenario: config.scenario ?? DEFAULT_RUNTIME_SCENARIO,
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
		this.attachInFlightBuffer(sessionId, lifecycle.sessionPath, corePorts.eventStream);

		// 打开「已有」会话且调用方没有指定模型时（Desktop 打开会话就是这条路径），
		// 恢复该会话上一轮实际使用的模型。否则后端只会落到宿主的兜底模型（例如
		// 可用列表第一个），宿主再把这个值 pull 回 UI，用户看到的就是"重启后模型
		// 被重置成第一个"。会话模型本身不落盘，历史里的 assistant 记录是唯一事实源。
		if (config.sessionPath && config.sessionPath.trim().length > 0 && !config.model) {
			await this.restoreModelFromHistory(historyReader, modelController);
		}

		// Stale-while-revalidate：当前的远程 model 数据已就绪可用（来自启动预热
		// 或上一次刷新），这里再 fire-and-forget 一次刷新，不 await。
		// - loadRemoteModels 内部对 inflight 做了 dedupe，并发安全；
		// - 未登录时该方法立即早退，无副作用；
		// - 任何错误已在 doLoadRemoteModels 内静默吞掉，不会扩散。
		// 效果：用户每次 createSession 都会触发一次"下一次会更新"的后台刷新。
		this.sharedModelController?.refreshInBackground();
		return { sessionId };
	}

	/**
	 * 从会话历史里取最后一条 assistant 记录使用的模型并选回。找不到模型、模型已从
	 * catalog 中消失或缺少凭证时静默保持宿主兜底模型——恢复失败不能挡住开会话。
	 */
	private async restoreModelFromHistory(
		historyReader: SessionHandle["historyReader"],
		modelController: SessionHandle["modelController"],
	): Promise<void> {
		// 整体兜底：此时 session 已注册且会话文件锁已持有，任何抛错都会让 createSession
		// 失败并泄漏这个句柄（下一次打开同一路径将撞上 ownership conflict）。模型恢复
		// 是锦上添花，绝不能成为开会话的失败点。
		try {
			const history = historyReader.readHistory();
			for (let index = history.length - 1; index >= 0; index -= 1) {
				const entry = history[index];
				if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
				const { provider, model } = entry.message;
				if (!provider || !model) return;
				await modelController.selectModel(`${provider}/${model}`, "if-changed");
				return;
			}
		} catch {
			// 历史读取失败、模型已下线或缺少凭证时保持宿主兜底模型，用户仍可手动切换。
		}
	}

	/**
	 * Attach a permanent listener to the session that maintains the in-flight
	 * buffer regardless of whether any external subscriber is connected. Replayed
	 * by `subscribe()` so a re-subscribing renderer sees prior in-flight content.
	 */
	private attachInFlightBuffer(
		sessionId: string,
		sessionPath: string | undefined,
		eventStream: RuntimeSessionEventStream,
	): void {
		const buffer: InFlightBuffer = {
			turnStartedAt: 0,
			text: "",
			thinking: "",
			toolCallStarts: [],
			isActive: false,
			terminalReason: undefined,
		};
		this.inFlightBuffers.set(sessionId, buffer);
		const unsubscribe = eventStream.subscribe((event) => {
			if (event.type === "session.lifecycle" && event.phase === "agent_start") {
				this.currentTurnStartedAt.set(sessionId, event.timestamp);
				buffer.turnStartedAt = event.timestamp;
				buffer.text = "";
				buffer.thinking = "";
				buffer.toolCallStarts = [];
				buffer.isActive = true;
				buffer.terminalReason = undefined;
				this.markRunning(sessionPath, true, sessionId);
				return;
			}
			if (event.type === "session.lifecycle" && event.phase === "aborted") {
				buffer.terminalReason = "aborted";
				return;
			}
			if (event.type === "session.lifecycle" && event.phase === "agent_end") {
				this.currentTurnStartedAt.delete(sessionId);
				buffer.text = "";
				buffer.thinking = "";
				buffer.toolCallStarts = [];
				buffer.isActive = false;
				this.markRunning(sessionPath, false, sessionId, buffer.terminalReason ?? "agent_end");
				buffer.terminalReason = undefined;
				return;
			}
			if (event.type === "message.final") {
				// Each LLM call inside a multi-step turn ends with message_end and
				// its content gets persisted to history. The chat draft in the UI
				// keeps accumulating across calls, but the buffer should reset so
				// it only ever holds the *current* in-flight LLM call's deltas.
				buffer.text = "";
				buffer.thinking = "";
				buffer.toolCallStarts = [];
				if (event.message.role === "assistant") {
					if (event.message.stopReason === "aborted") buffer.terminalReason = "aborted";
					else if (event.message.stopReason === "error") buffer.terminalReason = "error";
				}
				return;
			}
			if (event.type === "message.delta") buffer.text += event.delta;
			else if (event.type === "thinking.delta") buffer.thinking += event.delta;
			else if (event.type === "toolcall.start") {
				buffer.toolCallStarts.push({ toolCallId: event.toolCallId, toolName: event.toolName });
			}
		});
		this.inFlightUnsubscribers.set(sessionId, unsubscribe);
	}

	async setExecutionMode(sessionId: string, mode: SessionExecutionMode): Promise<void> {
		const handle = this.requireSession(sessionId);
		if (handle.executionMode === mode) return;
		this.assertCanSwitchExecutionMode(handle);

		await handle.executionController.reconfigure({
			mode,
			sessionId,
			sandboxHostPath: this.sandboxHostPath,
			linuxBubblewrapPath: this.linuxBubblewrapPath,
			macosSandboxExecPath: this.macosSandboxExecPath,
		});
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
			// getAvailable() filters out providers where authStorage.hasAuth() is
			// false. Local custom providers (e.g. a self-hosted qwen-local) can
			// fail that check even when fully configured in models.json — the
			// fallback resolver depends on construction-time state and some
			// host-process scenarios race with it. Fall back to find() so an
			// explicit user selection isn't silently dropped; if auth is truly
			// missing, the provider request itself will return a clean error.
			await handle.modelController.selectModel(request.modelKey, "if-changed");
		}

		// Apply the per-turn reasoning level (rides alongside modelKey) BEFORE prompting so
		// the model and its chosen effort stay consistent. setModel above re-clamps thinking
		// to the new model, so this must run after it.
		if (request.reasoning) {
			handle.modelController.setThinkingLevel(request.reasoning);
		}

		// Session cwd (esp. desktop ADR-0007 per-session dirs) may have been deleted
		// while the handle stayed open (clear-artifacts, manual cleanup). Heal before tools run.
		const sessionCwd = handle.workspaceView.readWorkingDirectory();
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
			const model = handle.modelView.readCurrentModel();
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
			if (handle.stateReader.readState().isStreaming) {
				throw runtimeError("SESSION_BUSY", "Session is already processing another turn.", true, "runtime");
			}
			await handle.turnControl.prompt({
				text,
				images,
				streamingBehavior: request.streamingBehavior,
				promptRef: request.promptRef,
				attachments: request.attachments,
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
			const message = isSessionError(err) ? err.message : err instanceof Error ? err.message : String(err);
			console.error(`[RuntimeHost.prompt] session=${sessionId} pre-stream error: ${message}`);
			this.broadcastSyntheticEvent(sessionId, {
				...baseSessionEvent(sessionId, "agent"),
				type: "error",
				error: isSessionError(err) ? err : runtimeError("INTERNAL_ERROR", message, false, "runtime"),
			});
			throw err;
		}
	}

	async continue(sessionId: string): Promise<void> {
		const handle = this.requireSession(sessionId);
		await this.applyPendingAgentPlugins(sessionId, handle);
		this.applyPendingAgentMode(handle);
		await handle.turnControl.continue();
	}

	async abort(sessionId: string): Promise<void> {
		const handle = this.requireSession(sessionId);
		await handle.turnControl.abort();
	}

	/**
	 * 清空 session 的 todo 列表。被 scene 等机制 lock 时拒绝清空。
	 * 返回是否实际执行了清空。
	 */
	async clearTodos(sessionId: string): Promise<boolean> {
		const handle = this.requireSession(sessionId);
		return handle.todoController.clear();
	}

	subscribe(sessionId: string, handler: (event: SessionEvent) => void): () => void {
		const handle = this.requireSession(sessionId);
		handler(lifecycleSessionEvent(sessionId, "created"));

		// Push current todo state so late subscribers (e.g., user navigating into
		// an already-running session) see the todo panel immediately.
		const todoItems = handle.todoController.readItems();
		if (todoItems.length > 0) {
			handler({
				...baseSessionEvent(sessionId, "agent"),
				type: "todo_update",
				items: [...todoItems],
			} as SessionEvent);
		}

		handler({
			...baseSessionEvent(sessionId, "runtime-core"),
			type: "active_tools_update",
			activeToolNames: [...handle.stateReader.readState().activeToolNames],
		});

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
			const unsubscribeSession = handle.eventStream.subscribe((event) => {
				const subs = this.externalSubscribers.get(sessionId);
				if (!subs) return;
				for (const sub of subs) {
					sub(event);
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
			// 见 prompt() 中的同名注释：getAvailable() 会因为 hasAuth 误判把本地 provider 过滤
			// 掉，导致用户的显式选择被静默丢弃。先尝试 available，再回退到 registry.find()。
			await handle.modelController.selectModel(partialSettings.modelKey, "always");
		}
		if (partialSettings.thinkingLevel) {
			handle.modelController.setThinkingLevel(partialSettings.thinkingLevel);
		}
		if (partialSettings.steeringMode) {
			handle.configurationController.setSteeringMode(partialSettings.steeringMode);
		}
		if (partialSettings.followUpMode) {
			handle.configurationController.setFollowUpMode(partialSettings.followUpMode);
		}
	}

	updateGlobalThinkingLevel(level: ThinkingLevel): void {
		for (const handle of this.sessions.values()) {
			handle.modelController.setThinkingLevel(level);
		}
	}

	getState(sessionId: string): SessionStateSnapshot {
		const handle = this.requireSession(sessionId);
		const state = handle.stateReader.readState();
		return {
			sessionId,
			model: state.model,
			thinkingLevel: state.thinkingLevel,
			executionMode: handle.executionMode,
			isStreaming: state.isStreaming,
			currentTurnStartedAt: this.currentTurnStartedAt.get(sessionId),
			messageCount: state.messageCount,
			contextPercent: state.contextPercent,
			contextWindow: state.contextWindow,
			...(state.contextComposition ? { contextComposition: state.contextComposition } : {}),
			activeToolNames: [...state.activeToolNames],
			scenario: handle.scenario,
			parentSessionPath: state.parentSessionPath,
			parentEntryId: state.parentEntryId,
		};
	}

	getMessages(sessionId: string): Message[] {
		const handle = this.requireSession(sessionId);
		return [...handle.stateReader.readMessages()];
	}

	getFullHistory(sessionId: string): HistoryEntry[] {
		const handle = this.requireSession(sessionId);
		return [...handle.historyReader.readHistory()];
	}

	/**
	 * Read a session .jsonl directly from disk and translate to HistoryEntry[].
	 * Does NOT acquire the session-file lock — used by the desktop sidebar's
	 * read-only viewer for IM sessions where the sidecar may be actively
	 * writing to the same file.
	 */
	readSessionHistoryFromFile(path: string): { history: HistoryEntry[] } {
		return this.requireSessionFileHistoryReader().read(path);
	}

	/** Resolve host capabilities for an existing session without opening or locking it. */
	resolveSessionAccess(sessionPath: string): Promise<RuntimeSessionAccess | undefined> {
		return this.sessionAccessResolver?.resolve(resolvePath(sessionPath)) ?? Promise.resolve(undefined);
	}

	/**
	 * Prepare re-edit of a user message (leaf → parent). Returns extracted text.
	 * Does not send a prompt; the host should prompt after the user edits.
	 * Throws if entryId is missing from this session (stale pending edit after fork/switch).
	 */
	async navigateForEdit(sessionId: string, entryId: string): Promise<{ text: string; cancelled: boolean }> {
		const handle = this.requireSession(sessionId);
		return handle.historyController.navigateForEdit(entryId);
	}

	/** Switch leaf to the tip of another branch (same session file). */
	async switchBranch(sessionId: string, entryId: string): Promise<{ leafId: string }> {
		const handle = this.requireSession(sessionId);
		return handle.historyController.switchBranch(entryId);
	}

	/** Delete one message while retaining the rest of the active branch. */
	async deleteMessage(sessionId: string, entryId: string): Promise<{ leafId: string | null }> {
		const handle = this.requireSession(sessionId);
		return handle.historyController.deleteMessage(entryId);
	}

	/** Remove the active branch's last user turn so the next prompt replaces it in place. */
	async replaceLastUserMessage(sessionId: string, entryId: string): Promise<{ leafId: string | null }> {
		const handle = this.requireSession(sessionId);
		return handle.historyController.replaceLastUserMessage(entryId);
	}

	/**
	 * Export a fork as a new session file without leaving the current session.
	 */
	async forkSession(sessionId: string, entryId: string): Promise<{ path: string; text: string }> {
		const handle = this.requireSession(sessionId);
		return handle.historyController.forkSession(entryId);
	}

	async listProjects(): Promise<ProjectInfo[]> {
		return [...(await this.requireSessionCatalog().listProjects())];
	}

	async listSessions(cwd: string, sessionDir?: string): Promise<SessionHistoryInfo[]> {
		return [...(await this.requireSessionCatalog().listSessions(cwd, sessionDir))];
	}

	async deleteSession(sessionPath: string): Promise<void> {
		await this.assertSessionCapability(sessionPath, "delete");
		// If we currently hold this session open, dispose it first so the file
		// lock is released and the in-memory handle does not outlive the file.
		const existing = this.findHandleBySessionPath(sessionPath);
		if (existing) {
			if (existing.handle.idleAgentPluginTimer) clearTimeout(existing.handle.idleAgentPluginTimer);
			this.detachSessionEventStreams(existing.sessionId);
			this.inFlightBuffers.delete(existing.sessionId);
			this.externalSubscribers.delete(existing.sessionId);
			// session 销毁不是回合结束：传 sessionId 但不带 reason，避免触发出队。
			this.markRunning(existing.handle.lifecycle.sessionPath, false, existing.sessionId);
			await existing.handle.lifecycle.dispose();
			this.sessions.delete(existing.sessionId);
		}
		await this.requireSessionCatalog().deleteSessionArtifacts(sessionPath);
	}

	async renameSession(sessionPath: string, name: string): Promise<void> {
		await this.assertSessionCapability(sessionPath, "rename");
		// Prefer the live handle if we already hold one — opening a second
		// SessionManager on the same file would deadlock against our own lock.
		const existing = this.findHandleBySessionPath(sessionPath);
		if (existing) {
			await existing.handle.historyController.setName(name);
			return;
		}
		await this.requireSessionCatalog().renameSession(sessionPath, name);
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
		return handle.lifecycle.sessionPath;
	}

	async renameSessionById(sessionId: string, name: string): Promise<void> {
		// We already hold the live AgentSession — rename through it directly so
		// we never open a second SessionManager (and second lock) on the file.
		const handle = this.requireSession(sessionId);
		await handle.historyController.setName(name);
	}

	/**
	 * Generate a short title from the first round of conversation and persist it
	 * onto the session. Returns the persisted name, or null when no model is
	 * available or every candidate failed / produced no usable text.
	 */
	async autoTitleSession(sessionId: string, userText: string, assistantText: string): Promise<string | null> {
		const handle = this.requireSession(sessionId);
		const cleaned = await generateAutoTitle(handle.modelView, sessionId, userText, assistantText);
		if (!cleaned) return null;
		await handle.historyController.setName(cleaned);
		return cleaned;
	}

	/**
	 * 输入预测：基于最近几轮对话，预测用户下一个可能输入的 prompt。
	 * 自动选用可用模型并失败轮转；返回 0-3 条建议。无可用模型或全部失败时返回 []。
	 * 注意：模型成功返回空建议（对话已收尾）视为合法结果，不轮转。
	 */
	async nextPromptSuggestions(sessionId: string, conversation: string): Promise<string[]> {
		const handle = this.requireSession(sessionId);
		return generateNextPromptSuggestions(handle.modelView, sessionId, conversation);
	}

	async disposeSession(sessionId: string): Promise<void> {
		const handle = this.sessions.get(sessionId);
		if (!handle) return;
		if (handle.idleAgentPluginTimer) clearTimeout(handle.idleAgentPluginTimer);
		this.detachSessionEventStreams(sessionId);
		this.inFlightBuffers.delete(sessionId);
		this.externalSubscribers.delete(sessionId);
		// session 销毁不是回合结束：传 sessionId 但不带 reason，避免触发出队。
		this.markRunning(handle.lifecycle.sessionPath, false, sessionId);
		await handle.lifecycle.dispose();
		this.sessions.delete(sessionId);
		this.currentTurnStartedAt.delete(sessionId);
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
				if (handle.idleAgentPluginTimer) clearTimeout(handle.idleAgentPluginTimer);
				this.detachSessionEventStreams(sessionId);
				await handle.lifecycle.dispose();
			} catch (err) {
				console.error(`[RuntimeHost.disposeAllSessions] failed to dispose ${sessionId}:`, err);
			}
			clearSessionGrants(sessionId);
		}
		const wasRunning = Array.from(this.runningSessionPaths);
		this.sessions.clear();
		this.currentTurnStartedAt.clear();
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

	private requireSessionBackend(): RuntimeHostSessionBackend {
		if (!this.sessionBackend) {
			throw runtimeError(
				"INTERNAL_ERROR",
				"RuntimeHost requires an explicit sessionBackend composition.",
				false,
				"runtime",
			);
		}
		return this.sessionBackend;
	}

	private requireSessionCatalog(): RuntimeSessionCatalog {
		if (!this.sessionCatalog) {
			throw runtimeError(
				"INTERNAL_ERROR",
				"RuntimeHost requires an explicit sessionCatalog composition.",
				false,
				"runtime",
			);
		}
		return this.sessionCatalog;
	}

	private requireSessionFileHistoryReader(): RuntimeSessionFileHistoryReader {
		if (!this.sessionFileHistoryReader) {
			throw runtimeError(
				"INTERNAL_ERROR",
				"RuntimeHost requires an explicit sessionFileHistoryReader composition.",
				false,
				"runtime",
			);
		}
		return this.sessionFileHistoryReader;
	}

	private async assertSessionCapability(sessionPath: string, capability: "rename" | "delete"): Promise<void> {
		if (!this.sessionAccessResolver) return;
		const access = await this.sessionAccessResolver.resolve(resolvePath(sessionPath));
		if (access?.[capability]) return;
		throw runtimeError("INVALID_REQUEST", `Session does not support ${capability}: ${sessionPath}`, false, "runtime");
	}

	private detachSessionEventStreams(sessionId: string): void {
		this.sessionSubscriptions.get(sessionId)?.();
		this.sessionSubscriptions.delete(sessionId);
		this.inFlightUnsubscribers.get(sessionId)?.();
		this.inFlightUnsubscribers.delete(sessionId);
	}

	private async applyPendingAgentPlugins(sessionId: string, handle: SessionHandle): Promise<void> {
		if (handle.agentPluginApplyInFlight) {
			await handle.agentPluginApplyInFlight.catch(() => {
				// 失败由发起方记录；这里仅等待并发中的配置应用完成。
			});
		}
		if (!handle.agentPluginsEnabled || !handle.hasPendingAgentPlugins) return;
		if (handle.executionController.isBusy()) return;
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
			await handle.configurationController.reconfigureAgentPlugins(pendingAgentPlugins);
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
		if (handle.executionController.isBusy()) return;
		const pendingAgentMode = handle.pendingAgentMode;
		handle.pendingAgentMode = undefined;
		handle.hasPendingAgentMode = false;
		handle.agentMode = pendingAgentMode;
		handle.configurationController.setAgentMode(pendingAgentMode);
	}

	private assertCanSwitchExecutionMode(handle: SessionHandle): void {
		if (handle.executionController.isBusy()) {
			throw runtimeError(
				"EXECUTION_MODE_SWITCH_BLOCKED",
				"Cannot switch execution mode while the agent is running.",
				true,
			);
		}
	}

	private createHostInteractionContext(sessionIdRef: { current?: string }): RuntimeSessionHostInteractionContext {
		return {
			confirm: async (title, message, signal) => {
				const handler = this.userConfirmationHandler;
				if (!handler || signal?.aborted) return false;
				return handler(
					{
						requestId: randomUUID(),
						sessionId: sessionIdRef.current ?? "",
						title,
						message,
					},
					signal,
				);
			},
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
function shouldEnableSubagents(scenario: SessionConfig["scenario"]): boolean {
	const s = scenario ?? DEFAULT_RUNTIME_SCENARIO;
	return s === "conversation" || s === "project" || s === "cli";
}
