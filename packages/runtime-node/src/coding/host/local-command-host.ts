import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers";
import type { ForegroundCommandOperations } from "@vetta/runtime-tools";
import type {
	BackgroundCommandHost,
	BackgroundCommandOutputStore,
	BackgroundCommandProcessOperations,
} from "../shared/background-command-host.js";
import type { ForegroundCommandExecutorOptions } from "../shared/foreground-command-executor.js";
import { killNodeProcessTree } from "./process-tree.js";

export interface NodeShellCommand {
	readonly executable: string;
	readonly args: readonly string[];
	readonly commandPrefix?: string;
}

export interface NodeForegroundCommandHostOptions {
	readonly resolveShell: () => NodeShellCommand;
	readonly environment?: () => NodeJS.ProcessEnv;
	readonly protectedDirectories?: readonly string[];
}

export interface NodeBackgroundCommandHostOptions {
	readonly resolveShell: () => NodeShellCommand;
	readonly normalizeOutput?: (value: string) => string;
}

export function createNodeForegroundCommandHost(
	options: NodeForegroundCommandHostOptions,
): ForegroundCommandExecutorOptions {
	return {
		operations: createForegroundOperations(options.resolveShell, options.environment),
		environment: options.environment,
		protectedDirectories: options.protectedDirectories,
		commandPrefix: options.resolveShell().commandPrefix,
	};
}

export function createNodeBackgroundCommandHost(options: NodeBackgroundCommandHostOptions): BackgroundCommandHost {
	return {
		processOperations: createBackgroundProcessOperations(options),
		outputStore: localBackgroundCommandOutputStore,
	};
}

function createForegroundOperations(
	resolveShell: () => NodeShellCommand,
	readEnvironment: (() => NodeJS.ProcessEnv) | undefined,
): ForegroundCommandOperations {
	return {
		exec(command, cwd, { onData, signal, timeout, env }) {
			return new Promise((resolveExecution, rejectExecution) => {
				if (!existsSync(cwd)) {
					rejectExecution(new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`));
					return;
				}
				const shell = resolveShell();
				const child = spawn(shell.executable, [...shell.args, command], {
					cwd,
					detached: process.platform !== "win32",
					env: { ...(env ?? readEnvironment?.() ?? process.env) },
					stdio: ["ignore", "pipe", "pipe"],
					windowsHide: true,
				});
				let timedOut = false;
				let settled = false;
				let timeoutHandle: NodeJS.Timeout | undefined;
				const cleanup = () => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					signal?.removeEventListener("abort", onAbort);
					child.stdout?.destroy();
					child.stderr?.destroy();
				};
				const resolveOnce = (exitCode: number | null) => {
					if (settled) return;
					settled = true;
					cleanup();
					resolveExecution({ exitCode });
				};
				const rejectOnce = (error: Error) => {
					if (settled) return;
					settled = true;
					cleanup();
					rejectExecution(error);
				};
				const stop = () => {
					if (child.pid) killNodeProcessTree(child.pid);
					else child.kill();
				};
				const onAbort = () => {
					stop();
					rejectOnce(new Error("aborted"));
				};

				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						stop();
						rejectOnce(new Error(`timeout:${timeout}`));
					}, timeout * 1_000);
				}
				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);
				child.once("error", rejectOnce);
				if (signal?.aborted) onAbort();
				else signal?.addEventListener("abort", onAbort, { once: true });
				child.once("exit", (exitCode) => {
					if (signal?.aborted || timedOut) return;
					// Daemonizing commands can leave descendants holding the inherited
					// output pipes after the command shell itself exits. Flush queued data
					// for one turn, then settle from `exit` instead of waiting forever for
					// `close`; `close` remains the fast path for ordinary commands.
					setImmediate(() => resolveOnce(exitCode));
				});
				child.once("close", (exitCode) => {
					if (signal?.aborted) rejectOnce(new Error("aborted"));
					else if (timedOut) rejectOnce(new Error(`timeout:${timeout}`));
					else resolveOnce(exitCode);
				});
			});
		},
	};
}

function createBackgroundProcessOperations(
	options: NodeBackgroundCommandHostOptions,
): BackgroundCommandProcessOperations {
	return {
		spawn(request) {
			const shell = options.resolveShell();
			const child = spawn(shell.executable, [...shell.args, request.command], {
				cwd: request.cwd,
				detached: process.platform !== "win32",
				env: request.env,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			const decoder = new TextDecoder();
			const onData = (data: Buffer): void => {
				const decoded = decoder.decode(data, { stream: true });
				const text = (options.normalizeOutput?.(decoded) ?? decoded).replaceAll("\r", "");
				if (text) request.onOutput(text);
			};
			let settled = false;
			const cleanup = (): void => {
				child.stdout?.destroy();
				child.stderr?.destroy();
			};
			const settleExit = (exitCode: number | null): void => {
				if (settled) return;
				settled = true;
				cleanup();
				request.onExit(exitCode ?? undefined);
			};
			const settleError = (error: Error): void => {
				if (settled) return;
				settled = true;
				cleanup();
				request.onError(error);
			};
			child.stdout?.on("data", onData);
			child.stderr?.on("data", onData);
			child.once("exit", (exitCode) => setImmediate(() => settleExit(exitCode)));
			child.once("close", settleExit);
			child.once("error", settleError);
			return {
				stop() {
					if (child.pid) killNodeProcessTree(child.pid);
					else child.kill();
				},
			};
		},
	};
}

const localBackgroundCommandOutputStore: BackgroundCommandOutputStore = {
	create(taskId) {
		const path = join(tmpdir(), `vetta-task-${taskId}-${randomBytes(4).toString("hex")}.log`);
		const stream = createWriteStream(path);
		return {
			path,
			append: (text) => stream.write(text),
			read: (offset) => readFileSync(path).subarray(offset).toString("utf-8"),
			close: () => stream.end(),
		};
	},
};
