import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import type { RuntimeModel } from "@vetta/runtime-core";
import {
	type AgentFeatureDefinition,
	type ConversationContextProjector,
	type ModelCallContextTransformationInput,
	PassthroughContextStrategy,
	type RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import { afterEach, describe, expect, it } from "vitest";
import type { CodingAgentContextRuntime } from "../../src/adapters/runtime-core/context-runtime/index.js";
import { CodingAgentExtensionRunAdapter } from "../../src/adapters/runtime-core/extension-run-adapter.js";
import { createCodingToolsRuntimeComposition } from "../../src/composition/tool-surface/runtime-tools-composition.js";
import { createCodingAgentTurnCapabilitySessionAssembly } from "../../src/composition/turn/capability-session-assembly.js";
import type { CodingAgentSessionExecutionRuntime } from "../../src/host/session-execution/execution-runtime.js";
import { DEFAULT_HEAVY_TOOL_CONFIRMATION_TEXTS } from "../../src/tool-policy/heavy-tool-confirmation.js";
import { CodingAgentTodoRuntime } from "../../src/work-state/todo-runtime.js";

describe("Coding Agent Turn Capability session assembly", () => {
	const disposals: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		for (const dispose of disposals.splice(0).reverse()) await dispose();
	});

	it("owns the session-local capability profile without changing its tool surface", async () => {
		const codingTools = createCodingToolsRuntimeComposition({
			activation: { mode: "explicit", toolNames: [] },
		});
		disposals.push(() => codingTools.dispose());
		const todoRuntime = new CodingAgentTodoRuntime();
		disposals.push(() => todoRuntime.dispose());
		const contextRuntime = createContextRuntime();
		const extensionEvents = new CodingAgentExtensionRunAdapter();
		const productTool = createTool("product_tool");
		const executionTool = createTool("execution_tool");
		const executionFeature = createFeature("execution", []);
		const executionRuntime = {
			feature: executionFeature,
			ownsTool: () => false,
			readAvailableTools: () => new Map([[executionTool.name, executionTool]]),
		} as unknown as CodingAgentSessionExecutionRuntime;
		const assembly = await createCodingAgentTurnCapabilitySessionAssembly({
			session: {
				initialSessionId: "session-1",
				readSessionId: () => "session-1",
				cwd: "C:\\workspace",
				scenario: "cli",
			},
			activation: {
				resolve: () => ({ mode: "explicit", toolNames: [] }),
				readAgentMode: () => undefined,
				readAgentPlugins: () => undefined,
				readActiveToolNamesOverride: () => undefined,
			},
			prompt: {
				systemPromptOptionsResolver: async () => ({ cwd: "C:\\workspace" }),
			},
			baseProfile: {
				...codingTools.profile,
				features: [...codingTools.profile.features, executionFeature],
			},
			codingTools,
			executionRuntime,
			productToolFeature: createFeature("product", [productTool]),
			productToolRegistrations: [],
			todoRuntime,
			contextRuntime,
			conversationContextProjector: {
				project: () => [],
			} satisfies ConversationContextProjector,
			modelRuntime: { bind: () => undefined } as unknown as RuntimeModel,
			hookRuntime: {} as unknown as EcosystemHookRuntime,
			extensionEvents,
		});
		disposals.push(() => assembly.dispose());

		const lease = await assembly.capabilities.acquire();
		try {
			expect(lease.snapshot.tools.has(productTool.name)).toBe(true);
			expect(lease.snapshot.contextStrategy).toBe(contextRuntime);
			expect(lease.snapshot.modelCallFrameComposer).toBeDefined();
			expect(lease.snapshot.modelCallMessageFinalizer).toBeDefined();
			expect(lease.snapshot.continuationPolicy).toBeDefined();
			expect(lease.snapshot.agentRunPreparer).toBe(extensionEvents);
		} finally {
			await lease.release();
		}
		expect(assembly.readAvailableTools().get(executionTool.name)).toBe(executionTool);
		expect(assembly.readAvailableTools().has(productTool.name)).toBe(false);
		expect(() => assembly.rebindSession("session-2")).not.toThrow();
	});

	it("gates a heavy product tool behind one confirmation per session", async () => {
		const codingTools = createCodingToolsRuntimeComposition({
			activation: { mode: "explicit", toolNames: [] },
		});
		disposals.push(() => codingTools.dispose());
		const todoRuntime = new CodingAgentTodoRuntime();
		disposals.push(() => todoRuntime.dispose());
		const executed: string[] = [];
		const asked: string[] = [];
		const heavyTool = createTool("vetd_create", executed);
		const executionRuntime = {
			feature: createFeature("execution", []),
			ownsTool: () => false,
			readAvailableTools: () => new Map(),
		} as unknown as CodingAgentSessionExecutionRuntime;
		const assembly = await createCodingAgentTurnCapabilitySessionAssembly({
			session: {
				initialSessionId: "session-1",
				readSessionId: () => "session-1",
				cwd: "C:\\workspace",
				scenario: "cli",
			},
			activation: {
				resolve: () => ({ mode: "explicit", toolNames: [heavyTool.name] }),
				readAgentMode: () => undefined,
				readAgentPlugins: () => undefined,
				readActiveToolNamesOverride: () => undefined,
			},
			prompt: {
				systemPromptOptionsResolver: async () => ({ cwd: "C:\\workspace" }),
			},
			baseProfile: codingTools.profile,
			codingTools,
			executionRuntime,
			productToolFeature: createFeature("product", [heavyTool]),
			productToolRegistrations: [{ tool: heavyTool, scopeUse: ["cli"], category: "core", sideEffect: "heavy" }],
			todoRuntime,
			contextRuntime: createContextRuntime(),
			conversationContextProjector: { project: () => [] } satisfies ConversationContextProjector,
			modelRuntime: { bind: () => undefined } as unknown as RuntimeModel,
			hookRuntime: createPassthroughHookRuntime(),
			extensionEvents: new CodingAgentExtensionRunAdapter(),
			askUserQuestion: {
				isEnabled: () => true,
				ask: async (request) => {
					asked.push(request.questions[0]!.question);
					return {
						cancelled: false,
						answers: request.questions.map((question) => ({
							question: question.question,
							answers: [DEFAULT_HEAVY_TOOL_CONFIRMATION_TEXTS.allowLabel],
						})),
					};
				},
			},
		});
		disposals.push(() => assembly.dispose());

		const lease = await assembly.capabilities.acquire();
		try {
			const composer = lease.snapshot.modelCallFrameComposer!;
			const frame = await composer.compose({
				sessionId: "session-1",
				turnId: "turn-1",
				signal: new AbortController().signal,
				messages: [],
				modelBinding: undefined,
				frame: { instructions: [], tools: new Map([[heavyTool.name, heavyTool]]) },
			} as unknown as Parameters<typeof composer.compose>[0]);
			const gated = frame.tools.get(heavyTool.name)!;

			await gated.execute(toolRequest("call-1"));
			await gated.execute(toolRequest("call-2"));
		} finally {
			await lease.release();
		}

		expect(asked).toHaveLength(1);
		expect(asked[0]).toContain(heavyTool.name);
		expect(executed).toEqual([heavyTool.name, heavyTool.name]);
	});
});

