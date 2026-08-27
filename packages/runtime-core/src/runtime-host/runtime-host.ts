import type { ThinkingLevel } from "@vetta/agent-core";
import type { Api, Message, Model } from "@vetta/ai";
import { RuntimeAgentRuntime } from "../agents/index.js";
import type {
	HistoryEntry,
	ProjectInfo,
	PromptRequest,
	QueueChangedEvent,
	RuntimeQuestionItem,
	RuntimeSandboxGrantDecision,
	RuntimeSandboxGrantInfo,
	RuntimeSandboxGrantRequest,
	RuntimeTurnPromptOutcome,
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
import type { ConversationDocument } from "../conversation/document.js";
import { isSessionError, runtimeError } from "../errors.js";
import { createRuntimeId } from "../id-generator.js";
import type { RuntimeToolDefinition, SessionContextRecord } from "../kernel/contracts.js";
import { isTurnPersistenceError } from "../kernel/errors.js";
import type { RuntimeObservationPort } from "../observation/index.js";
import {
	createRuntimeObservationPublisher,
	type RuntimeObservationPublisher,
	runtimeObservationFailure,
} from "../observation/index.js";
import type { SessionExtensionEndpointToken } from "../session-extensions/contracts.js";
import { RuntimeHostAgentBackendRegistry } from "./agent-backend-admission.js";
import {
	RUNTIME_HOST_AGENT_BACKEND_OBSERVATION,
	RUNTIME_HOST_LIFECYCLE_OBSERVATION,
	type RuntimeHostLifecycleObservation,
	type RuntimeHostLifecycleOperation,
} from "./observations.js";
import { RetryableCloseController } from "./retryable-cleanup.js";
import { RuntimeHostSession } from "./runtime-host-session.js";
import type { RuntimeHostSessionBackend, RuntimeSessionCreateRequest } from "./session-backend.js";
import { baseSessionEvent, lifecycleSessionEvent, mapRuntimeSessionObservationEvent } from "./session-events.js";
import type {
	RuntimeContextCompactionRequest,
	RuntimeContextCompactionResult,
	RuntimeContextCompactionState,
	RuntimeSessionContextDeliveryMode,
	RuntimeSessionContextUsage,
	RuntimeSessionEventStream,
	RuntimeSessionExecutionObservation,
	RuntimeSessionHostInteractionContext,
	RuntimeSessionQueueController,
	RuntimeSessionQueueStateView,
	RuntimeSessionState,
} from "./session-ports.js";
import type {
	RuntimeHostPathServices,
	RuntimeQueueSidecarStore,
	RuntimeSandboxGrantStore,
	RuntimeSessionAccess,
	RuntimeSessionAccessResolver,
	RuntimeSessionCatalog,
	RuntimeSessionFileHistoryReader,
	RuntimeSharedModelController,
} from "./session-services.js";
import type {
	InFlightBuffer,
	RunningChangedReason,
	RuntimeHostAgentInstallation,
	RuntimeHostAgentInstallationOptions,
	RuntimeHostOptions,
	SessionHandle,
} from "./types.js";

export type { RunningChangedReason, RuntimeHostOptions } from "./types.js";

const DEFAULT_RUNTIME_SCENARIO: NonNullable<SessionConfig["scenario"]> = "cli";

/**
 * 运行时宿主：会话生命周期、事件订阅、执行模式与沙箱授权的编排层。
 * 历史解析 / 事件映射 / 周边 LLM 任务已拆到同目录独立模块。
 */
export class RuntimeHost implements SessionFacade {
	readonly agents: RuntimeAgentRuntime;
	readonly agentBackends: RuntimeHostAgentBackendRegistry;
	private sessions = new Map<string, SessionHandle>();
	/** Canonical and retired Session identities resolve to one Host-owned stable key. */
	private sessionKeysByIdentity = new Map<string, string>();
	private currentSessionIdentityByKey = new Map<string, string>();
	private currentTurnStartedAt = new Map<string, number>();
	private inFlightBuffers = new Map<string, InFlightBuffer>();
	/** 每个队列 sidecar 文件的串行写链（ADR-0060）。 */
	private queueSidecarWrites = new Map<string, Promise<void>>();
	private inFlightUnsubscribers = new Map<string, () => void>();
	/**
	 * 外部订阅者表。`subscribe()` 在挂到 Event Stream 的同时把 handler 也
	 * 登记在这里，方便 RuntimeHost 自己注入合成事件（例如 prompt 同步抛错时
	 * 把 error 事件广播出去，否则错误只会以 IPC reject 形式回到调用方，
	 * 一旦调用方没 try/catch 就被静默吞掉）。
	 */
	private externalSubscribers = new Map<string, Set<(event: SessionEvent) => void>>();
	private externalSubscriberActiveToolFingerprints = new Map<string, WeakMap<(event: SessionEvent) => void, string>>();
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
	private readonly sandboxHostPath: string | undefined;
	private readonly linuxBubblewrapPath: string | undefined;
	private readonly macosSandboxExecPath: string | undefined;
	private readonly serverUrl: string | undefined;
	private readonly sessionBackend: RuntimeHostSessionBackend | undefined;
	private readonly ownsSessionBackend: boolean;
	private readonly observations: RuntimeObservationPublisher;
	private readonly ownsObservationPublisher: boolean;
	private readonly ownedObservationPort: RuntimeObservationPort | undefined;
	private closed = false;
	private readonly closeController: RetryableCloseController;
	private closeTaskIndex = 0;
	private closeCompletedRecorded = false;
	private readonly sessionDisposeAttempts = new Map<string, Promise<void>>();
	private pendingSessionCreationCount = 0;
	private readonly pendingSessionCreationWaiters = new Set<() => void>();
	private readonly sessionCatalog: RuntimeSessionCatalog | undefined;
	private readonly sessionFileHistoryReader: RuntimeSessionFileHistoryReader | undefined;
	private readonly sessionAccessResolver: RuntimeSessionAccessResolver | undefined;
	private readonly sharedModelController: RuntimeSharedModelController | undefined;
	private readonly pathServices: RuntimeHostPathServices | undefined;
	private readonly queueSidecarStore: RuntimeQueueSidecarStore | undefined;
	private readonly sandboxGrantStore: RuntimeSandboxGrantStore | undefined;
	private readonly sessionErrorObserver:
		| ((event: Extract<SessionEvent, { readonly type: "error" }>) => void)
		| undefined;
	private readonly sessionCompactionObserver:
		| ((event: Extract<SessionEvent, { readonly type: "compaction.start" | "compaction.end" }>) => void)
		| undefined;
	private userConfirmationHandler:
		| ((request: RuntimeUserConfirmationRequest, signal?: AbortSignal) => Promise<boolean>)
		| undefined;
	private userQuestionHandler:
		| ((request: RuntimeUserQuestionRequest, signal?: AbortSignal) => Promise<RuntimeUserQuestionResult>)
		| undefined;
	private userSandboxGrantHandler:
		| ((request: RuntimeSandboxGrantRequest, signal?: AbortSignal) => Promise<RuntimeSandboxGrantDecision>)
		| undefined;

	constructor(options: RuntimeHostOptions = {}) {
		if (options.sessionBackend && options.createSessionBackend) {
			throw new Error("RuntimeHost accepts either sessionBackend or createSessionBackend, not both");
		}
		if (options.observationPort && options.observationPublisher) {
			throw new Error("RuntimeHost accepts either observationPort or observationPublisher, not both");
		}
		this.observations =
			options.observationPublisher ?? createRuntimeObservationPublisher({ port: options.observationPort });
		this.ownsObservationPublisher = options.observationPublisher === undefined;
		this.ownedObservationPort = options.observationPublisher === undefined ? options.observationPort : undefined;
		this.agents = new RuntimeAgentRuntime({
			...options.agentRuntimeOptions,
			observationPublisher: this.observations,
		});
		this.getDefaultExecutionMode = options.getDefaultExecutionMode ?? (() => "sandbox");
		this.sandboxHostPath = options.sandboxHostPath;
		this.linuxBubblewrapPath = options.linuxBubblewrapPath;
		this.macosSandboxExecPath = options.macosSandboxExecPath;
		this.serverUrl = options.serverUrl;
		this.sessionCatalog = options.sessionCatalog;
		this.sessionFileHistoryReader = options.sessionFileHistoryReader;
		this.sessionAccessResolver = options.sessionAccessResolver;
		this.sharedModelController = options.sharedModelController;
		this.pathServices = options.pathServices;
		this.queueSidecarStore = options.queueSidecarStore;
		this.sandboxGrantStore = options.sandboxGrantStore;
		this.sessionErrorObserver = options.sessionErrorObserver;
		this.sessionCompactionObserver = options.sessionCompactionObserver;
		this.sessionBackend =
			options.sessionBackend ??
			options.createSessionBackend?.({ agents: this.agents, observationPublisher: this.observations });
		this.ownsSessionBackend = options.createSessionBackend !== undefined;
		this.agentBackends = new RuntimeHostAgentBackendRegistry({
			defaultBackend: this.sessionBackend,
			observationPublisher: this.observations,
		});
		this.closeController = new RetryableCloseController({ cleanup: () => this.closeOwnedResources() });
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

	/**
	 * 原子安装一个新的平级主 Agent Definition 与 Host Backend。
	 * Backend 可异步准备，但在准备完成前不会发布 Definition，避免半安装状态进入发现面。
	 */
	async installAgent(options: RuntimeHostAgentInstallationOptions): Promise<RuntimeHostAgentInstallation> {
		this.assertOpen();
		const agentId = options.definition.id;
		this.observations.record(
			RUNTIME_HOST_AGENT_BACKEND_OBSERVATION,
			{
				operation: "install",
				phase: "started",
				sourceId: options.source.id,
				sourceRevision: options.source.revision,
			},
			{ agentId },
		);
		let backend: RuntimeHostSessionBackend | undefined;
		let definitionRevisionId: string | undefined;
		try {
			if (this.agents.registry.snapshot().entries.some((entry) => entry.agentId === agentId)) {
				throw new Error(`Runtime Agent is already installed: ${agentId}`);
			}
			if (this.agentBackends.snapshot().entries.some((entry) => entry.agentId === agentId)) {
				throw new Error(`Runtime Host Agent Backend is already installed: ${agentId}`);
			}
			backend = await options.createBackend({ agents: this.agents, observationPublisher: this.observations });
			this.assertOpen();
			const definitionPublish = this.agents.registry.upsert({
				source: options.source,
				definition: options.definition,
			});
			definitionRevisionId = definitionPublish.revision.id;
			const backendPublish = this.agentBackends.upsert({
				agentId,
				source: options.source,
				backend,
				catalog: options.catalog,
				ownsBackend: options.ownsBackend ?? true,
			});
			this.observations.record(
				RUNTIME_HOST_AGENT_BACKEND_OBSERVATION,
				{
					operation: "install",
					phase: "completed",
					backendRevisionId: backendPublish.revision.id,
					sourceId: options.source.id,
					sourceRevision: options.source.revision,
				},
				{ agentId, revisionId: definitionPublish.revision.id },
			);
			let retirement:
				| {
						readonly definitionRemoved: boolean;
						readonly backendRetirement?: ReturnType<RuntimeHostAgentBackendRegistry["remove"]>;
				  }
				| undefined;
			return Object.freeze({
				agentId,
				definitionRevisionId: definitionPublish.revision.id,
				backendRevision: backendPublish.revision,
				retire: () => {
					if (retirement) return retirement;
					const definitionRemoved = this.agents.registry.remove(agentId, definitionPublish.revision.id);
					const backendRetirement = this.agentBackends.remove(agentId, backendPublish.revision.id);
					retirement = Object.freeze({
						definitionRemoved,
						...(backendRetirement ? { backendRetirement } : {}),
					});
					return retirement;
				},
			});
		} catch (error) {
			const cleanupErrors: unknown[] = [];
			if (definitionRevisionId) {
				try {
					this.agents.registry.remove(agentId, definitionRevisionId);
				} catch (cleanupError) {
					cleanupErrors.push(cleanupError);
				}
			}
			if (backend && (options.ownsBackend ?? true)) {
				try {
					await backend.dispose?.();
				} catch (cleanupError) {
					cleanupErrors.push(cleanupError);
				}
			}
			this.observations.record(
				RUNTIME_HOST_AGENT_BACKEND_OBSERVATION,
				{
					operation: "install",
					phase: "failed",
					sourceId: options.source.id,
					sourceRevision: options.source.revision,
					failure: runtimeObservationFailure(error),
				},
				{ agentId },
			);
			if (cleanupErrors.length > 0) {
				throw new AggregateError([error, ...cleanupErrors], "Runtime Host Agent installation and rollback failed", {
					cause: error,
				});
			}
			throw error;
		}
	}

	listSandboxGrants(sessionId: string): RuntimeSandboxGrantInfo[] {
		return [...(this.sandboxGrantStore?.list(this.readCanonicalSessionId(sessionId)) ?? [])];
	}

	revokeSandboxGrant(sessionId: string, grantId: string): boolean {
		return this.sandboxGrantStore?.revoke(this.readCanonicalSessionId(sessionId), grantId) ?? false;
	}

	revokeAllSandboxGrants(sessionId: string): number {
		return this.sandboxGrantStore?.revokeAll(this.readCanonicalSessionId(sessionId)) ?? 0;
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
			} catch (error) {
				this.observations.record(RUNTIME_HOST_LIFECYCLE_OBSERVATION, {
					operation: "auth.refresh",
					phase: "failed",
					component: "shared-model",
					failure: runtimeObservationFailure(error),
				});
			}
			return;
		}
		const handles = Array.from(this.sessions.values());
		await Promise.all(
			handles.map(async ({ lifecycle, modelController }) => {
				try {
					await modelController.refreshAuth(token);
				} catch (error) {
					this.observations.record(
						RUNTIME_HOST_LIFECYCLE_OBSERVATION,
						{
							operation: "auth.refresh",
							phase: "failed",
							component: "session-model",
							failure: runtimeObservationFailure(error),
						},
						{ sessionId: lifecycle.sessionId },
					);
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
		const target = this.normalizePath(sessionPath);
		for (const [sessionId, handle] of this.sessions) {
			const openPath = handle.lifecycle.sessionPath;
			if (openPath && this.normalizePath(openPath) === target) {
				return { sessionId, handle };
			}
		}
		return undefined;
	}

	async createSession(config: SessionConfig = {}): Promise<{ sessionId: string }> {
		const releaseAdmission = this.beginSessionCreation();
		try {
			return await this.createSessionInternal(config);
		} finally {
			releaseAdmission();
		}
	}

	private async createSessionInternal(config: SessionConfig): Promise<{ sessionId: string }> {
		const sessionPath = config.sessionPath?.trim() || undefined;
		// Dedupe by sessionPath: a SessionManager.open() takes an exclusive file
		// lock, and the lock module treats same-pid re-acquisition as a real
		// conflict. So if the renderer reopens a session this RuntimeHost is
		// already holding, we must return the existing handle instead of opening
		// a second one.
		if (sessionPath) {
			const existing = this.findHandleBySessionPath(sessionPath);
			if (existing) {
				if (config.executionMode !== undefined && config.executionMode !== existing.handle.executionMode) {
					await this.setExecutionMode(existing.sessionId, config.executionMode);
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
		const request: RuntimeSessionCreateRequest = {
			agent: config.agent,
			sessionId: config.sessionId,
			cwd: config.cwd,
			agentDir: config.agentDir,
			sessionPath,
			sessionDir: config.sessionDir,
			model: config.model,
			thinkingLevel: config.thinkingLevel,
			scenario: config.scenario,
			agentMode: config.agentMode,
			executionMode,
			appendSystemPrompt: config.appendSystemPrompt,
			env: config.env,
			enableBackgroundTasks: config.enableBackgroundTasks,
			// Fail-closed scenario gate: only interactive conversation/project/cli roots.
			// batch/automation/kb-processing/im-claw stay off until lifecycle is designed.
			enableSubagents: shouldEnableSubagents(config.scenario),
			includeAgentSkills: config.includeAgentSkills,
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
										requestId: createRuntimeId(),
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

		const assembly = await this.agentBackends.createAssembly(request);
		const {
			lifecycle,
			historyReader,
			historyController,
			hostInteraction,
			executionController,
			workspaceView,
			extensionHost,
			configurationController,
			modelController,
			modelView,
			corePorts,
			contextController,
			contextDeliveryController,
			contextUsageView,
			conversationView,
			executionObservationStream,
			toolController,
			queueController,
			metadataController,
		} = assembly;
		const sessionId = lifecycle.sessionId;
		sessionIdRef.current = sessionId;
		if (this.sessionKeysByIdentity.has(sessionId) || this.sessions.has(sessionId)) {
			const error = new Error(`RuntimeHost Session id is already registered: ${sessionId}`);
			try {
				await lifecycle.dispose();
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					"Duplicate RuntimeHost Session initialization and rollback failed",
					{ cause: error },
				);
			}
			throw error;
		}
		const handle: SessionHandle = {
			lifecycle,
			historyReader,
			historyController,
			hostInteraction,
			executionController,
			workspaceView,
			extensionHost,
			configurationController,
			modelController,
			modelView,
			contextController,
			contextDeliveryController,
			contextUsageView,
			conversationView,
			executionObservationStream,
			toolController,
			...corePorts,
			queueController,
			metadataController,
			executionMode,
			pendingConfiguration: {
				executionMode: undefined,
				hasExecutionMode: false,
			},
			scenario: config.scenario ?? DEFAULT_RUNTIME_SCENARIO,
			agentMode: config.agentMode,
		};
		this.sessions.set(sessionId, handle);
		this.sessionKeysByIdentity.set(sessionId, sessionId);
		this.currentSessionIdentityByKey.set(sessionId, sessionId);
		try {
			await hostInteraction.bind(this.createHostInteractionContext(sessionIdRef));
			this.attachInFlightBuffer(sessionId, handle, corePorts.eventStream);

			// 恢复排队 sidecar（ADR-0060）：仅打开已有会话时可能存在。restore 会触发
			// queue.changed → 重写 sidecar，幂等无害。
			if (queueController && sessionPath) {
				await this.restoreQueueSidecar(queueController, lifecycle.sessionPath);
			}

			// 打开「已有」会话且调用方没有指定模型时恢复上一轮模型；失败由方法内部降级。
			if (sessionPath && !config.model) {
				await this.restoreModelFromHistory(historyReader, modelController);
			}

			// Stale-while-revalidate；共享 Model Controller 自己隔离后台刷新错误。
			this.sharedModelController?.refreshInBackground();
			return { sessionId };
		} catch (error) {
			try {
				await this.disposeSession(sessionId);
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "RuntimeHost Session initialization and rollback failed", {
					cause: error,
				});
			}
			throw error;
		}
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
		sessionKey: string,
		handle: SessionHandle,
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
		this.inFlightBuffers.set(sessionKey, buffer);
		const unsubscribe = eventStream.subscribe((event) => {
			this.synchronizeSessionIdentity(sessionKey, handle);
			this.observeSessionError(event);
			this.observeSessionCompaction(event);
			if (event.type === "queue.changed") {
				this.persistQueueSidecar(handle.lifecycle.sessionPath, event);
				return;
			}
			if (event.type === "session.lifecycle" && event.phase === "agent_start") {
				this.currentTurnStartedAt.set(sessionKey, event.timestamp);
				buffer.turnStartedAt = event.timestamp;
				buffer.text = "";
				buffer.thinking = "";
				buffer.toolCallStarts = [];
				buffer.isActive = true;
				buffer.terminalReason = undefined;
				this.markRunning(handle.lifecycle.sessionPath, true, handle.lifecycle.sessionId);
				return;
			}
			if (event.type === "session.lifecycle" && event.phase === "aborted") {
				buffer.terminalReason = "aborted";
				return;
			}
			// turn.failed 仍会产生 error observation + agent_end；assistant error
			// message 也会先以 message.final 到达。两条路径都带有同一个 turnId，
			// 由宿主投影层幂等合并，避免错误既丢失又重复。ADR-0060。
			if (event.type === "error" && buffer.isActive) {
				buffer.terminalReason = "error";
				return;
			}
			if (event.type === "session.lifecycle" && event.phase === "agent_end") {
				this.currentTurnStartedAt.delete(sessionKey);
				buffer.text = "";
				buffer.thinking = "";
				buffer.toolCallStarts = [];
				buffer.isActive = false;
				this.markRunning(
					handle.lifecycle.sessionPath,
					false,
					handle.lifecycle.sessionId,
					buffer.terminalReason ?? "agent_end",
				);
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
					// 恢复成功的回合（ADR-0057 重试尘埃落定后正常收尾）不能残留
					// 早前的 error 标记，否则自然结束会被误报成 "error"。
					else buffer.terminalReason = undefined;
				}
				return;
			}
			if (event.type === "message.delta") buffer.text += event.delta;
			else if (event.type === "thinking.delta") buffer.thinking += event.delta;
			else if (event.type === "toolcall.start") {
				buffer.toolCallStarts.push({ toolCallId: event.toolCallId, toolName: event.toolName });
			}
		});
		this.inFlightUnsubscribers.set(sessionKey, unsubscribe);
	}

	async setExecutionMode(sessionId: string, mode: SessionExecutionMode): Promise<void> {
		const handle = this.requireSession(sessionId);
		if (handle.executionMode === mode) {
			handle.pendingConfiguration.executionMode = undefined;
			handle.pendingConfiguration.hasExecutionMode = false;
			return;
		}
		if (handle.executionController.isBusy()) {
			handle.pendingConfiguration.executionMode = mode;
			handle.pendingConfiguration.hasExecutionMode = true;
			return;
		}
		await this.applyExecutionMode(sessionId, handle, mode);
	}

	async setGlobalExecutionMode(mode: SessionExecutionMode): Promise<void> {
		const pending = Array.from(this.sessions.keys());
		for (const sessionId of pending) {
			await this.setExecutionMode(sessionId, mode);
		}
	}

	async prompt(sessionId: string, request: PromptRequest): Promise<RuntimeTurnPromptOutcome> {
		const sessionKey = this.resolveSessionKey(sessionId);
		const handle = this.requireSession(sessionId);
		await this.applyPendingExecutionMode(handle.lifecycle.sessionId, handle);

		// Session cwd (esp. desktop ADR-0007 per-session dirs) may have been deleted
		// while the handle stayed open (clear-artifacts, manual cleanup). Heal before tools run.
		const sessionCwd = handle.workspaceView.readWorkingDirectory();
		if (sessionCwd && this.pathServices) {
			try {
				await this.pathServices.ensureDirectory(sessionCwd);
			} catch (error) {
				this.recordLifecycleFailure("session.prepare", "session-workspace", error, handle.lifecycle.sessionId);
			}
		}

		try {
			// streaming 中带 streamingBehavior 的请求放行到 kernel 队列（ADR-0060）；
			// 不带 behavior 的仍视为并发误用。
			if (handle.stateReader.readState().isStreaming && !request.streamingBehavior) {
				throw runtimeError("SESSION_BUSY", "Session is already processing another turn.", true, "runtime");
			}
			const outcome = await handle.turnControl.prompt({
				text: request.text,
				images: request.images,
				streamingBehavior: request.streamingBehavior,
				promptRef: request.promptRef,
				attachments: request.attachments,
				modelKey: request.modelKey,
				reasoning: request.reasoning,
				metadata: request.metadata,
			});
			return outcome ?? { status: "completed" };
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
			const failure = isTurnPersistenceError(err) ? err.failure : undefined;
			if (failure && isTurnPersistenceError(err)) {
				// The execution failure was already published with its turnId. Return a
				// terminal receipt instead of broadcasting the durability error as a
				// second chat message; the session remains recovery_required.
				return {
					status: "failed",
					turnId: err.turnId,
					error: { ...failure, retryable: false },
				};
			}
			this.broadcastSyntheticEvent(sessionKey, {
				...baseSessionEvent(handle.lifecycle.sessionId, "agent"),
				type: "error",
				...(isTurnPersistenceError(err) && err.turnId ? { turnId: err.turnId } : {}),
				error: failure ?? (isSessionError(err) ? err : runtimeError("INTERNAL_ERROR", message, false, "runtime")),
			});
			throw err;
		} finally {
			this.synchronizeSessionIdentity(sessionKey, handle);
		}
	}

	async continue(sessionId: string): Promise<void> {
		const handle = this.requireSession(sessionId);
		await this.applyPendingExecutionMode(sessionId, handle);
		await handle.turnControl.continue();
	}

	async retry(sessionId: string): Promise<void> {
		const handle = this.requireSession(sessionId);
		await this.applyPendingExecutionMode(sessionId, handle);
		await handle.turnControl.retry();
	}

	async abort(sessionId: string): Promise<void> {
		const handle = this.requireSession(sessionId);
		await handle.turnControl.abort();
	}

	// ---- 输入队列管理（ADR-0060）。backend 不具备 queueController 时静默降级为空队列。 ----

	getQueueState(sessionId: string): RuntimeSessionQueueStateView {
		const handle = this.requireSession(sessionId);
		return handle.queueController?.readQueueState() ?? { paused: false, entries: [] };
	}

	removeQueuedMessage(sessionId: string, itemId: string): boolean {
		const handle = this.requireSession(sessionId);
		return handle.queueController?.removeQueued(itemId) ?? false;
	}

	reorderQueuedMessages(sessionId: string, itemIds: readonly string[]): void {
		const handle = this.requireSession(sessionId);
		handle.queueController?.reorderQueuedFollowUps(itemIds);
	}

	async sendQueuedMessageNow(sessionId: string, itemId: string): Promise<"promoted" | "started" | "missing"> {
		const handle = this.requireSession(sessionId);
		if (!handle.queueController) return "missing";
		return handle.queueController.sendQueuedNow(itemId);
	}

	async resumeQueue(sessionId: string): Promise<void> {
		const handle = this.requireSession(sessionId);
		await handle.queueController?.resumeQueue();
	}

	clearQueue(sessionId: string): void {
		const handle = this.requireSession(sessionId);
		handle.queueController?.clear();
	}

	/** 串行化每个 sidecar 文件的写入，避免快照乱序落盘。 */
	private persistQueueSidecar(sessionPath: string | undefined, event: QueueChangedEvent): void {
		if (!sessionPath || !this.queueSidecarStore) return;
		const key = this.normalizePath(sessionPath);
		const prev = this.queueSidecarWrites.get(key) ?? Promise.resolve();
		const next = prev.then(async () => {
			try {
				if (event.entries.length === 0 && !event.paused) {
					await this.queueSidecarStore?.remove(sessionPath);
					return;
				}
				await this.queueSidecarStore?.write(sessionPath, event.snapshot);
			} catch (error) {
				this.recordLifecycleFailure("session.persist", "queue-sidecar", error, event.sessionId);
			}
		});
		this.queueSidecarWrites.set(key, next);
	}

	private async restoreQueueSidecar(
		queueController: NonNullable<SessionHandle["queueController"]>,
		sessionPath: string | undefined,
	): Promise<void> {
		if (!sessionPath || !this.queueSidecarStore) return;
		try {
			const snapshot = await this.queueSidecarStore.read(sessionPath);
			if (snapshot !== undefined) queueController.restoreQueue(snapshot);
		} catch {
			// 文件不存在或损坏都静默：队列 sidecar 丢失只影响排队，不损害历史。
		}
	}

	/** 通过类型化 token 调用当前会话公开的产品扩展端点。 */
	async invokeSessionExtension<Input, Output>(
		sessionId: string,
		token: SessionExtensionEndpointToken<Input, Output>,
		input: Input,
		signal?: AbortSignal,
	): Promise<Output> {
		const handle = this.requireSession(sessionId);
		if (!handle.extensionHost) throw new Error("Session extension host is unavailable");
		return handle.extensionHost.invoke(token, input, signal);
	}

	hasSessionExtension<Input, Output>(sessionId: string, token: SessionExtensionEndpointToken<Input, Output>): boolean {
		return this.requireSession(sessionId).extensionHost?.hasEndpoint(token) ?? false;
	}

	invokeSessionExtensionSync<Input, Output>(
		sessionId: string,
		token: SessionExtensionEndpointToken<Input, Output>,
		input: Input,
	): Output {
		const host = this.requireSession(sessionId).extensionHost;
		if (!host) throw new Error("Session extension host is unavailable");
		return host.invokeSync(token, input);
	}

	subscribe(sessionId: string, handler: (event: SessionEvent) => void): () => void {
		const sessionKey = this.resolveSessionKey(sessionId);
		const handle = this.requireSession(sessionId);
		const canonicalSessionId = handle.lifecycle.sessionId;
		this.notifyExternalSubscriber(sessionKey, handler, lifecycleSessionEvent(canonicalSessionId, "created"));

		for (const observation of handle.extensionHost?.readInitialObservations() ?? []) {
			this.notifyExternalSubscriber(
				sessionKey,
				handler,
				mapRuntimeSessionObservationEvent(canonicalSessionId, observation),
			);
		}

		this.notifyExternalSubscriber(sessionKey, handler, {
			...baseSessionEvent(canonicalSessionId, "runtime-core"),
			type: "active_tools_update",
			activeToolNames: [...handle.stateReader.readState().activeToolNames],
		});

		// Replay in-flight assistant deltas accumulated since agent_start so that
		// a renderer reconnecting mid-stream (e.g. after switching sessions away
		// and back) sees the partial assistant content. Without this, any text
		// produced before reconnection would be lost (the runtime only persists
		// assistant messages on message_end, and a fresh subscribe only forwards
		// future events).
		const buffer = this.inFlightBuffers.get(sessionKey);
		if (buffer?.isActive) {
			if (buffer.thinking) {
				this.notifyExternalSubscriber(sessionKey, handler, {
					...baseSessionEvent(canonicalSessionId, "agent"),
					type: "thinking.delta",
					delta: buffer.thinking,
				});
			}
			if (buffer.text) {
				this.notifyExternalSubscriber(sessionKey, handler, {
					...baseSessionEvent(canonicalSessionId, "agent"),
					type: "message.delta",
					delta: buffer.text,
				});
			}
			for (const tc of buffer.toolCallStarts) {
				this.notifyExternalSubscriber(sessionKey, handler, {
					...baseSessionEvent(canonicalSessionId, "agent"),
					type: "toolcall.start",
					toolCallId: tc.toolCallId,
					toolName: tc.toolName,
				});
			}
		}

		// 登记到外部订阅者表，便于 prompt() 等同步路径直接广播合成事件
		// （session.subscribe 链路要求事件先经过 session.emit → mapEvent，
		// 而 prompt 期的 throw 拿不到 session emit 这一条线）。
		let externals = this.externalSubscribers.get(sessionKey);
		if (!externals) {
			externals = new Set();
			this.externalSubscribers.set(sessionKey, externals);
		}
		externals.add(handler);

		// 一个 session 只挂一次 session 级订阅，后续 handler 共享同一事件流。
		// 避免多个 runtime.subscribe() 调用创建多个 AgentSession 监听器，
		// 导致 mapEvent 中的副作用（如 persistAssistantTurnTiming）重复执行。
		if (!this.sessionSubscriptions.has(sessionKey)) {
			const unsubscribeSession = handle.eventStream.subscribe((event) => {
				this.synchronizeSessionIdentity(sessionKey, handle);
				this.notifyExternalSubscribers(sessionKey, event);
			});
			this.sessionSubscriptions.set(sessionKey, unsubscribeSession);
		}

		return () => {
			const set = this.externalSubscribers.get(sessionKey);
			if (set) {
				set.delete(handler);
				this.externalSubscriberActiveToolFingerprints.get(sessionKey)?.delete(handler);
				if (set.size === 0) {
					this.externalSubscribers.delete(sessionKey);
					this.externalSubscriberActiveToolFingerprints.delete(sessionKey);
					const unsub = this.sessionSubscriptions.get(sessionKey);
					if (unsub) {
						unsub();
						this.sessionSubscriptions.delete(sessionKey);
					}
				}
			}
		};
	}

	subscribeExecutionObservations(
		sessionId: string,
		handler: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void,
	): () => void {
		const stream = this.requireSession(sessionId).executionObservationStream;
		if (!stream) throw new Error("Session execution observation stream is unavailable");
		return stream.subscribe(handler);
	}

	/**
	 * 向某个 session 当前所有的外部订阅者广播一个合成事件。仅用于 RuntimeHost
	 * 内部，覆盖那些 session 事件流本身覆盖不到的边界（例如 prompt 入参校验
	 * 同步 throw 的场景）。
	 */
	private broadcastSyntheticEvent(sessionId: string, event: SessionEvent): void {
		this.observeSessionError(event);
		this.notifyExternalSubscribers(sessionId, event);
	}

	private notifyExternalSubscribers(sessionId: string, event: SessionEvent): void {
		for (const handler of this.externalSubscribers.get(sessionId) ?? []) {
			this.notifyExternalSubscriber(sessionId, handler, event);
		}
	}

	private notifyExternalSubscriber(
		sessionId: string,
		handler: (event: SessionEvent) => void,
		event: SessionEvent,
	): void {
		if (event.type === "active_tools_update") {
			const fingerprint = [...event.activeToolNames].sort().join("\0");
			let fingerprints = this.externalSubscriberActiveToolFingerprints.get(sessionId);
			if (!fingerprints) {
				fingerprints = new WeakMap();
				this.externalSubscriberActiveToolFingerprints.set(sessionId, fingerprints);
			}
			if (fingerprints.get(handler) === fingerprint) return;
			fingerprints.set(handler, fingerprint);
		}
		try {
			handler(event);
		} catch (error) {
			this.recordLifecycleFailure("listener.notify", "session-event-listener", error, sessionId);
		}
	}

	private observeSessionError(event: SessionEvent): void {
		if (event.type !== "error" || !this.sessionErrorObserver) return;
		try {
			this.sessionErrorObserver(event);
		} catch (error) {
			this.recordLifecycleFailure("observer.notify", "session-error-observer", error, event.sessionId);
		}
	}

	private observeSessionCompaction(event: SessionEvent): void {
		if ((event.type !== "compaction.start" && event.type !== "compaction.end") || !this.sessionCompactionObserver) {
			return;
		}
		try {
			this.sessionCompactionObserver(event);
		} catch (error) {
			this.recordLifecycleFailure("observer.notify", "session-compaction-observer", error, event.sessionId);
		}
	}

	private recordLifecycleFailure(
		operation: RuntimeHostLifecycleOperation,
		component: NonNullable<RuntimeHostLifecycleObservation["component"]>,
		error: unknown,
		sessionId?: string,
	): void {
		this.observations.record(
			RUNTIME_HOST_LIFECYCLE_OBSERVATION,
			{
				operation,
				phase: "failed",
				component,
				failure: runtimeObservationFailure(error),
			},
			sessionId ? { sessionId } : undefined,
		);
	}

	readSessionContextCompactionState(sessionId: string): RuntimeContextCompactionState {
		const controller = this.requireSession(sessionId).contextController;
		if (!controller) throw new Error("Session context controller is unavailable");
		return controller.readState();
	}

	async compactSessionContext(
		sessionId: string,
		request?: RuntimeContextCompactionRequest,
	): Promise<RuntimeContextCompactionResult> {
		const controller = this.requireSession(sessionId).contextController;
		if (!controller) throw new Error("Session context controller is unavailable");
		return await controller.compact(request);
	}

	abortSessionContextCompaction(sessionId: string): void {
		const controller = this.requireSession(sessionId).contextController;
		if (!controller) throw new Error("Session context controller is unavailable");
		controller.abortCompaction();
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

	setSessionAgentMode(sessionId: string, mode: string | undefined): void {
		const handle = this.requireSession(sessionId);
		handle.configurationController.setAgentMode(mode);
		handle.agentMode = mode;
	}

	setSessionThinkingLevel(sessionId: string, level: ThinkingLevel): void {
		this.requireSession(sessionId).modelController.setThinkingLevel(level);
	}

	setSessionSteeringMode(sessionId: string, mode: NonNullable<SettingsPatch["steeringMode"]>): void {
		this.requireSession(sessionId).configurationController.setSteeringMode(mode);
	}

	setSessionFollowUpMode(sessionId: string, mode: NonNullable<SettingsPatch["followUpMode"]>): void {
		this.requireSession(sessionId).configurationController.setFollowUpMode(mode);
	}

	updateGlobalThinkingLevel(level: ThinkingLevel): void {
		for (const handle of this.sessions.values()) {
			handle.modelController.setThinkingLevel(level);
		}
	}

	getState(sessionId: string): SessionStateSnapshot {
		const sessionKey = this.resolveSessionKey(sessionId);
		const handle = this.requireSession(sessionId);
		const state = handle.stateReader.readState();
		return {
			sessionId: handle.lifecycle.sessionId,
			...(handle.lifecycle.agentId ? { agentId: handle.lifecycle.agentId } : {}),
			model: state.model,
			thinkingLevel: state.thinkingLevel,
			executionMode: handle.executionMode,
			isStreaming: state.isStreaming,
			currentTurnStartedAt: this.currentTurnStartedAt.get(sessionKey),
			messageCount: state.messageCount,
			contextPercent: state.contextPercent,
			...(state.contextTokens !== undefined ? { contextTokens: state.contextTokens } : {}),
			contextWindow: state.contextWindow,
			...(state.contextComposition ? { contextComposition: state.contextComposition } : {}),
			activeToolNames: [...state.activeToolNames],
			scenario: handle.scenario,
			...(handle.agentMode !== undefined ? { agentMode: handle.agentMode } : {}),
			parentSessionPath: state.parentSessionPath,
			parentEntryId: state.parentEntryId,
		};
	}

	readRuntimeSessionState(sessionId: string): RuntimeSessionState {
		const state = this.requireSession(sessionId).stateReader.readState();
		return { ...state, activeToolNames: [...state.activeToolNames] };
	}

	readSessionDocument(sessionId: string): ConversationDocument {
		const view = this.requireSession(sessionId).conversationView;
		if (!view) throw new Error("Session conversation view is unavailable");
		return view.readDocument();
	}

	readSessionWorkingDirectory(sessionId: string): string | undefined {
		return this.requireSession(sessionId).workspaceView.readWorkingDirectory();
	}

	getSessionDirectory(sessionId: string): string | undefined {
		return this.requireSession(sessionId).lifecycle.sessionDirectory;
	}

	readSessionContextUsage(sessionId: string): RuntimeSessionContextUsage | undefined {
		return this.requireSession(sessionId).contextUsageView?.readContextUsage();
	}

	readSessionCompactionState(sessionId: string): RuntimeContextCompactionState {
		const controller = this.requireSession(sessionId).contextController;
		if (!controller) throw new Error("Session context controller is unavailable");
		return controller.readState();
	}

	setSessionAutoCompactionEnabled(sessionId: string, enabled: boolean): void {
		const controller = this.requireSession(sessionId).contextController;
		if (!controller) throw new Error("Session context controller is unavailable");
		controller.setAutoCompactionEnabled(enabled);
	}

	deliverSessionContext(
		sessionId: string,
		records: readonly SessionContextRecord[],
		mode: RuntimeSessionContextDeliveryMode,
	): Promise<void> {
		const controller = this.requireSession(sessionId).contextDeliveryController;
		if (!controller) throw new Error("Session context delivery capability is unavailable");
		return controller.deliver(records, mode);
	}

	readSessionName(sessionId: string): string | undefined {
		return this.requireSession(sessionId).metadataController?.readName();
	}

	readSessionActiveToolNames(sessionId: string): readonly string[] {
		return [...(this.requireSession(sessionId).toolController?.readActiveToolNames() ?? [])];
	}

	readSessionAvailableTools(sessionId: string): ReadonlyMap<string, RuntimeToolDefinition> {
		return new Map(this.requireSession(sessionId).toolController?.readAvailableTools() ?? []);
	}

	setSessionActiveToolNames(sessionId: string, toolNames: readonly string[]): void {
		const controller = this.requireSession(sessionId).toolController;
		if (!controller) throw new Error("Session tool capability is unavailable");
		controller.setActiveToolNames(toolNames);
	}

	selectSessionModel(
		sessionId: string,
		modelKey: string,
		strategy: "if-changed" | "always" = "always",
	): Promise<void> {
		return this.requireSession(sessionId).modelController.selectModel(modelKey, strategy);
	}

	resolveSessionModelApiKey(sessionId: string, model: Model<Api>): Promise<string | undefined> {
		return this.requireSession(sessionId).modelView.resolveApiKey(model);
	}

	readSessionCurrentModel(sessionId: string): Model<Api> | undefined {
		return this.requireSession(sessionId).modelView.readCurrentModel();
	}

	readSessionAvailableModels(sessionId: string): readonly Model<Api>[] {
		return [...this.requireSession(sessionId).modelView.readAvailableModels()];
	}

	readSessionQueueModes(sessionId: string): {
		readonly steering: NonNullable<SettingsPatch["steeringMode"]>;
		readonly followUp: NonNullable<SettingsPatch["followUpMode"]>;
	} {
		const controller = this.requireQueueController(sessionId);
		return { steering: controller.readSteeringMode(), followUp: controller.readFollowUpMode() };
	}

	readSessionQueuedMessages(sessionId: string): {
		readonly steering: readonly string[];
		readonly followUp: readonly string[];
	} {
		const controller = this.requireQueueController(sessionId);
		return {
			steering: [...controller.readSteeringMessages()],
			followUp: [...controller.readFollowUpMessages()],
		};
	}

	clearSessionQueue(sessionId: string): {
		readonly steering: readonly string[];
		readonly followUp: readonly string[];
	} {
		return this.requireQueueController(sessionId).clear();
	}

	async appendSessionBranchSummary(
		sessionId: string,
		parentId: string | null,
		summary: string,
		details?: unknown,
		fromHook?: boolean,
	): Promise<{ entryId: string }> {
		return this.requireSession(sessionId).historyController.appendBranchSummary(parentId, summary, details, fromHook);
	}

	appendSessionMetadataEntry(sessionId: string, customType: string, data?: unknown): Promise<void> {
		const controller = this.requireSession(sessionId).metadataController;
		if (!controller) throw new Error("Session metadata capability is unavailable");
		return controller.appendEntry(customType, data);
	}

	setSessionLabel(sessionId: string, entryId: string, label: string | undefined): Promise<void> {
		const controller = this.requireSession(sessionId).metadataController;
		if (!controller) throw new Error("Session metadata capability is unavailable");
		return controller.setLabel(entryId, label);
	}

	getSessionView(sessionId: string): RuntimeHostSession {
		this.requireSession(sessionId);
		return new RuntimeHostSession(this, sessionId);
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
		return this.sessionAccessResolver?.resolve(this.normalizePath(sessionPath)) ?? Promise.resolve(undefined);
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
			await this.disposeSession(existing.sessionId);
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
			} catch (error) {
				this.observations.record(
					RUNTIME_HOST_LIFECYCLE_OBSERVATION,
					{
						operation: "listener.notify",
						phase: "failed",
						component: "running-listener",
						failure: runtimeObservationFailure(error),
					},
					sessionId ? { sessionId } : undefined,
				);
			}
		}
	}

	getSessionPath(sessionId: string): string | undefined {
		const sessionKey = this.sessionKeysByIdentity.get(sessionId) ?? sessionId;
		const handle = this.sessions.get(sessionKey);
		if (!handle) return undefined;
		return handle.lifecycle.sessionPath;
	}

	async renameSessionById(sessionId: string, name: string): Promise<void> {
		// We already hold the live AgentSession — rename through it directly so
		// we never open a second SessionManager (and second lock) on the file.
		const handle = this.requireSession(sessionId);
		await handle.historyController.setName(name);
	}

	async disposeSession(sessionId: string): Promise<void> {
		const sessionKey = this.sessionKeysByIdentity.get(sessionId) ?? sessionId;
		const handle = this.sessions.get(sessionKey);
		if (!handle) return;
		const existingAttempt = this.sessionDisposeAttempts.get(sessionKey);
		if (existingAttempt) return existingAttempt;
		const operation = this.disposeSessionHandle(sessionKey, handle);
		const tracked = operation.finally(() => {
			if (this.sessionDisposeAttempts.get(sessionKey) === tracked) {
				this.sessionDisposeAttempts.delete(sessionKey);
			}
		});
		this.sessionDisposeAttempts.set(sessionKey, tracked);
		return tracked;
	}

	private async disposeSessionHandle(sessionKey: string, handle: SessionHandle): Promise<void> {
		try {
			await handle.lifecycle.dispose();
			if (this.sessions.get(sessionKey) !== handle) return;
			const canonicalSessionId = this.currentSessionIdentityByKey.get(sessionKey) ?? handle.lifecycle.sessionId;
			this.sandboxGrantStore?.clear(canonicalSessionId);
			this.detachSessionEventStreams(sessionKey);
			this.inFlightBuffers.delete(sessionKey);
			this.externalSubscribers.delete(sessionKey);
			this.externalSubscriberActiveToolFingerprints.delete(sessionKey);
			// session 销毁不是回合结束：传 sessionId 但不带 reason，避免触发出队。
			this.markRunning(handle.lifecycle.sessionPath, false, canonicalSessionId);
			this.sessions.delete(sessionKey);
			this.currentTurnStartedAt.delete(sessionKey);
			this.currentSessionIdentityByKey.delete(sessionKey);
			for (const [identity, key] of this.sessionKeysByIdentity) {
				if (key === sessionKey) this.sessionKeysByIdentity.delete(identity);
			}
		} catch (error) {
			this.observations.record(
				RUNTIME_HOST_LIFECYCLE_OBSERVATION,
				{
					operation: "session.dispose",
					phase: "failed",
					component: "sessions",
					failure: runtimeObservationFailure(error),
				},
				{ sessionId: handle.lifecycle.sessionId },
			);
			throw error;
		}
	}

	/**
	 * Dispose every open session this host owns and release all file locks.
	 * Call from the IPC layer when its host (e.g. an Electron WebContents) is
	 * being torn down — otherwise SessionManager locks survive until process exit.
	 */
	async disposeAllSessions(): Promise<void> {
		const results = await Promise.allSettled(
			[...this.sessions.keys()].map((sessionId) => this.disposeSession(sessionId)),
		);
		const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, "Failed to dispose all RuntimeHost Sessions");
	}

	/** 关闭唯一 Host 拥有的 Session、Backend、Agent 控制面和根观测发布器。 */
	close(): Promise<void> {
		this.closed = true;
		return this.closeController.run();
	}

	private async closeOwnedResources(): Promise<void> {
		this.observations.record(RUNTIME_HOST_LIFECYCLE_OBSERVATION, {
			operation: "host.close",
			phase: "started",
		});
		const tasks: ReadonlyArray<{
			readonly component: "session-creations" | "sessions" | "agent-backends" | "session-backend" | "agent-runtime";
			readonly dispose: () => Promise<void>;
		}> = [
			{ component: "session-creations", dispose: () => this.waitForPendingSessionCreations() },
			{ component: "sessions", dispose: () => this.disposeAllSessions() },
			{ component: "agent-backends", dispose: () => this.agentBackends.close() },
			{
				component: "session-backend",
				dispose: () =>
					this.ownsSessionBackend ? (this.sessionBackend?.dispose?.() ?? Promise.resolve()) : Promise.resolve(),
			},
			{ component: "agent-runtime", dispose: () => this.agents.close() },
		];
		while (this.closeTaskIndex < tasks.length) {
			const task = tasks[this.closeTaskIndex];
			if (!task) break;
			try {
				await task.dispose();
			} catch (error) {
				this.observations.record(RUNTIME_HOST_LIFECYCLE_OBSERVATION, {
					operation: "host.close",
					phase: "failed",
					component: task.component,
					failure: runtimeObservationFailure(error),
				});
				throw new AggregateError([error], "Failed to close RuntimeHost resources", { cause: error });
			}
			this.closeTaskIndex += 1;
		}
		if (!this.closeCompletedRecorded) {
			this.closeCompletedRecorded = true;
			this.observations.record(RUNTIME_HOST_LIFECYCLE_OBSERVATION, {
				operation: "host.close",
				phase: "completed",
			});
		}
		if (this.ownsObservationPublisher) {
			try {
				await this.observations.flush();
			} catch (error) {
				this.observations.record(RUNTIME_HOST_LIFECYCLE_OBSERVATION, {
					operation: "host.close",
					phase: "failed",
					component: "observation-publisher",
					failure: runtimeObservationFailure(error),
				});
				throw error;
			}
		}
		if (this.ownedObservationPort?.close) {
			try {
				await this.ownedObservationPort.close();
			} catch (error) {
				this.observations.record(RUNTIME_HOST_LIFECYCLE_OBSERVATION, {
					operation: "host.close",
					phase: "failed",
					component: "observation-port",
					failure: runtimeObservationFailure(error),
				});
				throw error;
			}
		}
	}

	private assertOpen(): void {
		if (this.closed) throw runtimeError("INTERNAL_ERROR", "RuntimeHost is closed", false, "runtime");
	}

	private beginSessionCreation(): () => void {
		this.assertOpen();
		this.pendingSessionCreationCount += 1;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.pendingSessionCreationCount -= 1;
			if (this.pendingSessionCreationCount === 0) {
				for (const resolve of this.pendingSessionCreationWaiters) resolve();
				this.pendingSessionCreationWaiters.clear();
			}
		};
	}

	private waitForPendingSessionCreations(): Promise<void> {
		if (this.pendingSessionCreationCount === 0) return Promise.resolve();
		return new Promise((resolve) => this.pendingSessionCreationWaiters.add(resolve));
	}

	/** Returns the current persisted identity while retaining retired identities as live aliases. */
	readCanonicalSessionId(sessionId: string): string {
		const sessionKey = this.sessionKeysByIdentity.get(sessionId);
		return sessionKey ? (this.currentSessionIdentityByKey.get(sessionKey) ?? sessionId) : sessionId;
	}

	private resolveSessionKey(sessionId: string): string {
		const sessionKey = this.sessionKeysByIdentity.get(sessionId) ?? sessionId;
		if (!this.sessions.has(sessionKey)) {
			throw runtimeError("SESSION_NOT_FOUND", `Session not found: ${sessionId}`, false);
		}
		return sessionKey;
	}

	private synchronizeSessionIdentity(sessionKey: string, handle: SessionHandle): void {
		if (this.sessions.get(sessionKey) !== handle) return;
		const nextSessionId = handle.lifecycle.sessionId;
		const previousSessionId = this.currentSessionIdentityByKey.get(sessionKey) ?? sessionKey;
		if (nextSessionId === previousSessionId) return;
		const conflictingKey = this.sessionKeysByIdentity.get(nextSessionId);
		if (conflictingKey !== undefined && conflictingKey !== sessionKey) {
			throw runtimeError(
				"INVALID_REQUEST",
				`RuntimeHost Session identity is already registered: ${nextSessionId}`,
				false,
				"runtime",
			);
		}
		this.sessionKeysByIdentity.set(nextSessionId, sessionKey);
		this.currentSessionIdentityByKey.set(sessionKey, nextSessionId);
		// Continuation starts a new persisted conversation. Grants never cross that boundary implicitly.
		this.sandboxGrantStore?.clear(previousSessionId);
		this.observations.record(
			RUNTIME_HOST_LIFECYCLE_OBSERVATION,
			{ operation: "session.rebind", phase: "completed", component: "sessions" },
			{ sessionId: nextSessionId },
		);
	}

	private requireSession(sessionId: string): SessionHandle {
		return this.sessions.get(this.resolveSessionKey(sessionId))!;
	}

	private requireQueueController(sessionId: string): RuntimeSessionQueueController {
		const controller = this.requireSession(sessionId).queueController;
		if (!controller) throw new Error("Session queue capability is unavailable");
		return controller;
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
		const access = await this.sessionAccessResolver.resolve(this.normalizePath(sessionPath));
		if (access?.[capability]) return;
		throw runtimeError("INVALID_REQUEST", `Session does not support ${capability}: ${sessionPath}`, false, "runtime");
	}

	private detachSessionEventStreams(sessionId: string): void {
		this.sessionSubscriptions.get(sessionId)?.();
		this.sessionSubscriptions.delete(sessionId);
		this.inFlightUnsubscribers.get(sessionId)?.();
		this.inFlightUnsubscribers.delete(sessionId);
	}

	private async applyExecutionMode(
		sessionId: string,
		handle: SessionHandle,
		mode: SessionExecutionMode,
	): Promise<void> {
		await handle.executionController.reconfigure({
			mode,
			sessionId,
			sandboxHostPath: this.sandboxHostPath,
			linuxBubblewrapPath: this.linuxBubblewrapPath,
			macosSandboxExecPath: this.macosSandboxExecPath,
		});
		handle.executionMode = mode;
	}

	/** 应用运行中发布的执行模式；失败时保留 pending，供下一次 Turn 重试。 */
	private async applyPendingExecutionMode(sessionId: string, handle: SessionHandle): Promise<void> {
		if (!handle.pendingConfiguration.hasExecutionMode || handle.executionController.isBusy()) return;
		const pendingExecutionMode = handle.pendingConfiguration.executionMode;
		if (!pendingExecutionMode) return;
		handle.pendingConfiguration.executionMode = undefined;
		handle.pendingConfiguration.hasExecutionMode = false;
		try {
			await this.applyExecutionMode(sessionId, handle, pendingExecutionMode);
		} catch (error) {
			if (!handle.pendingConfiguration.hasExecutionMode) {
				handle.pendingConfiguration.executionMode = pendingExecutionMode;
				handle.pendingConfiguration.hasExecutionMode = true;
			}
			throw error;
		}
	}

	private createHostInteractionContext(sessionIdRef: { current?: string }): RuntimeSessionHostInteractionContext {
		return {
			confirm: async (title, message, signal) => {
				const handler = this.userConfirmationHandler;
				if (!handler || signal?.aborted) return false;
				return handler(
					{
						requestId: createRuntimeId(),
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
					requestId: createRuntimeId(),
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

	private normalizePath(path: string): string {
		return this.pathServices?.normalize(path) ?? path;
	}
}

/** Subagents first ship on interactive roots only (docs/agent/vetta). */
function shouldEnableSubagents(scenario: SessionConfig["scenario"]): boolean {
	const s = scenario ?? DEFAULT_RUNTIME_SCENARIO;
	return s === "conversation" || s === "project" || s === "cli";
}
