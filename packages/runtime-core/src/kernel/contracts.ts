import type {
	Api,
	AssistantMessage,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	StopReason,
	TextContent,
	UserMessage,
} from "@vetta/ai";
import type {
	ContextCompositionReport,
	ContextCompositionSectionInput,
	ContextSectionSource,
} from "../context-composition/contracts.js";
import type { ConversationDocument } from "../conversation/document.js";
import type {
	RuntimeExecutionObservationEvent,
	RuntimeMessageEnvelope,
	RuntimeMessageOrigin,
} from "../runtime-execution-observation.js";
import type { RuntimeSessionObservationEvent } from "../session-observation.js";

export type AgentSessionState = "idle" | "running" | "cancelling" | "closing" | "closed";

/** 由宿主适配器贡献的持久化上下文；Kernel 不解释业务类型。 */
export interface SessionContextRecord {
	readonly type: string;
	readonly content: UserMessage["content"];
	readonly modelVisible: boolean;
	readonly display?: boolean;
	readonly metadata?: unknown;
	readonly timestamp?: number;
}

export interface SessionInput {
	readonly message: UserMessage;
	readonly context?: readonly SessionContextRecord[];
	/** 在用户消息之后进入模型上下文；用于 next-turn aside 等保持顺序的输入。 */
	readonly trailingContext?: readonly SessionContextRecord[];
}

/** 可序列化的宿主输入；只在 Turn admission 后由已绑定的 Preparer 转换为 SessionInput。 */
export interface SessionInputRequest {
	readonly payload: unknown;
	readonly displayText: string;
	/** 可选的本 Turn 模型覆盖；由模型绑定 Provider 在同一次 snapshot acquire 中解释。 */
	readonly model?: {
		readonly key?: string;
		readonly reasoning?: string;
	};
}

export interface QueuedSessionInput {
	readonly message?: UserMessage;
	readonly context?: readonly SessionContextRecord[];
	readonly request?: SessionInputRequest;
}

export type SessionInputQueueMode = "all" | "one-at-a-time";

export type SessionStreamingBehavior = "steer" | "followUp";

export interface SessionSendOptions {
	readonly streamingBehavior?: SessionStreamingBehavior;
}

export interface QueuedSessionInputResult {
	readonly status: "queued";
	readonly behavior: SessionStreamingBehavior;
	readonly pendingCount: number;
	/** 队列条目 id；宿主/插件用它指认与管理这条排队消息（ADR-0060）。 */
	readonly id?: string;
}

export interface TurnInputQueue {
	takeSteering(): readonly UserMessage[];
	takeFollowUps(): readonly UserMessage[];
	takeSteeringInputs?(): readonly QueuedSessionInput[];
	takeFollowUpInputs?(): readonly QueuedSessionInput[];
	enqueueFollowUps(messages: readonly UserMessage[]): void;
}

export interface InstructionBlock {
	readonly id: string;
	readonly content: string;
	readonly priority: number;
}

export interface CapabilityBinding {
	readonly sourceId: string;
	readonly capabilityId: string;
	readonly revision: string;
}

export interface RuntimeToolDefinition<TInput extends object = Readonly<Record<string, unknown>>> {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly inputSchema: Readonly<Record<string, unknown>>;
	/** Optional host validator/decoder for schema dialects or normalized input. */
	readonly validateInput?: (input: Record<string, unknown>) => TInput;
	/** Optional provenance used by context composition reports. */
	readonly contextSource?: ContextSectionSource;
	readonly contextCategory?: string;
	/** 模型工具数组中的可选稳定顺序；未声明时保持贡献顺序并排在已声明工具之后。 */
	readonly modelOrder?: number;
	/**
	 * 在 Turn admission 获取实现身份及其 owner lease；普通 reload 只退休旧实体。
	 * Lease 不保证进程、连接或远端服务健康，物理失败仍由 execute() 传播。
	 */
	readonly bindForTurn?: (context: RuntimeSnapshotAcquireContext) => RuntimeToolTurnBinding<TInput>;
	execute(request: RuntimeToolExecutionRequest<TInput>): Promise<RuntimeToolResult>;
}

export interface RuntimeToolTurnBinding<TInput extends object = Readonly<Record<string, unknown>>> {
	readonly tool: RuntimeToolDefinition<TInput>;
	release(): Promise<void> | void;
}

