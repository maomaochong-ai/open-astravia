import { type AsyncExecutionGate, createAsyncExecutionGate } from "@vetta/runtime-tools";

let sharedOcrExecutionGate: AsyncExecutionGate | undefined;

/** Coding Agent 的所有 Session 共用同一 OCR 并发策略。 */
export function getCodingAgentOcrExecutionGate(maxConcurrent = 1): AsyncExecutionGate {
	const concurrency = Number.isInteger(maxConcurrent) && maxConcurrent >= 1 ? maxConcurrent : 1;
	sharedOcrExecutionGate ??= createAsyncExecutionGate(concurrency);
	return sharedOcrExecutionGate;
}
