import type { Api, Model } from "@vetta/ai";
import {
	type RuntimeHostSessionAssembly,
	RuntimeObservationHub,
	type RuntimeSessionCreateRequest,
} from "@vetta/runtime-core";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import type { McpRuntimeToolSource, McpRuntimeToolView } from "@vetta/runtime-mcp";
import { describe, expect, it, vi } from "vitest";
import type {
	CodingAgentRuntimeComposition,
	CodingAgentRuntimeCompositionOptions,
} from "../../src/composition/contracts/index.js";
import {
	type CodingAgentChildRuntimeCompositionFactory,
	createCodingAgentChildCompositionFactory,
} from "../../src/composition/subagent/child-composition-policy.js";
import type {
	CodingAgentSubagentChildCompositionRequest,
	CodingAgentSubagentChildSessionOptions,
} from "../../src/composition/subagent/session-assembly.js";
import { createCodingAgentNodeSessionExecutionEnvironment } from "../../src/host/tool-environment/node/node-session-execution-environment.js";
import { createCodingAgentNodeToolEnvironment } from "../../src/host/tool-environment/node/node-tool-environment.js";
import type { CodingAgentPromptResourceSource } from "../../src/runtime-contracts/index.js";
import { createTestConversationPersistence } from "../fixtures/conversation-persistence.js";

