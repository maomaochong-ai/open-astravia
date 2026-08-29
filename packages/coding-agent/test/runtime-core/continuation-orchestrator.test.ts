import type { Api, Message, Model, UserMessage } from "@vetta/ai";
import type { ContinuationPolicyContext } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import { CodingAgentContinuationOrchestrator } from "../../src/composition/turn/continuation-orchestrator.js";
import { CodingAgentLengthContinuationSource } from "../../src/composition/turn/length-continuation-source.js";
import { CodingAgentStopHookContinuationSource } from "../../src/extensions/runtime/stop-hook-continuation-source.js";
import type { TodoItem } from "../../src/features/todo/index.js";
import { CodingAgentTodoContinuationSource } from "../../src/features/todo/todo-continuation-source.js";

describe("CodingAgentContinuationOrchestrator", () => {
	it("selects Todo, Plugin and Stop Hook in the established priority order", async () => {
		let todoMessages: readonly UserMessage[] = [userMessage("todo")];
		let pluginMessages: readonly UserMessage[] = [userMessage("plugin")];
		const todo = source("todo", 100, () => todoMessages);
		const plugin = source("plugin", 200, () => pluginMessages);
		const stopHook = source("stop-hook", 300, () => [userMessage("stop")]);
		const orchestrator = new CodingAgentContinuationOrchestrator({
			sources: [stopHook, plugin, todo],
		});
		const context = continuationContext("turn-1");

		await expect(orchestrator.collect(context)).resolves.toEqual([{ message: userMessage("todo"), source: "todo" }]);
		expect(todo.collect).toHaveBeenCalledOnce();
		expect(plugin.collect).not.toHaveBeenCalled();
		expect(stopHook.collect).not.toHaveBeenCalled();

		todoMessages = [];
		await expect(orchestrator.collect(context)).resolves.toEqual([
			{ message: userMessage("plugin"), source: "plugin" },
		]);
		expect(plugin.collect).toHaveBeenCalledOnce();
		expect(stopHook.collect).not.toHaveBeenCalled();

		pluginMessages = [];
		await expect(orchestrator.collect(context)).resolves.toEqual([
			{ message: userMessage("stop"), source: "stop-hook" },
		]);
		expect(stopHook.collect).toHaveBeenCalledOnce();
	});

	it("does not call a source after cancellation and does not swallow source failures", async () => {
		const todo = source("todo", 100, () => {
			throw new Error("todo state failed");
		});
		const stopHook = source("stop-hook", 300, () => [userMessage("stop")]);
		const orchestrator = new CodingAgentContinuationOrchestrator({ sources: [todo, stopHook] });

		await expect(orchestrator.collect(continuationContext("turn-1"))).rejects.toThrow("todo state failed");
		expect(stopHook.collect).not.toHaveBeenCalled();

		const controller = new AbortController();
		controller.abort();
		await expect(orchestrator.collect(continuationContext("turn-2", [], controller.signal))).resolves.toEqual([]);
		expect(todo.collect).toHaveBeenCalledOnce();
	});
});

describe("CodingAgentTodoContinuationSource", () => {
	it("never nudges an unlocked list", async () => {
		const items: TodoItem[] = [{ id: 1, content: "Implement", status: "pending" }];
		const source = new CodingAgentTodoContinuationSource({
			state: { getAll: () => items, isLocked: () => false },
			now: () => 42,
		});

		await expect(source.collect(continuationContext("turn-1"))).resolves.toEqual([]);
		await expect(source.collect(continuationContext("turn-2"))).resolves.toEqual([]);
	});

	it("keeps locked lists running until every item is done", async () => {
		const lockedItems: TodoItem[] = [{ id: 1, content: "Locked work", status: "in_progress" }];
		const locked = new CodingAgentTodoContinuationSource({
			state: {
				getAll: () => lockedItems,
				isLocked: () => true,
			},
			now: () => 1,
		});

		const first = await locked.collect(continuationContext("turn-1"));
		expect(messageText(first[0])).toContain("[ephemeral:todo]");
		expect(messageText(first[0])).toContain("#1 Locked work");
		expect(first[0]?.timestamp).toBe(1);
		expect(await locked.collect(continuationContext("turn-1"))).toEqual(first);

		lockedItems[0] = { ...lockedItems[0], status: "done" };
		await expect(locked.collect(continuationContext("turn-1"))).resolves.toEqual([]);
	});
});

describe("CodingAgentLengthContinuationSource", () => {
	it("continues a length-truncated turn and stops after the configured limit", async () => {
		const source = new CodingAgentLengthContinuationSource({ now: () => 77, maxAttempts: 2 });
		const context = continuationContext("turn-1", [assistantMessage("partial", "length")]);

		const first = await source.collect(context);
		expect(messageText(first[0])).toContain("Continue the response from where you stopped");
		expect(first[0]?.timestamp).toBe(77);
		expect(await source.collect(context)).toEqual(first);
		await expect(source.collect(context)).rejects.toThrow(
			"Model response remained truncated after 2 automatic continuation attempts",
		);

		expect(await source.collect(continuationContext("turn-2", [assistantMessage("partial", "length")]))).toEqual(
			first,
		);
	});

	it("does not continue a normal stop or an aborted turn", async () => {
		const source = new CodingAgentLengthContinuationSource();
		expect(await source.collect(continuationContext("turn-1", [assistantMessage("done")]))).toEqual([]);

		const controller = new AbortController();
		controller.abort();
		expect(
			await source.collect(
				continuationContext("turn-2", [assistantMessage("partial", "length")], controller.signal),
			),
		).toEqual([]);
	});
});

describe("CodingAgentStopHookContinuationSource", () => {
	it("passes the latest assistant text and preserves all returned fragments", async () => {
		const invocations: Array<{ readonly text: string | null; readonly signal: AbortSignal }> = [];
		const source = new CodingAgentStopHookContinuationSource({
			now: () => 77,
			hookRuntime: {
				runStop: async (text, signal) => {
					invocations.push({ text, signal: signal ?? new AbortController().signal });
					return ["first fragment", "second fragment"];
				},
			},
		});
		const context = continuationContext("turn-1", [
			userMessage("inspect"),
			assistantMessage("first answer"),
			assistantMessage("latest answer"),
		]);

		await expect(source.collect(context)).resolves.toEqual([
			userMessage("first fragment", 77),
			userMessage("second fragment", 77),
		]);
		expect(invocations).toEqual([{ text: "latest answer", signal: context.signal }]);
	});
});

function source(
	id: string,
	priority: number,
	collect: (context: ContinuationPolicyContext) => readonly UserMessage[] | Promise<readonly UserMessage[]>,
) {
	const mock = vi.fn(async (context: ContinuationPolicyContext): Promise<readonly UserMessage[]> => collect(context));
	return { id, priority, collect: mock };
}

function continuationContext(
	turnId: string,
	messages: readonly Message[] = [],
	signal: AbortSignal = new AbortController().signal,
): ContinuationPolicyContext {
	return {
		sessionId: "session-1",
		turnId,
		signal,
		messages,
		modelBinding: { model: MODEL },
	};
}

function userMessage(text: string, timestamp = 1): UserMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp };
}

function assistantMessage(
	text: string,
	stopReason: Extract<Message, { role: "assistant" }>["stopReason"] = "stop",
): Extract<Message, { role: "assistant" }> {
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
		stopReason,
		timestamp: 2,
	};
}

function messageText(message: UserMessage | undefined): string {
	if (!message) return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((item): item is Extract<(typeof message.content)[number], { type: "text" }> => item.type === "text")
		.map(({ text }) => text)
		.join("");
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
