import type { Api, Model } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeAgentDefinition } from "../../src/agents/index.js";
import type { RuntimeSessionAgentSelection } from "../../src/contracts.js";
import {
	applyConversationDocumentCommand,
	applyStoredEventToConversationDocument,
	type ConversationDocument,
	type ConversationDocumentCommand,
	type ConversationDocumentCommandResult,
	type ConversationDocumentForkResult,
	createEmptyConversationDocument,
	selectConversationDocumentMessages,
} from "../../src/conversation/index.js";
import type {
	ConversationMetadata,
	ConversationRepository,
	ConversationSnapshot,
	CreateConversationInput,
	RuntimeInputRequestPreparationContext,
	SessionInputRequest,
	StoredConversation,
	StoredSessionEvent,
} from "../../src/kernel/index.js";
import { PassthroughContextStrategy } from "../../src/kernel/index.js";
import {
	RuntimeAgentSessionAssemblyBackend,
	RuntimeHost,
	RuntimeModel,
	type RuntimePromptAdapter,
	type RuntimeResources,
} from "../../src/runtime-host/index.js";

describe("RuntimeAgentSessionAssemblyBackend", () => {
	it("creates a selected peer Agent through the one RuntimeHost lifecycle", async () => {
		const instanceConfigurations: unknown[] = [];
		const sessionConfigurations: unknown[] = [];
		const snapshotReasons: Array<string | undefined> = [];
		const planDispose = vi.fn(async () => {});
		const directResourceDispose = vi.fn(async () => {});
		let nextSessionId = 0;
		const host = new RuntimeHost({
			createSessionBackend: ({ agents, observationPublisher }) => {
				agents.registry.upsert({
					source: { id: "code", revision: "1" },
					definition: definition({
						instanceConfigurations,
						sessionConfigurations,
						snapshotReasons,
						planDispose,
						directResourceDispose,
					}),
				});
				return new RuntimeAgentSessionAssemblyBackend({
					runtime: agents,
					observationPublisher,
					identity: { resolve: () => ({ sessionId: `session-${++nextSessionId}` }) },
				});
			},
		});
		const agent = {
			id: "reviewer",
			instanceConfiguration: { tenant: "alpha" },
			sessionConfiguration: { language: "zh-CN" },
		} satisfies RuntimeSessionAgentSelection;

		const created = await host.createSession({ agent, cwd: "C:/workspace" });

		expect(created).toEqual({ sessionId: "session-1" });
		expect(host.getState(created.sessionId)).toMatchObject({ sessionId: "session-1", agentId: "reviewer" });
		expect(instanceConfigurations).toEqual([{ tenant: "alpha" }]);
		expect(sessionConfigurations).toEqual([{ language: "zh-CN" }]);
		expect(snapshotReasons).toEqual(["preview"]);

		await host.close();
		expect(planDispose).toHaveBeenCalledOnce();
		expect(directResourceDispose).not.toHaveBeenCalled();
	});

	it("supplies Host resources for a simple capability-only Agent", async () => {
		const sessionDefinitionDispose = vi.fn(async () => {});
		const fallbackDispose = vi.fn(async () => {});
		const host = new RuntimeHost({
			createSessionBackend: ({ agents, observationPublisher }) => {
				agents.registry.upsert({
					source: { id: "code", revision: "1" },
					definition: {
						id: "classifier",
						createInstance: () => ({
							prepareSession: () => ({
								capabilities: {
									instructions: [{ id: "classify", content: "Classify the request.", priority: 0 }],
									features: [],
									contextStrategy: new PassthroughContextStrategy(),
									toolPolicy: { authorize: async () => true },
									tokenBudget: 8_000,
									reservedOutputTokens: 1_000,
								},
								dispose: sessionDefinitionDispose,
							}),
						}),
					},
				});
				return new RuntimeAgentSessionAssemblyBackend({
					runtime: agents,
					observationPublisher,
					identity: { resolve: () => ({ sessionId: "simple-session" }) },
					fallbackResources: {
						create: async ({ sessionId, agentSession }) =>
							createResources(sessionId, agentSession, fallbackDispose),
					},
				});
			},
		});

		await expect(host.createSession({ agent: { id: "classifier" } })).resolves.toEqual({
			sessionId: "simple-session",
		});
		await host.close();

		expect(fallbackDispose).toHaveBeenCalledOnce();
		expect(sessionDefinitionDispose).toHaveBeenCalledOnce();
	});
});

