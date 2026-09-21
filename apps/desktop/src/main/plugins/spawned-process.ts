import { type ChildProcess, execFile } from "node:child_process";
import { isSshProjectUri, parseProjectLocation } from "@vetta/ssh-transport";
import { getSshConnection } from "../ssh/ssh-runtime.js";
import { createPluginCommandEnvironment } from "./command-environment.js";
import { spawnCrossPlatformCommand } from "./command-launcher.js";

/**
 * 插件启动的长驻进程，本机与远端共用同一套生命周期。
 *
 * 抽这一层是因为「进程在哪台机器上」是一个真实的变化维度：远程项目里，npm install、构建
 * 这类长跑命令必须在项目所在的机器上执行，否则它看不到任何项目文件。调用方只管启动、读
 * 输出、停止，不必知道自己面对的是本机子进程还是一条 SSH 通道。
 */
export interface SpawnedProcess {
	/** 本机进程号。远端进程在这台机器上没有对应的进程号，固定为 -1。 */
	readonly pid: number;
	readonly finished: boolean;
	/** stdout 与 stderr 合流：状态里本来就是一份滚动日志，分开只会让两者在时间上错位。 */
	onOutput(listener: (chunk: Buffer) => void): void;
	onExit(listener: (exitCode: number | null, signal: string | null) => void): void;
	/** 启动成功后兑现；启动失败时抛。与 {@link onExit} 互斥。 */
	whenStarted(): Promise<void>;
	kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export interface SpawnProcessOptions {
	readonly file: string;
	readonly args: readonly string[];
	readonly cwd: string | undefined;
	readonly env: Record<string, string> | undefined;
}

/** 按 cwd 的归属决定进程在哪台机器上启动。 */
export function startProcess(options: SpawnProcessOptions): SpawnedProcess {
	return options.cwd !== undefined && isSshProjectUri(options.cwd)
		? startRemoteProcess(options, options.cwd)
		: startLocalProcess(options);
}

function startLocalProcess(options: SpawnProcessOptions): SpawnedProcess {
	const child = spawnCrossPlatformCommand(options.file, [...options.args], {
		cwd: options.cwd,
		env: createPluginCommandEnvironment(options.env),
		windowsHide: true,
		// Own process group so kill() can signal children (esbuild etc.) too.
		detached: process.platform !== "win32",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return {
		get pid() {
			return child.pid ?? -1;
		},
		get finished() {
			return child.exitCode !== null || child.signalCode !== null;
		},
		onOutput: (listener) => {
			child.stdout?.on("data", listener);
			child.stderr?.on("data", listener);
		},
		onExit: (listener) => {
			child.on("exit", (exitCode, signal) => listener(exitCode, signal));
		},
		whenStarted: () =>
			new Promise<void>((resolve, reject) => {
				child.once("spawn", () => resolve());
				child.once("error", (error: NodeJS.ErrnoException) => {
					reject(new Error(`Command failed to start: ${options.file} (${error.code ?? error.message})`));
				});
			}),
		kill: (signal) => killTree(child, signal),
	};
}

/** 杀掉整棵进程树（vite 派生的 esbuild 子进程活得过一次普通的 SIGTERM）。 */
function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
	if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
	if (process.platform === "win32") {
		execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {
			// best-effort; the exit listener owns state transitions
		});
		return;
	}
	try {
		// Negative pid targets the detached process group (POSIX).
		process.kill(-child.pid, signal);
	} catch {
		try {
			child.kill(signal);
		} catch {
			// Already gone.
		}
	}
}

/**
 * 在远程项目所在的机器上启动。
 *
 * 与本机的两点差别，都是远端固有的、不该假装没有：
 * - 没有本机进程号可报（`pid` 为 -1）。
 * - 启动失败发现得更晚。本机 spawn 找不到可执行文件会立刻 error，而远端要等 shell 回话，
 *   表现为退出码非零加一行 stderr——与 `command.run` 在远端的行为一致。
 *
 * 停止时中止这条 SSH 通道，连接层会连带终止远端的进程组：没有 pty 就没有 SIGHUP，
 * 只关通道是杀不掉远端进程的。
 */
function startRemoteProcess(options: SpawnProcessOptions, projectUri: string): SpawnedProcess {
	const location = parseProjectLocation(projectUri);
	if (location.kind !== "ssh") throw new Error(`Not a remote project path: ${projectUri}`);
	const controller = new AbortController();
	const outputListeners: ((chunk: Buffer) => void)[] = [];
	const exitListeners: ((exitCode: number | null, signal: string | null) => void)[] = [];
	let finished = false;

	const emit = (chunk: Uint8Array): void => {
		const buffer = Buffer.from(chunk);
		for (const listener of outputListeners) listener(buffer);
	};
	const settle = (exitCode: number | null, signal: string | null): void => {
		if (finished) return;
		finished = true;
		for (const listener of exitListeners) listener(exitCode, signal);
	};

	// 逐个参数加引号：参数来自插件，里面的空格、引号和 `$` 都必须按字面量到达命令。
	const command = [options.file, ...options.args].map(quote).join(" ");
	getSshConnection(location.hostId)
		.exec(command, {
			cwd: location.remotePath,
			env: options.env,
			onStdout: emit,
			onStderr: emit,
			signal: controller.signal,
		})
		.then(
			(result) => settle(result.exitCode, null),
			(error: unknown) => {
				if (controller.signal.aborted) {
					settle(null, "SIGTERM");
					return;
				}
				emit(Buffer.from(`${error instanceof Error ? error.message : String(error)}\n`));
				settle(null, null);
			},
		);

	return {
		pid: -1,
		get finished() {
			return finished;
		},
		onOutput: (listener) => {
			outputListeners.push(listener);
		},
		onExit: (listener) => {
			exitListeners.push(listener);
		},
		// 命令已经发出；远端进程是否真的起来了，要等它回话才知道。
		whenStarted: () => Promise.resolve(),
		kill: () => controller.abort(),
	};
}

/** POSIX 单引号字面量：引号内除了 `'` 自身没有元字符。 */
function quote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
