import type { Api, Model } from "@vetta/ai";
import type { ModelCallFrameCompositionContext, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import type {
	AgentPluginHookContribution,
	AgentPluginHookInvocation,
	AgentPluginRuntimeConfig,
} from "../../src/model-context/index.js";
import { buildSystemPromptDraft } from "../../src/model-context/index.js";
import { CodingAgentPluginHookRuntime } from "../../src/plugins/runtime/hook-runtime.js";
import { CodingAgentPluginRunOrchestrator } from "../../src/plugins/runtime/run-orchestrator.js";

describe("CodingAgentPluginHookRuntime", () => {
	it("runs matching hooks in stable order and applies point-specific results", async () => {
		const config: AgentPluginRuntimeConfig = {
			hookContributions: [
				hook("plugin-z", "before-z", "tool.before"),
				hook("plugin-a", "before-a", "tool.before"),
				hook("plugin-a", "after", "tool.after"),
				hook("plugin-a", "error", "tool.error"),
				hook("plugin-a", "other-tool", "tool.before", { toolNames: ["other"] }),
			],
		};
		const invocations: AgentPluginHookInvocation[] = [];
		const orchestrator = createOrchestrator(() => config);
		const context = compositionContext();
		await composeOrchestrator(orchestrator, context);
		const runtime = new CodingAgentPluginHookRuntime({
			readAgentPlugins: () => config,
			readAgentMode: () => "coding",
			runOrchestrator: orchestrator,
			now: () => 42,
			invokeHook: async (invocation) => {
				invocations.push(invocation);
				if (invocation.hookId === "before-a") {
					return { value: { action: "continue", input: { value: "a" } }, effects: [] };
				}
				if (invocation.hookId === "before-z") {
					return { value: { action: "continue", input: { value: "z" } }, effects: [] };
				}
				if (invocation.hookId === "after") {
					return {
						value: { action: "replace", content: [{ type: "text", text: "replaced" }], details: { ok: true } },
						effects: [],
					};
				}
				return { value: { action: "feedback", text: "plugin feedback" }, effects: [] };
			},
		});
		const base = interceptionContext(context);

		const before = await runtime.before(base);
		expect(before).toEqual(expect.objectContaining({ input: { value: "z" } }));
		await expect(
			runtime.after({
				...base,
				result: { content: [{ type: "text", text: "raw" }], details: { ok: false } },
				state: before?.state,
			}),
		).resolves.toEqual({
			result: { content: [{ type: "text", text: "replaced" }], details: { ok: true } },
		});
		await expect(runtime.onError({ ...base, state: before?.state, error: new Error("boom") })).resolves.toEqual({
			error: expect.objectContaining({ message: "boom\n\nplugin feedback" }),
		});
		expect(invocations.map(({ hookId }) => hookId)).toEqual(["before-a", "before-z", "after", "error"]);
		expect(invocations[0]?.trigger).toEqual({
			kind: "tool.before",
			timestamp: 42,
			toolCallId: "call-1",
			toolName: "read",
			input: { value: "initial" },
		});
	});

	it("fails open on invalid or timed-out plugin handlers", async () => {
		const config: AgentPluginRuntimeConfig = {
			hookContributions: [
				hook("plugin-a", "invalid", "tool.before"),
				hook("plugin-b", "slow", "tool.before", { timeoutMs: 5 }),
			],
		};
		const failures: string[] = [];
		const orchestrator = createOrchestrator(() => config);
		const context = compositionContext();
		await composeOrchestrator(orchestrator, context);
		const runtime = new CodingAgentPluginHookRuntime({
			readAgentPlugins: () => config,
			readAgentMode: () => "coding",
			runOrchestrator: orchestrator,
			onHookFailure: ({ hookId, error }) => failures.push(`${hookId}:${String(error)}`),
			invokeHook: async (invocation) => {
				if (invocation.hookId === "invalid") {
					return { value: { action: "replace", content: [] }, effects: [] } as never;
				}
				return new Promise(() => undefined);
			},
		});

		await expect(runtime.before(interceptionContext(context))).resolves.toEqual(
			expect.objectContaining({ state: expect.anything() }),
		);
		expect(failures).toHaveLength(2);
		expect(failures[0]).toContain("Plugin hook returned an invalid result");
		expect(failures[1]).toContain("Plugin hook timed out after 5ms");
	});

	it("blocks when a before hook explicitly requests it", async () => {
		const config: AgentPluginRuntimeConfig = { hookContributions: [hook("plugin-a", "guard", "tool.before")] };
		const orchestrator = createOrchestrator(() => config);
		const context = compositionContext();
		await composeOrchestrator(orchestrator, context);
		const runtime = new CodingAgentPluginHookRuntime({
			readAgentPlugins: () => config,
			readAgentMode: () => "coding",
			runOrchestrator: orchestrator,
			invokeHook: async () => ({ value: { action: "block", reason: "protected" }, effects: [] }),
		});

		await expect(runtime.before(interceptionContext(context))).resolves.toEqual({
			block: { reason: "protected" },
		});
	});

	it("keeps one contribution snapshot across before and after", async () => {
		let config: AgentPluginRuntimeConfig = {
			hookContributions: [
				hook("plugin-a", "old-before", "tool.before"),
				hook("plugin-a", "old-after", "tool.after"),
			],
		};
		const invocations: string[] = [];
		const orchestrator = createOrchestrator(() => config);
		const context = compositionContext();
		await composeOrchestrator(orchestrator, context);
		const runtime = new CodingAgentPluginHookRuntime({
			readAgentPlugins: () => config,
			readAgentMode: () => "coding",
			runOrchestrator: orchestrator,
			invokeHook: async (invocation) => {
				invocations.push(invocation.hookId);
				return { value: { action: "continue" }, effects: [] };
			},
		});
		const base = interceptionContext(context);

		const before = await runtime.before(base);
		config = { hookContributions: [hook("plugin-a", "new-after", "tool.after")] };
		await runtime.after({ ...base, result: { content: [] }, state: before?.state });

		expect(invocations).toEqual(["old-before", "old-after"]);
	});
});

function hook(
	pluginId: string,
	id: string,
	point: AgentPluginHookContribution["point"],
	overrides: Partial<AgentPluginHookContribution> = {},
): AgentPluginHookContribution {
	return {
		pluginId,
		id,
		point,
		handlerId: `${id}-handler`,
		scope_use: ["cli"],
		agent_mode: ["coding"],
		...overrides,
	};
}

function createOrchestrator(readAgentPlugins: () => AgentPluginRuntimeConfig | undefined) {
	return new CodingAgentPluginRunOrchestrator({
		session: { id: "session-1", cwd: "C:\\workspace", scenario: "cli" },
		readAgentPlugins,
	});
}

function compositionContext(): ModelCallFrameCompositionContext {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		signal: new AbortController().signal,
		messages: [{ role: "user", content: "inspect", timestamp: 1 }],
		modelBinding: { model: MODEL },
		frame: { instructions: [], tools: new Map([["read", TOOL]]) },
	};
}

function composeOrchestrator(
	orchestrator: CodingAgentPluginRunOrchestrator,
	context: ModelCallFrameCompositionContext,
) {
	return orchestrator.compose({
		context,
		availableTools: context.frame.tools,
		createDraft: (activeToolNames) =>
			buildSystemPromptDraft({
				customPrompt: "Base",
				cwd: "C:\\workspace",
				selectedTools: [...activeToolNames],
				scenario: "cli",
			}),
	});
}

function interceptionContext(frameContext: ModelCallFrameCompositionContext) {
	return {
		tool: TOOL,
		frameContext,
		input: { value: "initial" },
		request: {
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "call-1",
			input: { value: "initial" },
			messages: frameContext.messages,
			signal: new AbortController().signal,
		},
	};
}

const TOOL: RuntimeToolDefinition = {
	name: "read",
	label: "Read",
	description: "Read",
	inputSchema: { type: "object" },
	execute: async () => ({ content: [] }),
};

const MODEL: Model<Api> = {
	id: "model-1",
	name: "Model",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://example.com",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4_096,
};
