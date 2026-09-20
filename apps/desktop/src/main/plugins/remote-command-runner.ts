import { parseProjectLocation, quoteShellArgument } from "@vetta/ssh-transport";
import type { PluginCommandRunResult } from "../../preload/api-types/plugins.js";
import { getSshConnection } from "../ssh/ssh-runtime.js";

export interface RemotePluginCommandRequest {
	readonly file: string;
	readonly args: readonly string[];
	/** 远程项目内的工作目录，`ssh://<hostId>/<路径>` 形态。 */
	readonly cwd: string;
	/** 只透传插件显式给出的变量；本机的 PATH、代理与凭据不进远端。 */
	readonly env: Readonly<Record<string, string>> | undefined;
	readonly timeoutMs: number;
	readonly maxBufferBytes: number;
}

/** POSIX shell 找不到命令时的退出码。 */
const COMMAND_NOT_FOUND_EXIT_CODE = 127;

/**
 * 在远程项目所在的机器上执行插件声明的命令。
 *
 * 插件拿到的 cwd 就是会话 cwd；项目在远端时，`git status` 这类命令只有在那台机器上执行
 * 才有意义。交给本机 spawn 的话，URI 不是一个存在的目录，结果是一句 `git (ENOENT)`——
 * 看起来像本机没装 git，Git 面板据此判断「不是仓库」并劝用户去初始化。
 *
 * 授权（权限、已声明、已启用）由调用方在分流之前完成，本地与远程共用同一道闸。
 */
export async function runRemotePluginCommand(request: RemotePluginCommandRequest): Promise<PluginCommandRunResult> {
	const location = parseProjectLocation(request.cwd);
	if (location.kind !== "ssh") throw new Error(`Not a remote project path: ${request.cwd}`);
	const connection = getSshConnection(location.hostId);

	const stdout: Uint8Array[] = [];
	const stderr: Uint8Array[] = [];
	let stdoutBytes = 0;
	let stderrBytes = 0;
	const limit = new AbortController();
	const collect = (chunks: Uint8Array[], chunk: Uint8Array, stream: "stdout" | "stderr"): void => {
		chunks.push(chunk);
		if (stream === "stdout") stdoutBytes += chunk.byteLength;
		else stderrBytes += chunk.byteLength;
		if (stdoutBytes > request.maxBufferBytes || stderrBytes > request.maxBufferBytes) limit.abort();
	};

	// 逐个参数加引号：参数来自插件，里面的空格、引号和 `$` 都必须按字面量到达命令。
	const command = [request.file, ...request.args].map(quoteShellArgument).join(" ");
	let exitCode: number;
	try {
		const result = await connection.exec(command, {
			cwd: location.remotePath,
			env: request.env,
			onStdout: (chunk) => collect(stdout, chunk, "stdout"),
			onStderr: (chunk) => collect(stderr, chunk, "stderr"),
			signal: limit.signal,
			timeoutMs: request.timeoutMs,
		});
		exitCode = result.exitCode;
	} catch (error) {
		if (limit.signal.aborted)
			throw new Error(`Command output exceeded ${request.maxBufferBytes} bytes: ${request.file}`);
		throw error;
	}
	if (exitCode === COMMAND_NOT_FOUND_EXIT_CODE) {
		// 与本机「可执行文件不存在」同一种失败，让插件沿用同一条处理路径。
		throw new Error(`Command failed to start: ${request.file} (ENOENT on remote host ${connection.host.label})`);
	}
	return {
		stdout: Buffer.concat(stdout).toString(),
		stderr: Buffer.concat(stderr).toString(),
		exitCode,
	};
}
