import { describe, expect, it } from "vitest";
import { AIError } from "../src/protocol/index.js";
import { normalizeProviderError } from "../src/provider-kit/index.js";
import type { Model } from "../src/types.js";

const model: Model<"openai-completions"> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-completions",
	provider: "test-provider",
	baseUrl: "https://provider.test/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000,
	maxTokens: 100,
};

describe("normalizeProviderError", () => {
	it.each([
		[401, "AI_AUTHENTICATION_FAILED", false],
		[403, "AI_PERMISSION_DENIED", false],
		[404, "AI_INVALID_REQUEST", false],
		[429, "AI_RATE_LIMITED", true],
		[503, "AI_TRANSPORT_FAILED", true],
	] as const)("maps HTTP %i to %s", (status, code, retryable) => {
		const source = Object.assign(new Error("provider failed"), { status });
		const result = normalizeProviderError(source, model);

		expect(result).toMatchObject({
			code,
			retryable,
			statusCode: status,
			provider: "test-provider",
			modelId: "test-model",
		});
		expect(result.cause).toBe(source);
	});

	it("recognizes context overflow before generic invalid requests", () => {
		const source = Object.assign(new Error("context_length_exceeded"), { status: 400 });

		expect(normalizeProviderError(source, model)).toMatchObject({
			code: "AI_CONTEXT_OVERFLOW",
			statusCode: 400,
		});
	});

	it("preserves an existing structured AI error", () => {
		const source = new AIError("AI_STREAM_PROTOCOL_FAILED", "malformed event");

		expect(normalizeProviderError(source, model)).toBe(source);
	});

	it("maps statusless failures to non-retryable transport errors", () => {
		expect(normalizeProviderError(new Error("socket closed"), model)).toMatchObject({
			code: "AI_TRANSPORT_FAILED",
			retryable: false,
			message: "socket closed",
		});
	});

	it("does not retry quota exhaustion reported as HTTP 429", () => {
		const source = Object.assign(new Error("insufficient_quota: account has no remaining credits"), { status: 429 });

		expect(normalizeProviderError(source, model)).toMatchObject({
			code: "AI_RATE_LIMITED",
			retryable: false,
			statusCode: 429,
		});
	});

	it("preserves Vercel-style safe response diagnostics", () => {
		const source = Object.assign(new Error("gateway overloaded"), {
			statusCode: 503,
			code: "overloaded_error",
			url: "https://provider.test/v1/chat?api_key=should-not-leak",
			responseHeaders: {
				"x-request-id": "req-123",
				"retry-after": "2",
				authorization: "should-not-leak",
			},
			responseBody: JSON.stringify({ error: { type: "overloaded_error" } }),
		});

		const result = normalizeProviderError(source, model);

		expect(result).toMatchObject({
			code: "AI_TRANSPORT_FAILED",
			statusCode: 503,
			providerCode: "overloaded_error",
			requestId: "req-123",
			retryAfterMs: 2_000,
			url: "https://provider.test/v1/chat",
			responseHeaders: { "x-request-id": "req-123", "retry-after": "2" },
			responseBodyPreview: '{"error":{"type":"overloaded_error"}}',
		});
		expect(result.responseHeaders).not.toHaveProperty("authorization");
	});

	it("reads nested SDK response status and request id", () => {
		const source = {
			message: "upstream rejected request",
			response: { status: 429, headers: { "x-request-id": "req-nested", "retry-after": "1" } },
		};

		expect(normalizeProviderError(source, model)).toMatchObject({
			code: "AI_RATE_LIMITED",
			statusCode: 429,
			responseHeaders: { "x-request-id": "req-nested", "retry-after": "1" },
			retryAfterMs: 1_000,
		});
	});
});
