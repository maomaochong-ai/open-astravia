import { CodingAgentMemoryRolloverOrchestrator } from "../memory/memory-rollover-runtime.js";
import type { MemoryTextStorage } from "../memory/memory-storage.js";

export interface CodingAgentMemoryRuntimeHostOptions {
	readonly cwd: string;
	readonly memoryFile: string;
	readonly memoryStorage: MemoryTextStorage;
	readonly journalStorage: MemoryTextStorage;
	readonly memoryCharLimit?: number;
}

export type { MemoryTextStorage } from "../memory/memory-storage.js";
export type { CodingAgentMemoryRuntimeFactoryOptions } from "./contracts/memory-runtime.js";

export function createCodingAgentMemoryRolloverRuntime(
	options: CodingAgentMemoryRuntimeHostOptions,
): CodingAgentMemoryRolloverOrchestrator {
	return new CodingAgentMemoryRolloverOrchestrator(options);
}
