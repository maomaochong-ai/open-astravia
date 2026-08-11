import { describe, expect, it } from "vitest";
import { convertBedrockMessages } from "../src/providers/amazon-bedrock/messages.js";
import type { Message, Model } from "../src/types.js";

const anthropicModel: Model<"bedrock-converse-stream"> = {
	id: "global.anthropic.claude-sonnet-4-5-v1",
	name: "Claude Sonnet 4.5",
	api: "bedrock-converse-stream",
	provider: "amazon-bedrock",
	baseUrl: "",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 64_000,
};

describe("Amazon Bedrock message conversion", () => {
	it("groups consecutive tool results into one user message", () => {
		const messages: Message[] = [
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [{ type: "text", text: "one" }],
				isError: false,
				timestamp: 1,
			},
			{
				role: "toolResult",
				toolCallId: "call-2",
				toolName: "read",
				content: [{ type: "text", text: "two" }],
				isError: true,
				timestamp: 2,
			},
		];

		const converted = convertBedrockMessages({ messages }, anthropicModel, "none");

		expect(converted).toHaveLength(1);
		expect(converted[0]?.content).toEqual([
			{
				toolResult: {
					toolUseId: "call-1",
					content: [{ text: "one" }],
					status: "success",
				},
			},
			{
				toolResult: {
					toolUseId: "call-2",
					content: [{ text: "two" }],
					status: "error",
				},
			},
		]);
	});

	it("retains Anthropic signatures and downgrades cross-provider thinking to text", () => {
		const messages: Message[] = [
			{
				role: "assistant",
				content: [{ type: "thinking", thinking: "reason", thinkingSignature: "signature" }],
				api: "bedrock-converse-stream",
				provider: "amazon-bedrock",
				model: anthropicModel.id,
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
			},
		];

		const anthropic = convertBedrockMessages({ messages }, anthropicModel, "none");
		const other = convertBedrockMessages({ messages }, { ...anthropicModel, id: "openai.gpt-oss-120b-1:0" }, "none");

		expect(anthropic.at(0)?.content?.at(0)).toEqual({
			reasoningContent: { reasoningText: { text: "reason", signature: "signature" } },
		});
		expect(other.at(0)?.content?.at(0)).toEqual({ text: "reason" });
	});

	it("converts nested tool arguments to a Bedrock document", () => {
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call-1",
						name: "search",
						arguments: { query: "test", filters: { active: true, scores: [1, 2, null] } },
					},
				],
				api: "bedrock-converse-stream",
				provider: "amazon-bedrock",
				model: anthropicModel.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: 1,
			},
		];

		const converted = convertBedrockMessages({ messages }, anthropicModel, "none");

		expect(converted.at(0)?.content?.at(0)).toEqual({
			toolUse: {
				toolUseId: "call-1",
				name: "search",
				input: { query: "test", filters: { active: true, scores: [1, 2, null] } },
			},
		});
	});

	it("rejects non-JSON values at the Bedrock SDK boundary", () => {
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call-1",
						name: "search",
						arguments: { invalid: undefined },
					},
				],
				api: "bedrock-converse-stream",
				provider: "amazon-bedrock",
				model: anthropicModel.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: 1,
			},
		];

		expect(() => convertBedrockMessages({ messages }, anthropicModel, "none")).toThrow(
			"Bedrock tool arguments must contain JSON values, received undefined",
		);
	});
});