export interface RuntimeToolExecutionRequest<TInput extends object = Readonly<Record<string, unknown>>> {
	readonly sessionId: string;
	readonly turnId: string;
	readonly toolCallId: string;
	readonly input: Readonly<TInput>;
	/** 工具开始执行时的模型可见消息视图。 */
	readonly messages?: readonly Message[];
	readonly signal: AbortSignal;
	readonly onUpdate?: (result: RuntimeToolResult) => void;
	readonly reportPhase?: (label: string) => void;
}

export interface RuntimeToolResult {
	readonly content: readonly (TextContent | ImageContent)[];
	readonly details?: unknown;
}

export interface ToolPolicyRequest {
	readonly sessionId: string;
	readonly turnId: string;
	readonly toolName: string;
	readonly input: unknown;
}

export interface ToolPolicy {
	authorize(request: ToolPolicyRequest, signal: AbortSignal): Promise<boolean>;
}

export interface ContextProviderInput {
	readonly sessionId: string;
	readonly turnId: string;
	readonly conversation: StoredConversation;
	readonly input?: SessionInput;
}

export interface ContextProvider {
	readonly id: string;
	provide(input: ContextProviderInput, signal: AbortSignal): Promise<readonly Message[]>;
}

/** 早期 V2 记录只包含计数；保留读取兼容，但不会改变 Conversation Document 投影。 */
export interface LegacyCompactionRecord {
	readonly id: string;
	readonly sourceMessageCount: number;
	readonly resultMessageCount: number;
	readonly summary?: string;
}

/** 能够重建活动分支模型上下文的持久化压缩事实。 */
export interface ContextCompactionRecord {
	readonly summary: string;
	readonly summaryMessage: UserMessage;
	readonly firstKeptEntryId: string;
	readonly tokensBefore: number;
	readonly details?: unknown;
	readonly fromHook?: boolean;
	readonly reason: "manual" | "threshold" | "overflow";
}

export type CompactionRecord = LegacyCompactionRecord | ContextCompactionRecord;

export interface ContextPreparationInput {
	readonly sessionId: string;
	readonly turnId: string;
	/** Provider 与当前输入已经按模型可见顺序组装后的完整调用上下文。 */
	readonly messages: readonly Message[];
	/** 当前 Turn 输入写入前的持久化活动分支消息。 */
	readonly historyMessages: readonly Message[];
	readonly tokenBudget: number;
	readonly reservedOutputTokens: number;
	readonly modelBinding?: RuntimeTurnModelBinding;
	/** 未写入会话历史、但必须保留在本次模型调用中的 Provider 消息。 */
	readonly transientMessages?: readonly Message[];
	readonly reason?: "turn_start" | "model_call" | "assistant_result" | "assistant_error";
	readonly triggeringAssistantMessage?: AssistantMessage;
	readonly recoveryAttempt?: number;
	/** 准备发生时已经持久化的最新活动 Conversation Document。 */
	readonly document?: ConversationDocument;
	/** 计算压缩切点的稳定分支；模型调用前压缩通常固定为当前 Turn 的进入时视图。 */
	readonly compactionSourceDocument?: ConversationDocument;
	reportObservation(observation: RuntimeSessionObservationEvent): Promise<void>;
}

export interface PreparedContext {
	readonly messages: readonly Message[];
	readonly estimatedTokens: number;
	readonly compaction?: ContextCompactionRecord;
	/** assistant_error 检查点可请求用当前瞬态消息视图重试。 */
	readonly retry?: boolean;
}

/** 将持久化 Conversation 投影为产品无损的活动分支消息身份。 */
export interface ConversationContextProjector {
	project(document: ConversationDocument): readonly RuntimeMessageEnvelope[];
}

export interface ContextStrategy {
	bindForTurn?(context: RuntimeSnapshotAcquireContext): Promise<ContextStrategy> | ContextStrategy;
	releaseTurnBinding?(): Promise<void> | void;
	prepare(input: ContextPreparationInput, signal: AbortSignal): Promise<PreparedContext>;
	onCompactionCommitted?(
		record: ContextCompactionRecord,
		input: ContextPreparationInput,
		signal: AbortSignal,
		document?: ConversationDocument,
	): Promise<ContextCompactionCommitResult>;
	/**
	 * 仅在通用跨 Conversation 事务及运行时身份重绑定成功后调用。
	 * 产品层可在此完成必须观察到新 Conversation 身份的压缩后处理。
	 */
	onCompactionContinuationCommitted?(
		record: ContextCompactionRecord,
		input: ContextPreparationInput,
		result: ConversationContinuationResult,
		signal: AbortSignal,
	): Promise<ContextCompactionFinalizationResult>;
	/**
	 * continuation 事务失败后的 best-effort 通知；不得替换原始事务错误。
	 */
	onCompactionContinuationFailed?(
		record: ContextCompactionRecord,
		input: ContextPreparationInput,
		error: unknown,
		signal: AbortSignal,
	): Promise<void>;
}

