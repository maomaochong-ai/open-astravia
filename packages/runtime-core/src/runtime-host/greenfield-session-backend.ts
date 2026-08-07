import { randomUUID } from "node:crypto";
import type { Message } from "@vetta/ai";
import type { HistoryEntry, PromptRequest, SessionEvent } from "../contracts.js";
import {
	type ConversationDocument,
	type ConversationDocumentCommand,
	type ConversationDocumentCommandResult,
	type ConversationDocumentStore,
	conversationDocumentEntry,
	extractConversationEntryText,
} from "../conversation/index.js";
import type { AgentSession } from "../kernel/agent-session.js";
import type {
	AgentSessionState,
	ConversationRepository,
	EventSink,
	KernelEvent,
	SessionInput,
	SessionInputQueueMode,
	SessionSendOptions,
	SessionSendResult,
	StoredSessionEvent,
	TurnResult,
} from "../kernel/contracts.js";
import { sessionBusyError, sessionClosedError } from "../kernel/errors.js";
import { GreenfieldDocumentMutationCoordinator } from "./greenfield-document-mutation-coordinator.js";
import type {
	GreenfieldRuntimeDocumentParticipant,
	GreenfieldRuntimeDocumentParticipantContext,
} from "./greenfield-document-participant.js";
import type { GreenfieldRuntimeModelRuntime } from "./greenfield-model-runtime.js";
import { mapGreenfieldKernelEventToSessionEvents } from "./greenfield-session-events.js";
import {
	type GreenfieldRuntimeSessionIdentity,
	type GreenfieldRuntimeStateSource,
	GreenfieldSessionProjection,
} from "./greenfield-session-projection.js";
import { RetryableCleanup } from "./retryable-cleanup.js";
import type {
	RuntimeHostSessionAssembly,
	RuntimeHostSessionAssemblyCandidate,
	RuntimeSessionBackend,
} from "./session-backend.js";
import type {
	RuntimeSessionBackgroundWorkController,
	RuntimeSessionConfigurationController,
	RuntimeSessionContextController,
	RuntimeSessionContextDeliveryController,
	RuntimeSessionContextUsageView,
	RuntimeSessionConversationView,
	RuntimeSessionExecutionController,
	RuntimeSessionExecutionObservation,
	RuntimeSessionExecutionObservationStream,
	RuntimeSessionHostInteraction,
	RuntimeSessionMetadataController,
	RuntimeSessionQueueController,
	RuntimeSessionQueueView,
	RuntimeSessionState,
	RuntimeSessionTodoController,
	RuntimeSessionToolController,
} from "./session-ports.js";

export interface RuntimePromptPreparationContext {
	readonly sessionId: string;
	readonly queueing: boolean;
}

export interface RuntimePreparedPrompt {
	readonly input: SessionInput;
	readonly options?: SessionSendOptions;
}

export type RuntimePromptInterceptionResult =
	| { readonly action: "continue"; readonly request: PromptRequest }
	| { readonly action: "handled" };

export interface RuntimeHandledPromptResult {
	readonly status: "handled";
	readonly sessionId: string;
}

export type RuntimePromptResult = SessionSendResult | RuntimeHandledPromptResult;

/** 外部 PromptRequest 到 Kernel 输入的必需反腐层；Backend 不静默忽略宿主字段。 */
export interface RuntimePromptAdapter {
	intercept?(
		request: PromptRequest,
		context: RuntimePromptPreparationContext,
	): Promise<RuntimePromptInterceptionResult>;
	prepare(request: PromptRequest, context: RuntimePromptPreparationContext): Promise<RuntimePreparedPrompt>;
}

export interface GreenfieldRuntimeAssembly {
	readonly session: AgentSession;
	readonly repository: ConversationRepository;
	readonly conversationDocumentStore: ConversationDocumentStore;
	readonly promptAdapter: RuntimePromptAdapter;
	readonly modelRuntime: GreenfieldRuntimeModelRuntime;
	readonly identity: GreenfieldRuntimeSessionIdentity;
	readonly stateSource: GreenfieldRuntimeStateSource;
	readonly documentParticipants?: readonly GreenfieldRuntimeDocumentParticipant[];
	readonly todoController?: RuntimeSessionTodoController;
	readonly contextController?: RuntimeSessionContextController;
	readonly contextDeliveryController?: RuntimeSessionContextDeliveryController;
	readonly hostInteraction?: RuntimeSessionHostInteraction;
	readonly executionController?: RuntimeSessionExecutionController;
	readonly backgroundWorkController?: RuntimeSessionBackgroundWorkController;
	readonly configurationController?: RuntimeSessionConfigurationController;
	readonly toolController?: RuntimeSessionToolController;
	/** 由组合根释放 Session 之外的独占资源；共享 Repository 不应在这里关闭。 */
	dispose?(): Promise<void>;
}

