import type { Api, AssistantMessage, Message, Model, UserMessage } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import type { ContextCompositionReport } from "../../src/context-composition/index.js";
import type { PromptRequest, SessionEvent } from "../../src/contracts.js";
import {
	applyConversationDocumentCommand,
	applyStoredEventToConversationDocument,
	type ConversationDocument,
	type ConversationDocumentCommand,
	type ConversationDocumentCommandResult,
	type ConversationDocumentForkResult,
	conversationDocumentEntry,
	createEmptyConversationDocument,
	extractConversationEntryText,
	selectConversationDocumentMessages,
	selectConversationDocumentModelMessages,
} from "../../src/conversation/index.js";
import type {
	ConversationMetadata,
	ConversationRepository,
	ConversationSnapshot,
	CreateConversationInput,
} from "../../src/kernel/contracts.js";
import {
	ContextCompactionCommitter,
	type ContextSummaryStrategy,
	createAgentSession,
	type EventSink,
	KERNEL_ERROR_CODES,
	type KernelEvent,
	type ManualContextCompactionRuntime,
	type ManualContextCompactionStrategy,
	RuntimeContextUsageTracker,
	type RuntimeInputRequestPreparationContext,
	type RuntimeSnapshot,
	type RuntimeSnapshotAcquireContext,
	resumeAgentSession,
	type SessionInputRequest,
	StaticRuntimeSnapshotProvider,
	type StoredConversation,
	type StoredSessionEvent,
	type TurnEngineEvent,
	type TurnEnginePort,
	TurnPipeline,
} from "../../src/kernel/index.js";
import {
	assessRuntimeHostSessionAssembly,
	type KernelRuntimeAssembly,
	KernelRuntimeSessionBackend,
	KernelRuntimeSessionContextController,
	RuntimeModel,
	type RuntimePromptAdapter,
} from "../../src/runtime-host/index.js";

interface TestCreateOptions {
	readonly id: string;
}

type CombinedContextRuntimeBinding = Omit<ManualContextCompactionStrategy, "bindForTurn" | "releaseTurnBinding"> &
	Omit<ContextSummaryStrategy, "bindForTurn" | "releaseTurnBinding"> & {
		releaseTurnBinding?(): Promise<void> | void;
	};

type CombinedContextRuntime = Omit<ManualContextCompactionRuntime, "bindForTurn" | "releaseTurnBinding"> &
	Omit<ContextSummaryStrategy, "bindForTurn" | "releaseTurnBinding"> & {
		bindForTurn?(
			context: RuntimeSnapshotAcquireContext,
		): Promise<CombinedContextRuntimeBinding> | CombinedContextRuntimeBinding;
		releaseTurnBinding?(): Promise<void> | void;
	};

function isCombinedContextRuntime(
	runtime: ManualContextCompactionRuntime | CombinedContextRuntime | undefined,
): runtime is CombinedContextRuntime {
	return runtime !== undefined && "summarizeContext" in runtime;
}

class InMemoryConversationRepository implements ConversationRepository {
	private readonly conversations = new Map<string, StoredConversation>();
	private readonly documents = new Map<string, ConversationDocument>();

	async create(input: CreateConversationInput): Promise<ConversationMetadata> {
		const conversation: StoredConversation = {
			sessionId: input.sessionId,
			createdAt: input.createdAt,
			version: 0,
			messages: [],
			events: [],
		};
		this.conversations.set(input.sessionId, conversation);
		this.documents.set(
			input.sessionId,
			createEmptyConversationDocument({ sessionId: input.sessionId, createdAt: input.createdAt }),
		);
		return conversation;
	}

	async load(sessionId: string): Promise<StoredConversation> {
		const conversation = this.conversations.get(sessionId);
		if (!conversation) throw new Error(`Conversation not found: ${sessionId}`);
		return conversation;
	}

	async readDocument(sessionId: string): Promise<ConversationDocument> {
		const document = this.documents.get(sessionId);
		if (!document) throw new Error(`Conversation document not found: ${sessionId}`);
		return document;
	}

	async execute(
		sessionId: string,
		expectedRevision: number | null,
		command: ConversationDocumentCommand,
	): Promise<ConversationDocumentCommandResult> {
		const document = await this.readDocument(sessionId);
		if (expectedRevision !== null && document.revision !== expectedRevision) {
			throw new Error("Document version mismatch");
		}
		const result = applyConversationDocumentCommand(document, command);
		this.documents.set(sessionId, result.document);
		const conversation = await this.load(sessionId);
		this.conversations.set(sessionId, {
			...conversation,
			messages: selectConversationDocumentMessages(result.document),
		});
		return result;
	}

	async fork(sessionId: string, entryId: string): Promise<ConversationDocumentForkResult> {
		const entry = conversationDocumentEntry(await this.readDocument(sessionId), entryId);
		return {
			sessionId: "forked-session",
			path: "sessions/forked-session.jsonl",
			text: extractConversationEntryText(entry),
		};
	}

	async append(
		sessionId: string,
		expectedVersion: number,
		events: readonly StoredSessionEvent[],
	): Promise<{ readonly version: number }> {
		const conversation = await this.load(sessionId);
		if (conversation.version !== expectedVersion) throw new Error("Version mismatch");
		const version = expectedVersion + events.length;
		let document = await this.readDocument(sessionId);
		for (let index = 0; index < events.length; index += 1) {
			const event = events[index];
			if (event) document = applyStoredEventToConversationDocument(document, event, expectedVersion + index + 1);
		}
		this.documents.set(sessionId, document);
		this.conversations.set(sessionId, {
			...conversation,
			version,
			messages: selectConversationDocumentMessages(document),
			events: [...conversation.events, ...events],
		});
		return { version };
	}

	async saveSnapshot(_sessionId: string, _snapshot: ConversationSnapshot): Promise<void> {}

	async close(): Promise<void> {}
}

class CompletingTurnEngine implements TurnEnginePort {
	private responseIndex = 0;

	async *execute(): AsyncIterable<TurnEngineEvent> {
		this.responseIndex += 1;
		yield {
			type: "observation",
			observation: { type: "lifecycle", phase: "agent_start", source: "runtime-core" },
		};
		yield {
			type: "message",
			message: assistantMessage(`response-${this.responseIndex}`),
		};
		yield {
			type: "observation",
			observation: { type: "lifecycle", phase: "agent_end", source: "runtime-core" },
		};
		yield { type: "completed", stopReason: "stop" };
	}
}