export interface ContextCompactionCommitResult {
	/** false 仅阻止错误恢复重试；已经提交的压缩事实不会回滚。 */
	readonly continueExecution: boolean;
	/** 产品策略可请求在提交压缩事实后续接到新的持久化 Conversation。 */
	readonly continuation?: ConversationContinuationDirective;
}

export interface ContextCompactionFinalizationResult {
	/** continuation 已提交；false 只阻止后续错误恢复重试，不回滚续接事务。 */
	readonly continueExecution: boolean;
}

export interface ConversationContinuationDirective {
	/** Kernel 不解释具体产品模式，仅将原因透传给持久化与宿主观察面。 */
	readonly reason: string;
}

export interface ManualContextCompactionInput {
	readonly sessionId: string;
	readonly document: ConversationDocument;
	readonly modelBinding?: RuntimeTurnModelBinding;
	readonly customInstructions?: string;
}

/**
 * Session 级手动压缩能力；摘要策略属于产品层，Kernel 只编排取消、提交和生命周期。
 * 实现可以与自动 ContextStrategy 为同一 Session-local 实例。
 */
export interface ManualContextCompactionRuntime {
	compactManual(input: ManualContextCompactionInput, signal: AbortSignal): Promise<ContextCompactionRecord>;
	onManualCompactionCommitted?(
		record: ContextCompactionRecord,
		input: ManualContextCompactionInput,
		signal: AbortSignal,
		document?: ConversationDocument,
	): Promise<void>;
	readAutoCompactionEnabled(): boolean;
	setAutoCompactionEnabled(enabled: boolean): void;
}

export interface ModelCallContextTransformationInput {
	readonly sessionId: string;
	readonly turnId: string;
	readonly messages: readonly Message[];
	readonly messageEnvelopes?: readonly RuntimeMessageEnvelope[];
	readonly modelBinding: RuntimeTurnModelBinding;
}

/** 每次 LLM 调用前运行的 transient 消息变换；结果不直接写入会话历史。 */
export interface ModelCallContextTransformer {
	bindForTurn?(
		context: RuntimeSnapshotAcquireContext,
	): Promise<ModelCallContextTransformer> | ModelCallContextTransformer;
	releaseTurnBinding?(): Promise<void> | void;
	transform(input: ModelCallContextTransformationInput, signal: AbortSignal): Promise<readonly Message[]>;
}

export interface ModelCallMessageFinalizationInput {
	readonly sessionId: string;
	readonly turnId: string;
	readonly messages: readonly Message[];
	readonly modelBinding: RuntimeTurnModelBinding;
}

/** Context/压缩完成后、实际调用模型前的最终消息策略。 */
export interface ModelCallMessageFinalizer {
	/** 在 Turn admission 捕获图片策略等外部设置。 */
	bindForTurn?(context: RuntimeSnapshotAcquireContext): Promise<ModelCallMessageFinalizer> | ModelCallMessageFinalizer;
	releaseTurnBinding?(): Promise<void> | void;
	finalize(input: ModelCallMessageFinalizationInput, signal: AbortSignal): Promise<readonly Message[]>;
}

export interface ModelCallContributionContext {
	readonly sessionId: string;
	readonly turnId: string;
	readonly signal: AbortSignal;
	readonly input?: SessionInput;
	/** 当前模型调用已经积累的模型可见消息。 */
	readonly messages?: readonly Message[];
	/** 当前 Turn 的不可变模型绑定。 */
	readonly modelBinding?: RuntimeTurnModelBinding;
}

export interface ModelCallContribution {
	readonly instructions?: readonly InstructionBlock[];
	readonly tools?: readonly RuntimeToolDefinition[];
}

export interface ModelCallContributionProvider {
	readonly id: string;
	/** 在 Turn admission 捕获外部状态；返回值只能读取该次捕获和 Turn-local state。 */
	bindForTurn?(
		context: RuntimeSnapshotAcquireContext,
	): Promise<ModelCallContributionProvider> | ModelCallContributionProvider;
	/** 释放本次 Turn 捕获的外部代际；由 RuntimeSnapshotLease 保证至多调用一次。 */
	releaseTurnBinding?(): Promise<void> | void;
	contribute(context: ModelCallContributionContext): Promise<ModelCallContribution>;
}

