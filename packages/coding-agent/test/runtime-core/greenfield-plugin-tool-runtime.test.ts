import type { Api, Message, Model } from "@vetta/ai";
import type {
	ModelCallFrameCompositionContext,
	RuntimeToolDefinition,
	RuntimeToolExecutionError,
} from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import { CodingAgentPluginRunOrchestrator } from "../../src/adapters/runtime-core/greenfield-plugin-run-orchestrator.js";
import {
	CodingAgentPluginToolRuntime,
	withMdIntroParameter,
} from "../../src/adapters/runtime-core/greenfield-plugin-tool-runtime.js";
import type {
	AgentPluginRuntimeConfig,
	AgentPluginToolContribution,
	AgentPluginToolInvocation,
} from "../../src/model-context/index.js";
import { buildSystemPromptDraft, renderSystemPromptDraft } from "../../src/model-context/index.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../src/tool-policy/model-tool-order.js";

describe("CodingAgentPluginToolRuntime", () => {
	it("compiles session-local tools with legacy activation, collision and policy precedence", () => {
		const config: AgentPluginRuntimeConfig = {
			toolContributions: [
				pluginTool("plugin-a", "read", { scope_use: ["cli"] }),
				pluginTool("plugin-a", "hidden", { scope_use: ["project"] }),
				pluginTool("plugin-a", "needs_capability", {
					scope_use: ["cli"],
					requires: ["knowledge"],
				}),
				pluginTool("plugin-a", "mcp_same", { scope_use: ["cli"] }),
				pluginTool("plugin-z", "read", { scope_use: ["cli"], description: "winning read" }),
			],
			toolPolicyContributions: [{ pluginId: "plugin-a", allow: ["hidden"], deny: ["denied"] }],
		};
		const orchestrator = createOrchestrator(() => config);
		const runtime = new CodingAgentPluginToolRuntime({
			readAgentPlugins: () => config,
			invokeTool: async () => ({ value: "ok", effects: [] }),
			runOrchestrator: orchestrator,
			resolveActivation: () => ({
				mode: "scope",
				scenario: "cli",
				capabilities: new Set(),
			}),
			shouldPreserveBaseTool: (name) => name === "mcp_same",
		});
		const read = tool("read", "base read");
		const mcp = tool("mcp_same", "mcp");
		const denied = tool("denied", "denied");
		const context = compositionContext(
			"turn-1",
			new Map([
				["read", read],
				["mcp_same", mcp],
				["denied", denied],
			]),
		);

		const surface = runtime.compose(context, context.frame.tools);

		expect([...surface.frame.tools.keys()]).toEqual(["read", "mcp_same", "hidden"]);
		expect(surface.frame.tools.get("read")?.description).toBe("winning read");
		expect(surface.frame.tools.get("mcp_same")).toBe(mcp);
		expect(surface.availableTools.get("denied")).toBe(denied);
		expect(surface.availableTools.get("hidden")?.name).toBe("hidden");
		expect(surface.availableTools.get("hidden")?.modelOrder).toBe(CODING_AGENT_MODEL_TOOL_ORDER.plugin);
		expect(surface.availableTools.has("needs_capability")).toBe(true);

		const otherConfig: AgentPluginRuntimeConfig = {
			toolContributions: [pluginTool("plugin-b", "other")],
		};
		const otherRuntime = new CodingAgentPluginToolRuntime({
			readAgentPlugins: () => otherConfig,
			invokeTool: async () => ({ value: "ok", effects: [] }),
			runOrchestrator: createOrchestrator(() => otherConfig, "session-2"),
			resolveActivation: () => ({ mode: "explicit", toolNames: ["other"] }),
		});
		const otherSurface = otherRuntime.compose(compositionContext("turn-2", new Map(), "session-2"), new Map());
		expect([...otherSurface.frame.tools.keys()]).toEqual(["other"]);
		expect(surface.availableTools.has("other")).toBe(false);
	});

	it("preserves invocation, md_intro, card formatting and same-turn effects", async () => {
		const contribution = pluginTool("plugin-a", "artifact", {
			scope_use: ["cli"],
			rendersCard: true,
			context: { conversation: "messages" },
			parameters: {
				type: "object",
				properties: { title: { type: "string" } },
				required: ["title"],
			},
		});
		const config: AgentPluginRuntimeConfig = { toolContributions: [contribution] };
		let invocation: AgentPluginToolInvocation | undefined;
		const orchestrator = createOrchestrator(() => config);
		const runtime = new CodingAgentPluginToolRuntime({
			readAgentPlugins: () => config,
			invokeTool: async (current) => {
				invocation = current;
				return {
					value: { text: "artifact ready", cards: [{ type: "artifact", id: "card-1" }] },
					effects: [
						{ type: "setToolEnabled", toolName: "read", enabled: false },
						{
							type: "addBlock",
							block: {
								id: "plugin.tool-effect",
								type: "plugin",
								source: { kind: "plugin" },
								content: "Tool effect instruction",
								priority: 700,
								enabled: true,
							},
						},
						{
							type: "requestContinuation",
							result: { text: "continue after tool", idempotencyKey: "tool-once" },
						},
					],
				};
			},
			runOrchestrator: orchestrator,
			resolveActivation: () => ({ mode: "scope", scenario: "cli" }),
			now: () => 99,
		});
		const read = tool("read");
		const baseContext = compositionContext("turn-1", new Map([["read", read]]));
		const surface = runtime.compose(baseContext, baseContext.frame.tools);
		const effectiveContext = { ...baseContext, frame: surface.frame };
		await composeOrchestrator(orchestrator, effectiveContext, surface.availableTools);
		const artifact = surface.frame.tools.get("artifact");
		expect(artifact?.inputSchema).toEqual(withMdIntroParameter(contribution.parameters));
		const messages = [userMessage("inspect"), assistantToolCall("artifact")];

		const result = await artifact?.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "call-1",
			input: { title: "Report", md_intro: "**Finding**" },
			messages,
			signal: new AbortController().signal,
		});

		expect(invocation?.input).toEqual({ title: "Report" });
		expect(invocation?.conversation.messages.map(({ role, text }) => ({ role, text }))).toEqual([
			{ role: "user", text: "inspect" },
			{ role: "assistant", text: "" },
		]);
		expect(invocation?.runtime).toEqual({
			activeToolNames: ["read", "artifact"],
			availableToolNames: ["read", "artifact"],
			runIndex: 1,
		});
		expect(invocation?.trigger).toEqual({ kind: "tool-call", timestamp: 99, toolCallId: "call-1" });
		expect(result).toEqual({
			content: [{ type: "text", text: "artifact ready" }],
			details: {
				pluginId: "plugin-a",
				toolId: "artifact-id",
				result: { text: "artifact ready" },
				cards: [{ type: "artifact", id: "card-1" }],
			},
		});

		const next = await composeOrchestrator(orchestrator, effectiveContext, surface.availableTools);
		expect([...next.tools.keys()]).toEqual(["artifact"]);
		expect(renderSystemPromptDraft(next.draft)).toContain("Tool effect instruction");
		await expect(
			orchestrator.collect({
				sessionId: "session-1",
				turnId: "turn-1",
				signal: new AbortController().signal,
				messages,
				modelBinding: { model: MODEL },
			}),
		).resolves.toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "continue after tool" }],
				timestamp: expect.any(Number),
			},
		]);
	});

	it("rejects a removed contribution, invalid handler result and timed-out invocation", async () => {
		let config: AgentPluginRuntimeConfig | undefined = {
			toolContributions: [pluginTool("plugin-a", "volatile", { scope_use: ["cli"] })],
		};
		const orchestrator = createOrchestrator(() => config);
		const invokeTool = vi.fn(async () => ({ value: "ok", effects: [] }));
		const runtime = new CodingAgentPluginToolRuntime({
			readAgentPlugins: () => config,
			invokeTool,
			runOrchestrator: orchestrator,
			resolveActivation: () => ({ mode: "scope", scenario: "cli" }),
		});
		const context = compositionContext("turn-1", new Map());
		const surface = runtime.compose(context, new Map());
		await composeOrchestrator(orchestrator, { ...context, frame: surface.frame }, surface.availableTools);
		const volatile = surface.frame.tools.get("volatile");
		config = undefined;

		const removed = volatile?.execute(toolRequest("turn-1"));
		await expect(removed).rejects.toMatchObject({
			name: "RuntimeToolExecutionError",
			details: { code: "plugin_tool_revoked", retryable: false },
		} satisfies Partial<RuntimeToolExecutionError>);
		expect(invokeTool).not.toHaveBeenCalled();

		const invalidConfig: AgentPluginRuntimeConfig = {
			toolContributions: [pluginTool("plugin-a", "invalid", { scope_use: ["cli"] })],
		};
		const invalidOrchestrator = createOrchestrator(() => invalidConfig);
		const invalidRuntime = new CodingAgentPluginToolRuntime({
			readAgentPlugins: () => invalidConfig,
			invokeTool: async () =>
				({
					value: "missing effects",
				}) as never,
			runOrchestrator: invalidOrchestrator,
			resolveActivation: () => ({ mode: "scope", scenario: "cli" }),
		});
		const invalidContext = compositionContext("turn-invalid", new Map());
		const invalidSurface = invalidRuntime.compose(invalidContext, new Map());
		await composeOrchestrator(
			invalidOrchestrator,
			{ ...invalidContext, frame: invalidSurface.frame },
			invalidSurface.availableTools,
		);
		await expect(invalidSurface.frame.tools.get("invalid")?.execute(toolRequest("turn-invalid"))).rejects.toThrow(
			"Plugin tool returned an invalid result",
		);

		const timeoutConfig: AgentPluginRuntimeConfig = {
			toolContributions: [
				pluginTool("plugin-a", "slow", {
					scope_use: ["cli"],
					timeoutMs: 5,
				}),
			],
		};
		const timeoutOrchestrator = createOrchestrator(() => timeoutConfig);
		const timeoutRuntime = new CodingAgentPluginToolRuntime({
			readAgentPlugins: () => timeoutConfig,
			invokeTool: () => new Promise(() => undefined),
			runOrchestrator: timeoutOrchestrator,
			resolveActivation: () => ({ mode: "scope", scenario: "cli" }),
		});
		const timeoutContext = compositionContext("turn-timeout", new Map());
		const timeoutSurface = timeoutRuntime.compose(timeoutContext, new Map());
		await composeOrchestrator(
			timeoutOrchestrator,
			{ ...timeoutContext, frame: timeoutSurface.frame },
			timeoutSurface.availableTools,
		);
		await expect(timeoutSurface.frame.tools.get("slow")?.execute(toolRequest("turn-timeout"))).rejects.toThrow(
			"Plugin tool timed out after 5ms",
		);
	});
});

