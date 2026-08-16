import type { CodingAgentModelRuntime } from "@vetta/coding-agent/host-services";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesktopKnowledgeProcessingSessionFactory } from "./processing-session-factory.js";

const factoryMocks = vi.hoisted(() => ({
	codingToolResultPolicy: { project: vi.fn() },
	create: vi.fn(
		(_options: {
			readonly createConversationPersistence: (context: { readonly conversationDir: string }) => unknown;
			readonly createToolEnvironment: (...args: never[]) => unknown;
			readonly codingToolResultPolicy: unknown;
			readonly knowledgeRuntime: unknown;
		}) => ({ create: vi.fn() }),
	),
	createFileConversationPersistence: vi.fn((conversationDir: string) => ({ conversationDir })),
	createNodeKnowledgeRuntime: vi.fn(),
	knowledgeRuntime: { query: {}, write: {} },
}));

factoryMocks.createNodeKnowledgeRuntime.mockReturnValue(factoryMocks.knowledgeRuntime);

vi.mock("@vetta/coding-agent/composition", () => ({
	createKnowledgeProcessingSessionFactory: factoryMocks.create,
}));

vi.mock("@vetta/runtime-node/conversation", () => ({
	createFileConversationPersistence: factoryMocks.createFileConversationPersistence,
}));

vi.mock("@vetta/runtime-node/host", () => ({
	createNodeKnowledgeRuntime: factoryMocks.createNodeKnowledgeRuntime,
}));

vi.mock("@vetta/runtime-desktop", () => ({
	createDesktopResultArtifactRuntime: () => ({
		codingToolResultPolicy: factoryMocks.codingToolResultPolicy,
	}),
}));

describe("createDesktopKnowledgeProcessingSessionFactory", () => {
	const modelRegistry = {} as CodingAgentModelRuntime;
	const getModelRegistry = () => modelRegistry;

	beforeEach(() => {
		factoryMocks.create.mockClear();
		factoryMocks.createFileConversationPersistence.mockClear();
		factoryMocks.createNodeKnowledgeRuntime.mockClear();
	});

	it("creates the production knowledge processing session factory", () => {
		const factory = createDesktopKnowledgeProcessingSessionFactory({
			getModelRegistry,
		});

		expect(factory).toBe(factoryMocks.create.mock.results[0]?.value);
		expect(factoryMocks.create).toHaveBeenCalledWith({
			getModelRegistry,
			createConversationPersistence: expect.any(Function),
			createToolEnvironment: expect.any(Function),
			codingToolResultPolicy: factoryMocks.codingToolResultPolicy,
			knowledgeRuntime: factoryMocks.knowledgeRuntime,
		});
		expect(factoryMocks.createNodeKnowledgeRuntime).toHaveBeenCalledOnce();
		const compositionOptions = factoryMocks.create.mock.calls[0]?.[0];
		const persistence = compositionOptions?.createConversationPersistence({
			conversationDir: "C:\\sessions",
		});
		expect(factoryMocks.createFileConversationPersistence).toHaveBeenCalledWith("C:\\sessions");
		expect(persistence).toEqual({ conversationDir: "C:\\sessions" });
	});
});