export interface GreenfieldRuntimeFactory<TCreateOptions> {
	create(options: TCreateOptions, eventSink: EventSink): Promise<GreenfieldRuntimeAssembly>;
	resume(options: TCreateOptions, eventSink: EventSink): Promise<GreenfieldRuntimeAssembly>;
}

export interface GreenfieldRuntimeSessionBackendOptions<TCreateOptions> {
	readonly runtimeFactory: GreenfieldRuntimeFactory<TCreateOptions>;
}

export interface GreenfieldRuntimeSessionState {
	readonly sessionId: string;
	readonly state: AgentSessionState;
	readonly pendingMessageCount: number;
	readonly steeringMode: SessionInputQueueMode;
	readonly followUpMode: SessionInputQueueMode;
	readonly messageCount: number;
}

/** Greenfield 当前真实具备的 RuntimeHost 核心能力；不包含尚未迁移的外围 Port。 */
export type GreenfieldRuntimeSessionCoreAssembly = Pick<
	RuntimeHostSessionAssembly,
	"lifecycle" | "historyReader" | "historyController" | "modelController" | "modelView" | "workspaceView" | "corePorts"
> & {
	readonly conversationView: RuntimeSessionConversationView;
	readonly queueView: RuntimeSessionQueueView;
	readonly queueController: RuntimeSessionQueueController;
	readonly contextUsageView: RuntimeSessionContextUsageView;
	readonly executionObservationStream: RuntimeSessionExecutionObservationStream;
	readonly todoController?: RuntimeSessionTodoController;
	readonly contextController?: RuntimeSessionContextController;
	readonly contextDeliveryController: RuntimeSessionContextDeliveryController;
	readonly metadataController: RuntimeSessionMetadataController;
	readonly toolController?: RuntimeSessionToolController;
};

export class GreenfieldRuntimeSession {
	private readonly session: AgentSession;
	private readonly promptAdapter: RuntimePromptAdapter;
	private readonly eventSink: GreenfieldSessionEventSink;
	private readonly modelRuntime: GreenfieldRuntimeModelRuntime;
	private readonly stateSource: GreenfieldRuntimeStateSource;
	private readonly conversationDocumentStore: ConversationDocumentStore;
	private readonly projection: GreenfieldSessionProjection;
	private readonly documentMutations: GreenfieldDocumentMutationCoordinator;
	private readonly documentParticipants: readonly GreenfieldRuntimeDocumentParticipant[];
	private readonly todoController: RuntimeSessionTodoController | undefined;
	private readonly contextController: RuntimeSessionContextController | undefined;
	private readonly contextDeliveryController: RuntimeSessionContextDeliveryController;
	private readonly hostInteraction: RuntimeSessionHostInteraction | undefined;
	private readonly executionController: RuntimeSessionExecutionController | undefined;
	private readonly backgroundWorkController: RuntimeSessionBackgroundWorkController | undefined;
	private readonly configurationController: RuntimeSessionConfigurationController | undefined;
	private readonly toolController: RuntimeSessionToolController | undefined;
	private readonly disposeRuntime: (() => Promise<void>) | undefined;
	private readonly cleanup = new RetryableCleanup();
	private disposed = false;
	private historyMutation = false;

