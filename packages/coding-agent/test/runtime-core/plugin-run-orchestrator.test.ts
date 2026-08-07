import type { Api, Message, Model } from "@vetta/ai";
import type { ModelCallFrameCompositionContext, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import {
	type AgentPluginRuntimeConfig,
	type AgentPluginRuntimeEffect,
	buildSystemPromptDraft,
	renderSystemPromptDraft,
} from "../../src/model-context/index.js";
import {
	type CodingAgentPluginProviderFailure,
	CodingAgentPluginRunOrchestrator,
} from "../../src/plugins/runtime/run-orchestrator.js";

describe("CodingAgentPluginRunOrchestrator", () => {
	it("orders providers, applies prompt/tool effects once per turn and queues requested continuations", async () => {
		const providerCalls: string[] = [];
		const failures: CodingAgentPluginProviderFailure[] = [];
		const config: AgentPluginRuntimeConfig = {
			systemPromptProviderContributions: [
				{
					pluginId: "plugin-z",
					id: "provider-z",
					handlerId: "handler-z",
					context: { systemPrompt: "full" },
				},
				{
					pluginId: "plugin-a",
					id: "provider-a",
					handlerId: "handler-a",
					context: { conversation: "messages", systemPrompt: "blocks" },
				},
			],
		};
		const orchestrator = new CodingAgentPluginRunOrchestrator({
			session: { id: "session-1", cwd: "C:\\workspace", scenario: "cli" },
			readAgentPlugins: () => config,
			now: () => 42,
			maxContinuationsPerTurn: 1,
			onProviderFailure: (failure) => failures.push(failure),
			invokeSystemPrompt: async (invocation) => {
				providerCalls.push(`${invocation.pluginId}/${invocation.providerId}`);
				if (invocation.pluginId === "plugin-a") {
					expect(invocation.conversation.messages.map(({ text }) => text)).toEqual(["inspect"]);
					expect(invocation.systemPrompt?.base.blocks).toBeDefined();
					return [
						{ type: "setToolEnabled", toolName: "write", enabled: true },
						{
							type: "addBlock",
							block: pluginBlock("plugin.dynamic-a", "Dynamic A", 700),
						},
						{
							type: "requestContinuation",
							result: { text: " continue from plugin ", idempotencyKey: "continue-1" },
						},
					];
				}
				expect(invocation.runtime.activeToolNames).toEqual(["read", "write"]);
				expect(invocation.systemPrompt?.current.rendered).toContain("Dynamic A");
				return [
					{
						type: "addBlock",
						block: pluginBlock("plugin.dynamic-z", "Dynamic Z", 710),
					},
				];
			},
		});
		const input = compositionInput("turn-1");

		const first = await orchestrator.compose(input);
		const second = await orchestrator.compose({
			...input,
			context: {
				...input.context,
				messages: [...input.context.messages, assistantMessage("intermediate"), toolResultMessage("write")],
			},
		});

		expect(providerCalls).toEqual(["plugin-a/provider-a", "plugin-z/provider-z"]);
		expect([...first.tools.keys()]).toEqual(["read", "write"]);
		expect(renderSystemPromptDraft(first.draft)).toContain("Dynamic A");
		expect(renderSystemPromptDraft(second.draft)).toContain("Dynamic Z");
		expect(failures).toEqual([]);
		expect(
			await orchestrator.collect(continuationContext("turn-1", [userMessage("inspect"), assistantMessage("done")])),
		).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "continue from plugin" }],
				timestamp: 42,
			},
		]);
		expect(
			await orchestrator.collect(
				continuationContext("turn-1", [
					userMessage("inspect"),
					assistantMessage("done"),
					userMessage("continue from plugin"),
					assistantMessage("continued"),
				]),
			),
		).toEqual([]);
	});

	it("isolates invalid provider output and applies continuation effects on the next turn", async () => {
		const failures: CodingAgentPluginProviderFailure[] = [];
		const continuationCalls: string[] = [];
		const config: AgentPluginRuntimeConfig = {
			continuationContributions: [
				{ pluginId: "plugin-a", id: "bad", handlerId: "bad-handler" },
				{ pluginId: "plugin-b", id: "good", handlerId: "good-handler" },
			],
		};
		const orchestrator = new CodingAgentPluginRunOrchestrator({
			session: { id: "session-1", cwd: "C:\\workspace", scenario: "cli" },
			readAgentPlugins: () => config,
			now: () => 77,
			onProviderFailure: (failure) => failures.push(failure),
			invokeContinuation: async (invocation) => {
				continuationCalls.push(`${invocation.pluginId}/${invocation.providerId}`);
				if (invocation.providerId === "bad") {
					return {
						value: { text: 1 },
						effects: [],
					} as unknown as {
						value: null;
						effects: AgentPluginRuntimeEffect[];
					};
				}
				return {
					value: { text: "valid continuation", idempotencyKey: "same" },
					effects: [
						{
							type: "addBlock",
							block: pluginBlock("plugin.next-turn", "Next turn effect", 720),
						},
					],
				};
			},
		});
		await orchestrator.compose(compositionInput("turn-1"));

		const continuation = await orchestrator.collect(
			continuationContext("turn-1", [userMessage("inspect"), assistantMessage("done")]),
		);
		const duplicate = await orchestrator.collect(
			continuationContext("turn-1", [
				userMessage("inspect"),
				assistantMessage("done"),
				...continuation,
				assistantMessage("continued"),
			]),
		);
		const nextTurn = await orchestrator.compose(compositionInput("turn-2"));

		expect(continuation.map(({ content }) => content)).toEqual([[{ type: "text", text: "valid continuation" }]]);
		expect(duplicate).toEqual([]);
		expect(continuationCalls).toEqual(["plugin-a/bad", "plugin-b/good", "plugin-a/bad", "plugin-b/good"]);
		expect(failures).toHaveLength(2);
		expect(failures.every(({ kind, providerId }) => kind === "continuation" && providerId === "bad")).toBe(true);
		expect(renderSystemPromptDraft(nextTurn.draft)).toContain("Next turn effect");
	});
});

