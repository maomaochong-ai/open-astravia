import { PassThrough } from "node:stream";
import type { CodingToolExecutableResolver, ToolProcessSpawner } from "@vetta/runtime-node/coding";
import { quoteShellArgument, type SshConnection } from "@vetta/ssh-transport";

/**
 * 在远端启动搜索工具用的外部程序（ripgrep / fd）。
 *
 * 走登录 shell：用户把 rg 装在 `~/.cargo/bin` 或 brew 前缀下时，只有 profile 里的 PATH
 * 能找到它。参数逐个加引号后拼成命令串——搜索模式来自模型，里面的 `$`、反引号和
 * 分号都必须按字面量到达 rg。
 */
export function createSshToolProcessSpawner(connection: SshConnection): ToolProcessSpawner {
	return (executable, args) => {
		const stdout = new PassThrough();
		const stderr = new PassThrough();
		const controller = new AbortController();
		const closeListeners: ((code: number | null) => void)[] = [];
		const errorListeners: ((error: Error) => void)[] = [];
		const command = [executable, ...args].map(quoteShellArgument).join(" ");

		connection
			.exec(command, {
				onStdout: (chunk) => stdout.write(chunk),
				onStderr: (chunk) => stderr.write(chunk),
				signal: controller.signal,
			})
			.then(
				(result) => finish(result.exitCode),
				(error: unknown) => {
					// 主动掐掉（结果已经够了）不是故障，按「被杀掉」收尾，与本机实现一致。
					if (controller.signal.aborted) {
						finish(null);
						return;
					}
					stdout.end();
					stderr.end();
					const failure = error instanceof Error ? error : new Error(String(error));
					for (const listener of errorListeners) listener(failure);
				},
			);

		function finish(code: number | null): void {
			// 先让消费者把已写入的数据读完，再报告结束：本机实现的 close 事件同样晚于流结束。
			let pending = 2;
			const done = (): void => {
				pending -= 1;
				if (pending === 0) for (const listener of closeListeners) listener(code);
			};
			stdout.once("close", done);
			stderr.once("close", done);
			stdout.end();
			stderr.end();
			// 没人读 stderr 时流不会自己走到 close。
			stdout.resume();
			stderr.resume();
		}

		return {
			stdout,
			stderr,
			kill: () => controller.abort(),
			onClose: (listener) => {
				closeListeners.push(listener);
			},
			onError: (listener) => {
				errorListeners.push(listener);
			},
		};
	};
}

/** Debian / Ubuntu 把 fd 装成 `fdfind`，因为 `fd` 这个名字被别的包占了。 */
const REMOTE_EXECUTABLE_CANDIDATES = {
	rg: ["rg"],
	fd: ["fd", "fdfind"],
} as const;

/**
 * 远端有没有 rg / fd，以及它叫什么。
 *
 * 找不到时**抛出**而不是返回空：工具对空值的说法是「could not be downloaded」，那是
 * 本机托管下载的语境。远端的事实是「这台机器上没装」，模型得到这句话才知道该改用
 * bash 里的 grep / find，而不是反复重试。
 */
export function createSshExecutableResolver(connection: SshConnection): CodingToolExecutableResolver {
	const resolved = new Map<"rg" | "fd", Promise<string>>();
	return {
		resolve(tool) {
			let pending = resolved.get(tool);
			if (!pending) {
				pending = locate(connection, tool);
				// 失败不缓存：用户可能这就去装了。
				pending.catch(() => resolved.delete(tool));
				resolved.set(tool, pending);
			}
			return pending;
		},
	};
}

async function locate(connection: SshConnection, tool: "rg" | "fd"): Promise<string> {
	const candidates = REMOTE_EXECUTABLE_CANDIDATES[tool];
	const script = candidates.map((name) => `command -v ${name}`).join(" || ");
	const chunks: Uint8Array[] = [];
	const result = await connection.exec(script, { onStdout: (chunk) => chunks.push(chunk) });
	const located = Buffer.concat(chunks).toString("utf8").trim().split("\n")[0]?.trim();
	if (result.exitCode === 0 && located) return located;
	const name = tool === "rg" ? "ripgrep (rg)" : "fd";
	throw new Error(
		`${name} is not installed on the remote host ${connection.host.label}. ` +
			"Use grep / find through the bash tool instead, or install it on that machine.",
	);
}
