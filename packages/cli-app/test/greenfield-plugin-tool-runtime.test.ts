import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
} from "@vetta/ai";
import {
	createCodingAgentRuntimeComposition as createGreenfieldRuntimeComposition,
	type CodingAgentRuntimeComposition as GreenfieldRuntimeComposition,
} from "@vetta/coding-agent/composition";
import { type EcosystemHookEvent, emptyHookDispatchOutcome } from "@vetta/coding-agent/hooks";
import type { CodingAgentPluginRuntimeSource, CodingAgentRuntimeModelSource } from "@vetta/coding-agent/host-services";
import { afterEach, describe, expect, it } from "vitest";

describe("Greenfield Plugin Tool runtime composition", () => {
	const temporaryDirectories: string[] = [];
	const compositions: GreenfieldRuntimeComposition[] = [];

	afterEach(async () => {
		for (const composition of compositions.splice(0).reverse()) {
			await composition.dispose();
		}
		for (const directory of temporaryDirectories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("executes a plugin tool and replays its effects through later calls in the same turn", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "greenfield-plugin-tool-"));
		temporaryDirectories.push(conversationDir);
		const invocations: Parameters<NonNullable<CodingAgentPluginRuntimeSource["invokeTool"]>>[0][] = [];
		const modelCalls: Array<{
			readonly prompt: string | undefined;
			readonly messages: readonly Message[];
			readonly tools: readonly string[];
		}> = [];
		const hookEvents: EcosystemHookEvent[] = [];
		const pluginRuntime: CodingAgentPluginRuntimeSource = {
			readAgentPlugins: () => ({
				toolContributions: [
					{
						pluginId: "plugin-a",
						id: "artifact-id",
						name: "plugin_artifact",
						label: "Artifact",
						description: "Create an artifact",
						parameters: {
							type: "object",
							properties: { title: { type: "string" } },
							required: ["title"],
						},
						handlerId: "artifact-handler",
						context: { conversation: "messages" },
						rendersCard: true,
					},
				],
			}),
			invokeTool: async (invocation) => {
				invocations.push(invocation);
				return {
					value: {
						text: "artifact created",
						cards: [{ type: "artifact", id: "card-1" }],
					},
					effects: [
						{ type: "setToolEnabled", toolName: "read", enabled: false },
						{
							type: "addBlock",
							block: {
								id: "plugin.tool-result",
								type: "plugin",
								source: { kind: "plugin" },
								content: "Artifact tool completed",
								priority: 700,
								enabled: true,
							},
						},
						{
							type: "requestContinuation",
							result: { text: "verify artifact", idempotencyKey: "verify-once" },
						},
					],
				};
			},
		};
		const responses = [
			assistantToolCall("plugin_artifact", {
				title: "Report",
				md_intro: "**Finding**",
			}),
			assistantText("artifact response"),
			assistantText("verification response"),
		];
		let responseIndex = 0;
		const composition = await createGreenfieldRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			activation: { mode: "explicit", toolNames: ["read", "plugin_artifact"] },
			enableSubagents: false,
			resolveSystemPromptOptions: () => ({
				customPrompt: "Base prompt",
				scenario: "cli",
			}),
			createPluginRuntime: () => pluginRuntime,
			additionalHookAdapterFactories: [
				async () => ({
					id: "plugin-tool-test-hook",
					supports: (event) => event.eventName === "PreToolUse" || event.eventName === "PostToolUse",
					async dispatch(event) {
						hookEvents.push(event);
						return emptyHookDispatchOutcome();
					},
				}),
			],
			streamFn: (_model, context) => {
				modelCalls.push({
					prompt: context.systemPrompt,
					messages: [...context.messages],
					tools: (context.tools ?? []).map(({ name }) => name),
				});
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});
		compositions.push(composition);
		const session = await composition.backend.create({
			sessionId: "plugin-tool-session",
			cwd: "C:\\workspace",
		});

		await session.prompt({ text: "create report" });

		expect(invocations).toHaveLength(1);
		expect(invocations[0]?.input).toEqual({ title: "Report" });
		expect(invocations[0]?.conversation.messages.map(({ role }) => role)).toEqual(["user", "assistant"]);
		expect(modelCalls).toHaveLength(3);
		expect(modelCalls[0]?.tools).toEqual(["read", "plugin_artifact"]);
		expect(modelCalls[1]?.tools).toEqual(["plugin_artifact"]);
		expect(modelCalls[1]?.prompt).toContain("Artifact tool completed");
		expect(modelCalls[2]?.messages.map(messageText)).toContain("verify artifact");
		expect(session.readState().activeToolNames).toEqual(["plugin_artifact"]);
		expect(
			hookEvents.map((event) => ({
				eventName: event.eventName,
				toolName:
					event.eventName === "PreToolUse" || event.eventName === "PostToolUse" ? event.tool.hostName : undefined,
			})),
		).toEqual([
			{ eventName: "PreToolUse", toolName: "plugin_artifact" },
			{ eventName: "PostToolUse", toolName: "plugin_artifact" },
		]);

		const messages = await session.getMessages();
		const toolResult = messages.find((message) => message.role === "toolResult");
		expect(toolResult).toMatchObject({
			role: "toolResult",
			content: [{ type: "text", text: "artifact created" }],
			details: {
				pluginId: "plugin-a",
				toolId: "artifact-id",
				result: { text: "artifact created" },
				cards: [{ type: "artifact", id: "card-1" }],
			},
		});
		expect(messages.map(({ role }) => role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
			"user",
			"assistant",
		]);
		await session.dispose();
	});
});

class RecordedAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor(message: AssistantMessage) {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected assistant event");
			},
		);
		queueMicrotask(() => {
			this.push({ type: "done", reason: successfulStopReason(message), message });
		});
	}
}

function successfulStopReason(message: AssistantMessage): "length" | "stop" | "toolUse" {
	if (message.stopReason === "length" || message.stopReason === "stop" || message.stopReason === "toolUse") {
		return message.stopReason;
	}
	throw new Error(`Recorded assistant message did not complete successfully: ${message.stopReason}`);
}

function modelRegistry(): CodingAgentRuntimeModelSource {
	return {
		refresh() {},
		getAvailable: () => [MODEL],
		find: (provider, modelId) => (provider === MODEL.provider && modelId === MODEL.id ? MODEL : undefined),
		getApiKey: async () => "test-key",
		setServerToken() {},
		loadRemoteModels: async () => undefined,
	};
}

function assistantToolCall(name: string, args: Readonly<Record<string, unknown>>): AssistantMessage {
	return assistantMessage([{ type: "toolCall", id: "call-1", name, arguments: args }], "toolUse");
}

function assistantText(text: string): AssistantMessage {
	return assistantMessage([{ type: "text", text }], "stop");
}

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
	return {
		role: "assistant",
		content,
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
		stopReason,
		timestamp: 2,
	};
}

function messageText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((item): item is Extract<(typeof message.content)[number], { type: "text" }> => item.type === "text")
		.map(({ text }) => text)
		.join("");
}

const MODEL: Model<Api> = {
	id: "recorded-model",
	name: "Recorded Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
