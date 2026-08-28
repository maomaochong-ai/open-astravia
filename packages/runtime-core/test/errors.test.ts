import { AI_ERROR_CODES, AIError } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { isSessionError, runtimeError } from "../src/errors.js";
import { readRuntimeFailure, runtimeFailureFromError } from "../src/failure-contract.js";

describe("Runtime errors", () => {
	it("recognizes structured session failures independently of message text", () => {
		const error = runtimeError("SESSION_BUSY", "wording is not part of the contract", true);

		expect(isSessionError(error)).toBe(true);
		expect(error.code).toBe("SESSION_BUSY");
	});

	it("rejects incomplete lookalikes", () => {
		expect(isSessionError({ code: "SESSION_BUSY", message: "busy" })).toBe(false);
	});

	it("projects AIError diagnostics without losing provider context", () => {
		const error = new AIError(AI_ERROR_CODES.RATE_LIMITED, "quota exhausted", {
			retryable: false,
			statusCode: 429,
			provider: "deepseek",
			modelId: "deepseek-chat",
			requestId: "req-123",
			providerCode: "insufficient_quota",
			phase: "response",
			url: "https://api.example.test/v1/chat?api_key=redacted",
			responseHeaders: {
				"x-request-id": "req-123",
				authorization: "must-not-cross-boundary",
			},
			responseBodyPreview: '{"error":"quota exhausted"}',
			retryAfterMs: 30_000,
		});

		expect(runtimeFailureFromError(error)).toEqual({
			code: AI_ERROR_CODES.RATE_LIMITED,
			message: "quota exhausted",
			retryable: false,
			origin: "provider",
			details: {
				statusCode: 429,
				provider: "deepseek",
				modelId: "deepseek-chat",
				requestId: "req-123",
				providerCode: "insufficient_quota",
				phase: "response",
				url: "https://api.example.test/v1/chat",
				responseHeaders: { "x-request-id": "req-123" },
				responseBodyPreview: '{"error":"quota exhausted"}',
				retryAfterMs: 30_000,
			},
		});
	});

	it("uses an explicit safe projection for non-AI boundary errors", () => {
		expect(
			runtimeFailureFromError(new Error("MCP reload failed"), {
				origin: "extension",
				code: "MCP_RELOAD_FAILED",
			}),
		).toEqual({
			code: "MCP_RELOAD_FAILED",
			message: "MCP reload failed",
			retryable: false,
			origin: "extension",
		});
	});

	it("narrows structured failures at untrusted boundaries", () => {
		expect(
			readRuntimeFailure({
				code: "AI_RATE_LIMITED",
				message: "rate limited",
				retryable: true,
				origin: "provider",
				details: { retryAfterMs: 1_000, phase: "response" },
			}),
		).toEqual({
			code: "AI_RATE_LIMITED",
			message: "rate limited",
			retryable: true,
			origin: "provider",
			details: { retryAfterMs: 1_000, phase: "response" },
		});
		expect(
			readRuntimeFailure({
				code: "AI_RATE_LIMITED",
				message: "rate limited",
				retryable: true,
				origin: "provider",
				details: { responseHeaders: { authorization: 42 } },
			}),
		).toBeUndefined();
	});

	it("preserves validated Session lock-holder diagnostics", () => {
		expect(
			readRuntimeFailure({
				code: "SESSION_LOCKED",
				message: "locked",
				retryable: false,
				origin: "runtime",
				details: {
					lockHolder: { pid: 42, hostname: "worker", openedAt: "2026-08-27T00:00:00.000Z" },
				},
			}),
		).toMatchObject({
			details: {
				lockHolder: { pid: 42, hostname: "worker", openedAt: "2026-08-27T00:00:00.000Z" },
			},
		});
		expect(
			readRuntimeFailure({
				code: "SESSION_LOCKED",
				message: "locked",
				retryable: false,
				origin: "runtime",
				details: { lockHolder: { pid: "42", hostname: "worker", openedAt: "today" } },
			}),
		).toBeUndefined();
	});
});
