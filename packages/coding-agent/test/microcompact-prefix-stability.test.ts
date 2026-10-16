import type { AssistantMessage, ToolResultMessage } from "@astravia/ai";
import { describe, expect, it } from "vitest";
import { microcompact } from "../src/compaction/microcompact.js";

/**
 * Provider prompt caches match a byte prefix. Every model call of a Turn must therefore
 * project the same content for all positions that already exist, and only append. A
 * tail-relative prune window over messages that the Turn is still producing moves the
 * cleared positions forward on every call, which rewrites the request prefix each time.
 */
const TURN_BOUNDARY = 1_000_000;
const OPTIONS = { keepRecent: 8, maxAgeMs: 30 * 1000, pruneToolResults: false } as const;

describe("microcompact prompt-cache prefix stability", () => {
	it("leaves every earlier position untouched while the Turn keeps appending messages", () => {
		const history = Array.from({ length: 10 }, (_, index) => thinkingAssistant(index, index + 1));
		const firstCall = microcompact([...history], { ...OPTIONS, now: TURN_BOUNDARY });
		const secondCall = microcompact([...history, thinkingAssistant(10, TURN_BOUNDARY)], {
			...OPTIONS,
			now: TURN_BOUNDARY,
		});

		expect(firstCall[0]).not.toBe(history[0]);
		expect(secondCall).toHaveLength(firstCall.length + 1);
		expect(secondCall.slice(0, firstCall.length)).toEqual(firstCall);
	});

	it("keeps tool results of the in-flight Turn appended without rewriting earlier ones", () => {
		const history = Array.from({ length: 12 }, (_, index) => toolResult(index, index + 1));
		const options = { ...OPTIONS, pruneToolResults: true, now: TURN_BOUNDARY };

		const firstCall = microcompact([...history], options);
		const secondCall = microcompact([...history, toolResult(100, TURN_BOUNDARY)], options);

		expect(firstCall[0]).not.toBe(history[0]);
		expect(secondCall).toHaveLength(firstCall.length + 1);
		expect(secondCall.slice(0, firstCall.length)).toEqual(firstCall);
	});

	it("protects thinking blocks of the in-flight Turn across repeated calls", () => {
		const history = Array.from({ length: 12 }, (_, index) => thinkingAssistant(index, index + 1));
		const inFlight = Array.from({ length: 10 }, (_, index) => thinkingAssistant(100 + index, TURN_BOUNDARY));

		const projected = microcompact([...history, ...inFlight], { ...OPTIONS, now: TURN_BOUNDARY });

		expect(projected.slice(history.length).every((message, index) => message === inFlight[index])).toBe(true);
		expect(projected[0]).not.toBe(history[0]);
	});

	it("keeps count-based pruning when no Turn boundary is supplied", () => {
		const messages = Array.from({ length: 10 }, (_, index) => thinkingAssistant(index, 1));

		const projected = microcompact([...messages], { ...OPTIONS });

		expect(projected[0]).not.toBe(messages[0]);
		expect(projected[2]).toBe(messages[2]);
	});
});

function thinkingAssistant(index: number, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		api: "openai-responses",
		provider: "test",
		model: "model",
		timestamp,
		stopReason: "stop",
		usage: {
			input: 1,
			output: 1,
			totalTokens: 2,
			cacheRead: 0,
			cacheWrite: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		content: [
			{ type: "thinking", thinking: `reasoning ${index}` },
			{ type: "text", text: `answer ${index}` },
		],
	};
}

function toolResult(id: number, timestamp: number): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: `tool-${id}`,
		toolName: "read",
		isError: false,
		content: [{ type: "text", text: `result ${id}` }],
		timestamp,
	};
}