export interface ModelCallFrame {
	readonly instructions: readonly InstructionBlock[];
	readonly tools: ReadonlyMap<string, RuntimeToolDefinition>;
	/** Call-scoped sensitive inputs; reporters must not expose their content. */
	readonly contextCompositionSections?: readonly ContextCompositionSectionInput[];
}

export interface ContextCompositionPublisher {
	publishContextComposition(report: ContextCompositionReport): Promise<void> | void;
}

export interface ModelCallFrameCompositionContext {
	readonly sessionId: string;
	readonly turnId: string;
	readonly signal: AbortSignal;
	readonly input?: SessionInput;
	readonly messages: readonly Message[];
	readonly modelBinding?: RuntimeTurnModelBinding;
	/** 已汇总静态和动态 Feature 贡献的只读候选 Frame。 */
	readonly frame: ModelCallFrame;
}

/**
 * Profile 独占的模型调用最终编译器。
 *
 * 每个 Profile 最多一个 Composer；它不是可串联 Middleware，只负责把已经汇总的候选
 * Frame 编译成该产品最终交给模型的 Prompt 与工具集合。
 */
export interface ModelCallFrameComposer {
	/** 在 Turn admission 捕获产品级 Prompt、Catalog 与扩展状态。 */
	bindForTurn?(context: RuntimeSnapshotAcquireContext): Promise<ModelCallFrameComposer> | ModelCallFrameComposer;
	releaseTurnBinding?(): Promise<void> | void;
	compose(context: ModelCallFrameCompositionContext): Promise<ModelCallFrame>;
}

export interface AgentRunPreparationContext {
	readonly sessionId: string;
	readonly turnId: string;
	readonly signal: AbortSignal;
	readonly input: SessionInput;
	readonly messages: readonly Message[];
	readonly modelBinding?: RuntimeTurnModelBinding;
	/** 仅在准备器确实需要基础 Prompt 时编译，并在本次 Run 内复用。 */
	resolveSystemPrompt(): Promise<string>;
}

export interface AgentRunPreparationResult {
	/** 在当前用户输入之后追加并持久化的产品上下文。 */
	readonly context?: readonly SessionContextRecord[];
	/** 替换本次 Agent Run 的 Prompt；工具仍按每次模型调用动态解析。 */
	readonly instructionOverride?: readonly InstructionBlock[];
}

/** 显式用户输入启动 Agent Run 前的一次性产品准备边界。 */
export interface AgentRunPreparer {
	bindForTurn?(context: RuntimeSnapshotAcquireContext): Promise<AgentRunPreparer> | AgentRunPreparer;
	releaseTurnBinding?(): Promise<void> | void;
	prepare(context: AgentRunPreparationContext): Promise<AgentRunPreparationResult | undefined>;
}

export interface ContinuationPolicyContext {
	readonly sessionId: string;
	readonly turnId: string;
	readonly signal: AbortSignal;
	readonly messages: readonly Message[];
	readonly modelBinding?: RuntimeTurnModelBinding;
}

export interface ContinuationMessage {
	readonly message: UserMessage;
	readonly source: string;
}

/**
 * Profile 独占的自然停止续跑策略。
 *
 * Kernel 不解释 Todo、Plugin 或 Hook 等产品语义；策略只返回需要进入普通
 * follow-up 队列的用户消息。
 */
export interface ContinuationPolicy {
	/** 在 Turn admission 捕获续跑来源及其外部代际。 */
	bindForTurn?(context: RuntimeSnapshotAcquireContext): Promise<ContinuationPolicy> | ContinuationPolicy;
	releaseTurnBinding?(): Promise<void> | void;
	collect(context: ContinuationPolicyContext): Promise<readonly (UserMessage | ContinuationMessage)[]>;
}

