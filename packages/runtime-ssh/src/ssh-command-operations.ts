import type { ForegroundCommandOperations } from "@vetta/runtime-tools";
import type { SshConnection } from "@vetta/ssh-transport";

/**
 * Agent 的 bash 工具在远端执行。
 *
 * 超时交给本地：`timeout` 到点时中止 ssh 通道，远端的前台进程随之收到 SIGHUP。
 * 在远端再包一层 `timeout(1)` 看似更可靠，但那个命令在 BSD/macOS 上默认不存在，
 * 反而会让所有命令都失败。
 */
export function createSshForegroundCommandOperations(connection: SshConnection): ForegroundCommandOperations {
	return {
		exec: async (command, cwd, options) => {
			const result = await connection.exec(command, {
				cwd,
				// 本机环境变量不透传远端（ADR-0120）：远端有自己的 PATH、代理和凭据配置，
				// 把本机的盖上去只会让「在终端里能跑」和「Agent 跑」得到不同结果。
				env: toStringRecord(options.env),
				onStdout: options.onData,
				// stderr 也并进同一条流：bash 工具的合同是「一份合并输出」，分开回传会让
				// 报错和正常输出在时间上错位。
				onStderr: options.onData,
				signal: options.signal,
				timeoutMs: options.timeout === undefined ? undefined : options.timeout * 1000,
			});
			return { exitCode: result.exitCode };
		},
	};
}

/** 丢掉 undefined 值：远端的 `export VAR=` 需要确定的字符串。 */
function toStringRecord(
	env: Readonly<Record<string, string | undefined>> | undefined,
): Record<string, string> | undefined {
	if (!env) return undefined;
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (typeof value === "string") result[key] = value;
	}
	return result;
}
