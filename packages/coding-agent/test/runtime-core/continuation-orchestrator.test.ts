import type { Api, Message, Model, UserMessage } from "@vetta/ai";
import type { ContinuationPolicyContext } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import {
	CodingAgentContinuationOrchestrator,
	type CodingAgentContinuationSource,
} from "../../src/composition/turn/continuation-orchestrator.js";
import { CodingAgentStopHookContinuationSource } from "../../src/extensions/runtime/stop-hook-continuation-source.js";
import type { TodoItem } from "../../src/work-state/index.js";
import { CodingAgentTodoContinuationSource } from "../../src/work-state/todo-continuation-source.js";

describe("CodingAgentContinuationOrchestrator", () => {
	it("selects Todo, Plugin and Stop Hook in the established priority order", async () => {
		let todoMessages: readonly UserMessage[] = [userMessage("todo")];
		let pluginMessages: readonly UserMessage[] = [userMessage("plugin")];
		const todo = source(() => todoMessages);
		const plugin = source(() => pluginMessages);
		const stopHook = source(() => [userMessage("stop")]);
		const orchestrator = new CodingAgentContinuationOrchestrator({
			todo,
			plugin,
			stopHook,
		});
		const context = continuationContext("turn-1");

		await expect(orchestrator.collect(context)).resolves.toEqual([userMessage("todo")]);
		expect(todo.collect).toHaveBeenCalledOnce();
		expect(plugin.collect).not.toHaveBeenCalled();
		expect(stopHook.collect).not.toHaveBeenCalled();

		todoMessages = [];
		await expect(orchestrator.collect(context)).resolves.toEqual([userMessage("plugin")]);
		expect(plugin.collect).toHaveBeenCalledOnce();
		expect(stopHook.collect).not.toHaveBeenCalled();

		pluginMessages = [];
		await expect(orchestrator.collect(context)).resolves.toEqual([userMessage("stop")]);
		expect(stopHook.collect).toHaveBeenCalledOnce();
	});

	it("does not call a source after cancellation and does not swallow source failures", async () => {
		const todo = source(() => {
			throw new Error("todo state failed");
		});
		const stopHook = source(() => [userMessage("stop")]);
		const orchestrator = new CodingAgentContinuationOrchestrator({ todo, stopHook });

		await expect(orchestrator.collect(continuationContext("turn-1"))).rejects.toThrow("todo state failed");
		expect(stopHook.collect).not.toHaveBeenCalled();

		const controller = new AbortController();
		controller.abort();
		await expect(orchestrator.collect(continuationContext("turn-2", [], controller.signal))).resolves.toEqual([]);
		expect(todo.collect).toHaveBeenCalledOnce();
	});
});

describe("CodingAgentTodoContinuationSource", () => {
	it("nudges an ad-hoc list once per pending signature and resets on a new external turn", async () => {
		const items: TodoItem[] = [{ id: 1, content: "Implement", status: "pending" }];
		const state = {
			getAll: () => items,
			isLocked: () => false,
		};
		const source = new CodingAgentTodoContinuationSource({ state, now: () => 42 });

		const first = await source.collect(continuationContext("turn-1"));
		const duplicate = await source.collect(continuationContext("turn-1"));
		const nextTurn = await source.collect(continuationContext("turn-2"));

		expect(messageText(first[0])).toContain("[ephemeral:todo]");
		expect(messageText(first[0])).toContain("#1 Implement");
		expect(first[0]?.timestamp).toBe(42);
		expect(duplicate).toEqual([]);
		expect(nextTurn).toEqual(first);

		items[0] = { ...items[0], status: "done" };
		await expect(source.collect(continuationContext("turn-2"))).resolves.toEqual([]);
	});

	it("keeps locked lists running and isolates nudge state between sessions", async () => {
		const lockedItems: TodoItem[] = [{ id: 1, content: "Locked work", status: "in_progress" }];
		const locked = new CodingAgentTodoContinuationSource({
			state: {
				getAll: () => lockedItems,
				isLocked: () => true,
			},
			now: () => 1,
		});
		const firstSession = todoSource("Session one");
		const secondSession = todoSource("Session two");

		expect(await locked.collect(continuationContext("turn-1"))).not.toEqual([]);
		expect(await locked.collect(continuationContext("turn-1"))).not.toEqual([]);
		expect(await firstSession.collect(continuationContext("turn-shared"))).not.toEqual([]);
		expect(await firstSession.collect(continuationContext("turn-shared"))).toEqual([]);
		expect(await secondSession.collect(continuationContext("turn-shared"))).not.toEqual([]);
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
	collect: (context: ContinuationPolicyContext) => readonly UserMessage[] | Promise<readonly UserMessage[]>,
) {
	const mock = vi.fn(async (context: ContinuationPolicyContext): Promise<readonly UserMessage[]> => collect(context));
	return { collect: mock } satisfies CodingAgentContinuationSource;
}

function todoSource(content: string): CodingAgentTodoContinuationSource {
	return new CodingAgentTodoContinuationSource({
		state: {
			getAll: () => [{ id: 1, content, status: "pending" }],
			isLocked: () => false,
		},
		now: () => 1,
	});
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