export interface RuntimeSnapshot {
	readonly id: string;
	/** 允许 Agent Core 从模型正文恢复的无副作用工具调用白名单。 */
	readonly salvageTextToolCalls?: readonly string[];
	readonly instructions: readonly InstructionBlock[];
	readonly tools: ReadonlyMap<string, RuntimeToolDefinition>;
	readonly modelCallProviders?: readonly ModelCallContributionProvider[];
	readonly modelCallFrameComposer?: ModelCallFrameComposer;
	readonly inputRequestPreparer?: RuntimeInputRequestPreparer;
	readonly contextCompositionPublisher?: ContextCompositionPublisher;
	readonly agentRunPreparer?: AgentRunPreparer;
	readonly continuationPolicy?: ContinuationPolicy;
	readonly modelCallContextTransformer?: ModelCallContextTransformer;
	readonly modelCallMessageFinalizer?: ModelCallMessageFinalizer;
	readonly conversationContextProjector?: ConversationContextProjector;
	readonly contextProviders: readonly ContextProvider[];
	readonly contextStrategy: ContextStrategy;
	readonly toolPolicy: ToolPolicy;
	readonly tokenBudget: number;
	readonly reservedOutputTokens: number;
	readonly observers: readonly TurnObserver[];
}

export interface RuntimeSnapshotLease {
	readonly snapshot: RuntimeSnapshot;
	/** 与 snapshot 在同一次 acquisition 中捕获的模型绑定。 */
	readonly modelBinding?: RuntimeTurnModelBinding;
	release(): Promise<void>;
}

export type RuntimeSnapshotAcquireReason = "turn" | "manual_compaction" | "preview";

/**
 * Turn binder 的原子性依赖各实现被调用后、第一次 await 前同步捕获 published pointer。
 * 后续异步物化只能读取已捕获值；不得在 await 后重新读取 current/latest。
 */
export interface RuntimeSnapshotAcquireContext {
	readonly sessionId: string;
	readonly operationId: string;
	readonly reason: RuntimeSnapshotAcquireReason;
	readonly signal: AbortSignal;
	readonly input?: SessionInput;
	readonly request?: SessionInputRequest;
}

export interface RuntimeSnapshotProvider {
	acquire(context: RuntimeSnapshotAcquireContext): Promise<RuntimeSnapshotLease>;
}

/** 单次 Turn 使用的不可变模型选择；运行时切模只影响后续 bind。 */
export interface RuntimeTurnModelBinding {
	readonly model: Model<Api>;
	readonly reasoning?: SimpleStreamOptions["reasoning"];
	/** admission 时绑定的不透明凭证 lease；不得持久化、记录或暴露其 secret。 */
	readonly credential?: RuntimeTurnCredentialBinding;
}

/**
 * 固定 credential identity、scope 与 endpoint policy 的不透明执行端口。
 * 同身份 token 可以由 provider 实时轮换；显式撤销必须让后续 resolve fail-closed。
 */
export interface RuntimeTurnCredentialBinding {
	resolve(): Promise<string | undefined> | string | undefined;
}

export interface RuntimeTurnModelBindingProvider {
	bind(context?: RuntimeSnapshotAcquireContext): RuntimeTurnModelBinding | Promise<RuntimeTurnModelBinding>;
}

export interface RuntimeInputRequestPreparationContext {
	readonly sessionId: string;
	readonly turnId: string;
	readonly signal: AbortSignal;
	readonly queueing: boolean;
	readonly modelBinding?: RuntimeTurnModelBinding;
}

export type RuntimeInputRequestPreparationResult =
	| { readonly action: "continue"; readonly input: SessionInput }
	| { readonly action: "handled" };

/** 宿主请求到 Kernel SessionInput 的 Turn-bound 反腐层。 */
export interface RuntimeInputRequestPreparer {
	bindForTurn?(
		context: RuntimeSnapshotAcquireContext,
	): Promise<RuntimeInputRequestPreparer> | RuntimeInputRequestPreparer;
	releaseTurnBinding?(): Promise<void> | void;
	prepare(
		request: SessionInputRequest,
		context: RuntimeInputRequestPreparationContext,
	): Promise<RuntimeInputRequestPreparationResult>;
}

export interface FeaturePrepareContext {
	readonly signal: AbortSignal;
}

export interface FeatureContributionContext {
	readonly profileId: string;
	readonly signal: AbortSignal;
}

export interface FeatureContribution {
	readonly instructions?: readonly InstructionBlock[];
	readonly tools?: readonly RuntimeToolDefinition[];
	readonly contextProviders?: readonly ContextProvider[];
	readonly observers?: readonly TurnObserver[];
	readonly modelCallProviders?: readonly ModelCallContributionProvider[];
}

export interface AgentFeature {
	contribute(context: FeatureContributionContext): Promise<FeatureContribution>;
	dispose(): Promise<void>;
}