class RecordingMessagesTurnEngine implements TurnEnginePort {
	readonly requests: Message[][] = [];
	private responseIndex = 0;

	async *execute(request: Parameters<TurnEnginePort["execute"]>[0]): AsyncIterable<TurnEngineEvent> {
		this.requests.push([...request.messages]);
		this.responseIndex += 1;
		yield { type: "message", message: assistantMessage(`response-${this.responseIndex}`) };
		yield { type: "completed", stopReason: "stop" };
	}
}

class CheckpointingTurnEngine implements TurnEnginePort {
	readonly requests: Message[][] = [];
	readonly checkpoints: Message[][] = [];
	private executeCount = 0;

	async *execute(request: Parameters<TurnEnginePort["execute"]>[0]): AsyncIterable<TurnEngineEvent> {
		this.executeCount += 1;
		this.requests.push([...request.messages]);
		if (this.executeCount === 4) {
			const result = await request.checkpoint?.(
				{
					reason: "model_call",
					messages: request.messages,
					modelCallIndex: 0,
					recoveryAttempt: 0,
				},
				request.signal,
			);
			if (result) this.checkpoints.push([...result.messages]);
		}
		yield { type: "message", message: assistantMessage(`response-${this.executeCount}`) };
		yield { type: "completed", stopReason: "stop" };
	}
}

class ErrorThenSuccessTurnEngine implements TurnEnginePort {
	readonly requests: Message[][] = [];

	async *execute(request: Parameters<TurnEnginePort["execute"]>[0]): AsyncIterable<TurnEngineEvent> {
		this.requests.push([...request.messages]);
		if (this.requests.length === 1) {
			yield {
				type: "message",
				message: {
					...assistantMessage("request failed"),
					stopReason: "error",
					errorMessage: "503 service unavailable",
				},
			};
			yield { type: "completed", stopReason: "error" };
			return;
		}
		yield { type: "message", message: assistantMessage("recovered") };
		yield { type: "completed", stopReason: "stop" };
	}
}

class ObservingTurnEngine implements TurnEnginePort {
	async *execute(): AsyncIterable<TurnEngineEvent> {
		const message = assistantMessage("observed");
		yield { type: "execution_observation", observation: { type: "agent.start" } };
		yield { type: "execution_observation", observation: { type: "turn.start" } };
		yield { type: "message", message };
		yield {
			type: "execution_observation",
			observation: { type: "turn.end", message, toolResults: [] },
		};
		yield { type: "completed", stopReason: "stop" };
	}
}

class BlockingTurnEngine implements TurnEnginePort {
	readonly started: Promise<void>;
	private markStarted: (() => void) | undefined;

	constructor() {
		this.started = new Promise((resolve) => {
			this.markStarted = resolve;
		});
	}

	async *execute(request: Parameters<TurnEnginePort["execute"]>[0]): AsyncIterable<TurnEngineEvent> {
		this.markStarted?.();
		await waitForAbort(request.signal);
		yield { type: "completed", stopReason: "stop" };
	}
}

class RecordingPromptAdapter implements RuntimePromptAdapter {
	readonly requests: Array<{
		readonly request: PromptRequest;
		readonly sessionId: string;
		readonly queueing: boolean;
	}> = [];

	createRequest(request: PromptRequest): SessionInputRequest {
		return {
			payload: request,
			displayText: request.text,
			...(request.modelKey || request.reasoning
				? { model: { key: request.modelKey, reasoning: request.reasoning } }
				: {}),
		};
	}

	async prepare(request: SessionInputRequest, context: RuntimeInputRequestPreparationContext) {
		const original = request.payload as PromptRequest;
		const prompt =
			original.images?.length && !context.modelBinding?.model.input.includes("image")
				? {
						...original,
						images: undefined,
						text:
							original.text === "(see attached images)"
								? "(User attempted to send images, but the current model does not support image input. Please inform the user that this model cannot process images.)"
								: original.text,
					}
				: original;
		this.requests.push({ request: prompt, sessionId: context.sessionId, queueing: context.queueing });
		return {
			action: "continue" as const,
			input: { message: userMessage(prompt.text) },
		};
	}
}

function createBackend(
	turnEngine: TurnEnginePort,
	promptAdapter: RuntimePromptAdapter = new RecordingPromptAdapter(),
	dispose = vi.fn(async () => {}),
	contextRuntime?: ManualContextCompactionRuntime | CombinedContextRuntime,
	assemblyOverrides: Partial<KernelRuntimeAssembly> = {},
	registerManualCompactionStrategy = true,
	registerContextSummaryStrategy = true,
	projectConversationDocument = false,
	contextStrategy: RuntimeSnapshot["contextStrategy"] | undefined = undefined,
) {
	let runtimeEventSink: EventSink | undefined;
	return {
		backend: new KernelRuntimeSessionBackend<TestCreateOptions>({
			runtimeFactory: {
				async create(options: TestCreateOptions, eventSink: EventSink) {
					runtimeEventSink = eventSink;
					let turnIndex = 0;
					const repository = new InMemoryConversationRepository();
					const details = runtimeAssemblyDetails(options.id);
					const snapshotProvider = new StaticRuntimeSnapshotProvider(
						{
							...snapshot(projectConversationDocument, contextStrategy),
							...(registerManualCompactionStrategy ? { manualCompactionStrategy: contextRuntime } : {}),
							...(registerContextSummaryStrategy && isCombinedContextRuntime(contextRuntime)
								? { contextSummaryStrategy: contextRuntime }
								: {}),
						},
						details.modelRuntime,
					);
					const clock = { now: () => Date.now() };
					const contextCompactionCommitter = new ContextCompactionCommitter({
						repository,
						eventSink,
						clock,
						conversationDocumentReader: repository,
					});
					const pipeline = new TurnPipeline({
						repository,
						snapshotProvider,
						turnEngine,
						eventSink,
						clock,
						conversationDocumentReader: repository,
						idGenerator: {
							next: () => {
								turnIndex += 1;
								return `turn-${turnIndex}`;
							},
						},
						contextCompactionCommitter,
					});
					const session = await createAgentSession({ id: options.id, pipeline });
					const contextController = contextRuntime
						? new KernelRuntimeSessionContextController({
								session,
								repository,
								conversationDocumentReader: repository,
								snapshotProvider,
								contextRuntime,
								committer: contextCompactionCommitter,
							})
						: undefined;
					return {
						session,
						repository,
						conversationDocumentStore: repository,
						promptAdapter,
						contextController,
						dispose,
						...details,
						...assemblyOverrides,
					};
				},
				async resume() {
					throw new Error("Resume is not configured for this test harness");
				},
			},
		}),
		publish: async (event: KernelEvent) => {
			if (!runtimeEventSink) throw new Error("Runtime event sink is not initialized");
			await runtimeEventSink.publish(event);
		},
		dispose,
		promptAdapter,
	};
}

