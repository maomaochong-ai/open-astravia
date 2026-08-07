import type { Api, Model } from "@vetta/ai";
import type { GreenfieldRuntimeSession } from "@vetta/runtime-core";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import type { McpRuntimeToolSource, McpRuntimeToolView } from "@vetta/runtime-mcp";
import { describe, expect, it, vi } from "vitest";
import type {
	CodingAgentRuntimeComposition,
	CodingAgentRuntimeCompositionOptions,
	CodingAgentRuntimeSessionOptions,
} from "../../src/composition/contracts/index.js";
import {
	createGreenfieldChildCompositionFactory,
	type GreenfieldChildRuntimeCompositionFactory,
} from "../../src/composition/greenfield-child-composition-policy.js";
import type {
	GreenfieldSubagentChildCompositionRequest,
	GreenfieldSubagentChildSessionOptions,
} from "../../src/composition/greenfield-subagent-session-assembly.js";

describe("Greenfield Child Composition policy", () => {
	it("projects an isolated child composition while preserving allowed parent ports", async () => {
		const fixture = compositionFixture();
		const mcpSource = {
			refresh: async () => ({ tools: [] }),
		} satisfies McpRuntimeToolSource;
		const createPluginMcpRuntime = async () => {
			throw new Error("child must not create a plugin MCP runtime");
		};
		const createPluginRuntime = () => undefined;
		const extensionTools: NonNullable<CodingAgentRuntimeCompositionOptions["extensionTools"]> = [];
		const tracer = {} as NonNullable<CodingAgentRuntimeCompositionOptions["tracer"]>;
		const tracing: NonNullable<CodingAgentRuntimeCompositionOptions["tracing"]> = {
			traceName: "parent-trace",
			metadata: { app: "coding-agent" },
		};
		const parentOptions: CodingAgentRuntimeCompositionOptions = {
			conversationDir: "C:\\conversations",
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
			knowledgeRoot: "C:\\knowledge",
			systemPromptAdvertisedToolNames: ["parent_tool"],
		};
		const inheritedMcpView = { tools: [] } as McpRuntimeToolView;
		const request: GreenfieldSubagentChildCompositionRequest = {
			conversationDir: "C:\\conversations\\.subagents\\parent",
			cwd: "C:\\child",
			initialModel: CHILD_MODEL,
			initialThinkingLevel: "high",
			activation: { mode: "explicit", toolNames: ["read", "mcp_parent_lookup"] },
			inheritedMcpView,
		};
		const compositionCalls: Array<{
			readonly options: CodingAgentRuntimeCompositionOptions;
			readonly inheritedMcpView: McpRuntimeToolView;
		}> = [];
		const createComposition: GreenfieldChildRuntimeCompositionFactory = async (options, view) => {
			compositionCalls.push({ options, inheritedMcpView: view });
			return fixture.composition;
		};

		const createChild = createGreenfieldChildCompositionFactory({ parentOptions, createComposition });
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
			knowledgeRoot: "C:\\knowledge",
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
		expect(await child.createSession(childSessionOptions)).toBe(fixture.createdSession);
		expect(await child.resumeSession(resumedSessionOptions)).toBe(fixture.resumedSession);
		child.appendSessionContext("child-create", records);
		await child.deliverSessionContext("child-create", records);
		await child.dispose();

		expect(fixture.createSession).toHaveBeenCalledWith(childSessionOptions);
		expect(fixture.resumeSession).toHaveBeenCalledWith(resumedSessionOptions);
		expect(fixture.appendSessionContext).toHaveBeenCalledWith("child-create", records);
		expect(fixture.deliverSessionContext).toHaveBeenCalledWith("child-create", records);
		expect(fixture.dispose).toHaveBeenCalledOnce();
	});
});

function compositionFixture() {
	const createdSession = { sessionId: "child-create" } as GreenfieldRuntimeSession;
	const resumedSession = { sessionId: "child-resume" } as GreenfieldRuntimeSession;
	const createSession = vi.fn(async (_options: CodingAgentRuntimeSessionOptions) => createdSession);
	const resumeSession = vi.fn(async (_options: CodingAgentRuntimeSessionOptions) => resumedSession);
	const appendSessionContext = vi.fn((_sessionId: string, _records: readonly SessionContextRecord[]) => {});
	const deliverSessionContext = vi.fn(async (_sessionId: string, _records: readonly SessionContextRecord[]) => {});
	const dispose = vi.fn(async () => {});
	return {
		createdSession,
		resumedSession,
		createSession,
		resumeSession,
		appendSessionContext,
		deliverSessionContext,
		dispose,
		composition: {
			backend: { create: createSession, resume: resumeSession },
			appendSessionContext,
			deliverSessionContext,
			dispose,
		} as unknown as CodingAgentRuntimeComposition,
	};
}

function sessionOptions(sessionId: string): GreenfieldSubagentChildSessionOptions {
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
