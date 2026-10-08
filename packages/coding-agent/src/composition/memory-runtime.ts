import { CodingAgentMemoryRolloverOrchestrator } from "../memory/memory-rollover-runtime.js";
import type { MemoryTextStorage } from "../memory/memory-storage.js";

export interface CodingAgentMemoryRuntimeHostOptions {
	readonly cwd: string;
	readonly memoryFile: string;
	/**
	 * 用户级记忆（跨项目/对话共享）。缺省 = 本次会话只有 `project` 作用域，行为与
	 * 引入作用域前一致。
	 */
	readonly userMemoryFile?: string;
	readonly userMemoryStorage?: MemoryTextStorage;
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
