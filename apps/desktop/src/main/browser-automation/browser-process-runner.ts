import type { ChildProcess } from "node:child_process";
import { createPluginCommandEnvironment } from "../plugins/command-environment.js";
import { spawnCrossPlatformCommand } from "../plugins/command-launcher.js";

export interface BrowserProcessResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
	truncated: boolean;
}

export interface BrowserProcessRunOptions {
	timeoutMs: number;
	maxOutputChars?: number;
	signal?: AbortSignal;
}

export interface BrowserProcessRunner {
	run(file: string, args: readonly string[], options: BrowserProcessRunOptions): Promise<BrowserProcessResult>;
}

export class BrowserProcessAbortedError extends Error {
	constructor() {
		super("Browser process was aborted");
		this.name = "BrowserProcessAbortedError";
	}
}

function appendBounded(current: string, chunk: string, limit: number): { value: string; truncated: boolean } {
	const combined = current + chunk;
	if (combined.length <= limit) return { value: combined, truncated: false };
	return { value: combined.slice(combined.length - limit), truncated: true };
}

export class HostBrowserProcessRunner implements BrowserProcessRunner {
	run(file: string, args: readonly string[], options: BrowserProcessRunOptions): Promise<BrowserProcessResult> {
		const startedAt = Date.now();
		const limit = options.maxOutputChars ?? 1_000_000;
		return new Promise((resolve, reject) => {
			if (options.signal?.aborted) {
				reject(new BrowserProcessAbortedError());
				return;
			}
			let child: ChildProcess;
			try {
				child = spawnCrossPlatformCommand(file, args, {
					env: createPluginCommandEnvironment(),
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
			let timedOut = false;
			let aborted = false;
			let settled = false;
			const timeout = setTimeout(() => {
				timedOut = true;
				child.kill();
			}, options.timeoutMs);
			const cleanup = (): void => {
				clearTimeout(timeout);
				options.signal?.removeEventListener("abort", onAbort);
			};
			const rejectOnce = (error: unknown): void => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(error);
			};
			const onAbort = (): void => {
				aborted = true;
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
			child.once("close", (code) => {
				if (settled) return;
				settled = true;
				cleanup();
				if (aborted) {
					reject(new BrowserProcessAbortedError());
					return;
				}
				if (timedOut) {
					reject(new Error(`Browser process timed out after ${options.timeoutMs}ms`));
					return;
				}
				resolve({ exitCode: code ?? 1, stdout, stderr, durationMs: Date.now() - startedAt, truncated });
			});
		});
	}
}
