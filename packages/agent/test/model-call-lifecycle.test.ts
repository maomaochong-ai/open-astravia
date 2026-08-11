import {
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	EventStream,
	type Message,
	type Model,
} from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import { agentLoopContinue } from "../src/agent-loop.js";
import type { AgentLoopConfig, AgentMessage } from "../src/types.js";

describe("model call lifecycle", () => {
	it("observes the exact provider-facing context after every transformation", async () => {
		const calls: string[] = [];
		let preparedContext: Readonly<Context> | undefined;
		const config: AgentLoopConfig = {
			model: createModel(),
			async resolveCallContext() {
				calls.push("resolve");
				return { systemPrompt: "resolved", tools: [] };
			},
			async transformContext(messages) {
				calls.push("transform");
				return [...messages, { role: "user", content: "transformed", timestamp: 2 }];
			},
			convertToLlm(messages) {
				calls.push("convert");
				return messages.filter(isMessage);
			},
			modelCallLifecycle: {
				prepared(context) {
					calls.push("prepared");
					preparedContext = context;
				},
				completed(_context, message) {
					calls.push(`completed:${message.usage.input}`);
				},
				failed: vi.fn(),
			},
		};
		const stream = agentLoopContinue(
			{ systemPrompt: "initial", messages: [{ role: "user", content: "start", timestamp: 1 }] },
			config,
			undefined,
			(_model, context) => {
				calls.push("provider");
				expect(context).toEqual(preparedContext);
				return responseStream(assistantMessage("stop", 12));
			},
		);

		for await (const _event of stream) {
			// Consume the loop.
		}

		expect(preparedContext).toMatchObject({
			systemPrompt: "resolved",
			messages: [
				{ role: "user", content: "start" },
				{ role: "user", content: "transformed" },
			],
			tools: [],
		});
		expect(calls).toEqual(["resolve", "transform", "convert", "prepared", "provider", "completed:12"]);
	});

	it("reports provider failures with the prepared context", async () => {
		const failed = vi.fn();
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: (messages) => messages.filter(isMessage),
			modelCallLifecycle: {
				prepared: vi.fn(),
				completed: vi.fn(),
				failed,
			},
		};
		const stream = agentLoopContinue(
			{ systemPrompt: "system", messages: [{ role: "user", content: "start", timestamp: 1 }] },
			config,
			undefined,
			() => errorResponseStream(assistantMessage("error", 0)),
		);

		await expect(stream.result()).resolves.toEqual(
			expect.arrayContaining([expect.objectContaining({ role: "assistant", stopReason: "error" })]),
		);
		expect(failed).toHaveBeenCalledWith(
			expect.objectContaining({ systemPrompt: "system" }),
			expect.objectContaining({ stopReason: "error" }),
			undefined,
		);
	});
});

function responseStream(message: AssistantMessage): EventStream<AssistantMessageEvent, AssistantMessage> {
	const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
		(event) => event.type === "done" || event.type === "error",
		(event) => {
			if (event.type === "done") return event.message;
			if (event.type === "error") return event.error;
			throw new Error("Unexpected event");
		},
	);
	queueMicrotask(() => stream.push({ type: "done", reason: "stop", message }));
	return stream;
}

function errorResponseStream(message: AssistantMessage): EventStream<AssistantMessageEvent, AssistantMessage> {
	const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
		(event) => event.type === "done" || event.type === "error",
		(event) => {
			if (event.type === "done") return event.message;
			if (event.type === "error") return event.error;
			throw new Error("Unexpected event");
		},
	);
	queueMicrotask(() => stream.push({ type: "error", reason: "error", error: message }));
	return stream;
}

function assistantMessage(stopReason: AssistantMessage["stopReason"], input: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "done" }],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input,
			output: 2,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: input + 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 3,
	};
}

function createModel(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8_192,
		maxTokens: 2_048,
	};
}

function isMessage(message: AgentMessage): message is Message {
	return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}