describe("KernelRuntimeSessionBackend", () => {
	it("exposes context composition through state and usage events", async () => {
		const composition: ContextCompositionReport = {
			version: 1,
			callId: "call-1",
			snapshotId: "snapshot-1",
			phase: "completed",
			createdAt: 1,
			model: { provider: "test", modelId: "test-model", contextWindow: 8_000 },
			estimate: { tokens: 100, knownTokens: 100, coverage: "complete" },
			providerReportedInputTokens: 120,
			sections: [],
		};
		const { backend } = createBackend(
			new CompletingTurnEngine(),
			new RecordingPromptAdapter(),
			undefined,
			undefined,
			{
				stateSource: {
					read: () => ({
						contextTokens: 120,
						contextPercent: 1.5,
						contextWindow: 8_000,
						contextComposition: composition,
						activeToolNames: ["read"],
					}),
				},
			},
		);
		const session = await backend.create({ id: "session-1" });
		const assembly = session.createCoreAssembly();
		const events: SessionEvent[] = [];
		assembly.corePorts.eventStream.subscribe((event) => events.push(event));

		expect(assembly.corePorts.stateReader.readState()).toMatchObject({ contextComposition: composition });
		expect(assembly.contextUsageView.readContextUsage()).toEqual({
			tokens: 120,
			contextWindow: 8_000,
			percent: 1.5,
			composition,
		});

		await assembly.corePorts.turnControl.prompt({ text: "hello" });
		expect(events.find((event) => event.type === "usage.update")).toMatchObject({
			type: "usage.update",
			contextComposition: composition,
		});
	});

	it("attaches the post-compaction context usage to a successful compaction event", async () => {
		const { backend, publish } = createBackend(
			new CompletingTurnEngine(),
			new RecordingPromptAdapter(),
			undefined,
			undefined,
			{
				stateSource: {
					read: () => ({
						contextTokens: 24_000,
						contextPercent: 24,
						contextWindow: 100_000,
						activeToolNames: [],
					}),
				},
			},
		);
		const session = await backend.create({ id: "session-1" });
		const events: SessionEvent[] = [];
		session.subscribe((event) => events.push(event));

		await publish({
			type: "context.compacted",
			sessionId: "session-1",
			turnId: "turn-1",
			record: {
				summary: "summary",
				summaryMessage: userMessage("summary"),
				firstKeptEntryId: "event-1",
				tokensBefore: 91_000,
				reason: "threshold",
			},
			timestamp: 10,
		});

		expect(events.at(-1)).toMatchObject({
			type: "compaction.end",
			success: true,
			tokensBefore: 91_000,
			contextTokens: 24_000,
			contextPercent: 24,
			contextWindow: 100_000,
		});
	});

	it("adapts prompts, publishes mapped events and reports repository-backed state", async () => {
		const promptAdapter = new RecordingPromptAdapter();
		const { backend } = createBackend(new CompletingTurnEngine(), promptAdapter);
		const session = await backend.create({ id: "session-1" });
		const events: SessionEvent[] = [];
		session.subscribe(() => {
			throw new Error("listener failure");
		});
		session.subscribe((event) => events.push(event));

		const result = await session.prompt({ text: "hello", metadata: { source: "test" } });

		expect(result.status).toBe("completed");
		expect(promptAdapter.requests).toEqual([
			{
				request: { text: "hello", metadata: { source: "test" } },
				sessionId: "session-1",
				queueing: false,
			},
		]);
		expect(events.map((event) => event.type)).toEqual(["session.lifecycle", "usage.update", "session.lifecycle"]);
		expect(await session.getState()).toMatchObject({
			sessionId: "session-1",
			state: "idle",
			pendingMessageCount: 0,
			messageCount: 2,
		});
		expect((await session.getMessages()).map((message) => message.role)).toEqual(["user", "assistant"]);
	});

	it("applies requested model and reasoning before adapting the prompt and strips unsupported images", async () => {
		const promptAdapter = new RecordingPromptAdapter();
		const { backend } = createBackend(new CompletingTurnEngine(), promptAdapter);
		const session = await backend.create({ id: "session-1" });

		await session.prompt({
			text: "(see attached images)",
			images: [{ type: "image", data: "base64", mimeType: "image/png" }],
			modelKey: "test/alternate-model",
			reasoning: "medium",
		});

		expect(session.readState()).toMatchObject({
			model: ALTERNATE_MODEL,
			thinkingLevel: "medium",
		});
		expect(promptAdapter.requests[0]?.request).toMatchObject({
			text: "(User attempted to send images, but the current model does not support image input. Please inform the user that this model cannot process images.)",
			images: undefined,
			modelKey: "test/alternate-model",
			reasoning: "medium",
		});
	});

	it("continues from persisted context without adding a user message", async () => {
		const { backend } = createBackend(new CompletingTurnEngine());
		const session = await backend.create({ id: "session-1" });

		await session.prompt({ text: "hello" });
		const result = await session.continue();

		expect(result.status).toBe("completed");
		expect((await session.getMessages()).map((message) => message.role)).toEqual(["user", "assistant", "assistant"]);
	});

	it("retries without replaying the terminal error assistant while retaining it in history", async () => {
		const engine = new ErrorThenSuccessTurnEngine();
		const { backend } = createBackend(engine);
		const session = await backend.create({ id: "session-1" });

		await expect(session.prompt({ text: "hello" })).resolves.toMatchObject({
			status: "failed",
			turnId: expect.any(String),
			error: { code: "PROVIDER_ERROR", message: "503 service unavailable", origin: "provider" },
		});
		await expect(session.retry()).resolves.toMatchObject({ status: "completed", stopReason: "stop" });

		expect(engine.requests.map((messages) => messages.map((message) => message.role))).toEqual([["user"], ["user"]]);
		expect((await session.getMessages()).map((message) => message.role)).toEqual(["user", "assistant", "assistant"]);
	});

	it("exposes synchronous lifecycle, workspace, turn, event and state core ports", async () => {
		const { backend, publish } = createBackend(new CompletingTurnEngine());
		const session = await backend.create({ id: "session-1" });
		const assembly = session.createCoreAssembly();
		const events: SessionEvent[] = [];
		assembly.corePorts.eventStream.subscribe((event) => events.push(event));

		expect(assembly.lifecycle).toMatchObject({
			sessionId: "session-1",
			sessionDirectory: "sessions",
			sessionPath: "sessions/session-1.conversation.jsonl",
		});
		expect(assembly.workspaceView.readWorkingDirectory()).toBe("workspace/session-1");
		expect(assembly.modelView.readCurrentModel()).toBe(TEST_MODEL);
		expect(assembly.corePorts.stateReader.readState()).toMatchObject({
			model: TEST_MODEL,
			thinkingLevel: "off",
			isStreaming: false,
			messageCount: 0,
			contextPercent: null,
			contextWindow: 8_000,
			activeToolNames: ["read"],
		});

		await assembly.modelController.selectModel("test/alternate-model", "always");
		assembly.modelController.setThinkingLevel("high");
		expect(assembly.modelView.readCurrentModel()).toBe(ALTERNATE_MODEL);
		expect(assembly.corePorts.stateReader.readState()).toMatchObject({
			model: ALTERNATE_MODEL,
			thinkingLevel: "high",
		});

		await assembly.corePorts.turnControl.prompt({ text: "hello" });

		expect(assembly.corePorts.stateReader.readMessages().map((message) => message.role)).toEqual([
			"user",
			"assistant",
		]);
		expect(assembly.corePorts.stateReader.readState()).toMatchObject({
			isStreaming: false,
			messageCount: 2,
		});
		expect(events.map((event) => event.type)).toEqual(["session.lifecycle", "usage.update", "session.lifecycle"]);
		expect(assembly.historyReader.readHistory()).toMatchObject([
			{ type: "message", entryId: "event-2", parentId: null, message: { role: "user" } },
			{ type: "message", entryId: "event-3", parentId: "event-2", message: { role: "assistant" } },
		]);

		const continuedDocument = createEmptyConversationDocument({
			sessionId: "session-2",
			createdAt: 2,
			cwd: "workspace/session-2",
		});
		await publish({
			type: "conversation.continued",
			sourceSessionId: "session-1",
			sourceSessionPath: "sessions/session-1.conversation.jsonl",
			sessionId: "session-2",
			sessionDirectory: "sessions/continued",
			sessionPath: "sessions/session-2.conversation.jsonl",
			turnId: "turn-1",
			reason: "memory-rollover",
			conversation: {
				sessionId: "session-2",
				createdAt: 2,
				version: 0,
				messages: [],
				events: [],
			},
			document: continuedDocument,
			timestamp: 2,
		});
		expect(assembly.lifecycle).toMatchObject({
			sessionId: "session-1",
			sessionDirectory: "sessions/continued",
			sessionPath: "sessions/session-2.conversation.jsonl",
		});

		await assembly.lifecycle.dispose();
		await expect(session.getMessages()).rejects.toMatchObject({ code: "session_closed" });
	});

	it("awaits ordered execution observers and isolates their failures from the turn", async () => {
		const { backend } = createBackend(new ObservingTurnEngine());
		const session = await backend.create({ id: "session-1" });
		const observations: string[] = [];
		const stream = session.createCoreAssembly().executionObservationStream;
		stream.subscribe(async ({ event }) => {
			observations.push(`first:${event.type}:start`);
			await Promise.resolve();
			observations.push(`first:${event.type}:end`);
			throw new Error("observer failure");
		});
		stream.subscribe(({ event }) => {
			observations.push(`second:${event.type}`);
		});

		await expect(session.prompt({ text: "hello" })).resolves.toMatchObject({ status: "completed" });

		expect(observations).toEqual([
			"first:agent.start:start",
			"first:agent.start:end",
			"second:agent.start",
			"first:turn.start:start",
			"first:turn.start:end",
			"second:turn.start",
			"first:turn.end:start",
			"first:turn.end:end",
			"second:turn.end",
		]);
	});

	it("reports missing RuntimeHost ports instead of installing no-op fallbacks", async () => {
		const { backend } = createBackend(new CompletingTurnEngine());
		const session = await backend.create({ id: "session-1" });

		const assessment = assessRuntimeHostSessionAssembly(session.createRuntimeHostAssemblyCandidate());

		expect(assessment).toEqual({
			ready: false,
			missingPorts: ["executionController", "configurationController"],
		});
	});

	it("passes the complete RuntimeHost assembly contract when composition supplies every peripheral port", async () => {
		const setSteeringMode = vi.fn();
		const peripherals = {
			executionController: {
				isBusy: () => false,
				reconfigure: vi.fn(),
			},
			configurationController: {
				setSteeringMode,
				setFollowUpMode: vi.fn(),
			},
		} satisfies Partial<KernelRuntimeAssembly>;
		const { backend } = createBackend(
			new CompletingTurnEngine(),
			new RecordingPromptAdapter(),
			vi.fn(async () => {}),
			undefined,
			peripherals,
		);
		const session = await backend.create({ id: "session-1" });

		const assessment = assessRuntimeHostSessionAssembly(session.createRuntimeHostAssemblyCandidate());

		expect(assessment.ready).toBe(true);
		if (!assessment.ready) throw new Error("Expected a complete RuntimeHost session assembly");
		assessment.assembly.configurationController.setSteeringMode("all");
		await assessment.assembly.corePorts.turnControl.prompt({ text: "hello" });
		expect(setSteeringMode).toHaveBeenCalledWith("all");
		expect(assessment.assembly.historyReader.readHistory()).toHaveLength(2);
		expect(assessment.assembly.workspaceView.readWorkingDirectory()).toBe("workspace/session-1");
	});

	it("uses the explicit resume factory path and publishes interrupted recovery", async () => {
		const repository = new InMemoryConversationRepository();
		await repository.create({ sessionId: "session-1", createdAt: 1 });
		await repository.append("session-1", 0, [
			{
				type: "turn.started",
				sessionId: "session-1",
				turnId: "turn-interrupted",
				snapshotId: "snapshot-1",
				timestamp: 2,
			},
		]);
		const create = vi.fn(async () => {
			throw new Error("Create must not be used while resuming");
		});
		const resume = vi.fn(async (options: TestCreateOptions, eventSink: EventSink) => {
			const details = runtimeAssemblyDetails(options.id);
			const pipeline = new TurnPipeline({
				repository,
				snapshotProvider: new StaticRuntimeSnapshotProvider(snapshot(), details.modelRuntime),
				turnEngine: new CompletingTurnEngine(),
				eventSink,
				clock: { now: () => 3 },
				idGenerator: { next: () => "unused-turn-id" },
			});
			const session = await resumeAgentSession({ id: options.id, pipeline });
			return {
				session,
				repository,
				conversationDocumentStore: repository,
				promptAdapter: new RecordingPromptAdapter(),
				...details,
			};
		});
		const backend = new KernelRuntimeSessionBackend<TestCreateOptions>({
			runtimeFactory: { create, resume },
		});

		const session = await backend.resume({ id: "session-1" });
		const events: SessionEvent[] = [];
		session.subscribe((event) => events.push(event));
		const conversation = await repository.load("session-1");

		expect(create).not.toHaveBeenCalled();
		expect(resume).toHaveBeenCalledOnce();
		expect(conversation.events.at(-1)).toMatchObject({
			type: "turn.failed",
			error: { code: KERNEL_ERROR_CODES.TURN_INTERRUPTED },
		});
		expect(events.map((event) => event.type)).toEqual(["error", "session.lifecycle"]);
		expect(events[0]).toMatchObject({
			type: "error",
			error: { code: KERNEL_ERROR_CODES.TURN_INTERRUPTED },
		});
		expect(events[1]).toMatchObject({ type: "session.lifecycle", phase: "agent_end" });
	});

	it("commits manual compaction outside a turn and publishes its refreshed usage", async () => {
		let autoCompactionEnabled = true;
		const onManualCompactionCommitted =
			vi.fn<NonNullable<ManualContextCompactionRuntime["onManualCompactionCommitted"]>>();
		const contextRuntime: ManualContextCompactionRuntime = {
			async compactManual(input) {
				expect(input.customInstructions).toBe("preserve decisions");
				expect(input.document.activeLeafId).toBe("event-3");
				return {
					summary: "manual summary",
					summaryMessage: userMessage("manual summary"),
					firstKeptEntryId: "event-2",
					tokensBefore: 120,
					details: { source: "test" },
					reason: "manual",
				};
			},
			onManualCompactionCommitted,
			readAutoCompactionEnabled: () => autoCompactionEnabled,
			setAutoCompactionEnabled(enabled) {
				autoCompactionEnabled = enabled;
			},
		};
		const { backend } = createBackend(
			new CompletingTurnEngine(),
			new RecordingPromptAdapter(),
			vi.fn(async () => {}),
			contextRuntime,
		);
		const session = await backend.create({ id: "session-1" });
		const events: SessionEvent[] = [];
		session.subscribe((event) => events.push(event));
		await session.prompt({ text: "hello" });
		const contextController = session.createCoreAssembly().contextController;
		if (!contextController) throw new Error("Context controller was not assembled");
		const eventCountBeforeCompaction = events.length;

		const result = await contextController.compact({ customInstructions: "preserve decisions" });

		expect(result).toEqual({
			summary: "manual summary",
			firstKeptEntryId: "event-2",
			tokensBefore: 120,
			details: { source: "test" },
		});
		expect(events).toHaveLength(eventCountBeforeCompaction + 1);
		expect(events.at(-1)).toMatchObject({ type: "compaction.end", success: true, reason: "manual" });
		expect(session.readHistory().at(-1)).toMatchObject({
			type: "compaction",
			summary: "manual summary",
			tokensBefore: 120,
		});
		expect(onManualCompactionCommitted).toHaveBeenCalledOnce();
		expect(onManualCompactionCommitted.mock.calls[0]?.[3]?.activeLeafId).toBe("event-5");
		expect(contextController.readState()).toEqual({ isCompacting: false, autoCompactionEnabled: true });
		contextController.setAutoCompactionEnabled(false);
		expect(contextController.readState().autoCompactionEnabled).toBe(false);
	});

	it("refreshes context usage after manual compaction and uses the compacted projection on the next turn", async () => {
		const usage = new RuntimeContextUsageTracker({
			estimateDocumentTokens: (document) => selectConversationDocumentModelMessages(document).length * 100,
		});
		const contextRuntime: ManualContextCompactionRuntime = {
			async compactManual(input) {
				const messageEntries = input.document.entries.filter((entry) => entry.type === "message");
				const firstKeptEntry = messageEntries.at(-2);
				if (!firstKeptEntry) throw new Error("Expected a recent user message to keep");
				return {
					summary: "manual summary",
					summaryMessage: userMessage("manual summary"),
					firstKeptEntryId: firstKeptEntry.id,
					tokensBefore: 600,
					reason: "manual",
				};
			},
			readAutoCompactionEnabled: () => true,
			setAutoCompactionEnabled() {},
		};
		const engine = new RecordingMessagesTurnEngine();
		const { backend } = createBackend(
			engine,
			new RecordingPromptAdapter(),
			undefined,
			contextRuntime,
			{
				documentParticipants: [usage],
				stateSource: {
					read: () => {
						const current = usage.readUsage(1_000);
						return {
							contextTokens: current.tokens,
							contextPercent: current.percent,
							contextWindow: current.contextWindow,
							activeToolNames: [],
						};
					},
				},
			},
			true,
			true,
			true,
		);
		const session = await backend.create({ id: "session-1" });

		await session.prompt({ text: "old request 1" });
		await session.prompt({ text: "old request 2" });
		await session.prompt({ text: "kept request" });
		usage.recordEstimatedTokens(600);
		const before = session.createCoreAssembly().contextUsageView.readContextUsage();
		expect(before).toMatchObject({ tokens: 600, percent: 60 });

		const controller = session.createCoreAssembly().contextController;
		if (!controller) throw new Error("Context controller was not assembled");
		await controller.compact();

		const after = session.createCoreAssembly().contextUsageView.readContextUsage();
		expect(after).toMatchObject({ tokens: 300, percent: 30 });

		await session.prompt({ text: "after compaction" });
		expect(engine.requests.at(-1)?.map(readMessageText)).toEqual([
			"manual summary",
			"kept request",
			"response-3",
			"after compaction",
		]);
		expect(engine.requests.at(-1)?.map(readMessageText)).not.toContain("old request 1");
	});

	it("refreshes context usage after automatic checkpoint compaction and reuses it on the next turn", async () => {
		const usage = new RuntimeContextUsageTracker({
			estimateDocumentTokens: (document) => selectConversationDocumentModelMessages(document).length * 100,
		});
		const compactedDocuments: ConversationDocument[] = [];
		const compactedUsageTokens: number[] = [];
		const usageParticipant = {
			initialize: usage.initialize.bind(usage),
			onDocumentChanged(document: ConversationDocument) {
				usage.onDocumentChanged(document);
				if (document.entries.some((entry) => entry.type === "compaction")) {
					compactedDocuments.push(document);
					compactedUsageTokens.push(usage.readUsage(1_000).tokens);
				}
			},
			onSessionEvent: (event: StoredSessionEvent) => usage.observe(event),
		};
		const contextStrategy: RuntimeSnapshot["contextStrategy"] = {
			async prepare(input) {
				if (input.reason !== "model_call")
					return { messages: input.messages, estimatedTokens: input.messages.length };
				const keptEntry = input.document?.entries.find(
					(entry) => entry.type === "message" && readMessageText(entry.message) === "kept request",
				);
				if (!keptEntry) throw new Error("Expected the kept request in the active document");
				const summaryMessage = userMessage("automatic summary");
				return {
					messages: [summaryMessage, ...input.messages.slice(-2)],
					estimatedTokens: 300,
					compaction: {
						summary: "automatic summary",
						summaryMessage,
						firstKeptEntryId: keptEntry.id,
						tokensBefore: 600,
						reason: "threshold",
					},
				};
			},
		};
		const contextRuntime: ManualContextCompactionRuntime = {
			async compactManual() {
				throw new Error("manual compaction is not used");
			},
			readAutoCompactionEnabled: () => true,
			setAutoCompactionEnabled() {},
		};
		const engine = new CheckpointingTurnEngine();
		const { backend } = createBackend(
			engine,
			new RecordingPromptAdapter(),
			undefined,
			contextRuntime,
			{
				documentParticipants: [usageParticipant],
				stateSource: {
					read: () => {
						const current = usage.readUsage(1_000);
						return {
							contextTokens: current.tokens,
							contextPercent: current.percent,
							contextWindow: current.contextWindow,
							activeToolNames: [],
						};
					},
				},
			},
			true,
			true,
			true,
			contextStrategy,
		);
		const session = await backend.create({ id: "session-1" });

		await session.prompt({ text: "old request 1" });
		await session.prompt({ text: "old request 2" });
		await session.prompt({ text: "kept request" });
		await session.prompt({ text: "trigger automatic compaction" });

		expect(compactedDocuments.length).toBeGreaterThanOrEqual(1);
		expect(compactedUsageTokens[0]).toBe(400);
		expect(engine.checkpoints.at(0)?.map(readMessageText)).toEqual([
			"automatic summary",
			"response-3",
			"trigger automatic compaction",
		]);

		await session.prompt({ text: "after automatic compaction" });
		expect(engine.requests.at(-1)?.map(readMessageText)).toEqual([
			"automatic summary",
			"kept request",
			"response-3",
			"trigger automatic compaction",
			"response-4",
			"after automatic compaction",
		]);
		expect(engine.requests.at(-1)?.map(readMessageText)).not.toContain("old request 1");
	});

	it("summarizes caller-projected records through the admitted snapshot without mutating conversation history", async () => {
		const release = vi.fn();
		const summarizeContext = vi.fn<ContextSummaryStrategy["summarizeContext"]>(async (input) => {
			expect(input.records).toEqual([
				{ type: "team.public", content: "approved public context", modelVisible: true, timestamp: 5 },
			]);
			expect(input.previousSummary).toBe("previous public summary");
			expect(input.customInstructions).toBe("preserve owners");
			expect(input.modelBinding?.model).toBe(TEST_MODEL);
			return { summary: "projected summary", tokensBefore: 42, details: { source: "test" } };
		});
		const contextRuntime = {
			compactManual: async () => {
				throw new Error("not used");
			},
			summarizeContext,
			readAutoCompactionEnabled: () => true,
			setAutoCompactionEnabled() {},
			bindForTurn: vi.fn((_context: RuntimeSnapshotAcquireContext) => ({
				compactManual: contextRuntime.compactManual,
				summarizeContext,
				releaseTurnBinding: release,
			})),
		};
		const { backend } = createBackend(new CompletingTurnEngine(), undefined, undefined, contextRuntime);
		const session = await backend.create({ id: "session-1" });
		await session.prompt({ text: "existing conversation" });
		contextRuntime.bindForTurn.mockClear();
		release.mockClear();
		const controller = session.createCoreAssembly().contextController!;
		const historyBefore = session.readHistory();

		await expect(
			controller.summarize({
				records: [{ type: "team.public", content: "approved public context", modelVisible: true, timestamp: 5 }],
				previousSummary: "previous public summary",
				customInstructions: "preserve owners",
			}),
		).resolves.toEqual({ summary: "projected summary", tokensBefore: 42, details: { source: "test" } });

		expect(contextRuntime.bindForTurn).toHaveBeenLastCalledWith(
			expect.objectContaining({ reason: "context_summary", operationId: "session-1:context-summary" }),
		);
		expect(summarizeContext).toHaveBeenCalledOnce();
		expect(release).toHaveBeenCalledOnce();
		expect(session.readHistory()).toEqual(historyBefore);
		expect(controller.readState().isCompacting).toBe(false);
	});

	it("rejects an unregistered dynamic summary owner instead of executing it outside the snapshot", async () => {
		const summarizeContext = vi.fn(async () => ({ summary: "unbound", tokensBefore: 1 }));
		const contextRuntime = {
			compactManual: async () => {
				throw new Error("not used");
			},
			summarizeContext,
			readAutoCompactionEnabled: () => true,
			setAutoCompactionEnabled() {},
			bindForTurn: () => ({ compactManual: contextRuntime.compactManual, summarizeContext }),
		};
		const { backend } = createBackend(
			new CompletingTurnEngine(),
			undefined,
			undefined,
			contextRuntime,
			{},
			true,
			false,
		);
		const session = await backend.create({ id: "session-1" });
		const controller = session.createCoreAssembly().contextController!;

		await expect(
			controller.summarize({ records: [{ type: "public", content: "safe", modelVisible: true }] }),
		).rejects.toThrow("not registered");
		expect(summarizeContext).not.toHaveBeenCalled();
		expect(controller.readState().isCompacting).toBe(false);
	});

	it("propagates caller cancellation to context summary and releases the admitted binding", async () => {
		let markStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const release = vi.fn();
		const contextRuntime = {
			compactManual: async () => {
				throw new Error("not used");
			},
			summarizeContext: async (_input: unknown, signal: AbortSignal) => {
				markStarted?.();
				await waitForAbort(signal);
				return { summary: "unreachable", tokensBefore: 0 };
			},
			readAutoCompactionEnabled: () => true,
			setAutoCompactionEnabled() {},
			bindForTurn: () => ({
				compactManual: contextRuntime.compactManual,
				summarizeContext: contextRuntime.summarizeContext,
				releaseTurnBinding: release,
			}),
		};
		const { backend } = createBackend(new CompletingTurnEngine(), undefined, undefined, contextRuntime);
		const session = await backend.create({ id: "session-1" });
		const contextController = session.createCoreAssembly().contextController!;
		const cancellation = new AbortController();
		const summary = contextController.summarize({
			records: [{ type: "public", content: "safe", modelVisible: true }],
			signal: cancellation.signal,
		});
		await started;
		cancellation.abort("cancel shared summary");

		await expect(summary).rejects.toMatchObject({ name: "AbortError" });
		expect(release).toHaveBeenCalledOnce();
		expect(contextController.readState().isCompacting).toBe(false);
	});

	it("rejects a dynamic manual owner omitted from the snapshot instead of executing it unbound", async () => {
		const compactManual = vi.fn(async () => {
			throw new Error("unbound execution");
		});
		const contextRuntime = {
			compactManual,
			readAutoCompactionEnabled: () => true,
			setAutoCompactionEnabled() {},
			bindForTurn: () => ({ compactManual }),
		};
		const { backend } = createBackend(new CompletingTurnEngine(), undefined, undefined, contextRuntime, {}, false);
		const session = await backend.create({ id: "session-1" });
		await session.prompt({ text: "hello" });
		const controller = session.createCoreAssembly().contextController!;
		await expect(controller.compact()).rejects.toThrow("not registered");
		expect(compactManual).not.toHaveBeenCalled();
		expect(controller.readState().isCompacting).toBe(false);
	});

	it("uses the admitted manual strategy for generation, commit hooks and release", async () => {
		const release = vi.fn();
		const afterCommit = vi.fn();
		const compactManual = vi.fn(async () => {
			throw new Error("Unbound manual strategy must not execute");
		});
		const bindForTurn = vi.fn(() => ({
			compactManual: async () => ({
				summary: "bound summary",
				summaryMessage: userMessage("bound summary"),
				firstKeptEntryId: "event-2",
				tokensBefore: 120,
				reason: "manual" as const,
			}),
			onManualCompactionCommitted: afterCommit,
			releaseTurnBinding: release,
		}));
		const contextRuntime = {
			compactManual,
			bindForTurn,
			readAutoCompactionEnabled: () => true,
			setAutoCompactionEnabled() {},
		};
		const { backend } = createBackend(new CompletingTurnEngine(), undefined, undefined, contextRuntime);
		const session = await backend.create({ id: "session-1" });
		await session.prompt({ text: "hello" });
		bindForTurn.mockClear();
		release.mockClear();
		const controller = session.createCoreAssembly().contextController!;
		await expect(controller.compact()).resolves.toMatchObject({ summary: "bound summary" });
		expect(bindForTurn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reason: "manual_compaction" }));
		expect(compactManual).not.toHaveBeenCalled();
		expect(afterCommit).toHaveBeenCalledOnce();
		expect(release).toHaveBeenCalledOnce();
		expect(session.readHistory().at(-1)).toMatchObject({ type: "compaction", summary: "bound summary" });
		expect(controller.readState().isCompacting).toBe(false);
	});

	it("clears the manual-compaction busy state even when its admitted resource release fails", async () => {
		const contextRuntime = {
			compactManual: async () => ({
				summary: "summary",
				summaryMessage: userMessage("summary"),
				firstKeptEntryId: "event-2",
				tokensBefore: 120,
				reason: "manual" as const,
			}),
			readAutoCompactionEnabled: () => true,
			setAutoCompactionEnabled() {},
			bindForTurn: (context: RuntimeSnapshotAcquireContext) => ({
				compactManual: contextRuntime.compactManual,
				releaseTurnBinding: () => {
					if (context.reason === "manual_compaction") throw new Error("release failed");
				},
			}),
		};
		const { backend } = createBackend(new CompletingTurnEngine(), undefined, undefined, contextRuntime);
		const session = await backend.create({ id: "session-1" });
		await session.prompt({ text: "hello" });
		const controller = session.createCoreAssembly().contextController!;
		await expect(controller.compact()).rejects.toThrow("release");
		expect(controller.readState().isCompacting).toBe(false);
		expect(session.readHistory().at(-1)).toMatchObject({ type: "compaction", summary: "summary" });
		await expect(session.prompt({ text: "still available" })).resolves.toMatchObject({ status: "completed" });
	});

	it("blocks turn operations during manual compaction and exposes explicit cancellation", async () => {
		let markCompactionStarted: (() => void) | undefined;
		const compactionStarted = new Promise<void>((resolve) => {
			markCompactionStarted = resolve;
		});
		const contextRuntime: ManualContextCompactionRuntime = {
			async compactManual(_input, signal) {
				markCompactionStarted?.();
				await waitForAbort(signal);
				throw new Error("unreachable");
			},
			readAutoCompactionEnabled: () => true,
			setAutoCompactionEnabled() {},
		};
		const { backend } = createBackend(
			new CompletingTurnEngine(),
			new RecordingPromptAdapter(),
			vi.fn(async () => {}),
			contextRuntime,
		);
		const session = await backend.create({ id: "session-1" });
		await session.prompt({ text: "hello" });
		const contextController = session.createCoreAssembly().contextController;
		if (!contextController) throw new Error("Context controller was not assembled");

		const compaction = contextController.compact();
		await compactionStarted;

		expect(contextController.readState().isCompacting).toBe(true);
		await expect(session.prompt({ text: "blocked" })).rejects.toMatchObject({ code: "session_busy" });
		await expect(session.continue()).rejects.toMatchObject({ code: "session_busy" });
		contextController.abortCompaction();
		await expect(compaction).rejects.toMatchObject({ name: "AbortError" });
		expect(contextController.readState().isCompacting).toBe(false);
	});

	it("queues explicit concurrent input and retains it after abort", async () => {
		const engine = new BlockingTurnEngine();
		const promptAdapter = new RecordingPromptAdapter();
		const { backend } = createBackend(engine, promptAdapter);
		const session = await backend.create({ id: "session-1" });
		const events: SessionEvent[] = [];
		session.subscribe((event) => events.push(event));
		const activeTurn = session.prompt({ text: "first" });
		await engine.started;

		await expect(session.prompt({ text: "rejected" })).rejects.toMatchObject({ code: "session_busy" });
		await expect(session.prompt({ text: "later", streamingBehavior: "followUp" })).resolves.toEqual({
			status: "queued",
			behavior: "followUp",
			pendingCount: 1,
			id: expect.any(String),
		});
		await session.abort("user cancelled");

		await expect(activeTurn).resolves.toMatchObject({ status: "cancelled", reason: "user cancelled" });
		expect(promptAdapter.requests.map(({ request }) => request.text)).toEqual(["first"]);
		expect(promptAdapter.requests.map(({ queueing }) => queueing)).toEqual([false]);
		expect(await session.getState()).toMatchObject({ state: "idle", pendingMessageCount: 1 });
		expect(events.filter((event) => event.type === "session.lifecycle").map((event) => event.phase)).toEqual([
			"aborted",
			"agent_end",
		]);
	});

	it("disposes the kernel session and composition-owned resources once", async () => {
		const dispose = vi.fn(async () => {});
		const { backend } = createBackend(new CompletingTurnEngine(), new RecordingPromptAdapter(), dispose);
		const session = await backend.create({ id: "session-1" });

		await session.dispose();
		await session.dispose();

		expect(dispose).toHaveBeenCalledOnce();
		await expect(session.prompt({ text: "after dispose" })).rejects.toMatchObject({
			code: "session_closed",
		});
	});

	it("keeps admission closed while retrying only failed session cleanup tasks", async () => {
		let participantAttempts = 0;
		const participantDispose = vi.fn(async () => {
			participantAttempts += 1;
			if (participantAttempts === 1) throw new Error("participant cleanup failed");
		});
		const disposeRuntime = vi.fn(async () => {});
		const { backend } = createBackend(
			new CompletingTurnEngine(),
			new RecordingPromptAdapter(),
			disposeRuntime,
			undefined,
			{
				documentParticipants: [
					{
						initialize: vi.fn(async () => {}),
						onDocumentChanged: vi.fn(async () => {}),
						dispose: participantDispose,
					},
				],
			},
		);
		const session = await backend.create({ id: "session-1" });

		await expect(session.dispose()).rejects.toThrow("participant cleanup failed");
		await expect(session.prompt({ text: "after failed dispose" })).rejects.toMatchObject({
			code: "session_closed",
		});
		expect(disposeRuntime).toHaveBeenCalledOnce();

		await expect(session.dispose()).resolves.toBeUndefined();
		await expect(session.dispose()).resolves.toBeUndefined();
		expect(participantDispose).toHaveBeenCalledTimes(2);
		expect(disposeRuntime).toHaveBeenCalledOnce();
	});
});

