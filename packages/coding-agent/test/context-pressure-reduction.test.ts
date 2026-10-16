import type { AgentMessage } from "@astravia/agent-core";
import type { ToolResultMessage, UserMessage } from "@astravia/ai";
import { describe, expect, it } from "vitest";
import { reduceContextByPressure, resolveContextPressure } from "../src/compaction/context-pressure-reduction.js";

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

	it("shortens results aged three to nine turns at hard pressure", () => {
		const messages = conversation(5, "0123456789abcdefghijklmnopqrstuvwxyz");

		const projected = reduceContextByPressure(messages, {
			contextWindow: 100,
			estimatedTokens: 75,
			softToolResultBytes: 20,
		});

		expect(text(projected[1])).toContain("shortened by context pressure");
		expect(text(projected[3])).toContain("shortened by context pressure");
		expect(projected[5]).toBe(messages[5]);
		expect(projected[7]).toBe(messages[7]);
		expect(projected[9]).toBe(messages[9]);
	});

	it("clears results only after ten real user turns at hard pressure", () => {
		const messages = conversation(12, "result");

		const projected = reduceContextByPressure(messages, { contextWindow: 100, estimatedTokens: 75 });

		expect(text(projected[1])).toBe("[tool result cleared — context pressure]");
		expect(text(projected[3])).toBe("[tool result cleared — context pressure]");
		expect(text(projected[5])).toBe("result-2");
		expect(projected[19]).toBe(messages[19]);
	});

	it("does not count continuation or compaction messages as real user turns", () => {
		const continuation = user("internal continuation", 6);
		const messages: AgentMessage[] = [
			user("old", 1),
			tool("0123456789abcdefghijklmnopqrstuvwxyz-old", 2),
			{ role: "compactionSummary", summary: "summary", tokensBefore: 0, timestamp: 3 },
			user("one", 4),
			tool("one-result", 5),
			continuation,
			tool("two-result", 7),
			user("two", 8),
			tool("two-result", 9),
			user("three", 10),
			tool("three-result", 11),
		];

		const projected = reduceContextByPressure(messages, {
			contextWindow: 100,
			estimatedTokens: 90,
			softToolResultBytes: 20,
			isRealUserTurn: (message) => message.role === "user" && message !== continuation,
		});

		expect(text(projected[1])).toContain("shortened by context pressure");
		expect(text(projected[4])).toBe("one-result");
	});

	it("keeps the reduction once a lower pressure is re-observed in the same compaction epoch", () => {
		const messages = conversation(5, "0123456789abcdefghijklmnopqrstuvwxyz");
		const options = { contextWindow: 100, softToolResultBytes: 20 };

		const emitted = reduceContextByPressure(messages, { ...options, estimatedTokens: 50 });
		// 下一次请求回报的是已截断请求的用量，压力看起来更小：
		// 没有下限时会退回原文，已经发出的前缀随之失效。
		const naive = reduceContextByPressure(messages, { ...options, estimatedTokens: 40 });
		const ratcheted = reduceContextByPressure(messages, {
			...options,
			estimatedTokens: 40,
			pressureFloor: 0.5,
		});

		expect(text(emitted[1])).toContain("shortened by context pressure");
		expect(text(naive[1])).toBe("0123456789abcdefghijklmnopqrstuvwxyz-0");
		expect(ratcheted).toEqual(emitted);
	});

	it("resolves pressure against the epoch floor instead of the latest estimate", () => {
		expect(resolveContextPressure({ contextWindow: 100, estimatedTokens: 40 })).toBeCloseTo(0.4);
		expect(resolveContextPressure({ contextWindow: 100, estimatedTokens: 40, pressureFloor: 0.5 })).toBe(0.5);
		expect(resolveContextPressure({ contextWindow: 100, estimatedTokens: 90, pressureFloor: 0.5 })).toBeCloseTo(0.9);
		expect(resolveContextPressure({ contextWindow: 0, estimatedTokens: 40, pressureFloor: 0.5 })).toBe(0.5);
		expect(
			resolveContextPressure({ contextWindow: 100, estimatedTokens: 40, pressureFloor: Number.NaN }),
		).toBeCloseTo(0.4);
		expect(resolveContextPressure({ contextWindow: 100, estimatedTokens: 40, pressureFloor: -1 })).toBeCloseTo(0.4);
	});

	it("treats a floor above hard pressure as hard and clears the oldest results", () => {
		const messages = conversation(12, "result");

		const projected = reduceContextByPressure(messages, {
			contextWindow: 100,
			estimatedTokens: 40,
			pressureFloor: 0.75,
		});

		expect(text(projected[1])).toBe("[tool result cleared — context pressure]");
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
