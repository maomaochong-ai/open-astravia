import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { AIAbortedError, AIStreamProtocolError } from "../src/protocol/index.js";
import { normalizeAnthropicSdkError, normalizeOpenAISdkError } from "../src/providers/sdk-connection-errors.js";

const model = getModel("openai", "gpt-4o");

describe.each([
	["OpenAI", OpenAI, normalizeOpenAISdkError],
	["Anthropic", Anthropic, normalizeAnthropicSdkError],
] as const)("%s SDK connection failures", (_name, sdk, normalize) => {
	it("recognizes real SDK timeout and connection objects without changing their names", () => {
		expect(normalize(new sdk.APIConnectionTimeoutError(), model)).toMatchObject({
			code: "AI_TIMEOUT",
			retryable: true,
		});
		expect(normalize(new sdk.APIConnectionError({}), model)).toMatchObject({
			code: "AI_TRANSPORT_FAILED",
			retryable: true,
		});
	});
	it("preserves cancellation and explicit protocol errors", () => {
		expect(normalize(new sdk.APIUserAbortError(), model)).toMatchObject({ code: "AI_ABORTED", retryable: false });
		for (const error of [new AIAbortedError(), new AIStreamProtocolError("invalid sequence")]) {
			expect(normalize(error, model)).toBe(error);
		}
	});
	it("keeps authentication failures non-retryable", () => {
		expect(normalize(Object.assign(new Error("unauthorized"), { status: 401 }), model)).toMatchObject({
			code: "AI_AUTHENTICATION_FAILED",
			retryable: false,
		});
	});
});