function createOrchestrator(
	readAgentPlugins: () => AgentPluginRuntimeConfig | undefined,
	sessionId = "session-1",
): CodingAgentPluginRunOrchestrator {
	return new CodingAgentPluginRunOrchestrator({
		session: { id: sessionId, cwd: "C:\\workspace", scenario: "cli" },
		readAgentPlugins,
		now: () => 100,
	});
}

function compositionContext(
	turnId: string,
	tools: ReadonlyMap<string, RuntimeToolDefinition>,
	sessionId = "session-1",
): ModelCallFrameCompositionContext {
	return {
		sessionId,
		turnId,
		signal: new AbortController().signal,
		messages: [userMessage("inspect")],
		modelBinding: { model: MODEL },
		frame: { instructions: [], tools },
	};
}

function composeOrchestrator(
	orchestrator: CodingAgentPluginRunOrchestrator,
	context: ModelCallFrameCompositionContext,
	availableTools: ReadonlyMap<string, RuntimeToolDefinition>,
) {
	return orchestrator.compose({
		context,
		availableTools,
		createDraft: (activeToolNames) =>
			buildSystemPromptDraft({
				customPrompt: "Base prompt",
				cwd: "C:\\workspace",
				selectedTools: [...activeToolNames],
				scenario: "cli",
			}),
	});
}

function pluginTool(
	pluginId: string,
	name: string,
	overrides: Partial<AgentPluginToolContribution> = {},
): AgentPluginToolContribution {
	return {
		pluginId,
		id: `${name}-id`,
		name,
		description: `${name} plugin tool`,
		parameters: { type: "object", properties: {} },
		handlerId: `${name}-handler`,
		...overrides,
	};
}

function tool(name: string, description = `${name} tool`): RuntimeToolDefinition {
	return {
		name,
		label: name,
		description,
		inputSchema: { type: "object" },
		async execute() {
			return { content: [] };
		},
	};
}

function toolRequest(turnId: string) {
	return {
		sessionId: "session-1",
		turnId,
		toolCallId: "call-1",
		input: {},
		signal: new AbortController().signal,
	};
}

function userMessage(text: string): Extract<Message, { role: "user" }> {
	return { role: "user", content: text, timestamp: 1 };
}

function assistantToolCall(name: string): Extract<Message, { role: "assistant" }> {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id: "call-1", name, arguments: { title: "Report" } }],
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 2,
	};
}

const MODEL: Model<Api> = {
	id: "model",
	name: "Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
