import { describe, expect, expectTypeOf, it } from "vitest";
import {
	AI_ERROR_CODES,
	AIError,
	AIStreamProtocolError,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageTerminalEvent,
	getAssistantMessageEventResult,
	isAIError,
	isAssistantMessageTerminalEvent,
} from "../src/protocol/index.js";
import type {
	AssistantMessage as LegacyAssistantMessage,
	AssistantMessageEvent as LegacyAssistantMessageEvent,
	ToolCall as LegacyToolCall,
	Usage as LegacyUsage,
} from "../src/types.js";

function assistantMessage(stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: "test-api",
		provider: "test-provider",
		model: "test-model",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 1,
	};
}

function assertNever(value: never): never {
	throw new Error(`Unhandled event: ${JSON.stringify(value)}`);
}

function eventType(event: AssistantMessageEvent): AssistantMessageEvent["type"] {
	switch (event.type) {
		case "start":
		case "text_start":
		case "text_delta":
		case "text_end":
		case "thinking_start":
		case "thinking_delta":
		case "thinking_end":
		case "toolcall_start":
		case "toolcall_delta":
		case "toolcall_end":
		case "done":
		case "error":
			return event.type;
		default:
			return assertNever(event);
	}
}

describe("AI protocol contract", () => {
	it("keeps legacy root types as exact aliases of protocol types", () => {
		expectTypeOf<LegacyAssistantMessage>().toEqualTypeOf<AssistantMessage>();
		expectTypeOf<LegacyAssistantMessageEvent>().toEqualTypeOf<AssistantMessageEvent>();
		expectTypeOf<LegacyToolCall>().toEqualTypeOf<
			Extract<AssistantMessage["content"][number], { type: "toolCall" }>
		>();
		expectTypeOf<LegacyUsage>().toEqualTypeOf<AssistantMessage["usage"]>();
	});

	it("classifies and extracts both compatibility terminal events", () => {
		const success = assistantMessage("stop");
		const failure = assistantMessage("error");
		const done = { type: "done", reason: "stop", message: success } satisfies AssistantMessageEvent;
		const error = { type: "error", reason: "error", error: failure } satisfies AssistantMessageEvent;
		const partial = { type: "start", partial: success } satisfies AssistantMessageEvent;

		expect(isAssistantMessageTerminalEvent(done)).toBe(true);
		expect(isAssistantMessageTerminalEvent(error)).toBe(true);
		expect(isAssistantMessageTerminalEvent(partial)).toBe(false);
		expect(getAssistantMessageEventResult(done)).toBe(success);
		expect(getAssistantMessageEventResult(error)).toBe(failure);
		expect(() => getAssistantMessageEventResult(partial)).toThrowError(
			expect.objectContaining({ code: AI_ERROR_CODES.STREAM_PROTOCOL_FAILED }),
		);
		expectTypeOf(done).toMatchTypeOf<AssistantMessageTerminalEvent>();
	});

	it("provides stable structured error fields without string matching", () => {
		const cause = new Error("socket closed");
		const error = new AIError(AI_ERROR_CODES.TRANSPORT_FAILED, "Request failed", {
			retryable: true,
			statusCode: 503,
			provider: "openai",
			modelId: "gpt-test",
			requestId: "request-1",
			metadata: { attempt: 2 },
			cause,
		});

		expect(isAIError(error)).toBe(true);
		expect(error).toMatchObject({
			name: "AIError",
			code: "AI_TRANSPORT_FAILED",
			retryable: true,
			statusCode: 503,
			provider: "openai",
			modelId: "gpt-test",
			requestId: "request-1",
			metadata: { attempt: 2 },
			cause,
		});
		expect(isAIError(new Error("Request failed"))).toBe(false);
	});

	it("uses a non-retryable protocol error specialization", () => {
		const error = new AIStreamProtocolError("Missing finish event", {
			provider: "anthropic",
			metadata: { reason: "missing_finish" },
		});

		expect(error).toMatchObject({
			name: "AIStreamProtocolError",
			code: "AI_STREAM_PROTOCOL_FAILED",
			retryable: false,
			provider: "anthropic",
			metadata: { reason: "missing_finish" },
		});
	});

	it("keeps the event union exhaustively discriminated", () => {
		const message = assistantMessage();
		const events: AssistantMessageEvent[] = [
			{ type: "start", partial: message },
			{ type: "text_start", contentIndex: 0, partial: message },
			{ type: "text_delta", contentIndex: 0, delta: "o", partial: message },
			{ type: "text_end", contentIndex: 0, content: "ok", partial: message },
			{ type: "thinking_start", contentIndex: 0, partial: message },
			{ type: "thinking_delta", contentIndex: 0, delta: "h", partial: message },
			{ type: "thinking_end", contentIndex: 0, content: "h", partial: message },
			{ type: "toolcall_start", contentIndex: 0, partial: message },
			{ type: "toolcall_delta", contentIndex: 0, delta: "{}", partial: message },
			{
				type: "toolcall_end",
				contentIndex: 0,
				toolCall: { type: "toolCall", id: "call-1", name: "tool", arguments: {} },
				partial: message,
			},
			{ type: "done", reason: "stop", message },
			{ type: "error", reason: "error", error: assistantMessage("error") },
		];

		expect(events.map(eventType)).toEqual([
			"start",
			"text_start",
			"text_delta",
			"text_end",
			"thinking_start",
			"thinking_delta",
			"thinking_end",
			"toolcall_start",
			"toolcall_delta",
			"toolcall_end",
			"done",
			"error",
		]);
	});
});
