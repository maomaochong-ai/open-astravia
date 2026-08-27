import type {
	RuntimeAgentDefinition,
	RuntimeAgentDefinitionSourceRef,
	RuntimeAgentRuntime,
	RuntimeAgentRuntimeOptions,
} from "../agents/index.js";
import type {
	RuntimeSandboxGrantDecision,
	RuntimeSandboxGrantRequest,
	RuntimeUserConfirmationRequest,
	RuntimeUserQuestionRequest,
	RuntimeUserQuestionResult,
	SessionConfig,
	SessionEvent,
	SessionExecutionMode,
} from "../contracts.js";
import type { RuntimeObservationPort, RuntimeObservationPublisher } from "../observation/index.js";
import type { RuntimeHostAgentBackendRetirement, RuntimeHostAgentBackendRevision } from "./agent-backend-admission.js";
import type { RuntimeHostSessionBackend } from "./session-backend.js";
import type {
	RuntimeSessionConfigurationController,
	RuntimeSessionContextController,
	RuntimeSessionContextDeliveryController,
	RuntimeSessionContextUsageView,
	RuntimeSessionConversationView,
	RuntimeSessionEventStream,
	RuntimeSessionExecutionController,
	RuntimeSessionExecutionObservationStream,
	RuntimeSessionExtensionHost,
	RuntimeSessionHistoryController,
	RuntimeSessionHistoryReader,
	RuntimeSessionHostInteraction,
	RuntimeSessionIdentityLifecycle,
	RuntimeSessionMetadataController,
	RuntimeSessionModelController,
	RuntimeSessionModelView,
	RuntimeSessionQueueController,
	RuntimeSessionStateReader,
	RuntimeSessionToolController,
	RuntimeSessionTurnControl,
	RuntimeSessionWorkspaceView,
} from "./session-ports.js";
import type {
	RuntimeHostPathServices,
	RuntimeQueueSidecarStore,
	RuntimeSandboxGrantStore,
	RuntimeSessionAccessResolver,
	RuntimeSessionCatalog,
	RuntimeSessionFileHistoryReader,
	RuntimeSharedModelController,
} from "./session-services.js";

export interface SessionHandle {
	lifecycle: RuntimeSessionIdentityLifecycle;
	historyReader: RuntimeSessionHistoryReader;
	historyController: RuntimeSessionHistoryController;
	hostInteraction: RuntimeSessionHostInteraction;
	executionController: RuntimeSessionExecutionController;
	workspaceView: RuntimeSessionWorkspaceView;
	extensionHost: RuntimeSessionExtensionHost | undefined;
	configurationController: RuntimeSessionConfigurationController;
	contextController: RuntimeSessionContextController | undefined;
	contextDeliveryController: RuntimeSessionContextDeliveryController | undefined;
	contextUsageView: RuntimeSessionContextUsageView | undefined;
	conversationView: RuntimeSessionConversationView | undefined;
	executionObservationStream: RuntimeSessionExecutionObservationStream | undefined;
	toolController: RuntimeSessionToolController | undefined;
	modelController: RuntimeSessionModelController;
	modelView: RuntimeSessionModelView;
	turnControl: RuntimeSessionTurnControl;
	eventStream: RuntimeSessionEventStream;
	stateReader: RuntimeSessionStateReader;
	/** 可选能力（ADR-0060）：backend 不提供时相应队列/落盘功能静默降级。 */
	queueController: RuntimeSessionQueueController | undefined;
	metadataController: RuntimeSessionMetadataController | undefined;
	executionMode: SessionExecutionMode;
	/** 宿主已接受、等待下一 Turn 发布到 Session runtime 的统一配置 overlay。 */
	pendingConfiguration: {
		executionMode: SessionExecutionMode | undefined;
		hasExecutionMode: boolean;
	};
	/** 本会话解析后的对话场景（缺省回落 DEFAULT_SCENARIO），getState 回传给 renderer。 */
	scenario: NonNullable<SessionConfig["scenario"]>;
	/**
	 * 本会话创建时固化的工作模式（见 ADR-0046 修订）。会话内不可变，getState 回传给
	 * renderer，供其按本会话而非全局默认值渲染。undefined = 未指定（CLI/headless 缺省）。
	 */
	agentMode: string | undefined;
}

/**
 * Per-session buffer of the currently-streaming LLM call's deltas.
 *
 * The runtime persists assistant messages to the JSONL history only on
 * `message_end`. So if a renderer disconnects mid-stream and reconnects
 * (e.g. user switches sessions and switches back), `getFullHistory` returns
 * nothing for the in-flight assistant, and a fresh `subscribe()` only forwards
 * future events. Without this buffer, all text/thinking/tool-call events
 * received before reconnection would be lost.
 *
 * Text and thinking are cleared on `message_end` because each LLM call inside
 * a multi-step turn produces its own deltas; the prior call's content is
 * already on disk via `message.final`. `isActive` flips on at `agent_start`
 * and off at `agent_end`.
 */
export interface InFlightBuffer {
	turnStartedAt: number;
	text: string;
	thinking: string;
	toolCallStarts: Array<{ toolCallId: string; toolName: string }>;
	isActive: boolean;
	terminalReason: RunningChangedReason | undefined;
}

/**
 * running-changed 广播的回合结束语义。仅 "agent_end"（自然结束）会触发 renderer
 * 侧的消息队列出队；"aborted" / "error" 保留队列不出队。session 销毁等非回合结束
 * 的 markRunning(false) 不带 reason（undefined）。
 */
