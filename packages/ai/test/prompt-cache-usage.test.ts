import { describe, expect, it } from "vitest";
import { aggregatePromptCacheUsage, calculatePromptCacheMetrics } from "../src/protocol/usage.js";

describe("calculatePromptCacheMetrics", () => {
	it("uses the disjoint input, cache-read, and cache-write prompt denominator", () => {
		expect(
			calculatePromptCacheMetrics({
				input: 20,
				cacheRead: 70,
				cacheWrite: 10,
				cacheUsageReporting: "read-write",
			}),
		).toEqual({
			promptTokens: 100,
			readObserved: true,
			writeObserved: true,
			tokenHitRate: 0.7,
			writeRate: 0.1,
		});
	});

	it("distinguishes an observed zero from unavailable cache data", () => {
		expect(
			calculatePromptCacheMetrics({
				input: 100,
				cacheRead: 0,
				cacheWrite: 0,
				cacheUsageReporting: "read-only",
			}),
		).toMatchObject({ readObserved: true, tokenHitRate: 0, writeRate: null });

		expect(calculatePromptCacheMetrics({ input: 100, cacheRead: 0, cacheWrite: 0 })).toMatchObject({
			readObserved: false,
			tokenHitRate: null,
			writeRate: null,
		});
	});

	it("aggregates only observable calls and reports observation coverage", () => {
		expect(
			aggregatePromptCacheUsage([
				{ input: 20, cacheRead: 70, cacheWrite: 10, cacheUsageReporting: "read-write" },
				{ input: 50, cacheRead: 50, cacheWrite: 0, cacheUsageReporting: "read-only" },
				{ input: 100, cacheRead: 0, cacheWrite: 0 },
			]),
		).toEqual({
			calls: 3,
			readObservedCalls: 2,
			writeObservedCalls: 1,
			hitCalls: 2,
			promptTokens: 300,
			readObservedPromptTokens: 200,
			writeObservedPromptTokens: 100,
			cacheReadTokens: 120,
			cacheWriteTokens: 10,
			tokenHitRate: 0.6,
			requestHitRate: 1,
			readCallCoverage: 2 / 3,
			readTokenCoverage: 2 / 3,
			writeRate: 0.1,
			writeCallCoverage: 1 / 3,
		});
	});
});
