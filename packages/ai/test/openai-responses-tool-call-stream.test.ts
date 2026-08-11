import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it } from "vitest";
import { processResponsesStream } from "../src/providers/openai-responses-shared.js";
import type { AssistantMessage, Model } from "../src/types.js";
import { AssistantMessageEventStream } from "../src/utils/event-stream.js";

describe("OpenAI Responses tool call stream", () => {
	it("removes the streaming-only partialJson field from the final assistant message", async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "openai-responses",
			provider: "test",
			model: "test-model",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 1,
		};

		await processResponsesStream(responseEvents(), output, new AssistantMessageEventStream(), MODEL);

		expect(output.content).toEqual([
			{
				type: "toolCall",
				id: "call_test|fc_test",
				name: "read",
				arguments: { path: "README.md" },
			},
		]);
		expect(output.content[0]).not.toHaveProperty("partialJson");
	});
});

async function* responseEvents(): AsyncIterable<ResponseStreamEvent> {
	const argumentsJson = JSON.stringify({ path: "README.md" });
	const item = {
		type: "function_call",
		id: "fc_test",
		call_id: "call_test",
		name: "read",
		arguments: argumentsJson,
		status: "completed",
	};
	const events = [
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { ...item, status: "in_progress", arguments: "" },
		},
		{
			type: "response.function_call_arguments.delta",
			item_id: item.id,
			output_index: 0,
			delta: argumentsJson,
		},
		{
			type: "response.function_call_arguments.done",
			item_id: item.id,
			output_index: 0,
			arguments: argumentsJson,
		},
		{ type: "response.output_item.done", output_index: 0, item },
		{
			type: "response.completed",
			response: {
				id: "resp_tool",
				object: "response",
				status: "completed",
				output: [],
				usage: {
					input_tokens: 10,
					input_tokens_details: { cached_tokens: 0 },
					output_tokens: 5,
					output_tokens_details: { reasoning_tokens: 0 },
					total_tokens: 15,
				},
			},
		},
	];
	for (const event of events) yield event as ResponseStreamEvent;
}

const MODEL: Model<"openai-responses"> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