	constructor(
		assembly: GreenfieldRuntimeAssembly,
		eventSink: GreenfieldSessionEventSink,
		projection: GreenfieldSessionProjection,
	) {
		this.session = assembly.session;
		this.promptAdapter = assembly.promptAdapter;
		this.eventSink = eventSink;
		this.modelRuntime = assembly.modelRuntime;
		this.stateSource = assembly.stateSource;
		this.conversationDocumentStore = assembly.conversationDocumentStore;
		this.projection = projection;
		this.documentMutations = new GreenfieldDocumentMutationCoordinator({
			readSessionId: () => this.session.id,
			store: this.conversationDocumentStore,
			readProjectedDocument: () => this.projection.readDocument(),
			replaceProjectedDocument: (document) => this.projection.replaceDocument(document),
		});
		this.eventSink.bindDocumentMutationCoordinator(this.documentMutations);
		this.documentParticipants = assembly.documentParticipants ?? [];
		this.todoController = assembly.todoController;
		this.contextController = assembly.contextController;
		this.contextDeliveryController =
			assembly.contextDeliveryController ?? createContextDeliveryController(assembly.session);
		this.hostInteraction = assembly.hostInteraction;
		this.executionController = assembly.executionController;
		this.backgroundWorkController = assembly.backgroundWorkController;
		this.configurationController = assembly.configurationController;
		this.toolController = assembly.toolController;
		const dispose = assembly.dispose;
		this.disposeRuntime = dispose ? () => dispose.call(assembly) : undefined;
		this.cleanup.add({
			id: "context-compaction",
			phase: 0,
			cleanup: () => this.contextController?.abortCompaction(),
		});
		for (const [index, participant] of this.documentParticipants.entries()) {
			if (participant.dispose) {
				this.cleanup.add({
					id: `document-participant:${index}`,
					phase: 1,
					cleanup: () => participant.dispose?.(),
				});
			}
		}
		this.cleanup.add({ id: "event-sink", phase: 2, cleanup: () => this.eventSink.clear() });
		this.cleanup.add({ id: "kernel-session", phase: 3, cleanup: () => this.session.close() });
		if (this.disposeRuntime) {
			this.cleanup.add({ id: "runtime-assembly", phase: 4, cleanup: this.disposeRuntime });
		}
	}

	get sessionId(): string {
		return this.session.id;
	}

	async prompt(request: PromptRequest): Promise<RuntimePromptResult> {
		this.assertOpen();
		if (this.historyMutation || this.contextController?.readState().isCompacting) throw sessionBusyError();
		if ((this.session.state === "running" || this.session.state === "cancelling") && !request.streamingBehavior) {
			throw sessionBusyError();
		}
		if (request.modelKey) {
			await this.modelRuntime.selectModel(request.modelKey, "if-changed");
		}
		if (request.reasoning) {
			this.modelRuntime.setThinkingLevel(request.reasoning);
		}
		const context = {
			sessionId: this.sessionId,
			queueing: this.session.state === "running" || this.session.state === "cancelling",
		};
		const normalized = this.normalizeImages(request);
		const intercepted = await this.promptAdapter.intercept?.(normalized, context);
		this.assertOpen();
		if (intercepted?.action === "handled") {
			return { status: "handled", sessionId: this.sessionId };
		}
		const prepared = await this.promptAdapter.prepare(
			intercepted?.action === "continue" ? intercepted.request : normalized,
			context,
		);
		this.assertOpen();
		return this.session.send(prepared.input, prepared.options ?? {});
	}

	async continue(): Promise<TurnResult> {
		this.assertOpen();
		if (this.historyMutation || this.contextController?.readState().isCompacting) throw sessionBusyError();
		return this.session.continue();
	}

	async retry(): Promise<TurnResult> {
		this.assertOpen();
		if (this.historyMutation || this.contextController?.readState().isCompacting) throw sessionBusyError();
		return this.session.retry();
	}

	async abort(reason?: string): Promise<void> {
		this.assertOpen();
		await this.session.cancel(reason);
	}

	subscribe(handler: (event: SessionEvent) => void): () => void {
		this.assertOpen();
		return this.eventSink.subscribe(handler);
	}

	async getState(): Promise<GreenfieldRuntimeSessionState> {
		this.assertOpen();
		return {
			sessionId: this.sessionId,
			state: this.session.state,
			pendingMessageCount: this.session.pendingMessageCount,
			steeringMode: this.session.steeringMode,
			followUpMode: this.session.followUpMode,
			messageCount: this.projection.readMessageCount(),
		};
	}

	async getMessages(): Promise<readonly Message[]> {
		this.assertOpen();
		return this.projection.readMessages();
	}

