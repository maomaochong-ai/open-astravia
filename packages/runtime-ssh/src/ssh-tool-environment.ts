import {
	collectToolProcess,
	createBackgroundCommandService,
	createBackgroundCommandToolExecutor,
	createBashToolRegistration,
	createEditToolRegistration,
	createFindToolRegistration,
	createForegroundCommandToolExecutor,
	createGlobToolRegistration,
	createGrepToolRegistration,
	createLsToolRegistration,
	createReadToolRegistration,
	createTreeToolRegistration,
	createWriteToolRegistration,
	type EditPathPolicy,
	type ReadToolOptions,
	remotePosixToolPathHost,
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
import { createSshExecutableResolver, createSshToolProcessSpawner } from "./ssh-tool-process.js";

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
 * 搜索类工具（grep / glob / find / dir_tree）同样注册：它们的 ripgrep / fd 改在远端启动，
 * 命中来自正确的那台机器。远端没装时工具会明说，模型改用 bash 里的 grep / find。
 */
export function createSshCodingToolEnvironment(options: SshCodingToolEnvironmentOptions): SshCodingToolEnvironment {
	const { connection, remoteCwd } = options;
	// 路径一律按远端解析：不探本机磁盘、不按本机家目录展开 `~`、固定 POSIX 语义。
	const pathHost = remotePosixToolPathHost;
	const lsOperations = createSshLsOperations(connection);
	const isDirectory = async (absolutePath: string): Promise<boolean> =>
		(await lsOperations.stat(absolutePath)).isDirectory();
	const search = {
		pathHost,
		spawnProcess: createSshToolProcessSpawner(connection),
		executableResolver: createSshExecutableResolver(connection),
	};
	// 本机环境变量不进远端。远端自己的 PATH 由登录 shell 提供。
	const environment = () => ({});
	const backgroundService = createBackgroundCommandService(createSshBackgroundCommandHost(connection));
	const foregroundExecutor = createForegroundCommandToolExecutor({
		operations: createSshForegroundCommandOperations(connection),
		environment,
		pathHost,
		blockUntilSec: options.blockUntilSec,
	});
	const commandExecutor = createBackgroundCommandToolExecutor({
		environment,
		pathHost,
		foregroundExecutor,
		backgroundService,
	});

	return {
		registrations: [
			createReadToolRegistration(remoteCwd, {
				...options.readOptions,
				pathHost,
				operations: createSshReadOperations(connection),
			}),
			createEditToolRegistration(remoteCwd, {
				pathPolicy: options.editPathPolicy,
				pathHost,
				operations: createSshEditOperations(connection),
			}),
			createWriteToolRegistration(remoteCwd, {
				pathPolicy: options.writePathPolicy,
				pathHost,
				operations: createSshWriteOperations(connection),
			}),
			createLsToolRegistration(remoteCwd, { pathHost, operations: lsOperations }),
			createGrepToolRegistration(remoteCwd, { ...search, operations: { isDirectory } }),
			createGlobToolRegistration(remoteCwd, { ...search, operations: { isDirectory } }),
			createFindToolRegistration(remoteCwd, search),
			createTreeToolRegistration(remoteCwd, {
				...search,
				// 目录是否存在也得问远端：缺省实现查的是本机磁盘。
				operations: {
					exists: lsOperations.exists,
					stat: lsOperations.stat,
					runFd: async (fdPath, args) => {
						const result = await collectToolProcess(search.spawnProcess, fdPath, args);
						return { status: result.code, stdout: result.stdout, stderr: result.stderr };
					},
				},
			}),
			createBashToolRegistration(remoteCwd, { executor: commandExecutor }),
		],
		backgroundService,
		// 连接的生命周期由连接管理器按主机持有，会话结束不该把它关掉——同一台主机上
		// 的其它会话还在用同一条 ControlMaster。这里只收掉本会话自己的后台任务。
		dispose: () => backgroundService.dispose(),
	};
}
