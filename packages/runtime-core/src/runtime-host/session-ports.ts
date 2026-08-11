import type { ThinkingLevel } from "@vetta/agent-core";
import type { Api, Message, Model } from "@vetta/ai";
import type { ContextCompositionReport } from "../context-composition/contracts.js";
import type {
	AgentPluginRuntimeConfig,
	BackgroundTaskInfo,
	HistoryEntry,
	PromptRequest,
	RuntimeSandboxGrantDecision,
	RuntimeSandboxGrantRequest,
	RuntimeTurnPromptOutcome,
	SessionEvent,
	SessionExecutionMode,
	SessionStateSnapshot,
	SettingsPatch,
	SubagentInfo,
	TodoItem,
} from "../contracts.js";
import type { ConversationDocument } from "../conversation/document.js";
import type { RuntimeToolDefinition, SessionContextRecord } from "../kernel/contracts.js";
import type { RuntimeExecutionObservationEvent } from "../runtime-execution-observation.js";

/** 会话身份与资源释放；不承载宿主 UI 绑定或业务外围能力。 */
export interface RuntimeSessionIdentityLifecycle {
	readonly sessionId: string;
	readonly sessionPath: string | undefined;
	dispose(): Promise<void>;
}

/** RuntimeHost 完成宿主预处理后交给 Turn 执行边界的输入。 */
export interface RuntimeTurnPrompt {
	readonly text: string;
	readonly promptRef?: PromptRequest["promptRef"];
	readonly attachments?: PromptRequest["attachments"];
	readonly images?: PromptRequest["images"];
	readonly streamingBehavior?: PromptRequest["streamingBehavior"];
	readonly metadata?: PromptRequest["metadata"];
}

/** 只负责启动、继续和中止 Turn。 */
export interface RuntimeSessionTurnControl {
	prompt(request: RuntimeTurnPrompt): Promise<RuntimeTurnPromptOutcome | undefined>;
	continue(): Promise<void>;
	abort(): Promise<void>;
}

/** 已适配为宿主稳定 SessionEvent 的会话事件流。 */
export interface RuntimeSessionEventStream {
	subscribe(handler: (event: SessionEvent) => void): () => void;
}

export interface RuntimeSessionExecutionObservation {
	readonly turnId: string;
	readonly event: RuntimeExecutionObservationEvent;
	readonly timestamp: number;
}

/**
 * Session 内部执行观察流。
 *
 * 处理器按注册顺序异步执行；异常必须由实现隔离，不能改变 Turn 结果。
 */
export interface RuntimeSessionExecutionObservationStream {
	subscribe(handler: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void): () => void;
}

export type RuntimeSessionState = Pick<
	SessionStateSnapshot,
	| "model"
	| "thinkingLevel"
	| "isStreaming"
	| "messageCount"
	| "contextPercent"
	| "contextWindow"
	| "contextComposition"
	| "activeToolNames"
	| "parentSessionPath"
	| "parentEntryId"
>;

/** RuntimeHost 基础状态面只读视图；不包含历史分支、插件或后台任务。 */
export interface RuntimeSessionStateReader {
	readState(): RuntimeSessionState;
	readMessages(): readonly Message[];
}

/** 当前活动分支的宿主稳定历史投影，只读且不负责分支导航。 */
export interface RuntimeSessionHistoryReader {
	readHistory(): readonly HistoryEntry[];
}

/**
 * 会话历史和元数据的安全写命令；实现必须保留活动 Turn 互斥、分支持久化和
 * Agent 上下文同步语义。
 */
export interface RuntimeSessionHistoryController {
	navigateForEdit(entryId: string): Promise<{ text: string; cancelled: boolean }>;
	switchBranch(entryId: string): Promise<{ leafId: string }>;
	appendBranchSummary(
		parentId: string | null,
		summary: string,
		details?: unknown,
		fromHook?: boolean,
	): Promise<{ entryId: string }>;
	deleteMessage(entryId: string): Promise<{ leafId: string | null }>;
	replaceLastUserMessage(entryId: string): Promise<{ leafId: string | null }>;
	forkSession(entryId: string): Promise<{ path: string; text: string }>;
	setName(name: string): Promise<void>;
}

export type RuntimeModelSelectionStrategy = "if-changed" | "always";

