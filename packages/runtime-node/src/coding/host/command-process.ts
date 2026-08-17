import { spawn } from "node:child_process";
import type { CommandProcessPort, DesktopCommandResult } from "@vetta/runtime-tools";
import { killNodeProcessTree } from "./process-tree.js";

const DEFAULT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

export class NodeCommandProcessAbortedError extends Error {
	constructor() {
		super("Operation aborted");
		this.name = "NodeCommandProcessAbortedError";
	}
}

/** Creates a cancellable Node child-process implementation of CommandProcessPort. */
export function createNodeCommandProcessHost(): CommandProcessPort {
	return { run: (executable, args, options) => runCommandProcess(executable, args, options) };
}

function runCommandProcess(
	executable: string,
	args: readonly string[],
	options: Parameters<CommandProcessPort["run"]>[2],
): Promise<DesktopCommandResult> {
	return new Promise((resolve, reject) => {
		if (options.signal?.aborted) {
			reject(new NodeCommandProcessAbortedError());
			return;
		}
		const child = spawn(executable, [...args], {
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
			env: process.env,
		});
		const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
		let stdout = "";
		let stderr = "";
		let killed = false;
		let aborted = false;
		let timedOut = false;
		let overflow = false;
		let timeoutHandle: NodeJS.Timeout | undefined;

		const kill = (): void => {
			if (killed) return;
			killed = true;
			if (child.pid) killNodeProcessTree(child.pid);
			try {
				if (child.pid && !child.killed) child.kill();
			} catch {
				// The process may exit between the tree and direct kill attempts.
			}
		};
		const onAbort = (): void => {
			aborted = true;
			kill();
		};
		const cleanup = (): void => {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			options.signal?.removeEventListener("abort", onAbort);
		};
		const append = (data: Buffer, target: "stdout" | "stderr"): void => {
			if (overflow) return;
			const currentLength = target === "stdout" ? stdout.length : stderr.length;
			if (currentLength + data.length > maxBufferBytes) {
				overflow = true;
				kill();
				return;
			}
			if (target === "stdout") stdout += data.toString("utf8");
			else stderr += data.toString("utf8");
		};

		options.signal?.addEventListener("abort", onAbort, { once: true });
		if (options.timeoutMs > 0) {
			timeoutHandle = setTimeout(() => {
				timedOut = true;
				kill();
			}, options.timeoutMs);
		}
		child.stdout?.on("data", (data: Buffer) => append(data, "stdout"));
		child.stderr?.on("data", (data: Buffer) => append(data, "stderr"));
		child.on("error", (error) => {
			cleanup();
			if (aborted) reject(new NodeCommandProcessAbortedError());
			else reject(error);
		});
		child.on("close", (code) => {
			cleanup();
			if (aborted) reject(new NodeCommandProcessAbortedError());
			else if (timedOut) reject(new Error(`Process timed out after ${options.timeoutMs}ms`));
			else if (overflow) reject(new Error(`Process output exceeded ${maxBufferBytes} bytes`));
			else resolve({ stdout, stderr, code });
		});
	});
}
