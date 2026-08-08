import type { AgentMessage } from "@vetta/agent-core";
import type { ToolResultMessage, UserMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { reduceContextByPressure } from "../src/compaction/context-pressure-reduction.js";

describe("context pressure reduction", () => {
	it("does not prune ToolResult below the soft pressure threshold", () => {
		const messages = conversation(5, "long result content");

		const projected = reduceContextByPressure(messages, { contextWindow: 100, estimatedTokens: 49 });

		expect(projected).toEqual(messages);
		expect(projected[1]).toBe(messages[1]);
	});

	it("shortens only large results before the latest three real user turns at soft pressure", () => {
		const messages = conversation(5, "0123456789abcdefghijklmnopqrstuvwxyz");

		const projected = reduceContextByPressure(messages, {
			contextWindow: 100,
			estimatedTokens: 50,
			softToolResultBytes: 20,
		});

		expect(text(projected[1])).toContain("shortened by context pressure");
		expect(text(projected[3])).toContain("shortened by context pressure");
		expect(projected[5]).toBe(messages[5]);
		expect(projected[7]).toBe(messages[7]);
		expect(projected[9]).toBe(messages[9]);
		expect(text(messages[1])).toBe("0123456789abcdefghijklmnopqrstuvwxyz-0");
	});

	it("clears old results at hard pressure while preserving the latest three user turns", () => {
		const messages = conversation(5, "result");

		const projected = reduceContextByPressure(messages, { contextWindow: 100, estimatedTokens: 75 });

		expect(text(projected[1])).toBe("[tool result cleared — context pressure]");
		expect(text(projected[3])).toBe("[tool result cleared — context pressure]");
		expect(text(projected[5])).toBe("result-2");
		expect(text(projected[7])).toBe("result-3");
		expect(text(projected[9])).toBe("result-4");
	});

	it("does not count custom or compaction summary messages as real user turns", () => {
		const messages: AgentMessage[] = [
			user("old", 1),
			tool("old-result", 2),
			{ role: "compactionSummary", summary: "summary", tokensBefore: 0, timestamp: 3 },
			user("one", 4),
			tool("one-result", 5),
			user("two", 6),
			tool("two-result", 7),
			user("three", 8),
			tool("three-result", 9),
		];

		const projected = reduceContextByPressure(messages, { contextWindow: 100, estimatedTokens: 90 });

		expect(text(projected[1])).toBe("[tool result cleared — context pressure]");
		expect(text(projected[4])).toBe("one-result");
	});
});

function conversation(turns: number, result: string): AgentMessage[] {
	return Array.from({ length: turns }, (_, index) => [
		user(`user-${index}`, index * 2),
		tool(`${result}-${index}`, index * 2 + 1),
	]).flat();
}

function user(content: string, timestamp: number): UserMessage {
	return { role: "user", content, timestamp };
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

function text(message: AgentMessage | undefined): string {
	if (!message || message.role !== "toolResult") return "";
	return message.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("");
}
