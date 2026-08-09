import { describe, expect, it } from "vitest";
import { canonicalizeAssistantMessage, canonicalizeAssistantRun } from "../src/testkit/canonical-assistant-run.js";
import type { AssistantMessage, AssistantMessageEvent } from "../src/types.js";

function message(
	timestamp: number,
	argumentsValue: Record<string, unknown> = { b: 2, a: { d: 4, c: 3 } },
): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{ type: "text", text: "hello" },
			{ type: "toolCall", id: "call-1", name: "search", arguments: argumentsValue },
		],
		api: "openai-responses",
		provider: "openai",
		model: "test",
		usage: {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 15,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp,
	};
}

function eventSequence(deltas: readonly string[], result: AssistantMessage): AssistantMessageEvent[] {
	const partial = { ...result, content: [{ type: "text" as const, text: "" }] };
	return [
		{ type: "start", partial },
		{ type: "text_start", contentIndex: 0, partial },
		...deltas.map((delta) => ({ type: "text_delta" as const, contentIndex: 0, delta, partial })),
		{ type: "text_end", contentIndex: 0, content: "hello", partial },
		{ type: "done", reason: "toolUse", message: result },
	];
}

describe("canonical assistant run", () => {
	it("removes timestamps and recursively orders tool arguments", () => {
		const left = canonicalizeAssistantMessage(message(1, { b: 2, a: { d: 4, c: 3 } }));
		const right = canonicalizeAssistantMessage(message(2, { a: { c: 3, d: 4 }, b: 2 }));

		expect(left).toEqual(right);
		expect(Object.keys((left.content[1] as { arguments: Record<string, unknown> }).arguments)).toEqual(["a", "b"]);
	});

	it("ignores provider delta chunk boundaries but preserves lifecycle", () => {
		const result = message(1);
		const split = canonicalizeAssistantRun(eventSequence(["hel", "lo"], result), result);
		const whole = canonicalizeAssistantRun(eventSequence(["hello"], result), result);

		expect(split).toEqual(whole);
		expect(split.events).toMatchObject({
			lifecycle: ["start", "text_start", "text_end", "done"],
			text: [{ contentIndex: 0, value: "hello" }],
		});
	});
});