	readState(): RuntimeSessionState {
		this.assertOpen();
		const dynamic = this.stateSource.read();
		const identity = this.eventSink.readIdentity();
		return {
			model: this.modelRuntime.readCurrentModel(),
			thinkingLevel: this.modelRuntime.readThinkingLevel(),
			...dynamic,
			activeToolNames: [...dynamic.activeToolNames],
			isStreaming: this.session.state === "running" || this.session.state === "cancelling",
			messageCount: this.projection.readMessageCount(),
			parentSessionPath: identity.parentSessionPath,
			parentEntryId: identity.parentEntryId,
		};
	}

	readMessages(): readonly Message[] {
		this.assertOpen();
		return this.projection.readMessages();
	}

	readHistory(): readonly HistoryEntry[] {
		this.assertOpen();
		return this.projection.readHistory();
	}

	async navigateForEdit(entryId: string): Promise<{ text: string; cancelled: boolean }> {
		return this.withHistoryMutation("Cannot edit message while the session is streaming", async () => {
			const entry = conversationDocumentEntry(this.projection.readDocument(), entryId);
			const text = extractConversationEntryText(entry);
			const editable =
				entry.type === "custom_message" ||
				(entry.type === "message" && isRecord(entry.message) && entry.message.role === "user");
			await this.executeDocumentCommand({
				type: "active_leaf.set",
				entryId: editable ? entry.parentId : entry.id,
			});
			return { text, cancelled: false };
		});
	}

	async switchBranch(entryId: string): Promise<{ leafId: string }> {
		return this.withHistoryMutation("Cannot switch branch while the session is streaming", async () => {
			const result = await this.executeDocumentCommand({ type: "branch.select", entryId });
			if (!result.leafId) throw new Error(`Entry ${entryId} has no branch leaf`);
			return { leafId: result.leafId };
		});
	}

	async appendBranchSummary(
		parentId: string | null,
		summary: string,
		details?: unknown,
		fromHook?: boolean,
	): Promise<{ entryId: string }> {
		return this.withHistoryMutation("Cannot summarize branch while the session is streaming", async () => {
			const entryId = `branch-summary-${randomUUID()}`;
			await this.executeDocumentCommand({
				type: "branch_summary.append",
				entryId,
				parentId,
				summary,
				details,
				fromHook,
				timestamp: new Date().toISOString(),
			});
			return { entryId };
		});
	}

	async deleteMessage(entryId: string): Promise<{ leafId: string | null }> {
		return this.withHistoryMutation("Cannot delete a message while the session is streaming", async () => {
			const result = await this.executeDocumentCommand({ type: "message.delete", entryId });
			return { leafId: result.leafId };
		});
	}

	async replaceLastUserMessage(entryId: string): Promise<{ leafId: string | null }> {
		return this.withHistoryMutation("Cannot replace a message while the session is streaming", async () => {
			const result = await this.executeDocumentCommand({ type: "user_turn.replace", entryId });
			return { leafId: result.leafId };
		});
	}

	async forkSession(entryId: string): Promise<{ path: string; text: string }> {
		return this.withHistoryMutation("Cannot fork while the session is streaming", async () => {
			const result = await this.conversationDocumentStore.fork(this.sessionId, entryId);
			return { path: result.path, text: result.text };
		});
	}

	async setName(name: string): Promise<void> {
		this.assertOpen();
		if (this.historyMutation || this.contextController?.readState().isCompacting) {
			throw new Error("Cannot rename while another session mutation is active");
		}
		this.historyMutation = true;
		try {
			await this.executeDocumentCommand({
				type: "session.name.set",
				name,
			});
		} finally {
			this.historyMutation = false;
		}
	}

	async appendEntry(customType: string, data?: unknown): Promise<void> {
		this.assertOpen();
		await this.executeDocumentCommand({
			type: "custom.append",
			entryId: `entry-${randomUUID()}`,
			customType,
			data,
			timestamp: new Date().toISOString(),
		});
	}

	async setLabel(entryId: string, label: string | undefined): Promise<void> {
		this.assertOpen();
		await this.executeDocumentCommand({
			type: "entry.label.set",
			entryId: `label-${randomUUID()}`,
			targetId: entryId,
			label,
			timestamp: new Date().toISOString(),
		});
	}

