import type { AssistantMessage } from "@vetta/ai";
import { getModel } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { Agent } from "../src/index.js";

describe("Agent.continue() validation", () => {
	it("throws when the context has no messages", async () => {
		const agent = new Agent({
			initialState: {
				systemPrompt: "Test",
				model: getModel("anthropic", "claude-haiku-4-5"),
			},
		});

		await expect(agent.continue()).rejects.toThrow("No messages to continue from");
	});

	it("throws when the last message is an assistant message", async () => {
		const agent = new Agent({
			initialState: {
				systemPrompt: "Test",
				model: getModel("anthropic", "claude-haiku-4-5"),
			},
		});
		const assistantMessage: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "Hello" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-haiku-4-5",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		agent.replaceMessages([assistantMessage]);

		await expect(agent.continue()).rejects.toThrow("Cannot continue from message role: assistant");
	});
});