export type RunningChangedReason = "agent_end" | "aborted" | "error";

export interface RuntimeHostCompositionContext {
	/** 唯一 RuntimeHost 拥有的多主 Agent 控制面。 */
	readonly agents: RuntimeAgentRuntime;
	/** Host 与下挂 Agent/产品 Composition 共用的根观测发布器。 */
	readonly observationPublisher: RuntimeObservationPublisher;
}

export interface RuntimeHostAgentInstallationOptions {
	readonly source: RuntimeAgentDefinitionSourceRef;
	readonly definition: RuntimeAgentDefinition;
	/** Backend 可同步或异步建立；建立完成前 Definition 不会进入发现面。 */
	readonly createBackend: (
		context: RuntimeHostCompositionContext,
	) => RuntimeHostSessionBackend | Promise<RuntimeHostSessionBackend>;
	readonly catalog?: RuntimeSessionCatalog;
	/** 默认 true；共享 Backend 应显式设为 false 并由外部组合根关闭。 */
	readonly ownsBackend?: boolean;
}

export interface RuntimeHostAgentInstallationRetirement {
	readonly definitionRemoved: boolean;
	readonly backendRetirement?: RuntimeHostAgentBackendRetirement;
}

export interface RuntimeHostAgentInstallation {
	readonly agentId: string;
	readonly definitionRevisionId: string;
	readonly backendRevision: RuntimeHostAgentBackendRevision;
	/** 只退休本安装仍拥有的 current revisions；被后续更新替换时不会误删新版本。 */
	retire(): RuntimeHostAgentInstallationRetirement;
}

export interface RuntimeHostOptions {
	/**
	 * 会话组合后端。生产宿主应在 Composition Root 显式注入；未注入时只有
	 * 不涉及创建会话的目录/历史操作可用。
	 */
	sessionBackend?: RuntimeHostSessionBackend;
	/**
	 * 需要使用 Host 内置 Agent 控制面的 Backend 应通过 factory 创建。
	 * 与 sessionBackend 互斥；factory 返回的 Backend 生命周期归 RuntimeHost 所有。
	 */
	createSessionBackend?: (context: RuntimeHostCompositionContext) => RuntimeHostSessionBackend;
	/** Agent 控制面的 Registry、ID 与 Compiler 配置；观测统一由 RuntimeHost 注入。 */
	agentRuntimeOptions?: Omit<RuntimeAgentRuntimeOptions, "observationPort" | "observationPublisher">;
	/** 根观测端口。直接注入时生命周期归 Host；共享端口应改为注入 observationPublisher。 */
	observationPort?: RuntimeObservationPort;
	/** 嵌入既有观测树时注入根 Publisher；与 observationPort 互斥。 */
	observationPublisher?: RuntimeObservationPublisher;
	/** 离线会话列表、重命名和文件删除。 */
	sessionCatalog?: RuntimeSessionCatalog;
	/** 不获取写锁的同步会话文件读取器。 */
	sessionFileHistoryReader?: RuntimeSessionFileHistoryReader;
	/** 既有会话文件到宿主可用能力的显式映射。 */
	sessionAccessResolver?: RuntimeSessionAccessResolver;
	/** 进程级共享模型资源。 */
	sharedModelController?: RuntimeSharedModelController;
	/** Platform path and directory operations. Omit in non-filesystem hosts. */
	pathServices?: RuntimeHostPathServices;
	/** Platform-owned persistence for queued input snapshots. */
	queueSidecarStore?: RuntimeQueueSidecarStore;
	/** Platform-owned session sandbox grants. */
	sandboxGrantStore?: RuntimeSandboxGrantStore;
	/**
	 * 最终会话错误的宿主观察端口。事件已通过产品层重试包装，适合接入日志、
	 * telemetry 等旁路；观察端抛错不会影响会话执行或事件分发。
	 */
	sessionErrorObserver?: (event: Extract<SessionEvent, { readonly type: "error" }>) => void;
	/** 自动压缩生命周期的宿主观察端口；观察端抛错不会影响会话执行或事件分发。 */
	sessionCompactionObserver?: (
		event: Extract<SessionEvent, { readonly type: "compaction.start" | "compaction.end" }>,
	) => void;
	getDefaultExecutionMode?: () => SessionExecutionMode | Promise<SessionExecutionMode>;
	sandboxHostPath?: string;
	linuxBubblewrapPath?: string;
	macosSandboxExecPath?: string;
	userConfirmationHandler?: (request: RuntimeUserConfirmationRequest, signal?: AbortSignal) => Promise<boolean>;
	userQuestionHandler?: (
		request: RuntimeUserQuestionRequest,
		signal?: AbortSignal,
	) => Promise<RuntimeUserQuestionResult>;
	userSandboxGrantHandler?: (
		request: RuntimeSandboxGrantRequest,
		signal?: AbortSignal,
	) => Promise<RuntimeSandboxGrantDecision>;
	/**
	 * Vetta 远端服务 URL。宿主进程显式注入后，下挂的 createAgentSession 不会再
	 * 回退到 coding-agent 内置的 LAN 默认值，避免主进程内 desktop-app 路径
	 * （env-injected URL）与 SDK 路径（硬编码 URL）"半边大脑"。
	 */
	serverUrl?: string;
}