	createCoreAssembly(): GreenfieldRuntimeSessionCoreAssembly {
		this.assertOpen();
		const runtimeSession = this;
		const queueController: RuntimeSessionQueueController = {
			readPendingMessageCount: () => this.session.pendingMessageCount,
			readSteeringMode: () => this.session.steeringMode,
			readFollowUpMode: () => this.session.followUpMode,
			readSteeringMessages: () => this.session.getSteeringMessages().map(readQueuedMessageText),
			readFollowUpMessages: () => this.session.getFollowUpMessages().map(readQueuedMessageText),
			clear: () => {
				const cleared = this.session.clearQueue();
				return {
					steering: cleared.steering.flatMap((input) =>
						input.message === undefined ? [] : [readQueuedMessageText(input.message)],
					),
					followUp: cleared.followUps.flatMap((input) =>
						input.message === undefined ? [] : [readQueuedMessageText(input.message)],
					),
				};
			},
		};
		return {
			lifecycle: {
				get sessionId() {
					return runtimeSession.sessionId;
				},
				get sessionPath() {
					return runtimeSession.eventSink.readIdentity().sessionPath;
				},
				dispose: () => this.dispose(),
			},
			historyReader: {
				readHistory: () => this.readHistory(),
			},
			historyController: {
				navigateForEdit: (entryId) => this.navigateForEdit(entryId),
				switchBranch: (entryId) => this.switchBranch(entryId),
				appendBranchSummary: (parentId, summary, details, fromHook) =>
					this.appendBranchSummary(parentId, summary, details, fromHook),
				deleteMessage: (entryId) => this.deleteMessage(entryId),
				replaceLastUserMessage: (entryId) => this.replaceLastUserMessage(entryId),
				forkSession: (entryId) => this.forkSession(entryId),
				setName: (name) => this.setName(name),
			},
			modelController: this.modelRuntime,
			modelView: this.modelRuntime,
			workspaceView: {
				readWorkingDirectory: () => this.eventSink.readIdentity().cwd,
			},
			conversationView: {
				readDocument: () => this.projection.readDocument(),
			},
			queueView: queueController,
			queueController,
			contextUsageView: {
				readContextUsage: () => {
					const state = this.stateSource.read();
					return {
						tokens: state.contextTokens ?? null,
						contextWindow: state.contextWindow,
						percent: state.contextPercent,
					};
				},
			},
			executionObservationStream: {
				subscribe: (handler) => this.eventSink.subscribeExecutionObservation(handler),
			},
			todoController: this.todoController,
			contextController: this.contextController,
			contextDeliveryController: this.contextDeliveryController,
			metadataController: {
				appendEntry: (customType, data) => this.appendEntry(customType, data),
				readName: () => this.projection.readDocument().name,
				setName: (name) => this.setName(name),
				setLabel: (entryId, label) => this.setLabel(entryId, label),
			},
			toolController: this.toolController,
			corePorts: {
				turnControl: {
					prompt: async (request) => {
						await this.prompt(request);
					},
					continue: async () => {
						await this.continue();
					},
					abort: () => this.abort(),
				},
				eventStream: {
					subscribe: (handler) => this.subscribe(handler),
				},
				stateReader: {
					readState: () => this.readState(),
					readMessages: () => this.readMessages(),
				},
			},
		};
	}

	/**
	 * 暴露给宿主组合根的候选 Assembly。缺失能力保持缺失，由上层完整性门禁决定
	 * 是否允许接入 RuntimeHost；这里不使用 no-op 伪造功能。
	 */
	createRuntimeHostAssemblyCandidate(): RuntimeHostSessionAssemblyCandidate {
		const { contextController: _contextController, ...coreAssembly } = this.createCoreAssembly();
		return {
			...coreAssembly,
			hostInteraction: this.hostInteraction,
			executionController: this.executionController,
			backgroundWorkController: this.backgroundWorkController,
			configurationController: this.configurationController,
		};
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		await this.cleanup.run("Failed to dispose Greenfield runtime session");
	}

	async initializeDocumentParticipants(document: ConversationDocument): Promise<void> {
		const context: GreenfieldRuntimeDocumentParticipantContext = {
			appendCustomEntry: async (entry) => {
				await this.executeDocumentCommand({
					type: "custom.append",
					...entry,
				});
			},
		};
		for (const participant of this.documentParticipants) {
			await participant.initialize(document, context);
		}
	}

	private assertOpen(): void {
		if (this.disposed) throw sessionClosedError();
	}

