import type { SessionEvent } from "@astravia/runtime-core";
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

	it("records policy skips as info instead of failures", () => {
		const info = vi.fn();
		const warn = vi.fn();
		const observe = createRuntimeSessionCompactionLogger({ info, warn });
		observe(
			compactionEvent("compaction.end", 300, {
				success: false,
				reason: "threshold",
				errorMessage: "compaction.skipped.noProgress",
			}),
		);

		expect(info).toHaveBeenCalledWith(
			"[agent-runtime] context compaction skipped",
			expect.objectContaining({
				reason: "threshold",
				success: false,
				errorMessage: "compaction.skipped.noProgress",
			}),
		);
		expect(warn).not.toHaveBeenCalled();
	});

	it("keeps skips that carry a failure reported as failures", () => {
		const info = vi.fn();
		const warn = vi.fn();
		const observe = createRuntimeSessionCompactionLogger({ info, warn });
		// noApiKey 的文案带 skipped 前缀，但它确实是一次故障，降到 info 会让人以为本轮
		// 只是“不需要压”。
		observe(
			compactionEvent("compaction.end", 400, {
				success: false,
				reason: "threshold",
				errorMessage: "compaction.skipped.noApiKey",
				failure: {
					code: "PROVIDER_AUTHENTICATION_FAILED",
					message: "no credentials",
					retryable: false,
					origin: "provider",
				},
			}),
		);

		expect(warn).toHaveBeenCalledWith(
			"[agent-runtime] context compaction failed",
			expect.objectContaining({ failureCode: "PROVIDER_AUTHENTICATION_FAILED" }),
		);
		expect(info).not.toHaveBeenCalledWith("[agent-runtime] context compaction skipped", expect.anything());
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
