import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import type { GreenfieldRuntimeModel } from "@vetta/runtime-core";
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
			modelRuntime: {} as GreenfieldRuntimeModel,
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
});

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

function createTool(name: string): RuntimeToolDefinition {
	return {
		name,
		label: name,
		description: name,
		inputSchema: { type: "object", additionalProperties: false },
		async execute() {
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
