import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Model,
	type UserMessage,
} from "@vetta/ai";
import { describe, expect, it } from "vitest";
import {
	AgentCoreTurnEngine,
	type ConversationMetadata,
	type ConversationRepository,
	type ConversationSnapshot,
	type CreateConversationInput,
	type RuntimeSnapshot,
	StaticRuntimeSnapshotProvider,
	type StoredConversation,
	type StoredSessionEvent,
	type TurnEngineEvent,
	type TurnEnginePort,
	type TurnEngineRequest,
	TurnPipeline,
} from "../../src/kernel/index.js";
import { RuntimeModel } from "../../src/runtime-host/index.js";

describe("Turn model binding", () => {
	it("keeps the active turn binding stable and applies model changes to the next turn", async () => {
		const repository = new InMemoryConversationRepository();
		const modelRuntime = createModelRuntime();
		const turnEngine = new BlockingRecordingTurnEngine();
		let turnIndex = 0;
		const pipeline = new TurnPipeline({
			repository,
			snapshotProvider: new StaticRuntimeSnapshotProvider(snapshot(), modelRuntime),
			turnEngine,
			eventSink: { async publish() {} },
			clock: { now: () => 1 },
			idGenerator: {
				next: () => {
					turnIndex += 1;
					return `turn-${turnIndex}`;
				},
			},
		});
		await pipeline.createSession("session-1");

		const firstTurn = pipeline.run("session-1", { message: userMessage("first") }, new AbortController().signal);
		await turnEngine.firstStarted;
		await modelRuntime.selectModel("test/alternate", "always");
		modelRuntime.setThinkingLevel("medium");

		expect(turnEngine.requests[0]?.modelBinding).toMatchObject({
			model: INITIAL_MODEL,
			reasoning: undefined,
		});
		expect(await turnEngine.requests[0]?.modelBinding?.credential?.resolve()).toBe("test-key");
		turnEngine.finishFirst();
		await firstTurn;

		await pipeline.run("session-1", { message: userMessage("second") }, new AbortController().signal);
		expect(turnEngine.requests[1]?.modelBinding).toMatchObject({
			model: ALTERNATE_MODEL,
			reasoning: "medium",
		});
		expect(await turnEngine.requests[1]?.modelBinding?.credential?.resolve()).toBe("test-key");
	});

	it("acquires the snapshot and model binding through one provider contract", async () => {
		const repository = new InMemoryConversationRepository();
		const modelRuntime = createModelRuntime();
		const observed: Array<{ readonly snapshotId: string; readonly modelId: string | undefined }> = [];
		const pipeline = new TurnPipeline({
			repository,
			snapshotProvider: new StaticRuntimeSnapshotProvider(snapshot(), modelRuntime),
			turnEngine: {
				async *execute(request) {
					observed.push({
						snapshotId: request.snapshot.id,
						modelId: request.modelBinding?.model.id,
					});
					yield { type: "message", message: assistantMessage(request.modelBinding?.model ?? INITIAL_MODEL) };
					yield { type: "completed", stopReason: "stop" };
				},
			},
			eventSink: { async publish() {} },
			clock: { now: () => 1 },
			idGenerator: { next: () => "turn-atomic-binding" },
		});
		await pipeline.createSession("session-1");

		await pipeline.run("session-1", { message: userMessage("hello") }, new AbortController().signal);

		expect(observed).toEqual([{ snapshotId: "snapshot-1", modelId: "initial" }]);
	});

	it("makes AgentCoreTurnEngine use the request binding instead of static model options", async () => {
		const calls: Array<{ readonly model: Model<Api>; readonly reasoning: string | undefined }> = [];
		const credentialModels: Model<Api>[] = [];
		const engine = new AgentCoreTurnEngine({
			model: INITIAL_MODEL,
			streamOptions: { reasoning: "high" },
			resolveApiKey: (model) => {
				credentialModels.push(model);
				return "binding-key";
			},
			streamFn: (model, _context, options) => {
				calls.push({ model, reasoning: options?.reasoning });
				expect(options?.apiKey).toBe("binding-key");
				return new CompletedAssistantStream(assistantMessage(model));
			},
		});

		const events: TurnEngineEvent[] = [];
		for await (const event of engine.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			snapshot: snapshot(),
			modelBinding: {
				model: ALTERNATE_MODEL,
				reasoning: undefined,
				credential: { resolve: () => "binding-key" },
			},
			messages: [userMessage("hello")],
			signal: new AbortController().signal,
		})) {
			events.push(event);
		}

		expect(calls).toEqual([{ model: ALTERNATE_MODEL, reasoning: undefined }]);
		expect(credentialModels).toEqual([]);
		expect(events.at(-1)).toEqual({ type: "completed", stopReason: "stop" });
	});
});