	private normalizeImages(request: PromptRequest): PromptRequest {
		if (!request.images || request.images.length === 0) return request;
		const model = this.modelRuntime.readCurrentModel();
		if (model?.input?.includes("image")) return request;
		return {
			...request,
			images: undefined,
			text:
				request.text === "(see attached images)"
					? "(User attempted to send images, but the current model does not support image input. Please inform the user that this model cannot process images.)"
					: request.text,
		};
	}

	private async executeDocumentCommand(
		command: ConversationDocumentCommand,
	): Promise<ConversationDocumentCommandResult> {
		const result = await this.documentMutations.execute(command);
		for (const participant of this.documentParticipants) {
			await participant.onDocumentChanged(result.document);
		}
		return result;
	}

	private async withHistoryMutation<T>(message: string, operation: () => Promise<T>): Promise<T> {
		this.assertOpen();
		if (
			this.historyMutation ||
			this.contextController?.readState().isCompacting ||
			this.session.state === "running" ||
			this.session.state === "cancelling"
		) {
			throw new Error(message);
		}
		this.historyMutation = true;
		try {
			return await operation();
		} finally {
			this.historyMutation = false;
		}
	}
}

/**
 * Greenfield Kernel 的显式并行后端。
 *
 * 它实现通用 RuntimeSessionBackend 工厂合同，但返回独立 Greenfield 门面；当前
 * RuntimeHost 仍使用默认类型参数下的 Legacy Session，不能把本类直接注入生产入口。
 */
export class GreenfieldRuntimeSessionBackend<TCreateOptions>
	implements RuntimeSessionBackend<TCreateOptions, GreenfieldRuntimeSession>
{
	private readonly options: GreenfieldRuntimeSessionBackendOptions<TCreateOptions>;

	constructor(options: GreenfieldRuntimeSessionBackendOptions<TCreateOptions>) {
		this.options = options;
	}

	async create(options: TCreateOptions): Promise<GreenfieldRuntimeSession> {
		return this.assemble("create", options);
	}

	async resume(options: TCreateOptions): Promise<GreenfieldRuntimeSession> {
		return this.assemble("resume", options);
	}

	private async assemble(operation: "create" | "resume", options: TCreateOptions): Promise<GreenfieldRuntimeSession> {
		const eventSink = new GreenfieldSessionEventSink();
		const assembly = await this.options.runtimeFactory[operation](options, eventSink);
		try {
			const [conversation, document] = await Promise.all([
				assembly.repository.load(assembly.session.id),
				assembly.conversationDocumentStore.readDocument(assembly.session.id),
			]);
			const projection = new GreenfieldSessionProjection(conversation, document);
			eventSink.bindProjection(projection);
			eventSink.bindIdentity(assembly.identity);
			eventSink.bindStateSource(assembly.stateSource);
			eventSink.bindDocumentParticipants(assembly.documentParticipants ?? []);
			const runtimeSession = new GreenfieldRuntimeSession(assembly, eventSink, projection);
			await runtimeSession.initializeDocumentParticipants(document);
			eventSink.finishInitialization();
			return runtimeSession;
		} catch (error) {
			try {
				await assembly.session.close();
			} finally {
				await assembly.dispose?.();
			}
			throw error;
		}
	}
}

class GreenfieldSessionEventSink implements EventSink {
	private readonly listeners = new Set<(event: SessionEvent) => void>();
	private readonly executionObservationListeners = new Set<
		(observation: RuntimeSessionExecutionObservation) => Promise<void> | void
	>();
	private readonly initializationEvents: SessionEvent[] = [];
	private documentParticipants: readonly GreenfieldRuntimeDocumentParticipant[] = [];
	private documentMutationCoordinator: GreenfieldDocumentMutationCoordinator | undefined;
	private identity: GreenfieldRuntimeSessionIdentity = {};
	private projection: GreenfieldSessionProjection | undefined;
	private stateSource: GreenfieldRuntimeStateSource | undefined;
	private initializing = true;

