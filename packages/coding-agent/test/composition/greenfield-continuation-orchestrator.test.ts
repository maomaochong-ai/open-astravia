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
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodingAgentTodoRuntime } from "../../src/adapters/runtime-core/greenfield-todo-runtime.js";
import {
	createCodingAgentRuntimeComposition as createGreenfieldRuntimeComposition,
	type CodingAgentRuntimeComposition as GreenfieldRuntimeComposition,
} from "../../src/composition/index.js";
import {
	type EcosystemHookEvent,
	emptyHookDispatchOutcome,
	type HookDispatchOutcome,
} from "../../src/public-api/hooks.js";
import type {
	CodingAgentPluginRuntimeSource,
	CodingAgentRuntimeModelSource,
} from "../../src/public-api/host-services.js";

describe("Greenfield continuation orchestration", () => {
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

	it("runs Todo, Plugin and Stop Hook continuations in legacy order", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "greenfield-continuation-"));
		temporaryDirectories.push(conversationDir);
		const todoRuntime = new CodingAgentTodoRuntime();
		const pluginInvocations: string[] = [];
		const stopInvocations: Array<string | null> = [];
		const modelCalls: Array<readonly Message[]> = [];
		const pluginRuntime: CodingAgentPluginRuntimeSource = {
			readAgentPlugins: () => ({
				continuationContributions: [
					{
						pluginId: "plugin-a",
						id: "continue",
						handlerId: "continue-handler",
						context: { conversation: "messages" },
					},
				],
			}),
			invokeContinuation: async (invocation) => {
				pluginInvocations.push(`${invocation.pluginId}:${invocation.providerId}`);
				return {
					value: { text: "plugin continuation", idempotencyKey: "once" },
					effects: [],
				};
			},
		};
		let stopCount = 0;
		const stopHook = vi.fn(async (lastAssistantMessage: string | null) => {
			stopInvocations.push(lastAssistantMessage);
			stopCount += 1;
			return stopCount === 1 ? ["stop hook continuation"] : [];
		});
		const responses = [
			assistantMessage("initial response"),
			assistantMessage("todo response"),
			assistantMessage("plugin response"),
			assistantMessage("hook response"),
		];
		let responseIndex = 0;
		const composition = await createGreenfieldRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			activation: { mode: "explicit", toolNames: [] },
			resolveSystemPromptOptions: () => ({
				customPrompt: "Base prompt",
				scenario: "cli",
			}),
			createPluginRuntime: () => pluginRuntime,
			createTodoRuntime: () => todoRuntime,
			additionalHookAdapterFactories: [
				async () => ({
					id: "test-stop-hook",
					supports: (event) => event.eventName === "Stop",
					dispatch: async (event) => stopHookOutcome(event, stopHook),
				}),
			],
			streamFn: (_model, context) => {
				modelCalls.push([...context.messages]);
				if (responseIndex === 1) {
					todoRuntime.update(1, "done");
				}
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});
		compositions.push(composition);
		const session = await composition.backend.create({
			sessionId: "continuation-session",
			cwd: "C:\\workspace",
		});
		todoRuntime.createMany(["Finish implementation"]);
		await todoRuntime.flush();

		await session.prompt({ text: "start" });

		expect(modelCalls).toHaveLength(4);
		const userTexts = (await session.getMessages())
			.filter((message): message is Extract<Message, { role: "user" }> => message.role === "user")
			.map(messageText);
		expect(userTexts).toHaveLength(4);
		expect(userTexts[0]).toBe("start");
		expect(userTexts[1]).toContain("[ephemeral:todo]");
		expect(userTexts[1]).toContain("#1 Finish implementation");
		expect(userTexts[2]).toBe("plugin continuation");
		expect(userTexts[3]).toBe("stop hook continuation");
		expect(pluginInvocations).toEqual(["plugin-a:continue", "plugin-a:continue", "plugin-a:continue"]);
		expect(stopInvocations).toEqual(["plugin response", "hook response"]);
		expect((await session.getMessages()).map(({ role }) => role)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
			"user",
			"assistant",
			"user",
			"assistant",
		]);
		await session.dispose();
	});
});

async function stopHookOutcome(
	event: EcosystemHookEvent,
	stopHook: (message: string | null) => Promise<readonly string[]>,
): Promise<HookDispatchOutcome> {
	if (event.eventName !== "Stop") return emptyHookDispatchOutcome();
	const continuationFragments = await stopHook(event.lastAssistantMessage);
	return {
		...emptyHookDispatchOutcome(),
		shouldBlock: continuationFragments.length > 0,
		continuationFragments: [...continuationFragments],
	};
}

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

function successfulStopReason(message: AssistantMessage): "length" | "stop" | "toolUse" {
	if (message.stopReason === "length" || message.stopReason === "stop" || message.stopReason === "toolUse") {
		return message.stopReason;
	}
	throw new Error(`Recorded assistant message did not complete successfully: ${message.stopReason}`);
}

function messageText(message: Extract<Message, { role: "user" }>): string {
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
