import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, type AssistantMessage, type AssistantMessageEvent, EventStream, type Model } from "@vetta/ai";
import {
	type CodingAgentRuntimeComposition,
	createCodingAgentRuntimeComposition,
} from "@vetta/coding-agent/composition";
import type { CodingAgentRuntimeModelSource } from "@vetta/coding-agent/host-services";
import type { RuntimeSession, RuntimeSessionTodoController } from "@vetta/runtime-core";
import { afterEach, describe, expect, it } from "vitest";

describe("Todo Runtime composition contract", () => {
	const directories: string[] = [];
	const compositions: CodingAgentRuntimeComposition[] = [];

	afterEach(async () => {
		for (const composition of compositions.splice(0).reverse()) {
			await composition.dispose();
		}
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("executes Todo through the model loop and restores the same state after resume", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "runtime-todo-"));
		directories.push(conversationDir);
		const toolLists: string[][] = [];
		const responses = [
			assistantMessage(
				[
					{
						type: "toolCall",
						id: "todo-create",
						name: "todo",
						arguments: {
							description: "Create the plan",
							action: "create",
							items: ["Implement the slice"],
						},
					},
				],
				"toolUse",
			),
			assistantMessage(
				[
					{
						type: "toolCall",
						id: "todo-done",
						name: "todo",
						arguments: {
							description: "Complete the plan",
							action: "update",
							id: 1,
							status: "done",
						},
					},
				],
				"toolUse",
			),
			assistantMessage([{ type: "text", text: "complete" }]),
		];
		let responseIndex = 0;
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: ["todo"] },
			resolveSystemPromptOptions: () => ({ customPrompt: "Base prompt", scenario: "cli" }),
			streamFn: (_model, context) => {
				toolLists.push((context.tools ?? []).map(({ name }) => name));
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});
		compositions.push(composition);

		const session = await composition.backend.create({ sessionId: "todo-session" });
		const result = await session.prompt({ text: "implement" });

		if (result.status === "failed") {
			throw new Error(`${result.error.code}: ${result.error.message}`);
		}
		expect(result).toMatchObject({ status: "completed" });
		expect(toolLists).toEqual([["todo"], ["todo"], ["todo"]]);
		expect(requireTodoController(session).readItems()).toEqual([
			{ id: 1, content: "Implement the slice", status: "done" },
		]);
		expect((await session.getMessages()).map(({ role }) => role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
			"toolResult",
			"assistant",
		]);
		await session.dispose();

		const resumed = await composition.backend.resume({ sessionId: "todo-session" });
		const resumedTodoController = requireTodoController(resumed);
		expect(resumedTodoController.readItems()).toEqual([{ id: 1, content: "Implement the slice", status: "done" }]);
		expect(resumedTodoController.clear()).toBe(true);
		await resumed.dispose();

		const cleared = await composition.backend.resume({ sessionId: "todo-session" });
		expect(requireTodoController(cleared).readItems()).toEqual([]);
		await cleared.dispose();
	});

	it("persists prefilled scene-locked todos before the first turn", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "runtime-prefilled-todo-"));
		directories.push(conversationDir);
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			enableSubagents: false,
			resolveSystemPromptOptions: () => ({ customPrompt: "Base prompt", scenario: "kb-processing" }),
		});
		compositions.push(composition);

		const session = await composition.backend.create({
			sessionId: "prefilled-todo-session",
			initialTodos: ["first", "second"],
			initialTodoLockSource: "scene",
		});
		expect(requireTodoController(session).readItems()).toEqual([
			{ id: 1, content: "first", status: "pending" },
			{ id: 2, content: "second", status: "pending" },
		]);
		expect(requireTodoController(session).clear()).toBe(false);
		await session.dispose();

		const resumed = await composition.backend.resume({ sessionId: "prefilled-todo-session" });
		expect(requireTodoController(resumed).readItems()).toEqual([
			{ id: 1, content: "first", status: "pending" },
			{ id: 2, content: "second", status: "pending" },
		]);
		expect(requireTodoController(resumed).clear()).toBe(false);
		await resumed.dispose();
	});
});

function requireTodoController(session: RuntimeSession): RuntimeSessionTodoController {
	const controller = session.createCoreAssembly().todoController;
	if (!controller) throw new Error("Todo Controller was not composed");
	return controller;
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

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
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

function successfulStopReason(message: AssistantMessage): "length" | "stop" | "toolUse" {
	if (message.stopReason === "length" || message.stopReason === "stop" || message.stopReason === "toolUse") {
		return message.stopReason;
	}
	throw new Error(`Recorded assistant message did not complete successfully: ${message.stopReason}`);
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
