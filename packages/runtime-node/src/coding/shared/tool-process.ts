import { spawn } from "node:child_process";
import type { Readable } from "node:stream";

/**
 * 搜索类工具（grep / glob / find / tree）启动外部程序的端口。
 *
 * 这些工具的价值在于 ripgrep / fd 的输出解析与结果整形，而不在于「进程由谁启动」。
 * 把启动点写死成本机 `spawn`，项目在远端时它们就只能去搜本机磁盘，再把本机的命中当成
 * 远端项目的内容交给模型。抽成端口后，同一份解析逻辑可以接到任何一台机器上。
 */
export interface ToolProcess {
	readonly stdout: Readable;
	readonly stderr: Readable;
	/** 提前结束：结果已经够了，或调用方取消。重复调用无害。 */
	kill(): void;
	/** stdout / stderr 都读完之后触发；被杀掉时 code 为 null。 */
	onClose(listener: (code: number | null) => void): void;
	/** 进程没能启动。与 `onClose` 互斥。 */
	onError(listener: (error: Error) => void): void;
}

export type ToolProcessSpawner = (executable: string, args: readonly string[]) => ToolProcess;

export const spawnLocalToolProcess: ToolProcessSpawner = (executable, args) => {
	const child = spawn(executable, [...args], { stdio: ["ignore", "pipe", "pipe"] });
	return {
		stdout: child.stdout,
		stderr: child.stderr,
		kill: () => {
			if (!child.killed) child.kill();
		},
		onClose: (listener) => {
			child.on("close", listener);
		},
		onError: (listener) => {
			child.on("error", listener);
		},
	};
};

export interface CollectedToolProcessOutput {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

/** 跑到结束并收齐输出。给一次性取回全部结果、不需要流式截断的工具用。 */
export function collectToolProcess(
	spawnProcess: ToolProcessSpawner,
	executable: string,
	args: readonly string[],
	signal?: AbortSignal,
): Promise<CollectedToolProcessOutput> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Operation aborted"));
			return;
		}
		const child = spawnProcess(executable, args);
		let stdout = "";
		let stderr = "";
		let aborted = false;
		const onAbort = (): void => {
			aborted = true;
			child.kill();
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.onError((error) => {
			signal?.removeEventListener("abort", onAbort);
			reject(error);
		});
		child.onClose((code) => {
			signal?.removeEventListener("abort", onAbort);
			if (aborted) reject(new Error("Operation aborted"));
			else resolve({ code, stdout, stderr });
		});
	});
}
