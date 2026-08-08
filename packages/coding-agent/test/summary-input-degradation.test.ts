import type { AgentMessage } from "@vetta/agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { createCompactionSummaryInputCandidates } from "../src/compaction/summary-input-degradation.js";

describe("compaction summary input degradation", () => {
	it("creates ordered loss levels and limits the final level to three real user turns", () => {
		const messages = Array.from({ length: 5 }, (_, index) => [
			user(`request-${index}`, index * 3),
			assistant(index * 3 + 1),
			tool(`result-${index}-${"x".repeat(3_000)}`, index * 3 + 2),
		]).flat();

		const candidates = createCompactionSummaryInputCandidates(messages);

		expect(candidates.map(({ level }) => level)).toEqual([
			"full",
			"compact-tool-results",
			"essential",
			"recent-three-turns",
		]);
		expect(toolText(candidates[0]?.messages[2])).toContain("x".repeat(3_000));
		expect(toolText(candidates[1]?.messages[2])).toContain("truncated for compaction input");
		expect(toolText(candidates[2]?.messages[2])).toBe("[Tool read completed; detailed output omitted]");
		expect(candidates[2]?.messages[1]?.role === "assistant" ? candidates[2].messages[1].content : []).toEqual([
			{ type: "text", text: "response" },
		]);
		expect(candidates[3]?.messages.filter(({ role }) => role === "user")).toHaveLength(3);
		expect(candidates[3]?.messages[0]).toMatchObject({ role: "user", content: "request-2" });
		expect(toolText(messages[2])).toContain("x".repeat(3_000));
	});
});

function user(content: string, timestamp: number): UserMessage {
	return { role: "user", content, timestamp };
}

function assistant(timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "private" },
			{ type: "text", text: "response" },
		],
		api: "openai-responses",
		provider: "test",
		model: "model",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

function tool(content: string, timestamp: number): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: `call-${timestamp}`,
		toolName: "read",
		content: [{ type: "text", text: content }],
		isError: false,
		timestamp,
	};
}

function toolText(message: AgentMessage | undefined): string {
	return message?.role === "toolResult"
		? message.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("")
		: "";
}