/** 模型与思考等级的写配置边界；不提供外围推理任务所需的模型只读视图。 */
export interface RuntimeSessionModelController {
	selectModel(modelKey: string, strategy: RuntimeModelSelectionStrategy): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): void;
	refreshAuth(token: string | undefined): Promise<void>;
}

/** 当前模型与候选解析的只读视图；不暴露可写 ModelRegistry。 */
export interface RuntimeSessionModelView {
	readCurrentModel(): Model<Api> | undefined;
	refreshAvailableModels(): void;
	readAvailableModels(): readonly Model<Api>[];
	resolveApiKey(model: Model<Api>): Promise<string | undefined>;
}

/** 单次宿主绑定提供的交互能力；不泄漏 coding-agent 的完整 UI 协议。 */
export interface RuntimeSessionHostInteractionContext {
	confirm(title: string, message: string, signal?: AbortSignal): Promise<boolean>;
	requestSandboxGrant(
		request: Omit<RuntimeSandboxGrantRequest, "requestId" | "sessionId">,
	): Promise<RuntimeSandboxGrantDecision>;
}

/** 将当前宿主交互能力绑定到会话；同路径复用时允许重新绑定。 */
export interface RuntimeSessionHostInteraction {
	bind(context: RuntimeSessionHostInteractionContext): Promise<void>;
}

/** 执行模式更新所需的宿主环境；不暴露旧 customTools 实现类型。 */
export interface RuntimeExecutionModeUpdate {
	readonly mode: SessionExecutionMode;
	readonly sessionId: string;
	readonly sandboxHostPath?: string;
	readonly linuxBubblewrapPath?: string;
	readonly macosSandboxExecPath?: string;
}

/** 执行忙碌态与模式重配置边界；具体工具构造留在实现适配器。 */
export interface RuntimeSessionExecutionController {
	isBusy(): boolean;
	reconfigure(update: RuntimeExecutionModeUpdate): void | Promise<void>;
}

/** Session 工作目录只读视图；目录创建和修复仍由宿主负责。 */
export interface RuntimeSessionWorkspaceView {
	readWorkingDirectory(): string | undefined;
}

/** 会话持久化文档的只读视图；供宿主兼容适配，不暴露存储或写命令。 */
export interface RuntimeSessionConversationView {
	readDocument(): ConversationDocument;
}

/** 尚未消费的用户输入数量；与具体队列实现解耦。 */
export interface RuntimeSessionQueueView {
	readPendingMessageCount(): number;
}

/** 队列条目的宿主视图（displayText 已抽取，UI 可直接渲染）。 */
export interface RuntimeSessionQueueEntryView {
	readonly id: string;
	readonly behavior: "steer" | "followUp";
	readonly displayText: string;
}

export interface RuntimeSessionQueueStateView {
	readonly paused: boolean;
	readonly entries: readonly RuntimeSessionQueueEntryView[];
}

export interface RuntimeSessionQueueController extends RuntimeSessionQueueView {
	readSteeringMode(): RuntimeSessionInputQueueMode;
	readFollowUpMode(): RuntimeSessionInputQueueMode;
	readSteeringMessages(): readonly string[];
	readFollowUpMessages(): readonly string[];
	clear(): { readonly steering: readonly string[]; readonly followUp: readonly string[] };
	/** 以下为 ADR-0060 的可管理队列能力。 */
	readQueueState(): RuntimeSessionQueueStateView;
	/** 完整可序列化快照（含 kernel 输入），宿主持久化 sidecar 用。 */
	readQueueSnapshot(): unknown;
	restoreQueue(snapshot: unknown): void;
	removeQueued(id: string): boolean;
	reorderQueuedFollowUps(ids: readonly string[]): void;
	/** running 时打断当前 turn 并立刻以该条目开新 turn，空闲时直接开 turn；不阻塞等待 turn 结束。 */
	sendQueuedNow(id: string): Promise<"promoted" | "started" | "missing">;
	/** 解除 pause-on-terminal 并继续消费；不阻塞等待 turn 结束。 */
	resumeQueue(): Promise<void>;
}

export interface RuntimeSessionContextUsage {
	readonly tokens: number | null;
	readonly contextWindow: number;
	readonly percent: number | null;
	readonly composition?: ContextCompositionReport;
}