export interface AgentFeatureDefinition {
	readonly id: string;
	readonly dependencies?: readonly string[];
	readonly conflicts?: readonly string[];
	prepare(context: FeaturePrepareContext): Promise<AgentFeature>;
}

export interface AgentProfile {
	readonly id: string;
	/** 产品层显式选择的正文工具调用恢复白名单；Runtime Core 不解释工具语义。 */
	readonly salvageTextToolCalls?: readonly string[];
	readonly instructions: readonly InstructionBlock[];
	readonly features: readonly AgentFeatureDefinition[];
	readonly observers?: readonly TurnObserver[];
	readonly modelCallFrameComposer?: ModelCallFrameComposer;
	readonly inputRequestPreparer?: RuntimeInputRequestPreparer;
	readonly contextCompositionPublisher?: ContextCompositionPublisher;
	readonly agentRunPreparer?: AgentRunPreparer;
	readonly continuationPolicy?: ContinuationPolicy;
	readonly modelCallContextTransformer?: ModelCallContextTransformer;
	readonly modelCallMessageFinalizer?: ModelCallMessageFinalizer;
	readonly conversationContextProjector?: ConversationContextProjector;
	readonly contextStrategy: ContextStrategy;
	readonly toolPolicy: ToolPolicy;
	readonly tokenBudget: number;
	readonly reservedOutputTokens: number;
}

export interface CompiledRuntimeSnapshot {
	readonly snapshot: RuntimeSnapshot;
	dispose(): Promise<void>;
}

export interface ConversationMetadata {
	readonly sessionId: string;
	readonly createdAt: number;
	readonly version: number;
}

export interface StoredConversation extends ConversationMetadata {
	readonly messages: readonly Message[];
	readonly events: readonly StoredSessionEvent[];
}

export interface CreateConversationInput {
	readonly sessionId: string;
	readonly createdAt: number;
	readonly cwd?: string;
}

export interface AppendResult {
	readonly version: number;
}

export interface ConversationRepository {
	create(input: CreateConversationInput): Promise<ConversationMetadata>;
	load(sessionId: string): Promise<StoredConversation>;
	append(sessionId: string, expectedVersion: number, events: readonly StoredSessionEvent[]): Promise<AppendResult>;
	saveSnapshot(sessionId: string, snapshot: ConversationSnapshot): Promise<void>;
	close(): Promise<void>;
}

export interface ContinueConversationInput {
	readonly sourceSessionId: string;
	readonly expectedVersion: number;
	readonly turnId: string;
	readonly snapshotId: string;
	readonly reason: string;
	readonly timestamp: number;
}

export interface ConversationContinuationResult {
	readonly sourceSessionId: string;
	readonly sourceSessionPath?: string;
	readonly sourceVersion: number;
	readonly sessionId: string;
	readonly sessionPath?: string;
	readonly version: number;
	/** 目标文件写入 turn.continued 前的投影，用于运行时无重读地原子重绑定。 */
	readonly seedConversation: StoredConversation;
	readonly seedDocument: ConversationDocument;
	readonly transferredEvent: TurnTransferredEvent;
	readonly continuedEvent: TurnContinuedEvent;
}

/** 跨 Conversation 续接的持久化事务；具体文件、数据库或远端实现留在 Storage Adapter。 */
export interface ConversationContinuationStore {
	continueConversation(input: ContinueConversationInput): Promise<ConversationContinuationResult>;
}

export interface ConversationSnapshot {
	readonly sessionId: string;
	readonly version: number;
	readonly messages: readonly Message[];
	readonly createdAt: number;
}

export interface TurnStartedEvent {
	readonly type: "turn.started";
	readonly sessionId: string;
	readonly turnId: string;
	readonly snapshotId: string;
	readonly timestamp: number;
}

export interface MessageAppendedEvent {
	readonly type: "message.appended";
	readonly sessionId: string;
	readonly turnId: string;
	readonly message: Message;
	readonly origin?: RuntimeMessageOrigin;
	readonly timestamp: number;
}

export interface ContextAppendedEvent {
	readonly type: "context.appended";
	readonly sessionId: string;
	readonly turnId: string;
	readonly record: SessionContextRecord;
	readonly timestamp: number;
}

/** 不启动 Turn 的 Session 级上下文持久化事实。 */
export interface ContextRecordedEvent {
	readonly type: "context.recorded";
	readonly sessionId: string;
	readonly turnId?: never;
	readonly record: SessionContextRecord;
	readonly timestamp: number;
}

