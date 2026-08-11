import { type AsyncExecutionGate, createAsyncExecutionGate } from "@vetta/runtime-tools/coding";

let sharedOcrExecutionGate: AsyncExecutionGate | undefined;

/** 所有 Session 共用同一 OCR 并发门，首次使用时读取环境配置。 */
export function getCodingAgentOcrExecutionGate(): AsyncExecutionGate {
	sharedOcrExecutionGate ??= createAsyncExecutionGate(resolveOcrConcurrency());
	return sharedOcrExecutionGate;
}

function resolveOcrConcurrency(): number {
	const parsed = Number.parseInt(process.env.VETTA_KB_OCR_CONCURRENCY ?? "", 10);
	return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}
