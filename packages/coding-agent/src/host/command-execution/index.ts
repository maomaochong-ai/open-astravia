import { createNodeHostBashExecutor, type NodeHostBashExecutor } from "@vetta/runtime-node/coding";
import type { HostBashExecutor } from "./contracts.js";
import { getDefaultShellCommandPrefix, getShellConfig, getShellEnv } from "./shell-runtime.js";

export type {
	HostBashExecutionOptions,
	HostBashExecutor,
	HostBashOperationOptions,
	HostBashOperations,
	HostBashResult,
} from "./contracts.js";

/** 创建无会话状态的默认宿主 Bash 执行器。 */
export function createHostBashExecutor(): HostBashExecutor {
	const nodeExecutor: NodeHostBashExecutor = createNodeHostBashExecutor({
		resolveShell: () => {
			const { shell, args } = getShellConfig();
			return { executable: shell, args, commandPrefix: getDefaultShellCommandPrefix(shell) };
		},
		environment: getShellEnv,
	});
	return nodeExecutor;
}