function snapshot(
	projectConversationDocument = false,
	contextStrategy: RuntimeSnapshot["contextStrategy"] | undefined = undefined,
): RuntimeSnapshot {
	return {
		id: "snapshot-1",
		instructions: [],
		tools: new Map(),
		contextProviders: [],
		contextStrategy: contextStrategy ?? {
			async prepare(input) {
				return { messages: input.messages, estimatedTokens: input.messages.length };
			},
		},
		...(projectConversationDocument
			? {
					conversationContextProjector: {
						project(document: ConversationDocument) {
							return selectConversationDocumentModelMessages(document).map((message) => ({
								kind: "message" as const,
								message,
							}));
						},
					},
				}
			: {}),
		toolPolicy: {
			async authorize() {
				return true;
			},
		},
		tokenBudget: 8_000,
		reservedOutputTokens: 1_000,
		observers: [],
	};
}

function runtimeAssemblyDetails(sessionId: string) {
	const catalog = {
		refresh: vi.fn(),
		listAvailable: () => [TEST_MODEL, ALTERNATE_MODEL],
		find: (provider: string, modelId: string) =>
			[TEST_MODEL, ALTERNATE_MODEL].find((model) => model.provider === provider && model.id === modelId),
	};
	const modelRuntime = new RuntimeModel({
		initialModel: TEST_MODEL,
		initialThinkingLevel: "off",
		catalog,
		credentials: {
			resolve: async () => "test-key",
			refreshAuth: async () => {},
		},
	});
	return {
		modelRuntime,
		identity: {
			cwd: `workspace/${sessionId}`,
			sessionDirectory: "sessions",
			sessionPath: `sessions/${sessionId}.conversation.jsonl`,
		},
		stateSource: {
			read: () => ({
				contextPercent: null,
				contextWindow: 8_000,
				activeToolNames: ["read"],
			}),
		},
	};
}

const TEST_MODEL: Model<Api> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};

const ALTERNATE_MODEL: Model<Api> = {
	...TEST_MODEL,
	id: "alternate-model",
	name: "Alternate Model",
	reasoning: true,
};

function userMessage(text: string): UserMessage {
	return { role: "user", content: text, timestamp: 1 };
}

function readMessageText(message: unknown): string {
	if (typeof message !== "object" || message === null) return "";
	const content = (message as { readonly content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { readonly type: "text"; readonly text: string } =>
				typeof part === "object" &&
				part !== null &&
				(part as { readonly type?: unknown }).type === "text" &&
				typeof (part as { readonly text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join("");
}

function assistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "test-model",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 2,
	};
}

function waitForAbort(signal: AbortSignal): Promise<void> {
	return new Promise((_, reject) => {
		if (signal.aborted) {
			reject(abortError());
			return;
		}
		signal.addEventListener("abort", () => reject(abortError()), { once: true });
	});
}

function abortError(): Error {
	const error = new Error("Aborted");
	error.name = "AbortError";
	return error;
}
