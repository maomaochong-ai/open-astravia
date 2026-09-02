import type { ErrorEvent } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { logRuntimeSessionError, sanitizeRuntimeErrorMessage } from "./session-error-logger.js";

describe("runtime session error logger", () => {
	it("记录最终 Provider 错误的白名单诊断字段", () => {
		const error = vi.fn();
		logRuntimeSessionError(
			{
				schemaVersion: 1,
				sessionId: "session-1",
				eventId: "event-1",
				timestamp: 1,
				source: "agent",
				type: "error",
				retryAttempts: 2,
				error: {
					code: "RATE_LIMITED",
					message: "HTTP 429: quota exceeded",
					retryable: true,
					origin: "provider",
					details: {
						statusCode: 429,
						provider: "openai",
						modelId: "gpt-test",
						requestId: "request-1",
					},
				},
			} satisfies ErrorEvent,
			{ error },
		);

		expect(error).toHaveBeenCalledWith("[agent-runtime] turn failed", {
			sessionId: "session-1",
			eventId: "event-1",
			source: "agent",
			code: "RATE_LIMITED",
			origin: "provider",
			retryable: true,
			retryAttempts: 2,
			message: "HTTP 429: quota exceeded",
			statusCode: 429,
			provider: "openai",
			modelId: "gpt-test",
			requestId: "request-1",
		});
	});

	it("脱敏凭证并限制错误消息长度", () => {
		const sanitized = sanitizeRuntimeErrorMessage(
			`Authorization: Bearer secret-value api_key=plain sk-1234567890 ${"x".repeat(3_000)}`,
		);

		expect(sanitized).not.toContain("secret-value");
		expect(sanitized).not.toContain("plain");
		expect(sanitized).not.toContain("sk-1234567890");
		expect(sanitized).toContain("[REDACTED]");
		expect(sanitized.endsWith("…")).toBe(true);
		expect(sanitized.length).toBe(2_049);
	});
});
