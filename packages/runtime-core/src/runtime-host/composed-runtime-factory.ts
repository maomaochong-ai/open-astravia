import type { StreamFn } from "@vetta/agent-core";
import type { SimpleStreamOptions } from "@vetta/ai";
import type { ConversationDocumentStore } from "../conversation/index.js";
import {
	AgentCoreTurnEngine,
	type AgentCoreTurnEngineOptions,
	type AgentSession,
	BufferedRuntimeSessionContext,
	type Clock,
	ContextCompactionCommitter,
	type ConversationContinuationResult,
	type ConversationContinuationStore,
	type ConversationRepository,
	createAgentSession,
	type EventSink,
	type IdGenerator,
	type ManualContextCompactionRuntime,
	RandomIdGenerator,
	type RuntimeSessionContextAppender,
	type RuntimeSnapshotProvider,
	resumeAgentSession,
	type SessionContextRecord,
	type SessionInputQueueMode,
	type SessionInputQueueSnapshot,
	SystemClock,
	TurnPipeline,
} from "../kernel/index.js";
import type { RuntimeSessionObservationEvent } from "../session-observation.js";
import { InitializationRollbackScope } from "./initialization-rollback-scope.js";
import type {
	KernelRuntimeAssembly,
	KernelRuntimeFactory,
	RuntimePromptAdapter,
} from "./kernel-runtime-session-backend.js";
import type { RuntimeDocumentParticipant } from "./runtime-document-participant.js";
import type { RuntimeModelRuntime } from "./runtime-model.js";
import { KernelRuntimeSessionContextController } from "./runtime-session-context-controller.js";
import type { RuntimeSessionIdentity, RuntimeStateSource } from "./runtime-session-projection.js";
import type {
	RuntimeSessionBackgroundWorkController,
	RuntimeSessionConfigurationController,
	RuntimeSessionExecutionController,
	RuntimeSessionHostInteraction,
	RuntimeSessionTodoController,
	RuntimeSessionToolController,
} from "./session-ports.js";

export type RuntimeAssemblyOperation = "create" | "resume";

export type RuntimeSessionPeripherals = Partial<
	Pick<
		KernelRuntimeAssembly,
		"hostInteraction" | "executionController" | "backgroundWorkController" | "configurationController"
	>
>;

export interface RuntimeResourceContext {
	readonly operation: RuntimeAssemblyOperation;
	readonly contextAppender: RuntimeSessionContextAppender;
	/**
	 * 投递由后台工作产生的上下文，并按 follow-up 语义唤醒或续跑 Session。
	 * 调用方不能直接操作 Kernel 输入队列。
	 */
	deliverAsyncContext(records: readonly SessionContextRecord[]): Promise<void>;
	abortCurrentRun(): void;
	reportObservation(observation: RuntimeSessionObservationEvent): Promise<void>;
}

export interface RuntimeResources {
	readonly sessionId: string;
	readonly repository: ConversationRepository;
	readonly conversationDocumentStore: ConversationDocumentStore;
	readonly conversationContinuationStore?: ConversationContinuationStore;
	readonly promptAdapter: RuntimePromptAdapter;
	readonly snapshotProvider: RuntimeSnapshotProvider;
	readonly modelRuntime: RuntimeModelRuntime;
	readonly identity: RuntimeSessionIdentity;
	readonly stateSource: RuntimeStateSource;
	readonly documentParticipants?: readonly RuntimeDocumentParticipant[];
	readonly todoController?: RuntimeSessionTodoController;
	readonly hostInteraction?: RuntimeSessionHostInteraction;
	readonly executionController?: RuntimeSessionExecutionController;
	readonly backgroundWorkController?: RuntimeSessionBackgroundWorkController;
	readonly configurationController?: RuntimeSessionConfigurationController;
	readonly toolController?: RuntimeSessionToolController;
	/**
	 * 需要绑定真实 Kernel Session 的外围控制器工厂。
	 * 它在 create/resume 完成后执行，返回值优先于上面的预创建控制器。
	 */
	createSessionPeripherals?(session: AgentSession): RuntimeSessionPeripherals;
	readonly contextRuntime?: ManualContextCompactionRuntime;
	readonly steeringMode?: SessionInputQueueMode;
	readonly followUpMode?: SessionInputQueueMode;
	onConversationContinued?(result: ConversationContinuationResult): Promise<void> | void;
	dispose?(): Promise<void>;
}

