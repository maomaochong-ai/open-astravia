import { type AsyncExecutionGate, createAsyncExecutionGate } from "@vetta/runtime-tools";

let sharedOcrExecutionGate: AsyncExecutionGate | undefined;

/** Coding Agent 的所有 Session 共用同一 OCR 并发策略。 */
export function getCodingAgentOcrExecutionGate(): AsyncExecutionGate {
	sharedOcrExecutionGate ??= createAsyncExecutionGate(resolveOcrConcurrency());
	return sharedOcrExecutionGate;
}

function resolveOcrConcurrency(): number {
	const parsed = Number.parseInt(process.env.VETTA_KB_OCR_CONCURRENCY ?? "", 10);
	return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}