/** 当前模型上下文占用的同步只读视图。 */
export interface RuntimeSessionContextUsageView {
	readContextUsage(): RuntimeSessionContextUsage | undefined;
}

export interface RuntimeSubagentUsageSnapshot {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly costTotal: number;
}

/** 保留旧宿主重放所需的完整子代理快照，包括事件投影之外的 usage。 */
export interface RuntimeSubagentSnapshot extends SubagentInfo {
	readonly usage: RuntimeSubagentUsageSnapshot;
}

/** 后台 bash 与 subagent 的统一宿主控制面；对应现有后台工作面板。 */
export interface RuntimeSessionBackgroundWorkController {
	clearFinished(): number;
	/** 仅清理终态后台命令；与子代理清理分离，供窄 SDK 能力使用。 */
	clearFinishedTasks?(): number;
	/** 仅清理终态子代理；与后台命令清理分离，供兼容宿主精确调用。 */
	clearFinishedSubagents?(): number;
	killTask(taskId: string): boolean;
	readTasks(): readonly BackgroundTaskInfo[];
	readSubagents(): readonly RuntimeSubagentSnapshot[];
	interruptSubagent(target: string): RuntimeSubagentSnapshot | undefined;
}

/** Todo 状态读取与受锁保护的清空命令。 */
export interface RuntimeSessionTodoController {
	readItems(): readonly TodoItem[];
	clear(): boolean;
}

export type RuntimeSessionInputQueueMode = NonNullable<SettingsPatch["steeringMode"]>;

/** 已创建会话的动态配置命令；延迟应用与忙碌态策略仍由 RuntimeHost 编排。 */
export interface RuntimeSessionConfigurationController {
	setSteeringMode(mode: RuntimeSessionInputQueueMode): void;
	setFollowUpMode(mode: RuntimeSessionInputQueueMode): void;
	reconfigureAgentPlugins(agentPlugins: AgentPluginRuntimeConfig | undefined): Promise<void>;
	setAgentMode(mode: string | undefined): void;
}

export interface RuntimeContextCompactionRequest {
	readonly customInstructions?: string;
}

export interface RuntimeContextCompactionResult {
	readonly summary: string;
	readonly firstKeptEntryId: string;
	readonly tokensBefore: number;
	readonly details?: unknown;
}

export interface RuntimeContextCompactionState {
	readonly isCompacting: boolean;
	readonly autoCompactionEnabled: boolean;
}

/** Session 级上下文控制；不暴露具体摘要算法、Extension 或存储实现。 */
export interface RuntimeSessionContextController {
	readState(): RuntimeContextCompactionState;
	compact(request?: RuntimeContextCompactionRequest): Promise<RuntimeContextCompactionResult>;
	abortCompaction(): void;
	setAutoCompactionEnabled(enabled: boolean): void;
}

export type RuntimeSessionContextDeliveryMode = "record" | "steer" | "followUp" | "nextTurn" | "triggerTurn";

/** 通用 Session 上下文投递；调用方选择时序，Kernel 负责队列与持久化。 */
export interface RuntimeSessionContextDeliveryController {
	deliver(records: readonly SessionContextRecord[], mode: RuntimeSessionContextDeliveryMode): Promise<void>;
}

/** Session 文档元数据写端口；不暴露具体文件或 Legacy SessionManager。 */
export interface RuntimeSessionMetadataController {
	appendEntry(customType: string, data?: unknown): Promise<void>;
	readName(): string | undefined;
	setName(name: string): Promise<void>;
	setLabel(entryId: string, label: string | undefined): Promise<void>;
}

/** 动态 Tool 选择与可用目录；定义仍由 Runtime Capability 层拥有。 */
export interface RuntimeSessionToolController {
	readActiveToolNames(): readonly string[];
	readAvailableTools(): ReadonlyMap<string, RuntimeToolDefinition>;
	setActiveToolNames(toolNames: readonly string[]): void;
}

export interface RuntimeSessionCorePorts {
	readonly turnControl: RuntimeSessionTurnControl;
	readonly eventStream: RuntimeSessionEventStream;
	readonly stateReader: RuntimeSessionStateReader;
}
