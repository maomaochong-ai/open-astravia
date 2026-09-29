import { describe, expect, it } from "vitest";
import { isStoredSessionEvent } from "../src/conversation/index.js";

const assistantErrorEvent = (failure: Record<string, unknown>) => ({
	type: "message.appended" as const,
	sessionId: "session-1",
	turnId: "turn-1",
	messageId: "assistant-1",
	message: {
		role: "assistant" as const,
		content: [],
		api: "anthropic-messages",
		provider: "custom-anthropic",
		model: "model-1",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error" as const,
		errorMessage: "invalid response",
		failure,
		timestamp: 1,
	},
	timestamp: 1,
});

describe("assistant failure schema", () => {
	it("accepts provider response validation diagnostics on a terminal error message", () => {
		expect(
			isStoredSessionEvent(
				assistantErrorEvent({
					code: "AI_RESPONSE_VALIDATION_FAILED",
					message: "invalid response",
					retryable: false,
					provider: "custom-anthropic",
					responseValidation: {
						payloadType: "message_start",
						errors: [{ path: "/message/usage", message: "Expected object", received: "null" }],
					},
				}),
			),
		).toBe(true);
	});

	it("rejects unknown fields inside response validation diagnostics", () => {
		expect(
			isStoredSessionEvent(
				assistantErrorEvent({
					code: "AI_RESPONSE_VALIDATION_FAILED",
					message: "invalid response",
					retryable: false,
					responseValidation: { payloadType: "message_start", errors: [], raw: "{}" },
				}),
			),
		).toBe(false);
	});
});
