import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { convertMessages } from "../src/providers/anthropic/messages.js";
import { convertTools } from "../src/providers/anthropic/tools.js";
import type { Message, Model, Tool } from "../src/types.js";

const model: Model<"anthropic-messages"> = {
	id: "claude-sonnet-4-5",
	name: "Claude Sonnet 4.5",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 64_000,
};

describe("Anthropic message conversion", () => {
	it("groups consecutive tool results into one user message", () => {
		const messages: Message[] = [
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "Read",
				content: [{ type: "text", text: "one" }],
				isError: false,
				timestamp: 1,
			},
			{
				role: "toolResult",
				toolCallId: "call-2",
				toolName: "Read",
				content: [{ type: "text", text: "two" }],
				isError: false,
				timestamp: 2,
			},
		];

		const converted = convertMessages(messages, model, false);

		expect(converted).toHaveLength(1);
		expect(converted[0]).toMatchObject({
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: "call-1", content: "one" },
				{ type: "tool_result", tool_use_id: "call-2", content: "two" },
			],
		});
	});

	it("adds cache control to the final string user message", () => {
		const converted = convertMessages([{ role: "user", content: "Hello", timestamp: 1 }], model, false, {
			type: "ephemeral",
			ttl: "1h",
		});

		expect(converted[0]?.content).toEqual([
			{ type: "text", text: "Hello", cache_control: { type: "ephemeral", ttl: "1h" } },
		]);
	});

	it("uses Claude Code tool casing only for OAuth requests", () => {
		const tools: Tool[] = [
			{ name: "read", description: "Read a file", parameters: Type.Object({ path: Type.String() }) },
		];

		expect(convertTools(tools, true)[0]?.name).toBe("Read");
		expect(convertTools(tools, false)[0]?.name).toBe("read");
	});
});
