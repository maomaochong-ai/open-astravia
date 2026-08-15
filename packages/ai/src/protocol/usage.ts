export interface UsageCost {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

/**
 * Cache token detail that the provider reported for one completed model call.
 *
 * This describes observability, not whether the request hit a cache. A reported
 * zero is a real miss; `unavailable` means that no hit-rate conclusion can be
 * drawn from the normalized zero values.
 */
export type CacheUsageReporting = "unavailable" | "read-only" | "read-write";

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	/** Missing on historical records and treated as `unavailable`. */
	cacheUsageReporting?: CacheUsageReporting;
	cost: UsageCost;
}

export interface PromptCacheUsageLike {
	input: number;
	cacheRead: number;
	cacheWrite: number;
	cacheUsageReporting?: CacheUsageReporting;
}

export interface PromptCacheMetrics {
	/** All prompt tokens under Vetta's disjoint input/read/write accounting. */
	promptTokens: number;
	/** Whether cache reads are observable for this usage record. */
	readObserved: boolean;
	/** Whether cache writes are observable for this usage record. */
	writeObserved: boolean;
	/** Cache-read share of prompt tokens, or null when reads are unavailable. */
	tokenHitRate: number | null;
	/** Cache-write share of prompt tokens, or null when writes are unavailable. */
	writeRate: number | null;
}

export interface PromptCacheUsageSummary {
	calls: number;
	readObservedCalls: number;
	writeObservedCalls: number;
	hitCalls: number;
	promptTokens: number;
	readObservedPromptTokens: number;
	writeObservedPromptTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	tokenHitRate: number | null;
	requestHitRate: number | null;
	readCallCoverage: number | null;
	readTokenCoverage: number | null;
	writeRate: number | null;
	writeCallCoverage: number | null;
}

/**
 * Calculates provider-neutral prompt-cache metrics from Vetta usage semantics.
 * `input`, `cacheRead`, and `cacheWrite` are disjoint, so all three form the
 * prompt-token denominator. Output tokens never participate in cache rates.
 */
export function calculatePromptCacheMetrics(usage: PromptCacheUsageLike): PromptCacheMetrics {
	const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	const readObserved = usage.cacheUsageReporting === "read-only" || usage.cacheUsageReporting === "read-write";
	const writeObserved = usage.cacheUsageReporting === "read-write";
	return {
		promptTokens,
		readObserved,
		writeObserved,
		tokenHitRate: readObserved && promptTokens > 0 ? usage.cacheRead / promptTokens : null,
		writeRate: writeObserved && promptTokens > 0 ? usage.cacheWrite / promptTokens : null,
	};
}

/** Aggregates completed calls without treating unavailable cache detail as misses. */
export function aggregatePromptCacheUsage(usages: Iterable<PromptCacheUsageLike>): PromptCacheUsageSummary {
	let calls = 0;
	let readObservedCalls = 0;
	let writeObservedCalls = 0;
	let hitCalls = 0;
	let promptTokens = 0;
	let readObservedPromptTokens = 0;
	let writeObservedPromptTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;

	for (const usage of usages) {
		const metrics = calculatePromptCacheMetrics(usage);
		calls += 1;
		promptTokens += metrics.promptTokens;
		if (metrics.readObserved) {
			readObservedCalls += 1;
			readObservedPromptTokens += metrics.promptTokens;
			cacheReadTokens += usage.cacheRead;
			if (usage.cacheRead > 0) hitCalls += 1;
		}
		if (metrics.writeObserved) {
			writeObservedCalls += 1;
			writeObservedPromptTokens += metrics.promptTokens;
			cacheWriteTokens += usage.cacheWrite;
		}
	}

	return {
		calls,
		readObservedCalls,
		writeObservedCalls,
		hitCalls,
		promptTokens,
		readObservedPromptTokens,
		writeObservedPromptTokens,
		cacheReadTokens,
		cacheWriteTokens,
		tokenHitRate: ratio(cacheReadTokens, readObservedPromptTokens),
		requestHitRate: ratio(hitCalls, readObservedCalls),
		readCallCoverage: ratio(readObservedCalls, calls),
		readTokenCoverage: ratio(readObservedPromptTokens, promptTokens),
		writeRate: ratio(cacheWriteTokens, writeObservedPromptTokens),
		writeCallCoverage: ratio(writeObservedCalls, calls),
	};
}

function ratio(numerator: number, denominator: number): number | null {
	return denominator > 0 ? numerator / denominator : null;
}
