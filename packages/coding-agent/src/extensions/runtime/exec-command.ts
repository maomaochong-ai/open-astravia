import { spawn } from "node:child_process";
import type { ExecOptions, ExecResult } from "../infrastructure.js";

export async function executeExtensionCommand(
	command: string,
	args: string[],
	cwd: string,
	options?: ExecOptions,
): Promise<ExecResult> {
	return new Promise((resolve) => {
		const process = spawn(command, args, {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let killed = false;
		let timeoutId: NodeJS.Timeout | undefined;

		const killProcess = () => {
			if (killed) return;
			killed = true;
			process.kill("SIGTERM");
			setTimeout(() => {
				if (!process.killed) process.kill("SIGKILL");
			}, 5000);
		};

		if (options?.signal) {
			if (options.signal.aborted) killProcess();
			else options.signal.addEventListener("abort", killProcess, { once: true });
		}

		if (options?.timeout && options.timeout > 0) {
			timeoutId = setTimeout(killProcess, options.timeout);
		}

		process.stdout?.on("data", (data) => {
			stdout += data.toString();
		});
		process.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		const finish = (code: number) => {
			if (timeoutId) clearTimeout(timeoutId);
			options?.signal?.removeEventListener("abort", killProcess);
			resolve({ stdout, stderr, code, killed });
		};

		process.on("close", (code) => finish(code ?? 0));
		process.on("error", () => finish(1));
	});
}