class BlockingRecordingTurnEngine implements TurnEnginePort {
	readonly requests: TurnEngineRequest[] = [];
	readonly firstStarted: Promise<void>;
	private readonly firstReleased: Promise<void>;
	private markFirstStarted: () => void = () => {};
	private releaseFirst: () => void = () => {};

	constructor() {
		this.firstStarted = new Promise((resolve) => {
			this.markFirstStarted = resolve;
		});
		this.firstReleased = new Promise((resolve) => {
			this.releaseFirst = resolve;
		});
	}

	finishFirst(): void {
		this.releaseFirst();
	}

	async *execute(request: TurnEngineRequest): AsyncIterable<TurnEngineEvent> {
		this.requests.push(request);
		if (this.requests.length === 1) {
			this.markFirstStarted();
			await this.firstReleased;
		}
		yield { type: "message", message: assistantMessage(request.modelBinding?.model ?? INITIAL_MODEL) };
		yield { type: "completed", stopReason: "stop" };
	}
}

class CompletedAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor(message: AssistantMessage) {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected assistant event");
			},
		);
		queueMicrotask(() => {
			this.push({ type: "done", reason: "stop", message });
		});
	}
}

class InMemoryConversationRepository implements ConversationRepository {
	private conversation: StoredConversation | undefined;

	async create(input: CreateConversationInput): Promise<ConversationMetadata> {
		this.conversation = {
			sessionId: input.sessionId,
			createdAt: input.createdAt,
			version: 0,
			messages: [],
			events: [],
		};
		return this.conversation;
	}

	async load(sessionId: string): Promise<StoredConversation> {
		if (!this.conversation || this.conversation.sessionId !== sessionId) {
			throw new Error(`Conversation not found: ${sessionId}`);
		}
		return this.conversation;
	}

	async append(
		sessionId: string,
		expectedVersion: number,
		events: readonly StoredSessionEvent[],
	): Promise<{ readonly version: number }> {
		const conversation = await this.load(sessionId);
		if (conversation.version !== expectedVersion) throw new Error("Version mismatch");
		const messages = [...conversation.messages];
		for (const event of events) {
			if (event.type === "message.appended") messages.push(event.message);
		}
		const version = expectedVersion + events.length;
		this.conversation = {
			...conversation,
			version,
			messages,
			events: [...conversation.events, ...events],
		};
		return { version };
	}

	async saveSnapshot(_sessionId: string, _snapshot: ConversationSnapshot): Promise<void> {}

	async close(): Promise<void> {}
}

function createModelRuntime(): RuntimeModel {
	return new RuntimeModel({
		initialModel: INITIAL_MODEL,
		initialThinkingLevel: "off",
		catalog: {
			refresh() {},
			listAvailable: () => [INITIAL_MODEL, ALTERNATE_MODEL],
			find: (provider, modelId) =>
				[INITIAL_MODEL, ALTERNATE_MODEL].find(
					(candidate) => candidate.provider === provider && candidate.id === modelId,
				),
		},
		credentials: {
			resolve: async () => "test-key",
			refreshAuth: async () => {},
		},
	});
}

function snapshot(): RuntimeSnapshot {
	return {
		id: "snapshot-1",
		instructions: [],
		tools: new Map(),
		contextProviders: [],
		contextStrategy: {
			async prepare(input) {
				return { messages: input.messages, estimatedTokens: input.messages.length };
			},
		},
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

function userMessage(content: string): UserMessage {
	return { role: "user", content, timestamp: 1 };
}

function assistantMessage(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "done" }],
		api: model.api,
		provider: model.provider,
		model: model.id,
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

const INITIAL_MODEL: Model<Api> = {
	id: "initial",
	name: "Initial",
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
	...INITIAL_MODEL,
	id: "alternate",
	name: "Alternate",
	reasoning: true,
};