function definition(options: {
	readonly instanceConfigurations: unknown[];
	readonly sessionConfigurations: unknown[];
	readonly snapshotReasons: Array<string | undefined>;
	readonly planDispose: () => Promise<void>;
	readonly directResourceDispose: () => Promise<void>;
}): RuntimeAgentDefinition {
	return {
		id: "reviewer",
		createInstance: (context) => {
			options.instanceConfigurations.push(context.configuration);
			return {
				prepareSession: (sessionContext) => {
					options.sessionConfigurations.push(sessionContext.configuration);
					return {
						definition: {
							capabilities: {
								instructions: [{ id: "review", content: "Review the change.", priority: 0 }],
								features: [],
								contextStrategy: new PassthroughContextStrategy(),
								toolPolicy: { authorize: async () => true },
								tokenBudget: 8_000,
								reservedOutputTokens: 1_000,
							},
						},
						beforeSnapshotAcquire: (context) => {
							options.snapshotReasons.push(context?.reason);
						},
						activate: async (binding) => {
							const preview = await binding.acquirePreviewSnapshot();
							await preview.release();
							return createResources(
								sessionContext.sessionId,
								binding.snapshotProvider,
								options.directResourceDispose,
							);
						},
						dispose: options.planDispose,
					};
				},
			};
		},
	};
}

function createResources(
	sessionId: string,
	snapshotProvider: RuntimeResources["snapshotProvider"],
	dispose: () => Promise<void>,
): RuntimeResources {
	const repository = new TestConversationRepository();
	const modelRuntime = new RuntimeModel({
		initialModel: TEST_MODEL,
		initialThinkingLevel: "off",
		catalog: {
			refresh: () => {},
			listAvailable: () => [TEST_MODEL],
			find: (provider, modelId) =>
				provider === TEST_MODEL.provider && modelId === TEST_MODEL.id ? TEST_MODEL : undefined,
		},
		credentials: { resolve: async () => "test-key", refreshAuth: async () => {} },
	});
	return {
		sessionId,
		repository,
		conversationDocumentStore: repository,
		promptAdapter: new RejectingPromptAdapter(),
		snapshotProvider,
		modelRuntime,
		identity: { cwd: "C:/workspace" },
		stateSource: { read: () => ({ contextPercent: 0, contextWindow: 8_000, activeToolNames: [] }) },
		hostInteraction: { bind: async () => {} },
		executionController: { isBusy: () => false, reconfigure: async () => {} },
		configurationController: {
			setSteeringMode: () => {},
			setFollowUpMode: () => {},
			setAgentMode: () => {},
		},
		dispose,
	};
}

class RejectingPromptAdapter implements RuntimePromptAdapter {
	createRequest(): SessionInputRequest {
		throw new Error("Prompt is not used by this contract test");
	}

	prepare(_request: SessionInputRequest, _context: RuntimeInputRequestPreparationContext): Promise<never> {
		return Promise.reject(new Error("Prompt is not used by this contract test"));
	}
}

class TestConversationRepository implements ConversationRepository {
	private conversation: StoredConversation | undefined;
	private document: ConversationDocument | undefined;

	async create(input: CreateConversationInput): Promise<ConversationMetadata> {
		this.conversation = {
			sessionId: input.sessionId,
			createdAt: input.createdAt,
			version: 0,
			messages: [],
			events: [],
		};
		this.document = createEmptyConversationDocument({
			sessionId: input.sessionId,
			createdAt: input.createdAt,
			agentId: input.agentId,
		});
		return this.conversation;
	}

	async load(sessionId: string): Promise<StoredConversation> {
		if (!this.conversation || this.conversation.sessionId !== sessionId) throw new Error("Conversation not found");
		return this.conversation;
	}

	async readDocument(sessionId: string): Promise<ConversationDocument> {
		if (!this.document || this.document.identity.sessionId !== sessionId) throw new Error("Document not found");
		return this.document;
	}

	async execute(
		sessionId: string,
		expectedRevision: number | null,
		command: ConversationDocumentCommand,
	): Promise<ConversationDocumentCommandResult> {
		const document = await this.readDocument(sessionId);
		if (expectedRevision !== null && document.revision !== expectedRevision) throw new Error("Revision mismatch");
		const result = applyConversationDocumentCommand(document, command);
		this.document = result.document;
		return result;
	}

	fork(): Promise<ConversationDocumentForkResult> {
		return Promise.reject(new Error("Fork is not used by this contract test"));
	}

	async append(
		sessionId: string,
		expectedVersion: number,
		events: readonly StoredSessionEvent[],
	): Promise<{ readonly version: number }> {
		const conversation = await this.load(sessionId);
		if (conversation.version !== expectedVersion) throw new Error("Version mismatch");
		let document = await this.readDocument(sessionId);
		for (const [index, event] of events.entries()) {
			document = applyStoredEventToConversationDocument(document, event, expectedVersion + index + 1);
		}
		const version = expectedVersion + events.length;
		this.document = document;
		this.conversation = {
			...conversation,
			version,
			messages: selectConversationDocumentMessages(document),
			events: [...conversation.events, ...events],
		};
		return { version };
	}

	saveSnapshot(_sessionId: string, _snapshot: ConversationSnapshot): Promise<void> {
		return Promise.resolve();
	}

	close(): Promise<void> {
		return Promise.resolve();
	}
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
