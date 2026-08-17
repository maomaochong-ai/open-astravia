import { spawn } from "node:child_process";

export interface NodeCommandExecutionOptions {
	readonly signal?: AbortSignal;
	readonly timeout?: number;
}

export interface NodeCommandExecutionResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly code: number;
	readonly killed: boolean;
}

export interface NodeCommandExecutor {
	execute(
		command: string,
		args: readonly string[],
		cwd: string,
		options?: NodeCommandExecutionOptions,
	): Promise<NodeCommandExecutionResult>;
}

/** Executes an argv-based command without shell interpolation. */
export function createNodeCommandExecutor(): NodeCommandExecutor {
	return {
		execute(command, args, cwd, options) {
			return new Promise((resolve) => {
				const child = spawn(command, [...args], {
					cwd,
					shell: false,
					stdio: ["ignore", "pipe", "pipe"],
					windowsHide: true,
				});
				let stdout = "";
				let stderr = "";
				let killed = false;
				let settled = false;
				let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

				const stop = (): void => {
					if (killed) return;
					killed = true;
					child.kill("SIGTERM");
					setTimeout(() => {
						if (!child.killed) child.kill("SIGKILL");
					}, 5_000);
				};
				const finish = (code: number): void => {
					if (settled) return;
					settled = true;
					if (timeoutHandle) clearTimeout(timeoutHandle);
					options?.signal?.removeEventListener("abort", stop);
					resolve({ stdout, stderr, code, killed });
				};

				if (options?.signal?.aborted) stop();
				else options?.signal?.addEventListener("abort", stop, { once: true });
				if (options?.timeout && options.timeout > 0) timeoutHandle = setTimeout(stop, options.timeout);
				child.stdout?.on("data", (data: Buffer) => {
					stdout += data.toString();
				});
				child.stderr?.on("data", (data: Buffer) => {
					stderr += data.toString();
				});
				child.once("close", (code) => finish(code ?? 0));
				child.once("error", () => finish(1));
			});
		},
	};
}