function compositionInput(turnId: string): {
	readonly context: ModelCallFrameCompositionContext;
	readonly availableTools: ReadonlyMap<string, RuntimeToolDefinition>;
	readonly createDraft: (activeToolNames: readonly string[]) => ReturnType<typeof buildSystemPromptDraft>;
} {
	const read = tool("read");
	const write = tool("write");
	return {
		context: {
			sessionId: "session-1",
			turnId,
			signal: new AbortController().signal,
			messages: [userMessage("inspect")],
			modelBinding: { model: MODEL },
			frame: {
				instructions: [],
				tools: new Map([["read", read]]),
			},
		},
		availableTools: new Map([
			["read", read],
			["write", write],
		]),
		createDraft: (activeToolNames) =>
			buildSystemPromptDraft({
				customPrompt: "Base prompt",
				cwd: "C:\\workspace",
				selectedTools: [...activeToolNames],
				scenario: "cli",
			}),
	};
}

function continuationContext(turnId: string, messages: readonly Message[]) {
	return {
		sessionId: "session-1",
		turnId,
		signal: new AbortController().signal,
		messages,
		modelBinding: { model: MODEL },
	};
}

function pluginBlock(id: string, content: string, priority: number) {
	return {
		id,
		type: "plugin" as const,
		source: { kind: "plugin" as const },
		content,
		priority,
		enabled: true,
	};
}

function tool(name: string): RuntimeToolDefinition {
	return {
		name,
		label: name,
		description: `${name} tool`,
		inputSchema: { type: "object" },
		async execute() {
			return { content: [] };
		},
	};
}

function userMessage(text: string): Message {
	return { role: "user", content: text, timestamp: 1 };
}

function assistantMessage(text: string): Extract<Message, { role: "assistant" }> {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
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
		stopReason: "stop",
		timestamp: 2,
	};
}

function toolResultMessage(toolName: string): Extract<Message, { role: "toolResult" }> {
	return {
		role: "toolResult",
		toolCallId: "call-1",
		toolName,
		content: [{ type: "text", text: "result" }],
		isError: false,
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
