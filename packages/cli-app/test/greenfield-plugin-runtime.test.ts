import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, type AssistantMessage, type AssistantMessageEvent, EventStream, type Model } from "@vetta/ai";
import {
	type CodingAgentRuntimeComposition,
	createCodingAgentRuntimeComposition,
} from "@vetta/coding-agent/composition";
import type { CodingAgentPluginRuntimeSource, CodingAgentRuntimeModelSource } from "@vetta/coding-agent/host-services";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Greenfield Plugin runtime composition", () => {
	const temporaryDirectories: string[] = [];
	const compositions: CodingAgentRuntimeComposition[] = [];

	afterEach(async () => {
		for (const composition of compositions.splice(0).reverse()) {
			await composition.dispose();
		}
		for (const directory of temporaryDirectories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("runs dynamic prompt effects, tool selection and continuation through one session orchestrator", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "greenfield-plugin-runtime-"));
		temporaryDirectories.push(conversationDir);
		const providerCalls: string[] = [];
		const modelCalls: Array<{
			readonly prompt: string | undefined;
			readonly messages: readonly string[];
			readonly tools: readonly string[];
		}> = [];
		const createPluginRuntime = vi.fn(
			(): CodingAgentPluginRuntimeSource => ({
				readAgentPlugins: () => ({
					systemPromptProviderContributions: [
						{
							pluginId: "plugin-a",
							id: "dynamic-prompt",
							handlerId: "dynamic-prompt-handler",
							context: { conversation: "messages", systemPrompt: "rendered" },
						},
					],
				}),
				invokeSystemPrompt: async (invocation) => {
					providerCalls.push(`${invocation.session.id}:${invocation.runtime.runIndex}`);
					expect(invocation.conversation.messages.map(({ text }) => text)).toEqual(["inspect"]);
					return [
						{ type: "setToolEnabled", toolName: "current_time", enabled: true },
						{
							type: "addBlock",
							block: {
								id: "plugin.dynamic",
								type: "plugin",
								source: { kind: "plugin" },
								content: "Dynamic plugin instruction",
								priority: 700,
								enabled: true,
							},
						},
						{
							type: "requestContinuation",
							result: { text: "plugin continuation", idempotencyKey: "once" },
						},
					];
				},
			}),
		);
		const responses = [assistantMessage("first response"), assistantMessage("continued response")];
		let responseIndex = 0;
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			activation: { mode: "explicit", toolNames: ["read"] },
			enableSubagents: false,
			resolveSystemPromptOptions: () => ({
				customPrompt: "Base prompt",
				scenario: "cli",
			}),
			createPluginRuntime,
			streamFn: (_model, context) => {
				modelCalls.push({
					prompt: context.systemPrompt,
					messages: context.messages.map(messageText),
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
			sessionId: "plugin-session",
			cwd: "C:\\workspace",
		});

		await session.prompt({ text: "inspect" });

		expect(createPluginRuntime).toHaveBeenCalledOnce();
		expect(providerCalls).toEqual(["plugin-session:0"]);
		expect(modelCalls).toHaveLength(2);
		expect(modelCalls[0]?.prompt).toContain("Dynamic plugin instruction");
		expect(modelCalls[0]?.tools).toEqual(["read", "current_time"]);
		expect(modelCalls[1]?.messages).toEqual(["inspect", "first response", "plugin continuation"]);
		expect(modelCalls[1]?.tools).toEqual(["read", "current_time"]);
		expect(session.readState().activeToolNames).toEqual(["read", "current_time"]);
		expect((await session.getMessages()).map(({ role }) => role)).toEqual(["user", "assistant", "user", "assistant"]);
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
			this.push({ type: "done", reason: "stop", message });
		});
	}
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

function assistantMessage(text: string): AssistantMessage {
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

function messageText(message: { readonly content: unknown }): string {
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.filter(
			(item): item is { readonly type: "text"; readonly text: string } =>
				typeof item === "object" &&
				item !== null &&
				"type" in item &&
				item.type === "text" &&
				"text" in item &&
				typeof item.text === "string",
		)
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
