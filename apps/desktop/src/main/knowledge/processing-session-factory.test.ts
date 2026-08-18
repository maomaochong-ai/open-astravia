import type { CodingAgentModelRuntime } from "@vetta/coding-agent/host-services";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesktopKnowledgeProcessingSessionFactory } from "./processing-session-factory.js";

const factoryMocks = vi.hoisted(() => ({
	codingToolResultPolicy: { project: vi.fn() },
	detectWorkspaceFacts: vi.fn(() => "# Workspace"),
	probeWorkspaceSignals: vi.fn(() => ({ isGitRepository: true, stacks: [] })),
	nodeWorkspaceFactsFileSource: {},
	nodeModelInputImageProcessor: {},
	createDesktopCodingAgentToolEnvironment: vi.fn(),
	createDesktopCodingAgentSessionExecutionEnvironment: vi.fn(),
	create: vi.fn(
		(_options: {
			readonly createConversationPersistence: (context: { readonly conversationDir: string }) => unknown;
			readonly createToolEnvironment: (...args: never[]) => unknown;
			readonly createSessionExecutionEnvironment: (...args: never[]) => unknown;
			readonly codingToolResultPolicy: unknown;
			readonly knowledgeRuntime: unknown;
			readonly resolveWorkspaceFacts: (cwd: string) => string | undefined;
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

vi.mock("@vetta/coding-agent/model-context", () => ({
	detectWorkspaceFacts: factoryMocks.detectWorkspaceFacts,
	probeWorkspaceSignals: factoryMocks.probeWorkspaceSignals,
}));

vi.mock("@vetta/runtime-node/coding", () => ({
	nodeModelInputImageProcessor: factoryMocks.nodeModelInputImageProcessor,
	nodeWorkspaceFactsFileSource: factoryMocks.nodeWorkspaceFactsFileSource,
}));

vi.mock("@vetta/runtime-node/conversation", () => ({
	createFileConversationPersistence: factoryMocks.createFileConversationPersistence,
	resolveConversationFilePath: vi.fn(),
	resolveSessionIdFromPath: vi.fn(),
}));

vi.mock("@vetta/runtime-node/host", () => ({
	createNodeKnowledgeRuntime: factoryMocks.createNodeKnowledgeRuntime,
}));

vi.mock("@vetta/runtime-desktop", () => ({
	createDesktopCodingAgentSessionExecutionEnvironment:
		factoryMocks.createDesktopCodingAgentSessionExecutionEnvironment,
	createDesktopCodingAgentToolEnvironment: factoryMocks.createDesktopCodingAgentToolEnvironment,
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
			createToolEnvironment: factoryMocks.createDesktopCodingAgentToolEnvironment,
			createSessionExecutionEnvironment: factoryMocks.createDesktopCodingAgentSessionExecutionEnvironment,
			codingToolResultPolicy: factoryMocks.codingToolResultPolicy,
			modelInputImageProcessor: factoryMocks.nodeModelInputImageProcessor,
			knowledgeRuntime: factoryMocks.knowledgeRuntime,
			resolveWorkspaceFacts: expect.any(Function),
		});
		expect(factoryMocks.createNodeKnowledgeRuntime).toHaveBeenCalledOnce();
		const compositionOptions = factoryMocks.create.mock.calls[0]?.[0];
		const persistence = compositionOptions?.createConversationPersistence({
			conversationDir: "C:\\sessions",
		});
		expect(factoryMocks.createFileConversationPersistence).toHaveBeenCalledWith("C:\\sessions");
		expect(persistence).toEqual({ conversationDir: "C:\\sessions" });
		expect(compositionOptions?.resolveWorkspaceFacts("C:\\workspace")).toBe("# Workspace");
		expect(factoryMocks.detectWorkspaceFacts).toHaveBeenCalledWith("C:\\workspace", expect.any(Function));
	});
});
