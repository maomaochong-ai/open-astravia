import { describe, expect, it } from "vitest";
import { AIAbortedError, AIError } from "../src/protocol/index.js";
import { ScriptedLanguageModel, ScriptedLanguageModelAdapter } from "../src/testing/scripted-language-model.js";
import type { AssistantMessage, AssistantMessageEvent, Model } from "../src/types.js";

const model: Model<"scripted"> = {
	id: "scripted-model",
	name: "Scripted Model",
	api: "scripted",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

function result(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}

function events(text: string): AssistantMessageEvent[] {
	const message = result(text);
	return [
		{ type: "start", partial: message },
		{ type: "text_start", contentIndex: 0, partial: message },
		{ type: "text_delta", contentIndex: 0, delta: text, partial: message },
		{ type: "text_end", contentIndex: 0, content: text, partial: message },
		{ type: "done", reason: "stop", message },
	];
}

describe("ScriptedLanguageModel", () => {
	it("returns scripted outcomes in call order and records requests", async () => {
		const scripted = new ScriptedLanguageModel([{ events: events("first") }, { events: events("second") }]);
		const first = scripted.stream(model, { messages: [{ role: "user", content: "one", timestamp: 1 }] });
		const second = scripted.stream(model, { messages: [{ role: "user", content: "two", timestamp: 2 }] });

		await expect(first.result()).resolves.toMatchObject({ content: [{ type: "text", text: "first" }] });
		await expect(second.result()).resolves.toMatchObject({ content: [{ type: "text", text: "second" }] });
		expect(scripted.calls.map((call) => call.context.messages[0]?.role)).toEqual(["user", "user"]);
		expect(scripted.remaining).toBe(0);
	});

	it("rejects iteration and result with a scripted failure", async () => {
		const failure = new Error("scripted failure");
		const scripted = new ScriptedLanguageModel([{ error: failure }]);
		const stream = scripted.stream(model, { messages: [] });
		const collect = async () => {
			for await (const _event of stream) {
				// Consume until failure.
			}
		};

		await expect(collect()).rejects.toBe(failure);
		await expect(stream.result()).rejects.toBe(failure);
	});

	it("fails with a structured error when no outcome remains", async () => {
		const scripted = new ScriptedLanguageModel([]);
		const stream = scripted.stream(model, { messages: [] });

		await expect(stream.result()).rejects.toMatchObject({
			code: "AI_INVALID_REQUEST",
			metadata: { callIndex: 0 },
		});
	});

	it("honors an already aborted request", async () => {
		const controller = new AbortController();
		controller.abort();
		const scripted = new ScriptedLanguageModel([{ events: events("unused") }]);
		const stream = scripted.stream(model, { messages: [] }, { signal: controller.signal });

		await expect(stream.result()).rejects.toBeInstanceOf(AIAbortedError);
		expect(scripted.remaining).toBe(1);
	});
});

describe("ScriptedLanguageModelAdapter", () => {
	it("records native requests and consumes outcomes in order", async () => {
		const scripted = new ScriptedLanguageModelAdapter("test-api", [
			{ events: events("native-first").filter((event) => event.type !== "error") },
			{ error: new AIError("AI_RATE_LIMITED", "quota exceeded", { retryable: false, statusCode: 429 }) },
		]);

		const first = await scripted.stream({ model, context: { messages: [] } });
		const second = await scripted.stream({
			model,
			context: { messages: [{ role: "user", content: "retry", timestamp: 2 }] },
		});

		await expect(first.result).resolves.toMatchObject({ content: [{ type: "text", text: "native-first" }] });
		await expect(second.result).rejects.toMatchObject({
			code: "AI_RATE_LIMITED",
			retryable: false,
			statusCode: 429,
		});
		expect(scripted.calls).toHaveLength(2);
		expect(scripted.calls[1]?.request.context.messages[0]).toMatchObject({ content: "retry" });
		expect(scripted.remaining).toBe(0);
	});

	it("fails immediately when the native request is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const scripted = new ScriptedLanguageModelAdapter("test-api", [{ events: events("unused") }]);

		const response = await scripted.stream({
			model,
			context: { messages: [] },
			options: { signal: controller.signal },
		});
		await expect(response.result).rejects.toBeInstanceOf(AIAbortedError);
		expect(scripted.remaining).toBe(1);
	});
});
