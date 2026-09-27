import { type ChildProcess, spawn } from "node:child_process";
import { setImmediate } from "node:timers";

export interface BrowserProcessRunOptions {
	timeoutMs: number;
	maxOutputChars?: number;
	signal?: AbortSignal;
}

export interface BrowserProcessResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
	/** stdout+stderr 任何一个被截断时为 true。 */
	truncated: boolean;
}

export class BrowserProcessAbortedError extends Error {
	constructor() {
		super("Browser process was aborted");
		this.name = "BrowserProcessAbortedError";
		Object.setPrototypeOf(this, BrowserProcessAbortedError.prototype);
	}
}

export interface BrowserProcessRunner {
	run(file: string, args: readonly string[], options: BrowserProcessRunOptions): Promise<BrowserProcessResult>;
}

function appendBounded(current: string, chunk: string, limit: number): { value: string; truncated: boolean } {
	const combined = current + chunk;
	if (combined.length <= limit) return { value: combined, truncated: false };
	return { value: combined.slice(combined.length - limit), truncated: true };
}

/**
 * spawn 封装：继承全局 process.env（RuntimeManager.applyEnv() 已注入 PATH/npm_config_*），
 * 实现 timeout kill、AbortSignal、stdout/stderr 环形缓冲。
 *
 * 不使用 createPluginCommandEnvironment()（那是插件 renderer 侧的白名单透传，
 * 主进程全局 env 已完整包含托管 npm 配置）。
 */
export class HostBrowserProcessRunner implements BrowserProcessRunner {
	run(file: string, args: readonly string[], options: BrowserProcessRunOptions): Promise<BrowserProcessResult> {
		const startedAt = Date.now();
		const limit = options.maxOutputChars ?? 1_000_000;
		return new Promise<BrowserProcessResult>((resolve, reject) => {
			if (options.signal?.aborted) {
				reject(new BrowserProcessAbortedError());
				return;
			}

			let child: ChildProcess;
			try {
				child = spawn(file, args, {
					env: process.env,
					stdio: ["ignore", "pipe", "pipe"],
					windowsHide: true,
				});
			} catch (error) {
				reject(error);
				return;
			}

			let stdout = "";
			let stderr = "";
			let truncated = false;
			let settled = false;
			let timeout: ReturnType<typeof setTimeout> | undefined;

			const cleanup = (): void => {
				if (timeout) clearTimeout(timeout);
				options.signal?.removeEventListener("abort", onAbort);
				child.stdout?.destroy();
				child.stderr?.destroy();
			};

			const rejectOnce = (error: unknown): void => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(error);
			};

			const resolveOnce = (code: number | null): void => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve({
					exitCode: code ?? 1,
					stdout,
					stderr,
					durationMs: Date.now() - startedAt,
					truncated,
				});
			};

			timeout = setTimeout(() => {
				child.kill();
				rejectOnce(new Error(`Browser process timed out after ${options.timeoutMs}ms`));
			}, options.timeoutMs);

			const onAbort = (): void => {
				child.kill();
				rejectOnce(new BrowserProcessAbortedError());
			};
			options.signal?.addEventListener("abort", onAbort, { once: true });

			child.stdout?.setEncoding("utf8");
			child.stderr?.setEncoding("utf8");
			child.stdout?.on("data", (chunk: string) => {
				const appended = appendBounded(stdout, chunk, limit);
				stdout = appended.value;
				truncated ||= appended.truncated;
			});
			child.stderr?.on("data", (chunk: string) => {
				const appended = appendBounded(stderr, chunk, limit);
				stderr = appended.value;
				truncated ||= appended.truncated;
			});

			child.once("error", (error) => {
				rejectOnce(error);
			});

			child.once("exit", (code) => {
				if (settled) return;
				// agent-browser 首次调用会启动 daemon，可能让 Node `close` 事件 pending。
				// 给 queued stdout/stderr 输出一个 event-loop turn，再从 exit 事件 settle。
				setImmediate(() => resolveOnce(code));
			});

			child.once("close", (code) => {
				if (settled) return;
				resolveOnce(code);
			});
		});
	}
}