function toolRequest(toolCallId: string) {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		toolCallId,
		input: {},
		signal: new AbortController().signal,
	};
}

/** 放行一切的 Ecosystem Hook 桩，用来把确认闸暴露成唯一的拦截来源。 */
function createPassthroughHookRuntime(): EcosystemHookRuntime {
	return {
		runPreToolUse: async () => ({ shouldStop: false, shouldBlock: false, additionalContexts: [] }),
		runPostToolUse: async () => ({ shouldStop: false, shouldBlock: false, additionalContexts: [] }),
		recordAdditionalContexts: async () => {},
	} as unknown as EcosystemHookRuntime;
}

function createFeature(id: string, tools: readonly RuntimeToolDefinition[]): AgentFeatureDefinition {
	return {
		id,
		async prepare() {
			return {
				async contribute() {
					return { tools };
				},
				async dispose() {},
			};
		},
	};
}

function createTool(name: string, executed?: string[]): RuntimeToolDefinition {
	return {
		name,
		label: name,
		description: name,
		inputSchema: { type: "object", additionalProperties: false },
		async execute() {
			executed?.push(name);
			return { content: [{ type: "text", text: name }] };
		},
	};
}

function createContextRuntime(): CodingAgentContextRuntime {
	const contextStrategy = new PassthroughContextStrategy();
	return {
		id: "test-context",
		prepare: contextStrategy.prepare.bind(contextStrategy),
		async transform(input: ModelCallContextTransformationInput) {
			return input.messages;
		},
		async observe() {},
	} as unknown as CodingAgentContextRuntime;
}
