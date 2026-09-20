import {
	createBackgroundCommandService,
	createBackgroundCommandToolExecutor,
	createBashToolRegistration,
	createEditToolRegistration,
	createForegroundCommandToolExecutor,
	createLsToolRegistration,
	createReadToolRegistration,
	createWriteToolRegistration,
	type EditPathPolicy,
	type ReadToolOptions,
	type WritePathPolicy,
} from "@vetta/runtime-node/coding";
import type { BackgroundCommandService, CodingToolRegistration } from "@vetta/runtime-tools";
import type { SshConnection } from "@vetta/ssh-transport";
import { createSshBackgroundCommandHost } from "./ssh-background-command-host.js";
import { createSshForegroundCommandOperations } from "./ssh-command-operations.js";
import {
	createSshEditOperations,
	createSshLsOperations,
	createSshReadOperations,
	createSshWriteOperations,
} from "./ssh-file-operations.js";

export interface SshCodingToolEnvironmentOptions {
	readonly connection: SshConnection;
	/**
	 * 远端工作目录的**绝对路径**，不是 `ssh://…` 标识。
	 *
	 * 工具内部所有的相对路径解析、路径越界判断和结果里的相对路径都基于它，传 URI
	 * 会让这些计算得出既不是本地也不是远端的第三种路径。URI 只是 Desktop 层的项目
	 * 主键，进入工具环境前就该解析掉。
	 */
	readonly remoteCwd: string;
	readonly editPathPolicy: EditPathPolicy;
	readonly writePathPolicy: WritePathPolicy;
	readonly readOptions?: Pick<ReadToolOptions, "binaryContentHint" | "preserveFullText">;
	readonly blockUntilSec?: number;
}

export interface SshCodingToolEnvironment {
	readonly registrations: readonly CodingToolRegistration[];
	readonly backgroundService: BackgroundCommandService;
	dispose(): void;
}

/**
 * 远程项目的 Coding Agent 工具集。
 *
 * 复用 runtime-node 的工具实现，只把它们的文件与命令端口换成 SSH 版；模型看到的
 * schema、描述和结果格式与本地完全一致。
 *
 * **刻意不注册 grep / glob / find / tree**：这四个工具在内部直接 spawn 本机的
 * ripgrep，注册到远程会话里就会去搜**本机**磁盘，然后把本机的命中当作远端项目的
 * 内容交给模型——这正是 ADR-0124 要禁止的静默回退。在它们的进程启动点被抽成可注入
 * 端口之前，远程会话让模型改用 bash 里的 grep/find，慢但结果属于正确的那台机器。
 */
export function createSshCodingToolEnvironment(options: SshCodingToolEnvironmentOptions): SshCodingToolEnvironment {
	const { connection, remoteCwd } = options;
	// 本机环境变量不进远端。远端自己的 PATH 由登录 shell 提供。
	const environment = () => ({});
	const backgroundService = createBackgroundCommandService(createSshBackgroundCommandHost(connection));
	const foregroundExecutor = createForegroundCommandToolExecutor({
		operations: createSshForegroundCommandOperations(connection),
		environment,
		blockUntilSec: options.blockUntilSec,
	});
	const commandExecutor = createBackgroundCommandToolExecutor({
		environment,
		foregroundExecutor,
		backgroundService,
	});

	return {
		registrations: [
			createReadToolRegistration(remoteCwd, {
				...options.readOptions,
				operations: createSshReadOperations(connection),
			}),
			createEditToolRegistration(remoteCwd, {
				pathPolicy: options.editPathPolicy,
				operations: createSshEditOperations(connection),
			}),
			createWriteToolRegistration(remoteCwd, {
				pathPolicy: options.writePathPolicy,
				operations: createSshWriteOperations(connection),
			}),
			createLsToolRegistration(remoteCwd, { operations: createSshLsOperations(connection) }),
			createBashToolRegistration(remoteCwd, { executor: commandExecutor }),
		],
		backgroundService,
		// 连接的生命周期由连接管理器按主机持有，会话结束不该把它关掉——同一台主机上
		// 的其它会话还在用同一条 ControlMaster。这里只收掉本会话自己的后台任务。
		dispose: () => backgroundService.dispose(),
	};
}