export interface ComposedRuntimeFactoryOptions<TCreateOptions> {
	createResources(options: TCreateOptions, context: RuntimeResourceContext): Promise<RuntimeResources>;
	readonly streamFn?: StreamFn;
	readonly streamOptions?: Omit<SimpleStreamOptions, "sessionId" | "signal">;
	readonly tracer?: AgentCoreTurnEngineOptions["tracer"];
	readonly tracing?: AgentCoreTurnEngineOptions["tracing"];
	readonly clock?: Clock;
	readonly idGenerator?: IdGenerator;
}

/**
 * 只组合 Runtime-owned 对象的默认 Runtime Factory。
 *
 * Repository、Snapshot、Model Runtime 和宿主资源仍由上层提供；本类负责保证
 * AgentSession、TurnPipeline、TurnEngine 使用同一组 Session 资源。
 */
export class ComposedRuntimeFactory<TCreateOptions> implements KernelRuntimeFactory<TCreateOptions> {
	private readonly options: ComposedRuntimeFactoryOptions<TCreateOptions>;
	private readonly clock: Clock;
	private readonly idGenerator: IdGenerator;

	constructor(options: ComposedRuntimeFactoryOptions<TCreateOptions>) {
		this.options = options;
		this.clock = options.clock ?? new SystemClock();
		this.idGenerator = options.idGenerator ?? new RandomIdGenerator();
	}

	create(options: TCreateOptions, eventSink: EventSink): Promise<KernelRuntimeAssembly> {
		return this.assemble("create", options, eventSink);
	}

	resume(options: TCreateOptions, eventSink: EventSink): Promise<KernelRuntimeAssembly> {
		return this.assemble("resume", options, eventSink);
	}