export interface ContextCompactedEvent {
	readonly type: "context.compacted";
	readonly sessionId: string;
	/** 自动压缩属于活动 Turn；手动压缩是 Session 级事实，不携带 turnId。 */
	readonly turnId?: string;
	readonly record: CompactionRecord;
	readonly timestamp: number;
}

export interface TurnCompletedEvent {
	readonly type: "turn.completed";
	readonly sessionId: string;
	readonly turnId: string;
	readonly stopReason: StopReason;
	readonly timestamp: number;
}

export interface TurnCancelledEvent {
	readonly type: "turn.cancelled";
	readonly sessionId: string;
	readonly turnId: string;
	readonly reason?: string;
	readonly timestamp: number;
}

export interface TurnFailedEvent {
	readonly type: "turn.failed";
	readonly sessionId: string;
	readonly turnId: string;
	readonly error: {
		readonly code: string;
		readonly message: string;
	};
	readonly timestamp: number;
}

/** 源 Conversation 的终止事实；同一 Turn 已转移到另一个持久化实体。 */
export interface TurnTransferredEvent {
	readonly type: "turn.transferred";
	readonly sessionId: string;
	readonly turnId: string;
	readonly targetSessionId: string;
	readonly reason: string;
	readonly timestamp: number;
}

/** 目标 Conversation 的起始事实；不是新的 Turn。 */
export interface TurnContinuedEvent {
	readonly type: "turn.continued";
	readonly sessionId: string;
	readonly turnId: string;
	readonly sourceSessionId: string;
	readonly snapshotId: string;
	readonly reason: string;
	readonly timestamp: number;
}

export type StoredSessionEvent =
	| TurnStartedEvent
	| TurnContinuedEvent
	| MessageAppendedEvent
	| ContextAppendedEvent
	| ContextRecordedEvent
	| ContextCompactedEvent
	| TurnCompletedEvent
	| TurnCancelledEvent
	| TurnFailedEvent
	| TurnTransferredEvent;

export type TurnPipelineStage =
	| "admission"
	| "snapshot_binding"
	| "conversation_loading"
	| "context_assembly"
	| "context_preparation"
	| "execution"
	| "finalization";

export interface TurnPipelineStageEvent {
	readonly type: "pipeline.stage";
	readonly sessionId: string;
	readonly turnId: string;
	readonly stage: TurnPipelineStage;
	readonly timestamp: number;
}

export interface ObserverFailedEvent {
	readonly type: "observer.failed";
	readonly sessionId: string;
	readonly turnId?: string;
	readonly observerId: string;
	readonly error: string;
	readonly timestamp: number;
}

/** 瞬时会话观察事件；只发布给 EventSink，不进入 ConversationRepository。 */
export interface RuntimeSessionObservationEnvelope {
	readonly type: "session.observation";
	readonly sessionId: string;
	/** Session-level peripheral observations can occur between Turns. */
	readonly turnId?: string;
	readonly observation: RuntimeSessionObservationEvent;
	readonly timestamp: number;
}

/** 完整执行观察事件；不持久化，也不直接映射为应用层 SessionEvent。 */
export interface RuntimeExecutionObservationEnvelope {
	readonly type: "execution.observation";
	readonly sessionId: string;
	readonly turnId: string;
	readonly observation: RuntimeExecutionObservationEvent;
	readonly timestamp: number;
}

/** 瞬时续接事件；目标 seed 已持久化，但该事件本身不写入 Conversation。 */
export interface ConversationContinuedEvent {
	readonly type: "conversation.continued";
	readonly sourceSessionId: string;
	readonly sourceSessionPath?: string;
	readonly sessionId: string;
	readonly sessionPath?: string;
	readonly turnId: string;
	readonly reason: string;
	readonly conversation: StoredConversation;
	readonly document: ConversationDocument;
	readonly timestamp: number;
}

/** 输入队列可观察变化（入队/消费/移除/重排/暂停/恢复）。ADR-0060。 */
export interface QueueChangedKernelEvent {
	readonly type: "queue.changed";
	readonly sessionId: string;
	readonly timestamp: number;
	readonly snapshot: {
		readonly paused: boolean;
		readonly entries: readonly {
			readonly id: string;
			readonly behavior: SessionStreamingBehavior;
			readonly input: QueuedSessionInput;
		}[];
	};
}

