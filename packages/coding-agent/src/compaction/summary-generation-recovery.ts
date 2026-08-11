import { classifyRuntimeFailure } from "../utils/retryable-error.js";
import { sleep } from "../utils/sleep.js";
import type { CompactionSummaryInputCandidate } from "./summary-input-degradation.js";
import { isDegradedCompactionSummary } from "./summary-quality.js";

export interface CompactionSummaryGenerationRecoveryOptions {
	readonly maxTransientRetries?: number;
	readonly maxDegradedRetries?: number;
	readonly baseDelayMs?: number;
	readonly wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

export async function generateCompactionSummaryWithRecovery(
	candidates: readonly CompactionSummaryInputCandidate[],
	generate: (candidate: CompactionSummaryInputCandidate) => Promise<string>,
	signal?: AbortSignal,
	options: CompactionSummaryGenerationRecoveryOptions = {},
): Promise<string> {
	const maxTransientRetries = nonNegativeInteger(options.maxTransientRetries, 2);
	const maxDegradedRetries = nonNegativeInteger(options.maxDegradedRetries, 1);
	const baseDelayMs = nonNegativeInteger(options.baseDelayMs, 250);
	const wait = options.wait ?? sleep;
	let lastInputError: unknown;

	for (const candidate of candidates) {
		let transientRetries = 0;
		let degradedRetries = 0;
		while (true) {
			signal?.throwIfAborted();
			try {
				const summary = await generate(candidate);
				const sourceCharacterCount = JSON.stringify(candidate.messages).length;
				if (!isDegradedCompactionSummary({ summary, sourceCharacterCount })) return summary;
				if (degradedRetries >= maxDegradedRetries) {
					throw new Error(`Compaction produced a degraded summary at input level ${candidate.level}`);
				}
				degradedRetries += 1;
			} catch (error) {
				const kind = classifyRuntimeFailure(error, signal);
				if (kind === "aborted" || kind === "permanent") throw error;
				if (kind === "input-too-large") {
					lastInputError = error;
					break;
				}
				if (transientRetries >= maxTransientRetries) throw error;
				const delayMs = baseDelayMs * 2 ** transientRetries;
				transientRetries += 1;
				await wait(delayMs, signal);
			}
		}
	}
	throw lastInputError ?? new Error("Compaction summary input levels were exhausted");
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isInteger(value) && value >= 0 ? value : fallback;
}