	private async assemble(
		operation: RuntimeAssemblyOperation,
		options: TCreateOptions,
		eventSink: EventSink,
	): Promise<KernelRuntimeAssembly> {
		const runtimeContext = new BufferedRuntimeSessionContext();
		let abortCurrentRun = (): void => {};
		let requestContinuation: ((records: readonly SessionContextRecord[]) => Promise<void>) | undefined;
		const pendingContinuationContext: SessionContextRecord[] = [];
		let observationSessionId: string | undefined;
		const pendingObservations: RuntimeSessionObservationEvent[] = [];
		const reportObservation = async (observation: RuntimeSessionObservationEvent): Promise<void> => {
			if (!observationSessionId) {
				pendingObservations.push(observation);
				return;
			}
			await eventSink.publish({
				type: "session.observation",
				sessionId: observationSessionId,
				observation,
				timestamp: this.clock.now(),
			});
		};
		const resources = await this.options.createResources(options, {
			operation,
			contextAppender: runtimeContext,
			deliverAsyncContext: async (records) => {
				if (!requestContinuation) {
					pendingContinuationContext.push(...records);
					return;
				}
				await requestContinuation(records);
			},
			abortCurrentRun: () => abortCurrentRun(),
			reportObservation,
		});
		const rollback = new InitializationRollbackScope();
		rollback.defer({
			id: "runtime-context",
			rollback: () => runtimeContext.clear(),
		});
		if (resources.dispose) {
			rollback.defer({
				id: "runtime-resources",
				rollback: () => resources.dispose?.call(resources),
			});
		}
		try {
			observationSessionId = resources.sessionId;
			for (const observation of pendingObservations.splice(0)) {
				await reportObservation(observation);
			}
			const turnEngine = new AgentCoreTurnEngine({
				streamFn: this.options.streamFn,
				streamOptions: this.options.streamOptions,
				tracer: this.options.tracer,
				tracing: this.options.tracing,
				resolveApiKey: (model) => resources.modelRuntime.resolveApiKey(model),
			});
			const contextCompactionCommitter = new ContextCompactionCommitter({
				repository: resources.repository,
				eventSink,
				clock: this.clock,
				conversationDocumentReader: resources.conversationDocumentStore,
			});
			const pipeline = new TurnPipeline({
				repository: resources.repository,
				snapshotProvider: resources.snapshotProvider,
				modelBindingProvider: resources.modelRuntime,
				turnEngine,
				eventSink,
				clock: this.clock,
				idGenerator: this.idGenerator,
				runtimeContext,
				conversationDocumentReader: resources.conversationDocumentStore,
				contextCompactionCommitter,
				conversationContinuationStore: resources.conversationContinuationStore,
				onConversationContinued: resources.onConversationContinued
					? (result) => resources.onConversationContinued?.(result)
					: undefined,
			});
			const sessionIdRef = { current: resources.sessionId };
			const sessionOptions = {
				id: resources.sessionId,
				pipeline,
				cwd: resources.identity.cwd,
				steeringMode: resources.steeringMode,
				followUpMode: resources.followUpMode,
				// 队列变化以 kernel 事件广播（ADR-0060）：宿主据此镜像 UI 并持久化 sidecar。
				onQueueChange: (snapshot: SessionInputQueueSnapshot) => {
					void eventSink
						.publish({
							type: "queue.changed",
							sessionId: sessionIdRef.current,
							timestamp: this.clock.now(),
							snapshot,
						})
						.catch((error) => {
							console.warn("[runtime-core] failed to publish queue.changed", error);
						});
				},
			};
			const session =
				operation === "create"
					? await createAgentSession(sessionOptions)
					: await resumeAgentSession(sessionOptions);
			sessionIdRef.current = session.id;
			rollback.defer({ id: "kernel-session", rollback: () => session.close() });
			requestContinuation = (records) => session.requestContinuation(records);
			if (pendingContinuationContext.length > 0) {
				const records = pendingContinuationContext.splice(0);
				void requestContinuation(records).catch((error) => {
					console.warn("[runtime-core] failed to deliver pending asynchronous context", error);
				});
			}
			abortCurrentRun = () => {
				void session.cancel().catch((error) => {
					console.warn("[runtime-core] failed to abort Runtime session", error);
				});
			};
			const contextController = resources.contextRuntime
				? new KernelRuntimeSessionContextController({
						session,
						repository: resources.repository,
						conversationDocumentReader: resources.conversationDocumentStore,
						snapshotProvider: resources.snapshotProvider,
						modelBindingProvider: resources.modelRuntime,
						contextRuntime: resources.contextRuntime,
						committer: contextCompactionCommitter,
					})
				: undefined;
			const sessionPeripherals = resources.createSessionPeripherals?.(session);
			const dispose = resources.dispose;
			const assembly: KernelRuntimeAssembly = {
				session,
				repository: resources.repository,
				conversationDocumentStore: resources.conversationDocumentStore,
				promptAdapter: resources.promptAdapter,
				modelRuntime: resources.modelRuntime,
				identity: resources.identity,
				stateSource: resources.stateSource,
				documentParticipants: resources.documentParticipants,
				todoController: resources.todoController,
				hostInteraction: sessionPeripherals?.hostInteraction ?? resources.hostInteraction,
				executionController: sessionPeripherals?.executionController ?? resources.executionController,
				backgroundWorkController:
					sessionPeripherals?.backgroundWorkController ?? resources.backgroundWorkController,
				configurationController: sessionPeripherals?.configurationController ?? resources.configurationController,
				contextController,
				contextDeliveryController: {
					deliver: async (records, mode) => {
						if (mode === "record") {
							await session.recordContext(records);
							return;
						}
						if (mode === "nextTurn") {
							session.queueNextTurnContext(records);
							return;
						}
						if (mode === "triggerTurn") {
							await session.requestContinuation(records);
							return;
						}
						session.queueContext(mode, records);
					},
				},
				toolController: resources.toolController,
				dispose: dispose ? () => dispose.call(resources) : undefined,
			};
			rollback.commit();
			return assembly;
		} catch (error) {
			return rollback.rollback(error, "Runtime initialization and rollback failed");
		}
	}
}