export type KernelEvent =
	| StoredSessionEvent
	| TurnPipelineStageEvent
	| ObserverFailedEvent
	| RuntimeSessionObservationEnvelope
	| RuntimeExecutionObservationEnvelope
	| ConversationContinuedEvent
	| QueueChangedKernelEvent;

export interface EventSink {
	publish(event: KernelEvent): Promise<void>;
}

export interface TurnObserver {
	readonly id: string;
	observe(event: StoredSessionEvent, signal: AbortSignal): Promise<void>;
}

export interface TurnEngineRequest {
	readonly sessionId: string;
	readonly turnId: string;
	readonly snapshot: RuntimeSnapshot;
	readonly modelBinding?: RuntimeTurnModelBinding;
	readonly messages: readonly Message[];
	/** Agent Core 的产品无损 canonical context；模型输入仍由 messages 决定。 */
	readonly contextMessages?: readonly RuntimeMessageEnvelope[];
	/** 显式 Run 新增消息的身份视图；仅用于执行观察，不参与模型上下文。 */
	readonly initialMessages?: readonly RuntimeMessageEnvelope[];
	/** Run Preparation 已编译的首次模型调用 Frame；避免基础 Prompt 重复编译。 */
	readonly initialModelCallFrame?: ModelCallFrame;
	/** 本次 Agent Run 固定使用的 Prompt 覆盖；不影响动态工具集合。 */
	readonly instructionOverride?: readonly InstructionBlock[];
	readonly signal: AbortSignal;
	readonly inputQueue?: TurnInputQueue;
	readonly input?: SessionInput;
	/** Engine 消费流式队列上下文时，必须先交回 Pipeline 持久化。 */
	appendQueuedContext?(records: readonly SessionContextRecord[]): Promise<void>;
	/** 模型调用边界的持久化/压缩请求，沿普通异步调用栈完成。 */
	readonly checkpoint?: TurnEngineContextCheckpointHandler;
}

export interface TurnEngineContextCheckpointResult {
	readonly messages: readonly Message[];
	readonly contextMessages?: readonly Message[];
	readonly contextMessageEnvelopes?: readonly RuntimeMessageEnvelope[];
	readonly retry?: boolean;
}

export interface TurnEngineContextCheckpointRequest {
	readonly reason: "model_call" | "assistant_result" | "assistant_error";
	readonly messages: readonly Message[];
	readonly assistantMessage?: AssistantMessage;
	readonly recoveryAttempt: number;
}

export type TurnEngineContextCheckpointHandler = (
	request: TurnEngineContextCheckpointRequest,
	signal: AbortSignal,
) => Promise<TurnEngineContextCheckpointResult | undefined>;

export type TurnEngineEvent =
	| {
			readonly type: "observation";
			readonly observation: RuntimeSessionObservationEvent;
	  }
	| {
			readonly type: "execution_observation";
			readonly observation: RuntimeExecutionObservationEvent;
	  }
	| {
			readonly type: "message";
			readonly message: Message;
			readonly origin?: RuntimeMessageOrigin;
	  }
	| {
			readonly type: "completed";
			readonly stopReason: StopReason;
	  };

export interface TurnEnginePort {
	execute(request: TurnEngineRequest): AsyncIterable<TurnEngineEvent>;
}

export interface Clock {
	now(): number;
}

export interface IdGenerator {
	next(scope: "snapshot" | "turn"): string;
}

/** AgentSession 与 TurnPipeline 共享的可变持久化身份；仅允许由续接事务更新。 */
export interface TurnSessionIdentity {
	readonly sessionId: string;
	transition(sessionId: string): void;
}

export type TurnResult =
	| {
			readonly status: "completed";
			readonly sessionId: string;
			readonly turnId: string;
			readonly stopReason: StopReason;
			readonly messages: readonly Message[];
	  }
	| {
			readonly status: "cancelled";
			readonly sessionId: string;
			readonly turnId: string;
			readonly reason?: string;
			readonly messages: readonly Message[];
	  }
	| {
			readonly status: "failed";
			readonly sessionId: string;
			readonly turnId: string;
			readonly error: {
				readonly code: string;
				readonly message: string;
			};
			readonly messages: readonly Message[];
	  };

export interface HandledSessionInputResult {
	readonly status: "handled";
	readonly sessionId: string;
}

export type SessionSendResult = TurnResult | QueuedSessionInputResult | HandledSessionInputResult;
