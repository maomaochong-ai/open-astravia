import { describe, expect, it } from "vitest";
import { transformMessages } from "../src/providers/transform-messages.js";
import type { AssistantMessage, Message, Model, ToolResultMessage } from "../src/types.js";

function makeModel(): Model<"anthropic-messages"> {
	return {
		id: "claude-sonnet-4",
		name: "Claude Sonnet 4",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16000,
	};
}

function assistantWithToolCall(
	id: string,
	name: string,
	stopReason: AssistantMessage["stopReason"] = "toolUse",
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: { command: "ls" } }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 2,
	};
}

function syntheticToolResults(messages: Message[]): ToolResultMessage[] {
	return messages.filter((message): message is ToolResultMessage => message.role === "toolResult");
}

describe("orphaned tool calls during message transformation", () => {
	it("keeps a paired tool call and its result untouched", () => {
		const messages: Message[] = [
			{ role: "user", content: "run a command", timestamp: 1 },
			assistantWithToolCall("call-1", "bash"),
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "bash",
				content: [{ type: "text", text: "file.txt" }],
				isError: false,
				timestamp: 3,
			},
		];

		const result = transformMessages(messages, makeModel());

		expect(syntheticToolResults(result)).toEqual([
			expect.objectContaining({
				toolCallId: "call-1",
				isError: false,
				content: [{ type: "text", text: "file.txt" }],
			}),
		]);
	});

	it("replaces an interrupted tool call with an actionable diagnostic naming the tool", () => {
		const messages: Message[] = [
			{ role: "user", content: "run a command", timestamp: 1 },
			assistantWithToolCall("call-1", "bash"),
			{ role: "user", content: "never mind, do something else", timestamp: 3 },
		];

		const result = transformMessages(messages, makeModel());
		const [orphan] = syntheticToolResults(result);

		expect(orphan).toMatchObject({ toolCallId: "call-1", toolName: "bash", isError: true });
		expect(orphan?.content).toEqual([
			{
				type: "text",
				text:
					'No result was recorded for the "bash" tool call, so its output is unavailable ' +
					"(the call was interrupted, cancelled, or its result was lost before it was stored). " +
					"Re-run the tool if you still need that output.",
			},
		]);
		// 诊断结果必须插在打断它的用户消息之前，保持 tool call / result 相邻。
		expect(result.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "user"]);
	});

	it("invents no result for a still-in-flight trailing tool call", () => {
		const messages: Message[] = [
			{ role: "user", content: "run a command", timestamp: 1 },
			assistantWithToolCall("call-1", "bash"),
		];

		const result = transformMessages(messages, makeModel());

		expect(syntheticToolResults(result)).toEqual([]);
	});

	it("drops errored and aborted assistant turns without adding their tool calls", () => {
		for (const stopReason of ["error", "aborted"] as const) {
			const messages: Message[] = [
				{ role: "user", content: "run a command", timestamp: 1 },
				assistantWithToolCall("call-1", "bash", stopReason),
				{ role: "user", content: "retry", timestamp: 3 },
			];

			const result = transformMessages(messages, makeModel());

			expect(result.map((message) => message.role)).toEqual(["user", "user"]);
		}
	});

	it("stays informative for a malformed tool call without a name", () => {
		const messages: Message[] = [
			{ role: "user", content: "run a command", timestamp: 1 },
			assistantWithToolCall("call-1", ""),
			{ role: "user", content: "next", timestamp: 3 },
		];

		const result = transformMessages(messages, makeModel());
		const [orphan] = syntheticToolResults(result);

		expect(orphan).toMatchObject({ toolCallId: "call-1", isError: true });
		expect(orphan?.content).toEqual([expect.objectContaining({ type: "text" })]);
	});
});
