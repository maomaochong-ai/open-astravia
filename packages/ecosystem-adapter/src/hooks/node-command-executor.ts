import { type ChildProcess, spawn } from "node:child_process";
import type { HookCommandExecutor, HookCommandResult } from "./types.js";

export interface NodeHookCommandExecutorOptions {
	shellProgram?: string;
	shellArgs?: readonly string[];
	maxOutputBytes?: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export class NodeHookCommandExecutor implements HookCommandExecutor {
	private readonly shellProgram: string;
	private readonly shellArgs: readonly string[];
	private readonly maxOutputBytes: number;

	constructor(options: NodeHookCommandExecutorOptions = {}) {
		const defaults = defaultShell();
		this.shellProgram = options.shellProgram ?? defaults.program;
		this.shellArgs = options.shellArgs ?? defaults.args;
		this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
	}

	execute(request: Parameters<HookCommandExecutor["execute"]>[0], signal?: AbortSignal): Promise<HookCommandResult> {
		const startedAtMs = Date.now();
		return new Promise((resolve) => {
			let child: ChildProcess;
			try {
				child = spawn(this.shellProgram, [...this.shellArgs, request.command], {
					cwd: request.cwd,
					detached: process.platform !== "win32",
					env: request.env ? { ...process.env, ...request.env } : process.env,
					windowsVerbatimArguments: isWindowsCommandShell(this.shellProgram),
					windowsHide: true,
					stdio: ["pipe", "pipe", "pipe"],
				});
			} catch (error) {
				resolve(failedResult(startedAtMs, "spawn_failed", error instanceof Error ? error.message : String(error)));
				return;
			}

			const stdout: Buffer[] = [];
			const stderr: Buffer[] = [];
			let outputBytes = 0;
			let settled = false;
			let failure: HookCommandResult["error"];
			let timeout: ReturnType<typeof setTimeout> | undefined;

			const finish = (exitCode: number | null): void => {
				if (settled) return;
				settled = true;
				if (timeout) clearTimeout(timeout);
				signal?.removeEventListener("abort", onAbort);
				const completedAtMs = Date.now();
				resolve({
					startedAt: Math.floor(startedAtMs / 1000),
					completedAt: Math.floor(completedAtMs / 1000),
					durationMs: completedAtMs - startedAtMs,
					exitCode,
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderr: Buffer.concat(stderr).toString("utf8"),
					error: failure,
				});
			};

			const stop = (code: NonNullable<HookCommandResult["error"]>["code"], message: string): void => {
				if (failure) return;
				failure = { code, message };
				killProcessTree(child);
			};
			const onAbort = (): void => stop("cancelled", "hook command cancelled");
			const collect = (target: Buffer[], chunk: Buffer): void => {
				if (outputBytes + chunk.length > this.maxOutputBytes) {
					stop("output_limit", `hook output exceeded ${this.maxOutputBytes} bytes`);
					return;
				}
				outputBytes += chunk.length;
				target.push(chunk);
			};

			child.stdout?.on("data", (chunk: Buffer) => collect(stdout, chunk));
			child.stderr?.on("data", (chunk: Buffer) => collect(stderr, chunk));
			child.once("error", (error) => {
				failure = { code: "spawn_failed", message: error.message };
				finish(null);
			});
			child.once("close", (code) => finish(code));
			child.stdin?.on("error", () => {
				// A hook may exit before consuming stdin; close status remains authoritative.
			});
			child.stdin?.end(request.stdin);

			if (signal) {
				if (signal.aborted) onAbort();
				else signal.addEventListener("abort", onAbort, { once: true });
			}
			timeout = setTimeout(
				() => stop("timed_out", `hook command timed out after ${request.timeoutMs}ms`),
				request.timeoutMs,
			);
		});
	}
}

function isWindowsCommandShell(program: string): boolean {
	return process.platform === "win32" && /(?:^|[\\/])cmd(?:\.exe)?$/i.test(program);
}

function defaultShell(): { program: string; args: string[] } {
	if (process.platform === "win32") {
		return { program: process.env.COMSPEC ?? "cmd.exe", args: ["/C"] };
	}
	return { program: process.env.SHELL ?? "/bin/sh", args: ["-lc"] };
}

function killProcessTree(child: ChildProcess): void {
	if (!child.pid) return;
	if (process.platform === "win32") {
		const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
			stdio: "ignore",
			windowsHide: true,
		});
		killer.unref();
		return;
	}
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		child.kill("SIGKILL");
	}
}

function failedResult(
	startedAtMs: number,
	code: NonNullable<HookCommandResult["error"]>["code"],
	message: string,
): HookCommandResult {
	const completedAtMs = Date.now();
	return {
		startedAt: Math.floor(startedAtMs / 1000),
		completedAt: Math.floor(completedAtMs / 1000),
		durationMs: completedAtMs - startedAtMs,
		exitCode: null,
		stdout: "",
		stderr: "",
		error: { code, message },
	};
}