describe("Coding Agent Child Composition policy", () => {
	it("projects an isolated child composition while preserving allowed parent ports", async () => {
		const fixture = compositionFixture();
		const mcpSource = {
			refresh: async () => ({ tools: [] }),
		} satisfies McpRuntimeToolSource;
		const createPluginMcpRuntime = async () => {
			throw new Error("child must not create a plugin MCP runtime");
		};
		const createPluginRuntime = () => undefined;
		const knowledgeRuntime = {
			query: { listAvailableTags: vi.fn(), queryByTags: vi.fn() },
			write: { write: vi.fn(), resolveAbsolutePath: vi.fn() },
		} as CodingAgentRuntimeCompositionOptions["knowledgeRuntime"];
		const extensionTools: NonNullable<CodingAgentRuntimeCompositionOptions["extensionTools"]> = [];
		const tracer = {} as NonNullable<CodingAgentRuntimeCompositionOptions["tracer"]>;
		const tracing: NonNullable<CodingAgentRuntimeCompositionOptions["tracing"]> = {
			traceName: "parent-trace",
			metadata: { app: "coding-agent" },
		};
		const parentOptions: CodingAgentRuntimeCompositionOptions = {
			conversationDir: "C:\\conversations",
			createConversationPersistence: createTestConversationPersistence,
			createToolEnvironment: createCodingAgentNodeToolEnvironment,
			createSessionExecutionEnvironment: createCodingAgentNodeSessionExecutionEnvironment,
			modelRegistry: {} as CodingAgentRuntimeCompositionOptions["modelRegistry"],
			initialModel: MODEL,
			initialThinkingLevel: "off",
			cwd: "C:\\parent",
			scenario: "project",
			activation: { mode: "scope", scope: "project" },
			mcpSource,
			createPluginMcpRuntime,
			createPluginRuntime,
			extensionTools,
			tracer,
			tracing,
			enableSubagents: true,
			knowledgeRuntime,
			systemPromptAdvertisedToolNames: ["parent_tool"],
		};
		const inheritedMcpView = { tools: [] } as McpRuntimeToolView;
		const request: CodingAgentSubagentChildCompositionRequest = {
			conversationDir: "C:\\conversations\\.subagents\\parent",
			cwd: "C:\\child",
			initialModel: CHILD_MODEL,
			initialThinkingLevel: "high",
			activation: { mode: "explicit", toolNames: ["read", "mcp_parent_lookup"] },
			inheritedMcpView,
			skillPolicy: { mode: "inherit" },
		};
		const compositionCalls: Array<{
			readonly options: CodingAgentRuntimeCompositionOptions;
			readonly inheritedMcpView: McpRuntimeToolView;
		}> = [];
		const createComposition: CodingAgentChildRuntimeCompositionFactory = async (options, view) => {
			compositionCalls.push({ options, inheritedMcpView: view });
			return fixture.composition;
		};

		const createChild = createCodingAgentChildCompositionFactory({ parentOptions, createComposition });
		const child = await createChild(request);

		expect(compositionCalls).toHaveLength(1);
		const childOptions = compositionCalls[0]?.options;
		if (!childOptions) throw new Error("Expected child composition options");
		expect(childOptions).toMatchObject({
			conversationDir: request.conversationDir,
			cwd: request.cwd,
			initialModel: request.initialModel,
			initialThinkingLevel: request.initialThinkingLevel,
			activation: request.activation,
			enableSubagents: false,
			scenario: "project",
			knowledgeRuntime,
			systemPromptAdvertisedToolNames: ["parent_tool"],
		});
		expect(childOptions.createPluginRuntime).toBe(createPluginRuntime);
		expect(childOptions.tracer).toBe(tracer);
		expect(childOptions.tracing).toBe(tracing);
		expect("mcpSource" in childOptions).toBe(false);
		expect("createPluginMcpRuntime" in childOptions).toBe(false);
		expect("extensionTools" in childOptions).toBe(false);
		expect(compositionCalls[0]?.inheritedMcpView).toBe(inheritedMcpView);
		expect(parentOptions.mcpSource).toBe(mcpSource);
		expect(parentOptions.createPluginMcpRuntime).toBe(createPluginMcpRuntime);
		expect(parentOptions.extensionTools).toBe(extensionTools);

		const childSessionOptions = sessionOptions("child-create");
		const resumedSessionOptions = sessionOptions("child-resume");
		const records: SessionContextRecord[] = [{ type: "test", content: "context", modelVisible: true }];
		expect(await child.createSession(childSessionOptions)).toMatchObject({ sessionId: "child-create" });
		expect(await child.resumeSession(resumedSessionOptions)).toMatchObject({ sessionId: "child-resume" });
		child.appendSessionContext("child-create", records);
		await child.deliverSessionContext("child-create", records);
		await child.dispose();

		expect(fixture.createAssembly).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				sessionId: "child-create",
				sessionPath: undefined,
				agent: expect.objectContaining({
					sessionConfiguration: expect.objectContaining({ ...childSessionOptions, scenario: "project" }),
				}),
			}),
		);
		expect(fixture.createAssembly).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				sessionId: "child-resume",
				sessionPath: "child-resume",
				agent: expect.objectContaining({
					sessionConfiguration: expect.objectContaining({ ...resumedSessionOptions, scenario: "project" }),
				}),
			}),
		);
		expect(fixture.appendSessionContext).toHaveBeenCalledWith("child-create", records);
		expect(fixture.deliverSessionContext).toHaveBeenCalledWith("child-create", records);
		expect(fixture.dispose).toHaveBeenCalledOnce();
	});

	it("applies a child skill allow-list without mutating the parent resource source", async () => {
		const fixture = compositionFixture();
		const resourceSource = {
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getAppendSystemPrompt: () => [],
			getSkills: () => ({
				skills: [{ name: "allowed" }, { name: "hidden" }],
				diagnostics: [],
			}),
			getSystemPrompt: () => undefined,
			refreshContextResourcesIfChanged: async () => false,
			refreshSkillsIfChanged: async () => false,
			setRuntimeSkillPaths: async () => {},
		} as unknown as CodingAgentPromptResourceSource;
		const parentOptions: CodingAgentRuntimeCompositionOptions = {
			conversationDir: "C:\\conversations",
			createConversationPersistence: createTestConversationPersistence,
			createToolEnvironment: createCodingAgentNodeToolEnvironment,
			createSessionExecutionEnvironment: createCodingAgentNodeSessionExecutionEnvironment,
			modelRegistry: {} as CodingAgentRuntimeCompositionOptions["modelRegistry"],
			initialModel: MODEL,
			initialThinkingLevel: "off",
			promptResourceSource: resourceSource,
			promptSettingsSource: {
				reloadPersonalizationSettings() {},
				getPersonalizationSettings: () => ({}),
			} as unknown as NonNullable<CodingAgentRuntimeCompositionOptions["promptSettingsSource"]>,
		};
		let childOptions: CodingAgentRuntimeCompositionOptions | undefined;
		const createChild = createCodingAgentChildCompositionFactory({
			parentOptions,
			createComposition: async (options) => {
				childOptions = options;
				return fixture.composition;
			},
		});

		await createChild({
			conversationDir: "C:\\conversations\\.subagents\\parent",
			cwd: "C:\\child",
			initialModel: CHILD_MODEL,
			initialThinkingLevel: "off",
			activation: { mode: "scope", scope: "cli" },
			inheritedMcpView: { tools: [] },
			skillPolicy: { mode: "allow", names: ["allowed"] },
		});

		expect(childOptions?.promptResourceSource?.getSkills().skills.map(({ name }) => name)).toEqual(["allowed"]);
		expect(resourceSource.getSkills().skills.map(({ name }) => name)).toEqual(["allowed", "hidden"]);
	});
});

