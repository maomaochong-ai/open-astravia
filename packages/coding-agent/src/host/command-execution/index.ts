import type { HostBashExecutor } from "./contracts.js";
import { executeLocalHostBash } from "./local-bash-executor.js";
import { executeHostBashWithOperations } from "./operations-bash-executor.js";

export type {
	HostBashExecutionOptions,
	HostBashExecutor,
	HostBashOperationOptions,
	HostBashOperations,
	HostBashResult,
} from "./contracts.js";

/** 创建无会话状态的默认宿主 Bash 执行器。 */
export function createHostBashExecutor(): HostBashExecutor {
	return {
		execute: executeLocalHostBash,
		executeWithOperations: executeHostBashWithOperations,
	};
}
