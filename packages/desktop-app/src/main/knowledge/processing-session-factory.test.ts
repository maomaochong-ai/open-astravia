import type { CodingAgentModelRuntime } from "@vetta/coding-agent/host-services";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesktopKnowledgeProcessingSessionFactory } from "./processing-session-factory.js";

const factoryMocks = vi.hoisted(() => ({
	create: vi.fn(
		(_options: {
			readonly createConversationPersistence: (context: { readonly conversationDir: string }) => unknown;
		}) => ({ create: vi.fn() }),
	),
	createFileConversationPersistence: vi.fn((conversationDir: string) => ({ conversationDir })),
}));

vi.mock("@vetta/coding-agent/composition", () => ({
	createKnowledgeProcessingSessionFactory: factoryMocks.create,
}));

vi.mock("@vetta/runtime-node/conversation", () => ({
	createFileConversationPersistence: factoryMocks.createFileConversationPersistence,
}));

describe("createDesktopKnowledgeProcessingSessionFactory", () => {
	const modelRegistry = {} as CodingAgentModelRuntime;
	const getModelRegistry = () => modelRegistry;

	beforeEach(() => {
		factoryMocks.create.mockClear();
		factoryMocks.createFileConversationPersistence.mockClear();
	});

	it("creates the production knowledge processing session factory", () => {
		const factory = createDesktopKnowledgeProcessingSessionFactory({
			getModelRegistry,
		});

		expect(factory).toBe(factoryMocks.create.mock.results[0]?.value);
		expect(factoryMocks.create).toHaveBeenCalledWith({
			getModelRegistry,
			createConversationPersistence: expect.any(Function),
		});
		const compositionOptions = factoryMocks.create.mock.calls[0]?.[0];
		const persistence = compositionOptions?.createConversationPersistence({
			conversationDir: "C:\\sessions",
		});
		expect(factoryMocks.createFileConversationPersistence).toHaveBeenCalledWith("C:\\sessions");
		expect(persistence).toEqual({ conversationDir: "C:\\sessions" });
	});
});
