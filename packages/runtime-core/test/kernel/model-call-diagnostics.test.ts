import type { AssistantMessage, Context, LanguageModelStreamEvent, ModelStreamResponse } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { withPromptCacheDiagnostics } from "../../src/kernel/model-call-diagnostics.js";

describe("model call diagnostics", () => {
	it("attaches the same prompt cache fingerprint to terminal events and results", async () => {
		const message = assistantMessage();
		const response: ModelStreamResponse = {
			events: events({ type: "done", reason: "stop", message }),
			result: Promise.resolve(message),
		};
		const diagnosed = withPromptCacheDiagnostics(response, context());
		const terminalEvents: LanguageModelStreamEvent[] = [];
		for await (const event of diagnosed.events) terminalEvents.push(event);
		const result = await diagnosed.result;

		expect(terminalEvents).toHaveLength(1);
		const terminal = terminalEvents[0];
		expect(terminal?.type).toBe("done");
		if (terminal?.type !== "done") throw new Error("Expected terminal done event");
		expect(terminal.message.usage.promptCache).toEqual(result.usage.promptCache);
		expect(result.usage.promptCache).toMatchObject({
			stableSystemPromptLength: 6,
			volatileSystemPromptLength: 8,
			historyPrefixMessages: 1,
			toolCount: 0,
		});
	});
});

async function* events(event: LanguageModelStreamEvent): AsyncIterable<LanguageModelStreamEvent> {
	yield event;
}

function context(): Context {
	return {
		systemPrompt: "stablevolatile",
		systemPromptStableLength: 6,
		messages: [
			{ role: "user", content: "history", timestamp: 1 },
			{ role: "user", content: "current", timestamp: 2 },
		],
	};
}

function assistantMessage(): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "answer" }],
		api: "openai-responses",
		provider: "test",
		model: "test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 3,
	};
}
