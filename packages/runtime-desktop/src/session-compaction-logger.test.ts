import type { SessionEvent } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { createRuntimeSessionCompactionLogger } from "./session-compaction-logger.js";

describe("runtime session compaction logger", () => {
	it("records threshold diagnostics and a correlated successful completion", () => {
		const info = vi.fn();
		const warn = vi.fn();
		const observe = createRuntimeSessionCompactionLogger({ info, warn });
		observe(
			compactionEvent("compaction.start", 100, {
				reason: "threshold",
				contextTokens: 91_000,
				contextWindow: 100_000,
				thresholdTokens: 90_000,
			}),
		);
		observe(compactionEvent("compaction.end", 145, { success: true, reason: "threshold", tokensBefore: 91_000 }));

		expect(info).toHaveBeenNthCalledWith(1, "[agent-runtime] context compaction started", {
			sessionId: "session-1",
			eventId: "event-compaction.start",
			source: "agent",
			reason: "threshold",
			contextTokens: 91_000,
			contextWindow: 100_000,
			thresholdTokens: 90_000,
			usagePercent: 91,
		});
		expect(info).toHaveBeenNthCalledWith(2, "[agent-runtime] context compaction completed", {
			sessionId: "session-1",
			eventId: "event-compaction.end",
			source: "agent",
			reason: "threshold",
			success: true,
			tokensBefore: 91_000,
			durationMs: 45,
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it("sanitizes failed compaction diagnostics", () => {
		const info = vi.fn();
		const warn = vi.fn();
		const observe = createRuntimeSessionCompactionLogger({ info, warn });
		observe(
			compactionEvent("compaction.end", 200, {
				success: false,
				reason: "overflow",
				errorMessage: "Authorization: Bearer secret-value",
				failure: { code: "COMPACTION_FAILED", message: "failed", retryable: false, origin: "provider" },
			}),
		);

		expect(warn).toHaveBeenCalledWith(
			"[agent-runtime] context compaction failed",
			expect.objectContaining({
				reason: "overflow",
				errorMessage: "Authorization: [REDACTED] [REDACTED]",
				failureCode: "COMPACTION_FAILED",
				failureOrigin: "provider",
				failureRetryable: false,
			}),
		);
	});
});

function compactionEvent<TType extends "compaction.start" | "compaction.end">(
	type: TType,
	timestamp: number,
	payload: Omit<
		Extract<SessionEvent, { readonly type: TType }>,
		"schemaVersion" | "sessionId" | "eventId" | "timestamp" | "source" | "type"
	>,
): Extract<SessionEvent, { readonly type: TType }> {
	return {
		schemaVersion: 1,
		sessionId: "session-1",
		eventId: `event-${type}`,
		timestamp,
		source: "agent",
		type,
		...payload,
	} as Extract<SessionEvent, { readonly type: TType }>;
}