	async publish(event: KernelEvent): Promise<void> {
		if (event.type === "execution.observation") {
			await this.notifyExecutionObservationListeners({
				turnId: event.turnId,
				event: event.observation,
				timestamp: event.timestamp,
			});
		}
		if (event.type === "conversation.continued") {
			await this.applyProjectionChange(() =>
				this.projection?.replaceConversation(event.conversation, event.document),
			);
			this.identity = {
				cwd: event.document.identity.cwd,
				sessionPath: event.sessionPath,
				parentSessionPath: event.document.identity.parentSessionPath,
				parentEntryId: event.document.identity.parentEntryId,
			};
			for (const participant of this.documentParticipants) {
				await participant.onDocumentChanged(event.document);
			}
		}
		if (isStoredSessionEvent(event)) {
			if (this.documentMutationCoordinator) {
				await this.documentMutationCoordinator.synchronizeProjection();
			} else {
				this.projection?.apply(event);
			}
			for (const participant of this.documentParticipants) {
				await participant.onSessionEvent?.(event);
			}
		}
		for (const mappedEvent of mapGreenfieldKernelEventToSessionEvents(event)) {
			const mapped = this.withDynamicState(mappedEvent);
			if (this.initializing) {
				this.initializationEvents.push(mapped);
				continue;
			}
			this.notifyListeners(mapped);
		}
	}

	subscribe(handler: (event: SessionEvent) => void): () => void {
		this.listeners.add(handler);
		for (const event of this.initializationEvents.splice(0)) {
			try {
				handler(event);
			} catch {
				// Session observers are isolated from initialization recovery events.
			}
		}
		return () => this.listeners.delete(handler);
	}

	subscribeExecutionObservation(
		handler: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void,
	): () => void {
		this.executionObservationListeners.add(handler);
		return () => this.executionObservationListeners.delete(handler);
	}

	finishInitialization(): void {
		this.initializing = false;
	}

	bindProjection(projection: GreenfieldSessionProjection): void {
		this.projection = projection;
	}

	bindIdentity(identity: GreenfieldRuntimeSessionIdentity): void {
		this.identity = { ...identity };
	}

	readIdentity(): GreenfieldRuntimeSessionIdentity {
		return this.identity;
	}

	bindStateSource(stateSource: GreenfieldRuntimeStateSource): void {
		this.stateSource = stateSource;
	}

	bindDocumentParticipants(participants: readonly GreenfieldRuntimeDocumentParticipant[]): void {
		this.documentParticipants = participants;
	}

	bindDocumentMutationCoordinator(coordinator: GreenfieldDocumentMutationCoordinator): void {
		this.documentMutationCoordinator = coordinator;
	}

	clear(): void {
		this.listeners.clear();
		this.executionObservationListeners.clear();
		this.initializationEvents.length = 0;
		this.stateSource = undefined;
		this.documentMutationCoordinator = undefined;
	}

	private async applyProjectionChange(change: () => void): Promise<void> {
		if (this.documentMutationCoordinator) {
			await this.documentMutationCoordinator.applyProjectionChange(change);
			return;
		}
		change();
	}

	private withDynamicState(event: SessionEvent): SessionEvent {
		if (event.type !== "usage.update" || !this.stateSource) return event;
		const state = this.stateSource.read();
		const contextTokens = event.input + event.output + event.cacheRead + event.cacheWrite;
		return {
			...event,
			contextPercent: state.contextWindow > 0 ? (contextTokens / state.contextWindow) * 100 : null,
			contextWindow: state.contextWindow,
		};
	}

	private notifyListeners(event: SessionEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// Session observers are isolated from turn execution and from each other.
			}
		}
	}

	private async notifyExecutionObservationListeners(observation: RuntimeSessionExecutionObservation): Promise<void> {
		for (const listener of this.executionObservationListeners) {
			try {
				await listener(observation);
			} catch {
				// Execution observers are ordered but cannot change Turn semantics.
			}
		}
	}
}

function isStoredSessionEvent(event: KernelEvent): event is StoredSessionEvent {
	return (
		event.type === "turn.started" ||
		event.type === "turn.continued" ||
		event.type === "message.appended" ||
		event.type === "context.appended" ||
		event.type === "context.recorded" ||
		event.type === "context.compacted" ||
		event.type === "turn.completed" ||
		event.type === "turn.cancelled" ||
		event.type === "turn.failed" ||
		event.type === "turn.transferred"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readQueuedMessageText(message: SessionInput["message"]): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter(
			(part): part is Extract<(typeof message.content)[number], { readonly type: "text" }> => part.type === "text",
		)
		.map((part) => part.text)
		.join("");
}

function createContextDeliveryController(session: AgentSession): RuntimeSessionContextDeliveryController {
	return {
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
	};
}
