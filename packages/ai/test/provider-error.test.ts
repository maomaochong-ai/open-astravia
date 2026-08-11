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
});