function compositionFixture() {
	const createAssembly = vi.fn(async (request: RuntimeSessionCreateRequest) =>
		createRuntimeHostSessionAssembly(request.sessionId ?? "child"),
	);
	const appendSessionContext = vi.fn((_sessionId: string, _records: readonly SessionContextRecord[]) => {});
	const deliverSessionContext = vi.fn(async (_sessionId: string, _records: readonly SessionContextRecord[]) => {});
	const dispose = vi.fn(async () => {});
	return {
		createAssembly,
		appendSessionContext,
		deliverSessionContext,
		dispose,
		composition: {
			runtimeHostBackend: { createAssembly },
			agentRuntime: {
				agentId: "coding-agent",
			},
			readSessionAgentIdentity: () => undefined,
			observations: new RuntimeObservationHub(),
			scenario: "project",
			appendSessionContext,
			deliverSessionContext,
			dispose,
		} as unknown as CodingAgentRuntimeComposition,
	};
}

function createRuntimeHostSessionAssembly(sessionId: string): RuntimeHostSessionAssembly {
	return {
		lifecycle: { sessionId, sessionPath: undefined, dispose: async () => {} },
		historyReader: { readHistory: () => [] },
		historyController: {
			navigateForEdit: async () => ({ text: "", cancelled: false }),
			switchBranch: async () => ({ leafId: "" }),
			appendBranchSummary: async () => ({ entryId: "" }),
			deleteMessage: async () => ({ leafId: null }),
			replaceLastUserMessage: async () => ({ leafId: null }),
			forkSession: async () => ({ path: "", text: "" }),
			setName: async () => {},
		},
		executionController: { isBusy: () => false, reconfigure: async () => {} },
		workspaceView: { readWorkingDirectory: () => undefined },
		configurationController: {
			setSteeringMode: () => {},
			setFollowUpMode: () => {},
		},
		modelController: {
			selectModel: async () => {},
			setThinkingLevel: () => {},
			refreshAuth: async () => {},
		},
		modelView: {
			readCurrentModel: () => undefined,
			refreshAvailableModels: () => {},
			readAvailableModels: () => [],
			resolveApiKey: async () => undefined,
		},
		corePorts: {
			turnControl: {
				prompt: async () => undefined,
				continue: async () => {},
				retry: async () => {},
				abort: async () => {},
			},
			eventStream: { subscribe: () => () => {} },
			stateReader: {
				readState: () => ({
					thinkingLevel: "off",
					activeToolNames: [],
					isStreaming: false,
					messageCount: 0,
					contextPercent: 0,
					contextWindow: 0,
				}),
				readMessages: () => [],
			},
		},
	};
}

function sessionOptions(sessionId: string): CodingAgentSubagentChildSessionOptions {
	return {
		sessionId,
		cwd: "C:\\child",
		parentSessionPath: "C:\\conversations\\parent.conversation.jsonl",
		systemPromptAddon: "child prompt",
	};
}

const MODEL: Model<Api> = {
	id: "parent-model",
	name: "Parent Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};

const CHILD_MODEL: Model<Api> = { ...MODEL, id: "child-model", name: "Child Model" };
